/**
 * The model provider's attestation (11 Nov 2026): on RedPill's real ACI gateway report (taken on 10 Nov 2026,
 * test/fixtures/redpill-aci-report.json), the OS image is read from the RTMR3 event log and must be the production one;
 * an unverified verdict, another image or an ambiguous log makes the gateway refused; the connection is verified again
 * when the identity expires; the public status says what was verified. (The real call, with pinned TLS and a receipt,
 * was tried on 10 Nov 2026 against https://tee.redpill.ai: identity verified, gpt-oss-120b answers.)
 * Messages that the enclave code prints are matched as it prints them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AttestedModel, DSTACK_PROD_OS_0_5_12, ModelAttestationError, checkGatewayIdentity, dstackEventDigest, foldImr3, modelAttestationBody, osImageHashOf, osImagesFromEnv, quoteRtmr3Of,
} from "../src/services/model-attestation";

const REPORT = JSON.parse(readFileSync(new URL("./fixtures/redpill-aci-report.json", import.meta.url), "utf8"));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function identity(o: { verified?: boolean; report?: unknown; expiresAt?: number } = {}) {
  return {
    origin: "https://tee.redpill.ai", hostname: "tee.redpill.ai", report: o.report ?? REPORT, keyset: REPORT.attestation.workload_keyset,
    workloadKeysetDigest: REPORT.workload_keyset_digest, composeHash: "66e91ac6c2325537851bc95fc0e4489df119b7b0204d27f2bae91ec1324ecf1f",
    tlsSpkiPins: ["dd7451eed78f36e8e230047e0e1e91955810f802fea052996fa83add370a00ce"], verifiedAt: Date.now(),
    expiresAt: o.expiresAt ?? Date.now() + 3_600_000,
    transcript: {
      verdict: { verified: o.verified ?? true, line: o.verified === false ? "NOT VERIFIED (1 fail: id-1)" : "VERIFIED (5 pass, 1 skipped)" },
      lines: [{ id: "id-1", section: "9.1(1)", title: "hardware quote verifies to the TEE vendor root and binds report_data", status: "pass" }],
      verification: {},
    },
  } as any;
}

function fakeConnection(o: { verified?: boolean; expiresAt?: number; fail?: unknown } = {}) {
  const conn: any = {
    baseURL: "https://tee.redpill.ai/v1",
    identity: identity(o),
    fetch: vi.fn(async () => {
      if (o.fail) { const e = o.fail; o.fail = undefined; throw e; }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    }),
    receipts: () => [{ receiptId: "r1" }],
    refresh: vi.fn(async () => { conn.identity = identity({ ...o, expiresAt: Date.now() + 3_600_000 }); }),
    close: vi.fn(async () => {}),
  };
  return conn;
}

describe("model provider attestation", () => {
  it("RedPill's real gateway runs the production OS image (RTMR3 event log)", () => {
    expect(osImageHashOf(REPORT)).toBe(DSTACK_PROD_OS_0_5_12);
    expect(checkGatewayIdentity(identity(), [DSTACK_PROD_OS_0_5_12])).toBe(DSTACK_PROD_OS_0_5_12);
  });

  it("refused: unverified verdict, another OS image, a log with no image or an ambiguous one", () => {
    expect(() => checkGatewayIdentity(identity({ verified: false }), [DSTACK_PROD_OS_0_5_12])).toThrow(ModelAttestationError);
    expect(() => checkGatewayIdentity(identity(), ["11".repeat(32)])).toThrow(/hors de la liste/);
    const noOs = clone(REPORT);
    noOs.attestation.evidence.event_log = JSON.stringify(JSON.parse(REPORT.attestation.evidence.event_log).filter((e: any) => e.event !== "os-image-hash"));
    expect(() => checkGatewayIdentity(identity({ report: noOs }), [DSTACK_PROD_OS_0_5_12])).toThrow(/absente/);
    const twice = clone(REPORT);
    const log = JSON.parse(REPORT.attestation.evidence.event_log);
    log.push({ ...log.find((e: any) => e.event === "os-image-hash"), event_payload: "22".repeat(32) });
    twice.attestation.evidence.event_log = JSON.stringify(log);
    expect(osImageHashOf(twice)).toBeNull();
  });

  it("MODEL_GATEWAY_OS_IMAGES: production dstack-0.5.12 by default; a malformed list is refused", () => {
    expect(osImagesFromEnv(undefined)).toEqual([DSTACK_PROD_OS_0_5_12]);
    expect(osImagesFromEnv(`0x${DSTACK_PROD_OS_0_5_12.toUpperCase()}, ${"ab".repeat(32)}`)).toEqual([DSTACK_PROD_OS_0_5_12, "ab".repeat(32)]);
    expect(() => osImagesFromEnv("1234")).toThrow();
    expect(() => osImagesFromEnv(",")).toThrow();
  });

  it("open: pinned call; expired identity → verified again, then retried; public status", async () => {
    const expired = Object.assign(new Error("expired"), { code: "identity_expired" });
    const conn = fakeConnection({ fail: expired });
    const m = await AttestedModel.open({ baseUrl: "https://tee.redpill.ai/v1", osImages: [DSTACK_PROD_OS_0_5_12], connect: vi.fn(async () => conn) as any, refreshMs: 3_600_000 });
    const r = await m.fetch("https://tee.redpill.ai/v1/chat/completions", { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(conn.refresh).toHaveBeenCalledTimes(1);
    expect(conn.fetch).toHaveBeenCalledTimes(2);
    const st = m.status();
    expect(st.verified).toBe(true);
    expect(st.osImageHash).toBe(DSTACK_PROD_OS_0_5_12);
    expect(st.servingPolicy).toEqual({ requireVerified: true, requireReceipt: true });
    expect(st.receiptsRecorded).toBe(1);
    expect(JSON.stringify(st)).not.toMatch(/Bearer|sk-/);
    await m.close();
  });

  it("an unverified gateway blocks opening (the enclave does not start)", async () => {
    await expect(AttestedModel.open({ baseUrl: "https://tee.redpill.ai/v1", osImages: [DSTACK_PROD_OS_0_5_12], connect: vi.fn(async () => fakeConnection({ verified: false })) as any }))
      .rejects.toThrow(/NON vérifiée/);
    expect((modelAttestationBody(undefined) as any).verified).toBe(false);
  });

  it("identity expired before the call: verified again first", async () => {
    const conn = fakeConnection({ expiresAt: Date.now() - 1 });
    const m = await AttestedModel.open({ baseUrl: "https://tee.redpill.ai/v1", osImages: [DSTACK_PROD_OS_0_5_12], connect: vi.fn(async () => conn) as any, refreshMs: 3_600_000 });
    await m.fetch("https://tee.redpill.ai/v1/chat/completions", { method: "POST", body: "{}" });
    expect(conn.refresh).toHaveBeenCalledTimes(1);
    await m.close();
  });

  it("hardening #2: an RTMR3 event's name and payload are bound to its digest (which Phala's verifier does not recompute)", () => {
    const log = JSON.parse(REPORT.attestation.evidence.event_log);
    const os = log.find((e: any) => e.event === "os-image-hash");
    // dstack's formula reproduces the real digest
    expect(dstackEventDigest(Number(os.event_type), "os-image-hash", os.event_payload)).toBe(String(os.digest).toLowerCase());
    // image payload rewritten while keeping the digest → refused (even if it named an accepted image)
    const f1 = clone(REPORT);
    const l1 = JSON.parse(REPORT.attestation.evidence.event_log);
    l1.find((e: any) => e.event === "os-image-hash").event_payload = "cd".repeat(32);
    f1.attestation.evidence.event_log = JSON.stringify(l1);
    expect(osImageHashOf(f1)).toBeNull();
    // compose payload rewritten while keeping the digest → checkGatewayIdentity refuses
    const f2 = clone(REPORT);
    const l2 = JSON.parse(REPORT.attestation.evidence.event_log);
    l2.find((e: any) => e.event === "compose-hash").event_payload = "ef".repeat(32);
    f2.attestation.evidence.event_log = JSON.stringify(l2);
    expect(() => checkGatewayIdentity(identity({ report: f2 }), [DSTACK_PROD_OS_0_5_12])).toThrow(/compose non liée/);
    // optional compose pinning: an authentic but unpinned compose is refused
    expect(() => checkGatewayIdentity(identity(), [DSTACK_PROD_OS_0_5_12], ["00".repeat(32)])).toThrow(/hors de la liste épinglée/);
  });

  it("defence in depth: the RTMR3 event log must fold into the quote's RTMR3 (the library is not trusted)", () => {
    // the real log folds exactly into the quote's RTMR3
    expect(foldImr3(REPORT)).toBe(quoteRtmr3Of(REPORT));
    // os-image rewritten with a consistent digest: boundEventPayload alone would be fooled…
    const f = clone(REPORT);
    const log = JSON.parse(REPORT.attestation.evidence.event_log);
    const os = log.find((e: any) => e.event === "os-image-hash");
    os.event_payload = "cd".repeat(32);
    os.digest = dstackEventDigest(Number(os.event_type), "os-image-hash", os.event_payload);
    f.attestation.evidence.event_log = JSON.stringify(log);
    expect(osImageHashOf(f)).toBe("cd".repeat(32)); // the (payload, digest) pair is consistent → boundEventPayload accepts
    // …but the fold no longer matches the quote's RTMR3 → checkGatewayIdentity still refuses
    expect(() => checkGatewayIdentity(identity({ report: f }), ["cd".repeat(32)])).toThrow(/ne se replie pas/);
  });

  it("hardening #3: re-verification lands on a rejected gateway → fails closed (nothing is sent)", async () => {
    const conn: any = {
      baseURL: "https://tee.redpill.ai/v1",
      identity: identity(),
      fetch: vi.fn(async () => new Response("{}", { status: 200 })),
      receipts: () => [],
      refresh: vi.fn(async () => {
        const bad = clone(REPORT);
        bad.attestation.evidence.event_log = JSON.stringify(JSON.parse(REPORT.attestation.evidence.event_log).filter((e: any) => e.event !== "os-image-hash"));
        conn.identity = identity({ report: bad }); // no OS image → the checks fail
      }),
      close: vi.fn(async () => {}),
    };
    const m = await AttestedModel.open({ baseUrl: "x", osImages: [DSTACK_PROD_OS_0_5_12], connect: vi.fn(async () => conn) as any, refreshMs: 3_600_000 });
    await m.refresh().catch(() => {}); // re-verification fails and marks the gateway unhealthy
    await expect(m.fetch("https://tee.redpill.ai/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toThrow(/échec fermé/);
    expect(conn.fetch).not.toHaveBeenCalled(); // nothing was sent to the rejected gateway
    expect(m.status().verified).toBe(false);
    await m.close();
  });
});
