/** client.ts — client principal (pile v2) : lectures + actions (opérateur, produit, session, prime).
 *  v2 : une session est verrouillée sur UNE enclave dont les clés sont vérifiées on-chain ; la Prime scellée se paie en
 *  deux temps (acceptClaim réserve, deliver livre cP et paie) ; l'inscription passe par le vrai DCAP (≈ 5,7 M gas) et
 *  le quote est contrôlé hors chaîne avant l'envoi ; les appels qui écrivent un verdict ERC-8004 partent avec une
 *  marge de gaz (le contrat exige VERDICT_GAS avant l'écriture). Les refus sont décodés en français (errors.ts). */
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
  /** v2 : unité facturée (jetons-équivalent-entrée par unité) et poids d'un jeton de sortie, verrouillés à l'ouverture. */
  unitTokens: number; outWeight: number;
}

/** Une enclave du registre v2 (enclaveOf), avec son état au bloc de tête. */
export interface EnclaveView {
  signer: Address; x25519: Hex; operator: Address; productId: bigint; workloadId: Hex; fmspc: Hex;
  tcbStatus: number; quoteHash: Hex; anchorBlock: bigint; registeredAt: bigint;
  /** Horodatage INDICATIF (la règle est en blocs : untilBlock). */
  expiresAt: bigint;
  /** Fenêtre de validité en cours, en blocs (les reçus ancrés dedans se règlent jusqu'à untilBlock + grâce). */
  fromBlock: bigint; untilBlock: bigint;
  /** Active pour son produit au bloc de tête (activeOperatorAt ≠ 0). */
  active: boolean;
  /** Bloc de tête de la lecture. */
  head?: bigint;
}

export interface BountyRow {
  id: bigint; protocol: Address; productId: bigint; predicateHash: Hex; protocolX25519: Hex; singleCap: bigint; k: number;
  balance: bigint; deadline: bigint; paused: boolean; targetToPause: Address;
  /** v2 : palier le plus haut déjà accordé depuis le dernier armement (un exploit n'est payé qu'une fois par palier). */
  paidAmount: bigint;
  /** v2 : bloc du dernier paiement ou réarmement ; une réclamation doit être ancrée APRÈS. */
  lastPaidBlock: bigint;
  /** v2 : la pause n'atteint que les réclamations ancrées à partir de ce bloc. */
  pausedFromBlock: bigint;
}

/** Paiement réservé par acceptClaim, en attente de deliver (payee nul si aucun). */
export interface PendingPayout {
  payee: Address; tier: number; acceptedAt: bigint; cPHash: Hex; claimDigest: Hex; amount: bigint; netFee: bigint; opFee: bigint; ops: Address[];
}

/** Gaz en plus de l'estimation pour les appels qui écrivent un verdict ERC-8004 ou mettent une cible en pause (le
 *  contrat exige VERDICT_GAS / PAUSE_GAS avant l'appel et refuse sinon) : +25 %. */
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
    if (!this.account || !this.wallet) throw new Error("walletClient/account requis pour cette action");
    return this.account;
  }

  private signTypedData(): SignTypedDataFn {
    const w = this.wallet, a = this.signer();
    return (args) => w!.signTypedData({ account: a, ...(args as any) });
  }

  /** Simule (refus décodés avec TOUTES les erreurs du réseau), puis envoie. `margin` : gaz estimé + 25 %. */
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
  /** v2 : caution non réservée (chaque clé d'enclave inscrite réserve la caution minimale de son produit). */
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

  /** L'enclave inscrite pour ce signataire (struct v2 brute : signer nul si aucune). */
  getEnclave(signer: Address) { return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "enclaveOf", args: [signer] }) as Promise<any>; }

  /** Opérateur pour lequel ce signataire est actif sur ce produit à ce bloc (défaut : la tête) ; 0x0… sinon. */
  async activeOperatorAt(signer: Address, productId: bigint, blockNumber?: bigint): Promise<Address> {
    const b = blockNumber ?? (await this.pub.getBlockNumber());
    return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, productId, b] }) as Promise<Address>;
  }

  /** Dernier bloc auquel un reçu de cette enclave peut encore être réglé (fin de fenêtre + grâce ; 0 si aucun). */
  settleableUntilBlock(signer: Address) { return this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "settleableUntilBlock", args: [signer] }) as Promise<bigint>; }

  /** Une enclave par son signataire, avec son état au bloc de tête (null si inconnue). */
  async enclaveView(signer: Address): Promise<EnclaveView | null> {
    const head = await this.pub.getBlockNumber();
    const e = await this.getEnclave(signer);
    if (!e || e.signer === zeroAddress) return null;
    const op = await this.activeOperatorAt(signer, BigInt(e.productId), head);
    return toEnclaveView(signer, e, op !== zeroAddress, head);
  }

  /** Une session v2, typée (owner nul si inconnue). */
  getSession(id: bigint): Promise<SessionInfo> { return readSession(this.pub, this.d, id); }

  async getBounty(id: bigint): Promise<BountyRow> {
    const b = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "getBounty", args: [id] });
    return toBountyRow(id, b);
  }

  /** Paliers d'une prime (seuils et montants). */
  async bountyTiers(id: bigint): Promise<Array<{ minLoss: bigint; amount: bigint }>> {
    const out: Array<{ minLoss: bigint; amount: bigint }> = [];
    for (let i = 0n; i < 16n; i++) {
      let minLoss: bigint;
      try {
        minLoss = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "tierMinLoss", args: [id, i] }) as bigint;
      } catch (e) {
        if (isRevert(e)) break; // fin du tableau
        throw e; // erreur réseau : jamais de paliers tronqués en silence
      }
      const amount = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "tierAmount", args: [id, i] }) as bigint;
      out.push({ minLoss, amount });
    }
    return out;
  }

  /** v2 : le paiement réservé pour (prime, empreinte), en attente de deliver. */
  async pendingOf(bountyId: bigint, fingerprint: Hex): Promise<PendingPayout> {
    const p = await this.pub.readContract({ address: this.d.sealedBounty, abi: sealedBountyAbi, functionName: "pendingOf", args: [bountyId, fingerprint] }) as any;
    return {
      payee: p.payee, tier: Number(p.tier), acceptedAt: BigInt(p.acceptedAt), cPHash: p.cPHash, claimDigest: p.claimDigest,
      amount: BigInt(p.amount), netFee: BigInt(p.netFee), opFee: BigInt(p.opFee), ops: [...p.ops],
    };
  }

  /** Lecture d'events robuste : via Blockscout (indexe tout l'historique, instantané) si configuré,
   *  sinon par tranches getLogs sur le RPC (plafonné). Renvoie les topics bruts, du plus récent au plus ancien. */
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
        return out; // Blockscout renvoie déjà du plus récent au plus ancien
      } catch { /* bascule sur le RPC */ }
    }

    // Secours RPC : eth_getLogs par tranches de 5 000 blocs, filtrées par topic0 côté nœud. Une tranche ratée lève
    // (après les réessais du transport) : jamais de liste tronquée en silence.
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
    return raw.reverse(); // du plus récent au plus ancien
  }

  private static topicAddr(t?: Hex): Address { return getAddress(("0x" + (t ?? "0x").slice(-40)).toLowerCase()); }

  /** La « hive » : toutes les enclaves inscrites, avec leur état au bloc de tête (une ligne par signataire). */
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

  /** Clés d'une enclave confrontées à la chaîne (voir enclave-keys.ts) : à faire AVANT tout chiffrement vers elle. */
  verifyEnclaveKeys(enclaveUrl: string, productId: bigint, o: Omit<VerifyEnclaveKeysOptions, "publicClient" | "deployment"> = {}): Promise<VerifiedEnclaveKeys> {
    return verifyEnclaveKeys(enclaveUrl, productId, { ...o, publicClient: this.pub, deployment: this.d });
  }

  /** Vérifie un reçu exactement comme SessionPay.settle (lectures seulement). */
  verifyReceipt(receipt: Receipt, signature: Hex): Promise<ReceiptVerification> {
    return verifyReceiptOnChain(this.pub, receipt, signature, this.d);
  }

  // ---------- opérateur ----------

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
   * Inscrit (ou renouvelle) une enclave : POST /attest (quote lié à l'opérateur, au produit et à un bloc récent), contrôle
   * du quote HORS chaîne (quote réel, pas de DEBUG, SEPT_VE_DISABLE si exigé, image autorisée par le produit, liaison
   * REPORTDATA), puis registerEnclave — la chaîne vérifie la signature d'Intel par DCAP (≈ 5,7 M gas). Un refus prévisible
   * est levé AVANT d'envoyer quoi que ce soit.
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
    if (!res.ok || a.error || !a.quote || !a.signer || !a.x25519) throw new Error(`/attest : HTTP ${res.status} ${a.error ?? "réponse incomplète"}`);
    if (a.mock) throw new Error("quote simulé : cette machine n'a pas Intel TDX ; le registre (vérification DCAP d'Intel) le refuserait");
    const m = parseTdxQuote(a.quote);
    if (m.debug) throw new Error("enclave en mode DEBUG : le registre la refuserait (DebugEnclave)");
    const needSeptVe = await this.pub.readContract({ address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "requireSeptVeDisable" }) as boolean;
    if (needSeptVe && !m.septVeDisabled) throw new Error("SEPT_VE_DISABLE absent du quote : le registre le refuserait (SeptVeNotDisabled)");
    // v2.1 : empreinte d'IMAGE (journal RTMR3 rejoué par le registre) si le produit l'autorise ; sinon empreinte complète
    const plan = await planRegistrationLog(this.pub, { registry: this.d.enclaveRegistry, productRegistry: this.d.productRegistry, productId, quote: a.quote, rawEventLog: a.eventLog });
    if (!plan.admittedBy) {
      const ask = plan.v21 && plan.imageId ? `empreinte d'image ${plan.imageId} (stable d'un redémarrage à l'autre)` : `workloadId ${plan.workloadId}`;
      throw new Error(`image non autorisée pour le produit #${productId} : ${ask}${plan.note ? ` ; ${plan.note}` : ""} (l'auteur du produit doit la proposer puis l'appliquer : proposeWorkload → applyWorkload)`);
    }
    const rd0 = expectedReportData0({ chainId: this.d.chainId, registry: this.d.enclaveRegistry, productId, operator, signer: a.signer, x25519: a.x25519 });
    if (m.reportData.slice(0, 66).toLowerCase() !== rd0.toLowerCase()) {
      throw new Error("REPORTDATA ne lie pas (chaîne, registre, produit, opérateur, clés) : l'enclave sert un autre produit ou un autre registre (ReportDataMismatch)");
    }
    const tx = await this.write(this.d.enclaveRegistry, enclaveRegistryAbi, "registerEnclave", [productId, a.quote, anchorR, a.signer, a.x25519, plan.eventLog], true);
    return { tx, signer: a.signer, x25519: a.x25519, workloadId: plan.admittedBy === "image" ? plan.imageId! : plan.workloadId, admittedBy: plan.admittedBy };
  }
  /** Retire une de SES enclaves : plus rien ne s'ancre après, la caution qu'elle réservait est libérée (les reçus
   *  ancrés avant restent réglables pendant la grâce). */
  retireEnclave(signer: Address) { return this.write(this.d.enclaveRegistry, enclaveRegistryAbi, "retire", [signer]); }

  // ---------- produit ----------

  async proposeProduct(q: {
    manifestHash: Hex; manifestURI: string; workloadIds: Hex[]; deterministic: boolean; price: bigint;
    bpsOperator: number; bpsAuthor: number; bpsNetwork: number; minBond: bigint; exposureCap: bigint;
    settlement: Address; param: Hex; advisoryIds: string[];
    /** v2 : unité facturée (défaut 1 jeton) et poids d'un jeton de sortie (défaut 1). */
    unitTokens?: number; outWeight?: number;
  }): Promise<{ tx: Hex; productId: bigint }> {
    const params = { ...q, unitTokens: q.unitTokens ?? 1, outWeight: q.outWeight ?? 1 };
    const { tx, result } = await this.send(this.d.productRegistry, productRegistryAbi, "propose", [params]);
    return { tx, productId: result as bigint };
  }
  activateProduct(id: bigint) { return this.write(this.d.productRegistry, productRegistryAbi, "activate", [id]); }
  /** v2 : autoriser une image se fait en deux temps (timelock du registre). */
  proposeWorkload(productId: bigint, workloadId: Hex) { return this.write(this.d.productRegistry, productRegistryAbi, "proposeWorkload", [productId, workloadId]); }
  applyWorkload(productId: bigint, workloadId: Hex) { return this.write(this.d.productRegistry, productRegistryAbi, "applyWorkload", [productId, workloadId]); }

  // ---------- session (inférence) ----------

  /**
   * Ouvre une session v2, VERROUILLÉE sur une enclave : seuls ses reçus la paieront.
   * - `enclaveUrl` (recommandé) : ses clés sont vérifiées on-chain (verifyEnclaveKeys), l'enclave et l'opérateur en
   *   viennent ; un `operator` donné doit être le même.
   * - sinon `enclave` (signataire) : son opérateur actif est lu on-chain ;
   * - transition : `operator` seul, s'il a exactement UNE enclave active sur ce produit.
   * L'échéance (défaut 24 h) doit être dans [10 min, 30 j] (SessionPay.MIN_SESSION / MAX_SESSION).
   */
  async openSession(params: {
    productId: bigint; deposit: bigint; cap?: bigint; expiresInSeconds?: number;
    enclaveUrl?: string; enclave?: Address; operator?: Address;
  }): Promise<{ tx: Hex; sessionId: bigint; sessionKey: SessionKey; enclave: Address; operator: Address; expiresAt: bigint; keys?: VerifiedEnclaveKeys }> {
    const life = params.expiresInSeconds ?? 86_400;
    if (life < SESSION_MIN_SECONDS + SESSION_EXPIRY_MARGIN_SECONDS || life > SESSION_MAX_SECONDS - SESSION_EXPIRY_MARGIN_SECONDS) {
      throw new Error(`échéance de session : entre ${(SESSION_MIN_SECONDS + SESSION_EXPIRY_MARGIN_SECONDS) / 60} min et ${Math.floor((SESSION_MAX_SECONDS - SESSION_EXPIRY_MARGIN_SECONDS) / 86_400)} jours (SessionPay v2 refuse sinon : BadExpiry)`);
    }
    let keys: VerifiedEnclaveKeys | undefined;
    let enclave: Address;
    let operator: Address;
    if (params.enclaveUrl) {
      keys = await this.verifyEnclaveKeys(params.enclaveUrl, params.productId);
      enclave = keys.signer;
      operator = keys.operator;
      if (params.enclave && params.enclave.toLowerCase() !== enclave.toLowerCase()) {
        throw new Error(`${params.enclaveUrl} sert l'enclave ${enclave}, pas ${params.enclave}`);
      }
    } else if (params.enclave) {
      enclave = params.enclave;
      operator = await this.activeOperatorAt(enclave, params.productId);
      if (operator === zeroAddress) throw new Error(`l'enclave ${enclave} n'est pas active pour le produit #${params.productId} (InactiveEnclave)`);
    } else if (params.operator) {
      // transition (appelants v1 qui ne donnent que l'opérateur) : son UNIQUE enclave active sur ce produit, lue dans le
      // registre. Le client d'inférence vérifiera de toute façon les clés de l'enclave contre la session avant d'envoyer.
      const mine = (await this.listEnclaves()).filter((e) => e.active && e.productId === params.productId && e.operator.toLowerCase() === params.operator!.toLowerCase());
      if (mine.length !== 1) {
        throw new Error(mine.length
          ? `l'opérateur ${params.operator} a ${mine.length} enclaves actives sur le produit #${params.productId} : donnez enclaveUrl (ou enclave) pour choisir celle qui servira la session`
          : `l'opérateur ${params.operator} n'a aucune enclave active sur le produit #${params.productId}`);
      }
      enclave = mine[0]!.signer;
      operator = mine[0]!.operator;
    } else {
      throw new Error("v2 : une session est verrouillée sur une enclave : donnez enclaveUrl (clés vérifiées on-chain) ou enclave (signataire)");
    }
    if (params.operator && params.operator.toLowerCase() !== operator.toLowerCase()) {
      throw new Error(`l'enclave ${enclave} est active pour l'opérateur ${operator}, pas pour ${params.operator} (WrongOperator)`);
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
  /** Règle un reçu (sans permission : le paiement va à l'opérateur de la session). */
  settle(receipt: Receipt, signature: Hex) { return this.write(this.d.sessionPay, sessionPayAbi, "settle", [receipt, signature]); }
  /** Ferme une session (propriétaire) : rembourse le reste, écrit le verdict ERC-8004 (gaz du verdict compris). */
  closeSession(sessionId: bigint) { return this.write(this.d.sessionPay, sessionPayAbi, "closeSession", [sessionId], true); }

  /** Quand la session peut être fermée : à l'échéance + SETTLE_GRACE, ou plus tôt si son enclave ne peut plus rien
   *  régler (bloc > settleableUntilBlock). */
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
    if (n === 0 || n !== q.tierAmount.length || q.tierAmount[0] === 0n) throw new Error("paliers : listes non vides et de même taille, premier montant > 0 (BadTiers)");
    for (let i = 1; i < n; i++) {
      if (q.tierMinLoss[i]! <= q.tierMinLoss[i - 1]! || q.tierAmount[i]! <= q.tierAmount[i - 1]!) {
        throw new Error("paliers : seuils ET montants strictement croissants (BadTiers)");
      }
    }
    if (!Number.isInteger(q.k) || q.k < 1 || q.k > BOUNTY_MAX_SIGS) throw new Error(`k : entre 1 et ${BOUNTY_MAX_SIGS} (BadK)`);
    const auth = await this.buildAuth(this.d.sealedBounty, q.funding);
    const { tx, result } = await this.send(this.d.sealedBounty, sealedBountyAbi, "createBounty", [{ ...q, auth }]);
    return { tx, bountyId: result as bigint };
  }
  async fundBounty(bountyId: bigint, amount: bigint): Promise<Hex> {
    const auth = await this.buildAuth(this.d.sealedBounty, amount);
    return this.write(this.d.sealedBounty, sealedBountyAbi, "fund", [bountyId, amount, auth]);
  }
  withdrawRemaining(bountyId: bigint) { return this.write(this.d.sealedBounty, sealedBountyAbi, "withdrawRemaining", [bountyId]); }
  /** v2 : le protocole réarme sa prime après correction (les paliers redeviennent payables, ancrage après ce bloc). */
  reopenBounty(bountyId: bigint) { return this.write(this.d.sealedBounty, sealedBountyAbi, "reopen", [bountyId]); }
  setBountyPaused(bountyId: bigint, paused: boolean) { return this.write(this.d.sealedBounty, sealedBountyAbi, "setPaused", [bountyId, paused]); }

  // ---------- prime (chasseur) ----------

  /**
   * Prépare la soumission d'un exploit : lit la prime ON-CHAIN (produit, clé X25519 du protocole), vérifie les clés de
   * l'enclave on-chain pour CE produit (verifyEnclaveKeys), puis chiffre (cP vers le protocole, cE vers l'enclave).
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
  /** Envoie l'exploit chiffré à l'enclave et contrôle la réclamation signée qu'elle rend. */
  proveExploit(sealed: SealedExploit): Promise<ProvenClaim> {
    return submitSealedExploit(sealed, { sealedBounty: this.d.sealedBounty, chainId: this.d.chainId });
  }
  /** v2 (recommandé) : vérifie la réclamation et RÉSERVE le paiement ; cP n'est pas dans cette transaction. */
  acceptClaim(claim: Claim, signatures: Hex[]) { return this.write(this.d.sealedBounty, sealedBountyAbi, "acceptClaim", [claim, signatures], true); }
  /** v2 : livre cP (contrôlé contre le hash réservé) et paie chasseur, réseau et opérateurs. Ouvert à tous. */
  deliver(bountyId: bigint, fingerprint: Hex, cP: Hex) { return this.write(this.d.sealedBounty, sealedBountyAbi, "deliver", [bountyId, fingerprint, cP], true); }
  /** acceptClaim, attente de sa confirmation, puis deliver : les deux transactions du paiement v2. */
  async acceptAndDeliver(claim: Claim, signatures: Hex[], cP: Hex): Promise<{ acceptTx: Hex; deliverTx: Hex }> {
    const acceptTx = await this.acceptClaim(claim, signatures);
    const r = await this.pub.waitForTransactionReceipt({ hash: acceptTx, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`acceptClaim annulée on-chain (${acceptTx}) : rien n'est réservé, cP n'a pas été publié`);
    const deliverTx = await this.deliver(claim.bountyId, claim.fingerprint, cP);
    return { acceptTx, deliverTx };
  }
  /** Chemin v1 en UNE transaction (claim). Déconseillé : si elle échoue, cP reste lisible dans sa calldata. */
  claimBounty(claim: Claim, signatures: Hex[], cP: Hex): Promise<Hex> {
    return this.write(this.d.sealedBounty, sealedBountyAbi, "claim", [claim, signatures, cP], true);
  }
  /** v2 : un paiement réservé et jamais livré retourne au pool après DELIVERY_WINDOW (ouvert à tous). */
  cancelUndelivered(bountyId: bigint, fingerprint: Hex) { return this.write(this.d.sealedBounty, sealedBountyAbi, "cancelUndelivered", [bountyId, fingerprint]); }
  /** v2 : retire un paiement dont le transfert avait été refusé (crédit). */
  withdrawCredit() { return this.write(this.d.sealedBounty, sealedBountyAbi, "withdrawCredit", []); }

  // ---------- helpers ----------

  async buildAuth(to: Address, value: bigint): Promise<Auth> {
    return buildReceiveAuthorization(this.signTypedData(), { usdc: this.d.usdc, chainId: this.d.chainId ?? ARC_TESTNET_ID, from: this.signer().address, to, value });
  }
}

/** Vrai si l'erreur viem est un refus du contrat (et non une erreur réseau). */
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
