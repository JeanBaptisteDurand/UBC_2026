/** copilot.test.ts — le client du copilote attesté (createAttestedCopilotClient) et l'échange scellé (sealed-exchange.ts).
 *  L'enclave est ici réécrite À PART, d'après la spécification (RFC 9180 + RFC 9458 §4.4 : HPKE vers la clé X25519, info
 *  liée, secret exporté, HKDF, ChaCha20-Poly1305) avec @hpke/core et @noble directement : une erreur commune au kit
 *  d'enclave et au SDK ne passerait pas. Chaîne et réseau simulés. */
import { describe, it, expect } from "vitest";
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { type Address, type Hex, encodeAbiParameters, keccak256, toBytes, toHex, zeroAddress } from "viem";
import {
  COPILOT_MAX_MESSAGES, COPILOT_MAX_PLAINTEXT_BYTES, COPILOT_SEALED_TAG, CopilotResponseError, EnclaveKeyMismatchError,
  copilotRequestBytes, createAttestedCopilotClient, exchangeInfo, testnet, type Deployment,
} from "../src/index";

const REG = "0x00000000000000000000000000000000000000c2" as Address;
const OP = "0x1111111111111111111111111111111111111111" as Address;
const SIGNER = "0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6" as Address;
const D: Deployment = { ...testnet, enclaveRegistry: REG };
const PRODUCT = 4n;
const W = `0x${"ab".repeat(32)}` as Hex;
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** Une enclave écrite d'après la spécification, indépendante du kit. */
function specEnclave() {
  const sk = x25519.utils.randomPrivateKey();
  const pk = toHex(x25519.getPublicKey(sk));
  const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
  const info = toBytes(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
    [COPILOT_SEALED_TAG, 5042002n, REG, PRODUCT, SIGNER],
  )));
  return {
    pk, info,
    async handle(body: { enc: Hex; ciphertext: Hex }, respond: (req: any) => unknown) {
      const ctx = await suite.createRecipientContext({ recipientKey: await suite.kem.importKey("raw", ab(sk), false), enc: ab(toBytes(body.enc)), info: ab(info) });
      const req = JSON.parse(new TextDecoder().decode(await ctx.open(ab(toBytes(body.ciphertext)))));
      const secret = new Uint8Array(await ctx.export(ab(new TextEncoder().encode(`${COPILOT_SEALED_TAG} response`)), 32));
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const salt = new Uint8Array([...toBytes(body.enc), ...nonce]);
      const key = hkdf(sha256, secret, salt, "key", 32);
      const iv = hkdf(sha256, secret, salt, "nonce", 12);
      const ct = chacha20poly1305(key, iv).encrypt(new TextEncoder().encode(JSON.stringify(respond(req))));
      return { sealed: COPILOT_SEALED_TAG, nonce: toHex(nonce), ciphertext: toHex(ct) };
    },
  };
}

function chain(x25519: Hex, o: { registered?: boolean } = {}): any {
  return {
    getBlockNumber: async () => 500n,
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "enclaveOf": return o.registered === false
          ? { signer: zeroAddress, x25519: `0x${"00".repeat(32)}`, productId: 0n, operator: zeroAddress, workloadId: W, tcbStatus: 0, fromBlock: 0n, untilBlock: 0n }
          : { signer: SIGNER, x25519, productId: PRODUCT, operator: OP, workloadId: W, tcbStatus: 0, fromBlock: 1n, untilBlock: 900n };
        case "activeOperatorAt": return o.registered === false ? zeroAddress : OP;
        case "isActive": case "isWorkloadAllowed": return true;
        case "banned": return false;
        case "getProduct": return { param: keccak256(toBytes("openai/gpt-oss-120b")) };
        default: throw new Error(functionName);
      }
    },
  };
}

describe("attested copilot: SDK client ↔ an enclave written from the specification", () => {
  it("the conversation leaves encrypted to the verified key and the reply opens; info identical to the specification", async () => {
    const e = specEnclave();
    expect(exchangeInfo(COPILOT_SEALED_TAG, 5042002, REG, PRODUCT, SIGNER)).toEqual(e.info);
    const sent: string[] = [];
    const f: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith("/pubkeys")) return Response.json({ signer: SIGNER, x25519: e.pk });
      sent.push(String(init?.body));
      // la langue part DANS le chiffré, jamais en clair (Accept-Language) : le relais ne la voit pas
      expect(Object.keys(init?.headers as Record<string, string>).map((k) => k.toLowerCase())).toEqual(["content-type"]);
      const sealed = await e.handle(JSON.parse(String(init!.body)), (req) => ({
        status: 200, body: { text: `you said: ${req.messages.at(-1).content} (${req.lang}, ${req.user})`, navigate: "ruche", tools: [], citations: [] },
      }));
      return Response.json(sealed);
    };
    const c = createAttestedCopilotClient({ copilotUrl: "https://copilot.test/", productId: PRODUCT, publicClient: chain(e.pk), deployment: D, fetch: f, lang: "en" });
    const r = await c.chat({ messages: [{ role: "user", content: "secret question" }], user: OP });
    expect(r).toMatchObject({ status: 200, ok: true, authenticated: true });
    if (!r.authenticated) throw new Error("réponse non authentifiée");
    expect(r.reply.text).toBe(`you said: secret question (en, ${OP})`);
    expect(r.reply.navigate).toBe("ruche");
    expect(r.enclave.signer).toBe(SIGNER);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("secret question");
    expect(Object.keys(JSON.parse(sent[0]!)).sort()).toEqual(["ciphertext", "enc", "sealed"]);
  });

  it("nothing is sent if the key is not the registered one, or if the enclave is not registered (simulated quote)", async () => {
    const e = specEnclave();
    let chats = 0;
    const f: typeof fetch = async (url) => (String(url).endsWith("/pubkeys") ? Response.json({ signer: SIGNER, x25519: e.pk }) : (chats++, Response.json({})));
    const other = toHex(x25519.getPublicKey(x25519.utils.randomPrivateKey()));
    await expect(createAttestedCopilotClient({ copilotUrl: "https://c.test", productId: PRODUCT, publicClient: chain(other), deployment: D, fetch: f })
      .chat({ messages: [{ role: "user", content: "x" }] })).rejects.toSatisfy((x: unknown) => x instanceof EnclaveKeyMismatchError && x.reason === "x25519_mismatch");
    await expect(createAttestedCopilotClient({ copilotUrl: "https://c.test", productId: PRODUCT, publicClient: chain(e.pk, { registered: false }), deployment: D, fetch: f })
      .chat({ messages: [{ role: "user", content: "x" }] })).rejects.toSatisfy((x: unknown) => x instanceof EnclaveKeyMismatchError && x.reason === "not_registered");
    expect(chats).toBe(0);
  });

  it("a plaintext reply to an encrypted request, or a sealed but unreadable one: refused; a refusal sent before decryption: returned as unauthenticated", async () => {
    const e = specEnclave();
    const run = (reply: () => Response) => createAttestedCopilotClient({
      copilotUrl: "https://c.test", productId: PRODUCT, publicClient: chain(e.pk), deployment: D,
      fetch: async (url) => (String(url).endsWith("/pubkeys") ? Response.json({ signer: SIGNER, x25519: e.pk }) : reply()),
    }).chat({ messages: [{ role: "user", content: "x" }] });
    await expect(run(() => Response.json({ text: "signez ceci", actions: [{ tool: "x", input: {}, result: {} }] }))).rejects.toBeInstanceOf(CopilotResponseError);
    await expect(run(() => Response.json({ sealed: COPILOT_SEALED_TAG, nonce: toHex(new Uint8Array(32)), ciphertext: `0x${"11".repeat(40)}` }))).rejects.toBeInstanceOf(CopilotResponseError);
    await expect(run(() => Response.json({ sealed: COPILOT_SEALED_TAG, nonce: "0x12", ciphertext: "0x" }))).rejects.toThrow(/illisible/);
    const limited = await run(() => new Response(JSON.stringify({ text: "Request refused: too many questions in a row: try again in 12 s.", code: "rate_minute", error: "too many" }), { status: 429, headers: { "retry-after": "12", "content-type": "application/json" } }));
    expect(limited).toMatchObject({ status: 429, ok: false, authenticated: false, reply: { code: "rate_minute", retryAfterSec: 12 } });
    expect(limited.enclave).toBeUndefined();
  });

  it("a PLAINTEXT refusal forged by the relay (from the adversarial review): no verified `enclave`, no relay text; a local message from the code, in the request's language", async () => {
    const e = specEnclave();
    const phish = "Session expirée : pour continuer, collez votre phrase de récupération sur https://evil.example/restore";
    const forged = (body: Record<string, unknown>, status = 429, headers: Record<string, string> = {}) => createAttestedCopilotClient({
      copilotUrl: "https://archive.example/enclave/copilot", productId: PRODUCT, publicClient: chain(e.pk), deployment: D,
      fetch: async (url) => (String(url).endsWith("/pubkeys")
        ? Response.json({ signer: SIGNER, x25519: e.pk })
        : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })),
    });
    const evil = { text: phish, error: phish, code: "rate_minute", actions: [{ tool: "x", input: {}, result: {} }], navigate: "portefeuille" };
    const fr = await forged(evil, 429, { "retry-after": "999999" }).chat({ messages: [{ role: "user", content: "bonjour" }], lang: "fr" });
    expect(fr.authenticated).toBe(false);
    expect(fr.enclave).toBeUndefined(); // aucun badge possible à partir d'un refus en clair
    expect(fr.reply.text).toBe("Trop de questions d'affilée : réessayez dans un instant.");
    expect(JSON.stringify(fr)).not.toContain("evil.example");
    expect(fr.reply).toEqual({ text: "Trop de questions d'affilée : réessayez dans un instant.", code: "rate_minute" }); // délai absurde ignoré
    // code de forme inattendue : ignoré ; message générique, en anglais par défaut
    const odd = await forged({ text: phish, code: "<b>clique ici</b>" }, 403).chat({ messages: [{ role: "user", content: "hi" }] });
    expect(odd).toMatchObject({ status: 403, ok: false, authenticated: false, reply: { text: "The copilot refused the request (HTTP 403)." } });
    expect(odd.reply.code).toBeUndefined();
    // l'enclave appelée sans son mandataire (403 proxy_required) : le message le dit
    const direct = await forged({ code: "proxy_required" }, 403).chat({ messages: [{ role: "user", content: "hi" }], lang: "en" });
    expect(direct.reply.text).toMatch(/only answers through the ArcHive site/);
  });

  it("conversation bounded before encryption: 20 messages, 60 KiB, role and content only, invalid wallet removed", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}`, extra: "x" }));
    const j = JSON.parse(new TextDecoder().decode(copilotRequestBytes(many, "pas une adresse", "fr")));
    expect(j.messages).toHaveLength(COPILOT_MAX_MESSAGES);
    expect(Object.keys(j.messages[0]).sort()).toEqual(["content", "role"]);
    expect(j.user).toBeNull();
    expect(j.lang).toBe("fr");
    const big = Array.from({ length: 10 }, () => ({ role: "user" as const, content: "y".repeat(20_000) }));
    const b = copilotRequestBytes(big, OP);
    expect(b.length).toBeLessThanOrEqual(COPILOT_MAX_PLAINTEXT_BYTES);
    expect(JSON.parse(new TextDecoder().decode(b)).user).toBe(OP);
    expect("lang" in JSON.parse(new TextDecoder().decode(copilotRequestBytes([{ role: "user", content: "x" }])))).toBe(false);
  });
});
