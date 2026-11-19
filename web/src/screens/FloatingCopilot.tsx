/** FloatingCopilot.tsx — the copilot bubble (AskHive), on every page.
 *  Two copilots, never mixed silently:
 *  - the ATTESTED copilot (if configured: config.ts, ATTESTED_COPILOT): its key is verified on Arc by reading Arc's RPC
 *    directly, the conversation goes encrypted to its enclave and the reply comes back sealed (SDK,
 *    createAttestedCopilotClient). An authenticated reply (authenticated === true) carries the "attested copilot ·
 *    verified on Arc" badge, with a link to the enclave's registration on the explorer; a clear-text refusal (with no
 *    proof of origin) is described by a LOCAL message drawn from its code, never by the relay's text;
 *  - the SERVER copilot (VITE_COPILOT_URL), in clear text: each reply is labelled "server copilot (not attested)" as
 *    soon as the attested copilot exists.
 *  If the key does not verify, if the enclave does not answer or if its reply does not open: an explicit message, then
 *  the VISIBLE fallback to the server copilot (banner, label on each reply). The question that failed is never sent to
 *  the server without a click, and the server never receives the attested part of the conversation.
 *  Actions to sign proposed by either one go through the verification card (CopilotActions.tsx). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ExternalLink, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import type { Address, Hex } from "viem";
import type { AttestedCopilotClient, VerifiedCopilot } from "@arcvault/sdk";
import { ATTESTED_COPILOT, COPILOT_URL } from "../config";
import { DCAP } from "../arc";
import { makeAttestedCopilot, registrationTx, stripCitations } from "../copilot";
import { wrongOperatorOf } from "../errors";
import { Badge, Mono, addrLink, short, txLink } from "../ui";
import { getLang, t, type Lang, type StaticKey } from "../i18n";
import { errorMsg, msg, show, type Msg as Note } from "../msg";
import { toEnglish } from "../i18n/sdk-messages.en";
import { isKnownPage, resolveRoute, routeLabel, type RouteId } from "../routes";
import { ActionCard, type CopilotAction } from "./CopilotActions";

/** Where a reply comes from (or where a question went): the attested enclave, or the server in clear text. */
type Via = "attested" | "server";
/** The verified enclave that sealed a reply (only if authenticated === true). */
interface SealedBy { signer: Address; operator: Address; fromBlock: bigint }

/** A bubble message. `local`: written by the site (server unreachable, request refused, fallback), never sent back to
 *  the copilot as if it came from it: its text is a message (`note`), put into words at display time. The copilot's text
 *  is kept as it came; its known sentences are translated at display time (serverText). `navTab`: the page opened by
 *  the copilot (its name is read at display time). Everything therefore follows the language switch. `retry`: the
 *  question the attested copilot could not take (sending it to the server takes a click). `plain`: clear-text refusal. */
interface Msg {
  role: "user" | "assistant"; content: string; tools?: string[]; citations?: string[]; navTab?: RouteId; actions?: CopilotAction[];
  local?: boolean; note?: Note; via: Via; sealedBy?: SealedBy; retry?: string; plain?: boolean;
}

/** Tool used by the copilot → the site page to show (a fallback when the server does not return `navigate`).
 *  The bot "drives the front end": when it does something, it takes you to the page concerned. */
const TOOL_TO_TAB: Record<string, RouteId> = {
  products_list: "produits", products_get: "produits", pricing_quote: "produits",
  enclaves_list: "ruche", enclaves_status: "ruche",
  session_prepare_open: "playground", session_status: "cles", receipt_verify: "cles",
  snippet_generate: "developpeurs",
  bounty_list: "primes", bounty_prepare_create: "publier-prime",
  machines_list: "operateur", machine_diagnostics: "operateur", operator_plan: "operateur",
  operator_prepare_bond: "operateur", operator_prepare_register: "operateur",
  product_scaffold: "publier-produit",
};

/** The server's limits (services/copilot, guard.ts): it keeps the last 20 messages and refuses a body over 64 KiB (413).
 *  So the bubble sends only the last 20, and removes the oldest if the body exceeds 60 KiB. */
const MAX_MESSAGES = 20;
const MAX_BODY_BYTES = 60 * 1024;

/** The body of the server copilot's POST /chat: the latest messages SENT TO THE SERVER (never the attested part of the
 *  conversation, nor the site's messages), the connected wallet and the chosen language. */
function chatBody(history: Msg[], user: string | null, lang: Lang): string {
  let messages = history.filter((m) => !m.local && m.via === "server").slice(-MAX_MESSAGES).map(({ role, content }) => ({ role, content }));
  const enc = new TextEncoder();
  let body = JSON.stringify({ messages, user, lang });
  while (messages.length > 1 && enc.encode(body).length > MAX_BODY_BYTES) {
    messages = messages.slice(1);
    body = JSON.stringify({ messages, user, lang });
  }
  return body;
}

const SUGGEST: StaticKey[] = ["copilot.s1", "copilot.s2", "copilot.s3", "copilot.s4"];

/** Text from a copilot (attested or server), at display time: without the model's raw citation marks (【…】, its
 *  sources are in the "sources" line); as is in French; in English, its known sentences (refusals, fallbacks) are
 *  translated. */
const serverText = (s: string): string => {
  const x = stripCitations(s);
  return getLang() === "en" ? toEnglish(x) : x;
};

/** Bold (**…**) and code (`…`) in replies, rendered instead of showing the raw asterisks and backticks (the rest of the
 *  text, line breaks included, stays as is: never any HTML from the model). */
function rich(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let last = 0, k = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={k++}>{m[1]}</strong> : <code key={k++} className="rounded bg-ink/40 px-1 font-mono text-[12px]">{m[2]}</code>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** A fetch that got no response (offline, DNS, CORS, server stopped), or that timed out. */
const isNetwork = (e: any) => /^(Failed to fetch|Load failed|NetworkError|fetch failed|Network request failed)/i.test(String(e?.message ?? ""));
const isTimeout = (e: any) => e?.name === "TimeoutError" || e?.name === "AbortError";

/** A CLEAR-TEXT refusal from the attested copilot (before decryption, with no proof of origin): a local message per code. */
const PLAIN: Record<string, StaticKey> = {
  proxy_required: "copilot.plain.proxy", origin_refused: "copilot.plain.origin", rate_minute: "copilot.plain.rateMinute",
  rate_day: "copilot.plain.rateDay", too_large: "copilot.plain.tooLarge", sealed_undecryptable: "copilot.plain.undecryptable",
  sealed_unavailable: "copilot.plain.unavailable", json_only: "copilot.plain.format", bad_json: "copilot.plain.format",
  bad_length: "copilot.plain.format", sealed_malformed: "copilot.plain.format",
};
/** The refusals that only need waiting (rate, size, renewed key): the bubble stays on the attested copilot. Any other
 *  clear-text refusal (proxy, origin, format, 5xx) switches, visibly, to the server copilot. */
const WAIT = new Set(["rate_minute", "rate_day", "too_large", "sealed_undecryptable"]);
function plainNote(status: number, code?: string, retryAfterSec?: number): Note {
  if (code === "rate_minute" && retryAfterSec) return msg("copilot.plain.rateMinuteIn", { s: retryAfterSec });
  const k = code && Object.prototype.hasOwnProperty.call(PLAIN, code) ? PLAIN[code]! : null;
  return k ? msg(k) : msg("copilot.plain.other", { status });
}

/** A reason placed in another sentence ("The attested copilot could not answer. {why} …"): a whole sentence, capital
 *  letter at the start and full stop at the end, whatever its source (the site's message, an explained error). */
function sentence(s: string): string {
  const x = s.trim();
  if (!x) return x;
  return (x[0]!.toUpperCase() + x.slice(1)).replace(/([^.!?…])$/, "$1.");
}

/** The long hexadecimal values of a reason (X25519 keys, addresses, fingerprints) shortened ("0x492f…5665"), so the
 *  fallback banner stays short; the full reason stays on hover. */
const compactHex = (s: string): string => s.replace(/0x[0-9a-fA-F]{18,}/g, (h) => short(h, 4));

/** What the server copilot ran into, without the browser's raw message ("Failed to fetch"): unreachable, too slow, or
 *  another error explained in the site's language. */
function serverFailure(e: unknown): Note {
  if (isTimeout(e)) return msg("copilot.slow", { url: COPILOT_URL });
  if (isNetwork(e)) return msg("copilot.unreachable", { url: COPILOT_URL });
  return msg("copilot.serverError", { url: COPILOT_URL, err: errorMsg(e) });
}

/** What prevented the attested copilot from answering (key not verified, enclave unreachable, reply refused…). An
 *  enclave that does not answer (even on /pubkeys, while its key is being verified) is described as such, without the
 *  browser's raw message; so is an enclave active under another operator than the one in the site's configuration
 *  (VITE_COPILOT_OPERATOR): its key is the right one, there is no session; the rest is explained by explainError (a key
 *  that does not match, an inactive enclave, a reply that does not come from the verified enclave…). */
function attestedFailure(e: unknown): Note {
  const x = e as any;
  if (isTimeout(x) || isTimeout(x?.cause)) return msg("copilot.att.slow");
  if (isNetwork(x) || (x?.name === "EnclaveKeyMismatchError" && x?.reason === "pubkeys_unreachable")) return msg("copilot.att.unreachable");
  if (x?.name === "EnclaveKeyMismatchError" && x?.reason === "wrong_operator") {
    const { op, expected } = wrongOperatorOf(x);
    const want = expected || ATTESTED_COPILOT?.operator || "";
    return msg("copilot.att.wrongOperator", { op: op && short(op, 4), expected: want && short(want, 4) });
  }
  return errorMsg(e);
}

/** The badge of a reply SEALED by the verified enclave, with the link to its registration on the explorer (the
 *  EnclaveRegistered transaction; failing that, the page of the operator who sent it). */
function SealedBadge({ by }: { by: SealedBy }) {
  const pub = usePublicClient();
  const [tx, setTx] = useState<Hex | null>(null);
  useEffect(() => {
    let alive = true;
    if (pub) registrationTx(pub as any, by.signer, by.fromBlock).then((h) => { if (alive) setTx(h); });
    return () => { alive = false; };
  }, [pub, by.signer, by.fromBlock]);
  const title = tx ? t("copilot.badge.tx", { signer: by.signer }) : t("copilot.badge.op", { signer: by.signer, op: by.operator });
  return (
    <a href={tx ? txLink(tx) : addrLink(by.operator)} target="_blank" rel="noreferrer" title={title} aria-label={title}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-good/15 px-1.5 py-0.5 text-[11px] font-medium text-good hover:bg-good/25">
      <ShieldCheck size={12} className="shrink-0" />
      <span className="min-w-0">{t(DCAP ? "copilot.badge" : "copilot.badge.dev")}</span>
      <ExternalLink size={11} className="shrink-0" />
    </a>
  );
}

type KeyState = { state: "idle" } | { state: "checking" } | { state: "ok"; keys: VerifiedCopilot } | { state: "bad" };

/** On a phone (under 640 px), the bubble is a sheet pinned to the bottom of the VISIBLE screen: when the keyboard opens
 *  (iOS Safari shrinks the visual viewport, not the layout), it moves above the keyboard and shrinks, so the input
 *  field stays visible. Read from window.visualViewport; without it, the sheet keeps 85dvh. */
function useSheet(open: boolean): { phone: boolean; inset: number; height?: number } {
  const [s, setS] = useState<{ phone: boolean; inset: number; height?: number }>({ phone: false, inset: 0 });
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const mq = window.matchMedia?.("(max-width: 639px)");
    const vv = window.visualViewport;
    const on = () => {
      if (!mq?.matches) { setS({ phone: false, inset: 0 }); return; }
      if (!vv) { setS({ phone: true, inset: 0 }); return; }
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setS({ phone: true, inset, height: Math.round(Math.min(window.innerHeight * 0.85, vv.height - 8)) });
    };
    on();
    mq?.addEventListener?.("change", on);
    vv?.addEventListener("resize", on);
    vv?.addEventListener("scroll", on);
    return () => { mq?.removeEventListener?.("change", on); vv?.removeEventListener("resize", on); vv?.removeEventListener("scroll", on); };
  }, [open]);
  return s;
}

export default function FloatingCopilot({ onNavigate, open, setOpen }: { onNavigate: (tab: string) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const { address } = useAccount();
  const pub = usePublicClient();
  // the attested copilot's client (null if it is not configured): it reads Arc through the public RPC, not the ArcHive API
  const client = useMemo<AttestedCopilotClient | null>(() => makeAttestedCopilot(pub as any), [pub]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<KeyState>({ state: "idle" });
  // non-null: the bubble has switched to the server copilot, and why (shown in the banner, in the current language)
  const [fallback, setFallback] = useState<Note | null>(null);
  const inflight = useRef<Promise<VerifiedCopilot> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const attested = client !== null && fallback === null;
  const kb = useSheet(open);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, open, status]);

  /** Verifies the copilot's key on Arc (one read at a time; the SDK keeps it 5 minutes). A failure switches to the
   *  server copilot, with the reason; only "retry" hands control back to the attested copilot. */
  function verify(force = false): Promise<VerifiedCopilot> {
    if (!client) return Promise.reject(new Error("attested copilot not configured"));
    if (!force && inflight.current) return inflight.current;
    setKey({ state: "checking" });
    const p: Promise<VerifiedCopilot> = client.verifiedKeys(force).then(
      (k) => { if (inflight.current === p) setKey({ state: "ok", keys: k }); return k; },
      (e) => { if (inflight.current === p) { setKey({ state: "bad" }); setFallback(attestedFailure(e)); } throw e; },
    );
    inflight.current = p;
    p.finally(() => { if (inflight.current === p) inflight.current = null; }).catch(() => {});
    return p;
  }
  // the key is verified as soon as the bubble first opens: the user knows BEFORE typing which copilot they are talking to
  useEffect(() => {
    if (open && client && key.state === "idle" && fallback === null) verify().catch(() => {});
  }, [open, client]); // eslint-disable-line react-hooks/exhaustive-deps

  function retryAttested() {
    if (!client || busy) return;
    verify(true).then(() => setFallback(null)).catch(() => {});
  }

  function navFromTools(tools?: string[]): RouteId | undefined {
    for (const x of tools ?? []) if (Object.prototype.hasOwnProperty.call(TOOL_TO_TAB, x)) return TOOL_TO_TAB[x];
    return undefined;
  }

  /** A reply (text, tools, sources, page, prepared actions) → the bubble message; opens the page concerned. */
  function answer(j: { text?: unknown; tools?: string[]; citations?: string[]; navigate?: string; actions?: CopilotAction[] }, via: Via, sealedBy?: SealedBy): Msg {
    const tools = Array.isArray(j.tools) ? j.tools.filter((x): x is string => typeof x === "string") : undefined;
    const go = typeof j.navigate === "string" && isKnownPage(j.navigate) ? resolveRoute(j.navigate) : navFromTools(tools);
    // a single card per action type: the last one prepared (the copilot's final choice)
    const acts = Object.values(Object.fromEntries((Array.isArray(j.actions) ? j.actions : []).filter((a) => a && typeof a.tool === "string").map((a) => [a.tool, a])));
    if (go) setTimeout(() => onNavigate(go), 0); // the copilot takes you to the page concerned
    return {
      role: "assistant", content: String(j.text ?? ""), tools, citations: Array.isArray(j.citations) ? j.citations.map(String) : undefined,
      navTab: go, actions: acts, via, ...(sealedBy ? { sealedBy } : {}),
    };
  }

  async function askServer(history: Msg[]) {
    try {
      const res = await fetch(`${COPILOT_URL}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: chatBody(history, address ?? null, getLang()), signal: AbortSignal.timeout(180_000),
      });
      const j = await res.json().catch(() => null) as { text?: unknown; tools?: string[]; citations?: string[]; navigate?: string; actions?: CopilotAction[] } | null;
      if (!res.ok || !j) {
        // server refusal (400, 413, 415, 429…): it explains why in `text`, which is shown (translated at display time)
        const said = typeof j?.text === "string" && j.text.trim() ? j.text : "";
        const why = said ? undefined : res.ok ? msg("err.unreadable", { status: res.status }) : msg("copilot.refused", { status: res.status });
        setMsgs([...history, { role: "assistant", content: said, local: true, note: why, via: "server" }]);
        return;
      }
      setMsgs([...history, answer(j, "server")]);
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: "", local: true, note: serverFailure(e), via: "server" }]);
    }
  }

  async function askAttested(history: Msg[], question: string) {
    if (!client) return;
    try {
      await verify();
      // only the ATTESTED part of the conversation goes to the enclave: never a reply from the server copilot (not
      // attested), which could steer a sealed reply (and its actions to sign)
      const r = await client.chat({
        messages: history.filter((m) => !m.local && m.via === "attested").map(({ role, content }) => ({ role, content })),
        user: address ?? null, lang: getLang(),
      });
      if (r.authenticated === true) {
        // sealed by the verified enclave for THIS request: its text and its actions are its own, and it gets the badge
        const by: SealedBy = { signer: r.enclave.signer, operator: r.enclave.operator, fromBlock: r.enclave.fromBlock };
        setMsgs([...history, answer(r.reply, "attested", by)]);
        return;
      }
      // CLEAR-TEXT refusal: nothing proves it comes from the enclave; a local message from its code, never its text
      const code = r.reply.code;
      const note = plainNote(r.status, code, r.reply.retryAfterSec);
      if (code && WAIT.has(code)) {
        setMsgs([...history, { role: "assistant", content: "", local: true, plain: true, note, via: "attested" }]);
        return;
      }
      setFallback(note);
      setMsgs([...history, { role: "assistant", content: "", local: true, plain: true, note: msg("copilot.fallbackNote", { why: () => sentence(show(note)) }), via: "attested", retry: question }]);
    } catch (e) {
      // key not verified, enclave unreachable, reply not from the verified enclave: an explicit message, then the
      // visible fallback; the question is NOT sent to the server without a click
      const why = attestedFailure(e);
      setFallback(why);
      setMsgs([...history, { role: "assistant", content: "", local: true, note: msg("copilot.fallbackNote", { why: () => sentence(show(why)) }), via: "attested", retry: question }]);
    }
  }

  async function send(text?: string, target?: Via) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const via: Via = target === "server" || !attested ? "server" : "attested";
    const history: Msg[] = [...msgs, { role: "user", content, via }];
    setMsgs(history); setInput(""); setBusy(true);
    setStatus(msg(via === "attested" ? "copilot.thinkingSealed" : "copilot.thinking"));
    try {
      if (via === "attested") await askAttested(history, content);
      else await askServer(history);
    } finally { setStatus(null); setBusy(false); }
  }

  function reset() {
    if (busy) return;
    setMsgs([]); setStatus(null);
  }

  // any screen can open the copilot with a question already asked (e.g. "Debug my machine")
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const on = (e: Event) => {
      const q = (e as CustomEvent).detail;
      if (typeof q === "string" && q.trim()) { setOpen(true); setTimeout(() => sendRef.current(q), 0); }
    };
    window.addEventListener("archive:ask", on);
    return () => window.removeEventListener("archive:ask", on);
  }, []);

  if (!open) {
    // on a phone, in landscape and on a tablet, a 48 px round button (the "Copilot" label only on a large screen, from
    // 1280 px): it hides less text; the content keeps a 7 rem bottom margin (Layout.tsx) to end above it. On a short
    // screen (landscape, under 500 px tall), it gives its place to the top bar's button (.copilot-fab / .copilot-top,
    // index.css)
    return (
      <button onClick={() => setOpen(true)} aria-label={t("copilot.open")} title={t("copilot.open")}
        className="copilot-fab fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-accent/50 bg-accent px-3.5 font-medium text-ink shadow-xl transition hover:brightness-110 xl:bottom-5 xl:right-5 xl:h-auto xl:px-4 xl:py-3">
        <span className="text-lg">⬡</span><span className="hidden xl:inline">{t("copilot.name")}</span>
      </button>
    );
  }

  // the header's second line: which copilot the user is talking to, now. It wraps between two words rather than being
  // clipped (a bubble of 380 px at most, longer text in French); the icon stays on the first line
  const modeLine = !client ? <span className="text-muted">{t("copilot.sub")}</span>
    : !attested ? <span className="text-warn">{t("copilot.serverLabel")}</span>
    : key.state === "ok" ? (
      <span className="flex items-start gap-1 text-good" title={t("copilot.mode.okTitle", { signer: key.keys.signer, op: key.keys.operator })}>
        <ShieldCheck size={11} className="mt-[2px] shrink-0" /><span className="min-w-0">{t("copilot.mode.ok", { e: short(key.keys.signer, 4) })}</span>
      </span>
    )
    : (
      <span className="flex items-start gap-1 text-muted">
        <Loader2 size={11} className="mt-[2px] shrink-0 animate-spin" /><span className="min-w-0">{t("copilot.mode.checking")}</span>
      </span>
    );

  // on a phone, a full-width sheet pinned to the bottom (height: 85 % of the visible screen, above the keyboard: kb);
  // wider, the floating bubble, never taller than the screen (landscape)
  const sheet = kb.phone ? { bottom: kb.inset, height: kb.height } : undefined;
  return (
    <>
    {/* phone: the page behind the sheet is dimmed; a tap on it folds the copilot away */}
    {kb.phone && <button type="button" aria-label={t("copilot.minimize")} className="fixed inset-0 z-40 bg-black/50 sm:hidden" onClick={() => setOpen(false)} />}
    <div style={sheet}
      className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-edge bg-panel pb-[env(safe-area-inset-bottom)] shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(560px,calc(100dvh-2.5rem))] sm:w-[min(92vw,380px)] sm:rounded-2xl sm:pb-0">
      <div className="flex items-center justify-between gap-2 border-b border-edge bg-ink/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent font-mono text-ink">⬡</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t("copilot.title")}</div>
            <div className="text-[11px] leading-snug">{modeLine}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {msgs.length > 0 && (
            <button onClick={reset} disabled={busy} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={t("copilot.new")} title={t("copilot.new")}>
              <RotateCcw size={15} />
            </button>
          )}
          <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-white [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={t("copilot.minimize")} title={t("copilot.minimize")}>—</button>
        </div>
      </div>

      {/* fallback: the attested copilot is not in use, and why; "retry" verifies its key on Arc again. The banner is
          shown in full: never cut mid-sentence (its last sentence says who the user is talking to now); long
          hexadecimal values (keys, addresses) are shortened there, in full on hover */}
      {client && fallback && (
        <div className="flex items-start gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-[11px] leading-snug text-warn">
          <p className="min-w-0 flex-1 [overflow-wrap:anywhere]" title={show(fallback)}>
            {t("copilot.fallbackBanner", { why: sentence(compactHex(show(fallback))) })}
          </p>
          <button onClick={retryAttested} disabled={busy || key.state === "checking"} className="tap -my-1 shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:underline disabled:opacity-40">
            {key.state === "checking" ? t("copilot.mode.checkingShort") : t("copilot.retryAttested")}
          </button>
        </div>
      )}

      <div ref={scroller} className="flex-1 space-y-2 overflow-auto bg-ink/40 p-3">
        {msgs.length === 0 && (
          <div className="space-y-3">
            {/* the fallback banner already says who the user is talking to: the introduction does not repeat it */}
            <p className="text-sm text-muted">{t(client && attested ? "copilot.introAttested" : "copilot.intro")}</p>
            <div className="flex flex-col gap-1.5">
              {SUGGEST.map((k) => {
                const q = t(k);
                return <button key={k} onClick={() => send(q)} className="tap rounded-lg border border-edge bg-panel px-3 py-2 text-left text-xs text-muted transition hover:border-accent/50 hover:text-white">{q}</button>;
              })}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${m.role === "user" ? "bg-accent/20" : m.local ? "bg-warn/10 text-warn" : "bg-edge"}`}>
              {m.role === "user" ? m.content : m.note ? show(m.note) : rich(serverText(m.content))}
            </div>
            {/* where the reply comes from: the badge ONLY for a reply sealed by the verified enclave */}
            {m.role === "assistant" && !m.local && m.sealedBy && <div className="mt-1"><SealedBadge by={m.sealedBy} /></div>}
            {m.role === "assistant" && !m.local && !m.sealedBy && client && <div className="mt-1 text-[11px] text-muted">{t("copilot.serverLabel")}</div>}
            {m.role === "assistant" && m.plain && <div className="mt-1 text-[11px] text-muted">{t("copilot.plainTag")}</div>}
            {m.role === "user" && client && m.via === "server" && <div className="mt-0.5 text-[11px] text-muted">{t("copilot.toServer")}</div>}
            {m.retry && (
              <button onClick={() => send(m.retry, "server")} disabled={busy}
                className="mt-1 rounded-lg border border-edge px-2.5 py-1 text-[12px] text-text hover:border-muted/60 disabled:opacity-40">
                {t("copilot.askServer")}
              </button>
            )}
            {m.navTab && <div className="mt-1 text-[11px] text-accent">{t("copilot.opening", { label: routeLabel(m.navTab) })}</div>}
            {m.actions?.map((a, k) => <ActionCard key={k} a={a} />)}
            {m.tools && m.tools.length > 0 && <div className="mt-1 flex flex-wrap justify-start gap-1">{m.tools.map((x, j) => <Badge key={j} tone="good">{x}</Badge>)}</div>}
            {m.citations && m.citations.length > 0 && <div className="mt-1"><Mono>{t("copilot.sources", { list: m.citations.join(", ") })}</Mono></div>}
          </div>
        ))}
        {status && <p className="font-mono text-xs text-muted">{show(status)}</p>}
      </div>

      <div className="flex items-end gap-2 border-t border-edge bg-ink/60 p-2">
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1} placeholder={t(client && !attested ? "copilot.placeholderServer" : "copilot.placeholder")} aria-label={t("copilot.placeholder")}
          // 16 px on a phone: iOS Safari does not zoom when the field takes focus
          className="tap max-h-24 flex-1 resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-base outline-none focus:border-accent/50 sm:text-sm"
        />
        <button onClick={() => send()} disabled={busy || !input.trim()} aria-label={t("copilot.send")} title={t("copilot.send")}
          className="tap min-w-[44px] rounded-lg bg-accent px-3 py-2 text-sm font-medium text-ink transition hover:brightness-110 disabled:opacity-40">↑</button>
      </div>
    </div>
    </>
  );
}

export { ATTESTED_COPILOT };
