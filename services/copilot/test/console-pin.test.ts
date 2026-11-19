/** console-pin.test.ts — la surface « console » (COPILOT_SURFACE absent, vide ou "console") reste EXACTEMENT celle
 *  déployée le 15/11 : invite système, noms et définitions des outils, libellés, base de connaissances et consignes de
 *  langue épinglés par empreinte SHA-256 (calculées sur le code déployé, AVANT la surface « site »), et forme de la
 *  réponse inchangée (tools = libellés, navigate, actions ; le champ `page` du site est ignoré).
 *  Lancer : cd services/copilot && npx tsx --test test/console-pin.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { COPILOT_SYSTEM, copilotFromEnv } from "../src/copilot";
import { TOOL_DEFS, DISPLAY, KB } from "../src/tools";
import { languageDirective } from "../src/i18n";
import { createCopilotApp, type Llm, type LlmRequest } from "../src/app";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Empreintes du copilote déployé le 15/11 (/opt/archive/src), relevées le 16/11 avant toute modification. */
const PIN = {
  system: "a22fb9664ffd8fb0713adc741907bde278b172ef27e9ce4037300795ab0855c1",
  systemLength: 5_465,
  toolNames: [
    "docs_search", "products_list", "products_get", "pricing_quote", "session_prepare_open", "snippet_generate",
    "receipt_verify", "enclaves_list", "sessions_list", "activity_list", "enclaves_status", "session_status", "bounty_list",
    "bounty_prepare_create", "operator_plan", "operator_prepare_bond", "operator_prepare_register", "product_scaffold",
    "inference_test", "machines_list", "machine_diagnostics", "ui_navigate",
  ],
  toolDefs: "089f53031d5e526fa6906747e9facd4a7e63c846eecd2809a137b3b24b76d512",
  oaiTools: "83df4798fb997bfcc77b44d1f307d155b58ecab6c2d498c447ad8e18b7325044",
  display: "7b3ea661af720733594ed05c52bde1c5ad1ed5f9ca3e650186455fe855f9cea4",
  // la base de connaissances porte depuis le 20/11 les prix avec leur unité et le gaz mesuré sur Arc
  kb: "da1596e578dc088b7ae7fe3a56783b1afe037dca42b205fa5d502d141e383340",
  langEn: "d6820f380519f72ea6d5f4da83757c5d39211de778b730c08a7cc74713868421",
  langFr: "dc3e07217c78f1839162130a0d93cbf877a0a7f40984b6913cac3404a9e4006a",
};

/** copilotFromEnv avec COPILOT_SURFACE = v (undefined : variable absente), sans clé de modèle ni pile externe. */
function fromEnv(v: string | undefined) {
  const keep = { s: process.env.COPILOT_SURFACE, k: process.env.OPENAI_API_KEY, d: process.env.DEPLOYMENTS };
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEPLOYMENTS;
  if (v === undefined) delete process.env.COPILOT_SURFACE; else process.env.COPILOT_SURFACE = v;
  try { return copilotFromEnv(); } finally {
    for (const [name, val] of [["COPILOT_SURFACE", keep.s], ["OPENAI_API_KEY", keep.k], ["DEPLOYMENTS", keep.d]] as const) {
      if (val === undefined) delete process.env[name]; else process.env[name] = val;
    }
  }
}

test("console : l'invite système est celle du 15/11, octet pour octet", () => {
  assert.equal(COPILOT_SYSTEM.length, PIN.systemLength);
  assert.equal(sha(COPILOT_SYSTEM), PIN.system);
  // le paragraphe qui pilote les pages de la console y est toujours
  assert.match(COPILOT_SYSTEM, /Tu PILOTES l'interface : tu vis dans une bulle en bas à droite du site/);
});

test("console : noms, définitions et libellés des outils, base de connaissances et consignes de langue épinglés", () => {
  assert.deepEqual(TOOL_DEFS.map((t) => t.name), PIN.toolNames);
  assert.equal(sha(JSON.stringify(TOOL_DEFS)), PIN.toolDefs);
  assert.equal(sha(JSON.stringify(DISPLAY)), PIN.display);
  assert.equal(sha(JSON.stringify(KB)), PIN.kb);
  assert.equal(sha(languageDirective("en")), PIN.langEn);
  assert.equal(sha(languageDirective("fr")), PIN.langFr);
});

test("COPILOT_SURFACE absent, vide ou « console » : la même invite, les mêmes outils, les mêmes libellés, aucune surface site", () => {
  for (const v of [undefined, "", "console", " Console "]) {
    const c = fromEnv(v);
    assert.equal(sha(c.options.system), PIN.system, String(v));
    assert.deepEqual(c.options.tools.map((t) => t.function.name), PIN.toolNames, String(v));
    assert.equal(sha(JSON.stringify(c.options.tools)), PIN.oaiTools, String(v));
    assert.equal(sha(JSON.stringify(c.options.display)), PIN.display, String(v));
    assert.equal((c.options as { site?: unknown }).site, undefined, String(v));
    assert.equal((c.options.health as Record<string, unknown>).surface, undefined, "le /health de la console ne change pas");
  }
});

// ---------------------------------------------------------------- forme de la réponse de la console

const SITE = "https://archive.62-171-153-35.sslip.io";
function scriptedLlm(script: (n: number, req: LlmRequest) => Awaited<ReturnType<Llm>>) {
  const calls: LlmRequest[] = [];
  const llm: Llm = async (req) => { calls.push({ ...req, messages: structuredClone(req.messages) }); return script(calls.length, req); };
  return { llm, calls };
}
const post = (app: ReturnType<typeof createCopilotApp>, body: unknown) => app.request("/chat", {
  method: "POST", headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify(body),
});

test("console : tools = libellés, navigate = page de la console, actions ; le champ `page` du site est ignoré", async () => {
  const run = async (body: Record<string, unknown>) => {
    const m = scriptedLlm((n) => (n === 1
      ? { content: null, tool_calls: [
        { id: "a", type: "function" as const, function: { name: "ui_navigate", arguments: '{"page":"primes"}' } },
        { id: "b", type: "function" as const, function: { name: "docs_search", arguments: '{"query":"prime"}' } },
      ] }
      : { content: "Voici les primes." }));
    const app = createCopilotApp({
      llm: m.llm, system: "SYSTÈME", tools: [], allowedOrigins: [SITE], rate: { perMinute: 20, perDay: 300, globalPerDay: 0 }, display: DISPLAY,
      executeTool: async (name) => ({ result: { navigated: name } }),
    });
    const res = await post(app, body);
    assert.equal(res.status, 200);
    return { j: await res.json() as Record<string, unknown>, system: String(m.calls[0]!.messages[0]!.content) };
  };
  const base = { messages: [{ role: "user", content: "montre-moi les primes" }], lang: "fr" };
  const plain = await run(base);
  assert.deepEqual(plain.j.tools, ["ui.navigate", "docs.search"]);
  assert.equal(plain.j.navigate, "primes");
  assert.deepEqual(plain.j.actions, []);
  assert.equal(plain.j.text, "Voici les primes.");
  // le contexte de page du site n'entre jamais dans l'invite de la console
  const withPage = await run({ ...base, page: { name: "use", query: "bounty", state: "green", kind: "bounty", section: "catalog" } });
  assert.equal(withPage.system, plain.system);
  assert.ok(!withPage.system.includes("The user is looking at"));
  assert.deepEqual(withPage.j, plain.j);
});
