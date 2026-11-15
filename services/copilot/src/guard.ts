/** guard.ts — les garde-fous HTTP du copilote (audit du 7/11, n° 4) : lecture bornée du corps, validation de la
 *  conversation (rôles user et assistant, texte seulement, historique borné, filtre de secrets sur toute la conversation),
 *  limite de débit par IP, jeton du mandataire du site (copilote en enclave), origines. */
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { getAddress, isAddress, type Address } from "viem";
import { isPublicIp, parseV6 } from "./net-guard";
import { scrubConversation } from "./secrets";
import { T, type Lang } from "./i18n";

export interface ChatBounds {
  /** Corps HTTP, en octets. */
  maxBodyBytes: number;
  /** Messages gardés (les plus récents). */
  maxMessages: number;
  /** Caractères par message (au-delà : tronqué, et le modèle le sait). */
  maxCharsPerMessage: number;
  /** Caractères de tout l'historique gardé. */
  maxCharsTotal: number;
}
export const DEFAULT_BOUNDS: ChatBounds = { maxBodyBytes: 64 * 1024, maxMessages: 20, maxCharsPerMessage: 4_000, maxCharsTotal: 16_000 };

// ---------------------------------------------------------------- corps de requête borné

/** Lit le corps d'une requête sans jamais dépasser `max` octets (Content-Length annoncé, puis compté au fil de l'eau). */
export async function readBodyCapped(req: Request, max: number): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  const cl = req.headers.get("content-length");
  if (cl !== null) {
    if (!/^\d+$/.test(cl.trim())) return { ok: false, status: 400 };
    if (Number(cl) > max) return { ok: false, status: 413 };
  }
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return { ok: false, status: 413 }; }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

// ---------------------------------------------------------------- conversation

export interface ClientMessage { role: "user" | "assistant"; content: string }
export type ParsedChat =
  | { ok: true; messages: ClientMessage[]; user?: Address; dropped: number; truncated: number; alert: boolean }
  | { ok: false; error: string };

const TRUNC = (n: number) => `\n[… message tronqué : ${n.toLocaleString("fr-FR")} caractères au plus]`;

/** Valide la conversation envoyée par le client.
 *  Refusé (400) : autre rôle que user/assistant (system, developer, tool…), contenu non textuel, pas de message, dernier
 *  message qui ne vient pas de l'utilisateur ou vide. Borné sans refus : seuls les maxMessages derniers messages sont
 *  gardés, chacun tronqué à maxCharsPerMessage, puis les plus anciens tombent jusqu'à maxCharsTotal. TOUTE la
 *  conversation reçue passe par le filtre de secrets AVANT d'être tronquée (une clé coupée en deux par la troncature
 *  serait sinon à moitié envoyée au modèle) : scrubConversation, en MODE ALERTE pour tous les messages dès qu'un message
 *  de l'utilisateur parle de clé privée, de phrase de récupération ou de clé étendue (mentionsSecret ; aucune valeur de
 *  64 hex ni clé base58, phrase reconnue dès 8 mots ou coupée entre plusieurs messages ; `alert` le dit). Seuls role et
 *  content sont recopiés. `lang` : langue des messages d'erreur (défaut : français). */
export function parseChatRequest(body: unknown, b: ChatBounds = DEFAULT_BOUNDS, lang: Lang = "fr"): ParsedChat {
  const E = T(lang).chat;
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: E.notObject };
  const raw = (body as any).messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: E.messagesArray };
  for (const [i, m] of raw.entries()) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, error: E.messageObject(i) };
    if (m.role !== "user" && m.role !== "assistant") return { ok: false, error: E.role(i, String(m.role).slice(0, 20)) };
    if (typeof m.content !== "string") return { ok: false, error: E.nonText(i) };
  }
  const last = raw[raw.length - 1] as ClientMessage;
  if (last.role !== "user") return { ok: false, error: E.lastNotUser };
  if (!last.content.trim()) return { ok: false, error: E.empty };

  // le filtre voit toute la conversation reçue (une mention de clé privée dans un message ancien met aussi les suivants
  // en alerte), et seulement role et content
  const clean = scrubConversation((raw as ClientMessage[]).map((m) => ({ role: m.role, content: m.content })));
  let truncated = 0;
  let kept: ClientMessage[] = clean.messages.slice(-b.maxMessages)
    .filter((m, i, a) => i === a.length - 1 || m.content.trim() !== "")
    .map((m) => {
      if (m.content.length <= b.maxCharsPerMessage) return m;
      truncated++;
      const mark = TRUNC(b.maxCharsPerMessage);
      return { role: m.role, content: m.content.slice(0, b.maxCharsPerMessage - mark.length) + mark };
    });
  let total = kept.reduce((s, m) => s + m.content.length, 0);
  while (kept.length > 1 && total > b.maxCharsTotal) { total -= kept[0]!.content.length; kept = kept.slice(1); }
  const dropped = raw.length - kept.length;
  const messages = kept;
  const u = (body as any).user;
  const user = typeof u === "string" && isAddress(u, { strict: false }) ? getAddress(u.toLowerCase()) : undefined;
  return { ok: true, messages, user, dropped, truncated, alert: clean.alert };
}

// ---------------------------------------------------------------- débit

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface RateOptions {
  perMinute: number;
  perDay: number;
  /** Plafond global quotidien de requêtes envoyées au modèle (0 = aucun). */
  globalPerDay: number;
  /** Clés suivies au plus (mémoire bornée). */
  maxKeys?: number;
  now?: () => number;
}
export type RateVerdict = { ok: true } | { ok: false; retryAfterSec: number; scope: "minute" | "jour" | "global" };

/** Fenêtre glissante d'une minute (les instants des dernières requêtes) et fenêtre fixe de 24 h, par clé (IP). */
export class RateLimiter {
  private per = new Map<string, { hits: number[]; dayStart: number; dayCount: number }>();
  private glob = { dayStart: 0, count: 0 };
  private n = 0;
  constructor(private o: RateOptions) {}
  private now() { return (this.o.now ?? Date.now)(); }

  /** Compte une requête de cette clé si elle passe ; sinon dit quand réessayer. */
  hit(key: string): RateVerdict {
    const now = this.now();
    if (++this.n % 500 === 0 || this.per.size > (this.o.maxKeys ?? 20_000)) this.sweep(now);
    let e = this.per.get(key);
    if (!e) { e = { hits: [], dayStart: now, dayCount: 0 }; this.per.set(key, e); }
    if (now - e.dayStart >= DAY) { e.dayStart = now; e.dayCount = 0; }
    e.hits = e.hits.filter((t) => now - t < MINUTE);
    if (e.dayCount >= this.o.perDay) return { ok: false, scope: "jour", retryAfterSec: Math.max(1, Math.ceil((e.dayStart + DAY - now) / 1000)) };
    if (e.hits.length >= this.o.perMinute) return { ok: false, scope: "minute", retryAfterSec: Math.max(1, Math.ceil((e.hits[0]! + MINUTE - now) / 1000)) };
    e.hits.push(now);
    e.dayCount++;
    return { ok: true };
  }

  /** Plafond global : une requête de plus envoyée au modèle aujourd'hui ? */
  hitGlobal(): RateVerdict {
    if (!this.o.globalPerDay) return { ok: true };
    const now = this.now();
    if (now - this.glob.dayStart >= DAY) this.glob = { dayStart: now, count: 0 };
    if (this.glob.count >= this.o.globalPerDay) return { ok: false, scope: "global", retryAfterSec: Math.max(1, Math.ceil((this.glob.dayStart + DAY - now) / 1000)) };
    this.glob.count++;
    return { ok: true };
  }

  get size() { return this.per.size; }

  private sweep(now: number) {
    for (const [k, e] of this.per) if (now - e.dayStart >= DAY || (e.dayCount === 0 && e.hits.length === 0)) this.per.delete(k);
    const max = this.o.maxKeys ?? 20_000;
    for (const k of this.per.keys()) { if (this.per.size <= max) break; this.per.delete(k); } // les plus anciennes d'abord
  }
}

// ---------------------------------------------------------------- IP du client

const unmap = (ip: string) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
function stripPort(s: string): string {
  const b = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (b) return b[1]!;
  const p = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(s);
  return p ? p[1]! : s;
}

/** Clé de débit : une IPv4, ou le /64 d'une IPv6 (un abonné en a des milliards). */
export function bucketOf(ip: string): string {
  const a = unmap(ip);
  if (isIP(a) === 6) {
    const g = parseV6(a);
    if (g) return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
  }
  return a;
}

/** IP du client, lue dans X-Forwarded-For si on le croit, sinon l'adresse du pair.
 *  - `trustForwarded` absent (copilote du VPS) : X-Forwarded-For n'est cru que si la connexion vient d'un proxy local
 *    (pair privé ou de boucle), et c'est son DERNIER maillon qui compte (posé par Caddy, qui remplace celui du client) ;
 *    exposé directement, le service prend l'adresse du pair ;
 *  - `trustForwarded` donné (copilote en enclave : le pair est TOUJOURS la passerelle Phala, privée, que la requête
 *    vienne du mandataire du site ou de n'importe qui) : cru seulement si true, c'est-à-dire si la requête porte le
 *    jeton du mandataire (app.ts, proxyToken) ; c'est alors son PREMIER maillon qui compte : Caddy l'a posé (il remplace
 *    toute valeur venue du client), et un intermédiaire placé après lui (nginx, passerelle Phala) ne peut qu'ajouter
 *    sa propre adresse à la fin. */
export function clientIp(c: Context, trustForwarded?: boolean): string {
  let peer: string | undefined;
  try { peer = getConnInfo(c).remote.address; } catch { peer = undefined; }
  const trusted = trustForwarded ?? (!peer || !isPublicIp(unmap(peer)));
  const xff = c.req.header("x-forwarded-for");
  if (xff && trusted) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const hop = stripPort((trustForwarded === true ? hops[0] : hops.pop()) ?? "");
    if (isIP(unmap(hop))) return unmap(hop);
  }
  return peer ? unmap(peer) : "inconnue";
}

// ---------------------------------------------------------------- jeton du mandataire (copilote en enclave)

/** En-tête que le mandataire du site (nginx, proxy_set_header) pose sur chaque requête vers le copilote en enclave. */
export const PROXY_TOKEN_HEADER = "x-archive-proxy-token";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Vérificateur du jeton du mandataire, en temps constant : on compare les empreintes SHA-256 (même longueur, quelle que
 *  soit celle du jeton reçu) avec timingSafeEqual ; ni la valeur ni la longueur du jeton attendu ne fuient par le temps
 *  de réponse. Le jeton n'est jamais journalisé. */
export function proxyTokenChecker(expected: string): (given: string | null | undefined) => boolean {
  if (!expected) throw new Error("jeton du mandataire vide");
  const want = sha256(expected);
  return (given) => typeof given === "string" && timingSafeEqual(sha256(given), want);
}

// ---------------------------------------------------------------- origines

export const DEFAULT_ORIGINS = ["https://archive.62-171-153-35.sslip.io"];

/** ALLOWED_ORIGINS : liste séparée par des virgules (« * » = toutes, à n'utiliser qu'en développement). */
export function parseOrigins(env: string | undefined): string[] {
  const list = (env ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}
export const originAllowed = (origin: string, allowed: string[]) =>
  allowed.includes("*") || allowed.includes(origin.trim().replace(/\/+$/, "").toLowerCase());
