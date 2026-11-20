/** enclave.test.ts — le copilote DANS une enclave (enclave-app.ts) avec le VRAI kit d'enclave (clés en mémoire, quote
 *  SIMULÉ faute de TDX ici), le VRAI client du SDK (createAttestedCopilotClient) et un mandataire qui enregistre ou modifie
 *  ce qui passe (le serveur web du site). La chaîne est simulée (lectures de l'EnclaveRegistry, du ProductRegistry et de
 *  l'OperatorBond). Aucun appel réseau, aucun modèle réel.
 *  Couvre : aller-retour chiffré (HPKE) sans que le mandataire lise rien ; réponse modifiée, remplacée en clair ou rejouée
 *  → refusée ; clé X25519 substituée, enclave non inscrite (quote simulé), image retirée, opérateur radié, produit inactif
 *  → rien n'est envoyé ; redémarrage de l'enclave → revérification on-chain et un seul renvoi ; enveloppes invalides ;
 *  refus scellés ; /attest (quote lié au produit et à l'opérateur, OPERATOR_ALLOWLIST) ; CORS ; configuration de l'enclave.
 *  Lancer : cd services/copilot && npx tsx --test test/enclave.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type Address, type Hex, keccak256, numberToHex, pad, toBytes, toHex, zeroAddress } from "viem";
import {
  COPILOT_SEALED_TAG, CopilotResponseError, EnclaveKeyMismatchError, createAttestedCopilotClient, exchangeInfo, sealExchange, testnet,
  type Deployment,
} from "@arcvault/sdk";
import { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import { buildReportData } from "../../../enclave/src/kit/binding";
import { createCopilotApp, type Llm, type LlmRequest } from "../src/app";
import { createCopilotEnclaveApp, enclaveSystemNote, KIT_ROUTES } from "../src/enclave-app";
import { readCopilotEnclaveConfig } from "../src/enclave-config";
import { languageDirective } from "../src/i18n";

const SITE = "https://archive.62-171-153-35.sslip.io";
const URL_ = "https://copilot.enclave.test";
const REG = "0x00000000000000000000000000000000000000c2" as Address;
const PREG = "0x00000000000000000000000000000000000000c3" as Address;
const BOND = "0x00000000000000000000000000000000000000c4" as Address;
const OP = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x5724d89D610c3017b8DC161c025248341556f6Ab";
const PRODUCT = 4n;
const WORKLOAD = `0x${"ab".repeat(32)}` as Hex;
const D: Deployment = { ...testnet, enclaveRegistry: REG, productRegistry: PREG, operatorBond: BOND };
/** Le jeton du mandataire du site (COPILOT_PROXY_TOKEN, variable chiffrée de la VM ; nginx le pose sur chaque requête). */
const PROXY_TOKEN = `test-proxy-token-${"k".repeat(40)}`;
const PROXIED = { "x-archive-proxy-token": PROXY_TOKEN };
const SECRET_Q = "Ma question confidentielle : combien coûte la ruche ?";
const SECRET_A = "Réponse confidentielle : la ruche compte 2 enclaves actives.";

function scriptedLlm(text = SECRET_A) {
  const calls: LlmRequest[] = [];
  const llm: Llm = async (req) => { calls.push({ ...req, messages: structuredClone(req.messages) }); return { content: text }; };
  return { llm, calls };
}

interface Seen { path: string; method: string; body: string; status: number; resBody: string }
type Tamper = (s: Seen, res: Response) => Response | Promise<Response>;

/** L'enclave (remplaçable : redémarrage), la chaîne simulée et le mandataire qui relaie tout. */
function harness(o: { llmText?: string; chain?: Partial<ChainState>; allowlist?: Address[] | null } = {}) {
  const m = scriptedLlm(o.llmText);
  const make = () => {
    const kit = new EnclaveKit({ productId: PRODUCT, chainId: 5042002, registry: REG, mockBlockHash: true });
    const app = createCopilotEnclaveApp({
      kit,
      copilot: {
        llm: m.llm, system: "SYSTÈME", tools: [], executeTool: async () => ({ result: {} }), allowedOrigins: [SITE],
        rate: { perMinute: 1_000, perDay: 10_000, globalPerDay: 0 }, secrets: ["sk-test-SERVER-KEY-0123456789"],
        systemNote: enclaveSystemNote({ signer: kit.keys.signer, productId: PRODUCT, chainId: 5042002, registry: REG, model: "openai/gpt-oss-120b", provider: "https://api.redpill.ai/v1", mock: true }),
      },
      proxyToken: PROXY_TOKEN,
      attest: { operatorAllowlist: o.allowlist === undefined ? [OP] : o.allowlist, registeredOperator: async () => zeroAddress, warn: () => {} },
    });
    return { kit, app };
  };
  const h = {
    ...make(),
    llm: m,
    chain: { registered: true, active: true, productActive: true, allowed: true, banned: false, x25519Override: undefined as Hex | undefined, ...(o.chain ?? {}) } as ChainState,
    seen: [] as Seen[],
    tamper: undefined as Tamper | undefined,
    restart() { const n = make(); h.kit = n.kit; h.app = n.app; },
  };
  // le mandataire du site (nginx) : relaie tout, et pose son jeton sur chaque requête (proxy_set_header)
  const proxy: typeof fetch = async (input, init) => {
    const req = new Request(input as string, init);
    req.headers.set("x-archive-proxy-token", PROXY_TOKEN);
    const body = typeof init?.body === "string" ? init.body : "";
    const res = await h.app.fetch(req);
    const resBody = await res.text();
    const s: Seen = { path: new URL(req.url).pathname, method: req.method, body, status: res.status, resBody };
    h.seen.push(s);
    const out = new Response(resBody, { status: res.status, headers: res.headers });
    return h.tamper ? h.tamper(s, out) : out;
  };
  const publicClient = fakeChain(h);
  const client = (over: Record<string, unknown> = {}) =>
    createAttestedCopilotClient({ copilotUrl: URL_, productId: PRODUCT, publicClient, deployment: D, fetch: proxy, ...over });
  return Object.assign(h, { proxy, publicClient, client });
}

interface ChainState { registered: boolean; active: boolean; productActive: boolean; allowed: boolean; banned: boolean; x25519Override?: Hex }

/** La chaîne vue par le client : l'enclave ACTUELLE (h.kit) est inscrite pour le produit 4 chez OP, selon `h.chain`. */
function fakeChain(h: { kit: EnclaveKit; chain: ChainState }): any {
  return {
    getBlockNumber: async () => 1_000n,
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args: any[] }) => {
      const st = h.chain;
      switch (functionName) {
        case "enclaveOf": {
          assert.equal(address, REG);
          const mine = String(args[0]).toLowerCase() === h.kit.keys.signer.toLowerCase();
          return st.registered && mine
            ? { signer: h.kit.keys.signer, x25519: st.x25519Override ?? h.kit.keys.x25519PublicKey, productId: PRODUCT, operator: OP, workloadId: WORKLOAD, tcbStatus: 0, fromBlock: 900n, untilBlock: 2_000n }
            : { signer: zeroAddress, x25519: `0x${"00".repeat(32)}`, productId: 0n, operator: zeroAddress, workloadId: `0x${"00".repeat(32)}`, tcbStatus: 0, fromBlock: 0n, untilBlock: 0n };
        }
        case "activeOperatorAt": return st.registered && st.active ? OP : zeroAddress;
        case "isActive": assert.equal(address, PREG); return st.productActive;
        case "isWorkloadAllowed": assert.equal(args[1], WORKLOAD); return st.allowed;
        case "banned": assert.equal(address, BOND); return st.banned;
        case "getProduct": return { param: keccak256(toBytes("openai/gpt-oss-120b")) };
        default: throw new Error(`lecture inattendue : ${functionName}`);
      }
    },
  };
}

const chats = (h: { seen: Seen[] }) => h.seen.filter((s) => s.path === "/chat");
const ask = (content = SECRET_Q) => ({ messages: [{ role: "user" as const, content }], user: OWNER });

test("encrypted round trip: the model reads the question, the client reads the reply, the proxy reads nothing", async () => {
  const h = harness();
  const r = await h.client().chat({ ...ask(), lang: "fr" });
  assert.equal(r.authenticated, true);
  assert.equal(r.status, 200);
  assert.equal(r.reply.text, SECRET_A);
  assert.equal(r.enclave.signer, h.kit.keys.signer);
  assert.equal(r.enclave.operator, OP);
  assert.equal(r.enclave.productParam, keccak256(toBytes("openai/gpt-oss-120b")));
  // l'enclave a déchiffré : la question, le wallet et la langue sont arrivés au modèle
  const sent = h.llm.calls[0]!.messages;
  assert.equal(sent.at(-1)!.content, SECRET_Q);
  const sys = String(sent[0]!.content);
  assert.ok(sys.includes(OWNER), "wallet connecté transmis");
  assert.match(sys, /arrivée CHIFFRÉE \(HPKE\)/);
  assert.ok(sys.endsWith(languageDirective("fr")));
  // le mandataire n'a vu que du chiffré, dans les deux sens
  const [c] = chats(h);
  assert.ok(c);
  for (const leak of [SECRET_Q, "confidentielle", OWNER, OWNER.toLowerCase(), "\"lang\"", SECRET_A]) {
    assert.ok(!c.body.includes(leak) && !c.resBody.includes(leak), `fuite : ${leak}`);
  }
  const wire = JSON.parse(c.body);
  assert.deepEqual(Object.keys(wire).sort(), ["ciphertext", "enc", "sealed"]);
  assert.equal(wire.sealed, COPILOT_SEALED_TAG);
  assert.equal(c.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(c.resBody)).sort(), ["ciphertext", "nonce", "sealed"]);
});

test("reply changed, replaced in clear (a fake action to sign) or replayed: refused, nothing is returned", async () => {
  const h = harness();
  const client = h.client();
  const first = await client.chat(ask());
  assert.equal(first.authenticated, true);
  const recorded = chats(h)[0]!.resBody;
  // un octet du chiffré modifié
  h.tamper = (s, res) => {
    if (s.path !== "/chat") return res;
    const j = JSON.parse(s.resBody);
    const ct: string = j.ciphertext;
    j.ciphertext = ct.slice(0, 10) + (ct[10] === "0" ? "1" : "0") + ct.slice(11);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(client.chat(ask()), CopilotResponseError);
  // une réponse EN CLAIR avec une action piégée
  h.tamper = (s, res) => (s.path !== "/chat" ? res : Response.json({
    text: "Signez ceci pour continuer.", actions: [{ tool: "session_prepare_open", input: {}, result: { to: "0x000000000000000000000000000000000000dEaD" } }],
  }));
  await assert.rejects(client.chat(ask()), (e: Error) => e instanceof CopilotResponseError && /en clair|plaintext answer/.test(e.message));
  // la réponse authentique d'une AUTRE requête, rejouée
  h.tamper = (s, res) => (s.path !== "/chat" ? res : new Response(recorded, { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(client.chat(ask()), CopilotResponseError);
});

test("X25519 key swapped by the proxy: refused BEFORE anything is sent", async () => {
  const h = harness();
  h.tamper = (s, res) => (s.path !== "/pubkeys" ? res : Response.json({ ...JSON.parse(s.resBody), x25519: `0x${"42".repeat(32)}` }));
  await assert.rejects(h.client().chat(ask()), (e: unknown) => e instanceof EnclaveKeyMismatchError && e.reason === "x25519_mismatch");
  assert.equal(chats(h).length, 0, "rien n'est parti vers /chat");
});

test("simulated quote (outside TDX): /attest says so, the enclave is not registered, the client refuses without sending anything", async () => {
  const h = harness({ chain: { registered: false } });
  const res = await h.app.fetch(new Request(`${URL_}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator: OP.toLowerCase(), anchorR: "999" }) }));
  assert.equal(res.status, 200);
  const a = await res.json() as { quote: Hex; mock: boolean; signer: Address; x25519: Hex };
  assert.equal(a.mock, true);
  assert.equal(a.signer, h.kit.keys.signer);
  // le REPORTDATA lie la chaîne, le registre, le produit du COPILOTE, l'opérateur et les deux clés
  const rd = buildReportData(
    { chainId: 5042002n, registry: REG, productId: PRODUCT, operator: OP, signer: h.kit.keys.signer, x25519: h.kit.keys.x25519PublicKey },
    keccak256(pad(numberToHex(999n), { size: 32 })),
  );
  assert.equal(`0x${a.quote.slice(2 + 24, 2 + 24 + 128)}`, rd);
  await assert.rejects(h.client().chat(ask()), (e: unknown) => e instanceof EnclaveKeyMismatchError && e.reason === "not_registered");
  assert.equal(chats(h).length, 0);
});

test("/attest: operator outside OPERATOR_ALLOWLIST → 403; no list → nobody; /pubkeys public", async () => {
  const h = harness();
  const attest = (app: typeof h.app, operator: string) => app.fetch(new Request(`${URL_}/attest`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, anchorR: "1" }),
  }));
  assert.equal((await attest(h.app, "0x2222222222222222222222222222222222222222")).status, 403);
  const closed = harness({ allowlist: [] });
  assert.equal((await attest(closed.app, OP)).status, 403);
  const pk = await (await h.app.fetch(new Request(`${URL_}/pubkeys`, { headers: { origin: "https://dev.example" } })));
  assert.equal(pk.headers.get("access-control-allow-origin"), "*", "clés publiques : CORS ouvert");
  const j = await pk.json() as { signer: string; x25519: string };
  assert.equal(j.signer, h.kit.keys.signer);
  assert.equal(j.x25519, h.kit.keys.x25519PublicKey);
  // /chat et /health gardent le CORS du site
  const health = await h.app.fetch(new Request(`${URL_}/health`, { headers: { origin: "https://dev.example" } }));
  assert.equal(health.headers.get("access-control-allow-origin"), null);
  assert.equal((await health.json() as any).sealed, COPILOT_SEALED_TAG);
  assert.deepEqual([...KIT_ROUTES].sort(), ["/attest", "/pubkeys"]);
});

test("what counts is NOW: image withdrawn, operator banned, product inactive or enclave expired → refused before anything is sent", async () => {
  for (const chain of [{ allowed: false }, { banned: true }, { productActive: false }, { active: false }] as Array<Partial<ChainState>>) {
    const h = harness({ chain });
    await assert.rejects(h.client().chat(ask()), (e: unknown) => e instanceof EnclaveKeyMismatchError && e.reason === "inactive", JSON.stringify(chain));
    assert.equal(chats(h).length, 0, JSON.stringify(chain));
  }
  // opérateur attendu : un autre opérateur est refusé
  const h = harness();
  await assert.rejects(h.client({ expectedOperator: "0x3333333333333333333333333333333333333333" }).chat(ask()),
    (e: unknown) => e instanceof EnclaveKeyMismatchError && e.reason === "wrong_operator");
});

test("enclave restart (new keys, registered again): \"undecryptable\", on-chain re-check, ONE resend", async () => {
  const h = harness();
  const client = h.client();
  const before = await client.chat(ask());
  assert.equal(before.authenticated, true);
  const oldSigner = before.enclave.signer;
  h.restart();
  const after = await client.chat(ask());
  assert.equal(after.authenticated, true);
  assert.notEqual(after.enclave.signer, oldSigner);
  assert.equal(after.enclave.signer, h.kit.keys.signer);
  const c = chats(h);
  assert.equal(c.length, 3, "1 avant, puis 1 refus et 1 renvoi");
  assert.equal(JSON.parse(c[1]!.resBody).code, "sealed_undecryptable");
  // nouvelle clé PAS ENCORE réinscrite (registrar en retard) : une revérification, puis refus ; aucun renvoi en boucle
  const h2 = harness();
  const c2 = h2.client();
  await c2.chat(ask());
  const old = h2.kit;
  h2.restart(); // l'enclave (et son /pubkeys) a de nouvelles clés…
  h2.kit = old; // …mais la chaîne n'a encore que l'ancienne
  await assert.rejects(c2.chat(ask()), (e: unknown) => e instanceof EnclaveKeyMismatchError && e.reason === "not_registered");
  assert.equal(chats(h2).length, 2, "1 avant, 1 refusée après le redémarrage, aucun renvoi");
});

test("invalid envelopes and ciphertext for another product: refused in clear, without opening anything", async () => {
  const h = harness();
  const post = (body: unknown) => h.app.fetch(new Request(`${URL_}/chat`, { method: "POST", headers: { "content-type": "application/json", "accept-language": "en", ...PROXIED }, body: JSON.stringify(body) }));
  const enc = toHex(new Uint8Array(32).fill(7));
  for (const body of [
    { sealed: "AUTRE-v1", enc, ciphertext: `0x${"00".repeat(40)}` },
    { sealed: COPILOT_SEALED_TAG, enc: "0x1234", ciphertext: `0x${"00".repeat(40)}` },
    { sealed: COPILOT_SEALED_TAG, enc, ciphertext: "pas de l'hexadécimal" },
  ]) {
    const r = await post(body);
    assert.equal(r.status, 400);
    assert.equal((await r.json() as any).code, "sealed_malformed");
  }
  const garbage = await post({ sealed: COPILOT_SEALED_TAG, enc, ciphertext: `0x${"00".repeat(64)}` });
  assert.equal(garbage.status, 400);
  const g = await garbage.json() as any;
  assert.equal(g.code, "sealed_undecryptable");
  assert.match(g.text, /^Request refused: this enclave can't decrypt/);
  // chiffré vers la BONNE clé, mais lié à un autre produit (info) : ne s'ouvre pas
  const plain = new TextEncoder().encode(JSON.stringify(ask()));
  for (const info of [
    exchangeInfo(COPILOT_SEALED_TAG, 5042002, REG, 5n, h.kit.keys.signer),
    exchangeInfo(COPILOT_SEALED_TAG, 5042002, PREG, PRODUCT, h.kit.keys.signer),
    exchangeInfo(COPILOT_SEALED_TAG, 5042, REG, PRODUCT, h.kit.keys.signer),
    exchangeInfo("ARC-AUTRE-v1", 5042002, REG, PRODUCT, h.kit.keys.signer),
  ]) {
    const sx = await sealExchange(toBytes(h.kit.keys.x25519PublicKey), COPILOT_SEALED_TAG, info, plain);
    const r = await post({ sealed: COPILOT_SEALED_TAG, enc: toHex(sx.enc), ciphertext: toHex(sx.ciphertext) });
    assert.equal((await r.json() as any).code, "sealed_undecryptable");
  }
  assert.equal(h.llm.calls.length, 0, "le modèle n'a jamais été appelé");
});

test("refusals AFTER opening (invalid conversation, language): sealed, HTTP 200; clear mode still served; copilot outside an enclave: envelope refused", async () => {
  const h = harness();
  const client = h.client({ lang: "en" });
  const bad = await client.chat({ messages: [{ role: "assistant", content: "x" }, { role: "user", content: "   " }] });
  assert.equal(bad.authenticated, true);
  assert.equal(bad.status, 400);
  assert.equal(bad.reply.code, "bad_conversation");
  assert.equal(bad.reply.text, "Request refused: empty message.");
  assert.equal(chats(h).at(-1)!.status, 200, "le statut réel ne se voit pas sur le fil");
  // mode clair (compatibilité) sur l'enclave : servi, et le copilote sait qu'il est arrivé en clair
  const clear = await h.app.fetch(new Request(`${URL_}/chat`, { method: "POST", headers: { "content-type": "application/json", ...PROXIED }, body: JSON.stringify({ messages: [{ role: "user", content: "Montre-moi la ruche" }] }) }));
  assert.equal(clear.status, 200);
  assert.equal((await clear.json() as any).text, SECRET_A);
  assert.match(String(h.llm.calls.at(-1)!.messages[0]!.content), /arrivée EN CLAIR/);
  // le copilote du VPS (sans kit) refuse une enveloppe chiffrée
  const vps = createCopilotApp({ llm: async () => ({ content: "x" }), system: "S", tools: [], executeTool: async () => ({ result: {} }), allowedOrigins: [SITE], rate: { perMinute: 10, perDay: 10, globalPerDay: 0 } });
  const r = await vps.request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sealed: COPILOT_SEALED_TAG, enc: toHex(new Uint8Array(32)), ciphertext: `0x${"00".repeat(40)}` }) });
  assert.equal(r.status, 400);
  assert.equal((await r.json() as any).code, "sealed_unavailable");
});

test("the model key never leaves, even sealed; an invalid wallet is not passed on", async () => {
  const h = harness({ llmText: "voici la clé sk-test-SERVER-KEY-0123456789 du serveur" });
  const r = await h.client().chat({ messages: [{ role: "user", content: "hello" }], user: "pas une adresse" });
  assert.ok(!r.reply.text.includes("SERVER-KEY"), r.reply.text);
  assert.match(String(h.llm.calls[0]!.messages[0]!.content), /Aucun wallet connecté/);
});

test("enclave configuration: required, consistent with the deployments file, fails closed", () => {
  // a fixed fixture: the v2 stack's deployments file, whose registry address is asserted below (the parsing is the same for v2.1)
  const v2 = readFileSync(new URL("../../../deployments.v2.testnet.json", import.meta.url), "utf8");
  const read = () => v2;
  const base = {
    PRODUCT_ID: "4", DEPLOYMENTS: "/app/deployments/deployments.v2.testnet.json", OPENAI_BASE_URL: "https://api.redpill.ai/v1",
    COPILOT_MODEL: "openai/gpt-oss-120b", ALLOWED_ORIGINS: SITE, COPILOT_PROXY_TOKEN: PROXY_TOKEN,
  };
  const ok = readCopilotEnclaveConfig(base, read);
  assert.equal(ok.registry, "0x54AeCc6500a1CfB33FD5BFB3008ed7A600Ae7d38", "registre lu dans le fichier, jamais en dur");
  assert.equal(ok.chainId, 5042002);
  assert.equal(ok.productId, 4n);
  assert.deepEqual(ok.operatorAllowlist, [], "OPERATOR_ALLOWLIST absente : personne");
  assert.equal(ok.port, 8808);
  assert.deepEqual(ok.rpcUrls, ["https://rpc.testnet.arc.io"]);
  assert.equal(ok.proxyToken, PROXY_TOKEN);
  assert.equal(readCopilotEnclaveConfig({ ...base, DEBUG: "" }, read).port, 8808, "DEBUG vide : accepté (et retiré au démarrage)");
  assert.equal(readCopilotEnclaveConfig({ ...base, REGISTRY: "0x54aecc6500a1cfb33fd5bfb3008ed7a600ae7d38", CHAIN_ID: "5042002" }, read).registry, ok.registry);
  for (const [over, why] of [
    [{ PRODUCT_ID: undefined }, /PRODUCT_ID required/], [{ PRODUCT_ID: "0" }, /PRODUCT_ID required/], [{ DEPLOYMENTS: undefined }, /DEPLOYMENTS required/],
    [{ REGISTRY: "0x1111111111111111111111111111111111111111" }, /is not the EnclaveRegistry/], [{ CHAIN_ID: "5042" }, /is not the chain/],
    [{ OPENAI_BASE_URL: undefined }, /OPENAI_BASE_URL required/], [{ OPENAI_BASE_URL: "http://api.redpill.ai/v1" }, /OPENAI_BASE_URL required, over https/],
    [{ COPILOT_MODEL: " " }, /COPILOT_MODEL required/], [{ COPILOT_ALLOW_PRIVATE_URLS: "1" }, /refused in an enclave/],
    [{ ALLOWED_ORIGINS: `${SITE},*` }, /ALLOWED_ORIGINS=\* refused/], [{ OPERATOR_ALLOWLIST: "0xpasbon" }, /OPERATOR_ALLOWLIST: invalid address/],
    [{ PORT: "99999" }, /invalid PORT/],
    // 9/11 : DEBUG, quelle qu'en soit la valeur (openai@4 journaliserait la clé du modèle et la conversation)
    [{ DEBUG: "true" }, /DEBUG refused in an enclave/], [{ DEBUG: "0" }, /DEBUG refused in an enclave/], [{ DEBUG: " " }, /DEBUG refused/],
    // 9/11 : jeton du mandataire, variable chiffrée, 32 octets au moins, ASCII visible
    [{ COPILOT_PROXY_TOKEN: undefined }, /COPILOT_PROXY_TOKEN required/], [{ COPILOT_PROXY_TOKEN: "x".repeat(31) }, /COPILOT_PROXY_TOKEN required/],
    [{ COPILOT_PROXY_TOKEN: `${"x".repeat(20)} ${"y".repeat(20)}` }, /visible ASCII/], [{ COPILOT_PROXY_TOKEN: `${"é".repeat(20)}` }, /visible ASCII/],
  ] as Array<[Record<string, string | undefined>, RegExp]>) {
    assert.throws(() => readCopilotEnclaveConfig({ ...base, ...over }, read), why, JSON.stringify(over));
  }
  // les messages d'erreur ne recopient jamais la valeur d'une variable chiffrée ni de DEBUG
  for (const over of [{ DEBUG: "true-SECRET-VALUE" }, { COPILOT_PROXY_TOKEN: "SECRET-VALUE-short" }, { COPILOT_PROXY_TOKEN: `SECRET-VALUE ${"z".repeat(40)}` }]) {
    assert.throws(() => readCopilotEnclaveConfig({ ...base, ...over }, read), (e: Error) => !e.message.includes("SECRET-VALUE"));
  }
  assert.throws(() => readCopilotEnclaveConfig(base, () => "{}"), /unreadable/);
});

test("per-IP rate in the enclave (the reviewer's cost-xff case): without the proxy's token, 403 proxy_required and no model call; X-Forwarded-For trusted only with the token", async () => {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: 5042002, registry: REG, mockBlockHash: true });
  const m = scriptedLlm("ok");
  const { fetch: f } = createCopilotEnclaveApp({
    kit, proxyToken: PROXY_TOKEN,
    copilot: { llm: m.llm, system: "S", tools: [], executeTool: async () => ({ result: {} }), allowedOrigins: [SITE], rate: { perMinute: 20, perDay: 300, globalPerDay: 0 } },
    attest: { operatorAllowlist: [OP], registeredOperator: async () => zeroAddress, warn: () => {} },
  });
  const chat = (headers: Record<string, string>) => f(new Request(`${URL_}/chat`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  }));
  // la preuve : 60 requêtes en une minute vers l'URL Phala DIRECTE, X-Forwarded-For changé à chaque fois
  const direct = await Promise.all(Array.from({ length: 60 }, (_, i) => chat({ "x-forwarded-for": `198.51.${i}.7, 9.9.${i}.1` })));
  assert.deepEqual([...new Set(direct.map((r) => r.status))], [403]);
  const j = await direct[0]!.json() as { code: string; text: string };
  assert.equal(j.code, "proxy_required");
  assert.match(j.text, /only answers through the site/);
  // un mauvais jeton (ou de longueur différente, ou vide) n'aide pas
  for (const bad of [PROXY_TOKEN.slice(0, -1) + "x", PROXY_TOKEN + "x", "", "x"]) {
    assert.equal((await chat({ "x-archive-proxy-token": bad, "x-forwarded-for": "203.0.113.5" })).status, 403, JSON.stringify(bad));
  }
  assert.equal(m.calls.length, 0, "le modèle n'a jamais été appelé");
  // au travers du mandataire (jeton bon) : X-Forwarded-For de Caddy cru, une IP = 20 requêtes par minute, une autre passe
  const viaSite = [];
  for (let i = 0; i < 21; i++) viaSite.push((await chat({ ...PROXIED, "x-forwarded-for": "203.0.113.9" })).status);
  assert.deepEqual(viaSite, [...Array(20).fill(200), 429]);
  assert.equal((await chat({ ...PROXIED, "x-forwarded-for": "203.0.113.10" })).status, 200);
  // /health, /pubkeys et /attest restent publics (sans jeton)
  const health = await f(new Request(`${URL_}/health`));
  assert.equal(health.status, 200);
  assert.equal((await health.json() as any).proxyTokenRequired, true);
  assert.equal((await f(new Request(`${URL_}/pubkeys`))).status, 200);
  const attest = await f(new Request(`${URL_}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator: OP, anchorR: "1" }) }));
  assert.equal(attest.status, 200);
  // un copilote en enclave sans jeton ne se monte pas
  assert.throws(() => createCopilotEnclaveApp({ kit, proxyToken: "", copilot: { llm: null, system: "S", tools: [], executeTool: async () => ({ result: {} }), allowedOrigins: [SITE], rate: { perMinute: 1, perDay: 1, globalPerDay: 0 } } }), /COPILOT_PROXY_TOKEN/);
});
