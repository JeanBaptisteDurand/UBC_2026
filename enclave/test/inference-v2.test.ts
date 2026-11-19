/**
 * Inference gateway v2: the race on seq, the last receipt, v2 units, the session cap and the model timeout.
 * Messages that the enclave code prints are matched as it prints them.
 */
import { describe, it, expect } from "vitest";
import { type Address, type Hex, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { recoverReceiptSigner, type Receipt } from "../src/kit/eip712";
import { seal, open } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import {
  InferenceGateway,
  GatewayError,
  billingFromEnv,
  unitsForTokens,
  type SessionReader,
  type SessionView,
  type LlamaClient,
  type BlockSource,
  type InferenceOk,
} from "../src/services/inference";
import { createSealedChatApp, envelopeDigest } from "../products/sealed-chat/app";

const CHAIN = 5042002;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const MODEL = ("0x" + "6a".repeat(32)) as Hex;
const DOMAIN = { chainId: CHAIN, verifyingContract: SESSIONPAY };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The enclave of these tests. Every test session is bound to it (Session.enclave): a gateway serves only the sessions
 * of its own key. Each gateway keeps its own session state.
 */
const KIT = new EnclaveKit({ productId: 1n, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });

function session(over: Partial<SessionView> = {}): SessionView {
  return {
    owner: "0x0000000000000000000000000000000000000011",
    productId: 1n,
    operator: "0x0000000000000000000000000000000000000002",
    sessionKey: "0x0000000000000000000000000000000000000003",
    deposit: 10_000_000_000n,
    price: 1n,
    paidUnits: 0n,
    expiresAt: 4_000_000_000n, // year 2096 (an expired session is no longer served)
    closed: false,
    enclave: KIT.keys.signer,
    ...over,
  };
}

class Reader implements SessionReader {
  constructor(public s: SessionView) {}
  async getSession(): Promise<SessionView> {
    return { ...this.s };
  }
}

const blocks: BlockSource = { current: async () => 1000n };

/** Fake model: fixed tokens per request, call counter. */
class FixedLlama implements LlamaClient {
  calls = 0;
  constructor(private tokensIn: number, private tokensOut: number) {}
  async infer(prompt: string) {
    this.calls++;
    return { text: `réponse à ${prompt}`, tokensIn: this.tokensIn, tokensOut: this.tokensOut };
  }
}

function ok(r: Awaited<ReturnType<InferenceGateway["handle"]>>): InferenceOk {
  expect(r.status).toBe(200);
  return r as InferenceOk;
}

describe("race on seq: atomic reservation per session", () => {
  it("N concurrent requests => N distinct seqs, strictly increasing total, every receipt signed", async () => {
    const N = 25;
    let inFlight = 0;
    let maxInFlight = 0;
    // the k-th request takes (N − k) × 2 ms: without a lock, the last ones would finish first
    const llama: LlamaClient = {
      async infer(prompt: string) {
        const k = Number(prompt.slice(1));
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep((N - k) * 2);
        inFlight--;
        return { text: `r${k}`, tokensIn: 10 + k, tokensOut: 5 + (k % 7) };
      },
    };
    const kit = KIT;
    const gw = new InferenceGateway(kit, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session()), llama, blocks);

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => gw.handle(1n, BigInt(i + 1), `p${i + 1}`, {})),
    );
    const receipts = results.map((r) => ok(r).receipt);

    expect(new Set(receipts.map((r) => r.seq.toString())).size).toBe(N); // N distinct seqs
    expect(maxInFlight).toBe(1); // never two model calls at the same time on one session

    let prev = 0n;
    let expected = 0n;
    receipts.sort((a, b) => (a.seq < b.seq ? -1 : 1));
    for (const [i, r] of receipts.entries()) {
      const k = i + 1;
      expect(r.seq).toBe(BigInt(k));
      expect(r.cumulativeUnits > prev).toBe(true); // strictly increasing
      expected += BigInt(10 + k + 5 + (k % 7)); // v1: units = input + output tokens
      expect(r.cumulativeUnits).toBe(expected);
      prev = r.cumulativeUnits;
    }
    for (const res of results) {
      const r = ok(res);
      expect((await recoverReceiptSigner(DOMAIN, r.receipt, r.signature)).toLowerCase()).toBe(kit.keys.signer.toLowerCase());
    }
    expect(gw.lastReceipt(1n)?.receipt.seq).toBe(BigInt(N));
  });

  it("the same seq sent 10 times in parallel => one signed receipt, the others refused (409): no equivocation", async () => {
    const llama: LlamaClient = {
      async infer(prompt: string) {
        await sleep(Math.floor(Math.random() * 10));
        return { text: `réponse différente pour ${prompt}`, tokensIn: 3, tokensOut: 4 };
      },
    };
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session()), llama, blocks);

    const settled = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => gw.handle(1n, 1n, `invite ${i}`, {})));
    const signed = settled.filter((s) => s.status === "fulfilled");
    const refused = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(signed).toHaveLength(1); // a single receipt for (session 1, seq 1)
    expect(refused).toHaveLength(9);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(GatewayError);
      expect((r.reason as GatewayError).httpStatus).toBe(409);
      expect((r.reason as GatewayError).message).toBe("seq attendu 2, reçu 1");
    }
  });

  it("the lock is per session: a blocked session does not stop another one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const llama: LlamaClient = {
      async infer(prompt: string) {
        if (prompt === "lent") await gate;
        return { text: prompt, tokensIn: 1, tokensOut: 1 };
      },
    };
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session()), llama, blocks);

    let slowDone = false;
    const slow = gw.handle(1n, 1n, "lent", {}).then((r) => ((slowDone = true), r));
    const fast = ok(await gw.handle(2n, 1n, "rapide", {}));
    expect(fast.receipt.sessionId).toBe(2n);
    expect(slowDone).toBe(false); // session 1 is still waiting for its model
    release();
    expect(ok(await slow).receipt.sessionId).toBe(1n);
  });

  it("a model failure releases the lock without consuming the seq", async () => {
    let n = 0;
    const llama: LlamaClient = {
      async infer() {
        if (n++ === 0) throw new Error("panne amont");
        return { text: "ok", tokensIn: 2, tokensOut: 2 };
      },
    };
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session()), llama, blocks);
    await expect(gw.handle(1n, 1n, "p", {})).rejects.toThrow("panne amont");
    expect(ok(await gw.handle(1n, 1n, "p", {})).receipt.seq).toBe(1n); // seq 1 replayed safely: nothing had been signed
  });

  it("model timeout => 504, call aborted, lock released, seq not consumed", async () => {
    let aborted = false;
    let first = true;
    const llama: LlamaClient = {
      infer(_p, _params, signal) {
        if (first) {
          first = false;
          signal?.addEventListener("abort", () => (aborted = true));
          return new Promise(() => {}); // never answers
        }
        return Promise.resolve({ text: "ok", tokensIn: 1, tokensOut: 1 });
      },
    };
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, inferTimeoutMs: 20 }, new Reader(session()), llama, blocks,
    );
    const err = await gw.handle(1n, 1n, "p", {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).httpStatus).toBe(504);
    expect(aborted).toBe(true);
    expect(ok(await gw.handle(1n, 1n, "p", {})).receipt.seq).toBe(1n);
  });
});

describe("v2 units: UNIT_TOKENS and OUT_WEIGHT, rounding on the running total", () => {
  it("UNIT_TOKENS=1000, OUT_WEIGHT=4: 40,000 tokens read + 2,000 written => 48 units", async () => {
    const billing = billingFromEnv({ UNIT_TOKENS: "1000", OUT_WEIGHT: "4" });
    expect(billing).toEqual({ unitTokens: 1000n, outWeight: 4n });
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, ...billing }, new Reader(session()), new FixedLlama(40_000, 2_000), blocks,
    );
    const r = ok(await gw.handle(1n, 1n, "requête type", {})).receipt;
    expect(r.cumulativeUnits).toBe(48n);
    expect(r.tokensIn).toBe(40_000n);
    expect(r.tokensOut).toBe(2_000n);
    expect(unitsForTokens(40_000n, 2_000n, billing)).toBe(48n);
  });

  it("defaults = v1 (1 and 1); invalid values refused at start-up", () => {
    expect(billingFromEnv({})).toEqual({ unitTokens: 1n, outWeight: 1n });
    for (const bad of ["0", "-3", "1.5", "abc", ""]) {
      expect(() => billingFromEnv({ UNIT_TOKENS: bad })).toThrow(/UNIT_TOKENS/);
      expect(() => billingFromEnv({ OUT_WEIGHT: bad })).toThrow(/OUT_WEIGHT/);
    }
  });

  it("rounded up on the running total, not per request (4 requests of 1.5 units => 6, not 8)", async () => {
    // 1,100 read + 100 written × 4 = 1,500 token-equivalents = 1.5 units of 1,000
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n },
      new Reader(session()), new FixedLlama(1_100, 100), blocks,
    );
    const cum: bigint[] = [];
    for (let i = 1n; i <= 4n; i++) cum.push(ok(await gw.handle(1n, i, "p", {})).receipt.cumulativeUnits);
    expect(cum).toEqual([2n, 3n, 5n, 6n]); // ceil(1.5) ceil(3) ceil(4.5) ceil(6); per request it would be 2,4,6,8
  });

  it("cumulativeUnits strictly increasing even for tiny requests; caught up later by the running total", async () => {
    const llama = new FixedLlama(10, 5); // 30 token-equivalents = 0.03 units
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n }, new Reader(session()), llama, blocks,
    );
    const cum: bigint[] = [];
    for (let i = 1n; i <= 3n; i++) cum.push(ok(await gw.handle(1n, i, "p", {})).receipt.cumulativeUnits);
    expect(cum).toEqual([1n, 2n, 3n]); // at least +1 unit per receipt
    // a large request next: total = 90 + 3,000 = 3,090 => ceil = 4 (not 3 + 4)
    const big = { infer: async () => ({ text: "x", tokensIn: 3_000, tokensOut: 0 }) };
    (gw as any).llama = big;
    expect(ok(await gw.handle(1n, 4n, "p", {})).receipt.cumulativeUnits).toBe(4n);
  });

  it("resume: the next receipt always exceeds what is already settled on-chain (paidUnits)", async () => {
    const reader = new Reader(session({ paidUnits: 100n }));
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n }, reader, new FixedLlama(40_000, 2_000), blocks,
    );
    expect(ok(await gw.handle(1n, 1n, "p", {})).receipt.cumulativeUnits).toBe(148n); // 100 already settled + 48
    reader.s.paidUnits = 500n; // defence (the session is bound to this enclave): the chain settled more
    expect(ok(await gw.handle(1n, 2n, "p", {})).receipt.cumulativeUnits).toBe(548n); // 500 + 48, still > paidUnits
  });
});

describe("402: the gateway never serves beyond what the contract will pay", () => {
  it("session cap (cap < deposit) respected; a 402 consumes neither seq nor total", async () => {
    const reader = new Reader(session({ deposit: 1_000n, cap: 100n }));
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, reader, new FixedLlama(10, 20), blocks);
    for (let i = 1n; i <= 3n; i++) ok(await gw.handle(1n, i, "p", {})); // 30, 60, 90
    const r = await gw.handle(1n, 4n, "p", {});
    expect(r.status).toBe(402);
    if (r.status === 402) expect(r.balance).toBe(10n); // cap 100 − 90
    expect(gw.lastReceipt(1n)?.receipt.seq).toBe(3n);
    reader.s.cap = 0n; // cap lifted: the deposit (1,000) is the limit again
    expect(ok(await gw.handle(1n, 4n, "p", {})).receipt.cumulativeUnits).toBe(120n); // seq 4 still free
  });

  it("exhausted session => 402 before calling the model (the operator does not pay the upstream for nothing)", async () => {
    const llama = new FixedLlama(10, 20);
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session({ deposit: 90n })), llama, blocks);
    for (let i = 1n; i <= 3n; i++) ok(await gw.handle(1n, i, "p", {}));
    expect(llama.calls).toBe(3);
    const r = await gw.handle(1n, 4n, "p", {});
    expect(r.status).toBe(402);
    expect(llama.calls).toBe(3); // no model call
  });
});

describe("GET /v1/session/:id/receipt (last receipt, HTTP)", () => {
  it("returns { receipt, signature } of the last receipt issued; 404 with no receipt; 400 for an invalid id; 409 for a replayed seq", async () => {
    const kit = KIT;
    const sessionKey = privateKeyToAccount(generatePrivateKey());
    const reader = new Reader(session({ sessionKey: sessionKey.address }));
    const gw = new InferenceGateway(kit, { sessionPay: SESSIONPAY, modelHash: MODEL }, reader, new FixedLlama(10, 20), blocks);
    const app = createSealedChatApp({
      kit, gateway: gw, reader, modelHash: MODEL,
      attest: { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} },
    });

    async function chat(seq: bigint, prompt: string) {
      const client = generateEnclaveKeys(); // the client's ephemeral X25519 key
      const sealed = await seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode(prompt));
      const ciphertext = ("0x" + Buffer.from(sealed.ciphertext).toString("hex")) as Hex;
      const enc = ("0x" + Buffer.from(sealed.enc).toString("hex")) as Hex;
      const digest = envelopeDigest(1n, seq, ciphertext, client.x25519PublicKey);
      const signature = await sessionKey.signMessage({ message: { raw: digest } });
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "1", seq: seq.toString(), enc, ciphertext, clientEphemeralPub: client.x25519PublicKey, signature }),
      });
      return { res, client };
    }

    expect((await app.request("/v1/session/1/receipt")).status).toBe(404); // nothing issued yet

    await chat(1n, "première question");
    const { res, client } = await chat(2n, "deuxième question");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { enc: Hex; ciphertext: Hex; receipt: Record<string, string>; signature: Hex };
    const text = new TextDecoder().decode(await open(client.x25519PrivateKey, toBytes(out.enc), toBytes(out.ciphertext)));
    expect(text).toBe("réponse à deuxième question");

    const last = await app.request("/v1/session/1/receipt");
    expect(last.status).toBe(200);
    const body = (await last.json()) as { receipt: Record<string, string>; signature: Hex };
    expect(body).toEqual({ receipt: out.receipt, signature: out.signature }); // the last one, as it was returned
    expect(body.receipt.seq).toBe("2");
    expect(body.receipt.cumulativeUnits).toBe("60");

    // settleable: the signature is the enclave's over this receipt (SessionPay domain)
    const r = body.receipt;
    const receipt: Receipt = {
      productId: BigInt(r.productId!), sessionId: BigInt(r.sessionId!), seq: BigInt(r.seq!), modelHash: r.modelHash as Hex,
      paramsHash: r.paramsHash as Hex, requestHash: r.requestHash as Hex, responseHash: r.responseHash as Hex,
      tokensIn: BigInt(r.tokensIn!), tokensOut: BigInt(r.tokensOut!), cumulativeUnits: BigInt(r.cumulativeUnits!), anchorBlock: BigInt(r.anchorBlock!),
    };
    expect((await recoverReceiptSigner(DOMAIN, receipt, body.signature)).toLowerCase()).toBe(kit.keys.signer.toLowerCase());

    expect((await app.request("/v1/session/2/receipt")).status).toBe(404);
    expect((await app.request("/v1/session/abc/receipt")).status).toBe(400);

    const replay = await chat(2n, "rejeu du seq 2");
    expect(replay.res.status).toBe(409);
    expect(await replay.res.json()).toEqual({ error: "seq attendu 3, reçu 2", expectedSeq: "3" });
  });
});
