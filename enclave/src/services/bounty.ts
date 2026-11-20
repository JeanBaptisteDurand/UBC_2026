/**
 * bounty.ts — the Sealed Bounty service (O3), v2.
 *
 * Flow: open `cE` (the exploit bundle encrypted to the enclave) -> recompute `cP` (encrypted to the protocol,
 * reproducible) -> read the bounty on-chain and check the predicate -> fix block N and the deadline -> replay the bundle
 * in a fresh fork -> evaluate the predicate before and after -> compute the loss, the tier and the fingerprint -> sign
 * the EIP-712 claim -> erase everything. Nothing leaves in clear.
 *
 * v2:
 *  - BOUNTIES WITH k ENCLAVES: the hunter can set `blockN` and `deadline` in the encrypted bundle, so that k enclaves
 *    sign the SAME claim (above singleCap, SealedBounty.claim requires k signatures on one digest). Bounds: blockN in
 *    [head − 256, head − 2], deadline in ]now, now + 10 min]. When absent: N = head − 2 and deadline = now + TTL, as
 *    before. When present but out of bounds: an explicit refusal (never a silent fallback, which would sign a claim
 *    that differs from the other enclaves' claim).
 *  - ANTI-EQUIVOCATION: two DIFFERENT claims with the same (bountyId, fingerprint) signed by the same enclave slash the
 *    operator's whole bond (SealedBounty.reportEquivocation; half goes to the reporter, who can be the hunter). The
 *    enclave therefore remembers the claim it signed for each (bountyId, fingerprint) and never signs another one: a
 *    new submission returns the SAME claim (same signature) or is refused. The reservation is synchronous and happens
 *    before the signature, so it is also safe for concurrent submissions.
 *
 * v2 bis (adversarial review of 13 Nov):
 *  - CANONICAL FINGERPRINT, computed HERE and not by the replay: keccak256(abi.encode(keccak256(attack code),
 *    keccak256(tx) for each tx)), over the BYTES. The same exploit written another way (upper-case hexadecimal, other
 *    JSON) has the same fingerprint: SealedBounty pays it only once (and on-chain a bounty pays only once per tier and
 *    per arming anyway). Transactions must be even-length hexadecimal.
 *
 * The replay (arc-anvil) and the deterministic derivation of `cP` are injected (interfaces): the core stays testable
 * outside the VM, and src/services/anvil-fork.ts provides the real fork.
 *
 * v2.1: REFUTATION of an accepted claim (SealedBounty.refute); see RefutationService below.
 *
 * v2.1 bis (adversarial review of 14 Nov), the GOLDEN RULE: the enclave NEVER signs (neither a claim nor a refutation) a
 * result that depends on a network, RPC, timing or environment error. When in doubt: an exception, HTTP 503, nothing
 * signed. Only DETERMINISTIC rules, written down and tested, give a "proven fault":
 *  - predicate: PredicateError (rules P1–P4, predicate.ts);
 *  - exploit: ReplayRuleError (the replay rules, ForkRunner.validate);
 *  - content of cP contradicted by the claim (FAULT, below).
 * The replay fails closed (ReplayUnavailableError, anvil-fork.ts); any other exception (exhausted JavaScript stack,
 * environment error) propagates: 503. The returned messages (reasons, notes) are FIXED: never the message of a viem
 * error, a parser or the node (they copy bytes of the exploit).
 *
 * v2.1 ter (adversarial verification of 14 Nov, proofs verif-failclosed e4, e7, e8):
 *  - NO catch without sorting: only identified DETERMINISTIC errors (precise classes or codes: HpkeError, SyntaxError
 *    from JSON.parse, TypeError ERR_ENCODING_INVALID_ENCODED_DATA, an invalid ChaCha20-Poly1305 tag, BigInt of a
 *    non-integer JSON value, a low-order X25519 key, a seal that is too short) become a refusal or a fault; any other
 *    exception propagates: 503, nothing signed, nothing cached;
 *  - /bounty/submit: deduplication by the hash of the ciphertext (a repeated submission returns the same result
 *    without reading the chain again; identical simultaneous submissions share one processing); a rate token
 *    (`admit`) is taken after the local checks and before any on-chain read;
 *  - /v1/refute: a rate token (`admit`) is taken AFTER the cheap read of claimRecords (claim accepted, not refuted,
 *    inside the window), and only if no result is already cached or in progress for this claim; a full queue ("busy",
 *    "refute_busy") or an exceeded rate is never cached as a replay failure.
 *
 * v2.1 quater (refutation demo, 14 Nov): a DELIBERATE "inflate-loss" fault (BountyServiceConfig.demoFault), for the
 * separate, labelled demo only (product 5, enclave/phala/refute-demo-liar-v21.yml: DEMO_FAULT in clear, so MEASURED in
 * the image fingerprint). The claim is signed with a DOUBLED loss; everything else is what an honest enclave signs
 * (block N, predicate, tier of the MEASURED loss, fingerprint, cPHash, deadline). It is refused for product 2 (here, in
 * the constructor, and when the server starts). When absent, nothing changes. Refutations (RefutationService) never see
 * it: a lying enclave refutes honestly.
 */
import {
  type Address, type Hex, encodeAbiParameters, getAddress, hashTypedData, isAddress, isHex, keccak256, toBytes, toHex, zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HpkeError } from "@hpke/core";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { EnclaveKit } from "../kit/enclave-kit";
import { claimTypes, domain, type Claim } from "../kit/eip712";
import { deterministicSeal } from "../kit/deterministic-seal";
import {
  PREDICATE_MAX_DEPTH, PredicateError, evaluate, jsonDepthExceeds, predicateHash, validatePredicate,
  type EvalContext, type Predicate,
} from "./predicate";

export interface ExploitBundle {
  bountyId: bigint;
  payee: Address;
  capital: bigint; // declared capital (the attacker's native balance in the fork)
  predicate: Predicate;
  txs: Hex[]; // the attack's transactions (<= 10)
  attackCode?: Hex; // optional bytecode to deploy
  r: Hex; // randomness for the derivation of cP
  cP: Hex; // ciphertext to the protocol, supplied by the hunter
  /** v2 (optional): block N of the replay, chosen by the hunter (the same for their k enclaves). */
  blockN?: bigint;
  /** v2 (optional): the claim's deadline (Unix seconds), the same for the hunter's k enclaves. */
  deadline?: bigint;
}

export interface BountyView {
  predicateHash: Hex;
  protocolX25519: Hex;
  tierMinLoss: bigint[]; // sorted in increasing order
  deadline: bigint;
}

export interface BountyReader {
  getBounty(bountyId: bigint): Promise<BountyView>;
}

/** Recomputes the ciphertext to the protocol reproducibly (same r => same cP). */
export interface ProtocolCipher {
  recompute(bundle: ExploitBundle, protocolX25519: Hex): Promise<Hex>;
}

/**
 * Replays the bundle in a fork at block N and returns what the predicate needs. v2 bis: a fingerprint the replay may
 * return is IGNORED; the service always computes the canonical fingerprint (`exploitFingerprint`).
 */
export interface ForkRunner {
  /**
   * v2.1 bis: returns DETERMINISTIC measurements, or throws: ReplayRuleError (a replay rule is broken) or any other
   * error (an outage: nothing is signed). `expectedBlockHash` is the hash of the claim's block N; an engine that
   * receives it checks that its RPC serves that very block (otherwise an outage: nothing is signed).
   */
  run(input: {
    blockN: bigint;
    bundle: ExploitBundle;
    expectedBlockHash?: Hex;
  }): Promise<{ ctx: EvalContext; fingerprint?: Hex }>;
  /**
   * v2.1 (optional): the engine's DETERMINISTIC rules on a bundle (number and shape of the transactions, sizes,
   * capital), without replaying anything. Throws ReplayRuleError if the bundle is refused (v2.1 bis: only this error
   * counts as a rule; any other exception is an outage). A refutation uses it to tell "this exploit cannot be
   * replayed" (no honest enclave would have signed: a proven fault) from a passing replay outage.
   */
  validate?(bundle: ExploitBundle): void;
}

/** v2.1 bis: the exploit breaks a DETERMINISTIC replay rule. Fixed message (nothing from the exploit's content). */
export class ReplayRuleError extends Error {
  constructor(readonly rule: string, message: string) {
    super(message);
    this.name = "ReplayRuleError";
  }
}

/** v2.1 ter: "budget" (reads from the fork's RPC beyond the replay's budget), "relay" (a fork RPC answer refused by the
 *  strict relay), "rate_limited" (rate exceeded: HTTP 429), "internal" (an unexpected exception during the replay,
 *  environment included: 503, never cached). */
export type ReplayUnavailableReason =
  | "rpc" | "timeout" | "process" | "busy" | "anchor" | "recent_failure" | "refute_busy" | "budget" | "relay" | "rate_limited" | "internal";

/** v2.1 ter: reasons that are NOT a replay failure (full queue, rate, environment exception): never cached. */
const NOT_A_REPLAY_FAILURE: ReadonlySet<ReplayUnavailableReason> = new Set(["busy", "refute_busy", "rate_limited", "recent_failure", "internal"]);

/** v2.1 ter: a failure that CAN be cached (it slows repeated replays): a ReplayUnavailableError whose reason is a real
 *  replay failure. Any other exception (environment, unexpected) is never cached. */
export function isMemorizableFailure(e: unknown): e is ReplayUnavailableError {
  return e instanceof ReplayUnavailableError && !NOT_A_REPLAY_FAILURE.has(e.reason);
}

/** v2.1 bis: the replay (or the refutation) did not complete, for a reason that is NOT a rule: never a verdict,
 *  nothing is signed (HTTP 503). */
export class ReplayUnavailableError extends Error {
  constructor(readonly reason: ReplayUnavailableReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplayUnavailableError";
  }
}

/**
 * v2 bis: the CANONICAL fingerprint of an exploit, over the bytes of the attack code and the transactions (the case of
 * the hexadecimal and the JSON layout change nothing). The same formula as `exploitFingerprint` in the real replay
 * (src/services/anvil-fork.ts), checked by the tests.
 */
export function exploitFingerprint(bundle: Pick<ExploitBundle, "txs" | "attackCode">): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32[]" }],
      [keccak256(bundle.attackCode ?? "0x"), bundle.txs.map((t) => keccak256(t))],
    ),
  );
}

export interface BlockSource {
  current(): Promise<bigint>;
  blockHash(n: bigint): Promise<Hex>;
}

export type SubmitResult =
  | { status: "proven"; claim: Claim; signature: Hex; cP: Hex }
  | { status: "not_proven"; reason: string };

/** v2.1 quater: a DELIBERATE demo fault (refutation). "inflate-loss": the signed loss is doubled. */
export type DemoFault = "inflate-loss";
export const DEMO_FAULTS: readonly DemoFault[] = ["inflate-loss"];
/** v2.1 quater: products where a demo fault is forbidden (2 = the real Sealed Bounty of the v2.1 stack). */
export const DEMO_FAULT_FORBIDDEN_PRODUCTS: readonly bigint[] = [2n];

export interface BountyServiceConfig {
  sealedBounty: Address;
  /** Default deadline of a claim (s, default 600). */
  claimTtlSeconds?: bigint;
  /** v2.1 quater: refutation DEMO only (never product 2): claims signed with a doubled loss. Absent (the normal
   *  case): nothing changes. */
  demoFault?: DemoFault;
  /** v2.1 ter: how long a result stays deduplicated by the hash of the ciphertext (ms, default 60,000). */
  dedupTtlMs?: number;
  /** v2.1 ter: how long a replay FAILURE stays deduplicated (ms, default 15,000); a full queue or the rate: never. */
  dedupFailureTtlMs?: number;
  /** Clock (ms); for tests. */
  nowMs?: () => number;
}

/** v2.1 ter: the maximum number of deduplicated submissions (the oldest leave first). */
export const MAX_DEDUP_ENTRIES = 1_024;

/** v2.1 ter: options of a submission. `admit` takes a rate token; false → ReplayUnavailableError("rate_limited"). */
export interface SubmitOptions {
  admit?: () => boolean;
}

interface DedupEntry {
  /** End of validity (ms); Infinity while the processing runs. */
  until: number;
  result: Promise<SubmitResult>;
}

/** Bounds of the values supplied by the hunter (v2). */
export const MIN_ANCHOR_AGE = 2n; // N ≤ head − 2
export const MAX_ANCHOR_AGE = 256n; // N ≥ head − 256
export const MAX_CLAIM_TTL_SECONDS = 600n; // deadline ≤ now + 10 min

interface SignedClaim {
  claim: Claim;
  cP: Hex;
  signature: Promise<Hex>;
}

/** Result of a submission that could not be decrypted: never deduplicated (nothing useful to cache). */
const UNDECRYPTABLE_REASON = "cE cannot be decrypted by this enclave (wrong X25519 key?)";

export class BountyService {
  /** Claims signed by this enclave, by (bountyId, fingerprint): never two different ones. */
  private signed = new Map<string, SignedClaim>();
  /** v2.1 ter: recent results by the hash of the ciphertext (enc ‖ ciphertext). */
  private dedup = new Map<string, DedupEntry>();

  constructor(
    private kit: EnclaveKit,
    private cfg: BountyServiceConfig,
    private reader: BountyReader,
    private protocolCipher: ProtocolCipher,
    private fork: ForkRunner,
    private blocks: BlockSource,
    private now: () => bigint,
  ) {
    // v2.1 quater: an unknown demo fault, or one on a product where it is forbidden, is never served
    if (cfg.demoFault !== undefined) {
      if (!DEMO_FAULTS.includes(cfg.demoFault)) throw new Error(`unknown demo fault: "${String(cfg.demoFault)}"`);
      if (DEMO_FAULT_FORBIDDEN_PRODUCTS.includes(kit.productId)) {
        throw new Error(`demo fault refused for product ${kit.productId} (the real Sealed Bounty)`);
      }
    }
  }

  private nowMs(): number {
    return this.cfg.nowMs ? this.cfg.nowMs() : Date.now();
  }

  /** v2.1 quater: the demo fault this enclave serves (announced on /pubkeys and /health); undefined in the normal case. */
  get demoFault(): DemoFault | undefined {
    return this.cfg.demoFault;
  }

  /**
   * v2.1 ter: the same submission (the same encrypted bytes) repeated within a short delay returns the SAME result
   * without reading anything again; identical simultaneous submissions share one processing. Cached: the results
   * (proven, not proven, except an undecryptable ciphertext) and, for a shorter time, the replay failures
   * (ReplayUnavailableError); never a full queue, an exceeded rate or an environment exception.
   */
  submit(encBundle: { enc: Uint8Array; ciphertext: Uint8Array }, o: SubmitOptions = {}): Promise<SubmitResult> {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, encBundle.enc.length);
    const key = bytesToHex(sha256(concatBytes(len, encBundle.enc, encBundle.ciphertext))); // the length of enc makes the split unambiguous
    const now = this.nowMs();
    const hit = this.dedup.get(key);
    if (hit && hit.until > now) return hit.result;
    if (hit) this.dedup.delete(key);
    const entry: DedupEntry = { until: Infinity, result: this.submitOnce(encBundle, o) };
    this.remember(key, entry);
    const forget = () => {
      if (this.dedup.get(key) === entry) this.dedup.delete(key); // never a newer entry with the same key
    };
    entry.result.then(
      (r) => {
        if (r.status === "not_proven" && r.reason === UNDECRYPTABLE_REASON) forget();
        else entry.until = this.nowMs() + (this.cfg.dedupTtlMs ?? 60_000);
      },
      (e) => {
        if (isMemorizableFailure(e)) entry.until = this.nowMs() + (this.cfg.dedupFailureTtlMs ?? 15_000);
        else forget(); // full queue, rate, environment: nothing is cached
      },
    );
    return entry.result;
  }

  /** Caches a deduplication entry (bounded: expired entries leave first, then the oldest). */
  private remember(key: string, entry: DedupEntry): void {
    if (this.dedup.size >= MAX_DEDUP_ENTRIES) {
      const now = this.nowMs();
      for (const [k, v] of this.dedup) if (v.until <= now) this.dedup.delete(k);
      for (const k of this.dedup.keys()) {
        if (this.dedup.size < MAX_DEDUP_ENTRIES) break;
        this.dedup.delete(k);
      }
    }
    this.dedup.set(key, entry);
  }

  private async submitOnce(encBundle: { enc: Uint8Array; ciphertext: Uint8Array }, o: SubmitOptions): Promise<SubmitResult> {
    // 1. open the bundle (encrypted to the enclave); v2.1 ter: only HPKE errors (deterministic) are a refusal
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(encBundle.enc, encBundle.ciphertext);
    } catch (e) {
      if (!(e instanceof HpkeError)) throw e; // environment: 503, nothing cached
      return { status: "not_proven", reason: UNDECRYPTABLE_REASON };
    }

    try {
      let bundle: ExploitBundle;
      try {
        bundle = parseBundle(plain);
      } catch (e) {
        // v2.1 bis: a FIXED message (a message from JSON.parse or BigInt copies bytes of the bundle); v2.1 ter: only the
        // format rule (BundleFormatError) is a refusal, any other exception propagates
        if (!(e instanceof BundleFormatError)) throw e;
        return { status: "not_proven", reason: `unreadable bundle: ${e.message}` };
      }

      // 2. deterministic, local rules, BEFORE any on-chain read: the predicate (P1–P4), then the replay rules
      let ph: Hex;
      try {
        ph = predicateHash(bundle.predicate);
      } catch (e) {
        if (e instanceof PredicateError) return { status: "not_proven", reason: `predicate outside the rules: ${e.message}` };
        throw e;
      }
      try {
        this.fork.validate?.(bundle);
      } catch (e) {
        if (e instanceof ReplayRuleError) return { status: "not_proven", reason: `exploit refused by the replay rules: ${e.message}` };
        throw e;
      }

      // 2bis. v2.1 ter: rate. A token only for a submission that passed the local checks, before any read
      if (o.admit && !o.admit()) {
        throw new ReplayUnavailableError("rate_limited", "too many submissions: try again later (nothing is signed)");
      }

      // 3. the bounty on-chain: the predicate must be the bounty's own
      const bounty = await this.reader.getBounty(bundle.bountyId);
      if (ph.toLowerCase() !== bounty.predicateHash.toLowerCase()) {
        return { status: "not_proven", reason: "predicateHash does not match the bounty" };
      }

      // 3bis. reproducible recomputation of cP (which lets two enclaves sign the same hash)
      const cP = await this.protocolCipher.recompute(bundle, bounty.protocolX25519);
      if (cP.toLowerCase() !== bundle.cP.toLowerCase()) {
        return { status: "not_proven", reason: "cP cannot be reproduced" };
      }

      // 4. block N: the hunter's if it lies in [head − 256, head − 2], otherwise (absent) head − 2
      const head = await this.blocks.current();
      const hi = head - MIN_ANCHOR_AGE;
      const lo = head > MAX_ANCHOR_AGE ? head - MAX_ANCHOR_AGE : 0n;
      if (bundle.blockN !== undefined && (bundle.blockN < lo || bundle.blockN > hi)) {
        return {
          status: "not_proven",
          reason: `block N ${bundle.blockN} refused: it must be in [head − ${MAX_ANCHOR_AGE}, head − ${MIN_ANCHOR_AGE}] = [${lo}, ${hi}]`,
        };
      }
      const blockN = bundle.blockN ?? hi;

      // 4bis. the hunter's deadline in ]now, now + 10 min]
      const t0 = this.now();
      if (bundle.deadline !== undefined && (bundle.deadline <= t0 || bundle.deadline > t0 + MAX_CLAIM_TTL_SECONDS)) {
        return {
          status: "not_proven",
          reason: `deadline ${bundle.deadline} refused: it must be in ]now, now + ${MAX_CLAIM_TTL_SECONDS} s] = ]${t0}, ${t0 + MAX_CLAIM_TTL_SECONDS}]`,
        };
      }

      const blockHashN = await this.blocks.blockHash(blockN);

      // 5–8. replay, evaluation and fingerprint (v2 bis: canonical, computed here). v2.1 bis: the replay checks that its RPC
      // serves the anchored block N (blockHashN, read through the quorum); an outage of the replay or the evaluation propagates (503, nothing signed)
      let ctx: EvalContext;
      try {
        ({ ctx } = await this.fork.run({ blockN, bundle, expectedBlockHash: blockHashN }));
      } catch (e) {
        if (e instanceof ReplayRuleError) return { status: "not_proven", reason: `exploit refused by the replay rules: ${e.message}` };
        throw e;
      }
      const fingerprint = exploitFingerprint(bundle);
      const { satisfied, loss } = evaluate(bundle.predicate, ctx);
      if (!satisfied) return { status: "not_proven", reason: "predicate not satisfied" };

      const tier = pickTier(bounty.tierMinLoss, loss);
      if (tier < 0) return { status: "not_proven", reason: "loss below the lowest tier" };

      // 9. the claim. v2.1 quater: the "inflate-loss" DEMO fault (never product 2, see the constructor) signs a DOUBLED
      //    loss and keeps everything else (the tier too: that of the measured loss); when absent, the measured loss
      const deadline = bundle.deadline ?? this.now() + (this.cfg.claimTtlSeconds ?? 600n);
      const claim: Claim = {
        bountyId: bundle.bountyId,
        payee: bundle.payee,
        blockN,
        blockHashN,
        predicateHash: ph,
        loss: this.cfg.demoFault === "inflate-loss" ? loss * 2n : loss,
        tier,
        fingerprint,
        cPHash: keccak256(cP),
        deadline,
      };

      // 9bis. anti-equivocation: check and reserve WITHOUT an `await` in between (atomic)
      const key = `${claim.bountyId}:${claim.fingerprint.toLowerCase()}`;
      const prev = this.signed.get(key);
      if (prev) return this.resubmission(prev, claim, bundle);

      const signature = this.kit.signClaim(this.cfg.sealedBounty, claim);
      this.signed.set(key, { claim, cP, signature });
      try {
        return { status: "proven", claim, signature: await signature, cP };
      } catch (e) {
        this.signed.delete(key); // no signature left the enclave: the reservation can be dropped
        throw e;
      }
    } finally {
      // 10. erase the plaintext bundle (best effort)
      plain.fill(0);
    }
  }

  /** A claim already exists for (bountyId, fingerprint): return it as it is, or refuse. */
  private async resubmission(prev: SignedClaim, claim: Claim, bundle: ExploitBundle): Promise<SubmitResult> {
    const p = prev.claim;
    const sameContent =
      p.payee.toLowerCase() === claim.payee.toLowerCase() &&
      p.cPHash.toLowerCase() === claim.cPHash.toLowerCase() &&
      p.predicateHash.toLowerCase() === claim.predicateHash.toLowerCase();
    if (!sameContent) {
      return {
        status: "not_proven",
        reason:
          "another claim was already signed by this enclave for this fingerprint " +
          "(an enclave never signs two different claims for the same fingerprint)",
      };
    }
    const sameAnchor =
      (bundle.blockN === undefined || bundle.blockN === p.blockN) &&
      (bundle.deadline === undefined || bundle.deadline === p.deadline);
    if (!sameAnchor) {
      return {
        status: "not_proven",
        reason:
          `claim already signed by this enclave for this fingerprint with block N ${p.blockN} and deadline ` +
          `${p.deadline}: ask again with these values (an enclave never signs two different claims ` +
          "for the same fingerprint)",
      };
    }
    return { status: "proven", claim: p, signature: await prev.signature, cP: prev.cP };
  }
}

/** The highest tier whose loss threshold is reached; −1 if none. */
export function pickTier(tierMinLoss: bigint[], loss: bigint): number {
  let tier = -1;
  for (let i = 0; i < tierMinLoss.length; i++) {
    if (loss >= tierMinLoss[i]!) tier = i;
  }
  return tier;
}

/**
 * Reference implementation of the encryption to the protocol: a DETERMINISTIC seal derived from `r`.
 * Two honest enclaves that open the same bundle recompute the same cP (and so sign the same hash).
 * The hunter must produce their cP exactly this way (the canonical form of the bundle, without `cP`,
 * `r`, `blockN` or `deadline`).
 */
export class DeterministicProtocolCipher implements ProtocolCipher {
  async recompute(bundle: ExploitBundle, protocolX25519: Hex): Promise<Hex> {
    const canonical = canonicalProtocolPlaintext(bundle);
    return deterministicSeal(toBytes(protocolX25519), new TextEncoder().encode(canonical), toBytes(bundle.r));
  }
}

/** The plaintext of cP: the canonical form of the bundle (same keys, same order; without r, cP, blockN or deadline). */
export function canonicalProtocolPlaintext(
  b: Pick<ExploitBundle, "bountyId" | "payee" | "capital" | "predicate" | "txs" | "attackCode">,
): string {
  return JSON.stringify({
    bountyId: b.bountyId.toString(),
    payee: b.payee,
    capital: b.capital.toString(),
    predicate: b.predicate,
    txs: b.txs,
    attackCode: b.attackCode ?? null,
  });
}

/** v2.1 bis: a malformed bundle; the message is FIXED (the field's name only, never its value). */
class BundleFormatError extends Error {}

function parseBundle(plain: Uint8Array): ExploitBundle {
  let obj: any;
  try {
    obj = JSON.parse(new TextDecoder().decode(plain)); // non-fatal decoding: only JSON.parse can refuse (SyntaxError)
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e; // v2.1 ter: environment → 503
    throw new BundleFormatError("JSON expected");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new BundleFormatError("JSON object expected");
  const txs: unknown = obj.txs ?? [];
  if (!Array.isArray(txs) || !txs.every(isEvenHex)) throw new BundleFormatError("txs: array of even-length hexadecimal expected");
  if (obj.attackCode !== undefined && obj.attackCode !== null && !isEvenHex(obj.attackCode)) {
    throw new BundleFormatError("attackCode: even-length hexadecimal expected");
  }
  // v2.1 bis: the payee is an address (the EIP-712 claim signs no other kind; mixed case: EIP-55); r and cP are
  // hexadecimal (as /v1/refute reads them): a form refused here is refused without an exception (never a 503)
  if (typeof obj.payee !== "string" || !isAddress(obj.payee)) throw new BundleFormatError("payee: address expected (EIP-55 if mixed case)");
  if (typeof obj.r !== "string" || !isHex(obj.r, { strict: true })) throw new BundleFormatError("r: hexadecimal expected");
  if (typeof obj.cP !== "string" || !isHex(obj.cP, { strict: true })) throw new BundleFormatError("cP: hexadecimal expected");
  const big = (x: unknown, name: string): bigint => {
    const v = jsonBigInt(x); // v2.1 ter: only BigInt's deterministic refusals; anything else propagates
    if (v === undefined) throw new BundleFormatError(`${name}: integer expected`);
    return v;
  };
  return {
    bountyId: big(obj.bountyId, "bountyId"),
    payee: obj.payee,
    capital: big(obj.capital, "capital"),
    predicate: obj.predicate,
    txs: txs as Hex[],
    attackCode: obj.attackCode ?? undefined,
    r: obj.r,
    cP: obj.cP,
    blockN: optionalUint(obj.blockN, "blockN"),
    deadline: optionalUint(obj.deadline, "deadline"),
  };
}

/** Strict hexadecimal of even length (bytes, without ambiguity). */
function isEvenHex(x: unknown): x is Hex {
  return typeof x === "string" && isHex(x, { strict: true }) && x.length % 2 === 0;
}

// ---------- v2.1 ter: identified DETERMINISTIC errors (everything else propagates: 503, nothing signed, nothing cached) ----------

/**
 * BigInt(x) for a value that comes from JSON; undefined if the conversion fails DETERMINISTICALLY: a non-integer number
 * (BigInt's RangeError, ruled out here BEFORE the call), a string that is not an integer (SyntaxError), null or another
 * value that cannot be converted (TypeError). Any other exception (exhausted stack, memory) propagates.
 */
export function jsonBigInt(x: unknown): bigint | undefined {
  if (typeof x === "number" && !Number.isInteger(x)) return undefined;
  try {
    return BigInt(x as any);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof TypeError) return undefined;
    throw e;
  }
}

/** Bytes that are not UTF-8 (Node's fatal TextDecoder: TypeError ERR_ENCODING_INVALID_ENCODED_DATA). */
export function isInvalidUtf8Error(e: unknown): boolean {
  return e instanceof TypeError && (e as { code?: unknown }).code === "ERR_ENCODING_INVALID_ENCODED_DATA";
}

/** An invalid ChaCha20-Poly1305 tag (@noble/ciphers: exactly Error, message "invalid tag"). */
export function isInvalidTagError(e: unknown): boolean {
  return e instanceof Error && e.constructor === Error && e.message === "invalid tag";
}

const P25519 = (1n << 255n) - 19n;
/** The u coordinates (mod p) of the low-order points of Curve25519 and of its twist (order 1, 2, 4 or 8): X25519 of such
 *  a point by a clamped key (a multiple of 8) gives 0, which @noble/curves refuses. The complete list (checked on 14 Nov). */
const X25519_SMALL_ORDER = new Set<bigint>([
  0n, 1n, P25519 - 1n,
  325606250916557431795983626356110631294008115727848805560023387167927233504n,
  39382357235489614581723060781553021112529911719440698176882885853963445705823n,
]);

/** True if `u` (32 bytes) is a low-order X25519 public key (RFC 7748 decoding: top bit masked, mod p). */
export function isSmallOrderX25519(u: Uint8Array): boolean {
  if (u.length !== 32) return false;
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(i === 31 ? u[i]! & 0x7f : u[i]!);
  return X25519_SMALL_ORDER.has(n % P25519);
}

/** Optional field: an integer ≥ 0 (an integer number or a decimal string), otherwise an error. */
function optionalUint(x: unknown, name: string): bigint | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  if (typeof x === "string" && /^[0-9]{1,20}$/.test(x)) return BigInt(x);
  throw new BundleFormatError(`${name} invalid (integer ≥ 0 expected)`);
}

// ======================================================================================================================
// v2.1: REFUTATION of an ACCEPTED claim (SealedBounty.refute)
// ======================================================================================================================
//
// What the refuting enclave can really replay. The claim carries only hashes: fingerprint =
// keccak256(abi.encode(keccak256(attack code), keccak256(tx)[])) and cPHash = keccak256(cP), where cP is the
// DETERMINISTIC seal (randomness r) of the canonical bundle to the PROTOCOL's X25519 key. The enclave cannot open cP:
// someone must bring it the exploit IN CLEAR, encrypted to ITS X25519 key (HPKE, aad bound to the claim's digest), and
// the enclave binds it to the claim BEFORE any replay:
//  - the HUNTER (bundle + r): the enclave recomputes cP = seal(r, canonical bundle, the bounty's key read on-chain) and
//    requires keccak256(cP) = cPHash; with r fixed, the seal is injective, so the binding is complete;
//  - the PROTOCOL (after deliver it holds cP and its key, not r) sends cP and, as it chooses:
//     · the X25519 SHARED SECRET of this one report (X25519(the bounty's private key, the ephemeral key at the head of
//       cP)): it opens only this report, but the enclave cannot verify it, and ChaCha20-Poly1305 does not commit to
//       its key. The plaintext is therefore accepted only if it is EXACTLY a canonical bundle: a false secret that
//       "opened" cP into another canonical bundle would need two ChaCha20 streams to agree on the whole fixed prefix
//       {"bountyId":"…","payee":"0x… (tens of bytes), which is out of reach. Unreadable or not canonical: a REFUSAL
//       (nothing is proven);
//     · the bounty's X25519 PRIVATE KEY: the enclave checks that it gives back Bounty.protocolX25519 (read on-chain);
//       decryption is then certain, and an unreadable or non-canonical cP PROVES that the claim's signers signed a
//       report that is not one. This key opens EVERY report encrypted to Bounty.protocolX25519: those of this
//       bounty, and those of any other bounty created with the same key (the CLI creates one key per bounty since
//       v2.1 bis). It never leaves this code and it is erased from memory after use.
// Once the content of cP is established, any gap with the claim (bounty, payee, predicate, fingerprint) or with the
// replay rules PROVES the fault (an honest enclave derives all of these from the same bundle): a "not proven"
// refutation without a replay ("cP is not the announced exploit", SealedBounty.Refutation). Otherwise: a replay at the
// SAME block N, with the same predicate and the tiers read on-chain; a signature ONLY if the result differs (not
// proven, another loss or another tier). An identical result is "confirmed", and nothing is signed (the contract would
// refuse: NotARefutation).
// Refusals before any decryption (the contract would refuse too): an unknown claim, already refuted, outside the
// window, operators that are not those of ClaimAccepted, an enclave inactive for the bounty's product, or the operator
// of THIS enclave among the claim's signers. The result is cached per claim: never two different refutations.
//
// v2.1 bis (adversarial review of 14 Nov):
//  - DENIAL OF SERVICE: claimRecords is read ALONE first (RefuteReader.record: one read per provider, plus the head);
//    an unknown claim, a refuted one or (with a known window) one outside the window → a stop before any other read.
//    A failed counter-replay is cached for `failureTtlMs` (no repeated full replays); at most `maxInFlight`
//    refutations run at once; the HTTP application (app.ts) limits the rate;
//  - FAIL CLOSED: only faults under the listed deterministic rules (FAULT, PredicateError, ReplayRuleError) give a
//    refutation without a replay; an exception of the replay or the evaluation is never a verdict: 503, nothing signed;
//  - a report nested deeper than MAX_REPORT_DEPTH levels is never serialized (JSON.stringify is recursive): with the
//    bounty's key it is a fault (no honest enclave would have signed it), otherwise a refusal;
//  - RULES EPOCH (`acceptedFrom`, optional): a claim accepted BEFORE it is not judged (refusal "rules_epoch"), because
//    an image with different replay rules may have signed it.

/** EIP-712 types of the refutation: SealedBounty.REFUTATION_TYPEHASH = keccak256("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)"). */
export const refutationTypes = {
  Refutation: [
    { name: "claimDigest", type: "bytes32" },
    { name: "proven", type: "bool" },
    { name: "loss", type: "uint256" },
    { name: "tier", type: "uint8" },
  ],
} as const;

/** SealedBounty.Refutation. With `proven` false, the canonical form is { loss: 0, tier: 0 }, the same for every enclave. */
export interface Refutation {
  claimDigest: Hex;
  proven: boolean;
  loss: bigint;
  tier: number;
}

/** HPKE aad of a refutation request: a ciphertext prepared for one claim cannot serve another one (nor /bounty/submit). */
export const REFUTE_AAD_LABEL = "arc-sealed-bounty/refute/v1";
export function refuteRequestAad(claimDigest: Hex): Uint8Array {
  return new TextEncoder().encode(`${REFUTE_AAD_LABEL}:${claimDigest.toLowerCase()}`);
}

/** EIP-712 digest of a claim (= SealedBounty.claimDigest): the key of claimRecords, carried by the refutation. The same
 *  parameters, in the same order, as the SDK's claimDigestOf. */
export function claimDigestOf(sealedBounty: Address, claim: Claim, chainId: number): Hex {
  return hashTypedData({ domain: domain({ chainId, verifyingContract: sealedBounty }), types: claimTypes, primaryType: "Claim", message: claim });
}

/** keccak256(abi.encode(operators)): ClaimRecord.opsHash (the same order as ClaimAccepted). */
export function claimOperatorsHash(operators: readonly Address[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [operators as Address[]]));
}

/** What the chain says about the claim and the bounty, read AT ONE BLOCK (RPC quorum). */
export interface RefuteChainView {
  block: bigint;
  blockTimestamp: bigint;
  /** SealedBounty.claimRecords(digest): acceptedAt = 0 if never accepted. */
  record: { acceptedAt: bigint; refuted: boolean; opsHash: Hex };
  /** SealedBounty.REFUTE_WINDOW (s). */
  refuteWindow: bigint;
  bounty: BountyView & { productId: bigint };
  /** EnclaveRegistry.activeOperatorAt(the signer of THIS enclave, the bounty's product, block): 0 if inactive. */
  myOperator: Address;
}

export interface RefuteReader {
  read(q: { claimDigest: Hex; bountyId: bigint; signer: Address }): Promise<RefuteChainView>;
  /**
   * v2.1 bis (optional): the CHEAP read done first: SealedBounty.claimRecords(digest) alone, at the same block on every
   * provider. An unknown claim, a refuted one or one outside the window stops there, before any other read.
   */
  record?(q: { claimDigest: Hex }): Promise<{ block: bigint; record: { acceptedAt: bigint; refuted: boolean; opsHash: Hex } }>;
}

export interface RefuteRequest {
  /** The accepted claim, as ClaimAccepted emitted it. */
  claim: Claim;
  /** Its operators, as ClaimAccepted emitted them (same order). */
  operators: Address[];
  /** HPKE to this enclave's X25519 key, aad = refuteRequestAad(digest); for the plaintext, see RefutationService. */
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

/** The counter-replay (or the fault proven without a replay, `replayed` false). */
export interface ReplayOutcome {
  blockN: bigint;
  replayed: boolean;
  satisfied: boolean;
  /** The loss the predicate measures (0 if not satisfied). */
  loss: bigint;
  /** The highest tier reached, −1 if none. */
  tier: number;
  /** satisfied and tier ≥ 0: what an honest enclave would have signed. */
  proven: boolean;
  /** Why the claim is at fault without a replay, or why the predicate could not be evaluated. */
  note?: string;
}

export type RefuseCode =
  | "unknown_claim" | "already_refuted" | "window_over" | "bad_ops" | "wrong_product" | "inactive" | "claim_operator"
  | "undecryptable" | "bad_request" | "exploit_mismatch" | "rules_epoch";

export type RefuteResult =
  | { status: "refuted"; refutation: Refutation; signature: Hex; signer: Address; operator: Address; replay: ReplayOutcome }
  | { status: "confirmed"; claimDigest: Hex; replay: ReplayOutcome; reason: string }
  | { status: "refused"; code: RefuseCode; reason: string };

type Decided = Exclude<RefuteResult, { status: "refused" }>;

class RefuseError extends Error {
  constructor(readonly code: RefuseCode, message: string) {
    super(message);
  }
}

/** The established content of cP (bound to the claim); `fault`: this content alone proves the fault (no replay). */
interface Established {
  bundle?: ExploitBundle;
  fault?: string;
}

/** v2.1 bis: the maximum nesting of a report (root + predicate): beyond it, no honest enclave produced it. */
export const MAX_REPORT_DEPTH = 1 + PREDICATE_MAX_DEPTH;

/**
 * v2.1 bis: faults PROVEN without a replay. Deterministic rules with FIXED notes (nothing from the content of cP: any
 * intermediary that terminates the TLS can read the HTTP answer).
 */
export const FAULT = {
  bounty: "the report targets another bounty than the claim",
  payee: "the report pays another payee than the claim",
  txs: "transactions that are not even-length hexadecimal: no honest enclave would have replayed them",
  attackCode: "attack code that is not even-length hexadecimal",
  fingerprint: "the fingerprint of the exploit in cP is not the claim's: cP is not the announced exploit",
  predicate: "the report's predicate is outside the rules: no honest enclave would have signed it",
  predicateHash: "the report's predicate is not the claim's",
  replayRules: "exploit refused by the replay rules: no honest enclave would have signed",
  ephemeralKey: "cP does not open with the bounty's key (invalid ephemeral key): it is not a report",
  unreadable: "cP does not open with the bounty's key: the signers signed an unreadable report",
  notCanonical: "the decrypted report is not a canonical bundle: no honest enclave would have produced it",
  tooDeep: "the decrypted report is nested beyond the bounds: no honest enclave would have produced it",
} as const;

export interface RefutationConfig {
  sealedBounty: Address;
  /** The maximum number of refutations in progress (default 4); beyond it: ReplayUnavailableError("refute_busy"), 503, nothing signed. */
  maxInFlight?: number;
  /** A failed counter-replay is not started again for the same claim during this delay (ms, default 60,000). */
  failureTtlMs?: number;
  /** Rules epoch (Unix seconds): a claim accepted before it is not judged (refusal "rules_epoch"). */
  acceptedFrom?: bigint;
  /** Clock (ms); for tests. */
  nowMs?: () => number;
}

/**
 * The counter-replay of an accepted claim. Expected plaintext (JSON, encrypted to this enclave):
 *  - { "from": "hunter", bountyId, payee, capital, predicate, txs, attackCode?, r }: the hunter's bundle and its randomness r;
 *  - { "from": "protocol", cP, sharedSecret }: the delivered report and the X25519 secret of THIS report;
 *  - { "from": "protocol", cP, protocolPrivateKey }: the delivered report and the bounty's X25519 private key.
 */
export class RefutationService {
  /** Result per claim (digest): replayed once, never two different refutations; a replay failure is cleared. */
  private outcomes = new Map<string, Promise<Decided>>();
  /** v2.1 bis: recently failed counter-replays, per claim (digest → end of the delay, ms). */
  private failures = new Map<string, number>();
  private inFlight = 0;
  /** REFUTE_WINDOW (a constant of the contract), known after the first full read. */
  private window: bigint | undefined;

  constructor(
    private kit: EnclaveKit,
    private cfg: RefutationConfig,
    private reader: RefuteReader,
    private protocolCipher: ProtocolCipher,
    private fork: ForkRunner,
  ) {}

  private nowMs(): number {
    return this.cfg.nowMs ? this.cfg.nowMs() : Date.now();
  }

  /**
   * `o.admit` (v2.1 ter) takes a rate token. It is requested only AFTER the cheap read of claimRecords (claim accepted,
   * not refuted, inside the window if the window is known), and only if no result is already cached or in progress for
   * this claim (one more request then costs no replay). False → ReplayUnavailableError("rate_limited"): HTTP 429,
   * nothing signed, nothing cached.
   */
  async refute(req: RefuteRequest, o: { admit?: () => boolean } = {}): Promise<RefuteResult> {
    const { claim } = req;
    const digest = claimDigestOf(this.cfg.sealedBounty, claim, this.kit.binding.chainId);
    const key = digest.toLowerCase();
    const refuse = (code: RefuseCode, reason: string): RefuteResult => ({ status: "refused", code, reason });

    // 0. a counter-replay of this claim has just failed: no new full replay before the end of the delay
    const until = this.failures.get(key);
    if (until !== undefined) {
      if (this.nowMs() < until) {
        throw new ReplayUnavailableError("recent_failure", "the counter-replay of this claim failed recently: try again later (nothing is signed)");
      }
      this.failures.delete(key);
    }

    // 1a. the CHEAP read first: claimRecords alone; unknown, refuted or outside the window → stop, nothing else is read
    if (this.reader.record) {
      const pre = await this.reader.record({ claimDigest: digest });
      const early = this.recordRefusal(digest, pre.record, undefined);
      if (early) return early;
    }

    // 1a bis. v2.1 ter: rate, AFTER the cheap read (an invalid body or an invented claim takes no token); a claim whose
    //         result is cached or in progress takes none either
    if (o.admit && !this.outcomes.has(key) && !o.admit()) {
      throw new ReplayUnavailableError("rate_limited", "too many refutation requests: try again later (nothing is signed)");
    }

    // 1b. bounded concurrency (the counter-replay goes through the engine's global queue, shared with /bounty/submit)
    if (this.inFlight >= (this.cfg.maxInFlight ?? 4)) {
      throw new ReplayUnavailableError("refute_busy", "too many refutations in progress: try again later (nothing is signed)");
    }
    this.inFlight++;
    try {
      return await this.refuteChecked(req, digest, key, refuse);
    } finally {
      this.inFlight--;
    }
  }

  /** A refusal drawn from claimRecords alone (unknown, refuted, outside the window if the window and the time are known). */
  private recordRefusal(
    digest: Hex, rec: { acceptedAt: bigint; refuted: boolean }, at: { block: bigint; timestamp: bigint } | undefined,
  ): RefuteResult | undefined {
    if (rec.acceptedAt === 0n) return { status: "refused", code: "unknown_claim", reason: `claim ${digest} unknown to SealedBounty (never accepted): nothing to refute` };
    if (rec.refuted) return { status: "refused", code: "already_refuted", reason: `claim ${digest} already refuted` };
    if (this.cfg.acceptedFrom !== undefined && rec.acceptedAt < this.cfg.acceptedFrom) {
      return {
        status: "refused", code: "rules_epoch",
        reason: `claim accepted at ${rec.acceptedAt}, before the epoch of this enclave's replay rules (${this.cfg.acceptedFrom}): an image with different rules may have signed it, so this enclave does not judge it`,
      };
    }
    if (this.window !== undefined) {
      const end = rec.acceptedAt + this.window;
      // cheap read: the local time (5 min margin; only a refusal comes out of it); full read: the block's time
      const now = at ? at.timestamp : BigInt(Math.floor(this.nowMs() / 1000)) - 300n;
      if (now > end) {
        return {
          status: "refused", code: "window_over",
          reason: `refutation window closed: accepted at ${rec.acceptedAt}, refutable until ${end}, it is now ${now}${at ? ` (block ${at.block})` : ""}`,
        };
      }
    }
    return undefined;
  }

  private async refuteChecked(
    req: RefuteRequest, digest: Hex, key: string, refuse: (code: RefuseCode, reason: string) => RefuteResult,
  ): Promise<RefuteResult> {
    const { claim } = req;
    // 1. the claim read again on-chain (one block): accepted, not refuted, inside the window, with these operators
    const v = await this.reader.read({ claimDigest: digest, bountyId: claim.bountyId, signer: this.kit.keys.signer });
    this.window = v.refuteWindow;
    const { opsHash } = v.record;
    const stop = this.recordRefusal(digest, v.record, { block: v.block, timestamp: v.blockTimestamp });
    if (stop) return stop;
    if (claimOperatorsHash(req.operators).toLowerCase() !== opsHash.toLowerCase()) {
      return refuse("bad_ops", "these operators are not the claim's (ClaimAccepted event, same order): the contract would refuse (BadOps)");
    }
    if (v.bounty.productId !== this.kit.productId) {
      return refuse("wrong_product", `bounty #${claim.bountyId} belongs to product #${v.bounty.productId}; this enclave serves product #${this.kit.productId}`);
    }
    const me = v.myOperator.toLowerCase();
    if (me === zeroAddress) {
      return refuse("inactive", `this enclave is not active for product #${v.bounty.productId} at block ${v.block}: its signature would be refused (NoValidSigner)`);
    }
    if (req.operators.some((o) => o.toLowerCase() === me)) {
      return refuse("claim_operator", `this enclave's operator (${getAddress(me)}) signed the claim: it cannot refute it (RefuterIsClaimOperator)`);
    }

    // 2. the exploit, encrypted to THIS enclave for THIS claim; v2.1 ter: only HPKE errors are a refusal
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(req.enc, req.ciphertext, refuteRequestAad(digest));
    } catch (e) {
      if (!(e instanceof HpkeError)) throw e; // environment: 503, nothing cached
      return refuse("undecryptable", "request cannot be decrypted by this enclave (another X25519 key, or encrypted for another claim)");
    }
    try {
      let est: Established;
      try {
        est = await this.establish(plain, claim, v.bounty);
      } catch (e) {
        if (e instanceof RefuseError) return refuse(e.code, e.message);
        throw e;
      }
      // 3. the counter-replay, once per claim (concurrent requests wait for the same result); a failure is cached for
      //    `failureTtlMs` (v2.1 bis) and then cleared: never a verdict, never a repeated full replay.
      //    v2.1 ter: a full queue ("busy") or an exceeded rate is NOT a replay failure (proofs D3, D4), and neither is
      //    an environment exception: nothing is cached, and the next request can replay at once
      let p = this.outcomes.get(key);
      if (!p) {
        p = this.decide(claim, digest, est, v);
        this.outcomes.set(key, p);
        p.catch((e) => {
          this.outcomes.delete(key);
          if (!isMemorizableFailure(e)) return;
          this.failures.set(key, this.nowMs() + (this.cfg.failureTtlMs ?? 60_000));
          for (const [k, t] of this.failures) if (t <= this.nowMs()) this.failures.delete(k); // housekeeping
        });
      }
      return await p;
    } finally {
      plain.fill(0); // best effort
    }
  }

  /** Binds the plaintext to the claim (cPHash first); RefuseError if nothing is established. */
  private async establish(plain: Uint8Array, claim: Claim, bounty: BountyView): Promise<Established> {
    let msg: any;
    try {
      msg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    } catch (e) {
      // v2.1 ter: invalid UTF-8 or unreadable JSON, nothing else (environment: 503)
      if (!isInvalidUtf8Error(e) && !(e instanceof SyntaxError)) throw e;
      throw new RefuseError("bad_request", "unreadable request (JSON expected)");
    }
    if (msg?.from === "hunter") return this.fromHunter(msg, claim, bounty);
    if (msg?.from === "protocol") return this.fromProtocol(msg, claim, bounty);
    throw new RefuseError("bad_request", "\"from\" expected: \"hunter\" (bundle + r) or \"protocol\" (cP + sharedSecret or protocolPrivateKey)");
  }

  private async fromHunter(msg: any, claim: Claim, bounty: BountyView): Promise<Established> {
    // v2.1 bis: bounded nesting BEFORE any serialization (JSON.stringify is recursive: its failure would depend on the stack)
    if (jsonDepthExceeds(msg, MAX_REPORT_DEPTH)) {
      throw new RefuseError("bad_request", "bundle nested beyond the predicate's bounds: it cannot be bound safely to the claim, nothing is replayed");
    }
    // read as /bounty/submit reads it (BigInt, raw values), to recompute exactly the same cP; v2.1 ter: only BigInt's
    // deterministic refusals (jsonBigInt); anything else propagates
    const bountyId = jsonBigInt(msg.bountyId);
    const capital = jsonBigInt(msg.capital);
    if (bountyId === undefined || capital === undefined) throw new RefuseError("bad_request", "bundle: integer bountyId and capital expected");
    if (typeof msg.r !== "string" || !isHex(msg.r)) throw new RefuseError("bad_request", "bundle: r (hexadecimal) expected");
    const bundle: ExploitBundle = {
      bountyId, payee: msg.payee, capital, predicate: msg.predicate, txs: msg.txs ?? [], attackCode: msg.attackCode ?? undefined,
      r: msg.r as Hex, cP: "0x",
    };
    // v2.1 ter: the only DETERMINISTIC failure of the recomputation (JSON values of bounded nesting, hexadecimal r): a
    // low-order X25519 key for the bounty (no seal to it is possible). It is ruled out here; any exception of the recomputation propagates (503)
    if (isSmallOrderX25519(toBytes(bounty.protocolX25519))) {
      throw new RefuseError("bad_request", "bundle: cP cannot be recomputed (the bounty's X25519 key has low order)");
    }
    const cP = await this.protocolCipher.recompute(bundle, bounty.protocolX25519);
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuseError(
        "exploit_mismatch",
        "this bundle and this randomness r do not give back the claim's cPHash: it is not the claimed exploit, nothing is replayed",
      );
    }
    bundle.cP = cP;
    return { bundle, fault: this.faultOf(bundle, claim) };
  }

  private async fromProtocol(msg: any, claim: Claim, bounty: BountyView): Promise<Established> {
    const cP = msg.cP;
    // no minimum length here: a cP too short to be a seal is PROVEN with the bounty's key (below)
    if (!isEvenHex(cP)) throw new RefuseError("bad_request", "cP: even-length hexadecimal (ephemeral key ‖ ciphertext) expected");
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuseError("exploit_mismatch", "keccak256(cP) ≠ the claim's cPHash: it is not this claim's report, nothing is replayed");
    }
    const hasSecret = msg.sharedSecret !== undefined;
    const hasKey = msg.protocolPrivateKey !== undefined;
    if (hasSecret === hasKey) throw new RefuseError("bad_request", "give sharedSecret OR protocolPrivateKey (32 bytes), not both");
    const secret = hasKey ? msg.protocolPrivateKey : msg.sharedSecret;
    if (!isBytes32(secret)) throw new RefuseError("bad_request", `${hasKey ? "protocolPrivateKey" : "sharedSecret"}: 32 bytes expected`);
    const raw = toBytes(secret);
    const sealed = toBytes(cP);
    const ephPub = sealed.slice(0, 32);
    let shared: Uint8Array;
    try {
      if (hasKey) {
        if (toHex(x25519.getPublicKey(raw)).toLowerCase() !== bounty.protocolX25519.toLowerCase()) {
          throw new RefuseError("exploit_mismatch", "this private key does not give back the bounty's X25519 key (Bounty.protocolX25519)");
        }
        // v2.1 ter: an ephemeral key that is too short or of low order is a DETERMINISTIC fault (checked first, without an
        // exception); any X25519 exception propagates (503)
        if (ephPub.length !== 32 || isSmallOrderX25519(ephPub)) return { fault: FAULT.ephemeralKey };
        shared = x25519.getSharedSecret(raw, ephPub);
      } else {
        shared = raw.slice();
      }
    } finally {
      raw.fill(0);
    }
    const verified = hasKey; // decryption is certain only with the key verified on-chain
    let text: string | undefined;
    try {
      // v2.1 ter: only three failures are DETERMINISTIC (a seal that is too short, an invalid tag, invalid UTF-8); any
      // other exception (memory, environment) propagates: 503, nothing signed, nothing cached (proof e8)
      const opened = openSealedChecked(sealed, shared);
      if (opened !== undefined) {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(opened);
        } catch (e) {
          if (!isInvalidUtf8Error(e)) throw e;
        }
      }
    } finally {
      shared.fill(0);
    }
    if (text === undefined) {
      if (verified) return { fault: FAULT.unreadable };
      throw new RefuseError(
        "exploit_mismatch",
        "cP does not open with this shared secret; if the report is really unreadable, only the bounty's private key (protocolPrivateKey) can prove it",
      );
    }
    const content = canonicalContent(text);
    if (content === "too_deep") {
      if (verified) return { fault: FAULT.tooDeep };
      throw new RefuseError(
        "exploit_mismatch",
        "the plaintext is nested beyond the bounds (a false secret, or a forged report: the bounty's private key would prove it)",
      );
    }
    if (!content) {
      if (verified) return { fault: FAULT.notCanonical };
      throw new RefuseError(
        "exploit_mismatch",
        "the plaintext is not a canonical bundle (a false secret, or a forged report: the bounty's private key would prove it)",
      );
    }
    const bundle: ExploitBundle = { ...content, r: "0x", cP };
    return { bundle, fault: this.faultOf(bundle, claim) };
  }

  /**
   * Does the established content of cP contradict the claim, or a deterministic rule? (an honest enclave would have
   * signed nothing). v2.1 bis: only the listed rules count (FAULT, PredicateError, ReplayRuleError), with fixed notes;
   * any other exception propagates (503, nothing signed).
   */
  private faultOf(b: ExploitBundle, claim: Claim): string | undefined {
    if (b.bountyId !== claim.bountyId) return FAULT.bounty;
    if (typeof b.payee !== "string" || b.payee.toLowerCase() !== claim.payee.toLowerCase()) return FAULT.payee;
    if (!Array.isArray(b.txs) || !b.txs.every(isEvenHex)) return FAULT.txs;
    if (b.attackCode !== undefined && !isEvenHex(b.attackCode)) return FAULT.attackCode;
    if (exploitFingerprint(b).toLowerCase() !== claim.fingerprint.toLowerCase()) return FAULT.fingerprint;
    try {
      validatePredicate(b.predicate); // rules P1–P4, iterative: never an exhausted stack
    } catch (e) {
      if (e instanceof PredicateError) return `${FAULT.predicate} (${e.message})`;
      throw e;
    }
    if (predicateHash(b.predicate).toLowerCase() !== claim.predicateHash.toLowerCase()) return FAULT.predicateHash;
    try {
      this.fork.validate?.(b);
    } catch (e) {
      if (e instanceof ReplayRuleError) return `${FAULT.replayRules} (${e.message})`;
      throw e;
    }
    return undefined;
  }

  private async decide(claim: Claim, digest: Hex, est: Established, v: RefuteChainView): Promise<Decided> {
    let replay: ReplayOutcome;
    if (est.fault !== undefined || !est.bundle) {
      replay = { blockN: claim.blockN, replayed: false, satisfied: false, loss: 0n, tier: -1, proven: false, note: est.fault };
    } else {
      const bundle = est.bundle;
      // v2.1 bis: the replay fails closed (and checks that its RPC serves the anchored block N); the predicate passed the
      // rules (faultOf): an exception of the evaluation is an outage, never a verdict → it propagates (503, nothing signed)
      const { ctx } = await this.fork.run({ blockN: claim.blockN, bundle, expectedBlockHash: claim.blockHashN });
      const ev = evaluate(bundle.predicate, ctx);
      const tier = ev.satisfied ? pickTier(v.bounty.tierMinLoss, ev.loss) : -1;
      replay = { blockN: claim.blockN, replayed: true, satisfied: ev.satisfied, loss: ev.loss, tier, proven: ev.satisfied && tier >= 0 };
    }

    if (replay.proven && replay.loss === claim.loss && replay.tier === claim.tier) {
      return {
        status: "confirmed",
        claimDigest: digest,
        replay,
        reason: `the counter-replay at block ${claim.blockN} gives back the claim (loss ${claim.loss}, tier ${claim.tier}): no refutation signed`,
      };
    }
    const refutation: Refutation = replay.proven
      ? { claimDigest: digest, proven: true, loss: replay.loss, tier: replay.tier }
      : { claimDigest: digest, proven: false, loss: 0n, tier: 0 };
    // guard: never a signature on an identical result (the contract would refuse: NotARefutation)
    if (refutation.proven && refutation.loss === claim.loss && refutation.tier === claim.tier) {
      throw new Error("refutation identical to the claim: not signed");
    }
    const signature = await privateKeyToAccount(this.kit.keys.signerPrivateKey).signTypedData({
      domain: domain({ chainId: this.kit.binding.chainId, verifyingContract: this.cfg.sealedBounty }),
      types: refutationTypes,
      primaryType: "Refutation",
      message: refutation,
    });
    return { status: "refuted", refutation, signature, signer: this.kit.keys.signer, operator: getAddress(v.myOperator), replay };
  }
}

/** The plaintext of a report, if it is EXACTLY a canonical bundle (canonicalProtocolPlaintext); otherwise undefined.
 *  v2.1 bis: "too_deep" if it is nested beyond MAX_REPORT_DEPTH (never serialized: JSON.stringify is recursive). */
function canonicalContent(text: string): Omit<ExploitBundle, "r" | "cP"> | "too_deep" | undefined {
  let o: any;
  try {
    o = JSON.parse(text); // iterative in V8: safe whatever the nesting
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e; // v2.1 ter: environment → 503, never FAULT.notCanonical
    return undefined;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  if (jsonDepthExceeds(o, MAX_REPORT_DEPTH)) return "too_deep";
  // v2.1 ter: only BigInt's deterministic refusals (nesting already bounded: toString of an array carries no stack risk)
  const bountyId = jsonBigInt(o.bountyId);
  const capital = jsonBigInt(o.capital);
  if (bountyId === undefined || capital === undefined) return undefined;
  const c = { bountyId, payee: o.payee, capital, predicate: o.predicate, txs: o.txs, attackCode: o.attackCode ?? undefined };
  return canonicalProtocolPlaintext(c) === text ? c : undefined;
}

const SEAL_INFO_KEY = new TextEncoder().encode("arc-sealed-key-v1");
const SEAL_INFO_NONCE = new TextEncoder().encode("arc-sealed-nonce-v1");
/** The smallest seal: ephemeral key (32) + ChaCha20-Poly1305 tag (16). */
const MIN_SEALED_BYTES = 32 + 16;

/**
 * v2.1 ter: opens a deterministic seal with the X25519 SHARED SECRET; undefined for the two DETERMINISTIC failures (a
 * seal under 48 bytes, an invalid tag); any other exception propagates.
 */
function openSealedChecked(bytes: Uint8Array, shared: Uint8Array): Uint8Array | undefined {
  if (bytes.length < MIN_SEALED_BYTES) return undefined;
  const ephPub = bytes.slice(0, 32);
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), SEAL_INFO_NONCE, 12);
  try {
    return chacha20poly1305(key, nonce).decrypt(bytes.slice(32));
  } catch (e) {
    if (isInvalidTagError(e)) return undefined;
    throw e;
  }
}

/**
 * Opens a deterministic seal (cP = ephemeral key ‖ ciphertext, kit/deterministic-seal.ts) with the X25519 SHARED SECRET
 * instead of the recipient's private key. Throws if the ciphertext does not authenticate with this secret.
 */
export function openSealedWithSharedSecret(sealed: Hex, shared: Uint8Array): Uint8Array {
  const out = openSealedChecked(toBytes(sealed), shared);
  if (out === undefined) throw new Error("seal too short, or it does not authenticate with this secret");
  return out;
}

function isBytes32(x: unknown): x is Hex {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}
