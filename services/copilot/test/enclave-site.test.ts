/** enclave-site.test.ts — the SITE copilot (AskHive) in its enclave (enclave-site.ts) with the REAL enclave kit (keys in
 *  memory, a SIMULATED quote since there is no TDX here), the REAL site surface (copilotFromEnv with COPILOT_SURFACE=site
 *  and the MEASURED variables of the compose enclave/phala/copilot-site-v22.yml: prompt, tools, validation of the
 *  interface tools, the site's docs_search, limits), a SCRIPTED model, and a client written like the site's panel: the
 *  site's request (messages, lang, user, page) sealed with HPKE, the reply opened with THIS request's secret, then its
 *  signature checked by an independent copy of the computation (not the enclave's code). No network call, no real
 *  model.
 *  Covers: the server's loop replayed in the enclave (interface tools returned to the browser, prepare tool in
 *  `actions`, docs_search cited); the proxy sees only ciphertext; a valid signature, bound to the question and the body
 *  (changed body, other question, other key → refused); sealed refusals signed too; clear mode without a signature;
 *  where it runs stated correctly in TDX and outside it, never "on the server"; configuration and measured compose; the
 *  VM's fingerprint.
 *  Run: cd services/copilot && npx tsx --test test/enclave-site.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Address, type Hex, concat, encodeAbiParameters, keccak256, recoverMessageAddress, stringToBytes, toBytes, toHex, zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { COPILOT_SEALED_TAG, deploymentFromJson, exchangeInfo, sealExchange, testnet } from "@arcvault/sdk";
import { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import type { CopilotAppOptions, Llm, LlmReply, LlmRequest } from "../src/app";
import { SITE_SYSTEM, copilotFromEnv } from "../src/copilot";
import { createCopilotEnclaveApp, enclaveSystemNote, type EnclaveFacts } from "../src/enclave-app";
import { readCopilotEnclaveConfig } from "../src/enclave-config";
import {
  SERVER_CLAIMS, SITE_REPLY_TAG, siteEnclaveNote, siteEnclaveOptions, siteEnclaveSystem, verifySiteReply,
} from "../src/enclave-site";
import { IMAGE_PLACEHOLDER, V21_COPILOT_VM, appComposeFor, canonicalJson, composeHashOf, predictedImageId } from "../src/enclave-site-measure";
import { SITE_KB, SITE_PAGES_KB, siteLanguageDirective } from "../src/site";
import * as siteModule from "../src/site";

/** The site server's note (site.ts), read without a compile-time dependency. */
const SERVER_NOTE = (siteModule as unknown as Record<string, unknown>).SITE_WHERE_NOTE as string | undefined;

const SITE = "https://archive.62-171-153-35.sslip.io";
const URL_ = "https://copilot-site.enclave.test";
const REG = "0x00000000000000000000000000000000000000c2" as Address;
const OP = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x5724d89D610c3017b8DC161c025248341556f6Ab" as Address;
const PRODUCT = 4n;
const CHAIN = 5042002;
const PROXY_TOKEN = `test-proxy-token-${"k".repeat(40)}`;
const SERVER_KEY = "sk-test-SERVER-KEY-0123456789";
const FINAL = "Install the agent with the command shown in this step, then pair your machine. The bond card is ready: sign it in your wallet.";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const COMPOSE_V22 = here("../../../enclave/phala/copilot-site-v22.yml");
const COMPOSE_V21 = here("../../../enclave/phala/copilot-v21.yml");
const VPS_COMPOSE = here("../../../deploy/docker-compose.vps.yml");
const DEPLOYMENTS_V21 = here("../../../docs/history/deployments.v21.testnet.json");
const COMPOSE_V3 = here("../../../enclave/phala/copilot-site-v3.yml");
const DEPLOYMENTS_V3 = here("../../../deployments.v3.testnet.json");
/** The v21 VM's app-compose.json template, saved outside the repository (V21_APP_COMPOSE=<path>): without it, the part
 *  of the test that reads it is skipped. */
const V21_APP_COMPOSE = process.env.V21_APP_COMPOSE ?? "";

// ---------------------------------------------------------------- the compose, read as Phala measures it

interface ComposeService { image: string; measured: Record<string, string>; secret: string[]; keys: string[] }
/** The services of a Phala compose: image, variables in clear (measured) and encrypted (${…}), top-level keys. */
function readCompose(file: string): Record<string, ComposeService> {
  const out: Record<string, ComposeService> = {};
  let cur: ComposeService | null = null;
  let inEnv = false;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*#/.test(line) || !line) continue;
    const svc = line.match(/^ {2}([A-Za-z0-9_-]+):$/);
    if (svc) { cur = out[svc[1]!] = { image: "", measured: {}, secret: [], keys: [] }; inEnv = false; continue; }
    if (!cur) continue;
    const key = line.match(/^ {4}([a-z_]+):(.*)$/);
    if (key) {
      cur.keys.push(key[1]!);
      if (key[1] === "image") cur.image = key[2]!.trim();
      inEnv = key[1] === "environment";
      continue;
    }
    const item = inEnv ? line.match(/^ {6}- "?([^"]+)"?$/) : null;
    if (!item) continue;
    const [k, ...v] = item[1]!.split("=");
    const val = v.join("=");
    if (/^\$\{.+\}$/.test(val)) cur.secret.push(k!); else cur.measured[k!] = val;
  }
  return out;
}
const v22 = () => readCompose(COMPOSE_V22)["copilot-enclave"]!;

/** The SITE copilot's options as copilotFromEnv mounts them with the MEASURED variables of the v22 compose. */
function siteBaseOptions(): CopilotAppOptions {
  const env = v22().measured;
  const keep: Record<string, string | undefined> = {};
  for (const k of [...Object.keys(env), "OPENAI_API_KEY"]) keep[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    delete process.env.OPENAI_API_KEY;
    const c = copilotFromEnv({ deployment: testnet });
    assert.equal(c.surface, "site");
    return c.options;
  } finally {
    for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ---------------------------------------------------------------- the scripted model and the enclave

const call = (id: string, name: string, args: unknown) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
type Turn = (req: LlmRequest, n: number) => LlmReply;
function scripted(turn: Turn) {
  const calls: LlmRequest[] = [];
  const llm: Llm = async (req) => { calls.push({ ...req, messages: structuredClone(req.messages) }); return turn(req, calls.length); };
  return { llm, calls };
}

/** "Help me install the tool", seen from the Rent page: docs_search and ui_navigate, then the prepared bond and
 *  ui_highlight, then the answer. */
const installScript: Turn = (_req, n) => {
  if (n === 1) {
    return { content: "", tool_calls: [
      call("c1", "docs_search", { query: "install the archive-node agent" }),
      call("c2", "ui_navigate", { page: "rent", section: "install", reason: "Here is where you install the agent" }),
    ] };
  }
  if (n === 2) {
    return { content: "", tool_calls: [
      call("c3", "operator_prepare_bond", { amount: "1", productId: "1" }),
      call("c4", "ui_highlight", { target: "install", note: "The install command is in this step" }),
    ] };
  }
  return { content: FINAL };
};

const BOND_CARD = { kind: "bond", productId: "1", amount: "1", sign: "EIP-3009 authorization, signed by YOUR wallet", checks: [{ ok: true, label: "bond ≥ the product's minimum" }] };

function harness(o: { mock?: boolean; turn?: Turn; facts?: Partial<EnclaveFacts> } = {}) {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REG, mockBlockHash: true });
  const facts: EnclaveFacts = {
    signer: kit.keys.signer, productId: PRODUCT, chainId: CHAIN, registry: REG, model: "openai/gpt-oss-120b",
    provider: "https://tee.redpill.ai/v1", mock: o.mock ?? true, ...(o.facts ?? {}),
  };
  const base = siteBaseOptions();
  const m = scripted(o.turn ?? installScript);
  const executed: string[] = [];
  // docs_search: the site's REAL tool (SITE_KB base, no network); the tools that read Arc: fixed answers
  const executeTool: CopilotAppOptions["executeTool"] = async (name, args, user) => {
    executed.push(name);
    if (name === "docs_search") return base.executeTool(name, args, user);
    if (name === "operator_prepare_bond") return { result: { ...BOND_CARD, owner: user ?? null } };
    if (name === "enclaves_list") return { result: { enclaves: [{ signer: kit.keys.signer, productId: "4", active: true }] } };
    throw new Error(`unexpected tool in this test: ${name}`);
  };
  const copilot = siteEnclaveOptions({
    ...base, llm: m.llm, executeTool, allowedOrigins: [SITE], rate: { perMinute: 1_000, perDay: 10_000, globalPerDay: 0 }, secrets: [SERVER_KEY],
  }, facts);
  const app = createCopilotEnclaveApp({
    kit, copilot, proxyToken: PROXY_TOKEN, signReplies: true,
    attest: { operatorAllowlist: [OP], registeredOperator: async () => zeroAddress, warn: () => {} },
  });
  return { kit, app, m, facts, executed, copilot };
}
type H = ReturnType<typeof harness>;

/** A client like the site's panel: the request sealed to the enclave's key, the reply opened with THIS secret. */
async function sealedAsk(h: Pick<H, "kit" | "app">, body: Record<string, unknown>) {
  const info = exchangeInfo(COPILOT_SEALED_TAG, CHAIN, REG, PRODUCT, h.kit.keys.signer);
  const sx = await sealExchange(toBytes(h.kit.keys.x25519PublicKey), COPILOT_SEALED_TAG, info, stringToBytes(JSON.stringify(body)));
  const wire = JSON.stringify({ sealed: COPILOT_SEALED_TAG, enc: toHex(sx.enc), ciphertext: toHex(sx.ciphertext) });
  const res = await h.app.fetch(new Request(`${URL_}/chat`, {
    method: "POST", body: wire,
    headers: { "content-type": "application/json", origin: SITE, "x-archive-proxy-token": PROXY_TOKEN, "x-forwarded-for": "198.51.100.7" },
  }));
  const wireOut = await res.text();
  const j = JSON.parse(wireOut) as { sealed: string; nonce: Hex; ciphertext: Hex };
  const inner = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sx.openResponse(toBytes(j.nonce), toBytes(j.ciphertext)))) as any;
  return { res, wire, wireOut, j, inner, enc: sx.enc, ciphertext: sx.ciphertext };
}

/** A reply's proof, computed the way a client would, without taking anything from the enclave's code: if the enclave's
 *  format changes, this cross test breaks. */
async function panelProof(signer: Address, enc: Uint8Array, reqCt: Uint8Array, inner: any): Promise<{ kind: "signed" | "sealed"; bad?: true; digest?: Hex }> {
  const REPLY_TAG = "ARC-COPILOT-SITE-REPLY-v1";
  const request = keccak256(concat([enc, reqCt]));
  const sig = inner?.sig && typeof inner.sig === "object" && !Array.isArray(inner.sig) ? inner.sig : null;
  const signature = sig && typeof sig.signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(sig.signature) ? (sig.signature as Hex) : null;
  if (!signature) return { kind: "sealed" };
  const bodyHash = keccak256(stringToBytes(JSON.stringify(inner.body)));
  const digest = keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [REPLY_TAG, BigInt(CHAIN), REG, PRODUCT, signer, request, bodyHash],
  ));
  let who = "";
  try { who = await recoverMessageAddress({ message: { raw: digest }, signature }); } catch { /* malformed signature */ }
  return who.toLowerCase() === signer.toLowerCase() ? { kind: "signed", digest } : { kind: "sealed", bad: true, digest };
}

const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  messages: [{ role: "user", content }], lang: "en", user: OWNER, page: { name: "rent", section: "install" }, ...extra,
});
const sysOf = (h: H, i = 0) => String(h.m.calls[i]!.messages[0]!.content);

// ---------------------------------------------------------------- the site's loop, inside the enclave

test("site in the enclave: the same loop as the server (interface tools returned, prepare card, docs_search cited), sealed and SIGNED", async () => {
  const h = harness();
  const r = await sealedAsk(h, ask("Help me install the tool on my machine"));
  assert.equal(r.res.status, 200);
  assert.deepEqual(Object.keys(r.j).sort(), ["ciphertext", "nonce", "sealed"], "on the wire: ciphertext only");
  assert.equal(r.inner.status, 200);
  const body = r.inner.body;
  assert.equal(body.text, FINAL);
  // the shape of the site's contract: tools in order, interface validated (ok) for the browser, a prepare card
  assert.deepEqual(body.tools.map((t: any) => t.tool), ["docs_search", "ui_navigate", "operator_prepare_bond", "ui_highlight"]);
  const nav = body.tools[1];
  assert.equal(nav.result.ok, true);
  assert.equal(nav.result.page, "rent");
  assert.equal(nav.result.section, "install");
  assert.equal(body.tools[3].result.ok, true, "ui_highlight of an anchor of the page reached");
  assert.equal(body.actions.length, 1);
  assert.equal(body.actions[0].tool, "operator_prepare_bond");
  assert.deepEqual(body.actions[0].result, { ...BOND_CARD, owner: OWNER }, "the connected wallet reaches the prepare tool");
  assert.deepEqual(body.tools[2].result, body.actions[0].result);
  const kbSources = new Set(SITE_KB.map((k) => k.source));
  assert.ok(body.citations.length > 0 && body.citations.every((c: string) => kbSources.has(c)), JSON.stringify(body.citations));
  // the interface tools never run on the enclave side: only docs_search and the prepare card went through executeTool
  assert.deepEqual(h.executed, ["docs_search", "operator_prepare_bond"]);
  // the signature: the one a client verifies, by the enclave's key
  assert.equal(r.inner.sig.v, SITE_REPLY_TAG);
  assert.equal(r.inner.sig.signer, h.kit.keys.signer);
  const proof = await panelProof(h.kit.keys.signer, r.enc, r.ciphertext, r.inner);
  assert.equal(proof.kind, "signed");
  assert.equal(proof.digest, r.inner.sig.digest);
  const v = await verifySiteReply(r.inner, { enc: r.enc, ciphertext: r.ciphertext, signer: h.kit.keys.signer, chainId: CHAIN, registry: REG, productId: PRODUCT });
  assert.equal(v.ok, true, JSON.stringify(v));
  // the proxy read nothing, in either direction
  for (const secret of ["install", "rent", OWNER.slice(2).toLowerCase(), "Help me"]) assert.ok(!r.wire.toLowerCase().includes(secret.toLowerCase()), `question lisible : ${secret}`);
  for (const secret of ["Install the agent", "operator_prepare_bond", "ui_navigate", SITE_REPLY_TAG]) assert.ok(!r.wireOut.includes(secret), `readable reply: ${secret}`);
});

test("site in the enclave: the prompt is the site's, with the page on screen, the ENCLAVE's note and the site's language directive", async () => {
  const h = harness();
  await sealedAsk(h, ask("Help me install the tool on my machine"));
  const sys = sysOf(h);
  assert.ok(sys.startsWith(SITE_SYSTEM), "the site's prompt, as the server serves it");
  assert.match(sys, /The user is looking at: page=rent \(/);
  assert.match(sys, /section=install/);
  assert.ok(sys.includes(OWNER), "connected wallet");
  assert.match(sys, /WHERE YOU RUN/);
  assert.match(sys, /DEVELOPMENT instance/, "simulated quote: it says so");
  assert.ok(!/runs inside an Intel TDX enclave/.test(sys), "outside TDX: never \"in the enclave\"");
  assert.match(sys, /arrived ENCRYPTED \(HPKE\)/);
  assert.ok(sys.endsWith(siteLanguageDirective("en", "en")), "the site's language instruction last");
  for (const re of SERVER_CLAIMS) assert.ok(!re.test(sys), `a server sentence in the enclave's prompt: ${re}`);
  // the site server's note ("on the ArcHive site's server, NOT in an enclave") never enters the enclave
  if (typeof SERVER_NOTE === "string") assert.ok(!sys.includes(SERVER_NOTE));
  assert.equal((h.copilot.site as unknown as Record<string, unknown>).whereNote, undefined);
  // a single "WHERE YOU RUN" section (the list of the prompt's internal labels names it too, in parentheses)
  assert.equal((sys.match(/WHERE YOU RUN(?: \(|:)/g) ?? []).length, 1, "a single truth about where it runs");
  // the model receives the site's passages (docs_search) and the site's tools
  const toolMsg = h.m.calls[1]!.messages.find((x: any) => x.role === "tool" && x.tool_call_id === "c1") as any;
  assert.ok(toolMsg && /site-v\d#/.test(String(toolMsg.content)), "passages from the site's knowledge base");
  const names = h.m.calls[0]!.tools.map((t: any) => t.function.name);
  for (const n of ["ui_navigate", "ui_highlight", "ui_demo", "docs_search", "operator_prepare_bond", "session_prepare_open"]) assert.ok(names.includes(n), n);
  assert.ok(!names.some((n: string) => /^(send|pay|transfer|sign)/.test(n)), "no tool that spends or signs");
});

test("signature bound to the question AND the body: changed body, other question, other key → refused (a client then sees it as sealed, never signed)", async () => {
  const h = harness({ turn: () => ({ content: "The bond is 1 USDC." }) });
  const a = await sealedAsk(h, ask("What is the bond for product 1?"));
  const b = await sealedAsk(h, ask("Something else entirely, please?"));
  const ctx = { signer: h.kit.keys.signer, chainId: CHAIN, registry: REG, productId: PRODUCT };
  assert.equal((await verifySiteReply(a.inner, { ...ctx, enc: a.enc, ciphertext: a.ciphertext })).ok, true);
  // a relay cannot change the body (it does not see it); but even a client that changed it would break the signature
  const edited = structuredClone(a.inner);
  edited.body.text = "The bond is 0 USDC.";
  assert.deepEqual(await panelProof(h.kit.keys.signer, a.enc, a.ciphertext, edited), { kind: "sealed", bad: true, digest: (await panelProof(h.kit.keys.signer, a.enc, a.ciphertext, edited)).digest });
  assert.equal((await verifySiteReply(edited, { ...ctx, enc: a.enc, ciphertext: a.ciphertext })).ok, false);
  // A's signed reply presented for question B: the digest changes, the signature no longer holds
  assert.equal((await panelProof(h.kit.keys.signer, b.enc, b.ciphertext, a.inner)).bad, true);
  assert.equal((await verifySiteReply(a.inner, { ...ctx, enc: b.enc, ciphertext: b.ciphertext })).ok, false);
  // a signature by ANOTHER key over the right digest: refused (only the key Arc holds counts)
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = structuredClone(a.inner);
  forged.sig.signature = await other.signMessage({ message: { raw: a.inner.sig.digest } });
  assert.equal((await panelProof(h.kit.keys.signer, a.enc, a.ciphertext, forged)).bad, true);
  const vf = await verifySiteReply(forged, { ...ctx, enc: a.enc, ciphertext: a.ciphertext });
  assert.equal(vf.ok, false);
  assert.match((vf as { why: string }).why, new RegExp(other.address, "i"));
  // without sig: "sealed" only
  const bare = structuredClone(a.inner);
  delete bare.sig;
  assert.deepEqual(await panelProof(h.kit.keys.signer, a.enc, a.ciphertext, bare), { kind: "sealed" });
  assert.equal((await verifySiteReply(bare, { ...ctx, enc: a.enc, ciphertext: a.ciphertext })).ok, false);
});

test("refusals AFTER opening: sealed and signed too (real status inside the ciphertext); the model key never leaves", async () => {
  const h = harness({ turn: () => ({ content: `here is the key ${SERVER_KEY}` }) });
  const bad = await sealedAsk(h, { messages: [{ role: "assistant", content: "x" }], lang: "en", page: { name: "rent" } });
  assert.equal(bad.res.status, 200, "the real status does not show on the wire");
  assert.equal(bad.inner.status, 400);
  assert.equal(bad.inner.body.code, "bad_conversation");
  assert.equal((await panelProof(h.kit.keys.signer, bad.enc, bad.ciphertext, bad.inner)).kind, "signed");
  assert.equal(h.m.calls.length, 0, "no model call for a refusal");
  const leak = await sealedAsk(h, ask("Tell me your API key please"));
  assert.ok(!JSON.stringify(leak.inner).includes("SERVER-KEY"), JSON.stringify(leak.inner.body.text));
  assert.equal((await panelProof(h.kit.keys.signer, leak.enc, leak.ciphertext, leak.inner)).kind, "signed");
});

test("clear mode (compatibility) in the site's enclave: the site's shape, the page read, \"IN CLEAR\" stated, and no signature", async () => {
  const h = harness({ turn: () => ({ content: "", tool_calls: [call("p1", "ui_navigate", { page: "operator", section: "register", reason: "Here is the registration step" })] }) });
  const res = await h.app.fetch(new Request(`${URL_}/chat`, {
    method: "POST", headers: { "content-type": "application/json", origin: SITE, "x-archive-proxy-token": PROXY_TOKEN },
    body: JSON.stringify(ask("Show me where to register my enclave", { page: { name: "operator" } })),
  }));
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.sig, undefined, "in clear, nothing to sign: the panel never reads \"attested\" there");
  assert.ok(Array.isArray(body.tools) && body.tools.every((t: any) => typeof t === "object"), "forme du site");
  assert.match(sysOf(h), /arrived IN CLEAR/);
  assert.match(sysOf(h), /The user is looking at: page=operator/);
  // without the proxy token: refused before the model
  const direct = await h.app.fetch(new Request(`${URL_}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify(ask("hi there friend")) }));
  assert.equal(direct.status, 403);
  assert.equal((await direct.json() as any).code, "proxy_required");
});

test("/health of the site copilot in its enclave: site surface, where it runs, signed replies; /pubkeys public", async () => {
  const h = harness();
  const health = await (await h.app.fetch(new Request(`${URL_}/health`))).json() as any;
  assert.equal(health.surface, "site");
  assert.equal(health.runtime, "mock");
  assert.equal(health.signedReplies, SITE_REPLY_TAG);
  assert.equal(health.sealed, COPILOT_SEALED_TAG);
  assert.equal(health.proxyTokenRequired, true);
  assert.equal(harness({ mock: false }).facts.mock, false);
  const tdx = await (await harness({ mock: false }).app.fetch(new Request(`${URL_}/health`))).json() as any;
  assert.equal(tdx.runtime, "tdx");
  const pk = await (await h.app.fetch(new Request(`${URL_}/pubkeys`))).json() as any;
  assert.equal(pk.signer, h.kit.keys.signer);
  assert.equal(pk.x25519, h.kit.keys.x25519PublicKey);
});

// ---------------------------------------------------------------- where it runs: true in both cases

test("enclave note: in TDX it states the enclave, the key, Arc and the signature; outside TDX it says the opposite; never \"on the server\"", () => {
  const base: EnclaveFacts = { signer: "0xB3c51bDd7C19acFF81261BD09539EE2912F1a2dB", productId: 4n, chainId: CHAIN, registry: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d", model: "openai/gpt-oss-120b", provider: "https://tee.redpill.ai/v1", mock: false };
  const tdx = siteEnclaveNote({ ...base, signs: true });
  for (const sealed of [true, false]) {
    const t = tdx({ sealed });
    assert.match(t, /you are ArcHive's attested copilot, product #4: this program runs inside an Intel TDX enclave/);
    assert.ok(t.includes(base.signer) && t.includes(base.registry) && t.includes(String(CHAIN)));
    assert.match(t, /your signature on it/);
    assert.match(t, /never in this enclave/, "the model is not in the enclave");
    assert.match(t, /call enclaves_list/, "the network state is read, not recited");
    assert.match(t, sealed ? /arrived ENCRYPTED/ : /arrived IN CLEAR/);
    for (const re of SERVER_CLAIMS) assert.ok(!re.test(t), String(re));
  }
  assert.match(tdx({ sealed: true }), /receives the conversation in clear/, "unverified gateway: the provider reads the conversation");
  const aci = siteEnclaveNote({ ...base, signs: true, modelAttested: { origin: "https://tee.redpill.ai", composeHash: "ab".repeat(32) } })({ sealed: true });
  assert.match(aci, /verified that the provider's gateway \(https:\/\/tee\.redpill\.ai\) itself runs in an attested Intel TDX enclave/);
  assert.match(aci, /Claim no more/);
  // the note overrides the site's knowledge base and says how to answer "does this chat run in an enclave?" without
  // docs_search, why to trust it, and who else reads the conversation (the model's gateway)
  for (const t of [aci, tdx({ sealed: true }), tdx({ sealed: false })]) {
    assert.match(t, /it overrides the FACTS, docs_search passages and history texts on where you run or on whether the copilot's enclave runs or is registered/);
    assert.match(t, /Asked whether this chat runs in an enclave, or where you run: answer from these lines, never from docs_search/);
  }
  assert.match(aci, /yes, this conversation is sealed to the enclave of product #4/);
  assert.match(aci, /each answer carries your signature, which any client can check against that key/);
  assert.match(aci, /behind an attested gateway this enclave verified, and that gateway and the model read the conversation to answer/);
  assert.match(tdx({ sealed: true }), /the model runs at its provider, which receives the conversation in clear\.$/);
  assert.match(tdx({ sealed: false }), /but this conversation arrived in clear, so the web server relaying it can read it/);
  for (const re of SERVER_CLAIMS) assert.ok(!re.test(aci), String(re));
  const mock = siteEnclaveNote({ ...base, mock: true, signs: true })({ sealed: true });
  assert.ok(!/Asked whether this chat runs in an enclave/.test(mock), "outside TDX: no \"yes, in the enclave\" instruction");
  assert.match(mock, /DEVELOPMENT instance/);
  assert.match(mock, /OUTSIDE any Intel TDX enclave/);
  assert.match(mock, /Never say you run in an enclave/);
  assert.ok(!/runs inside an Intel TDX enclave/.test(mock));
  // the console's note (French): outside TDX, it no longer says "dans une enclave Intel TDX" (in an Intel TDX enclave)
  const consoleMock = enclaveSystemNote({ ...base, mock: true })({ sealed: true, lang: "fr" });
  assert.match(consoleMock, /HORS de toute enclave Intel TDX/);
  assert.ok(!/OÙ TU TOURNES[^:]*: dans une enclave Intel TDX/.test(consoleMock));
  assert.match(enclaveSystemNote(base)({ sealed: true, lang: "fr" }), /OÙ TU TOURNES[^:]*: dans une enclave Intel TDX/);
});

test("guard: a prompt that says \"you run on the server\" stops the enclave; the site's current prompt passes", () => {
  assert.equal(siteEnclaveSystem(SITE_SYSTEM), SITE_SYSTEM);
  for (const claim of [
    "4 attested copilot, free (not you: you run on the site's server).",
    "WHERE YOU RUN: you run on ArcHive's server, not in an enclave.",
    "You are running on the web server.",
    "You are not in an enclave.",
    "Tu tournes sur le serveur du site.",
  ]) {
    assert.throws(() => siteEnclaveSystem(`${SITE_SYSTEM}\n${claim}`), /two truths/, claim);
  }
  // the site server's note: recognised as a server sentence, and removed as is if it entered the prompt
  if (typeof SERVER_NOTE === "string") {
    assert.ok(SERVER_CLAIMS.some((re) => re.test(SERVER_NOTE)), SERVER_NOTE);
    assert.ok(!siteEnclaveSystem(`${SITE_SYSTEM}\n${SERVER_NOTE}`).includes(SERVER_NOTE));
  }
  // the console surface is not the site surface: refused
  const keep = process.env.COPILOT_SURFACE;
  delete process.env.COPILOT_SURFACE;
  try {
    const consoleOptions = copilotFromEnv({ deployment: testnet }).options;
    assert.throws(() => siteEnclaveOptions(consoleOptions, { signer: OWNER, productId: 4n, chainId: CHAIN, registry: REG, model: "m", provider: "p", mock: true }), /COPILOT_SURFACE=site required/);
  } finally {
    if (keep !== undefined) process.env.COPILOT_SURFACE = keep;
  }
  // no site entry tells the copilot it runs on the server (an entry can describe the server in the third person)
  for (const k of SITE_PAGES_KB) for (const re of SERVER_CLAIMS) assert.ok(!re.test(k.text), `${k.source} : ${re}`);
});

test("console in an enclave: unchanged (sealed reply, no signature); only the site signs", async () => {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REG, mockBlockHash: true });
  const app = createCopilotEnclaveApp({
    kit, proxyToken: PROXY_TOKEN, attest: { operatorAllowlist: [OP], registeredOperator: async () => zeroAddress, warn: () => {} },
    copilot: { llm: async () => ({ content: "ok" }), system: "S", tools: [], executeTool: async () => ({ result: {} }), allowedOrigins: [SITE], rate: { perMinute: 100, perDay: 100, globalPerDay: 0 } },
  });
  const r = await sealedAsk({ kit, app }, { messages: [{ role: "user", content: "hello" }] });
  assert.equal(r.inner.status, 200);
  assert.equal(r.inner.body.text, "ok");
  assert.equal(r.inner.sig, undefined);
});

// ---------------------------------------------------------------- configuration and measured compose

test("configuration: COPILOT_SURFACE site or console (measured), any other value stops the enclave; only the given environment counts", () => {
  const read = () => readFileSync(DEPLOYMENTS_V21, "utf8");
  const base = {
    PRODUCT_ID: "4", DEPLOYMENTS: "/app/deployments/deployments.v21.testnet.json", OPENAI_BASE_URL: "https://tee.redpill.ai/v1",
    COPILOT_MODEL: "openai/gpt-oss-120b", ALLOWED_ORIGINS: SITE, COPILOT_PROXY_TOKEN: PROXY_TOKEN,
  };
  assert.equal(readCopilotEnclaveConfig({ ...base, COPILOT_SURFACE: "site" }, read).surface, "site");
  assert.equal(readCopilotEnclaveConfig({ ...base, COPILOT_SURFACE: "console" }, read).surface, "console");
  const keep = process.env.COPILOT_SURFACE;
  process.env.COPILOT_SURFACE = "site";
  try {
    assert.equal(readCopilotEnclaveConfig(base, read).surface, "console", "absent from the given environment: console (process.env is not read again)");
  } finally {
    if (keep === undefined) delete process.env.COPILOT_SURFACE; else process.env.COPILOT_SURFACE = keep;
  }
  for (const bad of ["web", "site,console", "sites"]) assert.throws(() => readCopilotEnclaveConfig({ ...base, COPILOT_SURFACE: bad }, read), /invalid COPILOT_SURFACE/, bad);
});

test("compose v22: the measured site surface, the server site copilot's limits, no secret in clear, accepted by the enclave's configuration", () => {
  const s = v22();
  const env = s.measured;
  // the image: pinned by digest, or the explicit pre-push placeholder (never deployable)
  assert.ok(new RegExp(`^ghcr\\.io/jeanbaptistedurand/archive-copilot-enclave@sha256:(?:[0-9a-f]{64}|${IMAGE_PLACEHOLDER})$`).test(s.image), s.image);
  assert.deepEqual(s.secret.sort(), ["COPILOT_PROXY_TOKEN", "OPENAI_API_KEY", "OPERATOR_ALLOWLIST"]);
  assert.deepEqual(s.keys, ["image", "ports", "environment", "volumes", "restart"], "ni env_file, ni command, ni entrypoint");
  for (const k of ["DEBUG", "NODE_OPTIONS", "COPILOT_ALLOW_PRIVATE_URLS"]) assert.equal(env[k], undefined, k);
  assert.equal(env.COPILOT_SURFACE, "site");
  assert.equal(env.MODEL_ATTESTATION, "aci");
  assert.equal(env.ALLOWED_ORIGINS, SITE);
  // the bounds of the site copilot on the server (deploy/docker-compose.vps.yml, the copilot-site service)
  const vps = readFileSync(VPS_COMPOSE, "utf8").match(/\n {2}copilot-site:[\s\S]*?\n {4}environment: \[([^\]]*)\]/);
  assert.ok(vps, "service copilot-site du VPS");
  const vpsEnv = Object.fromEntries(vps![1]!.split(",").map((x) => x.trim().replace(/^"|"$/g, "").split("=") as [string, string]));
  for (const k of ["COPILOT_SURFACE", "COPILOT_GLOBAL_PER_DAY", "COPILOT_MAX_INPUT_TOKENS", "COPILOT_MAX_INPUT_CHARS"]) assert.equal(env[k], vpsEnv[k], k);
  // everything else = v21 (same model, same verified gateway, same stack, same origins): only these differences
  const v21 = readCompose(COMPOSE_V21)["copilot-enclave"]!.measured;
  const changed = Object.keys({ ...v21, ...env }).filter((k) => v21[k] !== env[k]).sort();
  assert.deepEqual(changed, ["COPILOT_GLOBAL_PER_DAY", "COPILOT_MAX_INPUT_CHARS", "COPILOT_MAX_INPUT_TOKENS", "COPILOT_SURFACE"]);
  // the enclave's configuration accepts this compose (secrets of the right shape, the repository's stack file)
  const cfg = readCopilotEnclaveConfig(
    { ...env, OPENAI_API_KEY: "sk-test", OPERATOR_ALLOWLIST: OP, COPILOT_PROXY_TOKEN: PROXY_TOKEN },
    (p) => { assert.equal(p, "/app/deployments/deployments.v21.testnet.json"); return readFileSync(DEPLOYMENTS_V21, "utf8"); },
  );
  assert.equal(cfg.surface, "site");
  assert.equal(cfg.productId, 4n);
  assert.equal(cfg.registry, JSON.parse(readFileSync(DEPLOYMENTS_V21, "utf8")).contracts.EnclaveRegistry);
  assert.equal(cfg.registry, testnet.enclaveRegistry, "the registry the panel binds into the exchange and the signature");
  assert.equal(cfg.model, "openai/gpt-oss-120b");
});

test("compose v3 (AskHive r4): the v22 compose on the v3 stack (registry and deployments file only), a new image, accepted by the enclave's configuration with the v3 file and its levels", () => {
  const s = readCompose(COMPOSE_V3)["copilot-enclave"]!;
  const env = s.measured;
  assert.ok(new RegExp(`^ghcr\\.io/jeanbaptistedurand/archive-copilot-enclave@sha256:(?:[0-9a-f]{64}|${IMAGE_PLACEHOLDER})$`).test(s.image), s.image);
  assert.notEqual(s.image, v22().image, "a new image: r4 carries the v3 knowledge and the v3 file");
  assert.deepEqual(s.secret.sort(), ["COPILOT_PROXY_TOKEN", "OPENAI_API_KEY", "OPERATOR_ALLOWLIST"]);
  assert.deepEqual(s.keys, ["image", "ports", "environment", "volumes", "restart"], "no env_file, command or entrypoint");
  for (const k of ["DEBUG", "NODE_OPTIONS", "COPILOT_ALLOW_PRIVATE_URLS"]) assert.equal(env[k], undefined, k);
  // only the stack changes: same surface, model, verified gateway, limits and origins as v22
  const v22env = v22().measured;
  assert.deepEqual(Object.keys(env), Object.keys(v22env), "same variables, same order");
  const changed = Object.keys({ ...v22env, ...env }).filter((k) => v22env[k] !== env[k]).sort();
  assert.deepEqual(changed, ["DEPLOYMENTS", "REGISTRY"]);
  const d3 = JSON.parse(readFileSync(DEPLOYMENTS_V3, "utf8"));
  assert.equal(env.DEPLOYMENTS, "/app/deployments/deployments.v3.testnet.json");
  assert.equal(env.REGISTRY, d3.contracts.EnclaveRegistry);
  const cfg = readCopilotEnclaveConfig(
    { ...env, OPENAI_API_KEY: "sk-test", OPERATOR_ALLOWLIST: OP, COPILOT_PROXY_TOKEN: PROXY_TOKEN },
    (p) => { assert.equal(p, "/app/deployments/deployments.v3.testnet.json"); return readFileSync(DEPLOYMENTS_V3, "utf8"); },
  );
  assert.equal(cfg.surface, "site");
  assert.equal(cfg.productId, 4n);
  assert.equal(cfg.registry, d3.contracts.EnclaveRegistry);
  assert.equal(cfg.model, "openai/gpt-oss-120b");
  // the v3 file carries its levels block: the copilot's tools see the verified level (product 5, SealedBountyVerified)
  const dep = deploymentFromJson(d3);
  assert.equal(dep.enclaveRegistry, d3.contracts.EnclaveRegistry);
  assert.equal(dep.levels?.sealedBountyVerified, d3.contracts.SealedBountyVerified);
  assert.equal(dep.levels?.machineRegistry, d3.contracts.MachineRegistry);
  assert.equal(String(d3.products["5"]?.settlement ?? "").startsWith("SealedBountyVerified"), true, "product 5 = the verified bounty on v3");
});

test("VM fingerprint: dstack's canonical JSON, the v2.1 compose-hash found again, the v2.1 image fingerprint replayed, the prediction for v22", () => {
  assert.equal(canonicalJson({ b: 1, a: ["x", { d: true, c: "é" }] }), '{"a":["x",{"c":"é","d":true}],"b":1}');
  // the v21 measurements (its registration calldata) give back its recorded fingerprint
  assert.equal(predictedImageId(V21_COPILOT_VM.composeHash), V21_COPILOT_VM.imageId);
  const v21Deployed = JSON.parse(readFileSync(DEPLOYMENTS_V21, "utf8")).enclaves["4"];
  assert.equal(v21Deployed.imageId, V21_COPILOT_VM.imageId);
  assert.equal(v21Deployed.composeHash, V21_COPILOT_VM.composeHash);
  const tmpl = { docker_compose_file: "a", pre_launch_script: "b", allowed_envs: ["OPENAI_API_KEY"] };
  assert.throws(() => appComposeFor(tmpl, "services:\n  x:\n    environment:\n      - COPILOT_PROXY_TOKEN=${COPILOT_PROXY_TOKEN}\n"), /allowed_envs/);
  if (!V21_APP_COMPOSE || !existsSync(V21_APP_COMPOSE)) return; // template outside the repository (V21_APP_COMPOSE)
  const saved = JSON.parse(readFileSync(V21_APP_COMPOSE, "utf8")) as Record<string, unknown>;
  assert.equal(composeHashOf(saved), V21_COPILOT_VM.composeHash, "the compose_hash Phala showed for v21");
  assert.equal(composeHashOf(appComposeFor(saved, readFileSync(COMPOSE_V21, "utf8"))), V21_COPILOT_VM.composeHash, "the repository's v21 compose is the one that ran");
  const app22 = appComposeFor(saved, readFileSync(COMPOSE_V22, "utf8"));
  const h22 = composeHashOf(app22);
  assert.notEqual(h22, V21_COPILOT_VM.composeHash);
  assert.match(predictedImageId(h22), /^0x[0-9a-f]{64}$/);
});
