/**
 * sealed-bounty/app.ts — the HTTP application of the Sealed Bounty (O3), without side effects (testable).
 *
 * v2: ONE BountyService for the enclave's whole life (its anti-equivocation memory must see every submission); the
 * tiers are read ON-CHAIN, never taken from the hunter's request (a false tier would get an unusable claim signed, and
 * the fingerprint would then be blocked).
 *
 * v2.1: POST /v1/refute, the counter-replay of an ACCEPTED claim (RefutationService, src/services/bounty.ts):
 *   body { claim, operators, enc, ciphertext }; claim and operators as ClaimAccepted emitted them, enc/ciphertext =
 *   HPKE to this enclave's X25519 key (aad refuteRequestAad(digest)). Answer 200:
 *   { status: "refuted", refutation, signature, signer, operator, replay } | { status: "confirmed", replay, reason } |
 *   { status: "refused", code, reason }; 400 for a malformed request; 503 if the on-chain read or the replay failed
 *   (nothing signed).
 *
 * v2.1 bis (adversarial review of 9 Nov):
 *  - FIXED error answers: never the message of an exception (viem, a parser, the node: they copy bytes of the exploit);
 *  - a bounded body (MAX_BODY_BYTES: 413) on /bounty/submit and /v1/refute;
 *  - /v1/refute: a limited rate (a global token bucket: 429), the cheap read of claimRecords first (chainRefuteReader
 *    .record), bounded concurrency and cached recent failures (RefutationService): 503 "busy", nothing signed;
 *  - tiers: the end of the tierMinLoss array is recognized ONLY on an EVM revert (JSON-RPC code 3); an internal node
 *    error (-32603, which viem also files as ContractFunctionRevertedError) used to truncate the tiers silently (a
 *    false tier signed): it now propagates (503).
 *
 * v2.1 ter (adversarial verification of 9 Nov, proofs verif-failclosed e4 D1, D2, e7):
 *  - /v1/refute: the bucket's token is taken AFTER the body's shape is validated and after the cheap read of
 *    claimRecords (claim accepted, not refuted, inside the window), and only if no result is cached or in progress for
 *    this claim (RefutationService.refute, `admit`): empty bodies or invented claims no longer empty the bucket.
 *    INVALID bodies have their own cheap limit, per seen IP (429), which never touches valid requests;
 *  - /bounty/submit: a limited rate (token bucket, 429). The token is taken after the local checks (decryption,
 *    format, predicate, replay rules) and before any on-chain read; the same ciphertext repeated gets the same result
 *    without a new read (BountyService); the bounty (immutable fields set at createBounty) and its tiers are cached
 *    per bounty;
 *  - 429 carries a Retry-After header; an unreadable JSON body (SyntaxError) = 400, any other exception = 503.
 *
 * v2.1 quater (refutation demo): if the BountyService serves a DEMO fault (DEMO_FAULT, see ./demo-fault.ts), /pubkeys
 * and /health ANNOUNCE it (fields demoFault and demoFaultNote); otherwise these answers are exactly the kit's
 * (attest-server).
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  decodeFunctionResult, encodeFunctionData, getAddress, isAddress, isHex, parseAbi, toBytes, zeroAddress,
  type Address, type Hex, type PublicClient,
} from "viem";
import type { EnclaveKit } from "../../src/kit/enclave-kit";
import type { Claim } from "../../src/kit/eip712";
import type { RpcQuorum } from "../../src/kit/rpc-quorum";
import { createAttestServer, type AttestServerOptions } from "../../src/server/attest-server";
import {
  ReplayUnavailableError,
  type BountyReader, type BountyService, type BountyView, type DemoFault, type RefutationService, type RefuteReader, type RefuteRequest,
  type RefuteResult, type ReplayOutcome,
} from "../../src/services/bounty";
import { demoFaultNotice } from "./demo-fault";

export interface SealedBountyDeps {
  kit: EnclaveKit;
  service: BountyService;
  /** v2.1: the counter-replay of accepted claims (absent: /v1/refute answers 501). */
  refuter?: RefutationService;
  /** Options of /attest (default: OPERATOR_ALLOWLIST read from the environment). */
  attest?: AttestServerOptions;
  /** v2.1 bis: the rate of /v1/refute (a global token bucket; default 20 requests, 20 per minute); false: no limit.
   *  v2.1 ter: the token is taken only after the body's shape and claimRecords (a live claim, with no cached result). */
  refuteRateLimit?: { burst: number; perMinute: number } | false;
  /** v2.1 ter: INVALID bodies of /v1/refute, per seen IP (default 30, 30 per minute); beyond: 429 for these bodies only. */
  refuteBadBodyLimit?: { burst: number; perMinute: number } | false;
  /** v2.1 ter: the rate of /bounty/submit (a global token bucket; default 8, 8 per minute); false: no limit. */
  submitRateLimit?: { burst: number; perMinute: number } | false;
  /** The limiters' clock (ms); for tests. */
  nowMs?: () => number;
}

/** v2.1 bis: the maximum size of a request body (a bundle of 10 transactions of 64 KiB, in hexadecimal, encrypted). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** v2.1 bis: FIXED 503 answers (nothing from the original exception). */
export const UNAVAILABLE = {
  submit: "on-chain read or replay failed: nothing is signed, try again later",
  refute: "on-chain read or counter-replay failed, nothing is signed: try again later",
  busy: "enclave busy (replay queue or refutations in progress): nothing is signed, try again later",
  recent: "the counter-replay of this claim failed a moment ago: nothing is signed, try again in a minute",
} as const;

/** v2.1 ter: FIXED 429 answers. */
export const RATE_LIMITED = {
  submit: "too many submissions: try again in a few seconds (nothing is signed)",
  refute: "too many refutation requests: try again in a few seconds (nothing is signed)",
  badBody: "too many invalid bodies from this address: try again later",
} as const;

/** A token bucket (the rate of a route): `burst` requests in a row, then `perMinute` per minute. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private burst: number, private perMinute: number, private now: () => number = Date.now) {
    this.tokens = burst;
    this.last = now();
  }
  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }
  take(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** v2.1 ter: seconds before the next token (Retry-After header). */
  retryAfterSeconds(): number {
    this.refill();
    if (this.tokens >= 1 || this.perMinute <= 0) return this.perMinute <= 0 ? 60 : 0;
    return Math.max(1, Math.ceil(((1 - this.tokens) / this.perMinute) * 60));
  }
}

/** v2.1 ter: one bucket per key (seen IP), bounded in number (the least recent keys leave). */
export class KeyedTokenBuckets {
  private buckets = new Map<string, TokenBucket>();
  constructor(private burst: number, private perMinute: number, private now: () => number = Date.now, private maxKeys = 4_096) {}
  private bucket(key: string): TokenBucket {
    let b = this.buckets.get(key);
    if (b) {
      this.buckets.delete(key); // the most recent goes last
    } else {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      b = new TokenBucket(this.burst, this.perMinute, this.now);
    }
    this.buckets.set(key, b);
    return b;
  }
  take(key: string): boolean {
    return this.bucket(key).take();
  }
  retryAfterSeconds(key: string): number {
    return this.bucket(key).retryAfterSeconds();
  }
}

const tooLarge = (c: Context) => c.json({ error: `body larger than ${MAX_BODY_BYTES} bytes` }, 413);

function unavailable(e: unknown, which: "submit" | "refute"): string {
  if (e instanceof ReplayUnavailableError) {
    if (e.reason === "busy" || e.reason === "refute_busy") return UNAVAILABLE.busy;
    if (e.reason === "recent_failure") return UNAVAILABLE.recent;
  }
  return UNAVAILABLE[which];
}

/** v2.1 ter: the IP address the server sees (the TCP peer; behind a gateway, the gateway's). */
function seenIp(c: Context): string {
  const a = (c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming?.socket?.remoteAddress;
  return typeof a === "string" && a !== "" ? a : "unknown";
}

/** v2.1 ter: the JSON body; `undefined` if it is not JSON (SyntaxError). Any other exception propagates (503). */
async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

const isRateLimited = (e: unknown) => e instanceof ReplayUnavailableError && e.reason === "rate_limited";

/**
 * /attest, /pubkeys, /health (attest-server). v2.1 quater: a faulty DEMO enclave announces it on /pubkeys and /health
 * (routes set BEFORE the kit's, CORS included); without a fault, these are exactly the kit's routes.
 */
function attestRoutes(kit: EnclaveKit, attest: AttestServerOptions | undefined, fault: DemoFault | undefined): Hono {
  const base = createAttestServer(kit, attest);
  if (fault === undefined) return base;
  const notice = demoFaultNotice(fault);
  const app = new Hono();
  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true, ...notice }));
  app.get("/pubkeys", (c) => c.json({ ...kit.pubkeys(), ...notice }));
  app.route("/", base);
  return app;
}

export function createSealedBountyApp(d: SealedBountyDeps): Hono {
  // /attest, /pubkeys, /health; the demo fault comes from the service itself (one source: its configuration)
  const app = attestRoutes(d.kit, d.attest, (d.service as BountyService | undefined)?.demoFault);
  const limit = d.refuteRateLimit === false ? undefined : new TokenBucket(d.refuteRateLimit?.burst ?? 20, d.refuteRateLimit?.perMinute ?? 20, d.nowMs);
  const badBodies = d.refuteBadBodyLimit === false
    ? undefined : new KeyedTokenBuckets(d.refuteBadBodyLimit?.burst ?? 30, d.refuteBadBodyLimit?.perMinute ?? 30, d.nowMs);
  const submitLimit = d.submitRateLimit === false ? undefined : new TokenBucket(d.submitRateLimit?.burst ?? 8, d.submitRateLimit?.perMinute ?? 8, d.nowMs);

  app.post("/bounty/submit", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    let body: any;
    try {
      body = await readJson(c);
    } catch {
      return c.json({ error: UNAVAILABLE.submit }, 503);
    }
    if (!body?.enc || !body?.ciphertext) return c.json({ error: "cE missing" }, 400);
    if (!isHex(body.enc) || !isHex(body.ciphertext)) return c.json({ error: "cE invalid (hexadecimal expected)" }, 400);
    // body.tierMinLoss (v1) is ignored: the tiers come from the chain.
    let res: Awaited<ReturnType<BountyService["submit"]>>;
    try {
      res = await d.service.submit(
        { enc: toBytes(body.enc as Hex), ciphertext: toBytes(body.ciphertext as Hex) },
        { admit: submitLimit ? () => submitLimit.take() : undefined },
      );
    } catch (e) {
      if (isRateLimited(e)) {
        c.header("Retry-After", String(submitLimit?.retryAfterSeconds() ?? 60));
        return c.json({ error: RATE_LIMITED.submit }, 429);
      }
      return c.json({ error: unavailable(e, "submit") }, 503);
    }
    if (res.status === "not_proven") return c.json({ status: "not_proven", reason: res.reason }, 200);
    return c.json({
      status: "proven",
      cP: res.cP,
      signature: res.signature,
      claim: {
        bountyId: res.claim.bountyId.toString(),
        payee: res.claim.payee,
        blockN: res.claim.blockN.toString(),
        blockHashN: res.claim.blockHashN,
        predicateHash: res.claim.predicateHash,
        loss: res.claim.loss.toString(),
        tier: res.claim.tier,
        fingerprint: res.claim.fingerprint,
        cPHash: res.claim.cPHash,
        deadline: res.claim.deadline.toString(),
      },
    });
  });

  app.post("/v1/refute", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    if (!d.refuter) return c.json({ error: "refutation not available on this enclave" }, 501);
    let req: RefuteRequest;
    try {
      req = parseRefuteBody(await readJson(c));
    } catch (e) {
      if (!(e instanceof RefuteBodyError)) return c.json({ error: UNAVAILABLE.refute }, 503); // environnement
      // v2.1 ter: an invalid body costs nothing and takes NO token from the valid requests' bucket; its own limit, per
      // seen IP, applies only to invalid bodies
      const ip = seenIp(c);
      if (badBodies && !badBodies.take(ip)) {
        c.header("Retry-After", String(badBodies.retryAfterSeconds(ip)));
        return c.json({ error: RATE_LIMITED.badBody }, 429);
      }
      return c.json({ error: e.message }, 400);
    }
    let res: RefuteResult;
    try {
      // the service takes the token AFTER the cheap read of claimRecords (a live claim)
      res = await d.refuter.refute(req, { admit: limit ? () => limit.take() : undefined });
    } catch (e) {
      if (isRateLimited(e)) {
        c.header("Retry-After", String(limit?.retryAfterSeconds() ?? 60));
        return c.json({ error: RATE_LIMITED.refute }, 429);
      }
      return c.json({ error: unavailable(e, "refute") }, 503);
    }
    return c.json(refuteResultJson(res), 200);
  });

  return app;
}

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

/** v2.1 bis: a malformed /v1/refute body; FIXED message (the field's name, never its value). */
export class RefuteBodyError extends Error {}

/** The body of POST /v1/refute → RefuteRequest; throws RefuteBodyError (a fixed message) if malformed. */
export function parseRefuteBody(body: any): RefuteRequest {
  if (!body || typeof body !== "object") throw new RefuteBodyError("JSON body expected: { claim, operators, enc, ciphertext }");
  const claim = parseClaimJson(body.claim);
  const ops = body.operators;
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 5 || !ops.every((o: unknown) => typeof o === "string" && isAddress(o, { strict: false }))) {
    throw new RefuteBodyError("operators: 1 to 5 addresses (those of ClaimAccepted, same order)");
  }
  if (typeof body.enc !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.enc)) throw new RefuteBodyError("enc: 32-byte HPKE encapsulated key expected");
  if (typeof body.ciphertext !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(body.ciphertext)) throw new RefuteBodyError("ciphertext: even-length hexadecimal expected");
  return {
    claim,
    operators: ops.map((o: string) => getAddress(o.toLowerCase())),
    enc: toBytes(body.enc as Hex),
    ciphertext: toBytes(body.ciphertext as Hex),
  };
}

/** A claim in JSON (decimal strings, as /bounty/submit returns it) → Claim, bounds of the Solidity types included. */
export function parseClaimJson(c: any): Claim {
  if (!c || typeof c !== "object") throw new RefuteBodyError("claim: object expected (the claim of ClaimAccepted)");
  const uint = (k: string, max: bigint): bigint => {
    const v = c[k];
    const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
    if (typeof s !== "string" || !/^[0-9]{1,78}$/.test(s) || BigInt(s) > max) throw new RefuteBodyError(`claim.${k}: decimal integer expected`);
    return BigInt(s);
  };
  const b32 = (k: string): Hex => {
    if (typeof c[k] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(c[k])) throw new RefuteBodyError(`claim.${k}: bytes32 expected`);
    return c[k] as Hex;
  };
  const tier = typeof c.tier === "string" && /^[0-9]{1,3}$/.test(c.tier) ? Number(c.tier) : c.tier;
  if (!Number.isInteger(tier) || tier < 0 || tier > 255) throw new RefuteBodyError("claim.tier: integer from 0 to 255 expected");
  if (typeof c.payee !== "string" || !isAddress(c.payee, { strict: false })) throw new RefuteBodyError("claim.payee: address expected");
  return {
    bountyId: uint("bountyId", UINT256_MAX),
    payee: getAddress(c.payee.toLowerCase()),
    blockN: uint("blockN", UINT64_MAX),
    blockHashN: b32("blockHashN"),
    predicateHash: b32("predicateHash"),
    loss: uint("loss", UINT256_MAX),
    tier,
    fingerprint: b32("fingerprint"),
    cPHash: b32("cPHash"),
    deadline: uint("deadline", UINT64_MAX),
  };
}

function replayJson(x: ReplayOutcome) {
  return {
    blockN: x.blockN.toString(), replayed: x.replayed, satisfied: x.satisfied, loss: x.loss.toString(), tier: x.tier, proven: x.proven,
    ...(x.note ? { note: x.note } : {}),
  };
}

/** RefuteResult → JSON (amounts as decimal strings). */
export function refuteResultJson(r: RefuteResult) {
  switch (r.status) {
    case "refuted":
      return {
        status: r.status,
        refutation: { claimDigest: r.refutation.claimDigest, proven: r.refutation.proven, loss: r.refutation.loss.toString(), tier: r.refutation.tier },
        signature: r.signature,
        signer: r.signer,
        operator: r.operator,
        replay: replayJson(r.replay),
      };
    case "confirmed":
      return { status: r.status, claimDigest: r.claimDigest, replay: replayJson(r.replay), reason: r.reason };
    case "refused":
      return { status: r.status, code: r.code, reason: r.reason };
  }
}

const SEALED_BOUNTY_READ_ABI = parseAbi([
  "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
  "function getBounty(uint256 id) view returns (Bounty)",
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function claimRecords(bytes32) view returns (uint64 acceptedAt, bool refuted, bytes32 opsHash)",
  "function REFUTE_WINDOW() view returns (uint64)",
]);

const ENCLAVE_REGISTRY_ACTIVE_ABI = parseAbi([
  "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
]);

/** The maximum number of tiers read (the contract does not bound it; beyond it, a refusal rather than a truncation). */
export const MAX_TIERS = 16;

/** v2.1 ter: the maximum number of bounties kept in the cache (the oldest leave). */
export const MAX_CACHED_BOUNTIES = 256;

type BountyAt = BountyView & { productId: bigint };

/**
 * v2.1 ter: a per-bounty cache of its IMMUTABLE fields (SealedBounty.createBounty sets them once and for all:
 * productId, predicateHash, protocolX25519, deadline, tierMinLoss): one more submission or refutation does not read 17
 * tiers again. Only a bounty that EXISTS (protocol ≠ 0) is kept: an id not created yet is never frozen.
 */
export class BountyCache {
  private m = new Map<string, BountyAt>();
  constructor(private max = MAX_CACHED_BOUNTIES) {}
  get(bountyId: bigint): BountyAt | undefined {
    return this.m.get(bountyId.toString());
  }
  put(bountyId: bigint, v: BountyAt): void {
    if (!this.m.has(bountyId.toString()) && this.m.size >= this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
    this.m.set(bountyId.toString(), v);
  }
  get size(): number {
    return this.m.size;
  }
}

/** A bounty and its tiers, read at the given block (one provider of the quorum); `exists`: protocol ≠ 0 (bounty created). */
async function readBountyAt(c: PublicClient, sealedBounty: Address, bountyId: bigint, blockNumber: bigint): Promise<BountyAt & { exists: boolean }> {
  const b = await c.readContract({
    address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "getBounty", args: [bountyId], blockNumber,
  });
  const tierMinLoss: bigint[] = [];
  for (let i = 0; ; i++) {
    let minLoss: bigint;
    try {
      // c.call (not readContract): the error keeps the node's JSON-RPC code (readContract files -32603 as a "revert")
      const { data } = await c.call({
        to: sealedBounty, data: encodeFunctionData({ abi: SEALED_BOUNTY_READ_ABI, functionName: "tierMinLoss", args: [bountyId, BigInt(i)] }), blockNumber,
      });
      if (data === undefined) throw new Error("tierMinLoss: empty answer");
      minLoss = decodeFunctionResult({ abi: SEALED_BOUNTY_READ_ABI, functionName: "tierMinLoss", data });
    } catch (e) {
      if (isJsonRpcRevert(e)) break; // end of the array: an EVM revert (Panic 0x32; Arc's public RPC returns no data for it)
      throw e; // a network or internal node error: never truncate the tiers silently
    }
    if (i === MAX_TIERS) throw new Error(`bounty #${bountyId}: more than ${MAX_TIERS} tiers, not supported`);
    tierMinLoss.push(minLoss);
  }
  return {
    predicateHash: b.predicateHash, protocolX25519: b.protocolX25519, tierMinLoss, deadline: b.deadline, productId: b.productId,
    exists: b.protocol.toLowerCase() !== zeroAddress,
  };
}

/** The bounty without the `exists` flag, cached if it exists. */
function keepBounty(cache: BountyCache, bountyId: bigint, v: BountyAt & { exists: boolean }): BountyAt {
  const { exists, ...view } = v;
  if (exists) cache.put(bountyId, view);
  return view;
}

/** v2.1 bis: true if the error comes from an EVM revert: JSON-RPC code 3 (EIP-1474) somewhere in the chain of causes.
 *  A -32603 (internal), -32000 or transport error is not one. */
export function isJsonRpcRevert(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x.code === 3) return true;
  }
  return false;
}

/** On-chain reader of a bounty AND its tiers, through the RPC quorum (reads at the same block). v2.1 ter: a bounty that
 *  exists is read ONCE (immutable fields, BountyCache); `cache` can be shared with chainRefuteReader. */
export function chainBountyReader(rpc: RpcQuorum, sealedBounty: Address, cache: BountyCache = new BountyCache()): BountyReader {
  return {
    getBounty: async (bountyId: bigint) => {
      const hit = cache.get(bountyId);
      if (hit) return hit;
      return keepBounty(cache, bountyId, await rpc.readAtCommonHead((c, blockNumber) => readBountyAt(c, sealedBounty, bountyId, blockNumber)));
    },
  };
}

/**
 * v2.1: on-chain reader of a claim to refute, through the RPC quorum, EVERYTHING at the same block: claimRecords(digest),
 * REFUTE_WINDOW, the bounty (product, predicate, protocol key, tiers), the active operator of THIS enclave for the
 * bounty's product (EnclaveRegistry.activeOperatorAt) and the block's timestamp (the window is counted as the contract
 * counts it). v2.1 ter: REFUTE_WINDOW (a constant of the contract) and the bounty (immutable fields) are read only once (BountyCache).
 */
export function chainRefuteReader(rpc: RpcQuorum, sealedBounty: Address, registry: Address, cache: BountyCache = new BountyCache()): RefuteReader {
  let window: bigint | undefined; // SealedBounty.REFUTE_WINDOW : constante
  return {
    // v2.1 bis: the cheap read done first (common head + claimRecords, one read per provider)
    record: ({ claimDigest }) =>
      rpc.readAtCommonHead(async (c, blockNumber) => {
        const [acceptedAt, refuted, opsHash] = await c.readContract({
          address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "claimRecords", args: [claimDigest], blockNumber,
        });
        return { block: blockNumber, record: { acceptedAt: BigInt(acceptedAt), refuted, opsHash } };
      }),
    read: async ({ claimDigest, bountyId, signer }) => {
      const cached = cache.get(bountyId);
      const knownWindow = window;
      const v = await rpc.readAtCommonHead(async (c, blockNumber) => {
        const [acceptedAt, refuted, opsHash] = await c.readContract({
          address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "claimRecords", args: [claimDigest], blockNumber,
        });
        const refuteWindow = knownWindow
          ?? BigInt(await c.readContract({ address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "REFUTE_WINDOW", blockNumber }));
        const bounty = cached ? { ...cached, exists: true } : await readBountyAt(c, sealedBounty, bountyId, blockNumber);
        const myOperator = await c.readContract({
          address: registry, abi: ENCLAVE_REGISTRY_ACTIVE_ABI, functionName: "activeOperatorAt", args: [signer, bounty.productId, blockNumber], blockNumber,
        });
        const block = await c.getBlock({ blockNumber, includeTransactions: false });
        return {
          block: blockNumber,
          blockTimestamp: block.timestamp,
          record: { acceptedAt: BigInt(acceptedAt), refuted, opsHash },
          refuteWindow,
          bounty,
          myOperator,
        };
      });
      window = v.refuteWindow; // read through the quorum: the contract's constant
      return { ...v, bounty: keepBounty(cache, bountyId, v.bounty) };
    },
  };
}

/** Removed in v2.1 bis: it filed an internal node error (-32603) among the reverts. See isJsonRpcRevert. */
export const isRevert = isJsonRpcRevert;
