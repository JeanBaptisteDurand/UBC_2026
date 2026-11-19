/** net-guard.ts — calls to a URL supplied by the user (a VM's /attest or /pubkeys) without turning the server into a
 *  relay to its own network or to another service:
 *  - enclave URL (enclaveEndpoint): https only, port 443 only, a FIXED path (/attest or /pubkeys, at the root or behind
 *    a known gateway prefix: /enclave/inference, /enclave/bounty), no credentials, no query, no fragment;
 *  - the host name is resolved ONCE; if any one of the addresses is private, local, reserved or for documentation, the
 *    call is refused (IPv6 forms that embed an IPv4 included: ::ffff:7f00:1, 6to4…);
 *  - the connection goes to THAT address (pinned lookup, a new agent for each call): a second DNS round (rebinding)
 *    cannot target the internal network; TLS still checks the host name's certificate (SNI);
 *  - no redirect followed, a global timeout, a bounded body.
 *  Local development only (COPILOT_ALLOW_PRIVATE_URLS=1, MCP_ALLOW_PRIVATE_URLS=1: allowPrivate): private addresses,
 *  http and any port allowed; paths stay fixed and redirects refused. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import { Readable, Transform } from "node:stream";

export class BlockedUrlError extends Error {
  constructor(message: string) { super(message); this.name = "BlockedUrlError"; }
}

// ---------------------------------------------------------------- adresses publiques

function v4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

/** Plages IPv4 refusées (registre IANA des adresses à usage spécial, plus le multicast et le réservé). */
const V4_DENY: Array<[number, number]> = ([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const).map(([a, bits]) => [v4(a)!, bits]);

const v4Public = (n: number) => !V4_DENY.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));

/** IPv6 → 8 groupes de 16 bits (IPv4 finale et « :: » acceptés, zone %… ignorée) ; null si illisible. */
export function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  const m4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (m4) {
    const n = v4(m4[2]!);
    if (n === null) return null;
    s = `${m4[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function v6Public(g: number[]): boolean {
  const embedded = (hi: number, lo: number) => ((hi << 16) >>> 0) + lo;
  // ::ffff:a.b.c.d (IPv4 mappée) : la règle IPv4 décide
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embedded(g[6]!, g[7]!));
  if ((g[0]! & 0xe000) !== 0x2000) return false; // seul l'unicast global 2000::/3 (ni ::1, fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96…)
  if (g[0] === 0x2001 && g[1]! < 0x0200) return false; // 2001::/23 : Teredo, ORCHID, bancs d'essai
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return v4Public(embedded(g[1]!, g[2]!)); // 6to4 : l'IPv4 embarquée décide
  if ((g[0]! & 0xfff0) === 0x3ff0) return false; // 3fff::/20 : documentation
  return true;
}

/** Adresse IP joignable sur l'Internet public (ni privée, ni locale, ni réservée, ni de documentation). */
export function isPublicIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) { const n = v4(ip); return n !== null && v4Public(n); }
  if (fam === 6) { const g = parseV6(ip); return !!g && v6Public(g); }
  return false;
}

// ---------------------------------------------------------------- résolution figée

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;
const systemResolver: Resolver = (h) => lookup(h, { all: true });

export interface GuardOptions {
  /** Résolveur DNS (tests). */
  resolve?: Resolver;
  /** Adresses permises (tests) ; défaut : isPublicIp, ou toutes si allowPrivate. */
  isAllowed?: (ip: string) => boolean;
  /** Développement local : noms et adresses privés permis (localhost, 10.x, 192.168.x…). */
  allowPrivate?: boolean;
  /** Délai global de l'appel (connexion, en-têtes et corps), en ms. */
  timeoutMs?: number;
  /** Taille maximale du corps de la réponse, en octets. */
  maxBytes?: number;
  /** Réponse non 2xx : rendue SANS corps, la connexion coupée sans rien lire (sondes d'enclave : un corps d'erreur ne
   *  revient jamais à l'appelant). */
  discardErrorBody?: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`délai dépassé (${what})`)), ms); })])
    .finally(() => clearTimeout(t));
}

/** Résout l'hôte UNE fois et rend l'adresse à laquelle se connecter ; refuse si une seule réponse n'est pas publique. */
export async function resolvePinned(hostname: string, o: GuardOptions = {}): Promise<{ address: string; family: 4 | 6 }> {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const allowed = o.isAllowed ?? (o.allowPrivate ? () => true : isPublicIp);
  if (!h) throw new BlockedUrlError("URL refusée : hôte vide");
  if (!o.allowPrivate && (h === "localhost" || /\.(localhost|local|internal|lan|localdomain|home\.arpa)$/.test(h))) {
    throw new BlockedUrlError(`hôte refusé (réseau privé) : ${hostname}`);
  }
  const fam = isIP(h);
  if (fam) {
    if (!allowed(h)) throw new BlockedUrlError(`hôte refusé (adresse privée ou réservée) : ${hostname}`);
    return { address: h, family: fam === 6 ? 6 : 4 };
  }
  const answers = await withTimeout((o.resolve ?? systemResolver)(h), 5_000, `résolution DNS de ${h}`);
  if (!answers.length) throw new BlockedUrlError(`hôte introuvable : ${hostname}`);
  if (answers.some((a) => !allowed(a.address))) {
    throw new BlockedUrlError(`hôte refusé : ${hostname} pointe vers une adresse privée ou réservée`);
  }
  const pick = answers.find((a) => a.family === 4) ?? answers[0]!; // IPv4 d'abord : un conteneur n'a souvent pas d'IPv6
  return { address: pick.address, family: pick.family === 6 ? 6 : 4 };
}

/** URL http(s) sans identifiants ; lève BlockedUrlError sinon. */
export function checkUrl(raw: string | URL): URL {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new BlockedUrlError(`URL invalide : ${String(raw).slice(0, 120)}`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BlockedUrlError("URL refusée : http(s) seulement");
  if (u.username || u.password) throw new BlockedUrlError("URL refusée : pas d'identifiants dans l'URL");
  return u;
}

// ---------------------------------------------------------------- URL d'enclave : https, port 443, chemin fixe

/** Les deux routes d'enclave qu'un outil peut appeler. */
export const ENCLAVE_ROUTES = ["/attest", "/pubkeys"] as const;
export type EnclaveRoute = (typeof ENCLAVE_ROUTES)[number];
/** Préfixes des passerelles d'enclave du site (même origine que la console) : …/enclave/inference, …/enclave/bounty. */
export const DEFAULT_ENCLAVE_PREFIXES = ["/enclave/inference", "/enclave/bounty"];

export interface EnclavePolicy {
  /** Développement local seulement : adresses privées, http et tout port permis (les chemins restent fixes). */
  allowPrivate?: boolean;
  /** Préfixes de chemin permis devant /attest et /pubkeys (défaut : DEFAULT_ENCLAVE_PREFIXES ; la racine l'est toujours). */
  prefixes?: readonly string[];
}

const normPrefix = (p: string) => `/${p.trim().replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "");

/** ENCLAVE_PATH_PREFIXES : liste séparée par des virgules (« none » = la racine seulement) ; vide = les préfixes du site. */
export function parsePrefixes(env: string | undefined): string[] {
  const raw = (env ?? "").trim();
  if (!raw) return [...DEFAULT_ENCLAVE_PREFIXES];
  if (raw.toLowerCase() === "none") return [];
  // segments simples seulement (ni « . » ni « .. », ni requête) : un préfixe est comparé au chemin normalisé de l'URL
  return [...new Set(raw.split(",").map(normPrefix).filter((p) => p !== "" && /^(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+)+$/.test(p)))];
}

/** URL d'une route d'enclave (/attest, /pubkeys) sous l'URL de base donnée par l'utilisateur : https, port 443, chemin
 *  fixe (la racine, ou un préfixe de passerelle permis, puis la route), sans identifiants, sans requête ni fragment
 *  (« https://hote/x?y= » + « /attest » viserait une autre route). allowPrivate (développement local) : http et tout
 *  port permis en plus. */
export function enclaveEndpoint(base: string, route: string, p: EnclavePolicy = {}): URL {
  if (!(ENCLAVE_ROUTES as readonly string[]).includes(route)) throw new BlockedUrlError(`route d'enclave refusée : ${String(route).slice(0, 40)} (/attest ou /pubkeys seulement)`);
  const raw = String(base ?? "").trim();
  const b = checkUrl(raw);
  if (b.search || b.hash || /[?#]/.test(raw)) throw new BlockedUrlError("URL d'enclave refusée : ni requête (?…) ni fragment (#…)");
  if (!p.allowPrivate) {
    if (b.protocol !== "https:") throw new BlockedUrlError("URL d'enclave refusée : https seulement");
    if (b.port !== "") throw new BlockedUrlError("URL d'enclave refusée : port 443 seulement");
  }
  const prefix = b.pathname.replace(/\/+$/, "");
  const allowed = (p.prefixes ?? DEFAULT_ENCLAVE_PREFIXES).map(normPrefix);
  if (prefix !== "" && !allowed.includes(prefix)) {
    throw new BlockedUrlError(`URL d'enclave refusée : chemin fixe (la racine${allowed.length ? `, ${allowed.join(", ")}` : ""}), pas ${prefix.slice(0, 60)}`);
  }
  return new URL(`${b.origin}${prefix}${route}`);
}

/** L'URL complète d'une route d'enclave (« https://hote/enclave/inference/pubkeys », celle que le SDK appelle),
 *  contrôlée comme enclaveEndpoint ; lève BlockedUrlError sinon. */
export function enclaveRouteUrl(full: string | URL, p: EnclavePolicy = {}): URL {
  const raw = String(full ?? "").trim();
  const u = checkUrl(raw);
  if (u.search || u.hash || /[?#]/.test(raw)) throw new BlockedUrlError("URL d'enclave refusée : ni requête (?…) ni fragment (#…)");
  const route = ENCLAVE_ROUTES.find((r) => u.pathname.endsWith(r));
  if (!route) throw new BlockedUrlError("URL d'enclave refusée : /attest ou /pubkeys seulement");
  const out = enclaveEndpoint(`${u.protocol}//${u.host}${u.pathname.slice(0, -route.length)}`, route, p);
  if (out.href !== u.href) throw new BlockedUrlError("URL d'enclave refusée : chemin fixe");
  return out;
}

export interface SafeInit { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal | null }

/** Le requêteur HTTP (tests : on peut observer l'adresse réellement utilisée). */
export type Requester = (opts: http.RequestOptions & { servername?: string }, cb: (res: http.IncomingMessage) => void) => http.ClientRequest;

/** fetch « sûr » : résolution unique, adresse publique, connexion à CETTE adresse, pas de redirection, délai, corps
 *  borné. Rend une Response standard (le SDK s'en sert comme d'un fetch). */
export async function safeFetch(input: string | URL, init: SafeInit = {}, o: GuardOptions & { request?: Requester } = {}): Promise<Response> {
  const u = checkUrl(input);
  const pin = await resolvePinned(u.hostname, o);
  return pinnedRequest(u, init, pin, o);
}

function pinnedRequest(u: URL, init: SafeInit, pin: { address: string; family: 4 | 6 }, o: GuardOptions & { request?: Requester }): Promise<Response> {
  const isHttps = u.protocol === "https:";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const request: Requester = o.request ?? ((isHttps ? https.request : http.request) as unknown as Requester);
  const maxBytes = o.maxBytes ?? 4_000_000;
  const method = (init.method ?? "GET").toUpperCase();
  const timeout = AbortSignal.timeout(o.timeoutMs ?? 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}), host: u.host };
  if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
  // le lookup ne rend QUE l'adresse vérifiée (forme « all » de net.connect avec autoSelectFamily comprise)
  const pinned = (_h: string, opts: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => {
    if (opts && opts.all) cb(null, [{ address: pin.address, family: pin.family }]);
    else cb(null, pin.address, pin.family);
  };
  return new Promise<Response>((resolve, reject) => {
    const fail = (e: any) => reject(e?.name === "AbortError" || e?.name === "TimeoutError" || signal.aborted
      ? new Error(`délai dépassé en appelant ${u.origin}${u.pathname}`) : e);
    let req: http.ClientRequest;
    try {
      req = request({
        protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`, method, headers,
        lookup: pinned as any, agent: false, signal,
        ...(isHttps && !isIP(host) ? { servername: host } : {}),
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          req.destroy();
          reject(new BlockedUrlError(`redirection refusée (HTTP ${status}) : ${u.origin}${u.pathname}`));
          return;
        }
        if (o.discardErrorBody && (status < 200 || status > 299)) {
          res.resume();
          req.destroy();
          resolve(new Response(null, { status: status >= 200 && status <= 599 ? status : 502, statusText: res.statusMessage ?? "" }));
          return;
        }
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          for (const x of Array.isArray(v) ? v : [v]) h.append(k, String(x));
        }
        const noBody = method === "HEAD" || status === 204 || status === 304;
        let n = 0;
        const capped = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            n += chunk.length;
            if (n > maxBytes) cb(new Error(`réponse trop grande (plus de ${maxBytes} octets)`));
            else cb(null, chunk);
          },
        });
        res.on("error", (e) => capped.destroy(e));
        res.on("close", () => { if (!res.complete) capped.destroy(new Error(`réponse interrompue : ${u.origin}${u.pathname}`)); });
        if (noBody) res.resume();
        else res.pipe(capped);
        try {
          resolve(new Response(noBody ? null : (Readable.toWeb(capped) as unknown as ReadableStream<Uint8Array>), {
            status: status >= 200 && status <= 599 ? status : 502, statusText: res.statusMessage ?? "", headers: h,
          }));
        } catch (e) { reject(e); }
      });
    } catch (e) { fail(e); return; }
    req.on("error", fail);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
