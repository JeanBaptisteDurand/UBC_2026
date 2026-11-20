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

/** Refused IPv4 ranges (the IANA special-purpose address registry, plus multicast and reserved). */
const V4_DENY: Array<[number, number]> = ([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const).map(([a, bits]) => [v4(a)!, bits]);

const v4Public = (n: number) => !V4_DENY.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));

/** IPv6 → 8 groups of 16 bits (a trailing IPv4 and "::" accepted, a %… zone ignored); null when unreadable. */
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
  // ::ffff:a.b.c.d (IPv4-mapped): the IPv4 rule decides
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embedded(g[6]!, g[7]!));
  if ((g[0]! & 0xe000) !== 0x2000) return false; // seul l'unicast global 2000::/3 (ni ::1, fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96…)
  if (g[0] === 0x2001 && g[1]! < 0x0200) return false; // 2001::/23 : Teredo, ORCHID, bancs d'essai
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return v4Public(embedded(g[1]!, g[2]!)); // 6to4: the embedded IPv4 decides
  if ((g[0]! & 0xfff0) === 0x3ff0) return false; // 3fff::/20 : documentation
  return true;
}

/** An IP address reachable on the public Internet (not private, local, reserved or documentation). */
export function isPublicIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) { const n = v4(ip); return n !== null && v4Public(n); }
  if (fam === 6) { const g = parseV6(ip); return !!g && v6Public(g); }
  return false;
}

// ---------------------------------------------------------------- pinned resolution

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;
const systemResolver: Resolver = (h) => lookup(h, { all: true });

export interface GuardOptions {
  /** DNS resolver (tests). */
  resolve?: Resolver;
  /** Allowed addresses (tests); default: isPublicIp, or all with allowPrivate. */
  isAllowed?: (ip: string) => boolean;
  /** Local development: private names and addresses allowed (localhost, 10.x, 192.168.x…). */
  allowPrivate?: boolean;
  /** Overall timeout of the call (connection, headers and body), in ms. */
  timeoutMs?: number;
  /** Maximum size of the response body, in bytes. */
  maxBytes?: number;
  /** A non-2xx response: returned WITHOUT a body, the connection cut without reading anything (enclave probes: an error
   *  body never goes back to the caller). */
  discardErrorBody?: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timed out (${what})`)), ms); })])
    .finally(() => clearTimeout(t));
}

/** Resolves the host ONCE and returns the address to connect to; refuses if a single answer is not public. */
export async function resolvePinned(hostname: string, o: GuardOptions = {}): Promise<{ address: string; family: 4 | 6 }> {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const allowed = o.isAllowed ?? (o.allowPrivate ? () => true : isPublicIp);
  if (!h) throw new BlockedUrlError("URL refused: empty host");
  if (!o.allowPrivate && (h === "localhost" || /\.(localhost|local|internal|lan|localdomain|home\.arpa)$/.test(h))) {
    throw new BlockedUrlError(`host refused (private network): ${hostname}`);
  }
  const fam = isIP(h);
  if (fam) {
    if (!allowed(h)) throw new BlockedUrlError(`host refused (private or reserved address): ${hostname}`);
    return { address: h, family: fam === 6 ? 6 : 4 };
  }
  const answers = await withTimeout((o.resolve ?? systemResolver)(h), 5_000, `DNS resolution of ${h}`);
  if (!answers.length) throw new BlockedUrlError(`host not found: ${hostname}`);
  if (answers.some((a) => !allowed(a.address))) {
    throw new BlockedUrlError(`host refused: ${hostname} points to a private or reserved address`);
  }
  const pick = answers.find((a) => a.family === 4) ?? answers[0]!; // IPv4 first: a container often has no IPv6
  return { address: pick.address, family: pick.family === 6 ? 6 : 4 };
}

/** An http(s) URL without credentials; throws BlockedUrlError otherwise. */
export function checkUrl(raw: string | URL): URL {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new BlockedUrlError(`invalid URL: ${String(raw).slice(0, 120)}`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BlockedUrlError("URL refused: http(s) only");
  if (u.username || u.password) throw new BlockedUrlError("URL refused: no credentials in the URL");
  return u;
}

// ---------------------------------------------------------------- URL d'enclave : https, port 443, chemin fixe

/** Les deux routes d'enclave qu'un outil peut appeler. */
export const ENCLAVE_ROUTES = ["/attest", "/pubkeys"] as const;
export type EnclaveRoute = (typeof ENCLAVE_ROUTES)[number];
/** The prefixes of the site's enclave gateways (same origin as the console): …/enclave/inference, …/enclave/bounty. */
export const DEFAULT_ENCLAVE_PREFIXES = ["/enclave/inference", "/enclave/bounty"];

export interface EnclavePolicy {
  /** Local development only: private addresses, http and any port allowed (the paths stay fixed). */
  allowPrivate?: boolean;
  /** Path prefixes allowed before /attest and /pubkeys (default: DEFAULT_ENCLAVE_PREFIXES; the root always is). */
  prefixes?: readonly string[];
}

const normPrefix = (p: string) => `/${p.trim().replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "");

/** ENCLAVE_PATH_PREFIXES: a comma-separated list ("none" = the root only); empty = the site's prefixes. */
export function parsePrefixes(env: string | undefined): string[] {
  const raw = (env ?? "").trim();
  if (!raw) return [...DEFAULT_ENCLAVE_PREFIXES];
  if (raw.toLowerCase() === "none") return [];
  // simple segments only (no "." or "..", no query): a prefix is compared with the URL's normalized path
  return [...new Set(raw.split(",").map(normPrefix).filter((p) => p !== "" && /^(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+)+$/.test(p)))];
}

/** The URL of an enclave route (/attest, /pubkeys) under the base URL the user gave: https, port 443, a fixed path (the
 *  root, or an allowed gateway prefix, then the route), no credentials, no query and no fragment ("https://host/x?y=" +
 *  "/attest" would target another route). allowPrivate (local development) also allows http and any port. */
export function enclaveEndpoint(base: string, route: string, p: EnclavePolicy = {}): URL {
  if (!(ENCLAVE_ROUTES as readonly string[]).includes(route)) throw new BlockedUrlError(`enclave route refused: ${String(route).slice(0, 40)} (/attest or /pubkeys only)`);
  const raw = String(base ?? "").trim();
  const b = checkUrl(raw);
  if (b.search || b.hash || /[?#]/.test(raw)) throw new BlockedUrlError("enclave URL refused: no query (?…) and no fragment (#…)");
  if (!p.allowPrivate) {
    if (b.protocol !== "https:") throw new BlockedUrlError("enclave URL refused: https only");
    if (b.port !== "") throw new BlockedUrlError("enclave URL refused: port 443 only");
  }
  const prefix = b.pathname.replace(/\/+$/, "");
  const allowed = (p.prefixes ?? DEFAULT_ENCLAVE_PREFIXES).map(normPrefix);
  if (prefix !== "" && !allowed.includes(prefix)) {
    throw new BlockedUrlError(`enclave URL refused: fixed path (the root${allowed.length ? `, ${allowed.join(", ")}` : ""}), not ${prefix.slice(0, 60)}`);
  }
  return new URL(`${b.origin}${prefix}${route}`);
}

/** The full URL of an enclave route ("https://host/enclave/inference/pubkeys", the one the SDK calls), checked like
 *  enclaveEndpoint; throws BlockedUrlError otherwise. */
export function enclaveRouteUrl(full: string | URL, p: EnclavePolicy = {}): URL {
  const raw = String(full ?? "").trim();
  const u = checkUrl(raw);
  if (u.search || u.hash || /[?#]/.test(raw)) throw new BlockedUrlError("enclave URL refused: no query (?…) and no fragment (#…)");
  const route = ENCLAVE_ROUTES.find((r) => u.pathname.endsWith(r));
  if (!route) throw new BlockedUrlError("enclave URL refused: /attest or /pubkeys only");
  const out = enclaveEndpoint(`${u.protocol}//${u.host}${u.pathname.slice(0, -route.length)}`, route, p);
  if (out.href !== u.href) throw new BlockedUrlError("enclave URL refused: fixed path");
  return out;
}

export interface SafeInit { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal | null }

/** The HTTP requester (tests can observe the address actually used). */
export type Requester = (opts: http.RequestOptions & { servername?: string }, cb: (res: http.IncomingMessage) => void) => http.ClientRequest;

/** A "safe" fetch: one resolution, a public address, a connection to THAT address, no redirect, a timeout and a bounded
 *  body. It returns a standard Response (the SDK uses it as a fetch). */
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
  // the lookup returns ONLY the checked address (the "all" form of net.connect, with autoSelectFamily, included)
  const pinned = (_h: string, opts: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => {
    if (opts && opts.all) cb(null, [{ address: pin.address, family: pin.family }]);
    else cb(null, pin.address, pin.family);
  };
  return new Promise<Response>((resolve, reject) => {
    const fail = (e: any) => reject(e?.name === "AbortError" || e?.name === "TimeoutError" || signal.aborted
      ? new Error(`timed out calling ${u.origin}${u.pathname}`) : e);
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
          reject(new BlockedUrlError(`redirect refused (HTTP ${status}): ${u.origin}${u.pathname}`));
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
            if (n > maxBytes) cb(new Error(`response too large (over ${maxBytes} bytes)`));
            else cb(null, chunk);
          },
        });
        res.on("error", (e) => capped.destroy(e));
        res.on("close", () => { if (!res.complete) capped.destroy(new Error(`response interrupted: ${u.origin}${u.pathname}`)); });
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
