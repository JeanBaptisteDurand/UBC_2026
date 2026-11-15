/** bounty.ts — le chemin du chasseur de la Prime scellée (pile v2), écrit une fois pour la CLI, les scripts et le site.
 *
 *  1. cP = scellé DÉTERMINISTE (aléa r) vers la clé X25519 du PROTOCOLE, lue on-chain (Bounty.protocolX25519), sur la
 *     forme canonique que recalcule l'enclave (DeterministicProtocolCipher, enclave/src/services/bounty.ts) ;
 *  2. cE = HPKE vers la clé X25519 de l'ENCLAVE, VÉRIFIÉE on-chain (VerifiedEnclaveKeys, voir enclave-keys.ts) : jamais
 *     vers une clé lue sur /pubkeys sans contrôle, sinon le mandataire qui sert /pubkeys lirait l'exploit ;
 *  3. l'enclave rejoue et signe une réclamation ; on la contrôle (signataire = l'enclave vérifiée, cP, prédicat, payee,
 *     empreinte) AVANT de la soumettre : acceptClaim (réserve le paiement, cP hors transaction) puis deliver (livre cP, paie).
 *  Pour une prime à k enclaves : le même r, le même bloc N et la même échéance pour chacune → la même réclamation, k
 *  signatures.
 *
 *  v2.1 : RÉFUTER une réclamation acceptée (SealedBounty.refute) — voir la section en fin de fichier. */
import {
  type Address, type Hex, type PublicClient, decodeEventLog, encodeAbiParameters, encodeEventTopics, getAddress, hashTypedData,
  keccak256, recoverTypedDataAddress, toBytes, toHex, type TypedDataDomain, zeroAddress,
} from "viem";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { sealedBountyAbi } from "./abis";
import { deterministicOpen, deterministicSeal, hpkeSeal } from "./crypto";
import { EnclaveKeyMismatchError, assertVerifiedEnclaveKeys, verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import {
  claimDigestOf, claimTypes, normalizeClaim, recoverRefutationSigner, refutationTypes, type Claim, type Refutation,
} from "./eip712";
import { BOUNTY_MAX_SIGS, networkDomain, testnet, type Deployment } from "./network";
import { PREDICATE_MAX_DEPTH, PredicateError, exploitFingerprint, jsonDepthExceeds, predicateHash, validatePredicate, type Predicate } from "./predicate";

export interface ExploitInput {
  predicate: Predicate;
  /** Transactions de l'attaque, abi.encode(address to, uint256 value, bytes data) (encodeExploitTx), 1 à 10. */
  txs: Hex[];
  /** Capital déclaré (unités de base), défaut 0. */
  capital?: bigint | string;
  /** Bytecode optionnel à déployer avant les transactions. */
  attackCode?: Hex;
}

export interface SealedExploit {
  bountyId: bigint;
  payee: Address;
  /** Chiffré vers le protocole (livré on-chain par deliver). */
  cP: Hex;
  /** Chiffré vers l'enclave vérifiée : le corps de POST {enclave}/bounty/submit. */
  submitBody: { bountyId: string; enc: Hex; ciphertext: Hex };
  /** Empreinte canonique de l'exploit (clé de la réclamation, de deliver et de l'anti-doublon). */
  fingerprint: Hex;
  predicateHash: Hex;
  /** L'enclave visée (clés vérifiées on-chain). */
  enclave: VerifiedEnclaveKeys;
  /** Ancrage imposé aux k enclaves, s'il y en a un. */
  blockN?: bigint;
  deadline?: bigint;
}

const EVEN_HEX = /^0x([0-9a-fA-F]{2})*$/;

/** Valide l'exploit (même règles que l'enclave : prédicat (règles P1–P4 de predicate.ts, PredicateError), hexadécimal pair,
 *  1 à 10 transactions). */
export function validateExploit(x: ExploitInput): void {
  validatePredicate(x.predicate);
  if (!Array.isArray(x.txs) || x.txs.length < 1 || x.txs.length > 10 || !x.txs.every((t) => typeof t === "string" && EVEN_HEX.test(t))) {
    throw new Error("exploit : « txs » doit être une liste de 1 à 10 transactions en hexadécimal pair (encodeExploitTx)");
  }
  if (x.attackCode !== undefined && !(typeof x.attackCode === "string" && EVEN_HEX.test(x.attackCode))) {
    throw new Error("exploit : « attackCode » doit être de l'hexadécimal pair");
  }
  if (x.capital !== undefined && !/^\d+$/.test(String(x.capital))) throw new Error("exploit : « capital » doit être un entier ≥ 0");
}

/** La forme canonique dont l'enclave recalcule cP (DeterministicProtocolCipher) : mêmes clés, même ordre. */
export function protocolCanonical(a: { bountyId: bigint; payee: Address; exploit: ExploitInput }): string {
  return JSON.stringify({
    bountyId: a.bountyId.toString(),
    payee: a.payee,
    capital: BigInt(a.exploit.capital ?? 0n).toString(),
    predicate: a.exploit.predicate,
    txs: a.exploit.txs,
    attackCode: a.exploit.attackCode ?? null,
  });
}

/**
 * Chiffre un exploit pour UNE enclave vérifiée (et pour le protocole). `protocolX25519` doit venir de la chaîne
 * (getBounty(bountyId).protocolX25519), jamais d'un serveur. Pour k enclaves : passer le même `r`, `blockN`, `deadline`.
 */
export async function sealExploitForEnclave(a: {
  bountyId: bigint;
  payee: Address;
  exploit: ExploitInput;
  protocolX25519: Hex;
  enclave: VerifiedEnclaveKeys;
  /** 32 octets d'aléa pour cP (défaut : tiré ici). Le même pour les k enclaves d'une même réclamation. */
  r?: Uint8Array;
  /** v2 : bloc N du rejeu, dans [tête − 256, tête − 2] (le même pour les k enclaves). */
  blockN?: bigint;
  /** v2 : échéance de la réclamation (s Unix), dans ]maintenant, maintenant + 10 min]. */
  deadline?: bigint;
}): Promise<SealedExploit> {
  assertVerifiedEnclaveKeys(a.enclave); // jamais de chiffrement vers une clé non confrontée à la chaîne
  validateExploit(a.exploit);
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.protocolX25519)) throw new Error("protocolX25519 : 32 octets attendus (lus on-chain)");
  const r = a.r ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
  if (r.length !== 32) throw new Error("r : 32 octets attendus");
  const utf8 = (s: string) => new TextEncoder().encode(s);
  const cP = deterministicSeal(toBytes(a.protocolX25519), utf8(protocolCanonical(a)), r);
  const bundle = {
    bountyId: a.bountyId.toString(),
    payee: a.payee,
    capital: BigInt(a.exploit.capital ?? 0n).toString(),
    predicate: a.exploit.predicate,
    txs: a.exploit.txs,
    ...(a.exploit.attackCode ? { attackCode: a.exploit.attackCode } : {}),
    r: toHex(r),
    cP,
    ...(a.blockN !== undefined ? { blockN: a.blockN.toString() } : {}),
    ...(a.deadline !== undefined ? { deadline: a.deadline.toString() } : {}),
  };
  const plain = utf8(JSON.stringify(bundle));
  const cE = await hpkeSeal(toBytes(a.enclave.x25519), plain);
  plain.fill(0);
  if (!a.r) r.fill(0); // l'aléa tiré ici ne sert qu'à ce chiffrement
  return {
    bountyId: a.bountyId,
    payee: a.payee,
    cP,
    submitBody: { bountyId: a.bountyId.toString(), enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext) },
    fingerprint: exploitFingerprint({ txs: a.exploit.txs, attackCode: a.exploit.attackCode }),
    predicateHash: predicateHash(a.exploit.predicate),
    enclave: a.enclave,
    blockN: a.blockN,
    deadline: a.deadline,
  };
}

export interface ProvenClaim {
  claim: Claim;
  signature: Hex;
  cP: Hex;
  signer: Address;
}

export class ExploitNotProvenError extends Error {
  constructor(readonly reason: string) {
    super(`non prouvé par l'enclave : ${reason}`);
    this.name = "ExploitNotProvenError";
  }
}

/** Contrôles d'une réclamation signée avant tout envoi on-chain (ce que le contrat ne pardonnerait pas). */
export async function checkProvenClaim(
  sealed: SealedExploit,
  res: { claim: unknown; signature: Hex; cP: Hex },
  o: { sealedBounty: Address; chainId: number },
): Promise<ProvenClaim> {
  const claim = normalizeClaim(res.claim);
  const fail = (m: string): never => { throw new Error(`réclamation refusée avant envoi : ${m}`); };
  const signer = await recoverTypedDataAddress({
    domain: networkDomain(o.sealedBounty, o.chainId) as TypedDataDomain,
    types: claimTypes, primaryType: "Claim", message: claim, signature: res.signature,
  });
  if (signer.toLowerCase() !== sealed.enclave.signer.toLowerCase()) fail(`signée par ${signer}, pas par l'enclave vérifiée ${sealed.enclave.signer}`);
  if (claim.bountyId !== sealed.bountyId) fail(`prime #${claim.bountyId} au lieu de #${sealed.bountyId}`);
  if (claim.payee.toLowerCase() !== sealed.payee.toLowerCase()) fail(`bénéficiaire ${claim.payee} au lieu de ${sealed.payee}`);
  if (claim.predicateHash.toLowerCase() !== sealed.predicateHash.toLowerCase()) fail("predicateHash différent de celui de l'exploit");
  if (claim.fingerprint.toLowerCase() !== sealed.fingerprint.toLowerCase()) fail("empreinte différente de celle de l'exploit");
  if (res.cP.toLowerCase() !== sealed.cP.toLowerCase()) fail("le cP renvoyé n'est pas celui chiffré ici");
  if (keccak256(res.cP).toLowerCase() !== claim.cPHash.toLowerCase()) fail("keccak256(cP) ≠ cPHash");
  if (sealed.blockN !== undefined && claim.blockN !== sealed.blockN) fail(`bloc N ${claim.blockN} au lieu de ${sealed.blockN}`);
  if (sealed.deadline !== undefined && claim.deadline !== sealed.deadline) fail(`échéance ${claim.deadline} au lieu de ${sealed.deadline}`);
  return { claim, signature: res.signature, cP: res.cP, signer };
}

/**
 * POST {enclave}/bounty/submit avec le bundle chiffré, puis contrôle de la réclamation rendue (checkProvenClaim).
 * Lève ExploitNotProvenError si l'enclave ne prouve pas l'exploit.
 */
export async function submitSealedExploit(
  sealed: SealedExploit,
  o: { sealedBounty: Address; chainId: number; fetch?: typeof fetch; timeoutMs?: number },
): Promise<ProvenClaim> {
  const f = o.fetch ?? globalThis.fetch;
  const res = await f(`${sealed.enclave.enclaveUrl}/bounty/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sealed.submitBody),
    signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
  });
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`${sealed.enclave.enclaveUrl}/bounty/submit : réponse non JSON (HTTP ${res.status}) : ${text.slice(0, 160)}`); }
  if (!res.ok) throw new Error(`${sealed.enclave.enclaveUrl}/bounty/submit : HTTP ${res.status} ${j?.error ?? text.slice(0, 160)}`);
  if (j?.status !== "proven") throw new ExploitNotProvenError(String(j?.reason ?? j?.error ?? JSON.stringify(j)));
  return checkProvenClaim(sealed, { claim: j.claim, signature: j.signature as Hex, cP: j.cP as Hex }, o);
}

// ======================================================================================================================
// v2.1 — RÉFUTER une réclamation acceptée (SealedBounty.refute)
// ======================================================================================================================
//  1. readAcceptedClaim / listAcceptedClaims : la réclamation et ses opérateurs depuis l'événement ClaimAccepted, son état
//     depuis claimRecords (acceptée, non réfutée, fenêtre REFUTE_WINDOW), opsHash contrôlé ;
//  2. la source de l'exploit, contrôlée ICI avant tout envoi (elle doit redonner le cPHash de la réclamation) :
//     - le chasseur : bundle + aléa r (l'enclave recalcule cP) ;
//     - le protocole, après deliver : cP + le secret X25519 de CE rapport (n'ouvre que lui), ou, si le rapport est illisible,
//       la clé privée de la prime (revealKey : seule preuve possible qu'un rapport illisible n'en est pas un) ;
//  3. requestRefutations : clés de chaque enclave vérifiées on-chain AVANT tout envoi (verifyEnclaveKeys), enclaves des
//     opérateurs de la réclamation écartées, quorum calculé AVANT tout envoi (REFUTE_QUORUM opérateurs distincts au moins,
//     et plus que ceux de la réclamation) : non atteignable → rien ne part ; sinon contre-rejeu, signatures vérifiées puis
//     réunies par résultat (toutes signent la MÊME Refutation) et par opérateur distinct ;
//  4. prepareRefuteCall : refute(claim, ops, refutation, signatures), à simuler puis envoyer (avec marge de gaz : le contrat
//     exige VERDICT_GAS avant le verdict ERC-8004).

/** SealedBounty.REFUTE_QUORUM : au moins 2 opérateurs distincts derrière une réfutation. */
export const REFUTE_QUORUM = 2;
/** SealedBounty.REFUTE_WINDOW : 3 jours après l'acceptation (la valeur on-chain fait foi : readAcceptedClaim la lit). */
export const REFUTE_WINDOW_SECONDS = 259_200n;
/** SealedBounty._countRefuters : au plus 2 × MAX_SIGS signatures. */
export const REFUTE_MAX_SIGNATURES = 2 * BOUNTY_MAX_SIGS;
/** aad HPKE d'une demande de réfutation (identique à l'enclave, enclave/src/services/bounty.ts). */
export const REFUTE_AAD_LABEL = "arc-sealed-bounty/refute/v1";
/** Tranche d'eth_getLogs (le RPC public d'Arc plafonne la plage). */
const LOG_CHUNK = 5_000n;

export function refuteRequestAad(claimDigest: Hex): Uint8Array {
  return new TextEncoder().encode(`${REFUTE_AAD_LABEL}:${claimDigest.toLowerCase()}`);
}

/** keccak256(abi.encode(operators)) = ClaimRecord.opsHash (ordre de ClaimAccepted). */
export function claimOperatorsHash(operators: readonly Address[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [operators as Address[]]));
}

/** Opérateurs distincts qu'il faut derrière une réfutation : au moins REFUTE_QUORUM, et STRICTEMENT plus que la réclamation. */
export function refutersNeeded(claimOperators: number): number {
  return Math.max(REFUTE_QUORUM, claimOperators + 1);
}

/** Digest EIP-712 d'une réfutation (ce que recouvre SealedBounty._countRefuters). */
export function refutationDigestOf(sealedBounty: Address, f: Refutation, chainId?: number): Hex {
  return hashTypedData({ domain: networkDomain(sealedBounty, chainId) as TypedDataDomain, types: refutationTypes, primaryType: "Refutation", message: f });
}

export type RefuteErrorCode =
  | "bad_input" | "unknown_claim" | "event_not_found" | "inconsistent_event" | "already_refuted" | "window_over"
  | "source_mismatch" | "unreadable_report" | "not_ready";

export class RefuteError extends Error {
  constructor(readonly code: RefuteErrorCode, message: string) {
    super(message);
    this.name = "RefuteError";
  }
}

// ---------- 1. la réclamation acceptée ----------

export interface AcceptedClaim {
  /** Digest EIP-712 (clé de claimRecords, porté par la réfutation). */
  claimDigest: Hex;
  claim: Claim;
  /** Opérateurs signataires, tels qu'émis par ClaimAccepted (à repasser tels quels à refute). */
  operators: Address[];
  /** Montant réservé au chasseur. */
  amount: bigint;
  /** Horodatage de l'acceptation (claimRecords.acceptedAt). */
  acceptedAt: bigint;
  refuted: boolean;
  /** acceptedAt + REFUTE_WINDOW (lu on-chain). */
  refuteWindowEndsAt: bigint;
  /** Bloc et horodatage de la lecture ; fenêtre ouverte si checkedAtTimestamp ≤ refuteWindowEndsAt (comme le contrat). */
  checkedAtBlock: bigint;
  checkedAtTimestamp: bigint;
  windowOpen: boolean;
  /** Bloc et transaction de l'acceptation. */
  block: bigint;
  txHash: Hex;
}

interface RawLog { topics: Hex[]; data: Hex; blockNumber: bigint; txHash: Hex }

/** eth_getLogs par tranches (du plus ancien au plus récent) ; une tranche ratée lève : jamais de liste tronquée en silence. */
async function scanLogs(
  pub: PublicClient,
  q: { address: Address; topics: (Hex | null)[]; fromBlock: bigint; toBlock: bigint; firstOnly?: boolean },
): Promise<RawLog[]> {
  const out: RawLog[] = [];
  for (let from = q.fromBlock; from <= q.toBlock; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n < q.toBlock ? from + LOG_CHUNK - 1n : q.toBlock;
    const logs = (await (pub as any).request({
      method: "eth_getLogs",
      params: [{ address: q.address, topics: q.topics, fromBlock: toHex(from), toBlock: toHex(to) }],
    })) as any[];
    for (const l of logs ?? []) out.push({ topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), txHash: l.transactionHash });
    if (q.firstOnly && out.length) break;
  }
  return out;
}

/** Premier bloc de [lo, hi] dont l'horodatage est ≥ ts (recherche dichotomique). */
async function firstBlockAtOrAfter(pub: PublicClient, ts: bigint, lo: bigint, hi: bigint): Promise<bigint> {
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if ((await pub.getBlock({ blockNumber: mid })).timestamp >= ts) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

async function claimState(pub: PublicClient, d: Deployment, digest: Hex, blockNumber: bigint) {
  const [acceptedAt, refuted, opsHash] = (await pub.readContract({
    address: d.sealedBounty, abi: sealedBountyAbi, functionName: "claimRecords", args: [digest], blockNumber,
  })) as readonly [bigint, boolean, Hex];
  return { acceptedAt: BigInt(acceptedAt), refuted, opsHash };
}

async function chainContext(pub: PublicClient, d: Deployment, head: bigint) {
  const window = BigInt((await pub.readContract({ address: d.sealedBounty, abi: sealedBountyAbi, functionName: "REFUTE_WINDOW", blockNumber: head })) as bigint);
  const ts = (await pub.getBlock({ blockNumber: head })).timestamp;
  return { window, ts };
}

function decodeAccepted(l: RawLog): { claimDigest: Hex; claim: Claim; operators: Address[]; amount: bigint } {
  const ev = decodeEventLog({ abi: sealedBountyAbi, eventName: "ClaimAccepted", topics: l.topics as [Hex, ...Hex[]], data: l.data });
  const a = ev.args as any;
  const c = a.claim;
  return {
    claimDigest: a.claimDigest as Hex,
    claim: {
      bountyId: BigInt(c.bountyId), payee: getAddress(c.payee), blockN: BigInt(c.blockN), blockHashN: c.blockHashN, predicateHash: c.predicateHash,
      loss: BigInt(c.loss), tier: Number(c.tier), fingerprint: c.fingerprint, cPHash: c.cPHash, deadline: BigInt(c.deadline),
    },
    operators: (a.operators as Address[]).map((o) => getAddress(o)),
    amount: BigInt(a.amount),
  };
}

function toAccepted(
  d: Deployment, l: RawLog, st: { acceptedAt: bigint; refuted: boolean; opsHash: Hex }, head: bigint, ctx: { window: bigint; ts: bigint },
): AcceptedClaim {
  const ev = decodeAccepted(l);
  const digest = claimDigestOf(d.sealedBounty, ev.claim, d.chainId);
  if (digest.toLowerCase() !== ev.claimDigest.toLowerCase()) {
    throw new RefuteError("inconsistent_event", `ClaimAccepted ${l.txHash} : la réclamation émise ne redonne pas son digest (autre domaine EIP-712 ?)`);
  }
  if (claimOperatorsHash(ev.operators).toLowerCase() !== st.opsHash.toLowerCase()) {
    throw new RefuteError("inconsistent_event", `ClaimAccepted ${l.txHash} : opérateurs émis ≠ claimRecords.opsHash`);
  }
  const end = st.acceptedAt + ctx.window;
  return {
    claimDigest: digest, claim: ev.claim, operators: ev.operators, amount: ev.amount, acceptedAt: st.acceptedAt, refuted: st.refuted,
    refuteWindowEndsAt: end, checkedAtBlock: head, checkedAtTimestamp: ctx.ts, windowOpen: !st.refuted && ctx.ts <= end,
    block: l.blockNumber, txHash: l.txHash,
  };
}

/**
 * Une réclamation acceptée, par son digest : claimRecords (état), puis l'événement ClaimAccepted (réclamation, opérateurs),
 * cherché à partir du bloc de l'acceptation (retrouvé par son horodatage, ou `fromBlock`).
 */
export async function readAcceptedClaim(
  pub: PublicClient,
  a: { claimDigest: Hex; deployment?: Deployment; fromBlock?: bigint; toBlock?: bigint },
): Promise<AcceptedClaim> {
  const d = a.deployment ?? testnet;
  if (!isBytes32(a.claimDigest)) throw new RefuteError("bad_input", "digest de réclamation : bytes32 attendu (0x + 64 caractères hexadécimaux)");
  const head = a.toBlock ?? (await pub.getBlockNumber());
  const st = await claimState(pub, d, a.claimDigest, head);
  if (st.acceptedAt === 0n) {
    throw new RefuteError("unknown_claim", `réclamation ${a.claimDigest} inconnue de SealedBounty ${d.sealedBounty} (jamais acceptée) : rien à réfuter`);
  }
  const from = a.fromBlock ?? (await firstBlockAtOrAfter(pub, st.acceptedAt, d.deployBlock, head));
  const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ClaimAccepted", args: { claimDigest: a.claimDigest } }) as (Hex | null)[];
  const logs = await scanLogs(pub, { address: d.sealedBounty, topics, fromBlock: from, toBlock: head, firstOnly: true });
  const log = logs.find((l) => l.topics[2]?.toLowerCase() === a.claimDigest.toLowerCase());
  if (!log) throw new RefuteError("event_not_found", `événement ClaimAccepted introuvable pour ${a.claimDigest} (blocs ${from} à ${head})`);
  return toAccepted(d, log, st, head, await chainContext(pub, d, head));
}

/** Les réclamations acceptées d'une prime (événements ClaimAccepted, du plus ancien au plus récent), avec leur état. */
export async function listAcceptedClaims(
  pub: PublicClient,
  a: { bountyId: bigint; deployment?: Deployment; fromBlock?: bigint; toBlock?: bigint },
): Promise<AcceptedClaim[]> {
  const d = a.deployment ?? testnet;
  const head = a.toBlock ?? (await pub.getBlockNumber());
  const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ClaimAccepted", args: { bountyId: a.bountyId } }) as (Hex | null)[];
  const logs = await scanLogs(pub, { address: d.sealedBounty, topics, fromBlock: a.fromBlock ?? d.deployBlock, toBlock: head });
  if (!logs.length) return [];
  const ctx = await chainContext(pub, d, head);
  const out: AcceptedClaim[] = [];
  for (const l of logs) {
    const digest = l.topics[2] as Hex;
    out.push(toAccepted(d, l, await claimState(pub, d, digest, head), head, ctx));
  }
  return out;
}

/** Le rapport cP livré pour cette réclamation (événement ExploitDelivered dont keccak256(cP) = cPHash), s'il l'est. */
export async function findDeliveredReport(
  pub: PublicClient,
  a: { bountyId: bigint; cPHash: Hex; deployment?: Deployment; fromBlock?: bigint; toBlock?: bigint },
): Promise<{ cP: Hex; block: bigint; txHash: Hex } | undefined> {
  const d = a.deployment ?? testnet;
  const head = a.toBlock ?? (await pub.getBlockNumber());
  const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ExploitDelivered", args: { bountyId: a.bountyId } }) as (Hex | null)[];
  const logs = await scanLogs(pub, { address: d.sealedBounty, topics, fromBlock: a.fromBlock ?? d.deployBlock, toBlock: head });
  for (const l of logs) {
    const ev = decodeEventLog({ abi: sealedBountyAbi, eventName: "ExploitDelivered", topics: l.topics as [Hex, ...Hex[]], data: l.data });
    const cP = (ev.args as any).cP as Hex;
    if (keccak256(cP).toLowerCase() === a.cPHash.toLowerCase()) return { cP, block: l.blockNumber, txHash: l.txHash };
  }
  return undefined;
}

// ---------- 2. la source de l'exploit ----------

/** Ce qui est chiffré vers chaque enclave réfutante (le clair que lit RefutationService). */
export type RefuteSource =
  | { from: "hunter"; bountyId: bigint; payee: Address; exploit: ExploitInput; r: Hex }
  | { from: "protocol"; cP: Hex; sharedSecret: Hex }
  | { from: "protocol"; cP: Hex; protocolPrivateKey: Hex };

/** Le chasseur : son bundle et l'aléa r avec lequel cP a été scellé (sans r, rien ne relie le bundle à cPHash). */
export function hunterRefuteSource(a: { bountyId: bigint; payee: Address; exploit: ExploitInput; r: Uint8Array | Hex }): RefuteSource {
  validateExploit(a.exploit);
  const r = typeof a.r === "string" ? a.r : toHex(a.r);
  if (!isBytes32(r)) throw new RefuteError("bad_input", "r : les 32 octets d'aléa utilisés pour sceller cP");
  return { from: "hunter", bountyId: a.bountyId, payee: a.payee, exploit: a.exploit, r };
}

/**
 * Le protocole, après deliver : le rapport cP et, par défaut, le SECRET X25519 de ce seul rapport (X25519(clé de la prime,
 * clé éphémère de cP) : il n'ouvre que lui). `revealKey` : la clé privée de la prime elle-même — seule façon pour l'enclave
 * de PROUVER qu'un rapport illisible n'en est pas un ; elle part chiffrée vers chaque enclave vérifiée (qui l'efface après
 * usage) et elle ouvre TOUT rapport chiffré vers sa clé publique : ceux de cette prime, et ceux de toute autre prime créée
 * avec la même clé (la CLI en crée une par prime depuis la v2.1 bis ; une clé partagée ouvre les rapports de toutes).
 */
export function protocolRefuteSource(a: { cP: Hex; protocolPrivateKey: Uint8Array | Hex; revealKey?: boolean }): RefuteSource {
  if (!isEvenHex(a.cP)) throw new RefuteError("bad_input", "cP : le rapport livré (hexadécimal, clé éphémère ‖ chiffré)");
  const priv = typeof a.protocolPrivateKey === "string" ? toBytes(a.protocolPrivateKey) : a.protocolPrivateKey;
  if (priv.length !== 32) throw new RefuteError("bad_input", "clé privée X25519 du protocole : 32 octets");
  if (a.revealKey) return { from: "protocol", cP: a.cP, protocolPrivateKey: toHex(priv) };
  let shared: Uint8Array;
  try {
    if ((a.cP.length - 2) / 2 < 32 + 16) throw new Error("trop court");
    shared = x25519.getSharedSecret(priv, toBytes(a.cP).slice(0, 32));
  } catch {
    throw new RefuteError("unreadable_report", "cP trop court ou clé éphémère invalide : ce n'est pas un scellé ; seul revealKey (la clé de la prime) permet de prouver que ce rapport n'en est pas un");
  }
  return { from: "protocol", cP: a.cP, sharedSecret: toHex(shared) };
}

export interface RefuteSourceCheck {
  mode: "hunter" | "protocol-secret" | "protocol-key";
  /** Le rapport s'ouvre et c'est un bundle canonique. */
  readable: boolean;
  /** Son contenu correspond à la réclamation (prime, bénéficiaire, prédicat, empreinte) : l'enclave rejouera ; sinon elle
   *  signera « non prouvée » sans rejeu (la réclamation contredit son propre rapport). */
  consistent: boolean;
  note: string;
}

/**
 * Contrôle LOCAL d'une source avant tout envoi : elle doit redonner le cPHash de la réclamation (sinon RefuteError
 * « source_mismatch » : ce n'est pas l'exploit réclamé). Avec le secret partagé, un rapport illisible ou non canonique ne
 * prouve rien (RefuteError « unreadable_report » : utiliser revealKey).
 */
export function checkRefuteSource(source: RefuteSource, claim: Claim, protocolX25519: Hex): RefuteSourceCheck {
  if (source.from === "hunter") {
    const cP = deterministicSeal(toBytes(protocolX25519), utf8(protocolCanonical(source)), toBytes(source.r));
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuteError("source_mismatch", "ce bundle et cet aléa r ne redonnent pas le cPHash de la réclamation : ce n'est pas l'exploit réclamé (rien n'est envoyé)");
    }
    return {
      mode: "hunter", readable: true,
      ...consistency({ bountyId: source.bountyId, payee: source.payee, predicate: source.exploit.predicate, txs: source.exploit.txs, attackCode: source.exploit.attackCode }, claim),
    };
  }
  if (keccak256(source.cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
    throw new RefuteError("source_mismatch", "keccak256(cP) ≠ cPHash de la réclamation : ce n'est pas son rapport (rien n'est envoyé)");
  }
  const withKey = "protocolPrivateKey" in source;
  const mode = withKey ? "protocol-key" : "protocol-secret";
  let plain: Uint8Array;
  try {
    if (withKey) {
      const priv = toBytes(source.protocolPrivateKey);
      if (toHex(x25519.getPublicKey(priv)).toLowerCase() !== protocolX25519.toLowerCase()) {
        throw new RefuteError("source_mismatch", "cette clé privée n'est pas celle de la prime (Bounty.protocolX25519)");
      }
      plain = deterministicOpen(priv, source.cP);
    } else {
      plain = openSealedWithSharedSecret(source.cP, toBytes(source.sharedSecret));
    }
  } catch (e) {
    if (e instanceof RefuteError) throw e;
    if (withKey) return { mode, readable: false, consistent: false, note: "rapport illisible avec la clé de la prime : les enclaves signeront « non prouvée » (cP n'est pas un rapport)" };
    throw new RefuteError("unreadable_report", "le rapport ne s'ouvre pas avec ce secret : s'il est illisible avec la clé de la prime, réfutez avec revealKey");
  }
  const content = canonicalReport(plain);
  if (content === "too_deep") {
    if (withKey) return { mode, readable: false, consistent: false, note: "rapport imbriqué au-delà des bornes : les enclaves signeront « non prouvée » (aucune enclave honnête ne l'aurait produit)" };
    throw new RefuteError("unreadable_report", "le rapport déchiffré est imbriqué au-delà des bornes : réfutez avec revealKey (la clé de la prime) pour le prouver");
  }
  if (!content) {
    if (withKey) return { mode, readable: false, consistent: false, note: "rapport non canonique : les enclaves signeront « non prouvée » (aucune enclave honnête ne l'aurait produit)" };
    throw new RefuteError("unreadable_report", "le rapport déchiffré n'est pas un bundle canonique : réfutez avec revealKey (la clé de la prime) pour le prouver");
  }
  return { mode, readable: true, ...consistency(content, claim) };
}

interface ReportContent { bountyId: bigint; payee: unknown; predicate: unknown; txs: unknown; attackCode?: unknown; capital?: bigint }

/** Imbrication maximale d'un rapport (racine + prédicat) : la même borne que l'enclave (MAX_REPORT_DEPTH). */
const MAX_REPORT_DEPTH = 1 + PREDICATE_MAX_DEPTH;

/** Le clair d'un rapport s'il est EXACTEMENT un bundle canonique (protocolCanonical), sinon undefined ; "too_deep" s'il est
 *  imbriqué au-delà des bornes (jamais sérialisé, comme dans l'enclave). */
function canonicalReport(plain: Uint8Array): ReportContent | "too_deep" | undefined {
  let text: string;
  let o: any;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
    o = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  if (jsonDepthExceeds(o, MAX_REPORT_DEPTH)) return "too_deep";
  let bountyId: bigint, capital: bigint;
  try {
    bountyId = BigInt(o.bountyId);
    capital = BigInt(o.capital);
  } catch {
    return undefined;
  }
  const again = JSON.stringify({
    bountyId: bountyId.toString(), payee: o.payee, capital: capital.toString(), predicate: o.predicate, txs: o.txs, attackCode: o.attackCode ?? null,
  });
  if (again !== text) return undefined;
  return { bountyId, payee: o.payee, capital, predicate: o.predicate, txs: o.txs, attackCode: o.attackCode ?? undefined };
}

function consistency(c: ReportContent, claim: Claim): { consistent: boolean; note: string } {
  const no = (note: string) => ({ consistent: false, note: `${note} : les enclaves signeront « non prouvée » sans rejouer` });
  if (c.bountyId !== claim.bountyId) return no(`le rapport vise la prime #${c.bountyId}, la réclamation la #${claim.bountyId}`);
  if (typeof c.payee !== "string" || c.payee.toLowerCase() !== claim.payee.toLowerCase()) return no(`le rapport paie ${String(c.payee)}, la réclamation ${claim.payee}`);
  const txs = c.txs;
  if (!Array.isArray(txs) || !txs.every(isEvenHex) || (c.attackCode !== undefined && !isEvenHex(c.attackCode))) return no("transactions ou code d'attaque mal formés");
  if (exploitFingerprint({ txs, attackCode: c.attackCode as Hex | undefined }).toLowerCase() !== claim.fingerprint.toLowerCase()) {
    return no("l'empreinte du rapport n'est pas celle de la réclamation (cP n'est pas l'exploit annoncé)");
  }
  let ph: Hex;
  try {
    ph = predicateHash(c.predicate as Predicate); // règles P1–P4 (comme l'enclave : faute prouvée si elles sont violées)
  } catch (e) {
    if (e instanceof PredicateError) return no(`prédicat du rapport hors règles (${e.message})`);
    throw e;
  }
  if (ph.toLowerCase() !== claim.predicateHash.toLowerCase()) return no("le prédicat du rapport n'est pas celui de la réclamation");
  return { consistent: true, note: `rapport cohérent avec la réclamation : les enclaves le rejoueront au bloc ${claim.blockN}` };
}

const SEAL_INFO_KEY = new TextEncoder().encode("arc-sealed-key-v1");
const SEAL_INFO_NONCE = new TextEncoder().encode("arc-sealed-nonce-v1");

/** Ouvre un scellé déterministe (cP) avec le SECRET PARTAGÉ X25519 au lieu de la clé privée ; lève si le chiffré ne
 *  s'authentifie pas (même construction que deterministicSeal). */
export function openSealedWithSharedSecret(sealed: Hex, shared: Uint8Array): Uint8Array {
  const bytes = toBytes(sealed);
  if (bytes.length < 32 + 16) throw new Error("scellé trop court");
  const ephPub = bytes.slice(0, 32);
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), SEAL_INFO_NONCE, 12);
  return chacha20poly1305(key, nonce).decrypt(bytes.slice(32));
}

/** Le clair JSON chiffré vers chaque enclave (format lu par RefutationService). */
function refutePlaintext(s: RefuteSource): string {
  if (s.from === "hunter") {
    return JSON.stringify({
      from: "hunter",
      bountyId: s.bountyId.toString(),
      payee: s.payee,
      capital: BigInt(s.exploit.capital ?? 0n).toString(),
      predicate: s.exploit.predicate,
      txs: s.exploit.txs,
      ...(s.exploit.attackCode ? { attackCode: s.exploit.attackCode } : {}),
      r: s.r,
    });
  }
  return JSON.stringify(s);
}

// ---------- 3. quorum, contre-rejeu, signatures ----------

export interface RefuteQuorumPlan {
  /** Opérateurs distincts nécessaires (refutersNeeded). */
  needed: number;
  /** Opérateurs distincts éligibles : ni nuls, ni signataires de la réclamation. */
  eligibleOperators: Address[];
  reachable: boolean;
  message: string;
}

/**
 * Le quorum est-il atteignable avec ces opérateurs candidats (ceux des enclaves vérifiées, ou ceux du réseau pour le
 * produit) ? Les signataires de la réclamation ne comptent pas (le contrat les refuse : RefuterIsClaimOperator).
 */
export function refuteQuorumPlan(a: {
  claimOperators: readonly Address[];
  candidateOperators: readonly Address[];
  /** Pour le message : "enclaves" (défaut) = les enclaves données ; "network" = les opérateurs actifs du produit. */
  scope?: "enclaves" | "network";
}): RefuteQuorumPlan {
  const claimSet = new Set(a.claimOperators.map((o) => o.toLowerCase()));
  const seen = new Set<string>();
  const eligible: Address[] = [];
  let claimers = 0;
  for (const o of a.candidateOperators) {
    const k = o.toLowerCase();
    if (k === zeroAddress || seen.has(k)) continue;
    seen.add(k);
    if (claimSet.has(k)) claimers++;
    else eligible.push(getAddress(k));
  }
  const needed = refutersNeeded(a.claimOperators.length);
  const reachable = eligible.length >= needed;
  const where = a.scope === "network" ? "sur le réseau (opérateurs actifs du produit)" : "parmi les enclaves vérifiées";
  const rule = `il faut ${needed} opérateurs distincts (au moins ${REFUTE_QUORUM}, et plus que les ${a.claimOperators.length} de la réclamation), aucun signataire de la réclamation`;
  let message: string;
  if (reachable) message = `${eligible.length} opérateurs distincts éligibles ${where} ; ${rule}`;
  else if (eligible.length === 0 && claimers > 0) message = `quorum de réfutation non atteignable : ${where}, le${claimers > 1 ? "s" : ""} seul${claimers > 1 ? "s" : ""} opérateur${claimers > 1 ? "s" : ""} ${claimers > 1 ? "ont" : "a"} signé la réclamation ; ${rule}`;
  else if (eligible.length === 0) message = `quorum de réfutation non atteignable : aucun opérateur éligible ${where} ; ${rule}`;
  else if (eligible.length === 1) message = `quorum de réfutation non atteignable : un seul opérateur éligible ${where} (${eligible[0]}) ; ${rule}`;
  else message = `quorum de réfutation non atteignable : ${eligible.length} opérateurs éligibles ${where} ; ${rule}`;
  return { needed, eligibleOperators: eligible, reachable, message };
}

export interface RefuteEnclaveResult {
  enclaveUrl: string;
  /** refuted : réfutation signée et vérifiée ; confirmed : le contre-rejeu redonne la réclamation ; refused : l'enclave refuse
   *  (code) ; excluded : opérateur signataire de la réclamation (rien envoyé) ; unverified : clé non vérifiée on-chain (rien
   *  envoyé) ; skipped : éligible mais non interrogée (quorum non atteignable) ; error : réponse invalide ou injoignable. */
  status: "refuted" | "confirmed" | "refused" | "excluded" | "unverified" | "skipped" | "error";
  signer?: Address;
  /** Opérateur actif de l'enclave (vérifié on-chain). */
  operator?: Address;
  refutation?: Refutation;
  signature?: Hex;
  replay?: { blockN: bigint; replayed: boolean; satisfied: boolean; loss: bigint; tier: number; proven: boolean; note?: string };
  code?: string;
  reason?: string;
}

export interface RefuteRound {
  claimDigest: Hex;
  needed: number;
  /** ready : quorum atteint sur UNE réfutation ; unreachable : pas assez d'opérateurs éligibles, RIEN n'a été envoyé ;
   *  confirmed : les enclaves qui ont rejoué redonnent la réclamation ; insufficient : envoyé, signatures insuffisantes. */
  status: "ready" | "unreachable" | "confirmed" | "insufficient";
  message: string;
  results: RefuteEnclaveResult[];
  refutation?: Refutation;
  /** Une signature par opérateur distinct (au plus REFUTE_MAX_SIGNATURES). */
  signatures?: Hex[];
  refuters?: Address[];
  confirmations: number;
  /** Des enclaves vérifiées ne sont pas d'accord entre elles (résultats différents, ou confirmée ET réfutée). */
  disagreement: boolean;
}

const claimToJson = (c: Claim) => ({
  bountyId: c.bountyId.toString(), payee: c.payee, blockN: c.blockN.toString(), blockHashN: c.blockHashN, predicateHash: c.predicateHash,
  loss: c.loss.toString(), tier: c.tier, fingerprint: c.fingerprint, cPHash: c.cPHash, deadline: c.deadline.toString(),
});

const describeRefutation = (f: Refutation) => (f.proven ? `prouvée, perte ${f.loss}, palier ${f.tier}` : "non prouvée");

/**
 * Demande une réfutation à plusieurs enclaves Prime scellée. Rien n'est chiffré vers une enclave dont la clé n'est pas
 * celle inscrite on-chain ; rien n'est envoyé du tout si la réclamation est réfutée ou hors fenêtre, si la source ne redonne
 * pas son cPHash, ou si le quorum n'est pas atteignable avec les enclaves vérifiées (status « unreachable », message clair).
 */
export async function requestRefutations(a: {
  accepted: AcceptedClaim;
  source: RefuteSource;
  enclaveUrls: string[];
  /** Produit de la prime (Bounty.productId, lu on-chain). */
  productId: bigint;
  /** Clé X25519 du protocole (Bounty.protocolX25519, lue on-chain). */
  protocolX25519: Hex;
  publicClient: PublicClient;
  deployment?: Deployment;
  fetch?: typeof fetch;
  /** Délai d'un contre-rejeu (ms, défaut 180 000). */
  timeoutMs?: number;
}): Promise<RefuteRound> {
  const d = a.deployment ?? testnet;
  const { claim, operators } = a.accepted;
  const digest = claimDigestOf(d.sealedBounty, claim, d.chainId);
  if (digest.toLowerCase() !== a.accepted.claimDigest.toLowerCase()) throw new RefuteError("inconsistent_event", "le digest de la réclamation ne correspond pas à ce déploiement");
  if (a.accepted.refuted) throw new RefuteError("already_refuted", `réclamation ${digest} déjà réfutée`);
  if (!a.accepted.windowOpen) throw new RefuteError("window_over", `fenêtre de réfutation close depuis ${a.accepted.refuteWindowEndsAt} (acceptée à ${a.accepted.acceptedAt})`);
  checkRefuteSource(a.source, claim, a.protocolX25519); // lève : rien n'est envoyé

  // clés vérifiées on-chain AVANT tout envoi ; les opérateurs de la réclamation sont écartés
  const results: RefuteEnclaveResult[] = [];
  const targets: Array<{ k: VerifiedEnclaveKeys; i: number }> = [];
  const claimSet = new Set(operators.map((o) => o.toLowerCase()));
  for (const url of a.enclaveUrls) {
    let k: VerifiedEnclaveKeys;
    try {
      k = await verifyEnclaveKeys(url, a.productId, { publicClient: a.publicClient, deployment: d, fetch: a.fetch });
    } catch (e) {
      results.push({ enclaveUrl: url, status: e instanceof EnclaveKeyMismatchError ? "unverified" : "error", reason: (e as Error).message });
      continue;
    }
    if (claimSet.has(k.operator.toLowerCase())) {
      results.push({
        enclaveUrl: k.enclaveUrl, signer: k.signer, operator: k.operator, status: "excluded",
        reason: "opérateur signataire de la réclamation : le contrat refuserait sa signature (RefuterIsClaimOperator)",
      });
      continue;
    }
    targets.push({ k, i: results.length });
    results.push({ enclaveUrl: k.enclaveUrl, signer: k.signer, operator: k.operator, status: "skipped", reason: "non interrogée : quorum non atteignable" });
  }
  const plan = refuteQuorumPlan({ claimOperators: operators, candidateOperators: results.filter((r) => r.operator).map((r) => r.operator!) });
  const base = { claimDigest: digest, needed: plan.needed, results, confirmations: 0, disagreement: false };
  if (!plan.reachable) return { ...base, status: "unreachable", message: `${plan.message} : rien n'a été envoyé aux enclaves` };

  // contre-rejeu (en parallèle : une enclave par machine)
  const plaintext = utf8(refutePlaintext(a.source));
  const f = a.fetch ?? globalThis.fetch;
  await Promise.all(targets.map(async ({ k, i }) => {
    results[i] = await askOne(f, k, { claim, operators, digest, plaintext, d, timeoutMs: a.timeoutMs });
  }));
  plaintext.fill(0);

  // réunir les signatures : toutes sur la MÊME Refutation, une par opérateur distinct
  const groups = new Map<string, { f: Refutation; byOp: Map<string, { op: Address; sig: Hex }> }>();
  for (const r of results) {
    if (r.status !== "refuted" || !r.refutation || !r.signature || !r.operator) continue;
    const key = `${r.refutation.proven}:${r.refutation.loss}:${r.refutation.tier}`;
    const g = groups.get(key) ?? { f: r.refutation, byOp: new Map() };
    if (!g.byOp.has(r.operator.toLowerCase())) g.byOp.set(r.operator.toLowerCase(), { op: r.operator, sig: r.signature });
    groups.set(key, g);
  }
  let best: { f: Refutation; byOp: Map<string, { op: Address; sig: Hex }> } | undefined;
  for (const g of groups.values()) if (!best || g.byOp.size > best.byOp.size) best = g;
  const confirmations = results.filter((r) => r.status === "confirmed").length;
  const refutedCount = results.filter((r) => r.status === "refuted").length;
  const disagreement = groups.size > 1 || (confirmations > 0 && refutedCount > 0);
  const warn = disagreement
    ? ` — attention : désaccord entre enclaves vérifiées (${confirmations} confirment, ${refutedCount} réfutent, ${groups.size} résultat(s) différent(s))`
    : "";
  if (best && best.byOp.size >= plan.needed) {
    const picked = [...best.byOp.values()].slice(0, REFUTE_MAX_SIGNATURES);
    return {
      ...base, status: "ready", confirmations, disagreement, refutation: best.f, signatures: picked.map((x) => x.sig), refuters: picked.map((x) => x.op),
      message: `réfutation prête : ${picked.length} opérateurs distincts signent « ${describeRefutation(best.f)} » (il en faut ${plan.needed})${warn}`,
    };
  }
  if (refutedCount === 0 && confirmations > 0) {
    return { ...base, status: "confirmed", confirmations, disagreement, message: `la réclamation se reproduit : ${confirmations} enclave(s) la confirment, aucune réfutation signée` };
  }
  return {
    ...base, status: "insufficient", confirmations, disagreement,
    message: `réfutation insuffisante : ${best ? best.byOp.size : 0} opérateur(s) distinct(s) signent le même résultat, il en faut ${plan.needed}${warn}`,
  };
}

async function askOne(
  f: typeof fetch,
  k: VerifiedEnclaveKeys,
  o: { claim: Claim; operators: Address[]; digest: Hex; plaintext: Uint8Array; d: Deployment; timeoutMs?: number },
): Promise<RefuteEnclaveResult> {
  const who = { enclaveUrl: k.enclaveUrl, signer: k.signer, operator: k.operator };
  const err = (reason: string): RefuteEnclaveResult => ({ ...who, status: "error", reason });
  let j: any;
  try {
    const sealed = await hpkeSeal(toBytes(k.x25519), o.plaintext, refuteRequestAad(o.digest));
    const res = await f(`${k.enclaveUrl}/v1/refute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim: claimToJson(o.claim), operators: o.operators, enc: toHex(sealed.enc), ciphertext: toHex(sealed.ciphertext) }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
    });
    const text = await res.text();
    try {
      j = JSON.parse(text);
    } catch {
      return err(`réponse non JSON (HTTP ${res.status}) : ${text.slice(0, 160)}`);
    }
    if (!res.ok) return err(`HTTP ${res.status} ${j?.error ?? text.slice(0, 160)}`);
  } catch (e) {
    return err(`injoignable : ${(e as Error).message}`);
  }
  let replay: RefuteEnclaveResult["replay"];
  try {
    if (j?.replay) {
      replay = {
        blockN: BigInt(j.replay.blockN), replayed: j.replay.replayed === true, satisfied: j.replay.satisfied === true, loss: BigInt(j.replay.loss),
        tier: Number(j.replay.tier), proven: j.replay.proven === true, ...(typeof j.replay.note === "string" ? { note: j.replay.note } : {}),
      };
    }
  } catch {
    return err("compte rendu de rejeu illisible");
  }
  if (j?.status === "confirmed") return { ...who, status: "confirmed", replay, reason: String(j.reason ?? "") };
  if (j?.status === "refused") return { ...who, status: "refused", code: String(j.code ?? ""), reason: String(j.reason ?? "") };
  if (j?.status !== "refuted") return err(`statut inattendu : ${JSON.stringify(j).slice(0, 160)}`);
  // la réfutation : sur CE digest, contradictoire, signée par l'enclave VÉRIFIÉE
  let ref: Refutation;
  try {
    if (typeof j.refutation?.proven !== "boolean") throw new Error();
    ref = { claimDigest: j.refutation.claimDigest as Hex, proven: j.refutation.proven, loss: BigInt(j.refutation.loss), tier: Number(j.refutation.tier) };
    if (!isBytes32(ref.claimDigest) || !Number.isInteger(ref.tier) || ref.tier < 0 || ref.tier > 255 || ref.loss < 0n) throw new Error();
  } catch {
    return err("réfutation mal formée");
  }
  if (ref.claimDigest.toLowerCase() !== o.digest.toLowerCase()) return err("la réfutation porte sur une autre réclamation");
  if (ref.proven && ref.loss === o.claim.loss && ref.tier === o.claim.tier) return err("cette « réfutation » ne contredit pas la réclamation (le contrat la refuserait : NotARefutation)");
  let signer: Address;
  try {
    signer = await recoverRefutationSigner(o.d.sealedBounty, ref, j.signature as Hex, o.d.chainId);
  } catch {
    return err("signature illisible");
  }
  if (signer.toLowerCase() !== k.signer.toLowerCase()) return err(`réfutation signée par ${signer}, pas par l'enclave vérifiée ${k.signer}`);
  return { ...who, status: "refuted", refutation: ref, signature: j.signature as Hex, replay };
}

// ---------- 4. l'appel refute ----------

/** refute(claim, ops, refutation, signatures) prêt à simuler (simulateContract) puis envoyer, avec une marge de gaz. */
export function prepareRefuteCall(accepted: AcceptedClaim, round: RefuteRound, deployment?: Deployment) {
  const d = deployment ?? testnet;
  if (round.status !== "ready" || !round.refutation || !round.signatures?.length) throw new RefuteError("not_ready", `réfutation non prête : ${round.message}`);
  if (round.claimDigest.toLowerCase() !== accepted.claimDigest.toLowerCase()) throw new RefuteError("not_ready", "réfutation d'une autre réclamation");
  return {
    address: d.sealedBounty,
    abi: sealedBountyAbi,
    functionName: "refute" as const,
    args: [accepted.claim, accepted.operators, round.refutation, round.signatures] as const,
  };
}

function isBytes32(x: unknown): x is Hex {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}

function isEvenHex(x: unknown): x is Hex {
  return typeof x === "string" && EVEN_HEX.test(x);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
