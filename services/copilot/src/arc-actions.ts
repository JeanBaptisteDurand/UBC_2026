/** arc-actions.ts — the actions of the copilot AND the MCP server, written once.
 *  - Reads: every number comes from an on-chain read (the SDK's ArcClient, or a direct contract read with its ABI);
 *    derived values (remainder, cap, fees) are computed here in integers, like the contracts. Reads are sequential and
 *    cached (Arc's public RPC answers 429 to bursts).
 *  - LISTS (enclaves, bounties, products, an account's sessions, activity): read from the ArcHive API's event index
 *    (archive-api.ts, 8 s timeout), never from the explorer; an API that does not answer = "liste momentanément
 *    indisponible" (list temporarily unavailable), never a partial list presented as complete.
 *  - Actions: PREPARED only. There is no key here: nothing is signed or sent. The user signs in their browser, their
 *    wallet or the CLI on their machine.
 *  - URLs given by the user (a VM's /attest, /pubkeys): https, port 443 and a fixed path; host resolved once, a public
 *    address required and the connection made to THAT address; no redirect followed; an error response's body is never
 *    read or returned (net-guard.ts). The same guards for the copilot and the MCP server; the only exception, in local
 *    development: allowPrivateUrls (private network, http, any port).
 *  - Keys: the session key (aek_…) and the protocol's X25519 key are born on the user's side; scrubSecrets()
 *    (secrets.ts) masks a secret pasted by mistake into the conversation.
 *  Used by services/copilot (tools.ts) and services/mcp (tools.ts). */
import {
  type ArcClient, type ProductView, type Predicate, type Clause, type EnclaveView, type BountyRow,
  usdcDomain, receiveWithAuthorizationTypes, freshNonce, predicateHash, canonicalize, validatePredicate,
  operatorBondAbi, enclaveRegistryAbi, productRegistryAbi, sessionPayAbi, sealedBountyAbi, usdcAbi,
  verifyEnclaveKeys, EnclaveKeyMismatchError, parseTdxQuote, expectedReportData0, DCAP_REGISTER_GAS_ESTIMATE,
  planRegistrationLog,
} from "@arcvault/sdk";
import {
  type Address, type Hex, parseAbi, formatUnits, parseUnits, getAddress, encodeFunctionData, keccak256, toBytes, size,
} from "viem";
import { apiEnclaves, apiBounties, apiProducts, apiSessions, apiActivity, freshness, archiveBase, isListUnavailable } from "./archive-api";
import {
  safeFetch, enclaveEndpoint, enclaveRouteUrl, BlockedUrlError,
  type EnclavePolicy, type EnclaveRoute, type GuardOptions, type Requester,
} from "./net-guard";
import { scrubSecrets } from "./secrets";

export { scrubSecrets };
export { ListUnavailableError, isListUnavailable } from "./archive-api";

const ZERO = "0x0000000000000000000000000000000000000000";
/** EIP-2935 : l'historique des hashes de bloc couvre 8 191 blocs (README « Constantes Arc », VERIFIED). */
const HISTORY_WINDOW = 8191n;

/** Constantes et getters publics des contrats, absents de l'ABI du SDK. */
const extraAbi = parseAbi([
  "function UNBOND_DELAY() view returns (uint64)",
  "function WINDOW() view returns (uint64)",
  "function VALIDITY_BLOCKS() view returns (uint64)",
  "function GRACE_BLOCKS() view returns (uint64)",
  "function BLOCK_TIME_MS() view returns (uint64)",
  "function requireSeptVeDisable() view returns (bool)",
  "function freeBond(address operator) view returns (uint256)",
  "function settleableUntilBlock(address signer) view returns (uint256)",
  "function quoteSeen(bytes32 quoteHash) view returns (bool)",
  "function networkBountyBps() view returns (uint16)",
  "function operatorBountyBps() view returns (uint16)",
  "function MAX_SIGS() view returns (uint256)",
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function tierAmount(uint256 bountyId, uint256 index) view returns (uint256)",
  "function timelock() view returns (uint64)",
  "function SETTLE_GRACE() view returns (uint64)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
]);

export interface ActionCtx {
  /** Wallet connecté (copilote) : adresse par défaut de « from » / opérateur. */
  user?: Address;
  /** Développement local seulement : URL privées (localhost, 10.x…), http et tout port pour /attest et /pubkeys
   *  (COPILOT_ALLOW_PRIVATE_URLS=1, MCP_ALLOW_PRIVATE_URLS=1). Sinon : https, port 443, adresse publique. */
  allowPrivateUrls?: boolean;
  /** Préfixes de passerelle permis devant /attest et /pubkeys (défaut : /enclave/inference, /enclave/bounty). */
  enclavePathPrefixes?: readonly string[];
  /** URL de passerelle d'enclave par défaut pour les exemples de code. */
  enclaveUrl?: string;
  /** Renvoyer la calldata complète de registerEnclave (gros quote) : oui en MCP, non dans le chat. */
  includeCalldata?: boolean;
  /** Base de l'API HTTP ArcHive (listes de l'index, machines des opérateurs). Défaut : env ARCHIVE_API, sinon le VPS. */
  apiBase?: string;
}

// ---------------------------------------------------------------- cache et lectures

const cache = new Map<string, { t: number; ttl: number; v: Promise<unknown> }>();
/** Entrées gardées au plus : certaines clés viennent de l'utilisateur (un produit par id), la mémoire reste bornée. */
const MAX_CACHE = 1_024;
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v as Promise<T>;
  if (cache.size >= MAX_CACHE) {
    for (const [k, e] of cache) if (now - e.t >= e.ttl) cache.delete(k); // périmées d'abord
    for (const k of cache.keys()) { if (cache.size < MAX_CACHE) break; cache.delete(k); } // puis les plus anciennes
  }
  const v = fn();
  cache.delete(key);
  cache.set(key, { t: now, ttl: ttlMs, v });
  v.catch(() => { if (cache.get(key)?.v === v) cache.delete(key); }); // un échec n'est jamais gardé
  return v;
}
const ck = (arc: ArcClient, s: string) => `${arc.d.chainId}:${arc.d.productRegistry}:${s}`;

function read<T>(arc: ArcClient, address: Address, abi: unknown, functionName: string, args: unknown[] = []): Promise<T> {
  return (arc.pub as any).readContract({ address, abi, functionName, args }) as Promise<T>;
}
/** Constante immuable d'un contrat : lue une fois par processus. */
function constant<T>(arc: ArcClient, address: Address, fn: string): Promise<T> {
  return cached(ck(arc, `const:${address}:${fn}`), Number.POSITIVE_INFINITY, () => read<T>(arc, address, extraAbi, fn));
}
/** Dernier bloc (numéro + horodatage de la chaîne) : la référence de « maintenant ». */
export function headBlock(arc: ArcClient): Promise<{ number: bigint; timestamp: bigint }> {
  return cached(ck(arc, "head"), 4_000, async () => {
    const b = await arc.pub.getBlock();
    return { number: b.number as bigint, timestamp: b.timestamp as bigint };
  });
}
/** Les listes viennent de l'index de l'API ArcHive (cache de 15 s des seules réponses complètes, délai de 8 s) ; jamais
 *  de l'explorateur. API muette ou réponse illisible : ListUnavailableError (« liste momentanément indisponible »).
 *  `arc` reste en paramètre (mêmes appels qu'avant) ; `cx.apiBase` choisit l'API. */
export const productsCached = (_arc: ArcClient, cx: ActionCtx = {}): Promise<ProductView[]> => apiProducts({ base: cx.apiBase });
export const enclavesCached = (_arc: ArcClient, cx: ActionCtx = {}): Promise<EnclaveView[]> => apiEnclaves({ base: cx.apiBase });
export const bountiesCached = (_arc: ArcClient, cx: ActionCtx = {}): Promise<BountyRow[]> => apiBounties({ base: cx.apiBase });

/** Une liste, ou la raison exacte de son absence (pour les outils dont la liste n'est qu'un complément). */
async function listOrReason<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; indisponible: string }> {
  try { return { ok: true, v: await p }; } catch (e) {
    if (isListUnavailable(e)) return { ok: false, indisponible: e.message };
    throw e;
  }
}

const STATES = ["None", "Proposed", "Active", "Retired"];
export interface ProductLite {
  id: bigint; author: Address; deterministic: boolean; price: bigint;
  bpsOperator: number; bpsAuthor: number; bpsNetwork: number;
  minBond: bigint; exposureCap: bigint; settlement: Address; param: Hex; state: string;
}
function liteOf(p: ProductView): ProductLite {
  return {
    id: p.id, author: p.author, deterministic: p.deterministic, price: p.price,
    bpsOperator: Number(p.bpsOperator), bpsAuthor: Number(p.bpsAuthor), bpsNetwork: Number(p.bpsNetwork),
    minBond: p.minBond, exposureCap: p.exposureCap, settlement: p.settlement, param: p.param, state: p.state,
  };
}
/** Un produit en UNE lecture (getProduct, sans manifestURI). */
export function productLite(arc: ArcClient, id: bigint): Promise<ProductLite> {
  return cached(ck(arc, `product:${id}`), 15_000, async () => {
    const p = await read<any>(arc, arc.d.productRegistry, productRegistryAbi, "getProduct", [id]);
    return {
      id, author: p.author, deterministic: p.deterministic, price: p.price,
      bpsOperator: Number(p.bpsOperator), bpsAuthor: Number(p.bpsAuthor), bpsNetwork: Number(p.bpsNetwork),
      minBond: p.minBond, exposureCap: p.exposureCap, settlement: p.settlement, param: p.param,
      state: STATES[Number(p.state)] ?? "None",
    };
  });
}

export function railOf(arc: ArcClient, settlement: string): string {
  const s = settlement.toLowerCase();
  if (s === arc.d.sessionPay.toLowerCase()) return "SessionPay (session prépayée, reçus cumulatifs)";
  if (s === arc.d.x402Settler.toLowerCase()) return "X402Settler (paiement à l'appel, x402)";
  if (s === arc.d.sealedBounty.toLowerCase()) return "SealedBounty (Prime scellée)";
  if (arc.d.levels && s === arc.d.levels.sealedBountyVerified.toLowerCase()) return "SealedBountyVerified (Prime scellée au niveau vérifié : puce déclarée par un auditeur, via PolicyEnclaves)";
  if (/^0x0{40}$/.test(s)) return "aucun (service gratuit, attesté : ex. le copilote en enclave)";
  return "contrat de règlement inconnu";
}

/** 18/11 : le contrat de Prime scellée qui règle ce produit : SealedBounty (niveau ouvert, produit 2) ou, sur la pile des
 *  niveaux, SealedBountyVerified (niveau vérifié, produit 7 : même code, branché sur PolicyEnclaves) ; undefined pour tout
 *  autre règlement (dont l'ancienne Prime vérifiée du produit 6, neutralisée le 11/11). createBounty refuse un produit
 *  réglé par un autre contrat (WrongSettlement) : la prime se prépare donc toujours sur CE contrat. */
export function bountyContractOf(arc: ArcClient, settlement: string): { address: Address; verified: boolean } | undefined {
  const s = settlement.toLowerCase();
  if (s === arc.d.sealedBounty.toLowerCase()) return { address: arc.d.sealedBounty, verified: false };
  if (arc.d.levels && s === arc.d.levels.sealedBountyVerified.toLowerCase()) return { address: arc.d.levels.sealedBountyVerified, verified: true };
  return undefined;
}

// ---------------------------------------------------------------- formats et entrées

export const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const fmtAmount = (v: bigint, decimals: number, label: string) => `${formatUnits(v, decimals)} ${label}`;
const iso = (ts: bigint) => new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
export function duree(sec: bigint | number): string {
  let s = Math.abs(Number(sec));
  const j = Math.floor(s / 86400); s -= j * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts: string[] = [];
  if (j) parts.push(`${j} j`);
  if (h) parts.push(`${h} h`);
  if (m && !j) parts.push(`${m} min`);
  if (!parts.length) parts.push(`${s} s`);
  return parts.join(" ");
}
const relatif = (target: bigint, now: bigint) => (target >= now ? `dans ${duree(target - now)}` : `il y a ${duree(now - target)}`);

const present = (x: unknown) => x !== undefined && x !== null && String(x).trim() !== "";
export function addr(x: unknown, label = "adresse"): Address {
  const s = String(x ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error(`${label} invalide : « ${s} » (attendu 0x suivi de 40 caractères hexadécimaux)`);
  return getAddress(s.toLowerCase());
}
const optAddr = (x: unknown, label: string) => (present(x) ? addr(x, label) : undefined);
export function parseId(x: unknown, label: string): bigint {
  const s = String(x ?? "").trim().replace(/^#/, "");
  if (!/^\d+$/.test(s)) throw new Error(`${label} invalide : « ${String(x ?? "")} » (entier attendu)`);
  return BigInt(s);
}
export function parseAmount(x: unknown, decimals: number, label: string): bigint {
  const s = String(x ?? "").trim().replace(/\s*(usdc|eurc)$/i, "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`${label} invalide : « ${String(x ?? "")} » (attendu un nombre, ex. 5 ou 0.25)`);
  if ((s.split(".")[1] ?? "").length > decimals) throw new Error(`${label} : ${decimals} décimales au plus`);
  return parseUnits(s, decimals);
}
export const parseUsdc = (x: unknown, label = "montant") => parseAmount(x, 6, label);
function hexStr(x: unknown, label: string): Hex {
  const s = String(x ?? "").trim();
  if (!/^0x([0-9a-fA-F]{2})*$/.test(s)) throw new Error(`${label} : hexadécimal 0x… attendu`);
  return s.toLowerCase() as Hex;
}
function intStr(x: unknown, label: string): string {
  const s = String(x ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label} : entier en unités de base attendu (ex. "1000000" = 1 USDC)`);
  return BigInt(s).toString();
}
const short = (h: string, n = 18) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-8)}` : h);

/** JSON à clés triées (empreinte stable d'un manifeste). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

// ---------------------------------------------------------------- URL d'enclave (/attest, /pubkeys)

/** Lit le corps d'une réponse HTTP, borné à `max` octets. */
async function readBodyCapped(res: Response, max = 4_000_000): Promise<string> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { await reader.cancel(); throw new Error(`réponse trop grande (plus de ${Math.round(max / 1e6)} Mo)`); }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** Taille maximale d'une réponse de passerelle d'enclave (un quote TDX et son journal d'événements font quelques Ko). */
const ENCLAVE_MAX_BYTES = 1_000_000;
const ENCLAVE_TIMEOUT_MS = 15_000;

/** La politique d'URL d'enclave d'un contexte (copilote ou MCP). */
export const enclavePolicyOf = (cx: ActionCtx): EnclavePolicy => ({ allowPrivate: !!cx.allowPrivateUrls, prefixes: cx.enclavePathPrefixes });

/** Options réseau des sondes (tests : résolveur, requêteur et adresses permises simulés). */
export type ProbeNet = Pick<GuardOptions, "resolve" | "isAllowed" | "timeoutMs"> & { request?: Requester };

/** Erreur d'une sonde, sans rien de ce que l'hôte a renvoyé : nos propres messages (URL refusée, redirection refusée,
 *  délai, taille), sinon le code de l'erreur réseau. */
function probeError(u: URL, e: any): Error {
  if (e instanceof BlockedUrlError) return e;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return new Error(`délai dépassé (15 s) en appelant ${u.origin}${u.pathname}`);
  const msg = String(e?.message ?? "");
  if (/^(délai dépassé|réponse trop grande|réponse interrompue)/.test(msg)) return new Error(msg.slice(0, 200));
  const code = String(e?.code ?? e?.cause?.code ?? e?.name ?? "erreur réseau").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "erreur réseau";
  return new Error(`${u.origin}${u.pathname} injoignable (${code})`);
}

/** Lit le JSON d'une route d'enclave (jamais de clé envoyée) : https, port 443, chemin fixe ; hôte résolu UNE fois,
 *  adresse publique exigée, connexion à cette adresse (pas de rebinding DNS), aucune redirection, délai, taille bornée
 *  (net-guard.ts). Réponse non 2xx : seul le statut est rendu, le corps n'est jamais lu. allowPrivate (développement
 *  local) : réseau privé, http et tout port permis, avec les mêmes autres gardes. Exporté pour les tests. */
export async function fetchEnclaveJson(base: string, route: EnclaveRoute, body: unknown | undefined, policy: EnclavePolicy, net: ProbeNet = {}): Promise<any> {
  const u = enclaveEndpoint(base, route, policy);
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init = { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) };
  let res: Response;
  let text: string;
  try {
    res = await safeFetch(u, init, { timeoutMs: ENCLAVE_TIMEOUT_MS, maxBytes: ENCLAVE_MAX_BYTES, allowPrivate: !!policy.allowPrivate, discardErrorBody: true, ...net });
    if (!res.ok) throw new BlockedUrlError(`${route} de ${u.host} a répondu HTTP ${res.status} (corps non lu)`);
    text = await readBodyCapped(res, ENCLAVE_MAX_BYTES); // le délai couvre aussi la lecture du corps
  } catch (e) {
    throw probeError(u, e);
  }
  try { return JSON.parse(text); } catch { throw new Error(`${route} de ${u.host} : réponse non JSON`); }
}

/** En-têtes d'un RequestInit (objet, tableau ou Headers) en objet simple. */
function headersRecord(h: unknown): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  new Headers(h as any).forEach((v, k) => { out[k] = v; });
  return out;
}

/** fetch pour le SDK (verifyEnclaveKeys → GET …/pubkeys) avec les mêmes gardes que fetchEnclaveJson : seule une URL de
 *  route d'enclave passe ; réponse non 2xx rendue SANS corps ; réponse 2xx rendue seulement si c'est du JSON (sinon
 *  « réponse non JSON », sans rien recopier). Exporté pour les tests. */
export function guardedFetch(policy: EnclavePolicy, net: ProbeNet = {}): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input);
    const u = enclaveRouteUrl(url, policy);
    let res: Response;
    let text: string;
    try {
      res = await safeFetch(u, {
        method: init?.method, headers: headersRecord(init?.headers), signal: init?.signal ?? null,
        body: typeof init?.body === "string" ? init.body : undefined,
      }, { timeoutMs: ENCLAVE_TIMEOUT_MS, maxBytes: ENCLAVE_MAX_BYTES, allowPrivate: !!policy.allowPrivate, discardErrorBody: true, ...net });
      if (!res.ok || res.status === 204 || res.status === 205) return new Response(null, { status: res.status }); // corps jamais lu
      text = await readBodyCapped(res, ENCLAVE_MAX_BYTES);
    } catch (e) {
      throw probeError(u, e);
    }
    try { JSON.parse(text); } catch { throw new Error(`${u.pathname} : réponse non JSON`); }
    return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Durée approximative d'un nombre de blocs (BLOCK_TIME_MS du registre). */
async function blocksDuree(arc: ArcClient, blocks: bigint): Promise<string> {
  const ms = await constant<bigint>(arc, arc.d.enclaveRegistry, "BLOCK_TIME_MS");
  return `${blocks} blocs ≈ ${duree((blocks * ms) / 1000n)}`;
}

// ---------------------------------------------------------------- autorisation EIP-3009 (données à signer)

function eip3009(arc: ArcClient, from: Address | undefined, to: Address, value: bigint, now: bigint) {
  const validBefore = now + 3600n; // une heure pour signer et envoyer (comme le SDK)
  const nonce = freshNonce(); // un nonce n'est pas un secret : le wallet le signe
  return {
    typedData: {
      domain: usdcDomain(arc.d.usdc, arc.d.chainId),
      types: receiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization" as const,
      message: { from: from ?? "<ton adresse>", to, value: value.toString(), validAfter: "0", validBefore: validBefore.toString(), nonce },
    },
    auth: { validAfter: "0", validBefore: validBefore.toString(), nonce, signature: "<signature EIP-712 de autorisationEIP3009, faite dans ton wallet>" },
  };
}

const TCB: Record<number, string> = {
  0: "OK (UpToDate)", 1: "SW_HARDENING_NEEDED", 2: "CONFIGURATION_AND_SW_HARDENING_NEEDED", 3: "CONFIGURATION_NEEDED",
  4: "OUT_OF_DATE", 5: "OUT_OF_DATE_CONFIGURATION_NEEDED", 6: "REVOKED", 7: "UNRECOGNIZED",
};
const tcbView = (code: number) => ({
  code, statut: TCB[code] ?? "inconnu",
  accepte: code === 0 ? "oui" : code === 1 ? "oui si tous les avis Intel sont tolérés par le produit" : "non (politique P2 : on échoue fermé)",
});

// ================================================================ ÉTATS (lecture)

/** enclaves.status — une enclave par son signataire, et la caution de son opérateur. */
export async function enclaveStatus(arc: ArcClient, signerIn: unknown) {
  const signer = addr(signerIn, "signataire de l'enclave");
  const e = await read<any>(arc, arc.d.enclaveRegistry, enclaveRegistryAbi, "enclaveOf", [signer]);
  if (!e || e.signer === ZERO) {
    const list = await listOrReason(enclavesCached(arc));
    if (!list.ok) {
      return {
        trouvee: false,
        message: `Aucune enclave inscrite avec le signataire ${signer} (EnclaveRegistry.enclaveOf, lu on-chain). Impossible de vérifier si c'est plutôt un opérateur : ${list.indisponible}`,
      };
    }
    const mine = list.v.filter((x) => x.operator.toLowerCase() === signer.toLowerCase());
    return mine.length
      ? {
          trouvee: false,
          message: `${signer} n'est pas une clé d'enclave mais un OPÉRATEUR : voici ses enclaves (relance avec un signataire).`,
          enclavesDeCetOperateur: mine.map((x) => ({ signataire: getAddress(x.signer), produit: x.productId.toString(), active: x.active })),
        }
      : { trouvee: false, message: `Aucune enclave inscrite avec le signataire ${signer} (EnclaveRegistry.enclaveOf). La ruche complète : enclaves_list.` };
  }
  const h = await headBlock(arc);
  const pid = BigInt(e.productId);
  const op = getAddress(e.operator) as Address;
  const opNow = await read<Address>(arc, arc.d.enclaveRegistry, enclaveRegistryAbi, "activeOperatorAt", [signer, pid, h.number]);
  const activeNow = opNow !== ZERO;
  const grace = await constant<bigint>(arc, arc.d.enclaveRegistry, "GRACE_BLOCKS");
  const settleUntil = await read<bigint>(arc, arc.d.enclaveRegistry, extraAbi, "settleableUntilBlock", [signer]);
  const p = await productLite(arc, pid);
  const bond = await read<bigint>(arc, arc.d.operatorBond, operatorBondAbi, "bondOf", [op]);
  const avail = await read<bigint>(arc, arc.d.operatorBond, operatorBondAbi, "availableBond", [op]);
  const free = await read<bigint>(arc, arc.d.operatorBond, extraAbi, "freeBond", [op]);
  const exposure = await read<bigint>(arc, arc.d.operatorBond, operatorBondAbi, "exposureOf", [op, pid]);
  const banned = await read<boolean>(arc, arc.d.operatorBond, operatorBondAbi, "banned", [op]);
  const cap = avail / 2n < p.exposureCap || p.exposureCap === 0n ? avail / 2n : p.exposureCap;
  const expiresAt = BigInt(e.expiresAt);
  const from = BigInt(e.fromBlock), until = BigInt(e.untilBlock);
  const enGrace = h.number <= settleUntil;
  return {
    trouvee: true,
    signataire: signer,
    operateur: op,
    produit: { id: pid.toString(), etat: p.state, rail: railOf(arc, p.settlement), prixParUnite: usdc(p.price), cautionMinimale: usdc(p.minBond) },
    activeMaintenant: activeNow,
    etat: activeNow
      ? "active : elle peut signer des reçus maintenant"
      : enGrace
        ? `${e.active ? "fenêtre de validité écoulée" : "retirée ou invalidée"}, en grâce jusqu'au bloc ${settleUntil} : ses reçus ancrés dans sa fenêtre restent réglables`
        : e.active ? "expirée (grâce passée) : l'opérateur doit la réattester" : "désactivée (invalidée ou retirée)",
    fenetreDeValidite: { deBloc: from.toString(), aBloc: until.toString(), restant: h.number <= until ? await blocksDuree(arc, until - h.number) : "écoulée", grace: await blocksDuree(arc, grace) },
    reglableJusquAuBloc: settleUntil.toString(),
    inscriteLe: iso(BigInt(e.registeredAt)),
    expireLe: `${iso(expiresAt)} (indicatif : la règle est en blocs)`,
    expiration: relatif(expiresAt, h.timestamp),
    tcb: tcbView(Number(e.tcbStatus)),
    workloadId: e.workloadId,
    fmspc: e.fmspc,
    clePubliqueX25519: e.x25519,
    quoteHash: e.quoteHash,
    blocDAncrage: BigInt(e.anchorBlock).toString(),
    cautionDeLOperateur: {
      totale: usdc(bond),
      disponible: usdc(avail),
      libre: `${usdc(free)} (chaque clé inscrite réserve la caution minimale de son produit)`,
      enCoursDeRetrait: usdc(bond - avail),
      expositionSur24hPourCeProduit: usdc(exposure),
      plafondSur24hParProduit: usdc(cap),
      margeRestante: usdc(cap > exposure ? cap - exposure : 0n),
      couvreLaCautionMinimale: avail >= p.minBond,
      banni: banned,
    },
    lueAuBloc: h.number.toString(),
    sources: ["EnclaveRegistry.enclaveOf / activeOperatorAt / settleableUntilBlock", "OperatorBond.bondOf / availableBond / freeBond / exposureOf / banned", "ProductRegistry.getProduct"],
  };
}

/** session.status — une session SessionPay par son id. */
export async function sessionStatus(arc: ArcClient, sessionIdIn: unknown) {
  const sid = parseId(sessionIdIn, "sessionId");
  const s = await read<any>(arc, arc.d.sessionPay, sessionPayAbi, "getSession", [sid]);
  if (!s || s.owner === ZERO) {
    const n = await read<bigint>(arc, arc.d.sessionPay, sessionPayAbi, "sessionCount");
    return { trouvee: false, sessionId: sid.toString(), message: `Session #${sid} inconnue : SessionPay compte ${n} session(s), numérotées de 1 à ${n}.` };
  }
  const p = await productLite(arc, BigInt(s.productId));
  const h = await headBlock(arc);
  const settleGrace = await constant<bigint>(arc, arc.d.sessionPay, "SETTLE_GRACE");
  const deposit = BigInt(s.deposit), cap = BigInt(s.cap), paid = BigInt(s.paid), expiresAt = BigInt(s.expiresAt);
  const price = BigInt(s.price); // locked when the session opens
  const ceiling = cap === 0n ? deposit : (cap < deposit ? cap : deposit);
  const remaining = ceiling > paid ? ceiling - paid : 0n;
  const closableAt = expiresAt + settleGrace;
  const enclaveUntil = await read<bigint>(arc, arc.d.enclaveRegistry, extraAbi, "settleableUntilBlock", [s.enclave]);
  const closableNow = h.timestamp >= closableAt || h.number > enclaveUntil;
  return {
    trouvee: true,
    sessionId: sid.toString(),
    proprietaire: s.owner,
    produit: { id: BigInt(s.productId).toString(), rail: railOf(arc, p.settlement), prixDuProduitAujourdHui: usdc(p.price) },
    verrouilleALOuverture: { prixParUnite: usdc(price), modele: s.param, uniteJetons: Number(s.unitTokens), poidsSortie: Number(s.outWeight) },
    enclave: s.enclave,
    operateur: s.operator,
    clePubliqueDeSession: s.sessionKey,
    depot: usdc(deposit),
    plafond: cap === 0n ? "aucun (= le dépôt)" : usdc(cap),
    dejaRegle: usdc(paid),
    unitesReglees: BigInt(s.paidUnits).toString(),
    resteUtilisable: usdc(remaining),
    unitesRestantes: price > 0n ? (remaining / price).toString() : "illimité (prix nul)",
    remboursableALaFermeture: usdc(deposit - paid),
    expireLe: iso(expiresAt),
    expiration: relatif(expiresAt, h.timestamp),
    fermee: s.closed,
    fermeture: s.closed ? "déjà fermée" : closableNow
      ? "closeSession possible maintenant (propriétaire) : rembourse le reste et écrit le verdict ERC-8004"
      : `closeSession par le propriétaire à partir du ${iso(closableAt)} (échéance + ${duree(settleGrace)}), ou dès le bloc ${enclaveUntil + 1n} si l'enclave liée ne peut plus rien régler : rembourse le reste`,
    verdictEcrit: s.verdictWritten,
    note: "Seul le cumul RÉGLÉ est on-chain ; la consommation pas encore réglée est dans le dernier reçu cumulatif signé par l'enclave. Seuls les reçus de l'enclave verrouillée paient cette session.",
    lueAuBloc: h.number.toString(),
    sources: ["SessionPay.getSession", "EnclaveRegistry.settleableUntilBlock", "ProductRegistry.getProduct"],
  };
}

/** bounty.list — les primes (et le détail d'une prime avec ses paliers). */
export async function bountyList(arc: ArcClient, q: { onlyOpen?: unknown; bountyId?: unknown } = {}, cx: ActionCtx = {}) {
  const bs = await bountiesCached(arc, cx);
  const h = await headBlock(arc);
  const netBps = BigInt(await constant<number>(arc, arc.d.sealedBounty, "networkBountyBps"));
  const opBps = BigInt(await constant<number>(arc, arc.d.sealedBounty, "operatorBountyBps"));
  const rows = bs.map((b) => {
    const expiree = h.timestamp > b.deadline;
    return {
      id: b.id.toString(),
      protocole: b.protocol,
      produit: b.productId.toString(),
      solde: usdc(b.balance),
      echeance: iso(b.deadline),
      echeanceRelative: relatif(b.deadline, h.timestamp),
      enPause: b.paused,
      expiree,
      ouverte: !b.paused && !expiree && b.balance > 0n,
      cibleMiseEnPause: b.targetToPause === ZERO ? null : b.targetToPause,
      dejaPayeDepuisLArmement: usdc(b.paidAmount),
    };
  });
  const onlyOpen = q.onlyOpen === true || String(q.onlyOpen) === "true";
  let detail: unknown;
  if (present(q.bountyId)) {
    const id = parseId(q.bountyId, "bountyId");
    const b = await read<any>(arc, arc.d.sealedBounty, sealedBountyAbi, "getBounty", [id]);
    if (!b || b.protocol === ZERO) detail = { trouvee: false, message: `Prime #${id} inconnue.` };
    else {
      const paliers: unknown[] = [];
      for (let i = 0n; i < 8n; i++) {
        let min: bigint;
        try { min = await read<bigint>(arc, arc.d.sealedBounty, extraAbi, "tierMinLoss", [id, i]); } catch { break; } // fin du tableau
        const amt = await read<bigint>(arc, arc.d.sealedBounty, extraAbi, "tierAmount", [id, i]);
        const net = (amt * netBps) / 10_000n, op = (amt * opBps) / 10_000n;
        paliers.push({ palier: Number(i), perteMinimale: `${min} (unités de base ; ${usdc(min)} si la perte est mesurée en USDC)`, chasseur: usdc(amt), reseau: usdc(net), operateurs: usdc(op), totalPrisDuPool: usdc(amt + net + op) });
      }
      detail = {
        id: id.toString(), protocole: b.protocol, produit: BigInt(b.productId).toString(), predicateHash: b.predicateHash,
        clePubliqueX25519DuProtocole: b.protocolX25519, singleCap: usdc(BigInt(b.singleCap)), k: Number(b.k), paliers,
        dejaPaye: usdc(BigInt(b.paidAmount)),
        regleV2: `un exploit n'est payé qu'une fois par palier et par armement : un palier plus haut ne paie que la différence, et la réclamation doit être ancrée après le bloc ${BigInt(b.lastPaidBlock)} (dernier paiement ou réarmement)`,
        pauseDepuisLeBloc: b.paused ? BigInt(b.pausedFromBlock).toString() : null,
      };
    }
  }
  return {
    total: rows.length,
    ouvertes: rows.filter((r) => r.ouverte).length,
    primes: onlyOpen ? rows.filter((r) => r.ouverte) : rows,
    detail,
    economie: `Le chasseur touche 100 % du palier ; en plus, pris sur le pool : ${Number(netBps) / 100} % pour le réseau et ${Number(opBps) / 100} % partagés entre les opérateurs vérificateurs. Paiement v2 en deux temps : acceptClaim vérifie la preuve et RÉSERVE le paiement (le rapport chiffré n'est pas dans cette transaction), puis deliver livre le rapport au protocole et paie.`,
    lueAuBloc: h.number.toString(),
    liste: await freshness({ base: cx.apiBase }),
    sources: ["API ArcHive /bounties (index des événements BountyCreated + getBounty)", "SealedBounty.networkBountyBps / operatorBountyBps"],
  };
}

// ================================================================ LISTES (index de l'API ArcHive)

const isoOrNull = (ts: bigint) => (ts > 0n ? iso(ts) : null);

/** enclaves.list — la ruche : toutes les enclaves inscrites, actives ou non au bloc de tête de l'API. */
export async function enclavesList(_arc: ArcClient, q: { onlyActive?: unknown } = {}, cx: ActionCtx = {}) {
  const es = await enclavesCached(_arc, cx);
  const onlyActive = q.onlyActive === true || String(q.onlyActive) === "true";
  const rows = (onlyActive ? es.filter((e) => e.active) : es).map((e) => ({
    signer: getAddress(e.signer), operator: getAddress(e.operator), productId: e.productId.toString(), active: e.active,
    tcb: TCB[e.tcbStatus] ?? `inconnu (${e.tcbStatus})`, fenetreDeValidite: `blocs ${e.fromBlock} → ${e.untilBlock}`,
    clePubliqueX25519: e.x25519, workloadId: e.workloadId,
  }));
  return {
    total: es.length, actives: es.filter((e) => e.active).length, enclaves: rows,
    lueAuBloc: es.find((e) => e.head !== undefined)?.head?.toString() ?? null,
    liste: await freshness({ base: cx.apiBase }),
  };
}

/** products.list — les produits (actifs seulement par défaut : un produit retiré ne doit jamais être proposé). */
export async function productsList(arc: ArcClient, q: { all?: unknown } = {}, cx: ActionCtx = {}) {
  const ps = await productsCached(arc, cx);
  const all = q.all === true || String(q.all) === "true";
  const rows = (all ? ps : ps.filter((p) => p.state === "Active")).map((p) => ({
    id: p.id.toString(), state: p.state, deterministic: p.deterministic, pricePerUnit: usdc(p.price), settlement: p.settlement,
    rail: railOf(arc, p.settlement), minBond: usdc(p.minBond), exposureCap: usdc(p.exposureCap), author: p.author,
    parts: { bpsOperator: Number(p.bpsOperator), bpsAuthor: Number(p.bpsAuthor), bpsNetwork: Number(p.bpsNetwork) },
    unitTokens: p.unitTokens, outWeight: p.outWeight, manifestURI: p.manifestURI || null,
  }));
  return {
    total: ps.length, actifs: ps.filter((p) => p.state === "Active").length, produits: rows,
    source: `API ArcHive ${archiveBase(cx.apiBase)}/products (ProductRegistry.productCount + getProduct, read on-chain by the API)`,
  };
}

/** sessions.list — les sessions SessionPay ouvertes par un compte (défaut : le wallet connecté). */
export async function sessionsList(_arc: ArcClient, q: { owner?: unknown } = {}, cx: ActionCtx = {}) {
  const owner = optAddr(q.owner, "owner") ?? cx.user;
  if (!owner) return { disponible: false, erreur: "owner requis : l'adresse 0x… du compte (ou connectez votre wallet)." };
  const ss = await apiSessions(owner, { base: cx.apiBase });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const rows = ss.map((s) => ({
    id: s.id.toString(), productId: s.productId.toString(), depot: usdc(s.deposit), dejaRegle: usdc(s.paid),
    reste: usdc(s.deposit > s.paid ? s.deposit - s.paid : 0n), fermee: s.closed, enclave: s.enclave, operateur: s.operator,
    prixParUnite: usdc(s.price), unitesReglees: s.paidUnits.toString(), expireLe: isoOrNull(s.expiresAt),
    echue: s.expiresAt > 0n && s.expiresAt <= now, verdictEcrit: s.verdictWritten,
  }));
  return {
    proprietaire: owner, total: rows.length, ouvertes: rows.filter((r) => !r.fermee).length, sessions: rows,
    note: "Seul le cumul RÉGLÉ est on-chain ; pour le détail d'une session (plafond, reste exact, fermeture) : session_status.",
    liste: await freshness({ base: cx.apiBase }),
  };
}

/** activity.list — l'activité on-chain récente des contrats du réseau (du plus récent au plus ancien). */
export async function activityList(_arc: ArcClient, q: { limit?: unknown } = {}, cx: ActionCtx = {}) {
  const n = present(q.limit) ? Math.min(50, Math.max(1, Math.floor(Number(q.limit)) || 10)) : 10;
  const ev = await apiActivity(n, { base: cx.apiBase });
  return {
    evenements: ev.map((e) => ({ contrat: e.contract, evenement: e.name, args: e.args, bloc: e.block, tx: e.tx })),
    nombre: ev.length,
    note: `les ${n} derniers événements au plus, du plus récent au plus ancien`,
    liste: await freshness({ base: cx.apiBase }),
  };
}

// ================================================================ SESSION (préparée)

/** session.prepare_open — ouverture de session PRÉPARÉE (choix de l'opérateur, autorisation à signer). */
export async function prepareSessionOpen(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const es = await enclavesCached(arc, cx);
  // Produit demandé (ou aucun) sans enclave active : on bascule sur un produit d'inférence (SessionPay) ACTIF qui en a une,
  // pour que l'utilisateur puisse vraiment signer. Le changement est dit dans la réponse (produitDemande).
  const asked = q.productId !== undefined && q.productId !== null && String(q.productId) !== "" ? parseId(q.productId, "productId") : undefined;
  let pid = asked ?? 0n;
  if (asked === undefined || !es.some((e) => e.active && e.productId === asked)) {
    for (const e of es.filter((x) => x.active)) {
      const cand = await productLite(arc, e.productId);
      if (cand.state === "Active" && cand.settlement.toLowerCase() === arc.d.sessionPay.toLowerCase()) { pid = e.productId; break; }
    }
    if (pid === 0n && asked !== undefined) pid = asked;
  }
  const p = await productLite(arc, pid);
  if (p.state === "None") throw new Error(`Produit #${pid} inconnu.`);
  const deposit = parseUsdc(q.deposit, "deposit");
  const user = optAddr(q.user, "user") ?? cx.user;
  const actives = es.filter((e) => e.active && e.productId === pid);
  const operator = optAddr(q.operator, "operator") ?? (actives[0] ? getAddress(actives[0].operator) : undefined);
  // the session is locked to ONE enclave (OpenParams.enclave): an active enclave of this operator
  const enclave = actives.find((e) => operator && e.operator.toLowerCase() === operator.toLowerCase());
  const h = await headBlock(arc);
  const verifications = [
    { ok: p.state === "Active", quoi: `produit #${pid} : ${p.state}${p.state === "Active" ? "" : " (openSession reverterait : BadProduct)"}` },
    { ok: actives.length > 0, quoi: `${actives.length} enclave(s) active(s) sur ce produit` },
  ];
  if (operator && !enclave) {
    verifications.push({ ok: false, quoi: `l'opérateur ${operator} n'a pas d'enclave active sur ce produit : openSession reverterait (InactiveEnclave)` });
  }
  if (p.price === 0n) verifications.push({ ok: false, quoi: "produit au prix 0 : openSession reverterait (ZeroPrice)" });
  if (user) {
    const bal = await arc.usdcBalance(user);
    verifications.push({ ok: bal >= deposit, quoi: `solde USDC de ${user} : ${usdc(bal)} (dépôt : ${usdc(deposit)})` });
  }
  const a = eip3009(arc, user, arc.d.sessionPay, deposit, h.timestamp);
  const expiresAt = h.timestamp + 86_400n; // proposed expiry: 24 h (the SDK's default); allowed range: 10 min to 30 days
  return {
    note: "Ouvre une session : signe l'autorisation EIP-3009 ci-dessous. La clé de session naît dans ton navigateur, jamais ici.",
    execute: false,
    requiresSignature: true,
    eip3009: { domain: a.typedData.domain, spender: arc.d.sessionPay, value: deposit.toString(), product: pid.toString(), pricePerUnit: usdc(p.price) },
    produit: { id: pid.toString(), rail: railOf(arc, p.settlement), prixParUnite: usdc(p.price) },
    produitDemande: asked !== undefined && asked !== pid ? `le produit #${asked} n'a aucune enclave active : session préparée sur le produit #${pid}, qui en a une` : undefined,
    operateur: operator ?? "<aucune enclave active : choisis un opérateur avec enclaves_list>",
    depot: usdc(deposit),
    unitesCouvertesParLeDepot: p.price > 0n ? (deposit / p.price).toString() : "illimité (prix nul)",
    lecture: "inférence : chaque jeton de la question et de la réponse compte 1 unité. Le dépôt couvre ce nombre de jetons pour TOUTE la session (une boucle de requêtes), pas ce nombre de requêtes.",
    attention: p.price > 0n && deposit / p.price < 1000n
      ? `Ce dépôt ne couvre que ${deposit / p.price} jeton(s) au total, pour toute la session. Une session sert une boucle de requêtes : dépose le coût de plusieurs requêtes.`
      : undefined,
    verifications,
    autorisationEIP3009: a.typedData,
    enclave: enclave ? { signataire: getAddress(enclave.signer), operateur: getAddress(enclave.operator), fenetreJusquAuBloc: enclave.untilBlock.toString() } : null,
    openSessionParams: {
      productId: pid.toString(), operator: operator ?? "<opérateur>",
      sessionKey: "<adresse PUBLIQUE de ta clé de session, générée dans ton navigateur>",
      expiresAt: expiresAt.toString(), deposit: deposit.toString(), cap: "0", auth: a.auth,
      enclave: enclave ? getAddress(enclave.signer) : "<signataire de l'enclave choisie>",
    },
    securite: "v2 : seuls les reçus de cette enclave paieront la session. Avant de chiffrer quoi que ce soit, ton navigateur (ou le SDK) confronte la clé X25519 servie par l'enclave à celle inscrite on-chain (verifyEnclaveKeys) : une clé différente est refusée.",
    ouSigner: "page Utiliser → Inférence privée (wallet connecté) ; ou sur ta machine : arcvault session open --product <id> --enclave <URL de l'enclave> --deposit <USDC>",
    lueAuBloc: h.number.toString(),
  };
}

// ================================================================ PRIME (préparée)

function normalizeClause(c: any, i: number): Clause {
  const L = `clause ${i + 1}`;
  switch (String(c?.type ?? "").toUpperCase()) {
    case "ERC20_DROP": return { type: "ERC20_DROP", token: addr(c.token, `${L}.token`), holder: addr(c.holder, `${L}.holder`), min: intStr(c.min, `${L}.min`) };
    case "NATIVE_DROP": return { type: "NATIVE_DROP", holder: addr(c.holder, `${L}.holder`), min: intStr(c.min, `${L}.min`) };
    case "ATTACKER_PROFIT": return { type: "ATTACKER_PROFIT", token: addr(c.token, `${L}.token`), min: intStr(c.min, `${L}.min`) };
    case "VIEW_CHANGED": {
      const op = String(c.op ?? "");
      if (!["eq", "neq", "gt", "lt"].includes(op)) throw new Error(`${L}.op : eq, neq, gt ou lt`);
      return { type: "VIEW_CHANGED", target: addr(c.target, `${L}.target`), call: hexStr(c.call, `${L}.call`), op: op as "eq", value: intStr(c.value, `${L}.value`) };
    }
    case "INVARIANT_BROKEN": return { type: "INVARIANT_BROKEN", target: addr(c.target, `${L}.target`), call: hexStr(c.call, `${L}.call`) };
    default: throw new Error(`${L} : type inconnu « ${c?.type} » (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)`);
  }
}
function normalizePredicate(raw: unknown): Predicate {
  const o = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!o || typeof o !== "object") throw new Error("predicate : objet JSON { combine, clauses } attendu");
  const p = {
    combine: String((o as any).combine ?? "OR").toUpperCase(),
    clauses: (Array.isArray((o as any).clauses) ? (o as any).clauses : []).map(normalizeClause),
  } as Predicate;
  validatePredicate(p);
  return p;
}

/** bounty.prepare_create — création de prime PRÉPARÉE, avec l'assistant de prédicat. Rien n'est envoyé. */
export async function prepareBountyCreate(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const aCompleter: string[] = [];
  const avertissements: string[] = [];
  const verifications: Array<{ ok: boolean; quoi: string }> = [];
  const infos: Record<string, unknown> = {};

  // 1) le produit « Prime scellée » : sans productId, le niveau ouvert (règlement = SealedBounty) ; productId 7 (ou tout
  //    produit réglé par SealedBountyVerified) = le niveau vérifié, préparé sur SealedBountyVerified (18/11)
  let product: ProductLite | undefined;
  if (present(q.productId)) product = await productLite(arc, parseId(q.productId, "productId"));
  else {
    const cands = (await productsCached(arc, cx)).filter((p) => p.state === "Active" && p.settlement.toLowerCase() === arc.d.sealedBounty.toLowerCase());
    const best = cands.find((p) => p.deterministic) ?? cands[0];
    if (best) product = liteOf(best);
  }
  if (!product || product.state === "None") throw new Error("Aucun produit « Prime scellée » actif trouvé (règlement SealedBounty).");
  verifications.push({ ok: product.state === "Active", quoi: `produit #${product.id} : ${product.state}${product.state === "Active" ? "" : " (createBounty reverterait : BadProduct)"}` });
  const rail = bountyContractOf(arc, product.settlement);
  /** Le contrat de la prime : celui qui règle le produit (createBounty, autorisation EIP-3009, frais, MAX_SIGS). */
  const bounty: Address = rail?.address ?? arc.d.sealedBounty;
  const bountyName = rail?.verified ? "SealedBountyVerified" : "SealedBounty";
  if (!rail) {
    avertissements.push(`Le produit #${product.id} n'est réglé par aucune Prime scellée en service (${railOf(arc, product.settlement)}) : createBounty reverterait (WrongSettlement). Choisis le produit 2 (niveau ouvert) ou 7 (niveau vérifié) ; le produit 6, neutralisé le 11/11, est remplacé par le 7.`);
    aCompleter.push("productId : un produit de Prime scellée en service (2 = niveau ouvert, 7 = niveau vérifié)");
  }
  if (!product.deterministic) avertissements.push(`Le produit #${product.id} n'est pas déterministe : le rejeu d'un exploit doit l'être.`);
  if (rail?.verified) {
    // niveau vérifié : la prime se crée et se finance dès maintenant, mais acceptClaim appelle OperatorBond.consumeExposure,
    // qui n'accepte qu'un contrat de règlement AUTORISÉ (8 jours après sa proposition, puis applySettlement)
    infos.niveau = "vérifié : seules comptent les enclaves dont la puce (PPID lu dans le certificat d'Intel) est déclarée par un auditeur accepté par le produit (Proof of Cloud), vérifié au règlement par PolicyEnclaves";
    const authorized = await read<boolean>(arc, arc.d.operatorBond, operatorBondAbi, "isSettlement", [bounty]);
    const applyAt = authorized ? 0n : BigInt(await read<bigint | number>(arc, arc.d.operatorBond, operatorBondAbi, "settlementApplyAt", [bounty]));
    verifications.push({ ok: authorized, quoi: authorized
      ? `${bountyName} est autorisé dans OperatorBond : une réclamation prouvée peut être payée`
      : `${bountyName} n'est pas encore autorisé dans OperatorBond${applyAt > 0n ? ` (applicable à partir du ${iso(applyAt)}, puis applySettlement)` : ""}` });
    if (!authorized) avertissements.push(`Tant que ${bountyName} n'est pas autorisé dans OperatorBond${applyAt > 0n ? ` (possible à partir du ${iso(applyAt)}, puis applySettlement)` : ""}, la prime peut être créée et financée, mais aucune réclamation ne peut être acceptée : choisis une échéance au-delà.`);
  }

  // 2) le prédicat : assistant guidé, ou prédicat complet fourni
  const token = optAddr(q.token, "token") ?? arc.d.usdc;
  const type = String(q.clauseType ?? "ERC20_DROP").toUpperCase();
  const target = optAddr(q.target, "contrat cible (target)");
  let predicate: Predicate | undefined;
  let lossDecimals = 6;
  let lossLabel = "USDC";
  if (present(q.predicate)) {
    predicate = normalizePredicate(q.predicate);
    if (predicate.clauses.every((c) => c.type === "NATIVE_DROP")) { lossDecimals = 18; lossLabel = "USDC natif (gas, 18 décimales)"; }
  } else {
    if (!["ERC20_DROP", "NATIVE_DROP", "ATTACKER_PROFIT"].includes(type)) {
      throw new Error(`clauseType « ${type} » : l'assistant guide ERC20_DROP, NATIVE_DROP et ATTACKER_PROFIT ; pour VIEW_CHANGED ou INVARIANT_BROKEN, passe le prédicat complet (predicate).`);
    }
    if (type === "NATIVE_DROP") { lossDecimals = 18; lossLabel = "USDC natif (gas, 18 décimales)"; }
    else if (token.toLowerCase() !== arc.d.usdc.toLowerCase()) {
      lossDecimals = Number(await read<number>(arc, token, extraAbi, "decimals"));
      lossLabel = await read<string>(arc, token, extraAbi, "symbol").catch(() => token);
    }
    if (type !== "ATTACKER_PROFIT" && !target) aCompleter.push("target : l'adresse du contrat dont le solde est surveillé (ex. le coffre du protocole)");
    if (!present(q.minDrop)) aCompleter.push(`minDrop : la baisse minimale qui prouve l'exploit (en ${lossLabel})`);
    if ((type === "ATTACKER_PROFIT" || target) && present(q.minDrop)) {
      const min = parseAmount(q.minDrop, lossDecimals, "minDrop").toString();
      const clause: Clause = type === "ERC20_DROP" ? { type: "ERC20_DROP", token, holder: target!, min }
        : type === "NATIVE_DROP" ? { type: "NATIVE_DROP", holder: target!, min }
        : { type: "ATTACKER_PROFIT", token, min };
      predicate = { combine: "OR", clauses: [clause] };
      infos.lecture = type === "ERC20_DROP" ? `exploit prouvé si le solde ${lossLabel} de ${target} baisse d'au moins ${formatUnits(BigInt(min), lossDecimals)} ${lossLabel}`
        : type === "NATIVE_DROP" ? `exploit prouvé si le solde natif de ${target} baisse d'au moins ${formatUnits(BigInt(min), lossDecimals)}`
        : `exploit prouvé si l'attaquant gagne au moins ${formatUnits(BigInt(min), lossDecimals)} ${lossLabel}`;
    }
  }

  // 3) les paliers (récompense en USDC ; perte minimale dans l'unité de la perte mesurée)
  let tiers: Array<{ minLoss: bigint; amount: bigint }> = [];
  if (Array.isArray(q.tiers) && q.tiers.length) {
    tiers = q.tiers.map((t: any, i: number) => ({
      minLoss: parseAmount(t?.minLoss ?? t?.min ?? "0", lossDecimals, `tiers[${i}].minLoss`),
      amount: parseUsdc(t?.amount ?? t?.reward, `tiers[${i}].amount`),
    }));
  } else if (present(q.reward)) {
    const minLoss = present(q.minDrop) ? parseAmount(q.minDrop, lossDecimals, "minDrop") : 0n;
    tiers = [{ minLoss, amount: parseUsdc(q.reward, "reward") }];
  } else aCompleter.push("reward : la récompense du chasseur en USDC (ou tiers : [{ minLoss, amount }] pour plusieurs paliers)");
  if (tiers.length > 8) throw new Error("8 paliers au plus");
  if (tiers.some((t) => t.amount === 0n)) throw new Error("chaque palier doit payer plus de 0 USDC");
  if (tiers.some((t, i) => i > 0 && (t.minLoss <= tiers[i - 1]!.minLoss || t.amount <= tiers[i - 1]!.amount))) {
    throw new Error("paliers : seuils de perte ET montants strictement croissants (sinon createBounty revert BadTiers)");
  }

  // 4) frais lus on-chain (sur le contrat de la prime), financement, k, plafond, échéance
  const netBps = BigInt(await constant<number>(arc, bounty, "networkBountyBps"));
  const opBps = BigInt(await constant<number>(arc, bounty, "operatorBountyBps"));
  const maxSigs = await constant<bigint>(arc, bounty, "MAX_SIGS");
  const econ = tiers.map((t, i) => {
    const net = (t.amount * netBps) / 10_000n, op = (t.amount * opBps) / 10_000n;
    return { i, total: t.amount + net + op, vue: { palier: i, perteMinimale: fmtAmount(t.minLoss, lossDecimals, lossLabel), chasseur: usdc(t.amount), reseau: usdc(net), operateurs: usdc(op), totalPrisDuPool: usdc(t.amount + net + op) } };
  });
  const maxTotal = econ.reduce((m, e) => (e.total > m ? e.total : m), 0n);
  const funding = present(q.funding) ? parseUsdc(q.funding, "funding") : maxTotal;
  if (tiers.length && funding < maxTotal) avertissements.push(`Le financement (${usdc(funding)}) ne couvre pas un paiement du plus haut palier (${usdc(maxTotal)} frais compris) : la réclamation reverterait (PoolTooSmall). fund() permet d'ajouter des fonds.`);
  const k = present(q.k) ? Number(q.k) : 1;
  if (!Number.isInteger(k) || k < 1 || BigInt(k) > maxSigs) throw new Error(`k doit être un entier de 1 à ${maxSigs} (MAX_SIGS lu on-chain)`);
  const maxAmount = tiers.reduce((m, t) => (t.amount > m ? t.amount : m), 0n);
  const singleCap = present(q.singleCap) ? parseUsdc(q.singleCap, "singleCap") : (k > 1 ? 0n : maxAmount);
  const h = await headBlock(arc);
  const days = present(q.deadlineDays) ? Number(q.deadlineDays) : 7;
  if (!(days > 0 && days <= 365)) throw new Error("deadlineDays : entre 1 et 365 jours");
  const deadline = h.timestamp + BigInt(Math.round(days * 86_400));
  const targetToPause = optAddr(q.targetToPause, "targetToPause") ?? ZERO;
  if (targetToPause !== ZERO) infos.miseEnPause = `${targetToPause} doit exposer pause() appelable par ${bountyName} (${bounty}) ; l'appel n'est jamais bloquant.`;

  // 5) la clé du protocole : PUBLIQUE seulement, générée chez lui
  let protocolX25519 = "<ta clé PUBLIQUE X25519 (0x + 64 hex), générée chez toi>";
  if (present(q.protocolX25519)) {
    const s = String(q.protocolX25519).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error("protocolX25519 : clé PUBLIQUE X25519 de 32 octets attendue (0x + 64 hex) ; ne donne jamais la clé privée");
    protocolX25519 = s.toLowerCase();
  } else aCompleter.push("protocolX25519 : ta clé PUBLIQUE X25519 (l'exploit te sera livré chiffré pour elle) ; génère la paire chez toi, voir cleDuProtocole");

  // 6) le wallet du protocole, la cible, les opérateurs capables de vérifier
  const from = optAddr(q.from, "from") ?? cx.user;
  if (!from) aCompleter.push("from : le wallet du protocole (celui qui finance et signe)");
  else {
    const bal = await arc.usdcBalance(from);
    verifications.push({ ok: bal >= funding, quoi: `solde USDC de ${from} : ${usdc(bal)} (financement : ${usdc(funding)})` });
  }
  if (target) {
    const code = await arc.pub.getCode({ address: target });
    const isContract = !!code && code !== "0x";
    verifications.push({ ok: isContract, quoi: isContract ? `${target} est bien un contrat` : `${target} n'a pas de code : ce n'est pas un contrat` });
    if (isContract && type === "ERC20_DROP" && !present(q.predicate)) {
      infos.soldeActuelDeLaCible = fmtAmount(await read<bigint>(arc, token, extraAbi, "balanceOf", [target]), lossDecimals, lossLabel);
    }
  }
  const es = await enclavesCached(arc, cx);
  const verifiers = new Set(es.filter((e) => e.active && e.productId === product!.id).map((e) => e.operator.toLowerCase()));
  verifications.push({ ok: verifiers.size >= k, quoi: `${verifiers.size} opérateur(s) distinct(s) ont une enclave active sur le produit #${product.id} (k = ${k})` });
  if (verifiers.size === 0) avertissements.push("Aucune enclave active sur ce produit pour l'instant : la prime peut être créée, mais aucun exploit ne sera prouvé tant qu'un opérateur n'en inscrit pas une.");

  // 7) les données à signer
  const ph = predicate ? predicateHash(predicate) : undefined;
  const a = eip3009(arc, from, bounty, funding, h.timestamp);
  const ready = !!predicate && tiers.length > 0 && !!rail;
  const params = ready ? {
    productId: product.id.toString(), predicateHash: ph, protocolX25519,
    tierMinLoss: tiers.map((t) => t.minLoss.toString()), tierAmount: tiers.map((t) => t.amount.toString()),
    singleCap: singleCap.toString(), k, targetToPause, deadline: deadline.toString(), funding: funding.toString(), auth: a.auth,
  } : null;
  const sdkCall = ready ? [
    "// sur ta machine ou dans ton navigateur : ton wallet signe l'autorisation EIP-3009, puis envoie la transaction",
    rail?.verified
      ? "const arc = createArcClient({ publicClient, walletClient, deployment: { ...testnet, sealedBounty: testnet.levels!.sealedBountyVerified } }); // @arcvault/sdk : le niveau vérifié"
      : "const arc = createArcClient({ publicClient, walletClient }); // @arcvault/sdk",
    "const { tx, bountyId } = await arc.createBounty({",
    `  productId: ${product.id}n, predicateHash: "${ph}", protocolX25519: "${protocolX25519}",`,
    `  tierMinLoss: [${tiers.map((t) => `${t.minLoss}n`).join(", ")}], tierAmount: [${tiers.map((t) => `${t.amount}n`).join(", ")}],`,
    `  singleCap: ${singleCap}n, k: ${k}, targetToPause: "${targetToPause}", deadline: ${deadline}n, funding: ${funding}n,`,
    "});",
  ].join("\n") : null;
  return {
    execute: false,
    signatureRequise: true,
    pret: ready && aCompleter.length === 0,
    aCompleter,
    avertissements,
    verifications,
    produit: { id: product.id.toString(), rail: railOf(arc, product.settlement), deterministe: product.deterministic, niveau: rail?.verified ? "vérifié" : rail ? "ouvert" : "aucun" },
    ...infos,
    predicat: predicate ?? null,
    predicatCanonique: predicate ? canonicalize(predicate) : null,
    predicateHash: ph ?? null,
    publierLePredicat: "Publie ce JSON canonique tel quel : le chasseur le joint à son exploit et l'enclave vérifie que son hash est celui épinglé on-chain.",
    economie: {
      regle: "Le chasseur touche 100 % du palier ; en plus, pris sur le pool : la part du réseau (networkBountyBps) et celle des k opérateurs vérificateurs (operatorBountyBps). v2 : acceptClaim vérifie la preuve et réserve le paiement, deliver livre le rapport chiffré et paie ; un palier n'est payé qu'une fois par armement (reopen après correction de la faille).",
      networkBountyBps: Number(netBps), operatorBountyBps: Number(opBps),
      paliers: econ.map((e) => e.vue),
      financement: usdc(funding),
      paiementsDuPlusHautPalierCouverts: maxTotal > 0n ? (funding / maxTotal).toString() : "0",
      echeance: `${iso(deadline)} (${days} j, valeur proposée à confirmer)`,
      k, singleCap: usdc(singleCap),
    },
    contrat: { nom: bountyName, adresse: bounty, fonction: "createBounty(CreateParams)" },
    createBountyParams: params,
    autorisationEIP3009: a.typedData,
    appelSdk: sdkCall,
    cleDuProtocole: present(q.protocolX25519) ? undefined : {
      pourquoi: "L'exploit prouvé t'est livré chiffré pour cette clé ; seule ta clé privée le déchiffre. Elle ne doit jamais quitter ta machine.",
      snippet: 'import { generateX25519 } from "@arcvault/sdk";\nconst kp = generateX25519(); // garde kp.privateKey en lieu sûr, chez toi\nconsole.log(kp.publicKey);    // → protocolX25519',
    },
    ouSigner: `Ton wallet signe : SDK arc.createBounty (ci-dessus) ou Mon espace › Mes bounties du site (/space.html?tab=bounties, niveau ${rail?.verified ? "vérifié" : "ouvert"}). Le copilote n'envoie rien.`,
    lueAuBloc: h.number.toString(),
    sources: [`${bountyName}.createBounty / acceptClaim / deliver`, "predicate.ts (langage v0)", `${bountyName}.networkBountyBps / operatorBountyBps / MAX_SIGS`],
  };
}

// ================================================================ OPÉRATEUR

/** operator.plan — le plan pas à pas pour devenir opérateur, chiffres lus on-chain. */
export async function operatorPlan(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const operator = optAddr(q.operator, "operator") ?? cx.user;
  const unbondDelay = await constant<bigint>(arc, arc.d.operatorBond, "UNBOND_DELAY");
  const window = await constant<bigint>(arc, arc.d.operatorBond, "WINDOW");
  const validity = await constant<bigint>(arc, arc.d.enclaveRegistry, "VALIDITY_BLOCKS");
  const grace = await constant<bigint>(arc, arc.d.enclaveRegistry, "GRACE_BLOCKS");
  const opBps = Number(await constant<number>(arc, arc.d.sealedBounty, "operatorBountyBps"));
  const avertissements: string[] = [];
  const plist = await listOrReason(productsCached(arc, cx));
  if (!plist.ok) avertissements.push(`Produits : ${plist.indisponible}`);
  const actives = plist.ok ? plist.v.filter((p) => p.state === "Active") : [];
  const wanted = present(q.productId) ? parseId(q.productId, "productId") : undefined;
  const chosen = wanted !== undefined ? actives.find((p) => p.id === wanted) : undefined;
  if (wanted !== undefined && !chosen && plist.ok) avertissements.push(`Le produit #${wanted} n'est pas actif : choisis parmi la liste.`);
  const produits = (chosen ? [chosen] : actives).map((p) => ({
    id: p.id.toString(), rail: railOf(arc, p.settlement), prixParUnite: usdc(p.price),
    partOperateur: `${Number(p.bpsOperator) / 100} %`, cautionMinimale: usdc(p.minBond), deterministe: p.deterministic,
  }));
  let compte: unknown = null;
  if (operator) {
    const bal = await arc.usdcBalance(operator);
    const bond = await arc.bondOf(operator);
    const avail = await arc.availableBond(operator);
    const free = await read<bigint>(arc, arc.d.operatorBond, extraAbi, "freeBond", [operator]);
    const banned = await read<boolean>(arc, arc.d.operatorBond, operatorBondAbi, "banned", [operator]);
    const elist = await listOrReason(enclavesCached(arc, cx));
    const mine = elist.ok ? elist.v.filter((e) => e.operator.toLowerCase() === operator.toLowerCase()) : [];
    compte = {
      adresse: operator, soldeUSDC: usdc(bal), caution: usdc(bond), cautionDisponible: usdc(avail), cautionLibre: usdc(free),
      plafondDExpositionSur24hParProduit: usdc(avail / 2n), banni: banned,
      enclaves: elist.ok
        ? mine.map((e) => ({ signataire: getAddress(e.signer), produit: e.productId.toString(), active: e.active }))
        : `inconnues pour l'instant : ${elist.indisponible}`,
    };
    if (banned) avertissements.push("Cette adresse est BANNIE (caution saisie après une double signature) : elle ne peut plus déposer de caution.");
  }
  const pid = chosen ? chosen.id.toString() : "<id du produit>";
  const op = operator ?? "0x<ton adresse>";
  // la Prime du produit choisi : SealedBounty (2, 5) ou SealedBountyVerified (7) ; l'enclave la lit dans SEALEDBOUNTY
  const bountyOf = chosen ? bountyContractOf(arc, chosen.settlement) : undefined;
  const bountyRail = !!bountyOf;
  const appCompose = [
    "# app-compose (Phala Cloud dstack) — modèles : enclave/phala/*.yml du dépôt",
    "services:",
    "  produit:",
    "    image: <registre>/<image>@sha256:<digest>   # l'image du manifeste du produit (son workloadId doit être autorisé)",
    '    ports: ["8802:8802"]',
    "    environment:",
    "      - RPC_URL=https://rpc.testnet.arc.io",
    `      - CHAIN_ID=${arc.d.chainId}`,
    `      - PRODUCT_ID=${pid}`,
    `      - REGISTRY=${arc.d.enclaveRegistry}`,
    bountyOf ? `      - SEALEDBOUNTY=${bountyOf.address}` : `      - SESSIONPAY=${arc.d.sessionPay}`,
    "      - OPERATOR_ALLOWLIST=${OPERATOR_ALLOWLIST}   # variable chiffrée : TON adresse d'opérateur (sans elle, /attest refuse tout)",
    ...(bountyRail ? [] : ["      - UNIT_TOKENS=1   # EN CLAIR (mesuré) : l'unité facturée du produit", "      - OUT_WEIGHT=1"]),
    "    volumes:",
    "      - /var/run/dstack.sock:/var/run/dstack.sock   # agent invité dstack : le vrai quote TDX",
    "    restart: unless-stopped",
  ].join("\n");
  return {
    execute: false,
    compte,
    avertissements,
    produits,
    etapes: [
      { n: 1, titre: "Un wallet et de l'USDC sur Arc", detail: "Le gas d'Arc se paie en USDC. Amène ton USDC d'Ethereum Sepolia ou de Base Sepolia par CCTP (page Pont du site, /bridge.html)." },
      { n: 2, titre: "Choisir un produit", detail: "Ta part de chaque paiement = bpsOperator du produit ; il faut au moins sa caution minimale (voir produits)." },
      { n: 3, titre: "Déposer la caution (OperatorBond)", detail: "bond(montant, autorisation EIP-3009) en une transaction, ou approve puis bondFrom ; tu signes.", outil: "operator_prepare_bond" },
      { n: 4, titre: "Louer une VM Intel TDX sur Phala Cloud (dstack)", detail: "Déployer l'app-compose ci-dessous avec le CLI de Phala Cloud (image épinglée par digest ; modèles : enclave/phala/*.yml).", commande: `phala deploy -c docker-compose.yml -t tdx.small --name archive-produit-${pid} -e PRODUCT_ID=${pid}` },
      { n: 5, titre: "Vérifier l'attestation de la VM", detail: "/attest rend un quote qui lie ton adresse d'opérateur, le produit et les clés de l'enclave (REPORTDATA) ; /pubkeys donne ses clés publiques.", commande: `curl -s -X POST https://<ta-vm>/attest -H 'content-type: application/json' -d '{"operator":"${op}","anchorR":"<bloc récent>"}'` },
      { n: 6, titre: "Inscrire l'enclave (registerEnclave)", detail: `Envoyée par TON adresse d'opérateur. La chaîne vérifie la signature d'Intel sur le quote (DCAP d'Automata : ≈ 6,85 M gas mesurés par inscription, soit ≈ 0,15 à 0,17 USDC de gaz à 21,5–25 gwei ; au niveau vérifié, bindMachine ajoute ≈ 1,7 M gas, ≈ 0,04 USDC), puis : pas de mode DEBUG, SEPT_VE_DISABLE, workloadId autorisé, TCB, REPORTDATA, ancrage de bloc (EIP-2935), quote jamais vu, caution libre ≥ minimum (chaque clé en réserve une).`, outil: "operator_prepare_register" },
      { n: 7, titre: "Renouveler", detail: `Une inscription vaut ${await blocksDuree(arc, validity)} (VALIDITY_BLOCKS) : réattester avant la fin (le service Registrar peut le faire) ; renouvelée sans trou, la fenêtre est prolongée. Ensuite ${await blocksDuree(arc, grace)} de grâce pour régler les anciens reçus. Une clé est liée à vie à son opérateur et à son produit.` },
      { n: 8, titre: "Encaisser", detail: `settle() des derniers reçus cumulatifs (sans permission, une transaction par règlement) ; sur les primes, ${opBps / 100} % en plus partagés entre les opérateurs vérificateurs.` },
    ],
    reglesDeLaCaution: {
      exposition: `Sur une fenêtre de ${duree(window)} (WINDOW), tous produits confondus, les paiements pris sur la foi de tes enclaves sont plafonnés à la MOITIÉ de ta caution disponible (sinon revert TooMuchExposure) ; en plus, pour chaque produit, au plafond d'exposition du produit (exposureCap ; sinon ExposureCapExceeded). Une caution de 1 USDC couvre donc au plus 0,5 USDC de paiements sur la fenêtre ; il faut 20 USDC de caution pour atteindre un plafond de 10 USDC.`,
      reserve: "Chaque clé d'enclave inscrite réserve la caution minimale de son produit ; retirer la clé (retire) libère la réserve.",
      retrait: `requestUnbond(montant), puis withdraw() après ${duree(unbondDelay)} (UNBOND_DELAY).`,
      equivocation: "Double signature prouvée (deux reçus différents pour la même session et le même seq, ou deux réclamations différentes pour la même empreinte de prime) = saisie de TOUTE la caution et bannissement.",
      repartitionDeLaSaisie: "50 % au dénonciateur, 50 % à la victime (à la trésorerie du réseau s'il n'y a pas de victime).",
    },
    appCompose,
    sources: ["OperatorBond.sol (UNBOND_DELAY, WINDOW, consumeExposure, reserve, slash)", "EnclaveRegistry.sol (VALIDITY_BLOCKS, GRACE_BLOCKS, politique P1–P12)", "enclave/phala/sealed-chat-v21.yml", "docs/OPERATORS.md"],
  };
}

/** operator.prepare_bond — dépôt de caution PRÉPARÉ (autorisation EIP-3009, ou approve + bondFrom). */
export async function prepareBond(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const operator = optAddr(q.operator, "operator") ?? cx.user;
  const product = present(q.productId) ? await productLite(arc, parseId(q.productId, "productId")) : undefined;
  if (product && product.state === "None") throw new Error(`Produit #${product.id} inconnu.`);
  let bond = 0n, avail = 0n, banned = false, bal: bigint | undefined;
  if (operator) {
    bond = await arc.bondOf(operator);
    avail = await arc.availableBond(operator);
    banned = await read<boolean>(arc, arc.d.operatorBond, operatorBondAbi, "banned", [operator]);
    bal = await arc.usdcBalance(operator);
  }
  let amount: bigint;
  if (present(q.amount)) amount = parseUsdc(q.amount, "amount");
  else if (product) {
    amount = product.minBond > avail ? product.minBond - avail : 0n;
    if (amount === 0n) {
      return {
        execute: false, rienANSigner: true,
        message: `Ta caution disponible (${usdc(avail)}) couvre déjà la caution minimale du produit #${product.id} (${usdc(product.minBond)}). Prochaine étape : inscrire ton enclave (operator_prepare_register).`,
        sources: ["OperatorBond.availableBond", "ProductRegistry.getProduct"],
      };
    }
  } else {
    const ps = (await productsCached(arc, cx)).filter((p) => p.state === "Active");
    return {
      execute: false, pret: false,
      aCompleter: ["amount : le montant de la caution en USDC, ou productId pour viser la caution minimale d'un produit"],
      cautionsMinimales: ps.map((p) => ({ produit: p.id.toString(), rail: railOf(arc, p.settlement), cautionMinimale: usdc(p.minBond) })),
    };
  }
  if (amount === 0n) throw new Error("amount doit être supérieur à 0");
  const h = await headBlock(arc);
  const a = eip3009(arc, operator, arc.d.operatorBond, amount, h.timestamp);
  const verifications: Array<{ ok: boolean; quoi: string }> = [];
  if (operator) {
    verifications.push({ ok: !banned, quoi: banned ? "adresse BANNIE : bond() reverterait (Banned)" : "adresse non bannie" });
    verifications.push({ ok: (bal ?? 0n) >= amount, quoi: `solde USDC : ${usdc(bal ?? 0n)} (caution à déposer : ${usdc(amount)} ; garde aussi un peu d'USDC pour le gas)` });
  }
  if (product) verifications.push({ ok: avail + amount >= product.minBond, quoi: `après dépôt, caution disponible ${usdc(avail + amount)} pour une caution minimale de ${usdc(product.minBond)} (produit #${product.id})` });
  return {
    execute: false,
    signatureRequise: true,
    pret: !!operator,
    aCompleter: operator ? [] : ["operator : l'adresse de l'opérateur (celle qui signera et inscrira l'enclave)"],
    operateur: operator ?? "<adresse de l'opérateur>",
    montant: usdc(amount),
    avant: operator ? { caution: usdc(bond), disponible: usdc(avail) } : undefined,
    apres: operator ? { caution: usdc(bond + amount), disponible: usdc(avail + amount), plafondDExpositionSur24hParProduit: usdc((avail + amount) / 2n) } : undefined,
    verifications,
    voieA_uneTransaction: {
      quoi: "bond(amount, auth) sur OperatorBond, avec une autorisation EIP-3009 signée par ton wallet",
      contrat: arc.d.operatorBond,
      fonction: "bond(uint256 amount, (uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) auth)",
      args: { amount: amount.toString(), auth: a.auth },
      autorisationEIP3009: a.typedData,
    },
    voieB_deuxTransactions: [
      { etape: "1. autoriser OperatorBond à prélever", to: arc.d.usdc, value: "0", data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [arc.d.operatorBond, amount] }) },
      { etape: "2. déposer", to: arc.d.operatorBond, value: "0", data: encodeFunctionData({ abi: operatorBondAbi, functionName: "bondFrom", args: [amount] }) },
    ],
    ouSigner: `Network › Louer (/network.html?focus=rent, étape caution, wallet connecté), ou sur ta machine : arcvault operator bond --amount ${formatUnits(amount, 6)} (ta clé reste chez toi, jamais dans le chat)`,
    lueAuBloc: h.number.toString(),
    sources: ["OperatorBond.bondOf / availableBond / banned", "OperatorBond.bond / bondFrom"],
  };
}

/** operator.prepare_register — inscription d'enclave PRÉPARÉE : ancrage, /attest de la VM, registerEnclave à signer. */
export async function prepareRegister(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const pid = parseId(q.productId, "productId");
  if (present(q.enclaveUrl)) enclaveEndpoint(String(q.enclaveUrl), "/attest", enclavePolicyOf(cx)); // URL refusée avant toute lecture
  const p = await productLite(arc, pid);
  if (p.state === "None") throw new Error(`Produit #${pid} inconnu.`);
  const operator = optAddr(q.operator, "operator") ?? cx.user;
  const aCompleter: string[] = [];
  const avertissements: string[] = [];
  const verifications: Array<{ ok: boolean; quoi: string }> = [
    { ok: p.state === "Active", quoi: `produit #${pid} : ${p.state}${p.state === "Active" ? "" : " (revert ProductNotActive)"}` },
  ];
  if (operator) {
    const avail = await arc.availableBond(operator);
    const free = await read<bigint>(arc, arc.d.operatorBond, extraAbi, "freeBond", [operator]);
    const banned = await read<boolean>(arc, arc.d.operatorBond, operatorBondAbi, "banned", [operator]);
    verifications.push({ ok: avail >= p.minBond, quoi: `caution disponible ${usdc(avail)} pour une caution minimale de ${usdc(p.minBond)}${avail >= p.minBond ? "" : " (revert OperatorUnderbonded : operator_prepare_bond d'abord)"}` });
    verifications.push({ ok: free >= p.minBond, quoi: `caution libre ${usdc(free)} : une NOUVELLE clé réserve ${usdc(p.minBond)}${free >= p.minBond ? "" : " (revert OperatorUnderbonded : retire une ancienne clé ou augmente la caution)"}` });
    verifications.push({ ok: !banned, quoi: banned ? "opérateur BANNI" : "opérateur non banni" });
  } else aCompleter.push("operator : ton adresse d'opérateur (le quote la lie, et c'est elle qui envoie la transaction)");
  const h = await headBlock(arc);
  const anchorR = h.number - 10n; // comme le SDK : un bloc récent, dans la fenêtre EIP-2935
  const includeCalldata = q.includeCalldata === undefined ? !!cx.includeCalldata : q.includeCalldata === true || String(q.includeCalldata) === "true";
  let attestation: unknown = null;
  let transaction: unknown = null;
  let args: unknown = {
    productId: pid.toString(), quote: "<quote de POST /attest>", anchorR: anchorR.toString(),
    signer: "<signer de /attest>", x25519: "<x25519 de /attest>", eventLog: "<eventLog de /attest>",
  };
  if (!present(q.enclaveUrl)) aCompleter.push("enclaveUrl : l'URL publique de ta VM (elle sert POST /attest)");
  if (present(q.enclaveUrl) && operator) {
    const att = await fetchEnclaveJson(String(q.enclaveUrl), "/attest", { operator, anchorR: anchorR.toString() }, enclavePolicyOf(cx));
    const quote = hexStr(att?.quote, "/attest.quote");
    let eventLog = hexStr(att?.eventLog ?? "0x", "/attest.eventLog");
    // une valeur de l'hôte n'est jamais recopiée dans une erreur (addr() cite la valeur reçue)
    if (typeof att?.signer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(att.signer.trim())) throw new Error("/attest.signer : adresse 0x… de 40 caractères hexadécimaux attendue");
    const signer = addr(att.signer, "/attest.signer");
    const x25519 = hexStr(att?.x25519, "/attest.x25519");
    if (size(x25519) !== 32) throw new Error("/attest.x25519 : 32 octets attendus");
    const quoteHash = keccak256(quote);
    const seen = await read<boolean>(arc, arc.d.enclaveRegistry, extraAbi, "quoteSeen", [quoteHash]);
    verifications.push({ ok: !seen, quoi: seen ? "ce quote a DÉJÀ servi (revert QuoteReused) : redemande /attest" : "quote jamais vu" });
    const existing = await read<any>(arc, arc.d.enclaveRegistry, enclaveRegistryAbi, "enclaveOf", [signer]);
    if (existing && existing.signer !== ZERO) avertissements.push(`Cette clé d'enclave est déjà inscrite (produit #${existing.productId}) : l'envoi la ré-inscrit (renouvellement).`);
    if (att?.mock) {
      verifications.push({ ok: false, quoi: "quote SIMULÉ (la VM n'a pas Intel TDX ou pas l'agent dstack) : la vérification DCAP d'Intel le refuserait (QuoteInvalid)" });
    } else {
      // ce que le registre exigera, contrôlé hors chaîne avant de dépenser ≈ 5,7 M gas
      try {
        const m = parseTdxQuote(quote);
        const needSeptVe = await read<boolean>(arc, arc.d.enclaveRegistry, extraAbi, "requireSeptVeDisable");
        // IMAGE fingerprint (RTMR3 log replayed by the registry) if the product allows it, otherwise the full fingerprint
        const plan = await planRegistrationLog(arc.pub as any, { registry: arc.d.enclaveRegistry, productRegistry: arc.d.productRegistry, productId: pid, quote, rawEventLog: eventLog });
        const allowed = plan.admittedBy !== null;
        if (plan.admittedBy === "image") eventLog = plan.eventLog;
        const rd0 = expectedReportData0({ chainId: arc.d.chainId, registry: arc.d.enclaveRegistry, productId: pid, operator, signer, x25519: x25519 as Hex });
        verifications.push({ ok: !m.debug, quoi: m.debug ? "enclave en mode DEBUG (revert DebugEnclave)" : "pas de mode DEBUG" });
        verifications.push({ ok: !needSeptVe || m.septVeDisabled, quoi: !needSeptVe || m.septVeDisabled ? "SEPT_VE_DISABLE conforme" : "SEPT_VE_DISABLE absent (revert SeptVeNotDisabled)" });
        const shown = plan.admittedBy === "image" ? `empreinte d'image ${plan.imageId}, stable d'un redémarrage à l'autre` : `workloadId ${m.workloadId}`;
        const ask = plan.v21 && plan.imageId ? `empreinte d'image ${plan.imageId}` : `workloadId ${m.workloadId}`;
        verifications.push({ ok: allowed, quoi: allowed ? `image autorisée par le produit (${shown})` : `image NON autorisée par le produit : ${ask}${plan.note ? ` (${plan.note})` : ""} ; l'auteur doit proposeWorkload puis applyWorkload` });
        verifications.push({ ok: m.reportData.slice(0, 66).toLowerCase() === rd0.toLowerCase(), quoi: "REPORTDATA lie (chaîne, registre, produit, opérateur, clés)" });
      } catch (err) {
        verifications.push({ ok: false, quoi: `quote illisible : ${(err as Error).message}` });
      }
    }
    const data = encodeFunctionData({ abi: enclaveRegistryAbi, functionName: "registerEnclave", args: [pid, quote, anchorR, signer, x25519 as Hex, eventLog] });
    attestation = { signataire: signer, clePubliqueX25519: x25519, quoteOctets: size(quote), quoteHash, eventLogOctets: size(eventLog), simule: !!att?.mock };
    args = { productId: pid.toString(), quote: short(quote), anchorR: anchorR.toString(), signer, x25519, eventLog: short(eventLog) };
    transaction = {
      from: operator, to: arc.d.enclaveRegistry, value: "0",
      dataOctets: size(data), dataKeccak: keccak256(data),
      data: includeCalldata ? data : "(non incluse ici : Mon espace › Mes machines, /space.html?tab=machines, ou arc.registerEnclave la reconstruisent)",
    };
  }
  return {
    execute: false,
    signatureRequise: true,
    pret: aCompleter.length === 0 && verifications.every((v) => v.ok),
    aCompleter,
    avertissements,
    verifications,
    produit: { id: pid.toString(), rail: railOf(arc, p.settlement), cautionMinimale: usdc(p.minBond) },
    blocDAncrage: anchorR.toString(),
    aEnvoyerAvantLeBloc: (anchorR + HISTORY_WINDOW).toString(),
    pourquoiCeDelai: "Le hash du bloc d'ancrage doit rester lisible dans l'historique EIP-2935 (8 191 blocs) : au-delà, revert AnchorTooOld ; redemande alors /attest.",
    attestation,
    contrat: { adresse: arc.d.enclaveRegistry, fonction: "registerEnclave(uint256 productId, bytes quote, uint256 anchorR, address signer, bytes32 x25519, bytes eventLog)" },
    args,
    transaction,
    gazEstime: `≈ 6 850 000 mesurés le 19/11, soit ≈ 0,15 à 0,17 USDC à 21,5–25 gwei (estimation du SDK : ${DCAP_REGISTER_GAS_ESTIMATE} ; vérification de la signature d'Intel par DCAP on-chain)`,
    laChaineVerifie: "signature d'Intel sur le quote (DCAP d'Automata : collatéral chargé on-chain), quote TDX v4/v5, TCB acceptable, pas de mode DEBUG, SEPT_VE_DISABLE, workloadId autorisé par le produit, REPORTDATA = (chaîne, registre, produit, opérateur = expéditeur, signer, x25519), ancrage EIP-2935, quote jamais vu, caution libre ≥ minimum ; inscription valable VALIDITY_BLOCKS blocs (≈ 24 h), clé liée à vie à cet opérateur et à ce produit.",
    ouSigner: "Mon espace › Mes machines (/space.html?tab=machines, section register : l'URL de l'enclave), ou SDK : await arc.registerEnclave(productId, enclaveUrl) avec TON wallet d'opérateur.",
    lueAuBloc: h.number.toString(),
    sources: ["EnclaveRegistry.registerEnclave (politique P1–P12)", "EnclaveRegistry.quoteSeen / enclaveOf", "OperatorBond.availableBond"],
  };
}

// ================================================================ PRODUIT TIERS

/** product.scaffold — squelette d'un produit tiers : conteneur + kit, app-compose, manifeste, propose → timelock → activate. */
export async function productScaffold(arc: ArcClient, q: any) {
  const name = String(q.name ?? "").trim() || "mon-service"; // nom provisoire : le squelette sert d'abord à montrer les étapes
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mon-service";
  const rail = String(q.rail ?? "session").toLowerCase() === "x402" ? "x402" : "session";
  const settlement = rail === "x402" ? arc.d.x402Settler : arc.d.sessionPay;
  const deterministic = q.deterministic === true || String(q.deterministic) === "true";
  const avertissements: string[] = [];
  const actives = (await productsCached(arc)).filter((p) => p.state === "Active");
  const live = new Set((await enclavesCached(arc)).filter((e) => e.active).map((e) => e.productId.toString()));
  const sameRail = actives.filter((p) => p.settlement.toLowerCase() === settlement.toLowerCase());
  // référence : un produit du même rail qui tourne vraiment (enclaves actives), sinon le premier du rail
  const ref = sameRail.find((p) => live.has(p.id.toString())) ?? sameRail[0] ?? actives[0];
  const refLabel = ref ? `repris du produit #${ref.id} (lu on-chain), à ajuster` : undefined;

  // parts : toutes les trois, somme = 10 000 (sinon propose revert BadShares)
  const given = ["bpsOperator", "bpsAuthor", "bpsNetwork"].filter((k) => present(q[k]));
  let bps: { bpsOperator: number; bpsAuthor: number; bpsNetwork: number };
  let bpsOrigine: string;
  if (given.length) {
    if (given.length < 3) throw new Error("Donne les trois parts bpsOperator, bpsAuthor et bpsNetwork (points de base, somme = 10 000)");
    bps = { bpsOperator: Number(q.bpsOperator), bpsAuthor: Number(q.bpsAuthor), bpsNetwork: Number(q.bpsNetwork) };
    if (Object.values(bps).some((v) => !Number.isInteger(v) || v < 0 || v > 10_000)) throw new Error("chaque part est un entier de 0 à 10 000 points de base");
    const sum = bps.bpsOperator + bps.bpsAuthor + bps.bpsNetwork;
    if (sum !== 10_000) throw new Error(`les parts font ${sum} points de base au lieu de 10 000 : propose() reverterait (BadShares)`);
    if (bps.bpsAuthor > 3_000) throw new Error("bpsAuthor : 3 000 au plus (30 %) : propose() reverterait (AuthorShareTooHigh)");
    if (bps.bpsNetwork < 500) throw new Error("bpsNetwork : 500 au moins (5 %) : propose() reverterait (NetworkShareTooLow)");
    bpsOrigine = "fournies";
  } else if (ref) {
    bps = { bpsOperator: ref.bpsOperator, bpsAuthor: ref.bpsAuthor, bpsNetwork: ref.bpsNetwork };
    bpsOrigine = refLabel!;
  } else throw new Error("Aucun produit de référence : donne bpsOperator, bpsAuthor et bpsNetwork (somme = 10 000)");

  const price = present(q.price) ? parseUsdc(q.price, "price") : ref?.price;
  if (price === undefined) throw new Error("price : le prix par unité en USDC est requis");
  if (price === 0n) avertissements.push("Prix nul : le service est gratuit (utile pour un service gardé pour soi).");
  const minBond = present(q.minBond) ? parseUsdc(q.minBond, "minBond") : ref?.minBond ?? 0n;
  const exposureCap = present(q.exposureCap) ? parseUsdc(q.exposureCap, "exposureCap") : ref?.exposureCap ?? 0n;
  const modelId = present(q.modelId) ? String(q.modelId).trim() : undefined;
  const param: Hex = modelId ? keccak256(toBytes(modelId)) : ("0x" + "0".repeat(64)) as Hex;
  if (rail === "session" && !modelId) avertissements.push("Rail session : SessionPay exige que le modelHash de chaque reçu soit égal à param. Donne modelId (param = keccak256(modelId)).");
  const timelock = await constant<bigint>(arc, arc.d.productRegistry, "timelock");
  const image = present(q.image) ? String(q.image).trim() : `ghcr.io/<toi>/${slug}@sha256:<digest>`;

  const manifest = {
    schema: "archive-product/v0", name: slug, description: String(q.description ?? ""), version: 1, rail,
    settlement, deterministic, pricePerUnit: price.toString(),
    unit: rail === "session" ? "1 jeton (entrée + sortie) ou l'unité que ton service compte dans ses reçus" : "1 appel (units du reçu d'appel)",
    shares: bps, minBond: minBond.toString(), exposureCap: exposureCap.toString(), param, modelId: modelId ?? null,
    image, workloadIds: ["<mesuré sur la VM : keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES)>"],
    routes: ["POST /attest", "GET /pubkeys", "GET /health", "POST /v1/run"], advisoryIds: [],
  };
  const manifestHash = keccak256(toBytes(stableStringify(manifest)));
  const serverTs = [
    `/** ${slug} — service d'enclave (produit tiers) bâti sur le kit O1 d'ArcHive (dossier enclave/ du dépôt). */`,
    'import { serve } from "@hono/node-server";',
    'import { EnclaveKit } from "../../src/kit/enclave-kit";',
    'import { RpcQuorum } from "../../src/kit/rpc-quorum";',
    'import { createAttestServer } from "../../src/server/attest-server";',
    'import { createDstackClient } from "../../src/kit/dstack";',
    "",
    'const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";',
    'const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0"); // rendu par propose()',
    `const REGISTRY = "${arc.d.enclaveRegistry}";`,
    `const SETTLEMENT = "${settlement}"; // ${railOf(arc, settlement)}`,
    `const PARAM = "${param}"; // = param du produit${modelId ? ` (keccak256 de « ${modelId} »)` : ""}`,
    "",
    "const dstack = await createDstackClient(); // null hors VM TDX : quote simulé",
    `const kit = new EnclaveKit({ productId: PRODUCT_ID, chainId: ${arc.d.chainId}, registry: REGISTRY as any, rpc: new RpcQuorum([RPC]), dstack: dstack ?? undefined });`,
    "const app = createAttestServer(kit); // POST /attest, GET /pubkeys, GET /health",
    "",
    'app.post("/v1/run", async (c) => {',
    rail === "session"
      ? "  // 1) lire la session on-chain (SessionPay.getSession) et vérifier la signature de la clé de session sur l'enveloppe"
      : "  // 1) sans paiement : répondre 402 avec les exigences x402 ; avec l'en-tête X-PAYMENT : vérifier l'autorisation (voir enclave/src/services/x402.ts)",
    "  // 2) déchiffrer la requête : await kit.open(enc, ciphertext)  (HPKE vers la clé X25519 attestée)",
    `  // 3) faire le travail du service${deterministic ? " (déterministe : même entrée, même sortie, rejouable)" : ""}`,
    rail === "session"
      ? "  // 4) reçu cumulatif signé : await kit.signReceipt(SETTLEMENT, { productId: PRODUCT_ID, sessionId, seq, modelHash: PARAM, …, cumulativeUnits })"
      : "  // 4) reçu d'appel signé (CallReceipt : productId, payer, requestHash, responseHash, units, anchorBlock, nonce), réglé par X402Settler.settle",
    "  // 5) chiffrer la réponse vers la clé éphémère du client : await kit.seal(clientPub, réponse)",
    '  return c.json({ error: "à implémenter" }, 501);',
    "});",
    "",
    'serve({ fetch: app.fetch, port: Number(process.env.PORT ?? "8802"), hostname: "0.0.0.0" });',
  ].join("\n");
  const dockerfile = [
    "FROM node:22-slim",
    "WORKDIR /app",
    "COPY package.json ./",
    "RUN npm install --no-audit --no-fund",
    "COPY tsconfig.json ./",
    "COPY src ./src",
    "COPY products ./products",
    `RUN node_modules/.bin/esbuild products/${slug}/server.ts --bundle --platform=node --format=esm --outfile=dist/${slug}.mjs --packages=external`,
    "ENV PORT=8802",
    "EXPOSE 8802",
    `CMD ["node", "dist/${slug}.mjs"]`,
  ].join("\n");
  const compose = [
    `# app-compose Phala Cloud (dstack, VM Intel TDX) — phala deploy -c docker-compose.yml -t tdx.small --name ${slug}`,
    "services:",
    `  ${slug}:`,
    `    image: ${image}   # TOUJOURS par digest : le workloadId en dépend`,
    '    ports: ["8802:8802"]',
    "    environment:",
    "      - RPC_URL=https://rpc.testnet.arc.io",
    "      - PRODUCT_ID=<id rendu par propose()>",
    `      - REGISTRY=${arc.d.enclaveRegistry}`,
    "      - OPERATOR_ALLOWLIST=${OPERATOR_ALLOWLIST}   # variable chiffrée : l'adresse de l'opérateur",
    "    volumes:",
    "      - /var/run/dstack.sock:/var/run/dstack.sock",
    "    restart: unless-stopped",
  ].join("\n");
  return {
    execute: false,
    nom: slug,
    rail: railOf(arc, settlement),
    avertissements,
    parts: { ...bps, somme: bps.bpsOperator + bps.bpsAuthor + bps.bpsNetwork, origine: bpsOrigine, lecture: `à chaque paiement : ${bps.bpsOperator / 100} % opérateur, ${bps.bpsAuthor / 100} % auteur (toi), le reste (${bps.bpsNetwork / 100} %) au réseau` },
    prixParUnite: `${usdc(price)}${present(q.price) ? "" : ` (${refLabel})`}`,
    cautionMinimale: `${usdc(minBond)}${present(q.minBond) ? "" : ` (${refLabel})`}`,
    plafondDExposition: `${usdc(exposureCap)}${present(q.exposureCap) ? "" : ` (${refLabel})`}`,
    fichiers: { [`products/${slug}/server.ts`]: serverTs, Dockerfile: dockerfile, "docker-compose.yml": compose },
    manifeste: manifest,
    manifestHashBrouillon: manifestHash,
    noteManifeste: "Empreinte du brouillon (JSON à clés triées) : à recalculer quand l'image et les workloadIds sont figés.",
    proposeParams: {
      manifestHash: "<keccak256 du manifeste final>", manifestURI: "<ipfs://… ou https://… du manifeste>",
      workloadIds: ["<workloadId mesuré>"], deterministic, price: price.toString(),
      bpsOperator: bps.bpsOperator, bpsAuthor: bps.bpsAuthor, bpsNetwork: bps.bpsNetwork,
      minBond: minBond.toString(), exposureCap: exposureCap.toString(), settlement, param, advisoryIds: [],
      unitTokens: 1, outWeight: 1,
    },
    noteImages: "v2 : workloadIds peut être vide à la proposition ; une image s'autorise ensuite par proposeWorkload(productId, workloadId) puis applyWorkload après le timelock.",
    etapes: [
      { n: 1, titre: "Écrire le service sur le kit d'enclave", detail: "Le kit O1 donne /attest, /pubkeys, la signature des reçus et le chiffrement HPKE (fichiers ci-dessus)." },
      { n: 2, titre: "Construire et publier l'image, épinglée par digest", detail: "Le digest change les mesures de la VM, donc le workloadId." },
      { n: 3, titre: "Mesurer le workloadId", detail: "Lancer l'image sur une VM TDX de test (Phala), lire le quote de POST /attest : workloadId = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ RTMR3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES), le calcul d'EnclaveRegistry." },
      { n: 4, titre: "Publier le manifeste", detail: "L'héberger (manifestURI) et calculer son manifestHash." },
      { n: 5, titre: "propose(ProposeParams)", detail: `Ton wallet d'auteur signe ; ProductRegistry rend le productId et ouvre le timelock (${duree(timelock)} sur ce réseau, lu on-chain). Aucune transaction n'est envoyée par le copilote.`, contrat: arc.d.productRegistry },
      { n: 6, titre: "activate(productId)", detail: "Après le timelock, n'importe qui peut l'activer." },
      { n: 7, titre: "Des opérateurs inscrivent des enclaves de ton image", detail: "Toi compris (operator_plan) : caution, VM, registerEnclave." },
      { n: 8, titre: "Encaisser", detail: `Chaque règlement te verse bpsAuthor (${bps.bpsAuthor / 100} %). Retrait immédiat d'une image fautive : retireWorkload ; nouveau prix : proposeUpdate puis applyUpdate après le timelock.` },
    ],
    sources: ["ProductRegistry.sol (propose, BadShares, timelock, activate)", "enclave/products/sealed-chat/server.ts (modèle)", "enclave/Dockerfile", "enclave/docker-compose.yml"],
  };
}

// ================================================================ INFÉRENCE DE TEST (sans clé côté serveur)

/** inference.test — vérifie l'enclave et la session on-chain, et rend le code à lancer CHEZ l'utilisateur. */
export async function inferenceTest(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const prompt = present(q.prompt) ? String(q.prompt).slice(0, 500) : "Dis bonjour en une phrase.";
  const verifications: Array<{ ok: boolean; quoi: string }> = [];
  let session: any = null;
  if (present(q.sessionId)) {
    session = await sessionStatus(arc, q.sessionId);
    if (!session.trouvee) verifications.push({ ok: false, quoi: session.message });
    else {
      verifications.push({ ok: !session.fermee, quoi: session.fermee ? "session fermée" : "session ouverte" });
      verifications.push({ ok: session.resteUtilisable !== usdc(0n), quoi: `reste utilisable : ${session.resteUtilisable} (environ ${session.unitesRestantes} unités)` });
    }
  }
  let pid: bigint | undefined = present(q.productId) ? parseId(q.productId, "productId") : session?.trouvee ? BigInt(session.produit.id) : undefined;
  const es = await enclavesCached(arc, cx);
  if (pid === undefined) {
    const withEnclave = es.find((e) => e.active);
    pid = withEnclave?.productId;
  }
  if (pid === undefined) throw new Error("Aucune enclave active : impossible de proposer un test.");
  const p = await productLite(arc, pid);
  const actives = es.filter((e) => e.active && e.productId === pid);
  verifications.push({ ok: actives.length > 0, quoi: `${actives.length} enclave(s) active(s) sur le produit #${pid}` });
  let enclave: unknown = null;
  const url = present(q.enclaveUrl) ? String(q.enclaveUrl).trim() : cx.enclaveUrl;
  if (present(q.enclaveUrl)) {
    enclaveEndpoint(String(q.enclaveUrl).trim(), "/pubkeys", enclavePolicyOf(cx)); // https, port 443, chemin fixe
    // la même vérification que le SDK fera chez l'utilisateur avant tout chiffrement (verifyEnclaveKeys)
    try {
      const k = await verifyEnclaveKeys(String(q.enclaveUrl).trim(), pid, {
        publicClient: arc.pub, deployment: arc.d, fetch: guardedFetch(enclavePolicyOf(cx)),
        ...(session?.trouvee ? { sessionId: BigInt(session.sessionId) } : {}),
      });
      enclave = { url, signataire: k.signer, operateur: k.operator, produit: pid.toString(), activeMaintenant: true, cleX25519ConformeALaChaine: true, fenetreJusquAuBloc: k.untilBlock.toString() };
      verifications.push({ ok: true, quoi: `l'URL sert l'enclave ${k.signer}, active on-chain, et sa clé X25519 est celle inscrite${session?.trouvee ? " ; c'est l'enclave verrouillée de la session" : ""}` });
    } catch (err) {
      if (!(err instanceof EnclaveKeyMismatchError)) throw err;
      enclave = { url, refusee: true, raison: err.reason, detail: err.detail };
      verifications.push({ ok: false, quoi: `${err.message} : n'y envoie rien` });
    }
  }
  const enclaveUrl = url ?? "<URL de la passerelle de l'enclave (page Utiliser)>";
  const promptJs = JSON.stringify(prompt);
  const sdk = [
    "// Node ≥ 22 ou navigateur. Ta clé d'accès reste chez toi : variable d'environnement, jamais dans le chat.",
    'import { createPublicClient, http } from "viem";',
    'import { privateKeyToAccount } from "viem/accounts";',
    'import { arcTestnet, decodeAek, createInferenceClient } from "@arcvault/sdk";',
    "",
    "const { sessionId, sessionPrivateKey } = decodeAek(process.env.ARC_AEK!);",
    "const sessionKey = { privateKey: sessionPrivateKey, address: privateKeyToAccount(sessionPrivateKey).address };",
    "const ai = createInferenceClient({",
    `  enclaveUrl: "${enclaveUrl}", sessionId, sessionKey,`,
    "  publicClient: createPublicClient({ chain: arcTestnet, transport: http() }) as any,",
    "});",
    `const { text, receipt, verified } = await ai.chat.completions.create({ messages: [{ role: "user", content: ${promptJs} }] });`,
    "console.log(text);",
    'console.log("reçu vérifié on-chain :", verified, "| unités cumulées :", receipt.cumulativeUnits.toString());',
  ].join("\n");
  const proxy = [
    `arcvault proxy --key "$ARC_AEK" --enclave ${enclaveUrl}`,
    "# puis, dans un autre terminal (tout client OpenAI marche avec base_url = http://localhost:8787/v1) :",
    `curl -s http://localhost:8787/v1/chat/completions -H 'content-type: application/json' -d '${JSON.stringify({ messages: [{ role: "user", content: prompt }] }).replace(/'/g, "'\\''")}'`,
    "# la réponse porte x_arc.verified (reçu vérifié) et x_arc.cumulativeUnits",
  ].join("\n");
  return {
    executeCoteServeur: false,
    pourquoi: "Le copilote ne détient jamais ta clé de session : l'appel de test part de TON navigateur ou de TA machine, chiffré pour l'enclave, et son reçu est vérifié on-chain.",
    produit: { id: pid.toString(), rail: railOf(arc, p.settlement), prixParUnite: usdc(p.price), lecture: "chaque jeton de la question et de la réponse compte 1 unité" },
    session: session?.trouvee ? { id: session.sessionId, resteUtilisable: session.resteUtilisable, unitesRestantes: session.unitesRestantes, expiration: session.expiration } : session,
    enclavesActives: actives.map((e) => ({ signataire: getAddress(e.signer), operateur: e.operator })),
    enclave,
    verifications,
    etapes: [
      "1. Ouvre une session (session_prepare_open) si tu n'en as pas : ta clé d'accès aek_… naît dans ton navigateur.",
      "2. Dans le navigateur : page Utiliser → Inférence privée, pose ta question ; ou lance l'un des codes ci-dessous chez toi.",
      "3. Avant tout envoi, le SDK confronte la clé X25519 de l'enclave à celle inscrite on-chain ; chaque réponse arrive avec un reçu signé par elle, authentifié (requête et réponse) et payable (verified = true).",
      "4. Suivi du solde : session_status ; l'opérateur règle le dernier reçu cumulatif en une transaction.",
    ],
    codeSdk: sdk,
    codeMandataireLocal: proxy,
    sources: ["@arcvault/sdk (createInferenceClient, decodeAek, verifyEnclaveKeys)", "packages/cli (arcvault proxy)", "EnclaveRegistry.enclaveOf / activeOperatorAt"],
  };
}

// ================================================================ MACHINES DES OPÉRATEURS (API ArcHive, lecture seule)

const apiBaseOf = (cx: ActionCtx) => archiveBase(cx.apiBase);

type ApiResult = { ok: true; data: any } | { ok: false; status?: number; erreur: string };
/** GET sur l'API ArcHive : jamais d'exception, une erreur claire (404, injoignable, non JSON). */
async function apiGet(base: string, path: string): Promise<ApiResult> {
  const route = path.split("?")[0];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    const text = await readBodyCapped(res, 2_000_000);
    if (res.status === 404) {
      let msg = "";
      try { const j = JSON.parse(text); msg = String(j?.error ?? j?.message ?? ""); } catch { /* page 404 brute : route absente */ }
      return { ok: false, status: 404, erreur: msg ? `L'API ArcHive répond 404 sur ${route} : ${msg}` : `L'API ArcHive (${base}) ne sert pas ${route} (404).` };
    }
    if (!res.ok) return { ok: false, status: res.status, erreur: `L'API ArcHive (${base}) a répondu ${res.status} sur ${route} : ${text.slice(0, 160)}` };
    try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: false, status: res.status, erreur: `Réponse non JSON de l'API ArcHive sur ${route}.` }; }
  } catch (e: any) {
    const cause = e?.name === "AbortError" ? "délai de 10 s dépassé" : String(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e);
    return { ok: false, erreur: `API ArcHive injoignable (${base}) : ${cause}. Les routes /machines sont en cours de déploiement ; réessaie plus tard.` };
  } finally {
    clearTimeout(timer);
  }
}

/** Date de l'API (ISO, ou époque en s ou ms) → ISO + « il y a … » (horloge locale : donnée hors chaîne). */
function whenFr(x: unknown): { iso: string | null; depuis: string | null } {
  if (x === undefined || x === null || x === "") return { iso: null, depuis: null };
  let ms: number;
  if (typeof x === "number" || /^\d+$/.test(String(x))) { const n = Number(x); ms = n > 1e12 ? n : n * 1000; }
  else ms = Date.parse(String(x));
  if (!Number.isFinite(ms)) return { iso: String(x), depuis: null };
  const d = Math.round((Date.now() - ms) / 1000);
  return { iso: new Date(ms).toISOString().replace(".000Z", "Z"), depuis: d >= 0 ? `il y a ${duree(d)}` : `dans ${duree(-d)}` };
}

const MACHINE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** La correction concrète de chaque vérification du « doctor » d'un nœud. */
const FIXES: Record<string, string> = {
  os: "Système non pris en charge : faites tourner le nœud sur une VM Linux x86_64.",
  node: "Node.js absent ou trop ancien : installez Node 22 ou plus récent (ex. nvm install 22), puis relancez le nœud.",
  docker: "Docker absent ou arrêté : installez Docker Engine (docs.docker.com/engine/install), puis démarrez-le (sudo systemctl enable --now docker).",
  tdx_guest: "Pas de /dev/tdx_guest : la machine n'est pas une VM Intel TDX ; louez une VM TDX (Phala Cloud, GCP C3, Azure DCesv5) ou lancez `archive-node up --demo` sur testnet.",
  tsm_report: "Pas d'interface de quote TSM (/sys/kernel/config/tsm/report) : il faut une VM Intel TDX avec un noyau Linux récent (6.7 ou plus), ou passer par dstack (Phala Cloud), ou le mode démo sur testnet.",
  dstack_socket: "Socket dstack introuvable : en mode dstack, montez /var/run/dstack.sock:/var/run/dstack.sock dans l'app-compose (modèle : enclave/docker-compose.yml) et redéployez.",
  clock: "Horloge désynchronisée : synchronisez-la par NTP (sudo timedatectl set-ntp true) ; sinon échéances et ancrage de bloc sont faux.",
  rpc: "RPC d'Arc injoignable : vérifiez l'accès réseau sortant à https://rpc.testnet.arc.io (pare-feu, DNS, proxy).",
  api: "API ArcHive injoignable depuis la machine : vérifiez l'accès réseau sortant vers {API} (pare-feu, DNS).",
  port: "Port de l'enclave fermé : ouvrez-le (8802 par défaut) dans le pare-feu ou le groupe de sécurité, et publiez-le dans l'app-compose (ports: \"8802:8802\").",
  enclave_health: "Le service d'enclave ne répond pas sur /health : vérifiez que le conteneur tourne (docker ps, docker logs) et redémarrez-le.",
  attest: "L'enclave ne renvoie pas de quote (POST /attest) : vérifiez /dev/tdx_guest ou le socket dstack, puis relancez le conteneur ; sans quote, pas d'inscription on-chain.",
  bond: "Caution insuffisante pour le produit : déposez-la sur Network › Louer (/network.html?focus=rent, étape caution) ; operator_prepare_bond prépare le dépôt.",
};
const TDX_CHECKS = new Set(["tdx_guest", "tsm_report", "dstack_socket"]);

function machineRow(m: any) {
  const seen = whenFr(m?.lastSeen);
  return {
    machineId: m?.machineId ?? m?.id ?? null, hostname: m?.hostname ?? null, mode: m?.mode ?? null, status: m?.status ?? null,
    online: m?.online === true, lastSeen: seen.iso, vueDerniereFois: seen.depuis, productId: m?.productId != null ? String(m.productId) : null,
    enclaveUrl: m?.enclaveUrl ?? null, signer: m?.signer ?? null, doctorOk: m?.doctorOk ?? null, registered: m?.registered ?? null,
    failing: Array.isArray(m?.failing) ? m.failing.map(String) : [], version: m?.version || null,
  };
}

/** machines.list — les machines (nœuds) d'un opérateur, vues par l'API ArcHive. Lecture seule. */
export async function machinesList(q: any, cx: ActionCtx = {}) {
  const operator = optAddr(q?.operator, "operator") ?? cx.user;
  if (!operator) return { disponible: false, erreur: "operator requis : l'adresse 0x… de l'opérateur (ou connecte ton wallet)." };
  const base = apiBaseOf(cx);
  const r = await apiGet(base, `/machines?operator=${encodeURIComponent(operator)}`);
  if (!r.ok) return { disponible: false, operateur: operator, erreur: r.erreur };
  const raw: any[] = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.machines) ? r.data.machines : [];
  const machines = raw.map(machineRow);
  const aRegarder = machines.filter((m) => !m.online || m.doctorOk === false || m.registered === false || m.failing.some((id: string) => !TDX_CHECKS.has(id)));
  return {
    disponible: true,
    operateur: operator,
    total: machines.length,
    enLigne: machines.filter((m) => m.online).length,
    diagnosticOk: machines.filter((m) => m.doctorOk === true).length,
    inscrites: machines.filter((m) => m.registered === true).length,
    machines,
    aRegarder: aRegarder.map((m) => ({
      machineId: m.machineId,
      pourquoi: [!m.online && "hors ligne", m.failing.length > 0 && `vérifications en échec : ${m.failing.join(", ")}`, m.failing.length === 0 && m.doctorOk === false && "diagnostic en échec", m.registered === false && "enclave pas inscrite on-chain (ou expirée)"].filter(Boolean).join(" ; "),
    })),
    conseil: machines.length === 0
      ? "Aucune machine déclarée pour cet opérateur : lance le nœud (archive-node) avec cette adresse d'opérateur."
      : aRegarder.length ? "Pour le détail et les corrections : machine_diagnostics(machineId)." : "Toutes les machines sont en ligne, diagnostic OK et inscrites.",
    source: `API ArcHive ${base}/machines`,
  };
}

/** machine.diagnostics — le diagnostic complet d'une machine, résumé avec la correction de chaque échec. */
export async function machineDiagnostics(arc: ArcClient, q: any, cx: ActionCtx = {}) {
  const id = String(q?.machineId ?? "").trim();
  if (!MACHINE_ID_RE.test(id)) return { disponible: false, erreur: `machineId invalide : « ${id} » (lettres, chiffres, . _ : - ; 128 caractères au plus).` };
  const base = apiBaseOf(cx);
  const r = await apiGet(base, `/machines/${encodeURIComponent(id)}`);
  if (!r.ok) return { disponible: false, machineId: id, erreur: r.erreur };
  const rec: any = r.data?.machine ?? r.data ?? {};
  const mode = String(rec.mode ?? "");
  const checks: Array<{ id: string; label: string; ok: boolean; detail: string }> = (Array.isArray(rec.doctor?.checks) ? rec.doctor.checks : [])
    .map((c: any) => ({ id: String(c?.id ?? "?"), label: String(c?.label ?? c?.id ?? "?"), ok: c?.ok === true, detail: scrubSecrets(String(c?.detail ?? "")) }));
  const isOk = (cid: string) => checks.some((c) => c.id === cid && c.ok);
  const attestFailed = checks.some((c) => c.id === "attest" && !c.ok);
  const aCorriger: Array<{ id: string; verification: string; detail: string; correction: string }> = [];
  const attendus: Array<{ id: string; verification: string; pourquoi: string }> = [];
  for (const c of checks.filter((x) => !x.ok)) {
    // échecs normaux selon le mode : démo = quote simulé ; dstack = quote par le socket ; tdx = quote direct du noyau
    const expected = TDX_CHECKS.has(c.id) && (
      mode === "demo"
      || (mode === "dstack" && c.id !== "dstack_socket" && isOk("dstack_socket") && !attestFailed)
      || (mode === "tdx" && c.id === "dstack_socket" && (isOk("tdx_guest") || isOk("tsm_report")) && !attestFailed));
    if (expected) {
      attendus.push({ id: c.id, verification: c.label, pourquoi: mode === "demo" ? "attendu en mode démo (quote simulé, accepté seulement sur testnet)" : `sans effet en mode ${mode} : le quote passe par l'autre voie et l'attestation fonctionne` });
      continue;
    }
    let correction = (FIXES[c.id] ?? `Vérification inconnue : lire le détail (« ${c.detail || "aucun"} ») et le journal ci-dessous.`).replace("{API}", base);
    if (c.id === "bond" && rec.operator && rec.productId != null) {
      try {
        const op = addr(rec.operator, "operator");
        const p = await productLite(arc, parseId(rec.productId, "productId"));
        const avail = await arc.availableBond(op);
        correction += avail < p.minBond
          ? ` Lu on-chain : caution disponible ${usdc(avail)} pour un minimum de ${usdc(p.minBond)} (produit #${p.id}), il manque ${usdc(p.minBond - avail)}.`
          : ` Mais lu on-chain : ta caution disponible (${usdc(avail)}) couvre déjà le minimum du produit #${p.id} (${usdc(p.minBond)}) : le diagnostic date sans doute d'avant ton dépôt, relance-le.`;
      } catch { /* la correction générique suffit */ }
    }
    aCorriger.push({ id: c.id, verification: c.label, detail: c.detail, correction });
  }
  const logs: string[] = (Array.isArray(rec.logs) ? rec.logs.map((l: unknown) => (typeof l === "string" ? l : JSON.stringify(l))) : String(rec.logs ?? "").split("\n"))
    .filter((l: string) => l.trim() !== "").slice(-100).map((l: string) => scrubSecrets(l).slice(0, 400));
  const erreursDuJournal = logs.filter((l) => /error|erreur|fail|échec|echec|refus|revert|econn|timeout|denied|panic|exception/i.test(l)).slice(-15);
  let attest: unknown = null;
  if (rec.attest && typeof rec.attest === "object") {
    const a = rec.attest;
    attest = { signataire: a.signer ?? null, simule: a.mock ?? null, quoteOctets: typeof a.quote === "string" && a.quote.startsWith("0x") ? (a.quote.length - 2) / 2 : null, quand: whenFr(a.at ?? a.time ?? a.timestamp).iso };
  }
  let inscriptionOnChain: unknown = null;
  if (rec.signer && /^0x[0-9a-fA-F]{40}$/.test(String(rec.signer))) {
    try {
      const signer = addr(rec.signer, "signer");
      const e = await read<any>(arc, arc.d.enclaveRegistry, enclaveRegistryAbi, "enclaveOf", [signer]);
      if (!e || e.signer === ZERO) inscriptionOnChain = { signataire: signer, inscrite: false };
      else {
        const h = await headBlock(arc);
        const activeNow = await read<boolean>(arc, arc.d.enclaveRegistry, enclaveRegistryAbi, "isActiveAt", [signer, BigInt(e.productId), h.number]);
        inscriptionOnChain = { signataire: signer, inscrite: true, produit: BigInt(e.productId).toString(), activeMaintenant: activeNow, fenetre: `blocs ${BigInt(e.fromBlock)} → ${BigInt(e.untilBlock)}`, expireLe: `${iso(BigInt(e.expiresAt))} (indicatif)` };
      }
    } catch { /* lecture on-chain indisponible : on garde le diagnostic */ }
  }
  const seen = whenFr(rec.lastSeen);
  const total = checks.length;
  return {
    disponible: true,
    machineId: rec.machineId ?? id,
    hostname: rec.hostname ?? null,
    mode: mode || null,
    status: rec.status ?? null,
    online: rec.online === true,
    lastSeen: seen.iso,
    vueDerniereFois: seen.depuis,
    productId: rec.productId != null ? String(rec.productId) : null,
    enclaveUrl: rec.enclaveUrl ?? null,
    operateur: rec.operator ?? null,
    diagnostic: { ok: rec.doctor?.ok === true, verifications: total, enEchec: aCorriger.length, attendusSelonLeMode: attendus.length, reussies: checks.filter((c) => c.ok).map((c) => c.id) },
    resume: total === 0
      ? "Le nœud n'a envoyé aucun diagnostic (doctor) : relance-le pour qu'il fasse ses vérifications."
      : aCorriger.length === 0
        ? `Diagnostic OK (${checks.filter((c) => c.ok).length}/${total} vérifications réussies${attendus.length ? `, ${attendus.length} échec(s) normal(aux) en mode ${mode}` : ""}).`
        : `${aCorriger.length} vérification(s) à corriger : ${aCorriger.map((c) => c.id).join(", ")}.`,
    aCorriger,
    attendus,
    attest,
    inscriptionOnChain,
    journal: { lignes: logs.length, erreurs: erreursDuJournal, dernieres: logs.slice(-20) },
    source: `API ArcHive ${base}/machines/${encodeURIComponent(id)}`,
  };
}
