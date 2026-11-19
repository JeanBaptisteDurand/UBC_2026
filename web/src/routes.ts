import { useEffect, useState } from "react";
import {
  Activity, Hexagon, Boxes, Crosshair, MessageSquareLock, KeyRound, FilePlus2, Server, PackagePlus, Wallet, Code2, Rotate3d,
  type LucideIcon,
} from "lucide-react";
import { t, type StaticKey } from "./i18n";

/** Le menu d'ArcHive : chaque capacité a UNE maison, regroupée par intention (comme une console SaaS).
 *  Les identifiants de route restent ceux d'origine (liens partagés, copilote) ; les libellés suivent la langue. */
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

/** Les autres pages du site, hors de la console (même onglet) : la salle des serveurs en 3D (/datacenter/), où chaque
 *  baie est une enclave inscrite sur Arc. Chaque lien se range dans un groupe, juste après la page nommée par `after`. */
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
/** Le nom d'une page dans la langue du site (« Hive » / « Ruche »). */
export const routeLabel = (id: RouteId): string => t(ROUTE_LABEL[id]);
/** Le nom d'un groupe du menu dans la langue du site. */
export const groupLabel = (g: GroupId): string => t(GROUP_LABEL[g]);

const IDS = new Set(ROUTES.map((r) => r.id));
/** Anciennes pages (et pages du copilote) → nouvelles routes. */
const ALIASES: Record<string, RouteId> = {
  home: "produits", accueil: "vue", hive: "ruche", use: "playground", rent: "operateur",
  onramp: "portefeuille", profile: "portefeuille", bounties: "primes", keys: "cles", developers: "developpeurs",
  overview: "vue", products: "produits", "post-bounty": "publier-prime", operator: "operateur", publish: "publier-produit", wallet: "portefeuille",
};
/** Vrai si `x` nomme une page du site (route actuelle ou ancien nom encore renvoyé par le copilote). */
const isAlias = (x: string): boolean => Object.prototype.hasOwnProperty.call(ALIASES, x);
export const isKnownPage = (x: string): boolean => IDS.has(x as RouteId) || isAlias(x);
export function resolveRoute(x?: string | null): RouteId {
  const k = (x ?? "").replace(/^#\/?/, "").split("?")[0] as RouteId;
  if (IDS.has(k)) return k;
  // propriété propre seulement : « #/constructor » ou « toString » ne doivent pas tomber sur une propriété d'Object
  return isAlias(k) ? ALIASES[k]! : "vue";
}

/** Routage par hash (#/ruche) : liens partageables, bouton retour du navigateur. */
export function useHashRoute(): [RouteId, (r: string) => void] {
  const [route, setRoute] = useState<RouteId>(() => resolveRoute(window.location.hash));
  useEffect(() => {
    // 19/11 : un lien « #/… » posé dans une page (panneau de la Ruche, phrase d'aide) change de page sans passer par go() :
    // la page ouverte par un CLIC commence en haut, comme par le menu (elle s'ouvrait à la hauteur de défilement de
    // l'ancienne, souvent tout en bas). Le bouton retour du navigateur, lui, garde la hauteur qu'il restaure.
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
