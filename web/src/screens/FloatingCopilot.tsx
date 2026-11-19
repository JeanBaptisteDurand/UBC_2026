/** FloatingCopilot.tsx — la bulle du copilote, sur toutes les pages.
 *  Deux copilotes, jamais mélangés en silence :
 *  - le copilote ATTESTÉ (si configuré : config.ts, ATTESTED_COPILOT) : sa clé est vérifiée sur Arc en lisant le RPC
 *    d'Arc directement, la conversation part chiffrée vers son enclave et la réponse revient scellée (SDK,
 *    createAttestedCopilotClient). Une réponse authentifiée (authenticated === true) porte le badge « attested copilot ·
 *    verified on Arc », avec un lien vers l'inscription de l'enclave sur l'explorateur ; un refus en clair (sans preuve
 *    d'origine) est dit par un message LOCAL tiré de son code, jamais par le texte du relais ;
 *  - le copilote du SERVEUR (VITE_COPILOT_URL), en clair : chaque réponse est étiquetée « server copilot (not attested) »
 *    dès que le copilote attesté existe.
 *  Si la clé ne se vérifie pas, si l'enclave ne répond pas ou si sa réponse ne s'ouvre pas : un message explicite, puis
 *  le repli VISIBLE sur le copilote du serveur (bandeau, étiquette de chaque réponse). La question qui a échoué n'est
 *  jamais renvoyée au serveur sans un clic, et le serveur ne reçoit jamais la partie attestée de la conversation.
 *  Les actions à signer proposées par l'un ou l'autre passent par la carte de vérification (CopilotActions.tsx). */
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

/** D'où vient une réponse (ou où est partie une question) : l'enclave attestée, ou le serveur en clair. */
type Via = "attested" | "server";
/** L'enclave vérifiée qui a scellé une réponse (seulement si authenticated === true). */
interface SealedBy { signer: Address; operator: Address; fromBlock: bigint }

/** Un message de la bulle. `local` : écrit par le site (serveur injoignable, requête refusée, repli), jamais renvoyé au
 *  copilote comme s'il venait de lui : son texte est un message (`note`), mis en mots à l'affichage. Le texte du copilote
 *  est gardé tel qu'il est venu ; ses phrases connues sont traduites à l'affichage (serverText). `navTab` : la page
 *  ouverte par le copilote (son nom est lu à l'affichage). Tout suit donc la bascule de langue. `retry` : la question
 *  que le copilote attesté n'a pas pu prendre (l'envoyer au serveur demande un clic). `plain` : refus en clair. */
interface Msg {
  role: "user" | "assistant"; content: string; tools?: string[]; citations?: string[]; navTab?: RouteId; actions?: CopilotAction[];
  local?: boolean; note?: Note; via: Via; sealedBy?: SealedBy; retry?: string; plain?: boolean;
}

/** Outil utilisé par le copilote → page du site à montrer (secours quand le serveur ne renvoie pas `navigate`).
 *  Le bot « pilote le front » : quand il fait quelque chose, il vous emmène sur la page concernée. */
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

/** Les bornes du serveur (services/copilot, guard.ts) : il garde les 20 derniers messages et refuse un corps de plus
 *  de 64 Kio (413). La bulle n'envoie donc que les 20 derniers, et retire les plus anciens si le corps dépasse 60 Kio. */
const MAX_MESSAGES = 20;
const MAX_BODY_BYTES = 60 * 1024;

/** Le corps de POST /chat du copilote du serveur : les derniers messages PARTIS AU SERVEUR (jamais la partie attestée
 *  de la conversation, ni les messages du site), le wallet connecté et la langue choisie. */
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

/** Texte venu d'un copilote (attesté ou du serveur), à l'affichage : sans les marques de citation brutes du modèle (【…】,
 *  ses sources sont dans la ligne « sources ») ; tel quel en français ; en anglais, ses phrases connues (refus, secours)
 *  sont traduites. */
const serverText = (s: string): string => {
  const x = stripCitations(s);
  return getLang() === "en" ? toEnglish(x) : x;
};

/** 16/11 : le gras (**…**) et le code (`…`) des réponses, rendus au lieu d'afficher les astérisques et les accents graves
 *  bruts (le reste du texte, retours à la ligne compris, reste tel quel : jamais de HTML venu du modèle). */
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

/** Un fetch qui n'a pas eu de réponse (hors ligne, DNS, CORS, serveur arrêté), ou qui a dépassé son délai. */
const isNetwork = (e: any) => /^(Failed to fetch|Load failed|NetworkError|fetch failed|Network request failed)/i.test(String(e?.message ?? ""));
const isTimeout = (e: any) => e?.name === "TimeoutError" || e?.name === "AbortError";

/** Refus EN CLAIR du copilote attesté (avant le déchiffrement, sans preuve d'origine) : un message local par code. */
const PLAIN: Record<string, StaticKey> = {
  proxy_required: "copilot.plain.proxy", origin_refused: "copilot.plain.origin", rate_minute: "copilot.plain.rateMinute",
  rate_day: "copilot.plain.rateDay", too_large: "copilot.plain.tooLarge", sealed_undecryptable: "copilot.plain.undecryptable",
  sealed_unavailable: "copilot.plain.unavailable", json_only: "copilot.plain.format", bad_json: "copilot.plain.format",
  bad_length: "copilot.plain.format", sealed_malformed: "copilot.plain.format",
};
/** Les refus qu'il suffit d'attendre (débit, taille, clé renouvelée) : on reste sur le copilote attesté. Tout autre
 *  refus en clair (mandataire, origine, format, 5xx) fait basculer, visiblement, sur le copilote du serveur. */
const WAIT = new Set(["rate_minute", "rate_day", "too_large", "sealed_undecryptable"]);
function plainNote(status: number, code?: string, retryAfterSec?: number): Note {
  if (code === "rate_minute" && retryAfterSec) return msg("copilot.plain.rateMinuteIn", { s: retryAfterSec });
  const k = code && Object.prototype.hasOwnProperty.call(PLAIN, code) ? PLAIN[code]! : null;
  return k ? msg(k) : msg("copilot.plain.other", { status });
}

/** Une raison mise dans une autre phrase (« Le copilote attesté n'a pas pu répondre. {why} … ») : une phrase entière,
 *  majuscule au début et point à la fin, quelle que soit sa source (message du site, erreur expliquée). */
function sentence(s: string): string {
  const x = s.trim();
  if (!x) return x;
  return (x[0]!.toUpperCase() + x.slice(1)).replace(/([^.!?…])$/, "$1.");
}

/** Les longues valeurs hexadécimales d'une raison (clés X25519, adresses, empreintes) abrégées (« 0x492f…5665 »), pour
 *  que le bandeau du repli reste court ; la raison entière reste au survol. */
const compactHex = (s: string): string => s.replace(/0x[0-9a-fA-F]{18,}/g, (h) => short(h, 4));

/** Ce qu'a rencontré le copilote du serveur, sans le message brut du navigateur (« Failed to fetch ») : injoignable,
 *  trop lent, ou une autre erreur expliquée dans la langue du site. */
function serverFailure(e: unknown): Note {
  if (isTimeout(e)) return msg("copilot.slow", { url: COPILOT_URL });
  if (isNetwork(e)) return msg("copilot.unreachable", { url: COPILOT_URL });
  return msg("copilot.serverError", { url: COPILOT_URL, err: errorMsg(e) });
}

/** Ce qui a empêché le copilote attesté de répondre (clé non vérifiée, enclave injoignable, réponse refusée…). Une enclave
 *  qui ne répond pas (même à /pubkeys, pendant la vérification de sa clé) est dite comme telle, sans le message brut du
 *  navigateur ; une enclave active chez un autre opérateur que celui de la configuration du site (VITE_COPILOT_OPERATOR)
 *  aussi : sa clé est la bonne, il n'y a pas de session ; le reste est expliqué par explainError (clé qui ne correspond
 *  pas, enclave inactive, réponse qui ne vient pas de l'enclave vérifiée…). */
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

/** Le badge d'une réponse SCELLÉE par l'enclave vérifiée, avec le lien vers son inscription sur l'explorateur (la
 *  transaction EnclaveRegistered ; à défaut, la page de l'opérateur, qui l'a envoyée). */
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

/** 19/11 : sur téléphone (sous 640 px), la bulle est une feuille collée en bas de l'écran VISIBLE : quand le clavier
 *  s'ouvre (Safari d'iOS réduit la fenêtre visuelle, pas la mise en page), elle remonte au-dessus de lui et rétrécit,
 *  pour que le champ de saisie reste visible. Lu sur window.visualViewport ; sans lui, la feuille garde 85dvh. */
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
  // le client du copilote attesté (null s'il n'est pas configuré) : il lit Arc par le RPC public, pas par notre API
  const client = useMemo<AttestedCopilotClient | null>(() => makeAttestedCopilot(pub as any), [pub]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<KeyState>({ state: "idle" });
  // non nul : on a basculé sur le copilote du serveur, et pourquoi (affiché dans le bandeau, dans la langue du moment)
  const [fallback, setFallback] = useState<Note | null>(null);
  const inflight = useRef<Promise<VerifiedCopilot> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const attested = client !== null && fallback === null;
  const kb = useSheet(open);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, open, status]);

  /** Vérifie la clé du copilote sur Arc (une seule lecture à la fois ; le SDK la garde 5 minutes). Un échec fait
   *  basculer sur le copilote du serveur, avec la raison ; seul « réessayer » rend la main au copilote attesté. */
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
  // la clé est vérifiée dès la première ouverture de la bulle : on sait AVANT d'écrire à quel copilote on parle
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

  /** Une réponse (texte, outils, sources, page, actions préparées) → le message de la bulle ; ouvre la page concernée. */
  function answer(j: { text?: unknown; tools?: string[]; citations?: string[]; navigate?: string; actions?: CopilotAction[] }, via: Via, sealedBy?: SealedBy): Msg {
    const tools = Array.isArray(j.tools) ? j.tools.filter((x): x is string => typeof x === "string") : undefined;
    const go = typeof j.navigate === "string" && isKnownPage(j.navigate) ? resolveRoute(j.navigate) : navFromTools(tools);
    // une seule carte par type d'action : la dernière préparée (le choix final du copilote)
    const acts = Object.values(Object.fromEntries((Array.isArray(j.actions) ? j.actions : []).filter((a) => a && typeof a.tool === "string").map((a) => [a.tool, a])));
    if (go) setTimeout(() => onNavigate(go), 0); // le copilote vous emmène sur la page concernée
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
        // refus du serveur (400, 413, 415, 429…) : il explique pourquoi dans `text`, qu'on montre (traduit à l'affichage)
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
      // seule la partie ATTESTÉE de la conversation part vers l'enclave : jamais une réponse du copilote du serveur (non
      // attestée), qui pourrait orienter une réponse scellée (et ses actions à signer)
      const r = await client.chat({
        messages: history.filter((m) => !m.local && m.via === "attested").map(({ role, content }) => ({ role, content })),
        user: address ?? null, lang: getLang(),
      });
      if (r.authenticated === true) {
        // scellée par l'enclave vérifiée pour CETTE requête : son texte et ses actions sont les siens ; le badge
        const by: SealedBy = { signer: r.enclave.signer, operator: r.enclave.operator, fromBlock: r.enclave.fromBlock };
        setMsgs([...history, answer(r.reply, "attested", by)]);
        return;
      }
      // refus EN CLAIR : rien ne prouve qu'il vienne de l'enclave ; un message local d'après son code, jamais son texte
      const code = r.reply.code;
      const note = plainNote(r.status, code, r.reply.retryAfterSec);
      if (code && WAIT.has(code)) {
        setMsgs([...history, { role: "assistant", content: "", local: true, plain: true, note, via: "attested" }]);
        return;
      }
      setFallback(note);
      setMsgs([...history, { role: "assistant", content: "", local: true, plain: true, note: msg("copilot.fallbackNote", { why: () => sentence(show(note)) }), via: "attested", retry: question }]);
    } catch (e) {
      // clé non vérifiée, enclave injoignable, réponse qui ne vient pas de l'enclave vérifiée : message explicite, puis
      // repli visible ; la question n'est PAS renvoyée au serveur sans un clic
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

  // n'importe quel écran peut ouvrir le copilote avec une question déjà posée (ex. « Déboguer ma machine »)
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
    // 19/11 : sur téléphone, en paysage et sur tablette, un rond de 48 px (le libellé « Copilot » seulement sur grand
    // écran, à partir de 1280 px) : il cache moins de texte ; le contenu garde 7 rem de marge en bas (Layout.tsx) pour
    // finir au-dessus de lui. Sur un écran court (paysage, moins de 500 px de haut), il laisse sa place au bouton de la
    // barre du haut (.copilot-fab / .copilot-top, index.css)
    return (
      <button onClick={() => setOpen(true)} aria-label={t("copilot.open")} title={t("copilot.open")}
        className="copilot-fab fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-accent/50 bg-accent px-3.5 font-medium text-ink shadow-xl transition hover:brightness-110 xl:bottom-5 xl:right-5 xl:h-auto xl:px-4 xl:py-3">
        <span className="text-lg">⬡</span><span className="hidden xl:inline">{t("copilot.name")}</span>
      </button>
    );
  }

  // la 2e ligne de l'en-tête : à quel copilote on parle, maintenant. Elle passe à la ligne entre deux mots plutôt que
  // d'être rognée (bulle de 380 px au plus, texte plus long en français) ; l'icône reste sur la 1re ligne
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

  // 19/11 : sur téléphone, une feuille pleine largeur collée en bas (hauteur : 85 % de l'écran visible, au-dessus du
  // clavier : kb) ; plus large, la bulle flottante, jamais plus haute que l'écran (paysage)
  const sheet = kb.phone ? { bottom: kb.inset, height: kb.height } : undefined;
  return (
    <>
    {/* téléphone : la page derrière la feuille est voilée ; un toucher dessus replie le copilote */}
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

      {/* repli : le copilote attesté n'est pas utilisé, et pourquoi ; « réessayer » revérifie sa clé sur Arc. Le bandeau
          est montré en entier : jamais coupé au milieu d'une phrase (sa dernière dit à qui l'on parle maintenant) ; les
          longues valeurs hexadécimales (clés, adresses) y sont abrégées, entières au survol */}
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
            {/* le bandeau du repli dit déjà à qui l'on parle : l'introduction ne le répète pas */}
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
            {/* d'où vient la réponse : le badge SEULEMENT pour une réponse scellée par l'enclave vérifiée */}
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
          // 16 px sur téléphone : Safari d'iOS ne zoome pas quand le champ prend le focus
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
