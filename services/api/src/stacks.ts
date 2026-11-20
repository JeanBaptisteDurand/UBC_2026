/** stacks.ts — the contract stacks the API reads, and how their history is put together:
 *  - the LIVE stack: DEPLOYMENTS (path to a deployments.*.json, e.g. deployments.v3.testnet.json), like the registrar,
 *    the MCP server and the copilots; without it, the SDK's built-in v2.1 stack (`testnet`), as before;
 *  - the PREVIOUS stack, read only: v2.1 (the SDK's `testnet`), when the live stack is another stack on the same chain
 *    (HISTORY=off turns it off). The API never writes to it; it keeps its own index files, so its past (sessions,
 *    pay-per-call payments, bounties, the refutation with its slashed bond, ERC-8004 verdicts) stays readable after a
 *    switch;
 *  - every route reads the live stack. Two routes are logs of the past and cover both stacks by default: /activity
 *    (each event carries its `stack`; a previous-stack label starts with "[v2.1] ") and /stats (the cumulative
 *    counters add both stacks, `byStack` gives each one; the state counters are the live stack's). `?stack=` picks a
 *    stack on every read route that takes it.
 *  Pure functions (no network call): tested in test/stacks.test.ts. */
import { deploymentFromJson, testnet, type Deployment } from "@arcvault/sdk";
import { indexStartBlock } from "./events";

export interface StackDef {
  /** short name, from the deployment file's `version` ("3" → "v3", "2.1" → "v2.1") */
  name: string;
  /** true: the stack the API serves and that clients act on; false: a previous stack, read only */
  live: boolean;
  d: Deployment;
  /** the deployment file as written (products, levels.superseded, v21Equivalent…) */
  json: any;
  /** where it was read from */
  source: string;
}

/** The levels contracts a deployment file must name to have the verified level. */
const LEVEL_KEYS = ["MachineRegistry", "ProofOfCloudAuditor", "Ed25519Verifier", "PolicyEnclaves", "SealedBountyVerified"] as const;
const isAddr = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

/** A stack's short name from its deployment file's `version` ("3" → "v3", "2.1" → "v2.1", "v3" stays), else `fallback`. */
export function stackName(j: any, fallback: string): string {
  const v = String(j?.version ?? "").trim();
  if (!/^v?\d+(\.\d+)*$/.test(v)) return fallback;
  return v.startsWith("v") ? v : `v${v}`;
}

/** The SDK reads the verified level from `levels` only. A file whose `levels` block is missing but whose `contracts`
 *  name the five levels contracts (the v3 record before 20 Nov 2026) gets them as its `levels`: the same addresses,
 *  so the verified level is never dropped without a word. A file that has a `levels` block is returned unchanged. */
export function withLevelsFromContracts(j: any): { json: any; filled: boolean } {
  if (!j || typeof j !== "object" || isAddr(j.levels?.MachineRegistry)) return { json: j, filled: false };
  const c = j.contracts ?? {};
  if (!LEVEL_KEYS.every((k) => isAddr(c[k]))) return { json: j, filled: false };
  return { json: { ...j, levels: { ...(j.levels ?? {}), ...Object.fromEntries(LEVEL_KEYS.map((k) => [k, c[k]])) } }, filled: true };
}

const off = (v: string | undefined) => /^(off|none|no|0|false)$/i.test(String(v ?? "").trim());

/**
 * The live stack and the previous one (or null).
 *  - live: DEPLOYMENTS when set (read with `readJson`), otherwise the SDK's v2.1 stack (`v21Json`: its record);
 *  - history: the SDK's v2.1 stack, read only, when the live stack has another EnclaveRegistry on the same chain and
 *    HISTORY is not "off". Its index files are the ones the v2.1 API already keeps (same contracts, same start block),
 *    so nothing is read again at the switch.
 */
export function loadStacks(env: Record<string, string | undefined>, readJson: (path: string) => unknown, v21Json: unknown): { live: StackDef; history: StackDef | null; notes: string[] } {
  const notes: string[] = [];
  const v21: StackDef = { name: stackName(v21Json, "v2.1"), live: true, d: testnet, json: v21Json, source: "SDK built-in testnet (v2.1)" };
  const path = env.DEPLOYMENTS?.trim();
  let live = v21;
  if (path) {
    const { json, filled } = withLevelsFromContracts(readJson(path));
    if (filled) notes.push(`${path}: no levels block, the five levels contracts were taken from its contracts`);
    const d = deploymentFromJson(json);
    live = { name: stackName(json, "live"), live: true, d, json, source: path };
    if ((json?.products && Object.values(json.products).some((p: any) => String(p?.settlement ?? "") === "SealedBountyVerified")) && !d.levels) {
      notes.push(`${path}: a product settles on SealedBountyVerified but the file names no levels contracts: the verified level is not read`);
    }
  }
  const sameAsV21 = live.d.enclaveRegistry.toLowerCase() === testnet.enclaveRegistry.toLowerCase();
  let history: StackDef | null = null;
  if (!sameAsV21 && live.d.chainId === testnet.chainId && !off(env.HISTORY)) {
    history = { ...v21, live: false };
    if (history.name === live.name) history = { ...history, name: `${history.name}-previous` };
  }
  return { live, history, notes };
}

/**
 * The live product that continues a previous-stack product, from the live record: products[id].v21Equivalent
 * ("product 7 of v2.1" on v3 product 5). Previous id → live id; a previous product with no successor (v2.1's product 5,
 * the refutation demo, and 6, neutralized) is absent.
 */
export function equivalentProducts(liveJson: any, historyName: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, p] of Object.entries((liveJson?.products ?? {}) as Record<string, any>)) {
    if (!/^\d+$/.test(id)) continue;
    for (const [k, v] of Object.entries(p ?? {})) {
      if (!/Equivalent$/.test(k)) continue;
      const x = /product\s+(\d+)\s+of\s+(v[\d.]+)/i.exec(String(v ?? ""));
      if (x && x[2] === historyName) m.set(x[1]!, id);
    }
  }
  return m;
}

export type StackChoice = "live" | "history" | "all";

/** The `?stack=` value of a request: absent → `dflt`; "live" or the live name → live; "history" or the previous
 *  stack's name → history; "all" (where allowed) → both. Anything else, or the history without a previous stack: null
 *  (the route answers 400). Without a previous stack, "all" is the live stack. */
export function parseStack(raw: string | undefined, names: { live: string; history: string | null }, o: { allowAll: boolean; dflt: StackChoice }): StackChoice | null {
  const v = raw?.trim();
  const pick = (s: StackChoice): StackChoice | null => (s === "all" ? (o.allowAll ? (names.history ? "all" : "live") : null) : s === "history" && !names.history ? null : s);
  if (v === undefined || v === "") return pick(o.dflt);
  if (v === "live" || v === names.live) return "live";
  if (names.history && (v === "history" || v === names.history)) return "history";
  if (v === "all") return pick("all");
  return null;
}

/** The values `?stack=` takes on a route, for the 400 message. */
export function stackValues(names: { live: string; history: string | null }, allowAll: boolean): string[] {
  return [...new Set([names.live, "live", ...(names.history ? [names.history] : []), ...(allowAll && names.history ? ["all"] : [])])];
}

/** The /stats counters that add up across stacks: everything that happened (sessions, payments, verdicts, bounties
 *  paid, claims refuted, bonds posted and slashed). The others (enclaves, products, open bounties, pool, head, index)
 *  say what the network is now: the live stack's. */
export const CUMULATIVE_STATS = [
  "sessions", "settlements", "settledUsdc", "sessionSettledUsdc", "refundedUsdc", "x402Calls", "x402SettledUsdc",
  "verdicts", "verdictsSkipped", "verdictsNotApplicable", "bountiesPaid", "bountyPaidUsdc", "claimsRefuted",
  "bondSlashedUsdc", "bondPostedUsdc",
] as const;

const add = (a: unknown, b: unknown): number | bigint => {
  if (typeof a === "bigint" || typeof b === "bigint" || (typeof a === "string" && /^\d+$/.test(a)) || (typeof b === "string" && /^\d+$/.test(b))) {
    return BigInt(String(a ?? 0) || "0") + BigInt(String(b ?? 0) || "0");
  }
  return Number(a ?? 0) + Number(b ?? 0);
};

/** /stats over both stacks: the live stack's fields, the cumulative counters summed over the two stacks, each stack's own
 *  counters in `byStack`, and what was summed (`summed`). Without a previous stack: the live counters, named. */
export function mergeStats(live: Record<string, unknown>, history: Record<string, unknown> | null, names: { live: string; history: string | null }): Record<string, unknown> {
  if (!history || !names.history) return { ...live, stack: names.live };
  const sums = Object.fromEntries(CUMULATIVE_STATS.map((k) => [k, add(live[k], history[k])]));
  return {
    ...live, ...sums,
    stack: "all", stacks: { live: names.live, history: [names.history] }, summed: [...CUMULATIVE_STATS],
    byStack: { [names.live]: { ...live, stack: names.live }, [names.history]: { ...history, stack: names.history } },
  };
}

/** A previous-stack event's label: "[v2.1] " then the label, so that a merged list never passes a v2.1 session, bounty
 *  or product number for a live one. */
export const historyLabel = (stack: string, label: string) => `[${stack}] ${label}`;

/** An /activity event of a stack: its `stack`, its label, and on a previous stack the "[v2.1] " label and
 *  `liveProductId` (the live product that continues its product; null: none). The event's own fields stay as on Arc. */
export function tagEvent<E extends { args: Record<string, unknown> }>(
  e: E, label: string, s: { name: string; live: boolean; liveProductOf: ReadonlyMap<string, string> },
): E & { stack: string; label: string; liveProductId?: string | null } {
  if (s.live) return { ...e, stack: s.name, label };
  const has = e.args.productId !== undefined;
  return { ...e, stack: s.name, label: historyLabel(s.name, label), ...(has ? { liveProductId: s.liveProductOf.get(String(e.args.productId)) ?? null } : {}) };
}

/** A product's settlement rail on ONE stack: prepaid session (SessionPay), x402 paid call (X402Settler), Sealed Bounty
 *  at the open level (SealedBounty) or the verified level (SealedBountyVerified: product 5 on v3, 7 on v2.1), a
 *  superseded bounty contract (v2.1's former product 6: still a bounty, with no level), free (no settlement contract:
 *  the attested copilot) or other (a contract of another stack included: never mixed). */
export type Rail = "session" | "x402" | "bounty" | "free" | "other";
export function railOf(d: Deployment, superseded: ReadonlySet<string>, settlement: string): { rail: Rail; level?: "open" | "verified" } {
  const s = String(settlement).toLowerCase();
  if (s === d.sessionPay.toLowerCase()) return { rail: "session" };
  if (s === d.x402Settler.toLowerCase()) return { rail: "x402" };
  if (s === d.sealedBounty.toLowerCase()) return { rail: "bounty", level: "open" };
  if (d.levels && s === d.levels.sealedBountyVerified.toLowerCase()) return { rail: "bounty", level: "verified" };
  if (superseded.has(s)) return { rail: "bounty" };
  if (/^0x0{40}$/.test(s)) return { rail: "free" };
  return { rail: "other" };
}

/** The superseded SealedBountyVerified contracts a deployment file lists (levels.superseded: v2.1's former product 6). */
export function supersededBounties(json: any): ReadonlySet<string> {
  return new Set(((json?.levels?.superseded ?? []) as any[]).map((x) => String(x?.SealedBountyVerified ?? "").toLowerCase()).filter(isAddr));
}

/** The two event indexes of a stack: their files (named after the stack's EnclaveRegistry and MachineRegistry, so a
 *  stack keeps its files: v2.1's are the ones the API kept before the switch), their contracts (in this order: the
 *  index file records them) and their start block (the deployment block; INDEX_FROM_BLOCK only for a live stack
 *  without one). */
export function indexSpecs(def: Pick<StackDef, "d" | "live">, dataDir: string, envFromBlock?: string): {
  fromBlock: bigint; fromSource: "deployment" | "env" | "genesis";
  main: { file: string; contracts: Record<string, `0x${string}`> };
  levels: { file: string; contracts: Record<string, `0x${string}`> } | null;
} {
  const d = def.d;
  const start = indexStartBlock(d.deployBlock, def.live ? envFromBlock : undefined);
  const LV = d.levels;
  return {
    fromBlock: start.block, fromSource: start.source,
    main: {
      file: `${dataDir}/events-${d.chainId}-${d.enclaveRegistry.slice(2, 10).toLowerCase()}.json`,
      contracts: {
        EnclaveRegistry: d.enclaveRegistry, SessionPay: d.sessionPay, SealedBounty: d.sealedBounty,
        VerdictLog: d.verdictLog, X402Settler: d.x402Settler, ProductRegistry: d.productRegistry,
      },
    },
    levels: LV ? {
      file: `${dataDir}/events-${d.chainId}-levels-${LV.machineRegistry.slice(2, 10).toLowerCase()}.json`,
      contracts: {
        SealedBountyVerified: LV.sealedBountyVerified, OperatorBond: d.operatorBond,
        MachineRegistry: LV.machineRegistry, ProofOfCloudAuditor: LV.proofOfCloudAuditor,
      },
    } : null,
  };
}

/** Lists of events (each most recent first) merged into one, most recent first (same chain: block, then log index
 *  inside the block), cut at `limit`. */
export function mergeByBlock<T extends { block: number; logIndex: number }>(lists: T[][], limit: number): T[] {
  return lists.flat().sort((x, y) => y.block - x.block || y.logIndex - x.logIndex).slice(0, Math.max(0, limit));
}
