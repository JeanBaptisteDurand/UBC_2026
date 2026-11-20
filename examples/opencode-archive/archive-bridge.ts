/**
 * archive-bridge.ts: OpenCode on ArcHive's private AI (local, 127.0.0.1 only). Started by ./opencode-archive.
 *
 * A local OpenAI-compatible endpoint (GET /v1/models, POST /v1/chat/completions, GET /health) that sends each chat
 * completion to ArcHive's pay-per-call inference product (product 3, Arc testnet) with the SDK's x402 client
 * (createX402Client): the enclave key is checked on Arc, the request is sealed to it (HPKE), ONE EIP-3009 authorization of
 * the exact on-chain price (0.01 USDC) is signed for THIS request, and the answer is returned only if the enclave's EIP-712
 * receipt verifies. The operator's registrar then settles the call on Arc (X402Settler, event CallSettled): the bridge
 * watches for that event and logs the settlement transaction.
 *
 * Tools: the enclave API takes text messages only (1-64 messages, <= 32 KB in clear, <= 1024 output tokens, no native
 * function calling, no streaming). With TOOLS=emulate (default) the bridge describes the client's tools in the system
 * message and turns a reply of the form <tool_call>{"name": ..., "arguments": {...}}</tool_call> into an OpenAI tool call;
 * the client (OpenCode) runs the tool on the user's machine and the result goes back to the enclave as text, in the next
 * sealed and paid call. TOOLS=off drops the tools (plain chat). stream:true is answered as server-sent events, in one
 * chunk, after the paid call returned (the enclave answers once, with the full completion).
 *
 * Logs: settlement status only (call number, timing, sizes, amount, receipt nonce, enclave, settlement tx). Never the
 * prompt, never the answer, never a key. The payer key is read from PAYER_KEY_FILE inside this process only.
 * PAYER=circle: the payer is a Circle developer-controlled wallet (EOA) instead of a local key: Circle signs each EIP-3009
 * authorization in its MPC (circle-signer.ts; files CIRCLE_ENV, CIRCLE_ENTITY_FILE, CIRCLE_WALLET_FILE). PAYER=key (default).
 *
 * Stack: DEPLOYMENTS_FILE, a deployments.*.testnet.json of the repository (./opencode-archive passes
 * deployments.v3.testnet.json, the live v3 stack), gives every contract address; without it, the SDK's built-in `testnet`
 * (the v2.1 stack) is used. ENCLAVE_URL must be an enclave registered on that stack, or the bridge stops at start-up.
 *
 * Any client: the endpoint is plain OpenAI chat completions, so any harness with a custom base URL can use it (README.md).
 *
 * Safety: 127.0.0.1 only; MAX_CALLS paid calls per run; MAX_AMOUNT per call (USDC base units); testnet only.
 * MOCK=1: no payment, no enclave: canned answers (one tool call, then text) to test a client's request shapes for free.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createPublicClient, createWalletClient, fallback, http, parseAbiItem, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, createX402Client, deploymentFromJson, testnet, X402CallError, X402ChallengeError, X402PaidCallError,
} from "@arcvault/sdk";
import { circleAccount } from "./circle-signer";

const env = process.env;
const MOCK = env.MOCK === "1";
const ENCLAVE = (env.ENCLAVE_URL ?? "").replace(/\/+$/, "");
const PRODUCT_ID = BigInt(env.PRODUCT_ID ?? "3");
const PORT = Number(env.PORT ?? 8789);
const MAX_CALLS = Number(env.MAX_CALLS ?? "30");
const MAX_AMOUNT = BigInt(env.MAX_AMOUNT ?? "10000"); // 0.01 USDC
const MODEL_ID = env.MODEL_ID ?? "gpt-oss-120b";
const TOOLS = (env.TOOLS ?? "emulate") === "off" ? "off" : "emulate";
const LOG = env.LOG_FILE ?? `${env.HOME}/.local/state/opencode-archive/logs/calls.jsonl`;
const CAPTURE = env.CAPTURE_FILE ?? ""; // MOCK only: write the last request body there (to study a client's shapes)
const MAX_PLAIN = Number(env.MAX_PLAIN_BYTES ?? "31500"); // the enclave refuses > 32768 bytes in clear (before payment)
const MAX_OUT = 1024; // the enclave's MAX_OUTPUT_TOKENS
const RPCS = (env.RPC_URLS ?? "https://rpc.testnet.arc.io,https://rpc.testnet.arc.network").split(",").map((s) => s.trim()).filter(Boolean);
// the stack's addresses: a deployment file of the repository (v3 from ./opencode-archive), else the SDK's `testnet` (v2.1)
const DEPLOYMENTS_FILE = env.DEPLOYMENTS_FILE ?? "";
const depFile = DEPLOYMENTS_FILE ? JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8")) : null;
const deployment = depFile ? deploymentFromJson(depFile) : testnet;
const STACK = depFile ? `v${String(depFile.version ?? "?")}` : "v2.1 (SDK default)";
if (!MOCK && !ENCLAVE) { console.error("ENCLAVE_URL required"); process.exit(1); }
const PAYER = env.PAYER === "circle" ? "circle" : "key";
if (!MOCK && PAYER === "key" && !env.PAYER_KEY_FILE) { console.error("PAYER_KEY_FILE required (or PAYER=circle)"); process.exit(1); }
mkdirSync(dirname(LOG), { recursive: true });

const chain = { ...arcTestnet, id: deployment.chainId };
const transport = fallback(RPCS.map((u) => http(u, { retryCount: 3, retryDelay: 800, timeout: 20_000 })));
const pub = createPublicClient({ chain, transport });
// PAYER=circle: a Circle wallet that signs only ReceiveWithAuthorization of USDC to the stack's X402Settler, <= MAX_AMOUNT
const circle = MOCK || PAYER !== "circle" ? null : await circleAccount({
  envFile: env.CIRCLE_ENV ?? `${env.HOME}/.config/archive-circle/circle.env`,
  entityFile: env.CIRCLE_ENTITY_FILE ?? `${env.HOME}/.config/archive-circle/entity.env`,
  walletFile: env.CIRCLE_WALLET_FILE ?? `${env.HOME}/.config/archive-circle/wallet.json`,
  allow: { chainId: deployment.chainId, usdc: deployment.usdc, to: deployment.x402Settler, maxValue: MAX_AMOUNT },
});
const account = MOCK ? null : circle ? circle.account : privateKeyToAccount(JSON.parse(readFileSync(env.PAYER_KEY_FILE as string, "utf8")).privateKey as Hex);
const ai = MOCK || !account ? null : createX402Client({
  enclaveUrl: ENCLAVE, productId: PRODUCT_ID, deployment, maxAmount: MAX_AMOUNT,
  walletClient: createWalletClient({ account, chain, transport }) as any, publicClient: pub as any,
});

const short = (h?: string) => (h && h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : String(h ?? ""));
const hhmmss = () => new Date().toISOString().slice(11, 19);
const say = (s: string) => console.log(`${hhmmss()}  ${s}`);
const log = (o: object) => { try { appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); } catch { /* logging never breaks a call */ } };

// ---------- OpenAI messages -> the enclave's text messages ----------
type Msg = { role: "system" | "user" | "assistant"; content: string };
function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p: any) => (typeof p === "string" ? p : p?.type === "text" ? String(p.text ?? "") : p?.type ? `[${p.type} omitted]` : ""))
      .filter((s) => s.length > 0).join("\n");
  }
  return c == null ? "" : JSON.stringify(c);
}
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const head = Math.floor(n * 0.7), tail = n - head;
  return `${s.slice(0, head)}\n[… ${s.length - n} characters cut by the bridge (enclave limit 32 KB) …]\n${s.slice(-tail)}`;
}
function argsOf(a: unknown): unknown {
  if (typeof a !== "string") return a ?? {};
  try { return JSON.parse(a); } catch { return a; }
}
function firstSentence(d: string, n: number): string {
  const one = d.replace(/\s+/g, " ").trim();
  const m = one.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : one;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function typeName(v: any): string {
  if (!v || typeof v !== "object") return "any";
  if (Array.isArray(v.enum)) return v.enum.map((e: unknown) => JSON.stringify(e)).join("|");
  if (v.type === "array") return `${typeName(v.items)}[]`;
  if (Array.isArray(v.type)) return v.type.join("|");
  if (v.anyOf) return v.anyOf.map(typeName).join("|");
  return String(v.type ?? "any");
}
function toolProtocol(tools: any[]): string {
  const lines = tools.filter((t) => t?.type === "function" && t.function?.name).map((t) => {
    const f = t.function, props = f.parameters?.properties ?? {}, req = new Set<string>(f.parameters?.required ?? []);
    const params = Object.entries(props).map(([k, v]) => `${k}${req.has(k) ? "*" : ""} (${typeName(v)})`).join(", ");
    return `- ${f.name}: ${firstSentence(String(f.description ?? ""), 160)} Arguments: ${params || "none"}.`;
  });
  return [
    "# OpenCode's tools",
    "You cannot call functions in this setup, and you cannot see the user's files until a tool shows them to you. To have OpenCode run a tool on the user's machine, write this single line as your whole reply, as plain text (no code fence, nothing before or after):",
    '<tool_call>{"name": "read", "arguments": {"filePath": "README.md"}}</tool_call>',
    "Put the tool you need and its arguments in place of read and its filePath. One tool per reply, then stop: OpenCode runs the tool and sends you its real output in the next message. Never write a tool's output yourself and never guess what a tool would return. When you have what you need, reply to the user normally, without the tag.",
    'Examples. List the files here: <tool_call>{"name": "glob", "arguments": {"pattern": "*"}}</tool_call> Read a file: <tool_call>{"name": "read", "arguments": {"filePath": "path/to/file.py"}}</tool_call>',
    "Tools (* = required argument):",
    ...lines,
  ].join("\n");
}
function toEnclave(body: any, tools: any[]): { messages: Msg[]; cutNote: string } {
  const sys: string[] = [];
  const conv: Msg[] = [];
  const names = new Map<string, string>();
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    const role = m?.role === "developer" ? "system" : m?.role;
    const text = textOf(m?.content);
    if (role === "system") {
      if (!text.trim()) continue;
      if (conv.length === 0) sys.push(text); else conv.push({ role: "user", content: `[system note]\n${text}` });
    } else if (role === "user") {
      if (text.trim()) conv.push({ role: "user", content: text });
    } else if (role === "assistant") {
      let t = text;
      for (const tc of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
        const name = String(tc?.function?.name ?? "tool");
        if (tc?.id) names.set(String(tc.id), name);
        t += `${t ? "\n" : ""}<tool_call>${JSON.stringify({ name, arguments: argsOf(tc?.function?.arguments) })}</tool_call>`;
      }
      if (t.trim()) conv.push({ role: "assistant", content: t });
    } else if (role === "tool") {
      const name = names.get(String(m?.tool_call_id ?? "")) ?? "tool";
      conv.push({ role: "user", content: `Output of the ${name} tool, run by OpenCode:\n${cut(text || "(empty)", 6000)}` });
    }
  }
  let system = sys.join("\n\n");
  if (tools.length > 0) system = `${system}${system ? "\n\n" : ""}${toolProtocol(tools)}`;
  // fit the enclave's limits: <= 64 messages, <= MAX_PLAIN bytes of JSON in clear
  const size = (ms: Msg[]) => Buffer.byteLength(JSON.stringify(ms), "utf8");
  const build = () => (system ? [{ role: "system" as const, content: system }, ...conv] : [...conv]);
  let cutNote = "";
  while (conv.length > 63) { conv.shift(); cutNote = "older messages dropped"; }
  for (let i = 0; i < conv.length - 1 && size(build()) > MAX_PLAIN; i++) {
    if (conv[i].content.startsWith("Output of the ") && conv[i].content.length > 1200) { conv[i] = { ...conv[i], content: cut(conv[i].content, 1200) }; cutNote = "old tool results shortened"; }
  }
  while (conv.length > 1 && size(build()) > MAX_PLAIN) { conv.shift(); cutNote = "older messages dropped"; }
  if (conv.length > 0 && conv[0].role === "assistant") conv.unshift({ role: "user", content: "[earlier messages omitted by the bridge]" });
  if (size(build()) > MAX_PLAIN && system.length > 4000) { system = cut(system, Math.max(4000, system.length - (size(build()) - MAX_PLAIN) - 200)); cutNote = "system prompt shortened"; }
  if (conv.length === 1 && size(build()) > MAX_PLAIN) { conv[0] = { ...conv[0], content: cut(conv[0].content, Math.max(2000, conv[0].content.length - (size(build()) - MAX_PLAIN) - 200)) }; cutNote = "last message shortened"; }
  return { messages: build(), cutNote };
}

// ---------- the model's text -> an OpenAI tool call ----------
function scanObject(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}
function parseToolCall(text: string, names: Set<string>): { before: string; name: string; args: unknown } | null {
  let at = text.indexOf("<tool_call>"), before = "";
  let start = -1;
  if (at >= 0) { start = text.indexOf("{", at); before = text.slice(0, at); }
  else {
    const m = /\{\s*"name"\s*:\s*"[A-Za-z0-9_.\-]+"\s*,\s*"(arguments|parameters)"\s*:/.exec(text);
    if (!m) return null;
    start = m.index; before = text.slice(0, m.index).replace(/```(json)?\s*$/i, "");
  }
  if (start < 0) return null;
  const raw = scanObject(text, start);
  if (!raw) return null;
  let o: any;
  try { o = JSON.parse(raw); } catch { return null; }
  let name = String(o?.name ?? o?.tool ?? o?.function?.name ?? "");
  let args = o?.arguments ?? o?.parameters ?? o?.args ?? {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  if (!args || typeof args !== "object") args = {};
  if (!names.has(name)) {
    // common names the model may use for OpenCode's tools (OpenCode 1.18: bash, edit, glob, grep, read, write)
    const alias: Record<string, string> = { list: "glob", ls: "glob", list_files: "glob", read_file: "read", cat: "read", shell: "bash", run: "bash", search: "grep" };
    const to = alias[name];
    if (!to || !names.has(to)) return null;
    if (to === "glob" && !args.pattern) args = { pattern: "*", ...(args.path ? { path: args.path } : {}) };
    if (to === "read" && !args.filePath && (args.path || args.file)) args = { filePath: args.path ?? args.file };
    name = to;
  }
  return { before: before.trim(), name, args };
}

// ---------- settlement watcher: CallSettled(productId, payer, operator, amount, nonce) on X402Settler ----------
const CALL_SETTLED = parseAbiItem("event CallSettled(uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce)");
const pending = new Map<string, { call: number; answeredAt: number; fromBlock: bigint }>();
let watching = false;
async function watchSettlements() {
  if (watching || pending.size === 0 || !account) return;
  watching = true;
  try {
    const latest = await pub.getBlockNumber();
    let from = latest;
    for (const p of pending.values()) if (p.fromBlock < from) from = p.fromBlock;
    const logs = await pub.getLogs({ address: deployment.x402Settler, event: CALL_SETTLED, args: { productId: PRODUCT_ID, payer: account.address }, fromBlock: from, toBlock: latest });
    for (const l of logs) {
      const n = String((l as any).args?.nonce ?? "").toLowerCase();
      const p = pending.get(n);
      if (!p) continue;
      pending.delete(n);
      const afterS = Math.round((Date.now() - p.answeredAt) / 1000);
      log({ event: "settled", call: p.call, nonce: n, tx: l.transactionHash, block: String(l.blockNumber), amountUsdc: Number((l as any).args?.amount ?? 0n) / 1e6, operator: (l as any).args?.operator, afterS });
      say(`call #${p.call}  SETTLED on Arc: CallSettled tx ${l.transactionHash}  block ${l.blockNumber}  (${afterS} s after the answer)`);
    }
    for (const [n, p] of pending) {
      if (Date.now() - p.answeredAt > 240_000) {
        pending.delete(n);
        log({ event: "not_settled_yet", call: p.call, nonce: n, waitedS: 240 });
        say(`call #${p.call}  not settled after 240 s (the operator's registrar may still settle it; nonce ${short(n)})`);
      }
    }
  } catch (e: any) {
    say(`settlement watch: RPC error (${String(e?.shortMessage ?? e?.message ?? e).slice(0, 90)}), retrying`);
  } finally { watching = false; }
}
setInterval(() => { void watchSettlements(); }, 4000).unref();

// ---------- the enclave serves at most PENDING_LIMIT unsettled calls per payer (MAX_PENDING_PER_PAYER, 3 by default) ----------
const PENDING_LIMIT = Number(env.PENDING_LIMIT ?? "3");
let inFlight = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForRoom(call: number) {
  const t = Date.now();
  let said = false;
  while (pending.size + inFlight >= PENDING_LIMIT && Date.now() - t < 60_000) {
    if (!said) { say(`call #${call}  waits: ${pending.size} earlier call(s) not settled on Arc yet (the enclave serves at most ${PENDING_LIMIT} unsettled calls per payer)`); said = true; }
    await sleep(2000);
    await watchSettlements();
  }
}
async function paidCreate(call: number, messages: Msg[], opts: object) {
  for (let attempt = 0; ; attempt++) {
    await waitForRoom(call);
    inFlight++;
    try {
      return await ai!.chat.completions.create({ messages, ...opts } as any);
    } catch (e: any) {
      if (attempt < 2 && e instanceof X402PaidCallError && String((e as any).code) === "payer_pending_limit") {
        say(`call #${call}  the enclave asks to wait for earlier settlements (payer_pending_limit): nothing served, nothing owed; retrying`);
        await sleep(5000);
        continue;
      }
      throw e;
    } finally { inFlight--; }
  }
}

// ---------- HTTP ----------
let paidCalls = 0;
const failures = new Map<string, number>(); // request hash -> failed paid attempts (a client retrying the same request)
const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, mock: MOCK, stack: STACK, enclaveRegistry: deployment.enclaveRegistry, payer: account?.address ?? null, payerMode: PAYER, product: PRODUCT_ID.toString(), enclave: ENCLAVE || null, model: MODEL_ID, tools: TOOLS, paidCalls, maxCalls: MAX_CALLS, settlementsPending: pending.size }));
app.get("/v1/models", (c) => c.json({ object: "list", data: [{ id: MODEL_ID, object: "model", owned_by: "archive-x402" }] }));
app.post("/v1/chat/completions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const tools = TOOLS === "emulate" && Array.isArray(body.tools) ? body.tools.filter((t: any) => t?.type === "function" && t.function?.name) : [];
  const toolNames = new Set<string>(tools.map((t: any) => String(t.function.name)));
  const { messages, cutNote } = toEnclave(body, tools);
  const bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
  const reqKey = createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  const reqMax = Number.isSafeInteger(body.max_tokens) ? body.max_tokens : Number.isSafeInteger(body.max_completion_tokens) ? body.max_completion_tokens : MAX_OUT;
  const maxTokens = Math.min(MAX_OUT, Math.max(1, reqMax));
  const t0 = Date.now();
  const model = body.model ?? MODEL_ID;
  const created = Math.floor(t0 / 1000);
  if (messages.length === 0 || !messages.some((m) => m.role === "user")) return c.json({ error: { message: "no user message to send", type: "invalid_request_error" } }, 400);

  let text: string, usage: any, x_arc: any, id: string, nonce: string | undefined;
  if (MOCK) {
    if (CAPTURE) { try { writeFileSync(CAPTURE, JSON.stringify(body, null, 1)); } catch { /* ignore */ } }
    const last = messages[messages.length - 1];
    const listTool = ["list", "glob", "bash"].find((n) => toolNames.has(n));
    text = last.content.startsWith("Output of the ") || !listTool
      ? `MOCK answer (no payment): ${messages.length} messages, ${bytes} bytes in clear, ${tools.length} tools described.`
      : listTool === "glob" ? '<tool_call>{"name": "glob", "arguments": {"pattern": "*"}}</tool_call>'
        : listTool === "list" ? '<tool_call>{"name": "list", "arguments": {"path": "."}}</tool_call>'
          : '<tool_call>{"name": "bash", "arguments": {"command": "ls", "description": "List files"}}</tool_call>';
    usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    x_arc = { mock: true };
    id = `mock-${t0}`;
    log({ mock: true, stream: !!body.stream, msgs: messages.length, bytes, tools: tools.length, toolNames: [...toolNames], maxTokensAsked: body.max_tokens ?? body.max_completion_tokens ?? null, extraKeys: Object.keys(body).filter((k) => !["model", "messages", "stream", "tools", "tool_choice", "max_tokens", "temperature"].includes(k)), cutNote });
    say(`MOCK call: ${messages.length} msgs, ${bytes} B in clear, ${tools.length} tools${cutNote ? `, ${cutNote}` : ""}`);
  } else {
    if ((failures.get(reqKey) ?? 0) >= 2) {
      say("identical request already failed twice: refused BEFORE payment (nothing signed)");
      return c.json({ error: { message: "ArcHive bridge: this identical request already failed twice; refused before payment. Rephrase or start a new session.", type: "invalid_request_error" } }, 400);
    }
    if (paidCalls >= MAX_CALLS) return c.json({ error: { message: `ArcHive bridge budget reached (${MAX_CALLS} paid calls this run). Restart the bridge (./opencode-archive stop) to reset it.`, type: "insufficient_quota" } }, 402);
    paidCalls++;
    const call = paidCalls;
    try {
      const opts = { max_tokens: maxTokens, ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}) };
      let r = await paidCreate(call, messages, opts);
      if (tools.length > 0 && !parseToolCall(r.text ?? "", toolNames) && /^\s*(\[tool result|output of the \w+ tool)/i.test(r.text ?? "") && paidCalls < MAX_CALLS) {
        // the model wrote a tool's output itself instead of asking for the tool: one corrective call (paid, logged)
        log({ ok: true, call, kind: "faked_tool_output", ms: Date.now() - t0, ...{ nonce: r.receipt.nonce } });
        pending.set(r.receipt.nonce.toLowerCase(), { call, answeredAt: Date.now(), fromBlock: BigInt(r.receipt.anchorBlock) - 5n });
        say(`call #${call}  paid 0.01 USDC, but the model faked a tool output: one corrective call`);
        paidCalls++;
        r = await paidCreate(call, [...messages, { role: "assistant", content: String(r.text).slice(0, 300) }, { role: "user", content: "That was not a real tool output: you wrote it yourself. Reply now with only the <tool_call> line for the tool you need." }], opts);
      }
      text = r.text ?? "";
      nonce = r.receipt.nonce;
      usage = { prompt_tokens: r.usage?.prompt_tokens ?? 0, completion_tokens: r.usage?.completion_tokens ?? 0, total_tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0) };
      x_arc = {
        product: PRODUCT_ID.toString(), payer: account!.address, enclave: r.signer, operator: r.operator, amountUsdc: Number(r.amount) / 1e6,
        nonce: r.receipt.nonce, requestHash: r.requestHash, responseHash: r.receipt.responseHash, anchorBlock: r.receipt.anchorBlock.toString(),
        settleable: r.settleable, replay: r.replay,
      };
      id = `x402-${r.receipt.nonce.slice(2, 18)}`;
      const ms = Date.now() - t0;
      let fromBlock = 0n;
      try { fromBlock = (await pub.getBlockNumber()) - 20n; } catch { fromBlock = BigInt(r.receipt.anchorBlock) ; }
      pending.set(r.receipt.nonce.toLowerCase(), { call, answeredAt: Date.now(), fromBlock });
      const tc = tools.length > 0 ? parseToolCall(text, toolNames) : null;
      log({ ok: true, call, ms, stream: !!body.stream, msgs: messages.length, bytes, tools: tools.length, reply: tc ? `tool_call:${tc.name}` : "text", cutNote: cutNote || undefined, usage, ...x_arc });
      say(`call #${call}  sealed to enclave ${short(r.signer)} (key checked on Arc)  paid ${Number(r.amount) / 1e6} USDC  receipt verified  ${(ms / 1000).toFixed(1)} s  -> ${tc ? `tool call: ${tc.name}` : "answer"}${cutNote ? `  [${cutNote}]` : ""}`);
    } catch (e: any) {
      const base = { ok: false, call, ms: Date.now() - t0, stream: !!body.stream, msgs: messages.length, bytes, error: String(e?.en ?? e?.message ?? e).slice(0, 300) };
      if (e instanceof X402PaidCallError) {
        const code = String((e as any).code ?? "");
        log({ ...base, kind: "paid_call_error", code, nonce: (e as any).pending?.nonce });
        say(`call #${call}  no verified answer (${code}): not settled unless the enclave signed a receipt`);
        failures.set(reqKey, (failures.get(reqKey) ?? 0) + 1);
        return c.json({ error: { message: `ArcHive: no verified answer from the enclave (${code}). Try again or rephrase.`, type: "invalid_request_error", code } }, 400);
      }
      if (e instanceof X402CallError || e instanceof X402ChallengeError) {
        paidCalls--; // refused before any payment: nothing signed, nothing owed
        const st = (e as any).status;
        log({ ...base, kind: e instanceof X402CallError ? "refused_before_payment" : "challenge_refused", status: st, code: (e as any).code ?? (e as any).reason });
        say(`call #${call}  refused BEFORE payment (${st ?? ""} ${(e as any).code ?? (e as any).reason ?? ""}): nothing signed`);
        return c.json({ error: { message: `ArcHive refused before payment: ${e?.en ?? e.message}`, type: st === 413 ? "request_too_large" : "invalid_request_error" } }, st === 413 ? 413 : 400);
      }
      log({ ...base, kind: "other" });
      say(`call #${call}  error: ${String(e?.en ?? e?.message ?? e).slice(0, 120)}`);
      failures.set(reqKey, (failures.get(reqKey) ?? 0) + 1);
      return c.json({ error: { message: `ArcHive bridge: ${String(e?.en ?? e?.message ?? e)}`, type: "invalid_request_error" } }, 400);
    }
  }

  const tc = tools.length > 0 ? parseToolCall(text, toolNames) : null;
  const toolCall = tc ? { id: `call_${(nonce ?? id).replace(/^0x/, "").slice(0, 16)}`, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } } : null;
  const content = tc ? tc.before : text;
  const finish = tc ? "tool_calls" : "stop";
  const headers: Record<string, string> = nonce ? { "x-arc-receipt-nonce": nonce } : {};
  if (body.stream) {
    const chunk = (o: object) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, ...o })}\n\n`;
    let sse = chunk({ choices: [{ index: 0, delta: { role: "assistant", content: content ?? "" }, finish_reason: null }] });
    if (toolCall) sse += chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }] });
    sse += chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage, x_arc });
    sse += "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers } });
  }
  const message: any = { role: "assistant", content: content || (toolCall ? null : "") };
  if (toolCall) message.tool_calls = [toolCall];
  return c.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: finish }], usage, x_arc }, 200, headers);
});

if (ai && account) {
  const keys = await ai.verifiedKeys();
  const p = await ai.product();
  say(`ArcHive bridge: stack ${STACK} | payer ${account.address}${circle ? " (Circle developer-controlled wallet, EOA: Circle signs each authorization)" : ""} | product #${p.id} | ${Number(p.pricePerCall) / 1e6} USDC per call | settlement ${p.settlement}`);
  say(`enclave key verified on Arc (EnclaveRegistry ${deployment.enclaveRegistry}): ${keys.signer} (operator ${keys.operator}) at ${ENCLAVE}`);
} else {
  say("ArcHive bridge in MOCK mode: no enclave, no payment");
}
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
say(`OpenAI-compatible endpoint: http://127.0.0.1:${PORT}/v1 (model ${MODEL_ID}, tools ${TOOLS}, at most ${MAX_CALLS} paid calls)`);
