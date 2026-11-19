/** client.ts — the main client: reads and actions (operator, product, session, bounty).
 *  A session is locked to ONE enclave whose keys are verified on-chain; the Sealed Bounty pays in two steps
 *  (acceptClaim reserves the payment, deliver hands over cP and pays); registration goes through Intel's DCAP
 *  verification on Arc, and the quote is checked off-chain before it is sent; calls that write an ERC-8004 verdict
 *  carry a gas margin (the contract requires VERDICT_GAS before the write). Reverts are decoded by name (errors.ts). */
import {
  type Address, type Hex, type PublicClient, type WalletClient, type Account,
  getAddress, keccak256, toBytes, zeroAddress,
} from "viem";
import {
  testnet, type Deployment, ARC_TESTNET_ID, SESSION_MIN_SECONDS, SESSION_MAX_SECONDS, SESSION_EXPIRY_MARGIN_SECONDS,
  BOUNTY_MAX_SIGS,
} from "./network";
import {
  usdcAbi, operatorBondAbi, productRegistryAbi, enclaveRegistryAbi, sessionPayAbi, sealedBountyAbi, arcErrorsAbi,
} from "./abis";
import { buildReceiveAuthorization, type Auth, type SignTypedDataFn } from "./usdc";
import { generateSessionKey, type SessionKey } from "./crypto";
import { verifyEnclaveKeys, type VerifiedEnclaveKeys, type VerifyEnclaveKeysOptions } from "./enclave-keys";
import { type Claim } from "./eip712";
import { readSession, verifyReceiptOnChain, type SessionInfo, type ReceiptVerification } from "./receipts";
import { type Receipt } from "./eip712";
import { parseTdxQuote, expectedReportData0 } from "./quote";
import { planRegistrationLog } from "./dstack-eventlog";
import {
  sealExploitForEnclave, submitSealedExploit, type ExploitInput, type ProvenClaim, type SealedExploit,
} from "./bounty";

export interface ArcClientOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
  deployment?: Deployment;
}

export type ProductState = "None" | "Proposed" | "Active" | "Retired";
const STATES: ProductState[] = ["None", "Proposed", "Active", "Retired"];

export interface ProductView {
  id: bigint; author: Address; manifestHash: Hex; deterministic: boolean; price: bigint;
  bpsOperator: number; bpsAuthor: number; bpsNetwork: number;
  minBond: bigint; exposureCap: bigint; settlement: Address; param: Hex;
  version: bigint; activatesAt: bigint; state: ProductState; manifestURI: string;
  /** Billed unit (input-token equivalents per unit) and the weight of an output token, locked when the session opens. */
  unitTokens: number; outWeight: number;
}

/** An enclave of the registry (enclaveOf), with its state at the head block. */
export interface EnclaveView {
  signer: Address; x25519: Hex; operator: Address; productId: bigint; workloadId: Hex; fmspc: Hex;
  tcbStatus: number; quoteHash: Hex; anchorBlock: bigint; registeredAt: bigint;
  /** INDICATIVE timestamp (the rule is in blocks: untilBlock). */
  expiresAt: bigint;
  /** Current validity window, in blocks (receipts anchored in it settle until untilBlock + grace). */
  fromBlock: bigint; untilBlock: bigint;
  /** Active for its product at the head block (activeOperatorAt ≠ 0). */
  active: boolean;
  /** Head block of the read. */
  head?: bigint;
}

export interface BountyRow {
  id: bigint; protocol: Address; productId: bigint; predicateHash: Hex; protocolX25519: Hex; singleCap: bigint; k: number;
  balance: bigint; deadline: bigint; paused: boolean; targetToPause: Address;
  /** Highest tier already granted since the last arming (an exploit is paid only once per tier). */
  paidAmount: bigint;
  /** Block of the last payment or re-arming; a claim must be anchored AFTER it. */
  lastPaidBlock: bigint;
  /** The pause only affects claims anchored from this block on. */
  pausedFromBlock: bigint;
}

/** Payment reserved by acceptClaim, waiting for deliver (zero payee if none). */
export interface PendingPayout {
  payee: Address; tier: number; acceptedAt: bigint; cPHash: Hex; claimDigest: Hex; amount: bigint; netFee: bigint; opFee: bigint; ops: Address[];
}

/** Gas added to the estimate for calls that write an ERC-8004 verdict or pause a target (the contract requires
 *  VERDICT_GAS / PAUSE_GAS before the call and reverts otherwise): +25 %. */
const GAS_MARGIN_PCT = 25n;

function toEnclaveView(signer: Address, e: any, active: boolean, head?: bigint): EnclaveView {
  return {
    signer, x25519: e.x25519, operator: e.operator, productId: BigInt(e.productId), workloadId: e.workloadId, fmspc: e.fmspc,
    tcbStatus: Number(e.tcbStatus), quoteHash: e.quoteHash, anchorBlock: BigInt(e.anchorBlock), registeredAt: BigInt(e.registeredAt),
    expiresAt: BigInt(e.expiresAt), fromBlock: BigInt(e.fromBlock ?? 0n), untilBlock: BigInt(e.untilBlock ?? 0n), active, head,
  };
}

function toBountyRow(id: bigint, b: any): BountyRow {
  return {
    id, protocol: b.protocol, productId: BigInt(b.productId), predicateHash: b.predicateHash, protocolX25519: b.protocolX25519,
    singleCap: BigInt(b.singleCap), k: Number(b.k), balance: BigInt(b.balance), deadline: BigInt(b.deadline), paused: !!b.paused,
    targetToPause: b.targetToPause, paidAmount: BigInt(b.paidAmount ?? 0n), lastPaidBlock: BigInt(b.lastPaidBlock ?? 0n),
    pausedFromBlock: BigInt(b.pausedFromBlock ?? 0n),
  };
}

export class ArcClient {
  readonly pub: PublicClient;
  readonly wallet?: WalletClient;
  readonly account?: Account;
  readonly d: Deployment;

  constructor(o: ArcClientOptions) {
    this.pub = o.publicClient;
    this.wallet = o.walletClient;
    this.account = o.account ?? o.walletClient?.account;
    this.d = o.deployment ?? testnet;
  }

  private signer(): Account {
    if (!this.account || !this.wallet) throw new Error("this action needs a walletClient and an account");
    return this.account;
  }

  private signTypedData(): SignTypedDataFn {
    const w = this.wallet, a = this.signer();
    return (args) => w!.signTypedData({ account: a, ...(args as any) });
  }

  /** Simulates (reverts decoded with EVERY error of the network), then sends. `margin`: estimated gas + 25 %. */
  private async send(address: Address, abi: readonly unknown[], functionName: string, args: unknown[], margin = false): Promise<{ tx: Hex; result: unknown }> {
    const account = this.signer();
    const fullAbi = [...abi, ...arcErrorsAbi] as any;
    const { request, result } = await this.pub.simulateContract({ account, address, abi: fullAbi, functionName, args } as any);
    if (margin) {
      const est = await this.pub.estimateContractGas({ account, address, abi: fullAbi, functionName, args } as any);
      (request as any).gas = est + (est * GAS_MARGIN_PCT) / 100n;
    }
    return { tx: await this.wallet!.writeContract(request as any), result };
  }
  private async write(address: Address, abi: readonly unknown[], functionName: string, args: unknown[], margin = false): Promise<Hex> {
    return (await this.send(address, abi, functionName, args, margin)).tx;
  }

  // ---------- lectures ----------

  usdcBalance(a: Address) { return this.pub.readContract({ address: this.d.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>; }
  bondOf(op: Address) { return this.pub.readContract({ address: this.d.operatorBond, abi: operatorBondAbi, functionName: "bondOf", args: [op] }) as Promise<bigint>; }
  availableBond(op: Address) { return this.pub.readContract({ address: this.d.operatorBond, abi: operatorBondAbi, functionName: "availableBond", args: [op] }) as Promise<bigint>; }
  /** Unreserved bond (each registered enclave key reserves its product's minimum bond). */
  freeBond(op: Address) { return this.pub.readContract({ address: this.d.operatorBond, abi: operatorBondAbi, functionName: "freeBond", args: [op] }) as Promise<bigint>; }

  async productCount(): Promise<bigint> {
    return this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "productCount" }) as Promise<bigint>;
  }

  async getProduct(id: bigint): Promise<ProductView> {
    const p = await this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [id] }) as any;
    const manifestURI = await this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "manifestURI", args: [id] }) as string;
    return {
      id, author: p.author, manifestHash: p.manifestHash, deterministic: p.deterministic, price: p.price,
      bpsOperator: Number(p.bpsOperator), bpsAuthor: Number(p.bpsAuthor), bpsNetwork: Number(p.bpsNetwork),
      minBond: p.minBond, exposureCap: p.exposureCap, settlement: p.settlement, param: p.param,
      version: p.version, activatesAt: p.activatesAt, state: STATES[p.state] ?? "None", manifestURI,
      unitTokens: Number(p.unitTokens ?? 1), outWeight: Number(p.outWeight ?? 1),
    };
  }

  async listProducts(): Promise<ProductView[]> {
    const n = Number(await this.productCount());
    const out: ProductView[] = [];
    for (let i = 1; i <= n; i++) out.push(await this.getProduct(BigInt(i)));
    return out;
  }

  /** The enclave registered for this signer (raw struct: zero signer if none). */
  getEnclave(signer: Address) { return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "enclaveOf", args: [signer] }) as Promise<any>; }

  /** Operator for which this signer is active on this product at this block (default: the head); 0x0… otherwise. */
  async activeOperatorAt(signer: Address, productId: bigint, blockNumber?: bigint): Promise<Address> {
    const b = blockNumber ?? (await this.pub.getBlockNumber());
    return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, productId, b] }) as Promise<Address>;
  }

  /** Last block at which a receipt of this enclave can still be settled (end of window + grace; 0 if none). */
  settleableUntilBlock(signer: Address) { return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "settleableUntilBlock", args: [signer] }) as Promise<bigint>; }

  /** An enclave by its signer, with its state at the head block (null if unknown). */
  async enclaveView(signer: Address): Promise<EnclaveView | null> {
    const head = await this.pub.getBlockNumber();
    const e = await this.getEnclave(signer);
    if (!e || e.signer === zeroAddress) return null;
    const op = await this.activeOperatorAt(signer, BigInt(e.productId), head);
    return toEnclaveView(signer, e, op !== zeroAddress, head);
  }

  /** A session, typed (zero owner if unknown). */
  getSession(id: bigint): Promise<SessionInfo> { return readSession(this.pub, this.d, id); }

  async getBounty(id: bigint): Promise<BountyRow> {
    const b = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "getBounty", args: [id] });
    return toBountyRow(id, b);
  }

  /** Tiers of a bounty (thresholds and amounts). */
  async bountyTiers(id: bigint): Promise<Array<{ minLoss: bigint; amount: bigint }>> {
    const out: Array<{ minLoss: bigint; amount: bigint }> = [];
    for (let i = 0n; i < 16n; i++) {
      let minLoss: bigint;
      try {
        minLoss = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "tierMinLoss", args: [id, i] }) as bigint;
      } catch (e) {
        if (isRevert(e)) break; // end of the array
        throw e; // network error: tiers are never silently truncated
      }
      const amount = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "tierAmount", args: [id, i] }) as bigint;
      out.push({ minLoss, amount });
    }
    return out;
  }

  /** The payment reserved for (bounty, fingerprint), waiting for deliver. */
  async pendingOf(bountyId: bigint, fingerprint: Hex): Promise<PendingPayout> {
    const p = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "pendingOf", args: [bountyId, fingerprint] }) as any;
    return {
      payee: p.payee, tier: Number(p.tier), acceptedAt: BigInt(p.acceptedAt), cPHash: p.cPHash, claimDigest: p.claimDigest,
      amount: BigInt(p.amount), netFee: BigInt(p.netFee), opFee: BigInt(p.opFee), ops: [...p.ops],
    };
  }

  /** Robust event reading: through Blockscout (indexes the whole history, instant) when configured,
   *  otherwise getLogs in chunks on the RPC (capped). Returns the raw topics, newest first. */
  private async _rawLogs(address: Address, topic0: Hex, topicFilters?: Record<number, Hex>): Promise<Array<{ topics: Hex[] }>> {
    const match = (topics: Hex[]) =>
      topics[0]?.toLowerCase() === topic0.toLowerCase() &&
      (!topicFilters || Object.entries(topicFilters).every(([i, v]) => topics[Number(i)]?.toLowerCase() === v.toLowerCase()));

    const bs = this.d.blockscoutUrl;
    if (bs) {
      try {
        const out: Array<{ topics: Hex[] }> = [];
        let query = "";
        for (let guard = 0; guard < 25; guard++) {
          const res = await fetch(`${bs.replace(/\/$/, "")}/api/v2/addresses/${address}/logs${query}`, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) throw new Error(`blockscout ${res.status}`);
          const j = await res.json() as { items?: Array<{ topics?: (Hex | null)[] }>; next_page_params?: Record<string, unknown> | null };
          for (const it of j.items ?? []) {
            const topics = (it.topics ?? []).filter(Boolean) as Hex[];
            if (match(topics)) out.push({ topics });
          }
          if (!j.next_page_params) break;
          query = "?" + Object.entries(j.next_page_params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
        }
        return out; // Blockscout already returns newest first
      } catch { /* fall back to the RPC */ }
    }

    // RPC fallback: eth_getLogs in chunks of 5,000 blocks, filtered by topic0 on the node. A failed chunk throws
    // (after the transport's retries): a list is never silently truncated.
    const head = await this.pub.getBlockNumber();
    const chunk = 5_000n;
    const raw: Array<{ topics: Hex[] }> = [];
    const hex = (n: bigint) => `0x${n.toString(16)}`;
    for (let from = this.d.deployBlock; from <= head; from += chunk) {
      const to = from + chunk - 1n < head ? from + chunk - 1n : head;
      const logs = (await (this.pub as any).request({
        method: "eth_getLogs", params: [{ address, topics: [topic0], fromBlock: hex(from), toBlock: hex(to) }],
      })) as Array<{ topics: Hex[] }>;
      for (const log of logs) if (match(log.topics)) raw.push({ topics: log.topics });
    }
    return raw.reverse(); // newest first
  }

  private static topicAddr(t?: Hex): Address { return getAddress(("0x" + (t ?? "0x").slice(-40)).toLowerCase()); }

  /** The "hive": every registered enclave, with its state at the head block (one row per signer). */
  async listEnclaves(): Promise<EnclaveView[]> {
    const topic0 = keccak256(toBytes("EnclaveRegistered(address,uint256,address,bytes32,uint64)"));
    const logs = await this._rawLogs(this.d.enclaveRegistry, topic0);
    const head = await this.pub.getBlockNumber();
    const seen = new Set<string>();
    const out: EnclaveView[] = [];
    for (const log of logs) {
      const signer = ArcClient.topicAddr(log.topics[1]);
      if (!signer || seen.has(signer.toLowerCase())) continue;
      seen.add(signer.toLowerCase());
      const e = await this.getEnclave(signer);
      if (!e || e.operator === zeroAddress) continue;
      const op = await this.activeOperatorAt(signer, BigInt(e.productId), head);
      out.push(toEnclaveView(signer, e, op !== zeroAddress, head));
    }
    return out;
  }

  async listBounties(): Promise<BountyRow[]> {
    const topic0 = keccak256(toBytes("BountyCreated(uint256,address,uint256,uint256)"));
    const logs = await this._rawLogs(this.d.sealedBounty, topic0);
    const out: BountyRow[] = [];
    const seen = new Set<string>();
    for (const log of logs) {
      const id = BigInt(log.topics[1] ?? "0x0");
      if (seen.has(id.toString())) continue;
      seen.add(id.toString());
      out.push(await this.getBounty(id));
    }
    return out;
  }

  async listMySessions(owner: Address): Promise<SessionInfo[]> {
    const topic0 = keccak256(toBytes("SessionOpened(uint256,address,uint256,uint256)"));
    const ownerTopic = ("0x" + "0".repeat(24) + owner.slice(2).toLowerCase()) as Hex;
    const logs = await this._rawLogs(this.d.sessionPay, topic0, { 2: ownerTopic });
    const out: SessionInfo[] = [];
    const seen = new Set<string>();
    for (const log of logs) {
      const id = BigInt(log.topics[1] ?? "0x0");
      if (seen.has(id.toString())) continue;
      seen.add(id.toString());
      out.push(await this.getSession(id));
    }
    return out;
  }

  /** An enclave's keys checked against the chain (see enclave-keys.ts): do it BEFORE encrypting anything to it. */
  verifyEnclaveKeys(enclaveUrl: string, productId: bigint, o: Omit<VerifyEnclaveKeysOptions, "publicClient" | "deployment"> = {}): Promise<VerifiedEnclaveKeys> {
    return verifyEnclaveKeys(enclaveUrl, productId, { ...o, publicClient: this.pub, deployment: this.d });
  }

  /** Verifies a receipt exactly as SessionPay.settle does (reads only). */
  verifyReceipt(receipt: Receipt, signature: Hex): Promise<ReceiptVerification> {
    return verifyReceiptOnChain(this.pub, receipt, signature, this.d);
  }

  // ---------- operator ----------

  async bond(amount: bigint, mode: "allowance" | "auth" = "allowance"): Promise<Hex> {
    if (mode === "allowance") {
      await this.write(this.d.usdc, usdcAbi, "approve", [this.d.operatorBond, amount]);
      return this.write(this.d.operatorBond, operatorBondAbi, "bondFrom", [amount]);
    }
    const auth = await this.buildAuth(this.d.operatorBond, amount);
    return this.write(this.d.operatorBond, operatorBondAbi, "bond", [amount, auth]);
  }
  requestUnbond(amount: bigint) { return this.write(this.d.operatorBond, operatorBondAbi, "requestUnbond", [amount]); }
  withdrawBond() { return this.write(this.d.operatorBond, operatorBondAbi, "withdraw", []); }

  /**
   * Registers (or renews) an enclave: POST /attest (a quote bound to the operator, the product and a recent block), an
   * OFF-chain check of the quote (a real quote, no DEBUG, SEPT_VE_DISABLE when required, an image the product allows,
   * the REPORTDATA binding), then registerEnclave: the chain verifies Intel's signature with DCAP. A foreseeable revert
   * is raised BEFORE anything is sent.
   */
  async registerEnclave(productId: bigint, enclaveUrl: string): Promise<{ tx: Hex; signer: Address; x25519: Hex; workloadId: Hex; admittedBy: "image" | "workload" }> {
    const operator = this.signer().address;
    const head = await this.pub.getBlockNumber();
    const anchorR = head - 10n;
    const res = await fetch(`${enclaveUrl.replace(/\/$/, "")}/attest`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operator, anchorR: anchorR.toString() }),
      signal: AbortSignal.timeout(60_000),
    });
    const a = await res.json().catch(() => ({})) as { quote?: Hex; eventLog?: Hex; signer?: Address; x25519?: Hex; mock?: boolean; error?: string };
    if (!res.ok || a.error || !a.quote || !a.signer || !a.x25519) throw new Error(`/attest: HTTP ${res.status} ${a.error ?? "incomplete response"}`);
    if (a.mock) throw new Error("simulated quote: this machine has no Intel TDX, so the registry (Intel DCAP verification) would refuse it");
    const m = parseTdxQuote(a.quote);
    if (m.debug) throw new Error("enclave in DEBUG mode: the registry would refuse it (DebugEnclave)");
    const needSeptVe = await this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "requireSeptVeDisable" }) as boolean;
    if (needSeptVe && !m.septVeDisabled) throw new Error("SEPT_VE_DISABLE missing from the quote: the registry would refuse it (SeptVeNotDisabled)");
    // IMAGE id (RTMR3 event log replayed by the registry) when the product allows it; otherwise the full workload id
    const plan = await planRegistrationLog(this.pub, { registry: this.d.enclaveRegistry, productRegistry: this.d.productRegistry, productId, quote: a.quote, rawEventLog: a.eventLog });
    if (!plan.admittedBy) {
      const ask = plan.v21 && plan.imageId ? `image id ${plan.imageId} (stable across restarts)` : `workloadId ${plan.workloadId}`;
      throw new Error(`image not allowed for product #${productId}: ${ask}${plan.note ? `; ${plan.note}` : ""} (the product's author must propose it, then apply it: proposeWorkload → applyWorkload)`);
    }
    const rd0 = expectedReportData0({ chainId: this.d.chainId, registry: this.d.enclaveRegistry, productId, operator, signer: a.signer, x25519: a.x25519 });
    if (m.reportData.slice(0, 66).toLowerCase() !== rd0.toLowerCase()) {
      throw new Error("REPORTDATA does not bind (chain, registry, product, operator, keys): the enclave serves another product or another registry (ReportDataMismatch)");
    }
    const tx = await this.write(this.d.enclaveRegistry, enclaveRegistryAbi, "registerEnclave", [productId, a.quote, anchorR, a.signer, a.x25519, plan.eventLog], true);
    return { tx, signer: a.signer, x25519: a.x25519, workloadId: plan.admittedBy === "image" ? plan.imageId! : plan.workloadId, admittedBy: plan.admittedBy };
  }
  /** Removes one of YOUR enclaves: nothing anchors after it, the bond it reserved is released (receipts anchored
   *  before stay settleable during the grace period). */
  retireEnclave(signer: Address) { return this.write(this.d.enclaveRegistry, enclaveRegistryAbi, "retire", [signer]); }

  // ---------- produit ----------

  async proposeProduct(q: {
    manifestHash: Hex; manifestURI: string; workloadIds: Hex[]; deterministic: boolean; price: bigint;
    bpsOperator: number; bpsAuthor: number; bpsNetwork: number; minBond: bigint; exposureCap: bigint;
    settlement: Address; param: Hex; advisoryIds: string[];
    /** Billed unit (default 1 token) and weight of an output token (default 1). */
    unitTokens?: number; outWeight?: number;
  }): Promise<{ tx: Hex; productId: bigint }> {
    const params = { ...q, unitTokens: q.unitTokens ?? 1, outWeight: q.outWeight ?? 1 };
    const { tx, result } = await this.send(this.d.productRegistry, productRegistryAbi, "propose", [params]);
    return { tx, productId: result as bigint };
  }
  activateProduct(id: bigint) { return this.write(this.d.productRegistry, productRegistryAbi, "activate", [id]); }
  /** Allowing an image takes two steps (the registry's timelock). */
  proposeWorkload(productId: bigint, workloadId: Hex) { return this.write(this.d.productRegistry, productRegistryAbi, "proposeWorkload", [productId, workloadId]); }
  applyWorkload(productId: bigint, workloadId: Hex) { return this.write(this.d.productRegistry, productRegistryAbi, "applyWorkload", [productId, workloadId]); }

  // ---------- session (inference) ----------

  /**
   * Opens a session LOCKED to one enclave: only its receipts will be paid from it.
   * - `enclaveUrl` (recommended): its keys are verified on-chain (verifyEnclaveKeys), and the enclave and the operator
   *   come from them; a given `operator` must be the same;
   * - otherwise `enclave` (its signer): its active operator is read on-chain;
   * - compatibility: `operator` alone, if it has exactly ONE active enclave on this product.
   * The expiry (default 24 h) must be within [10 min, 30 days] (SessionPay.MIN_SESSION / MAX_SESSION).
   */
  async openSession(params: {
    productId: bigint; deposit: bigint; cap?: bigint; expiresInSeconds?: number;
    enclaveUrl?: string; enclave?: Address; operator?: Address;
  }): Promise<{ tx: Hex; sessionId: bigint; sessionKey: SessionKey; enclave: Address; operator: Address; expiresAt: bigint; keys?: VerifiedEnclaveKeys }> {
    const life = params.expiresInSeconds ?? 86_400;
    if (life < SESSION_MIN_SECONDS + SESSION_EXPIRY_MARGIN_SECONDS || life > SESSION_MAX_SECONDS - SESSION_EXPIRY_MARGIN_SECONDS) {
      throw new Error(`session expiry: between ${(SESSION_MIN_SECONDS + SESSION_EXPIRY_MARGIN_SECONDS) / 60} min and ${Math.floor((SESSION_MAX_SECONDS - SESSION_EXPIRY_MARGIN_SECONDS) / 86_400)} days (SessionPay refuses otherwise: BadExpiry)`);
    }
    let keys: VerifiedEnclaveKeys | undefined;
    let enclave: Address;
    let operator: Address;
    if (params.enclaveUrl) {
      keys = await this.verifyEnclaveKeys(params.enclaveUrl, params.productId);
      enclave = keys.signer;
      operator = keys.operator;
      if (params.enclave && params.enclave.toLowerCase() !== enclave.toLowerCase()) {
        throw new Error(`${params.enclaveUrl} serves enclave ${enclave}, not ${params.enclave}`);
      }
    } else if (params.enclave) {
      enclave = params.enclave;
      operator = await this.activeOperatorAt(enclave, params.productId);
      if (operator === zeroAddress) throw new Error(`enclave ${enclave} is not active for product #${params.productId} (InactiveEnclave)`);
    } else if (params.operator) {
      // compatibility (callers that give only the operator): its ONLY active enclave on this product, read from the
      // registry. The inference client checks the enclave's keys against the session before sending in any case.
      const mine = (await this.listEnclaves()).filter((e) => e.active && e.productId === params.productId && e.operator.toLowerCase() === params.operator!.toLowerCase());
      if (mine.length !== 1) {
        throw new Error(mine.length
          ? `operator ${params.operator} has ${mine.length} active enclaves on product #${params.productId}: give enclaveUrl (or enclave) to choose the one that will serve the session`
          : `operator ${params.operator} has no active enclave on product #${params.productId}`);
      }
      enclave = mine[0]!.signer;
      operator = mine[0]!.operator;
    } else {
      throw new Error("a session is locked to one enclave: give enclaveUrl (keys verified on-chain) or enclave (its signer)");
    }
    if (params.operator && params.operator.toLowerCase() !== operator.toLowerCase()) {
      throw new Error(`enclave ${enclave} is active for operator ${operator}, not for ${params.operator} (WrongOperator)`);
    }
    const now = (await this.pub.getBlock()).timestamp;
    const expiresAt = now + BigInt(life);
    const sessionKey = generateSessionKey();
    const auth = await this.buildAuth(this.d.sessionPay, params.deposit);
    const q = { productId: params.productId, operator, sessionKey: sessionKey.address, expiresAt, deposit: params.deposit, cap: params.cap ?? 0n, auth, enclave };
    const { tx, result } = await this.send(this.d.sessionPay, sessionPayAbi, "openSession", [q]);
    return { tx, sessionId: result as bigint, sessionKey, enclave, operator, expiresAt, keys };
  }
  async topUp(sessionId: bigint, amount: bigint): Promise<Hex> {
    const auth = await this.buildAuth(this.d.sessionPay, amount);
    return this.write(this.d.sessionPay, sessionPayAbi, "topUp", [sessionId, amount, auth]);
  }
  rotateKey(sessionId: bigint, newKey: Address) { return this.write(this.d.sessionPay, sessionPayAbi, "rotateKey", [sessionId, newKey]); }
  /** Settles a receipt (permissionless: the payment goes to the session's operator). */
  settle(receipt: Receipt, signature: Hex) { return this.write(this.d.sessionPay, sessionPayAbi, "settle", [receipt, signature]); }
  /** Closes a session (owner): refunds the rest, writes the ERC-8004 verdict (verdict gas included). */
  closeSession(sessionId: bigint) { return this.write(this.d.sessionPay, sessionPayAbi, "closeSession", [sessionId], true); }

  /** When the session can be closed: at expiry + SETTLE_GRACE, or earlier if its enclave can no longer settle
   *  anything (block > settleableUntilBlock). */
  async sessionClosability(sessionId: bigint): Promise<{ closableNow: boolean; atTime: bigint; afterBlock: bigint; head: bigint; now: bigint }> {
    const s = await this.getSession(sessionId);
    if (s.owner === zeroAddress) throw new Error(`session #${sessionId} inconnue`);
    const grace = await this.pub.readContract({ address: this.d.sessionPay, abi: sessionPayAbi, functionName: "SETTLE_GRACE" }) as bigint;
    const blk = await this.pub.getBlock();
    const afterBlock = await this.settleableUntilBlock(s.enclave);
    const atTime = s.expiresAt + grace;
    return { closableNow: !s.closed && (blk.timestamp >= atTime || blk.number > afterBlock), atTime, afterBlock, head: blk.number, now: blk.timestamp };
  }

  // ---------- prime (protocole) ----------

  async createBounty(q: {
    productId: bigint; predicateHash: Hex; protocolX25519: Hex; tierMinLoss: bigint[]; tierAmount: bigint[];
    singleCap: bigint; k: number; targetToPause: Address; deadline: bigint; funding: bigint;
  }): Promise<{ tx: Hex; bountyId: bigint }> {
    const n = q.tierMinLoss.length;
    if (n === 0 || n !== q.tierAmount.length || q.tierAmount[0] === 0n) throw new Error("tiers: non-empty lists of the same length, first amount > 0 (BadTiers)");
    for (let i = 1; i < n; i++) {
      if (q.tierMinLoss[i]! <= q.tierMinLoss[i - 1]! || q.tierAmount[i]! <= q.tierAmount[i - 1]!) {
        throw new Error("paliers : seuils ET montants strictement croissants (BadTiers)");
      }
    }
    if (!Number.isInteger(q.k) || q.k < 1 || q.k > BOUNTY_MAX_SIGS) throw new Error(`k: between 1 and ${BOUNTY_MAX_SIGS} (BadK)`);
    const auth = await this.buildAuth(this.d.sealedBounty, q.funding);
    const { tx, result } = await this.send(this.d.sealedBounty, sealedBountyAbi, "createBounty", [{ ...q, auth }]);
    return { tx, bountyId: result as bigint };
  }
  async fundBounty(bountyId: bigint, amount: bigint): Promise<Hex> {
    const auth = await this.buildAuth(this.d.sealedBounty, amount);
    return this.write(this.d.sealedBounty, sealedBountyAbi, "fund", [bountyId, amount, auth]);
  }
  withdrawRemaining(bountyId: bigint) { return this.write(this.d.sealedBounty, sealedBountyAbi, "withdrawRemaining", [bountyId]); }
  /** The protocol re-arms its bounty after a fix (the tiers become payable again, anchored after this block). */
  reopenBounty(bountyId: bigint) { return this.write(this.d.sealedBounty, sealedBountyAbi, "reopen", [bountyId]); }
  setBountyPaused(bountyId: bigint, paused: boolean) { return this.write(this.d.sealedBounty, sealedBountyAbi, "setPaused", [bountyId, paused]); }

  // ---------- prime (chasseur) ----------

  /**
   * Prepares an exploit submission: reads the bounty ON-CHAIN (product, the protocol's X25519 key), verifies the
   * enclave's keys on-chain for THIS product (verifyEnclaveKeys), then encrypts (cP to the protocol, cE to the enclave).
   */
  async prepareExploit(a: {
    bountyId: bigint; enclaveUrl: string; exploit: ExploitInput; payee?: Address; r?: Uint8Array; blockN?: bigint; deadline?: bigint;
  }): Promise<SealedExploit> {
    const b = await this.getBounty(a.bountyId);
    if (b.protocol === zeroAddress) throw new Error(`prime #${a.bountyId} inexistante`);
    const enclave = await this.verifyEnclaveKeys(a.enclaveUrl, b.productId);
    const payee = a.payee ?? this.account?.address;
    if (!payee) throw new Error("payee requis (ou un compte)");
    return sealExploitForEnclave({ bountyId: a.bountyId, payee, exploit: a.exploit, protocolX25519: b.protocolX25519, enclave, r: a.r, blockN: a.blockN, deadline: a.deadline });
  }
  /** Sends the encrypted exploit to the enclave and checks the signed claim it returns. */
  proveExploit(sealed: SealedExploit): Promise<ProvenClaim> {
    return submitSealedExploit(sealed, { sealedBounty: this.d.sealedBounty, chainId: this.d.chainId });
  }
  /** The recommended path: verifies the claim and RESERVES the payment; cP is not in this transaction. */
  acceptClaim(claim: Claim, signatures: Hex[]) { return this.write(this.d.sealedBounty, sealedBountyAbi, "acceptClaim", [claim, signatures], true); }
  /** Delivers cP (checked against the reserved hash) and pays the hunter, the network and the operators. Open to all. */
  deliver(bountyId: bigint, fingerprint: Hex, cP: Hex) { return this.write(this.d.sealedBounty, sealedBountyAbi, "deliver", [bountyId, fingerprint, cP], true); }
  /** acceptClaim, wait for its confirmation, then deliver: the two transactions of the payment. */
  async acceptAndDeliver(claim: Claim, signatures: Hex[], cP: Hex): Promise<{ acceptTx: Hex; deliverTx: Hex }> {
    const acceptTx = await this.acceptClaim(claim, signatures);
    const r = await this.pub.waitForTransactionReceipt({ hash: acceptTx, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`acceptClaim reverted on-chain (${acceptTx}): nothing is reserved, cP was not published`);
    const deliverTx = await this.deliver(claim.bountyId, claim.fingerprint, cP);
    return { acceptTx, deliverTx };
  }
  /** One-transaction path (claim). Not recommended: if it fails, cP stays readable in its calldata. */
  claimBounty(claim: Claim, signatures: Hex[], cP: Hex): Promise<Hex> {
    return this.write(this.d.sealedBounty, sealedBountyAbi, "claim", [claim, signatures, cP], true);
  }
  /** A payment reserved and never delivered returns to the pool after DELIVERY_WINDOW (open to all). */
  cancelUndelivered(bountyId: bigint, fingerprint: Hex) { return this.write(this.d.sealedBounty, sealedBountyAbi, "cancelUndelivered", [bountyId, fingerprint]); }
  /** Withdraws a payment whose transfer had been refused (credit). */
  withdrawCredit() { return this.write(this.d.sealedBounty, sealedBountyAbi, "withdrawCredit", []); }

  // ---------- helpers ----------

  async buildAuth(to: Address, value: bigint): Promise<Auth> {
    return buildReceiveAuthorization(this.signTypedData(), { usdc: this.d.usdc, chainId: this.d.chainId ?? ARC_TESTNET_ID, from: this.signer().address, to, value });
  }
}

/** True if the viem error is a contract revert (not a network error). */
export function isRevert(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x?.name === "ContractFunctionRevertedError" || x?.name === "ExecutionRevertedError") return true;
    if (typeof x?.details === "string" && /revert/i.test(x.details)) return true;
  }
  return false;
}

export function createArcClient(o: ArcClientOptions): ArcClient {
  return new ArcClient(o);
}
