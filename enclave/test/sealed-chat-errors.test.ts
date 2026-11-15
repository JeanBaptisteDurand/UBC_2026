/**
 * sealed-chat — erreurs du modèle amont et erreurs internes (point du vérificateur du 9/11) : avant, server.ts levait
 * `redpill ${status}: ${corps}` et le gestionnaire par défaut de Hono journalisait cette erreur ; un fournisseur qui
 * recopie la clé reçue dans son erreur 401 la faisait ainsi passer dans les journaux de la CVM.
 * Ici : le corps de l'erreur amont n'est jamais lu (model.ts) ; l'application répond un message générique avec un code
 * (onError) ; le journal ne porte qu'un code et un nom d'erreur ; aucun reçu n'est signé et le même seq reste rejouable.
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

/** Un amont qui recopie la clé reçue dans son erreur ; le corps ne se lit qu'à la demande (pull compté). */
function leakyUpstream(status = 401) {
  const seen = { calls: 0, pulled: 0, cancelled: 0, ok: false };
  const f: typeof fetch = async (_url, init) => {
    seen.calls++;
    const auth = String((init?.headers as Record<string, string>)?.authorization ?? "");
    if (seen.ok) {
      return Response.json({ choices: [{ message: { content: "réponse du modèle" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
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
      { highWaterMark: 0 }, // rien n'est tiré tant que personne ne lit
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

describe("sealed-chat : erreurs du modèle amont et erreurs internes (9/11)", () => {
  it("model.ts : une erreur amont ne remonte que son statut ; le corps (qui recopie la clé) n'est jamais lu, il est abandonné", async () => {
    const up = leakyUpstream(401);
    const llama = createRedpillLlama({ baseUrl: "https://api.redpill.example/v1/", model: "m", apiKey: KEY, fetch: up.f });
    const err = await llama.infer("bonjour", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamModelError);
    expect((err as UpstreamModelError).message).toBe("modèle amont : HTTP 401");
    expect((err as UpstreamModelError).upstreamStatus).toBe(401);
    expect(JSON.stringify(err) + String(err) + (err as Error).stack).not.toContain("SECRET");
    expect(up.seen.pulled).toBe(0); // jamais lu
    expect(up.seen.cancelled).toBe(1); // abandonné
  });

  it("app : 502 upstream_model, message générique ; ni la clé ni le corps amont au client ou au journal ; aucun reçu, le même seq repasse", async () => {
    const logs: string[] = [];
    const h = harness({ log: (m) => logs.push(m) });
    const res = await h.chat(1n, "question privée");
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      error: "le modèle amont n'a pas répondu correctement : aucun reçu n'a été signé, rejouez la même requête (même seq)",
      code: "upstream_model",
      upstreamStatus: 401,
    });
    for (const out of [raw, logs.join("\n")]) {
      expect(out).not.toContain("SECRET");
      expect(out).not.toMatch(/Invalid API key/i);
      expect(out).not.toContain("question privée");
    }
    expect(logs).toEqual(["[sealed-chat] upstream_model : HTTP 401"]);
    expect(h.up.seen.pulled).toBe(0);
    expect(h.gw.lastReceipt(1n)).toBeUndefined(); // aucun reçu signé
    // l'amont revient : la MÊME requête (même seq) est servie et facturée normalement
    h.up.seen.ok = true;
    const again = await h.chat(1n, "question privée");
    expect(again.status).toBe(200);
    expect(h.gw.lastReceipt(1n)?.receipt.seq).toBe(1n);
  });

  it("sans journal fourni : console.error ne reçoit que le code (plus le gestionnaire par défaut de Hono, qui imprimait l'erreur)", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { printed.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(" ")); });
    const h = harness();
    expect((await h.chat(1n, "x")).status).toBe(502);
    expect(printed).toEqual(["[sealed-chat] upstream_model : HTTP 401"]);
  });

  it("erreur interne (lecture on-chain en panne, message avec une URL de RPC à clé) : 500 internal_error, journal sans le message", async () => {
    const logs: string[] = [];
    const reader: SessionReader = { getSession: async () => { throw new Error("HTTP request failed. URL: https://rpc.example/v2/RPC-KEY-SECRET-42"); } };
    const h = harness({ log: (m) => logs.push(m), reader });
    for (const res of [await h.app.request("/v1/session/1"), await h.chat(1n, "x")]) {
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "erreur interne de l'enclave", code: "internal_error" });
    }
    expect(logs).toEqual(["[sealed-chat] internal_error : Error", "[sealed-chat] internal_error : Error"]);
    expect(h.up.seen.calls).toBe(0); // le modèle n'a jamais été appelé
  });
});
