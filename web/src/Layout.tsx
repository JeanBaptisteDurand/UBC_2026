import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Menu, X, Sparkles, ArrowUpRight, ArrowLeft } from "lucide-react";
import { ROUTES, GROUPS, LINKS, routeLabel, groupLabel, type RouteId } from "./routes";
import { fetchStats } from "./api";
import { LANGS, fmtNum, setLang, t, useLang } from "./i18n";

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="hex grid h-8 w-8 place-items-center bg-accent text-[13px] font-semibold text-ink">A</span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">ArcHive</div>
        <div className="text-[12px] text-muted">{t("layout.brandSub")}</div>
      </div>
    </div>
  );
}

function Nav({ route, go, onPick }: { route: RouteId; go: (r: string) => void; onPick?: () => void }) {
  // 19/11 : dans le tiroir (téléphone), chaque entrée fait au moins 44 px de haut (.tap, écran tactile) ; un lien ramène
  // au site, d'où l'on vient presque toujours
  return (
    <nav className="flex flex-col gap-3.5" aria-label={t("layout.navAria")}>
      <a href="/" className="tap flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[14px] text-muted transition hover:bg-raised hover:text-text">
        <ArrowLeft size={16} aria-hidden="true" />
        {t("layout.site")}
      </a>
      {GROUPS.map((g) => (
        <div key={g}>
          <div className="mb-1 px-3 text-[12px] text-muted/80">{groupLabel(g)}</div>
          <ul className="flex flex-col gap-0.5">
            {ROUTES.filter((r) => r.group === g).map((r) => {
              const on = r.id === route;
              const Icon = r.icon;
              return (
                <Fragment key={r.id}>
                  <li>
                    <a href={`#/${r.id}`} onClick={(e) => { e.preventDefault(); go(r.id); onPick?.(); }}
                      aria-current={on ? "page" : undefined}
                      className={`tap relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[14px] transition ${on ? "bg-accent/10 text-text" : "text-muted hover:bg-raised hover:text-text"}`}>
                      {on && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[2px] rounded-full bg-accent" />}
                      <Icon size={16} className={on ? "text-accent" : ""} />
                      {routeLabel(r.id)}
                    </a>
                  </li>
                  {/* une autre page du site (plein écran, même onglet) : la flèche le signale */}
                  {LINKS.filter((l) => l.after === r.id).map((l) => {
                    const LinkIcon = l.icon;
                    return (
                      <li key={l.href}>
                        <a href={l.href} className="tap flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[14px] text-muted transition hover:bg-raised hover:text-text">
                          <LinkIcon size={16} />
                          {t(l.label)}
                          <ArrowUpRight size={13} aria-hidden="true" className="ml-auto text-muted/60" />
                        </a>
                      </li>
                    );
                  })}
                </Fragment>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Statut réseau en direct (bloc courant via notre API : aucun appel RPC depuis le navigateur). */
function NetworkPill() {
  const [head, setHead] = useState<string>();
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let alive = true;
    const tick = () => fetchStats().then((s) => { if (alive) { setHead(s.head); setOk(true); } }).catch(() => alive && setOk(false));
    tick();
    const timer = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return (
    <span className="net-pill hidden items-center gap-2 rounded-lg border border-edge px-2.5 py-1.5 text-[12px] text-muted md:inline-flex" title="Arc testnet, chainId 5042002">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-good" : "bg-warn"}`} />
      Arc testnet
      {head && <span className="font-mono text-text">{t("layout.block", { n: fmtNum(Number(head)) })}</span>}
    </span>
  );
}

/** 16/11 : quand aucune enclave n'est active (VM en pause, pour limiter les coûts), un bandeau le dit sur toutes les pages,
 *  au lieu de laisser le visiteur découvrir des « HTTP 502 » (lu sur /api/stats, toutes les minutes). */
function PauseBanner() {
  useLang();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => fetchStats().then((s) => { if (alive) setPaused(Number(s.enclavesActive) === 0); }).catch(() => {});
    tick();
    const timer = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!paused) return null;
  return (
    <div role="status" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-[13px] leading-relaxed text-warn lg:px-8">
      {t("layout.pause")}{" "}
      <a href="/demo.html" className="whitespace-nowrap underline underline-offset-2 hover:text-text">{t("layout.pause.demo")}</a>
    </div>
  );
}

/** Le nom de chaque langue, dans cette langue : on le reconnaît quelle que soit la langue affichée. */
const LANG_NAME = { en: "English", fr: "Français" } as const;

/** Écran de téléphone (sous 640 px, le point « sm » de Tailwind) : la barre du haut se resserre. */
const NARROW = "(max-width: 639px)";
function subscribeNarrow(f: () => void) {
  const mq = window.matchMedia?.(NARROW);
  mq?.addEventListener?.("change", f);
  return () => mq?.removeEventListener?.("change", f);
}
const isNarrow = () => !!window.matchMedia?.(NARROW).matches;
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
}

/** EN | FR : la langue du site, gardée dans ce navigateur (anglais par défaut). Sur ordinateur, les deux boutons ; sur
 *  téléphone, un seul, qui porte l'autre langue (« FR » sur le site anglais) et passe à elle. */
function LangToggle() {
  const lang = useLang();
  const other = LANGS.find((l) => l !== lang) ?? "en";
  return (
    <>
      <button type="button" lang={other} onClick={() => setLang(other)} title={LANG_NAME[other]} aria-label={LANG_NAME[other]}
        className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-lg border border-edge px-2 py-1.5 text-[12px] font-medium text-muted transition hover:bg-raised hover:text-text sm:hidden">
        {other.toUpperCase()}
      </button>
      <div role="group" aria-label={t("layout.language")} className="hidden shrink-0 overflow-hidden rounded-lg border border-edge text-[12px] sm:inline-flex">
        {LANGS.map((l) => (
          <button key={l} type="button" lang={l} aria-pressed={lang === l} title={LANG_NAME[l]}
            onClick={() => setLang(l)}
            className={`tap min-w-[36px] px-2 py-1.5 font-medium transition ${lang === l ? "bg-accent/15 text-text" : "text-muted hover:bg-raised hover:text-text"}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </>
  );
}

export default function Layout({ route, go, onOpenCopilot, children }: { route: RouteId; go: (r: string) => void; onOpenCopilot: () => void; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const narrow = useNarrow();
  const def = ROUTES.find((r) => r.id === route)!;
  return (
    // min-h-dvh : la hauteur visible (sur iOS, 100vh est la grande hauteur, barre d'outils repliée)
    <div className="min-h-dvh lg:pl-[248px]">
      {/* barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-edge bg-panel px-3 py-5 lg:flex">
        <a href="#/vue" onClick={(e) => { e.preventDefault(); go("vue"); }} className="mb-5 px-2"><Brand /></a>
        <div className="flex-1 overflow-y-auto"><Nav route={route} go={go} /></div>
        <button onClick={onOpenCopilot} className="mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] text-muted transition hover:bg-raised hover:text-text">
          <span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />{t("layout.copilot")}</span>
          <kbd className="rounded border border-edge px-1.5 font-mono text-[11px]">⌘K</kbd>
        </button>
      </aside>

      {/* tiroir (mobile) */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label={t("layout.closeMenu")} className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          {/* le tiroir tient dans l'écran (y compris en paysage : sa liste défile) et respecte les bords arrondis de l'iPhone */}
          <aside className="absolute inset-y-0 left-0 flex w-[min(288px,86vw)] flex-col border-r border-edge bg-panel px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="mb-4 flex items-center justify-between px-2"><Brand /><button aria-label={t("layout.close")} onClick={() => setDrawer(false)} className="-m-2 grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-text"><X size={20} /></button></div>
            <div className="flex-1 overflow-y-auto"><Nav route={route} go={go} onPick={() => setDrawer(false)} /></div>
          </aside>
        </div>
      )}

      {/* barre du haut */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-edge bg-ink/85 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {/* 44 × 44 px : la seule navigation sur téléphone */}
          <button aria-label={t("layout.openMenu")} className="-my-2 -ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:text-text lg:hidden" onClick={() => setDrawer(true)}><Menu size={22} /></button>
          {/* sur téléphone, le nom de la page seul (la section est dans le menu) */}
          <div className="min-w-0 truncate text-[14px]">
            <span className="hidden text-muted sm:inline">{groupLabel(def.group)}</span>
            <span className="mx-2 hidden text-edge sm:inline">/</span>
            <span className="font-medium">{routeLabel(def.id)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {/* 19/11 : écran court (téléphone en paysage) : le copilote s'ouvre d'ici (le rond flottant y couvrait la fin des
              lignes) ; ailleurs, ce bouton est caché (.copilot-top, index.css) */}
          <button type="button" onClick={onOpenCopilot} aria-label={t("copilot.open")} title={t("copilot.open")}
            className="copilot-top h-11 w-11 shrink-0 place-items-center rounded-lg border border-accent/50 bg-accent text-lg text-ink transition hover:brightness-110">
            <span aria-hidden="true">⬡</span>
          </button>
          <LangToggle />
          <NetworkPill />
          {/* sur téléphone : « Connect » et l'avatar du compte, sur une ligne ; ailleurs, le libellé de RainbowKit et l'adresse */}
          <ConnectButton showBalance={false} label={narrow ? t("layout.connect") : undefined}
            accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} chainStatus="icon" />
        </div>
      </header>
      <PauseBanner />

      <main className="mx-auto max-w-[1120px] px-4 py-7 pb-28 lg:px-8">{children}</main>
    </div>
  );
}
