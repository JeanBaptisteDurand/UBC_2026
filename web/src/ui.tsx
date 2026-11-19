import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import type { EnclaveCheck } from "./arc";
import { fmtNum, t, tx } from "./i18n";
import { isFailure, show, type Msg } from "./msg";

import { usdc, short } from "./fmt";

export { usdc, short };

export const EXPLORER = "https://explorer.testnet.arc.io";
export function txLink(h: string) { return `${EXPLORER}/tx/${h}`; }
export function addrLink(a: string) { return `${EXPLORER}/address/${a}`; }

/** En-tête de page : titre + une phrase qui dit à quoi sert la page + actions à droite. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-5">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {lead && <p className="mt-1.5 text-[14px] leading-relaxed text-muted [overflow-wrap:anywhere]">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section de page (pas une carte) : un titre, une phrase, du contenu. `min-w-0` : dans une grille, un long bloc de code
 *  défile dans son cadre au lieu d'élargir la page (téléphone). */
export function Section({ title, lead, children, right }: { title?: string; lead?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-8 min-w-0">
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          {/* une adresse longue dans la phrase (dépôt, URL) passe à la ligne au lieu d'élargir la page (320 px) */}
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {lead && <p className="mt-0.5 text-[13px] text-muted [overflow-wrap:anywhere]">{lead}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Surface encadrée, réservée aux unités interactives (formulaires, panneaux de commande). L'en-tête garde au titre et à
 *  sa phrase au moins 18rem : plus étroit (téléphone), `right` (un bouton) passe dessous au lieu de les serrer dans une
 *  colonne étroite. */
export function Card({ title, sub, children, right }: { title?: string; sub?: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 grow basis-72">
            {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
            {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Btn({ children, onClick, disabled, kind = "primary", type = "button" }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: "primary" | "ghost" | "danger"; type?: "button" | "submit";
}) {
  // tap : 44 px de haut sur un écran tactile (index.css), la taille d'origine à la souris
  const base = "tap inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const style = kind === "primary" ? "bg-accent text-ink hover:brightness-110"
    : kind === "danger" ? "border border-bad/40 text-bad hover:bg-bad/10"
    : "border border-edge text-text hover:border-muted/60";
  return <button type={type} className={`${base} ${style}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[13px] text-muted">{label}</span>
      {/* 16 px sur téléphone : Safari d'iOS ne zoome pas sur le champ quand il prend le focus */}
      <input
        className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-base outline-none transition focus:border-accent sm:text-[13px]"
        value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="expl mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" }) {
  const c = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="rounded-lg border border-edge bg-ink/60 px-3 py-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[16px] ${c}`}>{value}</div>
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "good" | "bad" | "warn" | "muted" | "accent" }) {
  const c = tone === "good" ? "bg-good/15 text-good" : tone === "bad" ? "bg-bad/15 text-bad" : tone === "warn" ? "bg-warn/15 text-warn"
    : tone === "accent" ? "bg-accent/15 text-accent" : "bg-edge text-muted";
  // un badge long (« Verified · Proof of Cloud ») passe à la ligne dans une carte étroite au lieu d'en déborder
  return <span className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-tight [overflow-wrap:anywhere] ${c}`}>{children}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12px] text-muted">{children}</span>;
}

/** Une adresse ou un hash : tronqué, copiable, avec lien vers l'explorateur. Le hash reste sur une ligne
 *  (« 0xff28…e6c4 ») ; 19/11 : sur un écran tactile, la copie et l'explorateur sont des cibles de 44 px (index.css,
 *  .hexbtn), qui passent sous le hash si la colonne est trop étroite. */
export function Hex({ value, kind = "address", n = 6 }: { value?: string | null; kind?: "address" | "tx" | "none"; n?: number }) {
  const [ok, setOk] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  const href = kind === "tx" ? txLink(value) : kind === "address" ? addrLink(value) : undefined;
  return (
    <span className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-x-1 font-mono text-[12px]">
      {href ? <a className="hexlink whitespace-nowrap text-text hover:text-accent" href={href} target="_blank" rel="noreferrer" title={value}>{short(value, n)}</a> : <span className="whitespace-nowrap" title={value}>{short(value, n)}</span>}
      <span className="inline-flex items-center gap-1">
        <button aria-label={t("ui.copy")} title={t("ui.copy")} className="hexbtn text-muted hover:text-text" onClick={() => { navigator.clipboard?.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); }}>
          {ok ? <Check size={12} /> : <Copy size={12} />}
        </button>
        {href && <a aria-label={t("ui.openExplorer")} title={t("ui.openExplorer")} className="hexbtn text-muted hover:text-accent" href={href} target="_blank" rel="noreferrer"><ExternalLink size={12} /></a>}
      </span>
    </span>
  );
}

/** Tableau de données (machines, sessions, clés, primes, produits, contrats). Son cadre est un conteneur (CSS container
 *  queries, index.css) : assez large, c'est un tableau dont les cellules longues passent à la ligne et dont les boutons
 *  se rangent les uns sous les autres plutôt que de déborder ; plus étroit que son seuil (`stack` : « md » sous 900 px,
 *  pour 5 ou 6 colonnes ; « sm » sous 560 px, pour 2 ou 3), chaque ligne devient une carte : la 1re cellule en titre
 *  (Td `main`), chaque autre valeur précédée du nom de sa colonne (Td `label`), les boutons en bas (Td `actions`).
 *  Aucune colonne ni aucun bouton n'est caché dans un défilement interne (celui du cadre ne sert plus que de secours,
 *  pour un navigateur sans container queries). */
export function Table({ head, children, empty, stack = "md" }: { head: ReactNode[]; children?: ReactNode; empty?: ReactNode; stack?: "md" | "sm" }) {
  return (
    <div className={`dt dt-${stack} overflow-x-auto rounded-xl border border-edge`}>
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-panel text-[12px] text-muted">
          {/* un en-tête long (« Parts op. / auteur / réseau ») passe à la ligne entre ses mots plutôt que d'élargir le tableau */}
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2.5 align-bottom font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-edge">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
/** Une cellule. `label` : le nom de sa colonne, montré devant la valeur quand le tableau passe en cartes ; `main` : la
 *  1re cellule (titre de la carte) ; `actions` : les boutons de la ligne (côte à côte, ou les uns sous les autres
 *  quand la place manque) ; `wrap` : un texte long, qui passe à la ligne. Sinon, une ligne (montants, dates). */
export function Td({ children, className = "", label, main, actions, wrap }: {
  children?: ReactNode; className?: string; label?: string; main?: boolean; actions?: boolean; wrap?: boolean;
}) {
  const ws = wrap ? "whitespace-normal break-words " : /whitespace-/.test(className) ? "" : "whitespace-nowrap ";
  const kind = main ? "dt-main " : actions ? "dt-act " : "";
  return (
    <td data-label={label || undefined} className={`${kind}${ws}px-3 py-2.5 align-middle ${className}`}>
      <div className={actions ? "dt-v flex flex-wrap items-center gap-1.5" : "dt-v"}>{children}</div>
    </td>
  );
}

/** État vide : dit quoi faire, pas une humeur. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-8 text-[13px] text-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Message de résultat d'une action (succès / erreur / en cours), gardé comme message (msg.ts) et mis en mots ici : il
 *  suit la bascule de langue. En rouge pour un échec (fail, failWith). */
export function Status({ msg }: { msg: Msg | null | undefined }) {
  const text = show(msg);
  if (!text) return null;
  const bad = isFailure(msg);
  const hash = text.match(/0x[0-9a-fA-F]{64}/)?.[0];
  return (
    <p className={`mt-3 break-all text-[13px] ${bad ? "text-bad" : "text-muted"}`}>
      {text}{hash && <> — <a className="text-accent hover:underline" href={txLink(hash)} target="_blank" rel="noreferrer">{t("ui.viewTx")}</a></>}
    </p>
  );
}

export type StepState = "todo" | "doing" | "done" | "fail";
export interface Step { label: string; state: StepState; detail?: ReactNode }

/** Les étapes d'une action en plusieurs temps (preuve puis paiement, inscription…), chacune avec son état. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-3 space-y-1.5" aria-live="polite">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-start gap-2 text-[13px]">
          <span className={`mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full ${
            s.state === "done" ? "bg-good/15 text-good" : s.state === "fail" ? "bg-bad/15 text-bad" : s.state === "doing" ? "bg-accent/15 text-accent" : "bg-edge text-muted"}`}>
            {s.state === "done" ? <Check size={12} /> : s.state === "fail" ? <X size={12} /> : s.state === "doing" ? <Loader2 size={12} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />}
          </span>
          <span className="min-w-0">
            <span className={s.state === "todo" ? "text-muted" : s.state === "fail" ? "text-bad" : "text-text"}>{i + 1}. {s.label}</span>
            {s.detail && <span className="block break-all text-[12px] text-muted">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Résultat de la confrontation des clés d'une enclave à la chaîne (useVerifiedEnclave). */
export function EnclaveCheckView({ check, onRetry }: { check: EnclaveCheck; onRetry?: () => void }) {
  if (check.state === "idle") return <span className="text-[12px] text-muted">{t("ui.check.idle")}</span>;
  if (check.state === "checking") return <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><Loader2 size={12} className="animate-spin" />{t("ui.check.checking")}</span>;
  if (check.state === "bad") {
    return (
      <span className="block break-words text-[12px] text-bad">
        {check.message}
        {onRetry && <button className="ml-2 text-accent hover:underline" onClick={onRetry}>{t("ui.check.retry")}</button>}
      </span>
    );
  }
  const k = check.keys;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
      <Badge tone="good">{t("ui.check.ok")}</Badge>
      <span>{tx("ui.check.enclave", { v: <Hex value={k.signer} n={4} /> })}</span>
      <span>{tx("ui.check.operator", { v: <Hex value={k.operator} n={4} /> })}</span>
      <span>{t("ui.check.until", { n: fmtNum(k.untilBlock) })}</span>
    </span>
  );
}

/** Demande de connexion du wallet, pour les pages qui en ont besoin (`what` : ce que la connexion permet, déjà traduit). */
export function NeedWallet({ what }: { what: string }) {
  return (
    // mb-8 : la section qui suit garde l'écart des autres sections (elle touchait le cadre)
    <div className="mb-8 rounded-xl border border-dashed border-edge px-5 py-8 text-[14px] text-muted">
      {t("ui.needWallet", { what })}
    </div>
  );
}
