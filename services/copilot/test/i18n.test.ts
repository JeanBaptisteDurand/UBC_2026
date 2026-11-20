/** i18n.test.ts — the copilot's language: the body's `lang` field, otherwise the language of the user's last message,
 *  otherwise Accept-Language, otherwise English; answers, refusals, action messages and page names in that language.
 *  SIMULATED model, no network call. Run: cd services/copilot && npx tsx --test test/i18n.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { createCopilotApp, intentNav, modelFailure, type Llm, type LlmRequest, type CopilotAppOptions } from "../src/app";
import { parseChatRequest } from "../src/guard";
import {
  BUTTONS, PAGES, detectLang, langFromAcceptLanguage, languageDirective, parseLang, resolveLang, userTextsOf,
} from "../src/i18n";

const SITE = "https://archive.62-171-153-35.sslip.io";

function scriptedLlm(script: (n: number, req: LlmRequest) => Awaited<ReturnType<Llm>>) {
  const calls: LlmRequest[] = [];
  const llm: Llm = async (req) => { calls.push({ ...req, messages: structuredClone(req.messages) }); return script(calls.length, req); };
  return { llm, calls };
}
function makeApp(over: Partial<CopilotAppOptions> = {}, llm?: Llm | null) {
  return createCopilotApp({
    llm: llm === undefined ? (async () => ({ content: "ok" })) : llm,
    system: "SYSTÈME",
    tools: [{ type: "function", function: { name: "docs_search", parameters: { type: "object", properties: {} } } }],
    executeTool: async (name) => ({ result: { ok: true, name } }),
    allowedOrigins: [SITE],
    rate: { perMinute: 1_000, perDay: 10_000, globalPerDay: 0 },
    ...over,
  });
}
let ip = 0;
function post(app: ReturnType<typeof makeApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": `203.0.113.${ip++ % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const sys = (req: LlmRequest) => String(req.messages[0]!.content);

test("parseLang, Accept-Language: only the supported languages; the strongest preference first", () => {
  for (const [x, l] of [["en", "en"], ["EN", "en"], ["en-US", "en"], ["fr_FR", "fr"], [" fr ", "fr"]] as const) assert.equal(parseLang(x), l);
  for (const x of ["de", "", "english", "français", 3, null, undefined, {}]) assert.equal(parseLang(x), undefined, String(x));
  assert.equal(langFromAcceptLanguage("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"), "fr");
  assert.equal(langFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.5"), "en");
  assert.equal(langFromAcceptLanguage("en;q=0.3, fr;q=0.8"), "fr");
  assert.equal(langFromAcceptLanguage("fr;q=0"), undefined);
  assert.equal(langFromAcceptLanguage("*"), undefined);
  assert.equal(langFromAcceptLanguage(undefined), undefined);
});

test("detection: the site's questions in both languages; nothing conclusive → undefined", () => {
  for (const q of ["Show me the enclave hive", "Which products, at what price?", "I want to run a private inference", "How do I post a bounty?",
    "here is my private key, not the tx hash", "What's the hive?", "Can you explain how the bond works?"]) assert.equal(detectLang(q), "en", q);
  for (const q of ["Montre-moi la ruche des enclaves", "Quels produits, à quel prix ?", "Je veux lancer une inférence privée",
    "Comment publier une prime ?", "salut", "bonjour", "c'est quoi la ruche ?", "Voici ma clé privée (pas l'adresse publique)"]) assert.equal(detectLang(q), "fr", q);
  for (const q of ["ok", "x", "1", "q0", "0x1234", "session", "wallet ?"]) assert.equal(detectLang(q), undefined, q);
});

test("resolution: requested lang > the user's last message (going back) > Accept-Language > English", () => {
  assert.equal(resolveLang({ requested: "fr", userTexts: ["Show me the hive"], acceptLanguage: "en" }), "fr");
  assert.equal(resolveLang({ requested: "xx", userTexts: ["Montre-moi la ruche"] }), "fr");
  assert.equal(resolveLang({ userTexts: ["ok", "Show me the hive"], acceptLanguage: "fr" }), "en", "on remonte au dernier message concluant");
  assert.equal(resolveLang({ userTexts: ["ok"], acceptLanguage: "fr-FR" }), "fr");
  assert.equal(resolveLang({ userTexts: ["ok"] }), "en", "English is the default language");
  assert.deepEqual(userTextsOf({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "system", content: "c" }, { role: "user", content: 4 }, { role: "user", content: "d" }] }), ["d", "a"]);
  assert.deepEqual(userTextsOf(null), []);
});

test("language directive: English enforced, the exact English labels of pages and buttons; French: formal address and French labels", () => {
  const en = languageDirective("en");
  assert.match(en, /ENGLISH/);
  for (const name of [...Object.values(PAGES.en), ...BUTTONS.en]) assert.ok(en.includes(name), name);
  assert.ok(en.includes("Keys & sessions [cles]") && en.includes("Private AI [playground]"));
  assert.ok(!en.includes("Clés et sessions"));
  const fr = languageDirective("fr");
  assert.match(fr, /FRANÇAIS/);
  assert.match(fr, /Vouvoie/);
  for (const name of [...Object.values(PAGES.fr), ...BUTTONS.fr]) assert.ok(fr.includes(name), name);
});

test("lang \"en\": the English directive comes LAST in the prompt, even for a question in French", async () => {
  const m = scriptedLlm(() => ({ content: "Here is the Hive." }));
  const app = makeApp({}, m.llm);
  const j = await (await post(app, { messages: [{ role: "user", content: "Montre-moi la ruche" }], lang: "en" })).json() as any;
  assert.equal(j.text, "Here is the Hive.");
  const s = sys(m.calls[0]!);
  assert.match(s, /^SYSTÈME/);
  assert.ok(s.trimEnd().endsWith(languageDirective("en").trimEnd()), "English instruction at the end");
  assert.equal(j.navigate, "ruche");
  // without lang: the last message's language
  await post(app, { messages: [{ role: "user", content: "Show me the hive" }] });
  assert.ok(sys(m.calls.at(-1)!).endsWith(languageDirective("en")));
  await post(app, { messages: [{ role: "user", content: "Montre-moi la ruche" }] });
  assert.ok(sys(m.calls.at(-1)!).endsWith(languageDirective("fr")));
});

test("refusals in the language: body read (lang, then message); before the body: Accept-Language, else English; every refusal has a code", async () => {
  const app = makeApp();
  // invalid conversation, lang requested
  let j = await (await post(app, { messages: [{ role: "system", content: "x" }, { role: "user", content: "salut" }], lang: "en" })).json() as any;
  assert.equal(j.code, "bad_conversation");
  assert.match(j.text, /^Request refused: message 0: role “system” refused/);
  // conversation invalide, langue du message
  j = await (await post(app, { messages: [{ role: "user", content: "Show me the hive" }, { role: "assistant", content: "…" }] })).json() as any;
  assert.match(j.text, /^Request refused: the last message must come from the user\.$/);
  j = await (await post(app, { messages: [{ role: "user", content: "Montre-moi la ruche" }, { role: "assistant", content: "…" }] })).json() as any;
  assert.match(j.text, /^Requête refusée : le dernier message doit venir de l'utilisateur\.$/);
  // avant le corps : Accept-Language, sinon anglais
  const big = { messages: [{ role: "user", content: "x".repeat(70_000) }] };
  j = await (await post(app, big)).json() as any;
  assert.equal(j.code, "too_large");
  assert.match(j.error, /request too large \(64 KiB at most\)/);
  j = await (await post(app, big, { "accept-language": "fr-FR,fr;q=0.9" })).json() as any;
  assert.match(j.error, /64 Kio au plus/);
  const evil = await post(app, { messages: [{ role: "user", content: "x" }] }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json() as any).code, "origin_refused");
  assert.equal((await (await post(app, "x", { "content-type": "text/plain" })).json() as any).code, "json_only");
  assert.equal((await (await post(app, "{pas du json")).json() as any).code, "bad_json");
  // rate limit, then global cap, in English with no hint
  const tight = makeApp({ rate: { perMinute: 1, perDay: 300, globalPerDay: 0 } });
  await post(tight, { messages: [{ role: "user", content: "1" }] }, { "x-forwarded-for": "198.18.0.1" });
  const r = await post(tight, { messages: [{ role: "user", content: "2" }] }, { "x-forwarded-for": "198.18.0.1" });
  assert.equal(r.status, 429);
  j = await r.json() as any;
  assert.equal(j.code, "rate_minute");
  assert.match(j.text, /too many questions in a row/);
  const capped = makeApp({ rate: { perMinute: 100, perDay: 300, globalPerDay: 1 } });
  await post(capped, { messages: [{ role: "user", content: "1" }] });
  const g = await post(capped, { messages: [{ role: "user", content: "2" }], lang: "en" });
  assert.equal(g.status, 429);
  assert.ok(Number(g.headers.get("retry-after")) >= 1);
  j = await g.json() as any;
  assert.equal(j.code, "global_cap");
  assert.match(j.text, /daily request cap/);
});

test("action, fallback and error messages in the language; English punctuation with no space before \"! ? :\"", async () => {
  // prepared action and empty text: the action message
  let n = 0;
  const m = scriptedLlm(() => (n++ === 0
    ? { content: null, tool_calls: [{ id: "a", type: "function" as const, function: { name: "session_prepare_open", arguments: '{"productId":"1","deposit":"1"}' } }] }
    : { content: "" }));
  const app = makeApp({}, m.llm);
  let j = await (await post(app, { messages: [{ role: "user", content: "Open a session" }], lang: "en" })).json() as any;
  assert.equal(j.text, "I prepared the action below: check it, then sign with your wallet. Nothing is spent without your signature.");
  assert.equal(j.actions.length, 1);
  // retry of an empty answer: the instruction to the model in that language
  assert.match(String(m.calls[2]!.messages.at(-1)!.content), /in English/);
  // page seule
  const p = makeApp({}, async () => ({ content: "" }));
  j = await (await post(p, { messages: [{ role: "user", content: "Show me the hive" }] })).json() as any;
  assert.equal(j.text, "Here is the relevant page.");
  assert.equal(j.navigate, "ruche");
  // no model key
  j = await (await post(makeApp({}, null), { messages: [{ role: "user", content: "x" }], lang: "en" })).json() as any;
  assert.equal(j.text, "No OPENAI_API_KEY configured.");
  // provider error: a generic message in English, same code
  const failing = makeApp({ log: () => {} }, async () => { throw Object.assign(new Error("sk-proj-SECRET"), { status: 503 }); });
  j = await (await post(failing, { messages: [{ role: "user", content: "hello" }] })).json() as any;
  assert.equal(j.code, "modele_503");
  assert.match(j.text, /^The model provider has an outage right now.*\(code modele_503\)$/);
  assert.equal(modelFailure({ name: "TimeoutError" }, "en").code, "modele_delai");
  assert.match(modelFailure({ name: "TimeoutError" }, "en").text, /didn't answer in time/);
  assert.match(modelFailure({ name: "TimeoutError" }).text, /n'a pas répondu à temps/, "default unchanged: French");
  // typographie
  const t = makeApp({}, async () => ({ content: "Hello ! Ready ? Note : yes ." }));
  assert.equal((await (await post(t, { messages: [{ role: "user", content: "hi" }], lang: "en" })).json() as any).text, "Hello! Ready? Note: yes.");
  assert.equal((await (await post(t, { messages: [{ role: "user", content: "salut" }], lang: "fr" })).json() as any).text, "Hello ! Ready ? Note : yes.");
});

test("fallback navigation: requests in English lead to the same pages as French ones", () => {
  const cases: Array<[string, string]> = [
    ["Show me the enclave hive", "ruche"], ["How do I post a bounty?", "publier-prime"], ["Which products, at what price?", "produits"],
    ["I want to run a private inference", "playground"], ["I want to become an operator", "operateur"], ["Where are the SDK docs?", "developpeurs"],
    ["Bring USDC from Base to Arc", "portefeuille"], ["Create an access key", "cles"], ["Show me the overview", "vue"],
    ["Hunt a bounty", "primes"], ["Publish my own service", "publier-produit"], ["What is my balance?", "portefeuille"],
    ["Montre-moi la ruche", "ruche"], ["Comment publier une prime ?", "publier-prime"], ["je veux louer ma machine", "operateur"],
  ];
  for (const [q, page] of cases) assert.equal(intentNav(q), page, q);
});

test("parseChatRequest: errors in English on request, in French by default", () => {
  const bad = { messages: [{ role: "tool", content: "x" }, { role: "user", content: "y" }] };
  const en = parseChatRequest(bad, undefined, "en");
  const fr = parseChatRequest(bad);
  assert.ok(!en.ok && /only user and assistant are accepted/.test(en.error));
  assert.ok(!fr.ok && /seuls user et assistant sont acceptés/.test(fr.error));
});

test("/health: languages served; no encrypted conversation outside an enclave", async () => {
  const j = await (await makeApp().request("/health")).json() as any;
  assert.deepEqual(j.languages, ["en", "fr"]);
  assert.equal(j.sealed, null);
});
