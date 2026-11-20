/**
 * sealed-chat — upstream model errors and internal errors (a reviewer's finding of 9 Nov 2026): server.ts used to throw
 * `redpill ${status}: ${body}` and Hono's default handler logged that error, so a provider that echoes the received key
 * in its 401 error could get it into the CVM's logs.
 * Now: the upstream error's body is never read (model.ts); the app answers a generic message with a code (onError); the
 * log carries only a code and an error name; no receipt is signed and the same seq can be replayed.
 * Messages that the enclave image prints are matched as it prints them.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { type Address, type Hex, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { InferenceGateway, type SessionReader, type SessionView } from "../src/services/inference";
import { createSealedChatApp, envelopeDigest } from "../products/sealed-chat/app";
import { UpstreamModelError, createRedpillLlama } from "../products/sealed-chat/model";

const CHAIN = 5042002;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const MODEL = ("0x" + "6a".repeat(32)) as Hex;
const KEY = "rpk_LIVE_SECRET_0123456789abcdefghij";
const KIT = new EnclaveKit({ productId: 1n, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });

afterEach(() => vi.restoreAllMocks());

/** An upstream that echoes the received key in its error; the body is read only on demand (pulls counted). */
function leakyUpstream(status = 401) {
  const seen = { calls: 0, pulled: 0, cancelled: 0, ok: false };
  const f: typeof fetch = async (_url, init) => {
    seen.calls++;
    const auth = String((init?.headers as Record<string, string>)?.authorization ?? "");
    if (seen.ok) {
      return Response.json({ choices: [{ message: { content: "model answer" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    }
    const body = new ReadableStream<Uint8Array>(
      {
        pull(ctrl) {
          seen.pulled++;
          ctrl.enqueue(new TextEncoder().encode(JSON.stringify({ error: { message: `Invalid API key provided: ${auth.replace(/^Bearer\s+/, "")}` } })));
          ctrl.close();
        },
        cancel() { seen.cancelled++; },
      },
      { highWaterMark: 0 }, // nothing is pulled until someone reads
    );
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return { f, seen };
}

function session(over: Partial<SessionView> = {}): SessionView {
  return {
    owner: "0x0000000000000000000000000000000000000011", productId: 1n, operator: "0x0000000000000000000000000000000000000002",
    sessionKey: "0x0000000000000000000000000000000000000003", deposit: 10_000_000_000n, price: 1n, paidUnits: 0n,
    expiresAt: 4_000_000_000n, closed: false, enclave: KIT.keys.signer, ...over,
  };
}

function harness(o: { log?: (m: string) => void; reader?: SessionReader } = {}) {
  const sessionKey = privateKeyToAccount(generatePrivateKey());
  const reader: SessionReader = o.reader ?? { getSession: async () => session({ sessionKey: sessionKey.address }) };
  const up = leakyUpstream();
  const llama = createRedpillLlama({ baseUrl: "https://api.redpill.example/v1", model: "openai/gpt-oss-120b", apiKey: KEY, fetch: up.f });
  const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, reader, llama, { current: async () => 1000n });
  const app = createSealedChatApp({
    kit: KIT, gateway: gw, reader, modelHash: MODEL, ...(o.log ? { log: o.log } : {}),
    attest: { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} },
  });
  async function chat(seq: bigint, prompt: string) {
    const client = generateEnclaveKeys();
    const sealed = await seal(toBytes(KIT.keys.x25519PublicKey), new TextEncoder().encode(prompt));
    const ciphertext = ("0x" + Buffer.from(sealed.ciphertext).toString("hex")) as Hex;
    const enc = ("0x" + Buffer.from(sealed.enc).toString("hex")) as Hex;
    const signature = await sessionKey.signMessage({ message: { raw: envelopeDigest(1n, seq, ciphertext, client.x25519PublicKey) } });
    return app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "1", seq: seq.toString(), enc, ciphertext, clientEphemeralPub: client.x25519PublicKey, signature }),
    });
  }
  return { app, chat, up, gw };
}

describe("sealed-chat: upstream model errors and internal errors", () => {
  it("model.ts: an upstream error reports only its status; the body (which echoes the key) is never read, it is cancelled", async () => {
    const up = leakyUpstream(401);
    const llama = createRedpillLlama({ baseUrl: "https://api.redpill.example/v1/", model: "m", apiKey: KEY, fetch: up.f });
    const err = await llama.infer("bonjour", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamModelError);
    expect((err as UpstreamModelError).message).toBe("upstream model: HTTP 401");
    expect((err as UpstreamModelError).upstreamStatus).toBe(401);
    expect(JSON.stringify(err) + String(err) + (err as Error).stack).not.toContain("SECRET");
    expect(up.seen.pulled).toBe(0); // never read
    expect(up.seen.cancelled).toBe(1); // cancelled
  });

  it("app: 502 upstream_model, generic message; neither the key nor the upstream body reaches the client or the log; no receipt, the same seq goes through again", async () => {
    const logs: string[] = [];
    const h = harness({ log: (m) => logs.push(m) });
    const res = await h.chat(1n, "private question");
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      error: "the upstream model did not answer correctly: no receipt was signed, replay the same request (same seq)",
      code: "upstream_model",
      upstreamStatus: 401,
    });
    for (const out of [raw, logs.join("\n")]) {
      expect(out).not.toContain("SECRET");
      expect(out).not.toMatch(/Invalid API key/i);
      expect(out).not.toContain("private question");
    }
    expect(logs).toEqual(["[sealed-chat] upstream_model : HTTP 401"]);
    expect(h.up.seen.pulled).toBe(0);
    expect(h.gw.lastReceipt(1n)).toBeUndefined(); // no receipt signed
    // the upstream is back: the same request (same seq) is served and billed normally
    h.up.seen.ok = true;
    const again = await h.chat(1n, "private question");
    expect(again.status).toBe(200);
    expect(h.gw.lastReceipt(1n)?.receipt.seq).toBe(1n);
  });

  it("with no logger given: console.error receives only the code (Hono's default handler, which printed the error, is no longer used)", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { printed.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(" ")); });
    const h = harness();
    expect((await h.chat(1n, "x")).status).toBe(502);
    expect(printed).toEqual(["[sealed-chat] upstream_model : HTTP 401"]);
  });

  it("internal error (on-chain read down, a message with a keyed RPC URL): 500 internal_error, log without the message", async () => {
    const logs: string[] = [];
    const reader: SessionReader = { getSession: async () => { throw new Error("HTTP request failed. URL: https://rpc.example/v2/RPC-KEY-SECRET-42"); } };
    const h = harness({ log: (m) => logs.push(m), reader });
    for (const res of [await h.app.request("/v1/session/1"), await h.chat(1n, "x")]) {
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal enclave error", code: "internal_error" });
    }
    expect(logs).toEqual(["[sealed-chat] internal_error : Error", "[sealed-chat] internal_error : Error"]);
    expect(h.up.seen.calls).toBe(0); // the model was never called
  });
});
