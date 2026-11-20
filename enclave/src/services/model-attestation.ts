/**
 * model-attestation.ts — the enclave VERIFIES the model provider instead of trusting it (11 Nov 2026).
 *
 * Before, the enclave forwarded the decrypted request over HTTPS to RedPill, and the README said so: the provider reads
 * the request, and ArcHive does not verify its attestation. Now (MODEL_ATTESTATION=aci, a MEASURED variable of the
 * compose file):
 *  1. at start-up, @phala/aci-verifier (Phala, Apache-2.0) establishes the identity of RedPill's gateway ("Attested
 *     Confidential Inference"): an Intel TDX quote verified up to Intel's root (dcap-qvl), the gateway's key set bound
 *     to the quote for OUR nonce, unexpired keys, a compose file measured in RTMR3 (the log replayed);
 *  2. ArcHive ALSO requires the gateway's PRODUCTION OS image (RTMR3 event "os-image-hash", authenticated by this replay,
 *     in MODEL_GATEWAY_OS_IMAGES): a development image allows operator access;
 *  3. each request to the model goes over a TLS connection PINNED to the gateway's attested key, and each answer must
 *     carry a gateway receipt that names a verified upstream service (`requireVerified`, `requireReceipt`);
 *  4. the identity is verified again regularly (fresh nonce) and before it expires; a failure makes the call
 *     impossible (the service answers with an error, nothing is invented).
 * The state of this verification is public (GET /model-attestation): clients see what the enclave verified.
 */
import { createHash } from "node:crypto";
import { connectAci, type AciConnection } from "@phala/aci-verifier/runtime";

/** The production OS image dstack-0.5.12 (VERIFIED on 10 Nov 2026: our VMs and RedPill's gateway). */
export const DSTACK_PROD_OS_0_5_12 = "8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd";

/**
 * The digest of an event of dstack's RTMR log, formula V1: SHA384(le32(type) ‖ ":" ‖ name ‖ ":" ‖ payload), the one
 * RedPill's gateway emits today (VERIFIED: it reproduces the 10 digests of the real report). `DstackEventLog.sol` ALSO
 * handles a V2 variant (RFC 8785 canonical JSON) not emitted here; if RedPill moved to it, `boundEventPayload` would
 * refuse (fail CLOSED, never a false positive), and support would be added then.
 * HARDENING (adversarial review of 11 Nov): Phala's verifier folds RTMR3 from the `digest` of each event (bound to the
 * quote), but it does NOT redo this computation; one could therefore keep the digest and rewrite the name and the
 * payload. So the code binds name + payload to the digest and, on top of that, REDOES the log → quote fold itself (see `foldImr3`).
 */
export function dstackEventDigest(eventType: number, event: string, payloadHex: string): string {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(eventType >>> 0, 0);
  return createHash("sha384")
    .update(Buffer.concat([le, Buffer.from(":"), Buffer.from(event), Buffer.from(":"), Buffer.from(payloadHex, "hex")]))
    .digest("hex");
}

/** The payload of a SINGLE RTMR3 event (imr=3) with this name, but ONLY if its digest recomputes (name + payload bound
 *  to the digest). Otherwise null: absent, ambiguous, or a payload rewritten behind an unchanged digest. */
export function boundEventPayload(report: unknown, name: string): string | null {
  const ev = (report as any)?.attestation?.evidence?.event_log;
  let log: unknown;
  try {
    log = typeof ev === "string" ? JSON.parse(ev) : ev;
  } catch {
    return null;
  }
  if (!Array.isArray(log)) return null;
  const hits = log.filter((e: any) => e && Number(e.imr) === 3 && e.event === name);
  if (hits.length !== 1) return null; // absent or ambiguous: never accepted
  const e: any = hits[0];
  const payload = String(e.event_payload ?? "").toLowerCase();
  const digest = String(e.digest ?? "").toLowerCase();
  const et = Number(e.event_type);
  if (!/^(?:[0-9a-f]{2})*$/.test(payload)) return null; // bytes in hexadecimal
  if (!/^[0-9a-f]{96}$/.test(digest) || !Number.isInteger(et)) return null; // digest SHA-384
  if (dstackEventDigest(et, name, payload) !== digest) return null; // payload NOT bound to the quote → rejected
  return payload;
}

/** RTMR3 (48 bytes) read IN the report's TDX quote: a 48-byte header + the report body (…, rtmr0@376, rtmr1@424,
 *  rtmr2@472, rtmr3@520). This quote is the one the verifier took up to Intel's root. */
export function quoteRtmr3Of(report: unknown): string | null {
  const q = (report as any)?.attestation?.evidence?.quote ?? (report as any)?.intel_quote;
  if (typeof q !== "string") return null;
  const b = Buffer.from(q.replace(/^0x/, ""), "hex");
  if (b.length < 568) return null;
  return b.subarray(520, 568).toString("hex");
}

/** DEFENSE IN DEPTH (review of 11 Nov): the code does NOT trust Phala's verifier to bind the log to the quote; it REDOES
 *  the fold. RTMR3 starts from 48 zero bytes; at each imr=3 event, RTMR3 = SHA384(RTMR3 ‖ digest). The result must equal
 *  the quote's RTMR3. So payload → digest (boundEventPayload) → RTMR3 (here) → quote: OUR code verifies the whole chain,
 *  independently of the library's verdict. */
export function foldImr3(report: unknown): string | null {
  const ev = (report as any)?.attestation?.evidence?.event_log;
  let log: unknown;
  try {
    log = typeof ev === "string" ? JSON.parse(ev) : ev;
  } catch {
    return null;
  }
  if (!Array.isArray(log)) return null;
  let acc = Buffer.alloc(48);
  for (const e of log as any[]) {
    if (Number(e?.imr) !== 3) continue;
    const d = String(e?.digest ?? "").toLowerCase();
    if (!/^[0-9a-f]{96}$/.test(d)) return null;
    acc = createHash("sha384").update(Buffer.concat([acc, Buffer.from(d, "hex")])).digest();
  }
  return acc.toString("hex");
}

export interface ModelAttestationOptions {
  /** The OpenAI-compatible base URL of the attested gateway (e.g. https://tee.redpill.ai/v1). */
  baseUrl: string;
  /** Accepted fingerprints of the gateway's OS image (hexadecimal, without 0x). */
  osImages: readonly string[];
  /** Pinned compose fingerprints (optional): if given, the measured compose must be one of them. */
  composeHashes?: readonly string[];
  /** Periodic re-verification (default: 30 min). */
  refreshMs?: number;
  log?: (m: string) => void;
  /** Tests : remplace connectAci. */
  connect?: typeof connectAci;
}

export interface ModelAttestationStatus {
  provider: string;
  verified: boolean;
  gatewayOrigin: string;
  composeHash: string;
  osImageHash: string | null;
  workloadKeysetDigest: string;
  tlsSpkiPins: readonly string[];
  sourceProvenance: unknown;
  verifiedAt: number;
  expiresAt: number;
  checks: { id: string; status: string; title: string }[];
  servingPolicy: { requireVerified: true; requireReceipt: true };
  receiptsRecorded: number;
  lastError: string | null;
}

export class ModelAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelAttestationError";
  }
}

/** The fingerprint of the OS image read from the RTMR3 log (event "os-image-hash", BOUND to its digest), or null. */
export function osImageHashOf(report: unknown): string | null {
  const p = boundEventPayload(report, "os-image-hash");
  return p && /^[0-9a-f]{64}$/.test(p) ? p : null;
}

/** ArcHive's checks on top of the verifier's: a verified verdict, a production OS image, and a compose fingerprint BOUND
 *  to the log (and pinned if `composeHashes` is given). Returns the accepted OS image fingerprint. */
export function checkGatewayIdentity(
  id: AciConnection["identity"],
  osImages: readonly string[],
  composeHashes?: readonly string[],
): string {
  if (!id.transcript?.verdict?.verified) throw new ModelAttestationError(`model gateway NOT verified: ${id.transcript?.verdict?.line ?? "verdict missing"}`);
  const os = osImageHashOf(id.report);
  if (!os) throw new ModelAttestationError("model gateway: OS image missing from the RTMR3 log");
  if (!osImages.map((x) => x.toLowerCase().replace(/^0x/, "")).includes(os)) {
    throw new ModelAttestationError(`model gateway: OS image ${os.slice(0, 12)}… outside the production list`);
  }
  // the measured compose fingerprint must be BOUND to the log (the same flaw as the OS image) and equal to the one the
  // verifier computed from app_compose; pinned as well if a list is given
  const compose = boundEventPayload(id.report, "compose-hash");
  const idCompose = String(id.composeHash ?? "").toLowerCase().replace(/^0x/, "");
  if (!compose || !idCompose || compose !== idCompose) {
    throw new ModelAttestationError("model gateway: compose fingerprint not bound to the RTMR3 log");
  }
  if (composeHashes && composeHashes.length > 0 && !composeHashes.map((x) => x.toLowerCase().replace(/^0x/, "")).includes(idCompose)) {
    throw new ModelAttestationError(`model gateway: compose ${idCompose.slice(0, 12)}… outside the pinned list`);
  }
  // DEFENSE IN DEPTH: does the RTMR3 log fold EXACTLY onto the quote's RTMR3? If so, the digests (and so the payloads
  // bound above) are anchored to the quote by OUR computation, without trusting the library's verdict.
  const r3 = quoteRtmr3Of(id.report);
  const fold = foldImr3(id.report);
  if (!r3 || !fold || r3 !== fold) {
    throw new ModelAttestationError("model gateway: the RTMR3 log does not fold onto the quote's RTMR3");
  }
  return os;
}

/** An ATTESTED connection to the model: a pinned `fetch`, re-verified, and the public state of the verification. */
export class AttestedModel {
  private conn!: AciConnection;
  private osImageHash: string | null = null;
  private lastError: string | null = null;
  private healthy = false; // does the CURRENT gateway still pass our checks? otherwise, fail closed
  private timer: ReturnType<typeof setInterval> | undefined;

  private constructor(private o: ModelAttestationOptions) {}

  /** Re-checks the CURRENT identity (without network: an inspection of the report already verified); throws if it no
   *  longer passes. It catches an internal switch of the library to an unapproved gateway that our checks did not see. */
  private assertApproved() {
    this.osImageHash = checkGatewayIdentity(this.conn.identity, this.o.osImages, this.o.composeHashes);
  }

  /** Establishes and checks the gateway's identity; throws if it is not verified (the enclave does not start). */
  static async open(o: ModelAttestationOptions): Promise<AttestedModel> {
    const m = new AttestedModel(o);
    await m.establish();
    m.timer = setInterval(() => {
      m.refresh().catch((e) => {
        m.lastError = String((e as Error)?.message ?? e).slice(0, 200);
        o.log?.(`model attestation: re-verification failed (${m.lastError})`);
      });
    }, o.refreshMs ?? 30 * 60_000);
    m.timer.unref?.();
    return m;
  }

  private async establish() {
    const connect = this.o.connect ?? connectAci;
    const conn = await connect({ baseURL: this.o.baseUrl, serving: { requireVerified: true, requireReceipt: true } });
    this.conn = conn;
    this.assertApproved(); // throws if the gateway does not pass our checks → the enclave does not start
    this.healthy = true;
    this.lastError = null;
    this.o.log?.(`model attestation: gateway ${conn.identity.origin} VERIFIED (compose ${conn.identity.composeHash.slice(0, 12)}…, production OS image, pinned TLS, receipts required)`);
  }

  /** Re-verifies the identity (fresh nonce). The library installs the new identity BEFORE this check; if the check
   *  fails, the gateway is marked NOT healthy (fail closed) and the call throws, instead of going on serving it. */
  async refresh(): Promise<void> {
    await this.conn.refresh();
    try {
      this.assertApproved();
    } catch (e) {
      this.healthy = false;
      this.lastError = String((e as Error)?.message ?? e).slice(0, 200);
      throw e;
    }
    this.healthy = true;
    this.lastError = null;
  }

  /** The `fetch` to give the model client: pinned and FAIL CLOSED. An expired identity → re-verification (which can
   *  throw); a gateway that is not healthy or not approved right now → nothing leaves (nothing is sent to a rejected
   *  gateway, including after an internal switch of the library). */
  readonly fetch: typeof fetch = async (input: any, init?: any) => {
    if (Date.now() >= this.conn.identity.expiresAt * (this.conn.identity.expiresAt < 1e12 ? 1000 : 1)) await this.refresh();
    if (!this.healthy) throw new ModelAttestationError("model gateway not verified right now: call refused (fail closed)");
    this.assertApproved(); // before each call: does the current gateway still pass our checks?
    try {
      return await this.conn.fetch(input, init);
    } catch (e: any) {
      if (e?.code === "identity_expired") {
        await this.refresh(); // can throw (fail closed)
        this.assertApproved();
        return this.conn.fetch(input, init);
      }
      this.lastError = String(e?.code ?? e?.name ?? "error").slice(0, 60); // never the message (it can quote the request)
      throw e;
    }
  };

  get baseURL(): string {
    return this.conn.baseURL;
  }

  status(): ModelAttestationStatus {
    const id = this.conn.identity;
    return {
      provider: "RedPill private AI gateway (Attested Confidential Inference), verified with @phala/aci-verifier",
      verified: this.healthy && !!id.transcript?.verdict?.verified,
      gatewayOrigin: id.origin,
      composeHash: id.composeHash,
      osImageHash: this.osImageHash,
      workloadKeysetDigest: id.workloadKeysetDigest,
      tlsSpkiPins: id.tlsSpkiPins,
      sourceProvenance: (id.report as any)?.attestation?.source_provenance ?? null,
      verifiedAt: id.verifiedAt,
      expiresAt: id.expiresAt,
      checks: ((id.transcript as any)?.lines ?? []).map((l: any) => ({ id: String(l.id), status: String(l.status), title: String(l.title) })),
      servingPolicy: { requireVerified: true, requireReceipt: true },
      receiptsRecorded: this.conn.receipts().length,
      lastError: this.lastError,
    };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.conn.close().catch(() => undefined);
  }
}

/** MODEL_GATEWAY_OS_IMAGES (measured): accepted fingerprints of the gateway's OS image; default: dstack-0.5.12. */
export function osImagesFromEnv(v: string | undefined): string[] {
  const list = (v ?? DSTACK_PROD_OS_0_5_12).split(",").map((s) => s.trim().toLowerCase().replace(/^0x/, "")).filter(Boolean);
  if (list.length === 0 || list.some((x) => !/^[0-9a-f]{64}$/.test(x))) throw new Error("MODEL_GATEWAY_OS_IMAGES: 32-byte fingerprints in hexadecimal, separated by commas");
  return list;
}

/** MODEL_GATEWAY_COMPOSE_HASHES (measured, OPTIONAL): pinned compose fingerprints; empty = no pinning (the compose
 *  stays bound to the log, but any authentic compose passes). */
export function composeHashesFromEnv(v: string | undefined): string[] | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  const list = s.split(",").map((x) => x.trim().toLowerCase().replace(/^0x/, "")).filter(Boolean);
  if (list.length === 0 || list.some((x) => !/^[0-9a-f]{64}$/.test(x))) throw new Error("MODEL_GATEWAY_COMPOSE_HASHES: 32-byte fingerprints in hexadecimal, separated by commas");
  return list;
}

/** Corps de GET /model-attestation. */
export function modelAttestationBody(a: AttestedModel | undefined): unknown {
  return a ? a.status() : { verified: false, reason: "MODEL_ATTESTATION absent: this enclave does not verify the model provider" };
}
