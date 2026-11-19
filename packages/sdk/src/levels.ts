/**
 * levels.ts — les DEUX NIVEAUX d'opérateur (10/11/2026), côté client. Utilisable partout (navigateur
 * compris) ; la demande d'un jeton à l'alliance Proof of Cloud, qui exige Node, est dans proof-of-cloud.ts.
 *
 *  - Niveau « ouvert » (0) : l'enclave est attestée par Intel et vérifiée par un contrat d'Arc ; l'opérateur a une caution.
 *  - Niveau « vérifié » (1) : en plus, la MACHINE (sa puce : PPID, lu dans le certificat PCK d'Intel du quote) est déclarée
 *    en datacenter connu par un VÉRIFICATEUR que le produit accepte. Le vérificateur sans confiance de référence est
 *    ProofOfCloudAuditor : il vérifie on-chain la signature de l'alliance Proof of Cloud (Phala, Secret, Nillion, iExec…).
 *  Chaque produit fixe son niveau minimum et ses vérificateurs (MachineRegistry.policyOf) ; les contrats de règlement
 *  branchés sur PolicyEnclaves l'appliquent ; ce module permet à l'acheteur de le lire et de l'afficher.
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
  if (!d.levels) throw new Error("ce déploiement n'a pas les niveaux d'opérateur (section levels absente)");
  return d.levels;
}

export interface MachineInfo {
  /** PPID de la machine (puce), ou null si l'enclave n'a jamais été liée. */
  ppid: Hex | null;
  /** Liaison à jour : l'enclave est active et n'a pas été réinscrite depuis (sinon : relier). */
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
  /** Niveau au regard du vérificateur Proof of Cloud du déploiement (indépendant des politiques de produit). */
  verifiedByProofOfCloud: boolean;
  machine: MachineInfo;
  /** Déclaration de l'alliance sur cette machine : fin (horodatage) et dernier jeton, si elle existe. */
  proofOfCloud?: { expiresAt: number; revoked: boolean; lastTokenAt: number };
  /** Si `productId` est donné : le niveau exigé par le produit, s'il est rempli, et par quel vérificateur. */
  product?: { productId: bigint; required: OperatorLevel; meets: boolean; verifiedBy: Address | null };
}

/** Tout ce qu'un acheteur (ou le site) affiche sur le niveau d'une enclave. */
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

/** Le quote d'une transaction registerEnclave (calldata), pour le lier ensuite à sa machine (bindMachine). */
export async function quoteFromRegisterTx(pub: PublicClient, tx: Hex): Promise<Hex> {
  const t = await pub.getTransaction({ hash: tx });
  const { functionName, args } = decodeFunctionData({ abi: enclaveRegistryAbi, data: t.input });
  if (functionName !== "registerEnclave") throw new Error(`${tx} n'est pas un registerEnclave`);
  return (args as readonly unknown[])[1] as Hex;
}

// ---------------------------------------------------------------- jeton de l'alliance (lecture, vérification)

export interface AllianceToken {
  header: string;
  payload: string;
  /** Signature EdDSA (64 octets). */
  signature: Hex;
  machineId: string;
  quoteSha256: string;
  timestamp: number;
  label: string;
}

const b64url = (s: string): Uint8Array => {
  // atob : présent dans les navigateurs et dans Node ≥ 16 (pas de Buffer : ce module sert aussi le site)
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
};

/** Découpe un JWT de l'alliance et VÉRIFIE sa signature EdDSA avec la clé publiée (lève sinon). */
export function parseAllianceToken(jwt: string, allianceKey: Hex = PROOF_OF_CLOUD.allianceKey): AllianceToken {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("jeton de l'alliance : trois parties attendues");
  const [header, payload, s] = parts as [string, string, string];
  const sig = b64url(s);
  if (sig.length !== 64) throw new Error("jeton de l'alliance : signature de 64 octets attendue");
  const key = Uint8Array.from((allianceKey.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
  if (!ed25519.verify(sig, new TextEncoder().encode(`${header}.${payload}`), key)) throw new Error("jeton de l'alliance : signature invalide");
  const body = JSON.parse(new TextDecoder().decode(b64url(payload)));
  if (!/^[0-9a-f]{32}$/.test(body.machine_id) || !/^[0-9a-f]{64}$/.test(body.quote_hash) || !Number.isSafeInteger(body.timestamp)) {
    throw new Error("jeton de l'alliance : contenu inattendu");
  }
  return {
    header, payload,
    signature: `0x${Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex,
    machineId: body.machine_id, quoteSha256: body.quote_hash, timestamp: body.timestamp, label: String(body.label ?? ""),
  };
}

/** Le quote de l'inscription EN COURS de `signer` (Enclave.quoteHash) : on remonte ses événements EnclaveRegistered, par
 *  tranches de `step` blocs (le RPC doit servir eth_getLogs sur cette largeur), jusqu'à `maxBack` blocs. */
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
  if (!event) throw new Error("ABI : événement EnclaveRegistered absent");
  for (let to = head; to + maxBack > head && to > d.deployBlock; to -= step) {
    const from = to - step + 1n > d.deployBlock ? to - step + 1n : d.deployBlock;
    const logs = await pub.getLogs({ address: d.enclaveRegistry, event: event as any, args: { signer } as any, fromBlock: from, toBlock: to });
    for (const lg of [...logs].reverse()) {
      const q = await quoteFromRegisterTx(pub, lg.transactionHash as Hex);
      if (keccakHex(q) === want) return q;
    }
  }
  throw new Error(`quote de l'inscription en cours introuvable pour ${signer}`);
}

const keccakHex = (q: Hex) => keccak256(q).toLowerCase();
