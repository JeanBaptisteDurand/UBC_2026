/** chain.ts — Arc testnet access: clients, wallet (PRIVATE_KEY), simulation, sending and
 *  confirmation, decoding of contract reverts, event reads, ABIs not in the SDK. */
import {
  createPublicClient, createWalletClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, toHex,
  type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  ARC_TESTNET_ID, arcErrorsAbi, arcTestnet, createArcClient, enclaveRegistryAbi, EnclaveKeyMismatchError, explainArcError,
  testnet, verifyEnclaveKeys, type ArcClient, type VerifiedEnclaveKeys,
} from "@arcvault/sdk";
import { CliError, UsageError, info } from "./cli";

export const DEFAULT_RPC = "https://rpc.testnet.arc.io";
export const EXPLORER = "https://explorer.testnet.arc.io";
export const NET_TAG = "arctest"; // network prefix of aek_ keys
export const EIP2935_WINDOW = 8191n;
export const SETTLE_GRACE_S = 3600n; // SessionPay.SETTLE_GRACE (1 h)
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
/** Arc testnet's ERC-8004 identity registry (contracts/src/interfaces/IERC8004.sol). */
export const ERC8004_IDENTITY_TESTNET: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const transport = (rpc?: string) => http(rpc ?? DEFAULT_RPC, { retryCount: 5, retryDelay: 400, timeout: 30_000 });

export function publicClient(rpc?: string) {
  return createPublicClient({ chain: arcTestnet, transport: transport(rpc) });
}
export type Pub = ReturnType<typeof publicClient>;

export function reader(rpc?: string): { arc: ArcClient; pub: Pub } {
  const pub = publicClient(rpc);
  return { pub, arc: createArcClient({ publicClient: pub as any }) };
}

export const txUrl = (h: Hex) => `${EXPLORER}/tx/${h}`;
export const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ---------- portefeuille ----------

/** Account from PRIVATE_KEY (ARC_PK is also accepted). The value is never printed. */
export function walletAccount(): PrivateKeyAccount {
  const raw = (process.env.PRIVATE_KEY ?? process.env.ARC_PK ?? "").trim();
  if (!raw) {
    throw new CliError("this command signs: set the PRIVATE_KEY environment variable (a 0x… private key); it is never passed as an argument or shown");
  }
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new CliError("invalid PRIVATE_KEY: expected 0x followed by 64 hex characters (value not shown)");
  }
  return privateKeyToAccount(pk);
}

export function walletAddressIfAny(): Address | undefined {
  try {
    return walletAccount().address;
  } catch {
    return undefined;
  }
}

export const DRY_HASH = `0x${"00".repeat(32)}` as Hex;

interface WriteOnly {
  writeContract(request: unknown): Promise<Hex>;
}

export interface Writer {
  arc: ArcClient;
  pub: Pub;
  account: PrivateKeyAccount;
  wallet: WriteOnly;
  dryRun: boolean;
}

/** Write client: checks the chainId; with --dry-run, simulates (eth_call) but sends nothing. */
export async function writer(ctx: { rpc?: string; dryRun: boolean }): Promise<Writer> {
  const account = walletAccount();
  const pub = publicClient(ctx.rpc);
  const chainId = await pub.getChainId();
  if (chainId !== ARC_TESTNET_ID) {
    throw new CliError(`the RPC answers chainId ${chainId}, expected Arc testnet (${ARC_TESTNET_ID}): nothing is signed`);
  }
  const real = createWalletClient({ account, chain: arcTestnet, transport: transport(ctx.rpc) });
  // The SDK calls wallet.signTypedData (local EIP-3009 authorizations), then wallet.writeContract after its own
  // simulation: with --dry-run, the local signature is kept and nothing is sent.
  const wallet = ctx.dryRun
    ? {
        account,
        signTypedData: (a: any) => real.signTypedData(a),
        writeContract: async (req: any) => {
          info(`  [dry run] ${req.functionName} → ${req.address}: accepted by eth_call, nothing is sent`);
          return DRY_HASH;
        },
      }
    : real;
  const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
  return { arc, pub, account, wallet: wallet as WriteOnly, dryRun: ctx.dryRun };
}

/** Simulates, then sends a call the SDK does not expose (approve…). Refusals raised by another contract of the network
 *  are decoded (the call's ABI + every error of the network). */
export async function writeCall(w: Writer, address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
  const { request } = await w.pub.simulateContract({ account: w.account, address, abi: [...abi, ...arcErrorsAbi], functionName, args } as any);
  return w.wallet.writeContract(request);
}

export class RevertedOnChain extends CliError {}

/** Waits for the confirmation; returns undefined with --dry-run (nothing was sent). */
export async function confirm(w: Writer, label: string, hash: Hex): Promise<TransactionReceipt | undefined> {
  if (w.dryRun) return undefined;
  info(`  ${label}: sent ${hash}`);
  const rcpt = await w.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rcpt.status !== "success") throw new RevertedOnChain(`${label}: transaction reverted on-chain, ${txUrl(hash)}`);
  info(`  ${label}: confirmed at block ${rcpt.blockNumber}, ${txUrl(hash)}`);
  return rcpt;
}

// ---------- contract refusals, explained ----------

/** A readable error message: a contract refusal decoded by the SDK (every error of the stack, explained in French by
 *  the SDK's table, including those raised inside a called contract), refused enclave keys, or the raw message. */
export function explainError(e: unknown): string {
  if (e instanceof CliError || e instanceof UsageError) return e.message;
  if (e instanceof EnclaveKeyMismatchError) return e.message;
  return explainArcError(e, "en");
}

// ---------- HTTP (enclaves) ----------

export async function httpJson(url: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new CliError(`${url} unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new CliError(`${url}: non-JSON answer (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new CliError(`${url}: HTTP ${res.status} ${body?.error ?? text.slice(0, 200)}`);
  return body;
}

/** An enclave's /pubkeys WITHOUT trust (e.g. to register it: the chain will verify its quote). To ENCRYPT to it, use
 *  verifiedEnclave: the /pubkeys key must be the one registered on-chain. */
export async function enclavePubkeys(url: string): Promise<{ signer: Address; x25519: Hex }> {
  const j = await httpJson(`${url.replace(/\/$/, "")}/pubkeys`);
  if (typeof j?.signer !== "string" || typeof j?.x25519 !== "string") throw new CliError(`${url}/pubkeys: unexpected answer`);
  return { signer: j.signer as Address, x25519: j.x25519 as Hex };
}

/** An enclave's keys checked against the chain (SDK verifyEnclaveKeys): X25519 key = the registered one, enclave active
 *  for the product at the head block; for a session, the locked enclave. Otherwise a CliError carrying the SDK's
 *  message ("la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé (…)", kept in French). */
export async function verifiedEnclave(
  pub: Pub, url: string, productId: bigint, o: { sessionId?: bigint; expectedSigner?: Address } = {},
): Promise<VerifiedEnclaveKeys> {
  try {
    return await verifyEnclaveKeys(url, productId, { publicClient: pub as any, deployment: testnet, ...o });
  } catch (e) {
    if (e instanceof EnclaveKeyMismatchError) throw new CliError(e.message);
    throw e;
  }
}

export function isActiveAt(pub: Pub, signer: Address, productId: bigint, block: bigint): Promise<boolean> {
  return pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "isActiveAt", args: [signer, productId, block] }) as Promise<boolean>;
}

/** The registry's grace period, in blocks (read once): an enclave out of its window can still get the receipts
 *  anchored inside it settled during this period. */
let graceBlocks: bigint | undefined;
export async function enclaveGraceBlocks(pub: Pub): Promise<bigint> {
  graceBlocks ??= (await pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "GRACE_BLOCKS" })) as bigint;
  return graceBlocks;
}

// ---------- events (Blockscout, with an RPC fallback) ----------

export interface RawLog {
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  txHash: Hex;
}

/** A contract's events filtered by topic0 (and topic1), oldest first. Read through the explorer's Blockscout indexer;
 *  otherwise, eth_getLogs in chunks of 5,000 blocks (one after the other). */
export async function fetchLogs(pub: Pub, address: Address, topic0: Hex, topic1?: Hex): Promise<RawLog[]> {
  const want = (t: (Hex | null)[]) =>
    t[0]?.toLowerCase() === topic0.toLowerCase() && (!topic1 || t[1]?.toLowerCase() === topic1.toLowerCase());
  const bs = testnet.blockscoutUrl;
  if (bs) {
    try {
      const outLogs: RawLog[] = [];
      let query = "";
      for (let page = 0; page < 40; page++) {
        const res = await fetch(`${bs.replace(/\/$/, "")}/api/v2/addresses/${address}/logs${query}`, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`blockscout ${res.status}`);
        const j = (await res.json()) as { items?: any[]; next_page_params?: Record<string, unknown> | null };
        for (const it of j.items ?? []) {
          const topics = (it.topics ?? []) as (Hex | null)[];
          if (!want(topics)) continue;
          outLogs.push({ topics: topics.filter(Boolean) as Hex[], data: it.data as Hex, blockNumber: BigInt(it.block_number), txHash: it.transaction_hash as Hex });
        }
        if (!j.next_page_params) break;
        query = `?${new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString()}`;
      }
      return outLogs.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
    } catch {
      info("  (indexer unavailable: reading the events through the RPC, which is slower)");
    }
  }
  const head = await pub.getBlockNumber();
  const outLogs: RawLog[] = [];
  for (let from = testnet.deployBlock; from <= head; from += 5000n) {
    const to = from + 4999n < head ? from + 4999n : head;
    const logs = (await (pub as any).request({
      method: "eth_getLogs",
      params: [{ address, topics: topic1 ? [topic0, topic1] : [topic0], fromBlock: toHex(from), toBlock: toHex(to) }],
    })) as any[];
    for (const l of logs) outLogs.push({ topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), txHash: l.transactionHash });
  }
  return outLogs;
}

// ---------- names, and ABIs missing from the SDK ----------

export function contractName(a: Address): string {
  const names: Record<string, string> = {
    [testnet.sessionPay.toLowerCase()]: "SessionPay",
    [testnet.sealedBounty.toLowerCase()]: "SealedBounty",
    [testnet.x402Settler.toLowerCase()]: "X402Settler",
  };
  return names[a.toLowerCase()] ?? a;
}

export const bountyExtraAbi = parseAbi([
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function tierAmount(uint256 bountyId, uint256 index) view returns (uint256)",
  "function networkBountyBps() view returns (uint16)",
  "function operatorBountyBps() view returns (uint16)",
]);

export const bondExtraAbi = parseAbi([
  "function agentIdOf(address operator) view returns (uint256)",
  "function unbondableAt(address operator) view returns (uint64)",
]);

export const sessionExtraAbi = parseAbi([
  "event SessionClosed(uint256 indexed sessionId, uint256 refund)",
  "event Settled(uint256 indexed sessionId, uint128 cumulativeUnits, uint256 paidDelta)",
]);

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export interface Tier {
  minLoss: bigint;
  amount: bigint;
}

/** A bounty's tiers (public arrays read element by element, up to the first out of bounds). They are read through
 *  pub.call (not readContract, which files a node's internal -32603 error among the reverts): only the end of the
 *  array (an EVM revert, code 3) stops the read; any other error is raised (tiers are never truncated silently). */
export async function readTiers(pub: Pub, bountyId: bigint): Promise<Tier[]> {
  const tiers: Tier[] = [];
  const read = async (functionName: "tierMinLoss" | "tierAmount", i: bigint): Promise<bigint> => {
    const { data } = await pub.call({ to: testnet.sealedBounty, data: encodeFunctionData({ abi: bountyExtraAbi, functionName, args: [bountyId, i] }) });
    if (data === undefined) throw new CliError(`${functionName}: empty answer`);
    return decodeFunctionResult({ abi: bountyExtraAbi, functionName, data }) as bigint;
  };
  for (let i = 0n; i < 16n; i++) {
    try {
      const minLoss = await read("tierMinLoss", i);
      const amount = await read("tierAmount", i);
      tiers.push({ minLoss, amount });
    } catch (e) {
      if (isRevert(e)) break; // end of the array
      throw e; // a network error or a node's internal error: never truncate the tiers silently
    }
  }
  return tiers;
}

/** True if the error is an EVM revert: JSON-RPC code 3 (EIP-1474) in the chain of causes, rather than viem's error
 *  name (ContractFunctionRevertedError also covers a node's internal -32603 error). */
export function isRevert(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x?.code === 3) return true;
  }
  return false;
}

export async function bountyFeesBps(pub: Pub): Promise<{ network: number; operator: number }> {
  const network = Number(await pub.readContract({ address: testnet.sealedBounty, abi: bountyExtraAbi, functionName: "networkBountyBps" }));
  const operator = Number(await pub.readContract({ address: testnet.sealedBounty, abi: bountyExtraAbi, functionName: "operatorBountyBps" }));
  return { network, operator };
}
