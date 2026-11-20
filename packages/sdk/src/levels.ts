/**
 * levels.ts — the TWO operator LEVELS, client side. Usable anywhere (browser included); requesting a token from the
 * Proof of Cloud alliance needs Node and lives in proof-of-cloud.ts.
 *
 *  - "Open" level (0): the enclave is attested by Intel and verified by an Arc contract; the operator has a bond.
 *  - "Verified" level (1): in addition, the MACHINE (its chip: the PPID, read from Intel's PCK certificate in the quote)
 *    is declared to be in a known datacenter by a VERIFIER the product accepts. The reference trustless verifier is
 *    ProofOfCloudAuditor: it checks the Proof of Cloud alliance's signature (Phala, Secret, Nillion, iExec…) on-chain.
 *  Each product sets its minimum level and its verifiers (MachineRegistry.policyOf); the settlement contracts wired to
 *  PolicyEnclaves enforce it; this module lets a buyer read it and display it.
 */
import { decodeFunctionData, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { ed25519 } from "@noble/curves/ed25519";
import { enclaveRegistryAbi } from "./abis";
import type { Deployment } from "./network";

export const LEVEL_OPEN = 0 as const;
export const LEVEL_VERIFIED = 1 as const;
export type OperatorLevel = typeof LEVEL_OPEN | typeof LEVEL_VERIFIED;

/** The Proof of Cloud alliance (github.com/proofofcloud/trust-server): its trust servers and its common key, as published
 *  in public_info/peers_list.txt and public_info/public_key.txt. `allianceKey` is the alliance's PUBLIC verification key
 *  (Ed25519), not a secret. */
export const PROOF_OF_CLOUD = {
  allianceKey: "0x5ea69fede5bcf71054395b273bad67f67158c242d77945d436374020ece525cb" as Hex,
  peers: ["https://trust-server.scrtlabs.com", "https://trust-server.nillion.network", "https://trust-server.iex.ec"],
  source: "https://github.com/proofofcloud/trust-server",
} as const;

export const machineRegistryAbi = parseAbi([
  "function bindMachine(address signer, bytes quote) returns (bytes16)",
  "function machineOf(address signer) view returns (bytes16 ppid, bool current, uint64 boundAt)",
  "function attestMachine(bytes16 ppid, uint64 expiresAt, string site, string evidence)",
  "function revokeMachine(bytes16 ppid, string reason)",
  "function auditOf(address auditor, bytes16 ppid) view returns (uint64 expiresAt, bool revoked)",
  "function isVerified(address signer, address auditor) view returns (bool)",
  "function proposePolicy(uint256 productId, uint8 minLevel, address[] auditors)",
  "function applyPolicy(uint256 productId)",
  "function policyOf(uint256 productId) view returns (uint8 minLevel, address[] auditors)",
  "function pendingPolicyOf(uint256 productId) view returns (bool exists, uint8 minLevel, address[] auditors, uint64 applyAt)",
  "function verifiedBy(uint256 productId, address signer) view returns (address)",
  "function levelOf(uint256 productId, address signer) view returns (uint8)",
  "function meetsPolicy(uint256 productId, address signer) view returns (bool)",
  "event MachineBound(address indexed signer, bytes16 indexed ppid, bytes32 quoteHash)",
  "event MachineAttested(address indexed auditor, bytes16 indexed ppid, uint64 expiresAt, string site, string evidence)",
  "event MachineRevoked(address indexed auditor, bytes16 indexed ppid, string reason)",
  "event PolicyProposed(uint256 indexed productId, uint8 minLevel, address[] auditors, uint64 applyAt)",
  "event PolicyApplied(uint256 indexed productId, uint8 minLevel, address[] auditors)",
  "error NotActiveEnclave()",
  "error NotRegisteredQuote()",
  "error FmspcMismatch()",
  "error BadAudit()",
  "error NotAuthor()",
  "error BadPolicy()",
  "error NoPendingPolicy()",
  "error TooEarly()",
]);

export const proofOfCloudAuditorAbi = parseAbi([
  "function submit(string header, string payload, bytes signature) returns (bytes16 ppid, uint64 expiresAt)",
  "function lastTimestamp(bytes16 ppid) view returns (uint64)",
  "function allianceKey() view returns (bytes32)",
  "function VALIDITY() view returns (uint64)",
  "event ProofOfCloudToken(bytes16 indexed ppid, uint64 timestamp, uint64 expiresAt, bytes32 quoteSha256, string label)",
  "error BadKey()",
  "error BadToken()",
  "error BadSignature()",
  "error StaleToken()",
]);

const ZERO16 = "0x00000000000000000000000000000000";

function levelsOf(d: Deployment) {
  if (!d.levels) throw new Error("this deployment has no operator levels (no levels section)");
  return d.levels;
}

export interface MachineInfo {
  /** PPID of the machine (its chip), or null if the enclave was never bound. */
  ppid: Hex | null;
  /** Binding up to date: the enclave is active and was not registered again since (otherwise: bind again). */
  current: boolean;
  boundAt: number;
}

export async function readMachine(pub: PublicClient, d: Deployment, signer: Address): Promise<MachineInfo> {
  const [ppid, current, boundAt] = (await pub.readContract({
    address: levelsOf(d).machineRegistry, abi: machineRegistryAbi, functionName: "machineOf", args: [signer],
  })) as readonly [Hex, boolean, bigint];
  return { ppid: ppid === ZERO16 ? null : ppid, current, boundAt: Number(boundAt) };
}

export interface ProductPolicy {
  minLevel: OperatorLevel;
  auditors: Address[];
  pending?: { minLevel: OperatorLevel; auditors: Address[]; applyAt: number };
}

export async function readPolicy(pub: PublicClient, d: Deployment, productId: bigint): Promise<ProductPolicy> {
  const L = levelsOf(d);
  const [minLevel, auditors] = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "policyOf", args: [productId] })) as readonly [number, readonly Address[]];
  const [exists, pl, pa, at] = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "pendingPolicyOf", args: [productId] })) as readonly [boolean, number, readonly Address[], bigint];
  return {
    minLevel: minLevel as OperatorLevel,
    auditors: [...auditors],
    ...(exists ? { pending: { minLevel: pl as OperatorLevel, auditors: [...pa], applyAt: Number(at) } } : {}),
  };
}

export interface LevelReport {
  /** Level with respect to the deployment's Proof of Cloud verifier (independent of product policies). */
  verifiedByProofOfCloud: boolean;
  machine: MachineInfo;
  /** The alliance's declaration for this machine: its end (timestamp) and latest token, if there is one. */
  proofOfCloud?: { expiresAt: number; revoked: boolean; lastTokenAt: number };
  /** If `productId` is given: the level the product requires, whether it is met, and by which verifier. */
  product?: { productId: bigint; required: OperatorLevel; meets: boolean; verifiedBy: Address | null };
}

/** Everything a buyer (or the site) shows about an enclave's level. */
export async function describeLevel(pub: PublicClient, d: Deployment, signer: Address, productId?: bigint): Promise<LevelReport> {
  const L = levelsOf(d);
  const machine = await readMachine(pub, d, signer);
  const verifiedByProofOfCloud = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "isVerified", args: [signer, L.proofOfCloudAuditor] })) as boolean;
  let proofOfCloud: LevelReport["proofOfCloud"];
  if (machine.ppid) {
    const [exp, revoked] = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "auditOf", args: [L.proofOfCloudAuditor, machine.ppid] })) as readonly [bigint, boolean];
    const last = (await pub.readContract({ address: L.proofOfCloudAuditor, abi: proofOfCloudAuditorAbi, functionName: "lastTimestamp", args: [machine.ppid] })) as bigint;
    if (exp > 0n) proofOfCloud = { expiresAt: Number(exp), revoked, lastTokenAt: Number(last) };
  }
  let product: LevelReport["product"];
  if (productId !== undefined) {
    const pol = await readPolicy(pub, d, productId);
    const by = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "verifiedBy", args: [productId, signer] })) as Address;
    const meets = pol.minLevel === LEVEL_OPEN || by !== "0x0000000000000000000000000000000000000000";
    product = { productId, required: pol.minLevel, meets, verifiedBy: by === "0x0000000000000000000000000000000000000000" ? null : by };
  }
  return { verifiedByProofOfCloud, machine, ...(proofOfCloud ? { proofOfCloud } : {}), ...(product ? { product } : {}) };
}

/** The quote of a registerEnclave transaction (calldata), to bind it to its machine afterwards (bindMachine). */
export async function quoteFromRegisterTx(pub: PublicClient, tx: Hex): Promise<Hex> {
  const t = await pub.getTransaction({ hash: tx });
  const { functionName, args } = decodeFunctionData({ abi: enclaveRegistryAbi, data: t.input });
  if (functionName !== "registerEnclave") throw new Error(`${tx} is not a registerEnclave`);
  return (args as readonly unknown[])[1] as Hex;
}

// ---------------------------------------------------------------- the alliance's token (reading, verification)

export interface AllianceToken {
  header: string;
  payload: string;
  /** EdDSA signature (64 bytes). */
  signature: Hex;
  machineId: string;
  quoteSha256: string;
  timestamp: number;
  label: string;
}

const b64url = (s: string): Uint8Array => {
  // atob: available in browsers and in Node ≥ 16 (no Buffer: this module also serves the site)
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
};

/** Splits an alliance JWT and VERIFIES its EdDSA signature with the published key (throws otherwise). */
export function parseAllianceToken(jwt: string, allianceKey: Hex = PROOF_OF_CLOUD.allianceKey): AllianceToken {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("alliance token: three parts expected");
  const [header, payload, s] = parts as [string, string, string];
  const sig = b64url(s);
  if (sig.length !== 64) throw new Error("alliance token: 64-byte signature expected");
  const key = Uint8Array.from((allianceKey.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
  if (!ed25519.verify(sig, new TextEncoder().encode(`${header}.${payload}`), key)) throw new Error("alliance token: invalid signature");
  const body = JSON.parse(new TextDecoder().decode(b64url(payload)));
  if (!/^[0-9a-f]{32}$/.test(body.machine_id) || !/^[0-9a-f]{64}$/.test(body.quote_hash) || !Number.isSafeInteger(body.timestamp)) {
    throw new Error("alliance token: unexpected content");
  }
  return {
    header, payload,
    signature: `0x${Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex,
    machineId: body.machine_id, quoteSha256: body.quote_hash, timestamp: body.timestamp, label: String(body.label ?? ""),
  };
}

/** The quote of `signer`'s CURRENT registration (Enclave.quoteHash): its EnclaveRegistered events are walked back in
 *  chunks of `step` blocks (the RPC must serve eth_getLogs over that width), up to `maxBack` blocks. */
export async function findCurrentQuote(
  pub: PublicClient,
  d: Deployment,
  signer: Address,
  opts: { step?: bigint; maxBack?: bigint } = {},
): Promise<Hex> {
  const e = (await pub.readContract({ address: d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "enclaveOf", args: [signer] })) as { quoteHash: Hex };
  const want = e.quoteHash.toLowerCase();
  const step = opts.step ?? 9_000n, maxBack = opts.maxBack ?? 2_000_000n;
  const head = await pub.getBlockNumber();
  const event = enclaveRegistryAbi.find((x) => x.type === "event" && x.name === "EnclaveRegistered");
  if (!event) throw new Error("ABI: no EnclaveRegistered event");
  for (let to = head; to + maxBack > head && to > d.deployBlock; to -= step) {
    const from = to - step + 1n > d.deployBlock ? to - step + 1n : d.deployBlock;
    const logs = await pub.getLogs({ address: d.enclaveRegistry, event: event as any, args: { signer } as any, fromBlock: from, toBlock: to });
    for (const lg of [...logs].reverse()) {
      const q = await quoteFromRegisterTx(pub, lg.transactionHash as Hex);
      if (keccakHex(q) === want) return q;
    }
  }
  throw new Error(`quote of the current registration not found for ${signer}`);
}

const keccakHex = (q: Hex) => keccak256(q).toLowerCase();
