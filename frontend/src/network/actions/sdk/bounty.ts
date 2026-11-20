/** bounty.ts — the hunter's path through the Sealed Bounty, written once and shared by the CLI, the scripts and the site.
 *
 *  1. cP = a DETERMINISTIC seal (randomness r) to the PROTOCOL's X25519 key, read on-chain (Bounty.protocolX25519), in
 *     the canonical form the enclave recomputes (DeterministicProtocolCipher, enclave/src/services/bounty.ts);
 *  2. cE = HPKE to the ENCLAVE's X25519 key, VERIFIED on-chain (VerifiedEnclaveKeys, see enclave-keys.ts): never to a
 *     key read from /pubkeys without a check, or the proxy that serves /pubkeys could read the exploit;
 *  3. the enclave replays the exploit and signs a claim; the claim is checked (signer = the verified enclave, cP,
 *     predicate, payee, fingerprint) BEFORE it is submitted: acceptClaim (reserves the payment, cP kept out of the
 *     transaction), then deliver (hands over cP, pays).
 *  For a bounty with k enclaves: the same r, the same block N and the same deadline for each → the same claim, k
 *  signatures.
 *
 *  REFUTING an accepted claim (SealedBounty.refute): see the section at the end of the file. */
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
  /** The attack's transactions, abi.encode(address to, uint256 value, bytes data) (encodeExploitTx), 1 to 10. */
  txs: Hex[];
  /** Declared capital (base units), default 0. */
  capital?: bigint | string;
  /** Optional bytecode to deploy before the transactions. */
  attackCode?: Hex;
}

export interface SealedExploit {
  bountyId: bigint;
  payee: Address;
  /** Encrypted to the protocol (delivered on-chain by deliver). */
  cP: Hex;
  /** Encrypted to the verified enclave: the body of POST {enclave}/bounty/submit. */
  submitBody: { bountyId: string; enc: Hex; ciphertext: Hex };
  /** Canonical fingerprint of the exploit (key of the claim, of deliver and of the duplicate check). */
  fingerprint: Hex;
  predicateHash: Hex;
  /** The target enclave (keys verified on-chain). */
  enclave: VerifiedEnclaveKeys;
  /** Anchor imposed on the k enclaves, if any. */
  blockN?: bigint;
  deadline?: bigint;
}

const EVEN_HEX = /^0x([0-9a-fA-F]{2})*$/;

/** Validates the exploit (same rules as the enclave: the predicate (rules P1–P4 of predicate.ts, PredicateError),
 *  even-length hex, 1 to 10 transactions). */
export function validateExploit(x: ExploitInput): void {
  validatePredicate(x.predicate);
  if (!Array.isArray(x.txs) || x.txs.length < 1 || x.txs.length > 10 || !x.txs.every((t) => typeof t === "string" && EVEN_HEX.test(t))) {
    throw new Error("exploit: \"txs\" must be a list of 1 to 10 transactions in even-length hex (encodeExploitTx)");
  }
  if (x.attackCode !== undefined && !(typeof x.attackCode === "string" && EVEN_HEX.test(x.attackCode))) {
    throw new Error("exploit: \"attackCode\" must be even-length hex");
  }
  if (x.capital !== undefined && !/^\d+$/.test(String(x.capital))) throw new Error("exploit: \"capital\" must be an integer ≥ 0");
}

/** The canonical form from which the enclave recomputes cP (DeterministicProtocolCipher): same keys, same order. */
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
 * Encrypts an exploit for ONE verified enclave (and for the protocol). `protocolX25519` must come from the chain
 * (getBounty(bountyId).protocolX25519), never from a server. For k enclaves: pass the same `r`, `blockN`, `deadline`.
 */
export async function sealExploitForEnclave(a: {
  bountyId: bigint;
  payee: Address;
  exploit: ExploitInput;
  protocolX25519: Hex;
  enclave: VerifiedEnclaveKeys;
  /** 32 random bytes for cP (default: drawn here). The same for the k enclaves of one claim. */
  r?: Uint8Array;
  /** Block N of the replay, in [head − 256, head − 2] (the same for the k enclaves). */
  blockN?: bigint;
  /** Deadline of the claim (Unix seconds), in ]now, now + 10 min]. */
  deadline?: bigint;
}): Promise<SealedExploit> {
  assertVerifiedEnclaveKeys(a.enclave); // never encrypt to a key that was not checked against the chain
  validateExploit(a.exploit);
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.protocolX25519)) throw new Error("protocolX25519: 32 bytes expected (read on-chain)");
  const r = a.r ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
  if (r.length !== 32) throw new Error("r: 32 bytes expected");
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
  if (!a.r) r.fill(0); // randomness drawn here serves only this encryption
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
    super(`not proven by the enclave: ${reason}`);
    this.name = "ExploitNotProvenError";
  }
}

/** Checks of a signed claim before anything is sent on-chain (what the contract would not forgive). */
export async function checkProvenClaim(
  sealed: SealedExploit,
  res: { claim: unknown; signature: Hex; cP: Hex },
  o: { sealedBounty: Address; chainId: number },
): Promise<ProvenClaim> {
  const claim = normalizeClaim(res.claim);
  const fail = (m: string): never => { throw new Error(`claim refused before sending: ${m}`); };
  const signer = await recoverTypedDataAddress({
    domain: networkDomain(o.sealedBounty, o.chainId) as TypedDataDomain,
    types: claimTypes, primaryType: "Claim", message: claim, signature: res.signature,
  });
  if (signer.toLowerCase() !== sealed.enclave.signer.toLowerCase()) fail(`signed by ${signer}, not by the verified enclave ${sealed.enclave.signer}`);
  if (claim.bountyId !== sealed.bountyId) fail(`bounty #${claim.bountyId} instead of #${sealed.bountyId}`);
  if (claim.payee.toLowerCase() !== sealed.payee.toLowerCase()) fail(`payee ${claim.payee} instead of ${sealed.payee}`);
  if (claim.predicateHash.toLowerCase() !== sealed.predicateHash.toLowerCase()) fail("predicateHash differs from the exploit's");
  if (claim.fingerprint.toLowerCase() !== sealed.fingerprint.toLowerCase()) fail("fingerprint differs from the exploit's");
  if (res.cP.toLowerCase() !== sealed.cP.toLowerCase()) fail("the cP returned is not the one encrypted here");
  if (keccak256(res.cP).toLowerCase() !== claim.cPHash.toLowerCase()) fail("keccak256(cP) ≠ cPHash");
  if (sealed.blockN !== undefined && claim.blockN !== sealed.blockN) fail(`block N ${claim.blockN} instead of ${sealed.blockN}`);
  if (sealed.deadline !== undefined && claim.deadline !== sealed.deadline) fail(`deadline ${claim.deadline} instead of ${sealed.deadline}`);
  return { claim, signature: res.signature, cP: res.cP, signer };
}

/**
 * POST {enclave}/bounty/submit with the encrypted bundle, then a check of the returned claim (checkProvenClaim).
 * Throws ExploitNotProvenError if the enclave does not prove the exploit.
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
  try { j = JSON.parse(text); } catch { throw new Error(`${sealed.enclave.enclaveUrl}/bounty/submit: non-JSON answer (HTTP ${res.status}): ${text.slice(0, 160)}`); }
  if (!res.ok) throw new Error(`${sealed.enclave.enclaveUrl}/bounty/submit : HTTP ${res.status} ${j?.error ?? text.slice(0, 160)}`);
  if (j?.status !== "proven") throw new ExploitNotProvenError(String(j?.reason ?? j?.error ?? JSON.stringify(j)));
  return checkProvenClaim(sealed, { claim: j.claim, signature: j.signature as Hex, cP: j.cP as Hex }, o);
}

// ======================================================================================================================
// REFUTING an accepted claim (SealedBounty.refute)
// ======================================================================================================================
//  1. readAcceptedClaim / listAcceptedClaims: the claim and its operators from the ClaimAccepted event, its state from
//     claimRecords (accepted, not refuted, REFUTE_WINDOW), opsHash checked;
//  2. the exploit's source, checked HERE before anything is sent (it must give back the claim's cPHash):
//     - the hunter: bundle + randomness r (the enclave recomputes cP);
//     - the protocol, after deliver: cP + the X25519 secret of THIS report (it opens only that one), or, if the report is
//       unreadable, the bounty's private key (revealKey: the only possible proof that an unreadable report is not one);
//  3. requestRefutations: each enclave's keys verified on-chain BEFORE anything is sent (verifyEnclaveKeys), the claim's
//     operators' enclaves set aside, the quorum computed BEFORE anything is sent (at least REFUTE_QUORUM distinct
//     operators, and more than the claim's): out of reach → nothing goes out; otherwise a counter-replay, signatures
//     verified, then grouped by result (all sign the SAME Refutation) and by distinct operator;
//  4. prepareRefuteCall: refute(claim, ops, refutation, signatures), to simulate, then send (with a gas margin: the
//     contract requires VERDICT_GAS before the ERC-8004 verdict).

/** SealedBounty.REFUTE_QUORUM: at least 2 distinct operators behind a refutation. */
export const REFUTE_QUORUM = 2;
/** SealedBounty.REFUTE_WINDOW: 3 days after acceptance (the on-chain value is authoritative: readAcceptedClaim reads it). */
export const REFUTE_WINDOW_SECONDS = 259_200n;
/** SealedBounty._countRefuters: at most 2 × MAX_SIGS signatures. */
export const REFUTE_MAX_SIGNATURES = 2 * BOUNTY_MAX_SIGS;
/** HPKE aad of a refutation request (identical to the enclave's, enclave/src/services/bounty.ts). */
export const REFUTE_AAD_LABEL = "arc-sealed-bounty/refute/v1";
/** eth_getLogs chunk size (Arc's public RPC caps the range). */
const LOG_CHUNK = 5_000n;

export function refuteRequestAad(claimDigest: Hex): Uint8Array {
  return new TextEncoder().encode(`${REFUTE_AAD_LABEL}:${claimDigest.toLowerCase()}`);
}

/** keccak256(abi.encode(operators)) = ClaimRecord.opsHash (in ClaimAccepted's order). */
export function claimOperatorsHash(operators: readonly Address[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [operators as Address[]]));
}

/** Distinct operators needed behind a refutation: at least REFUTE_QUORUM, and STRICTLY more than the claim's. */
export function refutersNeeded(claimOperators: number): number {
  return Math.max(REFUTE_QUORUM, claimOperators + 1);
}

/** EIP-712 digest of a refutation (what SealedBounty._countRefuters recovers). */
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

// ---------- 1. the accepted claim ----------

export interface AcceptedClaim {
  /** EIP-712 digest (key of claimRecords, carried by the refutation). */
  claimDigest: Hex;
  claim: Claim;
  /** Signing operators, as emitted by ClaimAccepted (passed back as is to refute). */
  operators: Address[];
  /** Amount reserved for the hunter. */
  amount: bigint;
  /** Timestamp of the acceptance (claimRecords.acceptedAt). */
  acceptedAt: bigint;
  refuted: boolean;
  /** acceptedAt + REFUTE_WINDOW (lu on-chain). */
  refuteWindowEndsAt: bigint;
  /** Block and timestamp of the read; the window is open if checkedAtTimestamp ≤ refuteWindowEndsAt (as in the contract). */
  checkedAtBlock: bigint;
  checkedAtTimestamp: bigint;
  windowOpen: boolean;
  /** Block and transaction of the acceptance. */
  block: bigint;
  txHash: Hex;
}

interface RawLog { topics: Hex[]; data: Hex; blockNumber: bigint; txHash: Hex }

/** eth_getLogs in chunks (oldest first); a failed chunk throws: a list is never silently truncated. */
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

/** First block of [lo, hi] whose timestamp is ≥ ts (binary search). */
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
    throw new RefuteError("inconsistent_event", `ClaimAccepted ${l.txHash}: the emitted claim does not give back its digest (another EIP-712 domain?)`);
  }
  if (claimOperatorsHash(ev.operators).toLowerCase() !== st.opsHash.toLowerCase()) {
    throw new RefuteError("inconsistent_event", `ClaimAccepted ${l.txHash}: emitted operators ≠ claimRecords.opsHash`);
  }
  const end = st.acceptedAt + ctx.window;
  return {
    claimDigest: digest, claim: ev.claim, operators: ev.operators, amount: ev.amount, acceptedAt: st.acceptedAt, refuted: st.refuted,
    refuteWindowEndsAt: end, checkedAtBlock: head, checkedAtTimestamp: ctx.ts, windowOpen: !st.refuted && ctx.ts <= end,
    block: l.blockNumber, txHash: l.txHash,
  };
}

/**
 * An accepted claim, by its digest: claimRecords (state), then the ClaimAccepted event (claim, operators), searched from
 * the block of the acceptance (found from its timestamp, or `fromBlock`).
 */
export async function readAcceptedClaim(
  pub: PublicClient,
  a: { claimDigest: Hex; deployment?: Deployment; fromBlock?: bigint; toBlock?: bigint },
): Promise<AcceptedClaim> {
  const d = a.deployment ?? testnet;
  if (!isBytes32(a.claimDigest)) throw new RefuteError("bad_input", "claim digest: bytes32 expected (0x + 64 hex characters)");
  const head = a.toBlock ?? (await pub.getBlockNumber());
  const st = await claimState(pub, d, a.claimDigest, head);
  if (st.acceptedAt === 0n) {
    throw new RefuteError("unknown_claim", `claim ${a.claimDigest} unknown to SealedBounty ${d.sealedBounty} (never accepted): nothing to refute`);
  }
  const from = a.fromBlock ?? (await firstBlockAtOrAfter(pub, st.acceptedAt, d.deployBlock, head));
  const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ClaimAccepted", args: { claimDigest: a.claimDigest } }) as (Hex | null)[];
  const logs = await scanLogs(pub, { address: d.sealedBounty, topics, fromBlock: from, toBlock: head, firstOnly: true });
  const log = logs.find((l) => l.topics[2]?.toLowerCase() === a.claimDigest.toLowerCase());
  if (!log) throw new RefuteError("event_not_found", `no ClaimAccepted event found for ${a.claimDigest} (blocks ${from} to ${head})`);
  return toAccepted(d, log, st, head, await chainContext(pub, d, head));
}

/** The accepted claims of a bounty (ClaimAccepted events, oldest first), with their state. */
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

/** The cP report delivered for this claim (the ExploitDelivered event whose keccak256(cP) = cPHash), if it was. */
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

// ---------- 2. the exploit's source ----------

/** What is encrypted to each refuting enclave (the plaintext RefutationService reads). */
export type RefuteSource =
  | { from: "hunter"; bountyId: bigint; payee: Address; exploit: ExploitInput; r: Hex }
  | { from: "protocol"; cP: Hex; sharedSecret: Hex }
  | { from: "protocol"; cP: Hex; protocolPrivateKey: Hex };

/** The hunter: their bundle and the randomness r cP was sealed with (without r, nothing links the bundle to cPHash). */
export function hunterRefuteSource(a: { bountyId: bigint; payee: Address; exploit: ExploitInput; r: Uint8Array | Hex }): RefuteSource {
  validateExploit(a.exploit);
  const r = typeof a.r === "string" ? a.r : toHex(a.r);
  if (!isBytes32(r)) throw new RefuteError("bad_input", "r: the 32 random bytes used to seal cP");
  return { from: "hunter", bountyId: a.bountyId, payee: a.payee, exploit: a.exploit, r };
}

/**
 * The protocol, after deliver: the cP report and, by default, the X25519 SECRET of this one report (X25519(bounty key,
 * cP's ephemeral key): it opens only that report). `revealKey`: the bounty's private key itself, the only way for the
 * enclave to PROVE that an unreadable report is not one; it leaves encrypted to each verified enclave (which erases it
 * after use) and it opens EVERY report encrypted to its public key: those of this bounty, and those of any other bounty
 * created with the same key (the CLI creates one key per bounty; a shared key opens the reports of all of them).
 */
export function protocolRefuteSource(a: { cP: Hex; protocolPrivateKey: Uint8Array | Hex; revealKey?: boolean }): RefuteSource {
  if (!isEvenHex(a.cP)) throw new RefuteError("bad_input", "cP: the delivered report (hex, ephemeral key ‖ ciphertext)");
  const priv = typeof a.protocolPrivateKey === "string" ? toBytes(a.protocolPrivateKey) : a.protocolPrivateKey;
  if (priv.length !== 32) throw new RefuteError("bad_input", "the protocol's X25519 private key: 32 bytes");
  if (a.revealKey) return { from: "protocol", cP: a.cP, protocolPrivateKey: toHex(priv) };
  let shared: Uint8Array;
  try {
    if ((a.cP.length - 2) / 2 < 32 + 16) throw new Error("trop court");
    shared = x25519.getSharedSecret(priv, toBytes(a.cP).slice(0, 32));
  } catch {
    throw new RefuteError("unreadable_report", "cP too short or invalid ephemeral key: this is not a seal; only revealKey (the bounty key) can prove that this report is not one");
  }
  return { from: "protocol", cP: a.cP, sharedSecret: toHex(shared) };
}

export interface RefuteSourceCheck {
  mode: "hunter" | "protocol-secret" | "protocol-key";
  /** The report opens and is a canonical bundle. */
  readable: boolean;
  /** Its content matches the claim (bounty, payee, predicate, fingerprint): the enclave will replay it; otherwise it
   *  signs "not proven" without a replay (the claim contradicts its own report). */
  consistent: boolean;
  note: string;
}

/**
 * LOCAL check of a source before anything is sent: it must give back the claim's cPHash (otherwise RefuteError
 * "source_mismatch": it is not the claimed exploit). With the shared secret, an unreadable or non-canonical report proves
 * nothing (RefuteError "unreadable_report": use revealKey).
 */
export function checkRefuteSource(source: RefuteSource, claim: Claim, protocolX25519: Hex): RefuteSourceCheck {
  if (source.from === "hunter") {
    const cP = deterministicSeal(toBytes(protocolX25519), utf8(protocolCanonical(source)), toBytes(source.r));
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuteError("source_mismatch", "this bundle and this random r do not give back the claim's cPHash: this is not the claimed exploit (nothing is sent)");
    }
    return {
      mode: "hunter", readable: true,
      ...consistency({ bountyId: source.bountyId, payee: source.payee, predicate: source.exploit.predicate, txs: source.exploit.txs, attackCode: source.exploit.attackCode }, claim),
    };
  }
  if (keccak256(source.cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
    throw new RefuteError("source_mismatch", "keccak256(cP) ≠ the claim's cPHash: this is not its report (nothing is sent)");
  }
  const withKey = "protocolPrivateKey" in source;
  const mode = withKey ? "protocol-key" : "protocol-secret";
  let plain: Uint8Array;
  try {
    if (withKey) {
      const priv = toBytes(source.protocolPrivateKey);
      if (toHex(x25519.getPublicKey(priv)).toLowerCase() !== protocolX25519.toLowerCase()) {
        throw new RefuteError("source_mismatch", "this private key is not the bounty's (Bounty.protocolX25519)");
      }
      plain = deterministicOpen(priv, source.cP);
    } else {
      plain = openSealedWithSharedSecret(source.cP, toBytes(source.sharedSecret));
    }
  } catch (e) {
    if (e instanceof RefuteError) throw e;
    if (withKey) return { mode, readable: false, consistent: false, note: "report unreadable with the bounty key: the enclaves will sign \"not proven\" (cP is not a report)" };
    throw new RefuteError("unreadable_report", "the report does not open with this secret: if it is unreadable with the bounty key, refute with revealKey");
  }
  const content = canonicalReport(plain);
  if (content === "too_deep") {
    if (withKey) return { mode, readable: false, consistent: false, note: "report nested beyond the bounds: the enclaves will sign \"not proven\" (no honest enclave would have produced it)" };
    throw new RefuteError("unreadable_report", "the decrypted report is nested beyond the bounds: refute with revealKey (the bounty key) to prove it");
  }
  if (!content) {
    if (withKey) return { mode, readable: false, consistent: false, note: "non-canonical report: the enclaves will sign \"not proven\" (no honest enclave would have produced it)" };
    throw new RefuteError("unreadable_report", "the decrypted report is not a canonical bundle: refute with revealKey (the bounty key) to prove it");
  }
  return { mode, readable: true, ...consistency(content, claim) };
}

interface ReportContent { bountyId: bigint; payee: unknown; predicate: unknown; txs: unknown; attackCode?: unknown; capital?: bigint }

/** Maximum nesting of a report (root + predicate): the same bound as the enclave's (MAX_REPORT_DEPTH). */
const MAX_REPORT_DEPTH = 1 + PREDICATE_MAX_DEPTH;

/** The plaintext of a report if it is EXACTLY a canonical bundle (protocolCanonical), otherwise undefined; "too_deep" if it
 *  is nested beyond the bounds (never serialized, as in the enclave). */
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
  const no = (note: string) => ({ consistent: false, note: `${note}: the enclaves will sign "not proven" without replaying` });
  if (c.bountyId !== claim.bountyId) return no(`the report targets bounty #${c.bountyId}, the claim #${claim.bountyId}`);
  if (typeof c.payee !== "string" || c.payee.toLowerCase() !== claim.payee.toLowerCase()) return no(`the report pays ${String(c.payee)}, the claim ${claim.payee}`);
  const txs = c.txs;
  if (!Array.isArray(txs) || !txs.every(isEvenHex) || (c.attackCode !== undefined && !isEvenHex(c.attackCode))) return no("malformed transactions or attack code");
  if (exploitFingerprint({ txs, attackCode: c.attackCode as Hex | undefined }).toLowerCase() !== claim.fingerprint.toLowerCase()) {
    return no("the report's fingerprint is not the claim's (cP is not the announced exploit)");
  }
  let ph: Hex;
  try {
    ph = predicateHash(c.predicate as Predicate); // rules P1–P4 (as in the enclave: a proven fault if they are broken)
  } catch (e) {
    if (e instanceof PredicateError) return no(`the report's predicate breaks the rules (${e.message})`);
    throw e;
  }
  if (ph.toLowerCase() !== claim.predicateHash.toLowerCase()) return no("the report's predicate is not the claim's");
  return { consistent: true, note: `report consistent with the claim: the enclaves will replay it at block ${claim.blockN}` };
}

const SEAL_INFO_KEY = new TextEncoder().encode("arc-sealed-key-v1");
const SEAL_INFO_NONCE = new TextEncoder().encode("arc-sealed-nonce-v1");

/** Opens a deterministic seal (cP) with the X25519 SHARED SECRET instead of the private key; throws if the ciphertext
 *  does not authenticate (same construction as deterministicSeal). */
export function openSealedWithSharedSecret(sealed: Hex, shared: Uint8Array): Uint8Array {
  const bytes = toBytes(sealed);
  if (bytes.length < 32 + 16) throw new Error("seal too short");
  const ephPub = bytes.slice(0, 32);
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), SEAL_INFO_NONCE, 12);
  return chacha20poly1305(key, nonce).decrypt(bytes.slice(32));
}

/** The JSON plaintext encrypted to each enclave (the format RefutationService reads). */
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

// ---------- 3. quorum, counter-replay, signatures ----------

export interface RefuteQuorumPlan {
  /** Distinct operators needed (refutersNeeded). */
  needed: number;
  /** Eligible distinct operators: neither zero nor signers of the claim. */
  eligibleOperators: Address[];
  reachable: boolean;
  message: string;
}

/**
 * Can the quorum be reached with these candidate operators (those of the verified enclaves, or the network's for the
 * product)? The claim's signers do not count (the contract refuses them: RefuterIsClaimOperator).
 */
export function refuteQuorumPlan(a: {
  claimOperators: readonly Address[];
  candidateOperators: readonly Address[];
  /** For the message: "enclaves" (default) = the enclaves given; "network" = the product's active operators. */
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
  const where = a.scope === "network" ? "on the network (the product's active operators)" : "among the verified enclaves";
  const rule = `it takes ${needed} distinct operators (at least ${REFUTE_QUORUM}, and more than the claim's ${a.claimOperators.length}), none of them a signer of the claim`;
  let message: string;
  if (reachable) message = `${eligible.length} distinct eligible operators ${where}; ${rule}`;
  else if (eligible.length === 0 && claimers > 0) message = `refutation quorum out of reach: ${where}, the only operator${claimers > 1 ? "s" : ""} ${claimers > 1 ? "have" : "has"} signed the claim; ${rule}`;
  else if (eligible.length === 0) message = `refutation quorum out of reach: no eligible operator ${where}; ${rule}`;
  else if (eligible.length === 1) message = `refutation quorum out of reach: only one eligible operator ${where} (${eligible[0]}); ${rule}`;
  else message = `refutation quorum out of reach: ${eligible.length} eligible operators ${where}; ${rule}`;
  return { needed, eligibleOperators: eligible, reachable, message };
}

export interface RefuteEnclaveResult {
  enclaveUrl: string;
  /** refuted: refutation signed and verified; confirmed: the counter-replay gives back the claim; refused: the enclave
   *  refuses (code); excluded: an operator that signed the claim (nothing sent); unverified: key not verified on-chain
   *  (nothing sent); skipped: eligible but not asked (quorum out of reach); error: invalid or unreachable answer. */
  status: "refuted" | "confirmed" | "refused" | "excluded" | "unverified" | "skipped" | "error";
  signer?: Address;
  /** Active operator of the enclave (verified on-chain). */
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
  /** ready: quorum reached on ONE refutation; unreachable: not enough eligible operators, NOTHING was sent;
   *  confirmed: the enclaves that replayed give back the claim; insufficient: sent, not enough signatures. */
  status: "ready" | "unreachable" | "confirmed" | "insufficient";
  message: string;
  results: RefuteEnclaveResult[];
  refutation?: Refutation;
  /** One signature per distinct operator (at most REFUTE_MAX_SIGNATURES). */
  signatures?: Hex[];
  refuters?: Address[];
  confirmations: number;
  /** Verified enclaves disagree with one another (different results, or confirmed AND refuted). */
  disagreement: boolean;
}

const claimToJson = (c: Claim) => ({
  bountyId: c.bountyId.toString(), payee: c.payee, blockN: c.blockN.toString(), blockHashN: c.blockHashN, predicateHash: c.predicateHash,
  loss: c.loss.toString(), tier: c.tier, fingerprint: c.fingerprint, cPHash: c.cPHash, deadline: c.deadline.toString(),
});

const describeRefutation = (f: Refutation) => (f.proven ? `proven, loss ${f.loss}, tier ${f.tier}` : "not proven");

/**
 * Asks several Sealed Bounty enclaves for a refutation. Nothing is encrypted to an enclave whose key is not the one
 * registered on-chain; nothing at all is sent if the claim is refuted or out of its window, if the source does not give
 * back its cPHash, or if the quorum cannot be reached with the verified enclaves (status "unreachable", clear message).
 */
export async function requestRefutations(a: {
  accepted: AcceptedClaim;
  source: RefuteSource;
  enclaveUrls: string[];
  /** The bounty's product (Bounty.productId, read on-chain). */
  productId: bigint;
  /** The protocol's X25519 key (Bounty.protocolX25519, read on-chain). */
  protocolX25519: Hex;
  publicClient: PublicClient;
  deployment?: Deployment;
  fetch?: typeof fetch;
  /** Timeout of a counter-replay (ms, default 180,000). */
  timeoutMs?: number;
}): Promise<RefuteRound> {
  const d = a.deployment ?? testnet;
  const { claim, operators } = a.accepted;
  const digest = claimDigestOf(d.sealedBounty, claim, d.chainId);
  if (digest.toLowerCase() !== a.accepted.claimDigest.toLowerCase()) throw new RefuteError("inconsistent_event", "the claim's digest does not match this deployment");
  if (a.accepted.refuted) throw new RefuteError("already_refuted", `claim ${digest} already refuted`);
  if (!a.accepted.windowOpen) throw new RefuteError("window_over", `refutation window closed since ${a.accepted.refuteWindowEndsAt} (accepted at ${a.accepted.acceptedAt})`);
  checkRefuteSource(a.source, claim, a.protocolX25519); // throws: nothing is sent

  // keys verified on-chain BEFORE anything is sent; the claim's operators are set aside
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
        reason: "an operator that signed the claim: the contract would refuse its signature (RefuterIsClaimOperator)",
      });
      continue;
    }
    targets.push({ k, i: results.length });
    results.push({ enclaveUrl: k.enclaveUrl, signer: k.signer, operator: k.operator, status: "skipped", reason: "not queried: quorum out of reach" });
  }
  const plan = refuteQuorumPlan({ claimOperators: operators, candidateOperators: results.filter((r) => r.operator).map((r) => r.operator!) });
  const base = { claimDigest: digest, needed: plan.needed, results, confirmations: 0, disagreement: false };
  if (!plan.reachable) return { ...base, status: "unreachable", message: `${plan.message}: nothing was sent to the enclaves` };

  // counter-replay (in parallel: one enclave per machine)
  const plaintext = utf8(refutePlaintext(a.source));
  const f = a.fetch ?? globalThis.fetch;
  await Promise.all(targets.map(async ({ k, i }) => {
    results[i] = await askOne(f, k, { claim, operators, digest, plaintext, d, timeoutMs: a.timeoutMs });
  }));
  plaintext.fill(0);

  // gather the signatures: all on the SAME Refutation, one per distinct operator
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
    ? ` (warning: verified enclaves disagree: ${confirmations} confirm, ${refutedCount} refute, ${groups.size} different result(s))`
    : "";
  if (best && best.byOp.size >= plan.needed) {
    const picked = [...best.byOp.values()].slice(0, REFUTE_MAX_SIGNATURES);
    return {
      ...base, status: "ready", confirmations, disagreement, refutation: best.f, signatures: picked.map((x) => x.sig), refuters: picked.map((x) => x.op),
      message: `refutation ready: ${picked.length} distinct operators sign "${describeRefutation(best.f)}" (${plan.needed} needed)${warn}`,
    };
  }
  if (refutedCount === 0 && confirmations > 0) {
    return { ...base, status: "confirmed", confirmations, disagreement, message: `the claim reproduces: ${confirmations} enclave(s) confirm it, no refutation signed` };
  }
  return {
    ...base, status: "insufficient", confirmations, disagreement,
    message: `refutation insufficient: ${best ? best.byOp.size : 0} distinct operator(s) sign the same result, ${plan.needed} needed${warn}`,
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
      return err(`non-JSON answer (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
    if (!res.ok) return err(`HTTP ${res.status} ${j?.error ?? text.slice(0, 160)}`);
  } catch (e) {
    return err(`unreachable: ${(e as Error).message}`);
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
    return err("unreadable replay report");
  }
  if (j?.status === "confirmed") return { ...who, status: "confirmed", replay, reason: String(j.reason ?? "") };
  if (j?.status === "refused") return { ...who, status: "refused", code: String(j.code ?? ""), reason: String(j.reason ?? "") };
  if (j?.status !== "refuted") return err(`statut inattendu : ${JSON.stringify(j).slice(0, 160)}`);
  // the refutation: on THIS digest, contradictory, signed by the VERIFIED enclave
  let ref: Refutation;
  try {
    if (typeof j.refutation?.proven !== "boolean") throw new Error();
    ref = { claimDigest: j.refutation.claimDigest as Hex, proven: j.refutation.proven, loss: BigInt(j.refutation.loss), tier: Number(j.refutation.tier) };
    if (!isBytes32(ref.claimDigest) || !Number.isInteger(ref.tier) || ref.tier < 0 || ref.tier > 255 || ref.loss < 0n) throw new Error();
  } catch {
    return err("malformed refutation");
  }
  if (ref.claimDigest.toLowerCase() !== o.digest.toLowerCase()) return err("the refutation concerns another claim");
  if (ref.proven && ref.loss === o.claim.loss && ref.tier === o.claim.tier) return err("this \"refutation\" does not contradict the claim (the contract would refuse it: NotARefutation)");
  let signer: Address;
  try {
    signer = await recoverRefutationSigner(o.d.sealedBounty, ref, j.signature as Hex, o.d.chainId);
  } catch {
    return err("signature illisible");
  }
  if (signer.toLowerCase() !== k.signer.toLowerCase()) return err(`refutation signed by ${signer}, not by the verified enclave ${k.signer}`);
  return { ...who, status: "refuted", refutation: ref, signature: j.signature as Hex, replay };
}

// ---------- 4. the refute call ----------

/** refute(claim, ops, refutation, signatures) ready to simulate (simulateContract), then send, with a gas margin. */
export function prepareRefuteCall(accepted: AcceptedClaim, round: RefuteRound, deployment?: Deployment) {
  const d = deployment ?? testnet;
  if (round.status !== "ready" || !round.refutation || !round.signatures?.length) throw new RefuteError("not_ready", `refutation not ready: ${round.message}`);
  if (round.claimDigest.toLowerCase() !== accepted.claimDigest.toLowerCase()) throw new RefuteError("not_ready", "refutation of another claim");
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
