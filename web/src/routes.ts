import { useEffect, useState } from "react";
import {
  Activity, Hexagon, Boxes, Crosshair, MessageSquareLock, KeyRound, FilePlus2, Server, PackagePlus, Wallet, Code2, Rotate3d,
  type LucideIcon,
} from "lucide-react";
import { t, type StaticKey } from "./i18n";

/** ArcHive's menu: each capability has ONE home, grouped by intent (like a SaaS console).
 *  Route ids keep their original names, mostly French: shared links and the copilot use them. The labels follow the
 *  language. */
export type RouteId =
  | "vue" | "ruche" | "produits" | "primes"
  | "playground" | "cles" | "publier-prime"
  | "operateur" | "publier-produit"
  | "portefeuille" | "developpeurs";

export type GroupId = "explore" | "use" | "provide" | "account" | "build";

export interface RouteDef { id: RouteId; icon: LucideIcon; group: GroupId }

export const ROUTES: RouteDef[] = [
  { id: "vue", icon: Activity, group: "explore" },
  { id: "ruche", icon: Hexagon, group: "explore" },
  { id: "produits", icon: Boxes, group: "explore" },
  { id: "primes", icon: Crosshair, group: "explore" },
  { id: "playground", icon: MessageSquareLock, group: "use" },
  { id: "cles", icon: KeyRound, group: "use" },
  { id: "publier-prime", icon: FilePlus2, group: "use" },
  { id: "operateur", icon: Server, group: "provide" },
  { id: "publier-produit", icon: PackagePlus, group: "provide" },
  { id: "portefeuille", icon: Wallet, group: "account" },
  { id: "developpeurs", icon: Code2, group: "build" },
];
export const GROUPS: GroupId[] = ["explore", "use", "provide", "account", "build"];

/** The site's other pages, outside the console (same tab): the 3D server room (/datacenter/), where each rack is an
 *  enclave registered on Arc. Each link sits in a group, right after the page named by `after`. */
export interface LinkDef { href: string; icon: LucideIcon; group: GroupId; after: RouteId; label: StaticKey }
export const LINKS: LinkDef[] = [
  { href: "/datacenter/", icon: Rotate3d, group: "explore", after: "ruche", label: "nav.datacenter" },
];

const ROUTE_LABEL: Record<RouteId, StaticKey> = {
  vue: "nav.vue", ruche: "nav.ruche", produits: "nav.produits", primes: "nav.primes", playground: "nav.playground",
  cles: "nav.cles", "publier-prime": "nav.publier-prime", operateur: "nav.operateur", "publier-produit": "nav.publier-produit",
  portefeuille: "nav.portefeuille", developpeurs: "nav.developpeurs",
};
const GROUP_LABEL: Record<GroupId, StaticKey> = {
  explore: "nav.group.explore", use: "nav.group.use", provide: "nav.group.provide", account: "nav.group.account", build: "nav.group.build",
};
/** A page's name in the site's language ("Hive" / « Ruche »). */
export const routeLabel = (id: RouteId): string => t(ROUTE_LABEL[id]);
/** A menu group's name in the site's language. */
export const groupLabel = (g: GroupId): string => t(GROUP_LABEL[g]);

const IDS = new Set(ROUTES.map((r) => r.id));
/** Older page names (and the copilot's page names) → current routes. */
const ALIASES: Record<string, RouteId> = {
  home: "produits", accueil: "vue", hive: "ruche", use: "playground", rent: "operateur",
  onramp: "portefeuille", profile: "portefeuille", bounties: "primes", keys: "cles", developers: "developpeurs",
  overview: "vue", products: "produits", "post-bounty": "publier-prime", operator: "operateur", publish: "publier-produit", wallet: "portefeuille",
};
/** True if `x` names a page of the site (a current route, or an older name the copilot may still send). */
const isAlias = (x: string): boolean => Object.prototype.hasOwnProperty.call(ALIASES, x);
export const isKnownPage = (x: string): boolean => IDS.has(x as RouteId) || isAlias(x);
export function resolveRoute(x?: string | null): RouteId {
  const k = (x ?? "").replace(/^#\/?/, "").split("?")[0] as RouteId;
  if (IDS.has(k)) return k;
  // own property only: "#/constructor" or "toString" must not land on an Object property
  return isAlias(k) ? ALIASES[k]! : "vue";
}

/** Hash routing (#/ruche): shareable links, the browser's back button. */
export function useHashRoute(): [RouteId, (r: string) => void] {
  const [route, setRoute] = useState<RouteId>(() => resolveRoute(window.location.hash));
  useEffect(() => {
    // A "#/…" link placed in a page (Hive panel, help sentence) changes the page without going through go(): a page
    // opened by a CLICK starts at the top, as from the menu (otherwise it would open at the previous page's scroll height,
    // often at the very bottom). The browser's back button keeps the height it restores.
    let clickedAt = -Infinity;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href^='#/']");
      if (a && !a.hasAttribute("target")) clickedAt = performance.now();
    };
    const on = () => {
      if (performance.now() - clickedAt < 1500) window.scrollTo({ top: 0 });
      clickedAt = -Infinity;
      setRoute(resolveRoute(window.location.hash));
    };
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", on);
    return () => { document.removeEventListener("click", onClick); window.removeEventListener("hashchange", on); };
  }, []);
  const go = (r: string) => {
    const id = resolveRoute(r);
    if (window.location.hash !== `#/${id}`) window.location.hash = `/${id}`;
    setRoute(id);
    window.scrollTo({ top: 0 });
  };
  return [route, go];
}
