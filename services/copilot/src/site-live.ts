/** site-live.ts — the network's LIVE STATUS for the site copilot: instead of a status written into the prompt, which goes
 *  stale as soon as a VM starts or stops, each request gets ONE line read at answer time (LIVE STATUS, added by app.ts
 *  after the page line):
 *  - the active enclaves per product (ArcHive API index: /enclaves) and their level (/levels: verified = a chip declared
 *    by the Proof of Cloud alliance); the products with no active enclave;
 *  - product 7's settlement (OperatorBond.isSettlement, read by /levels: canSlash);
 *  - the open bounties of BOTH levels: SealedBounty through the API (/bounties), SealedBountyVerified (product 7) read
 *    on-chain, since the API does not index it.
 *  Limits: a read of 3.5 s at most (otherwise a fallback line that points to the tools, never a guessed status), the line
 *  kept 30 s (successes only), in ASCII English (every accented character counts as 3 tokens, app.ts).
 *  The SITE's bounty_list also adds the verified-level bounties (siteBountyList); the console and the MCP server do not
 *  depend on it (their bounty_list stays arc-actions.ts's). */
import { type Address } from "viem";
import { sealedBountyAbi, type ArcClient } from "@arcvault/sdk";
import { apiBounties, apiEnclaves, apiLevels, apiProducts } from "./archive-api";
import { executeTool, type ToolCtx } from "./tools";

/** Each product's short name (from the facts sheet); a product published since then: "product N". */
export const PRODUCT_LABELS: Readonly<Record<string, string>> = {
  "1": "Private AI, prepaid session",
  "2": "Sealed Bounty, open level",
  "3": "Private AI, pay per call (x402)",
  "4": "attested copilot",
  "5": "refutation demo of 10/11",
  "6": "retired, replaced by 7",
  "7": "Sealed Bounty, verified level",
};
const labelOf = (id: string) => (PRODUCT_LABELS[id] ? `product ${id} (${PRODUCT_LABELS[id]})` : `product ${id}`);

/** Maximum bounties read per contract (one page of an array that only grows with each bounty published). */
const MAX_VERIFIED_BOUNTIES = 50;
const LIVE_TTL_MS = 30_000;
const VERIFIED_TTL_MS = 20_000;
export const LIVE_TIMEOUT_MS = 3_500;

const ZERO = "0x0000000000000000000000000000000000000000";
const usdc = (v: bigint) => {
  const s = (Number(v) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} USDC`;
};
const iso = (ts: bigint) => new Date(Number(ts) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

export interface VerifiedBountyRow {
  id: string; protocol: Address; productId: string; balance: bigint; deadline: bigint; paused: boolean; paidAmount: bigint;
}

let verifiedCache: { t: number; key: string; v: Promise<VerifiedBountyRow[]> } | null = null;

/** The SealedBountyVerified bounties (verified level, product 7), read on-chain: bountyCount, then getBounty; [] when the
 *  stack has no levels. Kept 20 s (successes only). */
export function verifiedBountyRows(arc: ArcClient): Promise<VerifiedBountyRow[]> {
  const sbv = arc.d.levels?.sealedBountyVerified;
  if (!sbv) return Promise.resolve([]);
  const key = `${arc.d.chainId}:${sbv}`;
  const now = Date.now();
  if (verifiedCache && verifiedCache.key === key && now - verifiedCache.t < VERIFIED_TTL_MS) return verifiedCache.v;
  const read = <T>(functionName: string, args: unknown[] = []) =>
    (arc.pub as any).readContract({ address: sbv, abi: sealedBountyAbi, functionName, args }) as Promise<T>;
  const v = (async () => {
    const n = BigInt(await read<bigint | number>("bountyCount"));
    const last = n > BigInt(MAX_VERIFIED_BOUNTIES) ? BigInt(MAX_VERIFIED_BOUNTIES) : n;
    const rows: VerifiedBountyRow[] = [];
    // newest first (a fresh demo bounty is the last one published)
    for (let i = n; i > n - last; i--) {
      const b = await read<any>("getBounty", [i]);
      if (!b || b.protocol === ZERO) continue;
      rows.push({
        id: i.toString(), protocol: b.protocol, productId: BigInt(b.productId).toString(), balance: BigInt(b.balance),
        deadline: BigInt(b.deadline), paused: !!b.paused, paidAmount: BigInt(b.paidAmount ?? 0),
      });
    }
    return rows;
  })();
  verifiedCache = { t: now, key, v };
  v.catch(() => { if (verifiedCache?.v === v) verifiedCache = null; });
  return v;
}
/** Vide les caches (tests). */
export function clearLiveCaches() { verifiedCache = null; liveCache.clear(); }

const isOpen = (b: { paused: boolean; deadline: bigint; balance: bigint }, nowSec: bigint) => !b.paused && b.deadline >= nowSec && b.balance > 0n;

/** The site's bounty_list: the console's (SealedBounty, open level, through the API), plus the verified-level bounties
 *  (SealedBountyVerified, product 7) read on-chain. A failed verified-level read is reported, never hidden. */
export async function siteBountyList(input: any, ctx: ToolCtx): Promise<{ result: unknown; citations?: string[] }> {
  const base = await executeTool("bounty_list", input, ctx);
  const r = base.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || !ctx.arc.d.levels) return base;
  const onlyOpen = input?.onlyOpen === true || String(input?.onlyOpen) === "true";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let verified: Record<string, unknown>;
  try {
    const rows = (await verifiedBountyRows(ctx.arc)).map((b) => ({
      id: b.id, contrat: "SealedBountyVerified", niveau: "vérifié", produit: b.productId, protocole: b.protocol, solde: usdc(b.balance),
      echeance: iso(b.deadline), enPause: b.paused, expiree: nowSec > b.deadline, ouverte: isOpen(b, nowSec), dejaPayeDepuisLArmement: usdc(b.paidAmount),
    }));
    verified = {
      contrat: ctx.arc.d.levels.sealedBountyVerified, total: rows.length, ouvertes: rows.filter((x) => x.ouverte).length,
      primes: onlyOpen ? rows.filter((x) => x.ouverte) : rows,
      note: "Niveau vérifié (produit 7) : numéros propres à SealedBountyVerified (la prime n° 1 du niveau vérifié n'est pas la n° 1 du niveau ouvert) ; lues on-chain (bountyCount, getBounty).",
    };
  } catch (e) {
    verified = { indisponible: `lecture on-chain de SealedBountyVerified impossible pour l'instant (${String((e as Error)?.message ?? e).slice(0, 120)}) : ne dis pas qu'il n'y a aucune prime à ce niveau` };
  }
  // the sentence to repeat as is: how many bounties are open NOW, at both levels
  const o1 = typeof r.ouvertes === "number" ? r.ouvertes : null, t1 = typeof r.total === "number" ? r.total : null;
  const o2 = typeof verified.ouvertes === "number" ? verified.ouvertes : null, t2 = typeof verified.total === "number" ? verified.total : null;
  const resume = o1 === null || o2 === null
    ? "Primes ouvertes : lecture incomplète (voir ci-dessous) ; n'en invente aucune."
    : o1 + o2 === 0
      ? `Aucune prime ouverte en ce moment (niveau ouvert : 0 sur ${t1} ; niveau vérifié, produit 7 : 0 sur ${t2}) : pour chasser, il faut d'abord qu'un protocole publie une nouvelle prime. Ne présente aucune prime échue comme ouverte.`
      : `${o1 + o2} prime(s) ouverte(s) en ce moment (niveau ouvert : ${o1} sur ${t1} ; niveau vérifié, produit 7 : ${o2} sur ${t2}).`;
  return {
    result: { resume, niveauOuvert: { contrat: "SealedBounty (produits 2 et 5)", ...r }, niveauVerifie: verified },
    citations: [...(base.citations ?? []), "SealedBountyVerified.getBounty"],
  };
}

/** The site's enclaves_list: the console's, preceded by a summary PER PRODUCT (in number order: the name, the active
 *  signers), so the model no longer copies an address from another product's line. */
export async function siteEnclavesList(input: any, ctx: ToolCtx): Promise<{ result: unknown; citations?: string[] }> {
  const base = await executeTool("enclaves_list", input, ctx);
  const r = base.result as { enclaves?: Array<{ productId?: string; signer?: string; active?: boolean }> } | undefined;
  if (!r || !Array.isArray(r.enclaves)) return base;
  const by = new Map<string, string[]>();
  for (const e of r.enclaves) {
    if (!e.active || typeof e.productId !== "string" || typeof e.signer !== "string") continue;
    by.set(e.productId, [...(by.get(e.productId) ?? []), e.signer]);
  }
  const activesParProduit = [...by.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([produit, signataires]) => ({ produit, nom: PRODUCT_LABELS[produit] ?? `product ${produit}`, signataires }));
  return { result: { activesParProduit, ...r }, citations: base.citations };
}

// ---------------------------------------------------------------- la ligne LIVE STATUS

interface LevelsLite { levelOf: Map<string, string>; canSlash: boolean | null }
async function levelsLite(base?: string, timeoutMs?: number): Promise<LevelsLite | null> {
  try {
    const j = await apiLevels({ base, timeoutMs });
    const levelOf = new Map<string, string>();
    for (const e of Array.isArray(j.enclaves) ? j.enclaves : []) {
      if (e && typeof e.signer === "string" && typeof e.level === "string") levelOf.set(e.signer.toLowerCase(), e.level);
    }
    const vb = j.verifiedBounty && typeof j.verifiedBounty === "object" ? (j.verifiedBounty as Record<string, unknown>) : null;
    return { levelOf, canSlash: typeof vb?.canSlash === "boolean" ? vb.canSlash : null };
  } catch { return null; }
}

/** The line added to the site's prompt: what runs NOW (read this instant), or the fallback line. */
export async function readLiveStatus(o: { arc?: ArcClient; base?: string; now?: () => number; timeoutMs?: number } = {}): Promise<string> {
  const now = o.now?.() ?? Date.now();
  const at = new Date(now).toISOString().slice(0, 16).replace("T", " ");
  const ms = o.timeoutMs ?? LIVE_TIMEOUT_MS;
  const es = await apiEnclaves({ base: o.base, timeoutMs: ms });
  const [products, levels, open, verified] = await Promise.all([
    apiProducts({ base: o.base, timeoutMs: ms }).catch(() => null),
    levelsLite(o.base, ms),
    apiBounties({ base: o.base, timeoutMs: ms }).catch(() => null),
    o.arc ? verifiedBountyRows(o.arc).catch(() => null) : Promise.resolve(null),
  ]);
  const active = es.filter((e) => e.active);
  const ids = [...new Set(active.map((e) => e.productId.toString()))].sort((a, b) => Number(a) - Number(b));
  const parts: string[] = [];
  parts.push(active.length
    ? `${active.length} of ${es.length} registered enclaves are active: ${ids.map((id) => {
      const n = active.filter((e) => e.productId.toString() === id).length;
      return `${labelOf(id)}${n > 1 ? ` x${n}` : ""}`;
    }).join(", ")}`
    : `0 of ${es.length} registered enclaves are active: no paid use can be served right now`);
  if (levels && active.length) {
    const v = active.filter((e) => levels.levelOf.get(e.signer.toLowerCase()) === "verified").length;
    parts.push(`${v} of the ${active.length} at the verified level (chip declared by the Proof of Cloud alliance)`);
  }
  const known = products ? products.map((p) => p.id.toString()) : Object.keys(PRODUCT_LABELS);
  const idle = known.filter((id) => !ids.includes(id)).sort((a, b) => Number(a) - Number(b));
  if (idle.length) parts.push(`no active enclave for ${idle.map(labelOf).join(", ")}`);
  if (levels?.canSlash === true) parts.push("product 7's settlement is authorized: it pays proven claims and can seize bonds");
  else if (levels?.canSlash === false) parts.push("product 7's settlement is not authorized yet: it cannot pay a claim");
  const nowSec = BigInt(Math.floor(now / 1000));
  if (open && verified) {
    // each open bounty by its number AND its contract (numbers restart from 1 on each contract)
    const day = (ts: bigint) => new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ");
    const live = [
      ...verified.filter((b) => isOpen(b, nowSec)).map((b) => ({ id: b.id.toString(), c: "SealedBountyVerified", p: b.productId.toString(), bal: b.balance, dl: b.deadline })),
      ...open.filter((b) => isOpen(b, nowSec)).map((b) => ({ id: b.id.toString(), c: "SealedBounty", p: b.productId.toString(), bal: b.balance, dl: b.deadline })),
    ];
    parts.push(live.length
      ? `bounties open now: ${live.slice(0, 3).map((b) => `#${b.id} of ${b.c} (product ${b.p}, ${usdc(b.bal)}, until ${day(b.dl)} UTC)`).join(", ")}${live.length > 3 ? ` and ${live.length - 3} more (bounty_list)` : ""}; every other bounty is past its deadline (${open.length} at the open level, ${verified.length} at the verified level in all)`
      : `no bounty is open right now (all ${open.length + verified.length} are past their deadline: ${open.length} at the open level, ${verified.length} at the verified level): a hunt needs a new bounty first`);
  }
  return `LIVE STATUS (read at ${at} UTC from ArcHive's index of Arc testnet; it overrides the FACTS above and your memory; enclaves_list and bounty_list give the details): ${parts.join("; ")}.`;
}

/** When the read fails: point to the tools, guess nothing. */
export const LIVE_FALLBACK = "LIVE STATUS: the live read failed just now. Before saying what runs, call enclaves_list (authoritative); never guess and never say from memory that everything is paused or that everything runs.";

const liveCache = new Map<string, { t: number; v: string }>();

/** The function the site surface calls on every request (app.ts: SiteSurface.liveNote): the line, kept 30 s (successes
 *  only), read in 3.5 s at most, otherwise the fallback line (never an exception). */
export function createLiveNote(o: { arc?: ArcClient; base?: string; timeoutMs?: number; ttlMs?: number } = {}): () => Promise<string> {
  const ttl = o.ttlMs ?? LIVE_TTL_MS;
  const ms = o.timeoutMs ?? LIVE_TIMEOUT_MS;
  const key = `${o.base ?? ""}|${o.arc?.d.chainId ?? ""}`;
  return async () => {
    const hit = liveCache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = await Promise.race([
        readLiveStatus({ arc: o.arc, base: o.base, timeoutMs: ms }),
        new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("live status timeout")), ms + 500); }),
      ]);
      liveCache.set(key, { t: Date.now(), v });
      return v;
    } catch { return LIVE_FALLBACK; } finally { if (timer) clearTimeout(timer); }
  };
}
