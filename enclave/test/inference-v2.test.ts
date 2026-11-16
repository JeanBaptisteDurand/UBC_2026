/**
 * Passerelle d'inférence v2 : course sur seq (fix 1), dernier reçu (fix 3), unités v2 (fix 4),
 * plafond de session et délai du modèle.
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
 * v2 bis : l'enclave de ces tests. Chaque session de test lui est LIÉE (Session.enclave) : une passerelle ne sert
 * que les sessions de sa propre clé. Chaque passerelle garde son propre état de sessions.
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
    expiresAt: 4_000_000_000n, // an 2096 (v2 bis : une session échue n'est plus servie)
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

/** Modèle factice : jetons fixés par requête, compteur d'appels. */
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

describe("fix 1 — course sur seq : réservation atomique par session", () => {
  it("N requêtes concurrentes => N seq distincts, cumul strictement croissant, reçus tous signés", async () => {
    const N = 25;
    let inFlight = 0;
    let maxInFlight = 0;
    // la k-ième requête met (N − k) × 2 ms : sans verrou, les dernières finiraient les premières
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

    expect(new Set(receipts.map((r) => r.seq.toString())).size).toBe(N); // N seq distincts
    expect(maxInFlight).toBe(1); // jamais deux appels au modèle en même temps sur une session

    let prev = 0n;
    let expected = 0n;
    receipts.sort((a, b) => (a.seq < b.seq ? -1 : 1));
    for (const [i, r] of receipts.entries()) {
      const k = i + 1;
      expect(r.seq).toBe(BigInt(k));
      expect(r.cumulativeUnits > prev).toBe(true); // strictement croissant
      expected += BigInt(10 + k + 5 + (k % 7)); // v1 : unités = jetons d'entrée + de sortie
      expect(r.cumulativeUnits).toBe(expected);
      prev = r.cumulativeUnits;
    }
    for (const res of results) {
      const r = ok(res);
      expect((await recoverReceiptSigner(DOMAIN, r.receipt, r.signature)).toLowerCase()).toBe(kit.keys.signer.toLowerCase());
    }
    expect(gw.lastReceipt(1n)?.receipt.seq).toBe(BigInt(N));
  });

  it("le même seq envoyé 10 fois en parallèle => UN seul reçu signé, les autres refusés (409) : pas d'équivocation", async () => {
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
    expect(signed).toHaveLength(1); // un seul reçu pour (session 1, seq 1)
    expect(refused).toHaveLength(9);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(GatewayError);
      expect((r.reason as GatewayError).httpStatus).toBe(409);
      expect((r.reason as GatewayError).message).toBe("seq attendu 2, reçu 1");
    }
  });

  it("le verrou est PAR session : une session bloquée n'empêche pas une autre d'avancer", async () => {
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
    expect(slowDone).toBe(false); // la session 1 attend toujours son modèle
    release();
    expect(ok(await slow).receipt.sessionId).toBe(1n);
  });

  it("une panne du modèle libère le verrou sans consommer le seq", async () => {
    let n = 0;
    const llama: LlamaClient = {
      async infer() {
        if (n++ === 0) throw new Error("panne amont");
        return { text: "ok", tokensIn: 2, tokensOut: 2 };
      },
    };
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session()), llama, blocks);
    await expect(gw.handle(1n, 1n, "p", {})).rejects.toThrow("panne amont");
    expect(ok(await gw.handle(1n, 1n, "p", {})).receipt.seq).toBe(1n); // seq 1 rejoué sans risque : rien n'avait été signé
  });

  it("délai du modèle dépassé => 504, appel annulé, verrou libéré, seq non consommé", async () => {
    let aborted = false;
    let first = true;
    const llama: LlamaClient = {
      infer(_p, _params, signal) {
        if (first) {
          first = false;
          signal?.addEventListener("abort", () => (aborted = true));
          return new Promise(() => {}); // ne répond jamais
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

describe("fix 4 — unités v2 : UNIT_TOKENS et OUT_WEIGHT, arrondi sur le cumul", () => {
  it("UNIT_TOKENS=1000, OUT_WEIGHT=4 : 40 000 jetons lus + 2 000 écrits => 48 unités", async () => {
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

  it("défauts = v1 (1 et 1) ; valeurs invalides refusées au démarrage", () => {
    expect(billingFromEnv({})).toEqual({ unitTokens: 1n, outWeight: 1n });
    for (const bad of ["0", "-3", "1.5", "abc", ""]) {
      expect(() => billingFromEnv({ UNIT_TOKENS: bad })).toThrow(/UNIT_TOKENS/);
      expect(() => billingFromEnv({ OUT_WEIGHT: bad })).toThrow(/OUT_WEIGHT/);
    }
  });

  it("arrondi au-dessus sur le CUMUL, pas par requête (4 requêtes de 1,5 unité => 6, pas 8)", async () => {
    // 1 100 lus + 100 écrits × 4 = 1 500 jetons-équivalent = 1,5 unité de 1 000
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n },
      new Reader(session()), new FixedLlama(1_100, 100), blocks,
    );
    const cum: bigint[] = [];
    for (let i = 1n; i <= 4n; i++) cum.push(ok(await gw.handle(1n, i, "p", {})).receipt.cumulativeUnits);
    expect(cum).toEqual([2n, 3n, 5n, 6n]); // ceil(1,5) ceil(3) ceil(4,5) ceil(6) ; par requête ce serait 2,4,6,8
  });

  it("cumulativeUnits strictement croissant même pour de toutes petites requêtes ; rattrapé ensuite par le cumul", async () => {
    const llama = new FixedLlama(10, 5); // 30 jetons-équivalent = 0,03 unité
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n }, new Reader(session()), llama, blocks,
    );
    const cum: bigint[] = [];
    for (let i = 1n; i <= 3n; i++) cum.push(ok(await gw.handle(1n, i, "p", {})).receipt.cumulativeUnits);
    expect(cum).toEqual([1n, 2n, 3n]); // au moins +1 unité par reçu
    // une grosse requête ensuite : cumul = 90 + 3 000 = 3 090 => ceil = 4 (pas 3 + 4)
    const big = { infer: async () => ({ text: "x", tokensIn: 3_000, tokensOut: 0 }) };
    (gw as any).llama = big;
    expect(ok(await gw.handle(1n, 4n, "p", {})).receipt.cumulativeUnits).toBe(4n);
  });

  it("reprise : le reçu suivant dépasse toujours ce qui est déjà réglé on-chain (paidUnits)", async () => {
    const reader = new Reader(session({ paidUnits: 100n }));
    const gw = new InferenceGateway(
      KIT, { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n }, reader, new FixedLlama(40_000, 2_000), blocks,
    );
    expect(ok(await gw.handle(1n, 1n, "p", {})).receipt.cumulativeUnits).toBe(148n); // 100 déjà réglés + 48
    reader.s.paidUnits = 500n; // défense (v2 bis : la session est liée à cette enclave) : la chaîne a réglé plus
    expect(ok(await gw.handle(1n, 2n, "p", {})).receipt.cumulativeUnits).toBe(548n); // 500 + 48, toujours > paidUnits
  });
});

describe("402 : la passerelle ne sert jamais au-delà de ce que le contrat paiera", () => {
  it("plafond de session (cap < dépôt) respecté ; un 402 ne consomme ni seq ni cumul", async () => {
    const reader = new Reader(session({ deposit: 1_000n, cap: 100n }));
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, reader, new FixedLlama(10, 20), blocks);
    for (let i = 1n; i <= 3n; i++) ok(await gw.handle(1n, i, "p", {})); // 30, 60, 90
    const r = await gw.handle(1n, 4n, "p", {});
    expect(r.status).toBe(402);
    if (r.status === 402) expect(r.balance).toBe(10n); // plafond 100 − 90
    expect(gw.lastReceipt(1n)?.receipt.seq).toBe(3n);
    reader.s.cap = 0n; // plafond levé : le dépôt (1 000) redevient la limite
    expect(ok(await gw.handle(1n, 4n, "p", {})).receipt.cumulativeUnits).toBe(120n); // seq 4 toujours libre
  });

  it("session épuisée => 402 AVANT d'appeler le modèle (l'opérateur ne paie pas l'amont pour rien)", async () => {
    const llama = new FixedLlama(10, 20);
    const gw = new InferenceGateway(KIT, { sessionPay: SESSIONPAY, modelHash: MODEL }, new Reader(session({ deposit: 90n })), llama, blocks);
    for (let i = 1n; i <= 3n; i++) ok(await gw.handle(1n, i, "p", {}));
    expect(llama.calls).toBe(3);
    const r = await gw.handle(1n, 4n, "p", {});
    expect(r.status).toBe(402);
    expect(llama.calls).toBe(3); // pas d'appel au modèle
  });
});

describe("fix 3 — GET /v1/session/:id/receipt (dernier reçu, HTTP)", () => {
  it("rend { receipt, signature } du dernier reçu émis ; 404 sans reçu ; 400 si identifiant invalide ; 409 si seq rejoué", async () => {
    const kit = KIT;
    const sessionKey = privateKeyToAccount(generatePrivateKey());
    const reader = new Reader(session({ sessionKey: sessionKey.address }));
    const gw = new InferenceGateway(kit, { sessionPay: SESSIONPAY, modelHash: MODEL }, reader, new FixedLlama(10, 20), blocks);
    const app = createSealedChatApp({
      kit, gateway: gw, reader, modelHash: MODEL,
      attest: { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} },
    });

    async function chat(seq: bigint, prompt: string) {
      const client = generateEnclaveKeys(); // clé X25519 éphémère du client
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

    expect((await app.request("/v1/session/1/receipt")).status).toBe(404); // rien d'émis encore

    await chat(1n, "première question");
    const { res, client } = await chat(2n, "deuxième question");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { enc: Hex; ciphertext: Hex; receipt: Record<string, string>; signature: Hex };
    const text = new TextDecoder().decode(await open(client.x25519PrivateKey, toBytes(out.enc), toBytes(out.ciphertext)));
    expect(text).toBe("réponse à deuxième question");

    const last = await app.request("/v1/session/1/receipt");
    expect(last.status).toBe(200);
    const body = (await last.json()) as { receipt: Record<string, string>; signature: Hex };
    expect(body).toEqual({ receipt: out.receipt, signature: out.signature }); // le dernier, tel qu'il a été rendu
    expect(body.receipt.seq).toBe("2");
    expect(body.receipt.cumulativeUnits).toBe("60");

    // réglable : la signature est celle de l'enclave sur ce reçu (domaine SessionPay)
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
