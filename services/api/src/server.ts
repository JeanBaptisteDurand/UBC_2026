/** server.ts — ArcHive's read API. Exposes the state of the network over HTTP: products, enclaves (the hive), bounties,
 *  an account's sessions, pricing, receipt verification, counters, activity, proof chain.
 *  Events come from OUR index (indexer.ts: Arc's RPC, saved to disk), not from the explorer; state reads are batched
 *  with Multicall3 (one RPC call for dozens of reads).
 *  v2.1 stack (fields ADDED only; the shape of the responses does not change): v2.1 events are indexed (events.ts);
 *  /activity gives each event a label (`label`, in English); /stats counts x402 paid calls separately (x402Calls,
 *  x402SettledUsdc); /proof gives the outcome of the shown session's verdict (written, not applicable, skipped and why,
 *  pending) and the enclave's image measurement (EnclaveImage); the index starts at the deployment block.
 *  Stacks (stacks.ts; fields ADDED only): the routes read the LIVE stack, DEPLOYMENTS (a deployments.*.json, e.g.
 *  deployments.v3.testnet.json, with its own product numbers: on v3 the verified Sealed Bounty is product 5); without
 *  it, the SDK's v2.1 stack, as before. When the live stack is another one, the previous stack (v2.1) stays indexed,
 *  read only, in its own index files: /activity and /stats cover both stacks by default (each event carries its
 *  `stack`, a v2.1 label starts with "[v2.1] "; the cumulative counters add both stacks, `byStack` gives each one), and
 *  `?stack=v2.1` reads it on the other read routes (products, enclaves, bounties, sessions, levels, proof). */
import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createPublicClient, http, formatUnits, keccak256, decodeFunctionData, type Address, type Hex } from "viem";
import {
  arcTestnet, createArcClient, normalizeReceipt, recoverReceiptSigner, sessionPayAbi, type EnclaveView, type BountyRow,
  PROOF_OF_CLOUD, describeLevel, readPolicy, x402Abi, recoverCallReceiptSigner, sealedBountyAbi, recoverClaimSigner, normalizeClaim,
  type ArcClient, type Deployment,
} from "@arcvault/sdk";
import { EventIndexer, type Ev } from "./indexer";
import {
  EVENTS, EVENTS_LEVELS, MINOR_EVENTS, decodeSkipReason, eventLabel, proofVerdict, sessionVerdicts, type SessionVerdict,
} from "./events";
import { errorBody, registerOperatorRoutes } from "./operators";
import { registerTestSigner } from "./testSigner";
import {
  equivalentProducts, indexSpecs, loadStacks, mergeByBlock, mergeStats, parseStack, railOf as railKind, stackValues, supersededBounties, tagEvent,
  type Rail, type StackChoice, type StackDef,
} from "./stacks";
import deploymentsV2 from "../../../docs/history/deployments.v2.testnet.json";
import deploymentsV21 from "../../../docs/history/deployments.v21.testnet.json";

const PORT = Number(process.env.PORT ?? "8809");
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const; // deployed on Arc testnet (checked on-chain)
const pub = createPublicClient({
  chain: { ...arcTestnet, contracts: { multicall3: { address: MULTICALL3 } } },
  batch: { multicall: { wait: 16 } }, // reads started together leave as ONE eth_call
  transport: http(process.env.RPC_URL, { retryCount: 6, retryDelay: 700 }), // the public RPC refuses bursts (429)
});
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const lc = (x: unknown) => String(x ?? "").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the stacks: the live one (DEPLOYMENTS) and the previous one, read only (stacks.ts) ----------

const DEFS = loadStacks(process.env, (p) => JSON.parse(readFileSync(p, "utf8")), deploymentsV21);
for (const n of DEFS.notes) console.warn(`stacks: ${n}`);
if (DEFS.live.d.chainId !== arcTestnet.id) throw new Error(`DEPLOYMENTS: chainId ${DEFS.live.d.chainId}, but this API reads Arc testnet (${arcTestnet.id})`);

type Level = "open" | "verified";
interface BountyRail { contract: "SealedBounty" | "SealedBountyVerified"; level: Level; address: Address; client: ArcClient }
/** One stack of contracts, with its SDK client, its bounty rails and its two event indexes. */
interface Stack {
  name: string;
  live: boolean;
  d: Deployment;
  arc: ArcClient;
  /** the levels contracts (verified level), when the stack has them */
  LV: Deployment["levels"];
  rails: BountyRail[];
  /** superseded SealedBountyVerified contracts (v2.1's former product 6): not indexed, but still BOUNTY products */
  superseded: ReadonlySet<string>;
  idx: EventIndexer;
  idxLevels: EventIndexer | null;
  /** the age past which a read syncs the index: 10 s for the live stack, 5 min for a previous stack (its history) */
  maxAgeMs: number;
  merged: { a: Ev[]; b: Ev[]; v: Ev[] } | null;
  /** a previous stack's product number → the live product that continues it (v2.1's 7 → v3's 5) */
  liveProductOf: ReadonlyMap<string, string>;
}

function makeStack(def: StackDef): Stack {
  const d = def.d;
  const arc = createArcClient({ publicClient: pub as any, deployment: d });
  /** The Bounty at the verified level (product 5 on v3, product 7 on v2.1) runs the same code as SealedBounty, on another
   *  contract (SealedBountyVerified, wired to PolicyEnclaves): its bounties have their own numbers (#1 and #2 exist at
   *  both levels). The SDK client reads it by swapping SealedBounty's address. */
  const LV = d.levels;
  const arcVerified = LV ? createArcClient({ publicClient: pub as any, deployment: { ...d, sealedBounty: LV.sealedBountyVerified } }) : null;
  const rails: BountyRail[] = [
    { contract: "SealedBounty", level: "open", address: d.sealedBounty, client: arc },
    ...(LV && arcVerified ? [{ contract: "SealedBountyVerified" as const, level: "verified" as const, address: LV.sealedBountyVerified, client: arcVerified }] : []),
  ];
  const superseded = supersededBounties(def.json);
  const log = (m: string) => console.log(def.live ? m : `[${def.name}] ${m}`);
  // The index holds the events of THIS stack's contracts (one file per deployment: a new deployment starts from scratch;
  // a previous stack keeps the files it already had). It starts at the deployment block (deployBlock) when known;
  // otherwise at INDEX_FROM_BLOCK (live stack only); otherwise at 0 (the whole chain: slow).
  const spec = indexSpecs(def, DATA_DIR, process.env.INDEX_FROM_BLOCK);
  if (spec.fromSource === "genesis") console.warn(`index (${def.name}): deployment has no deployBlock and INDEX_FROM_BLOCK is unset: reading from block 0 (slow)`);
  const idx = new EventIndexer({
    pub: pub as any, chainId: d.chainId, abi: EVENTS as any, fromBlock: spec.fromBlock, log, file: spec.main.file, contracts: spec.main.contracts,
  });
  /** The SECOND index, in its own file: the Bounty at the verified level (SealedBountyVerified: its bounties, claims and
   *  payments), the operator bond (OperatorBond: deposits, slashes) and the two levels (MachineRegistry: machines bound
   *  to their chip, attestations, policies; ProofOfCloudAuditor: the alliance's tokens). The main index keeps its file
   *  and its fingerprint, so nothing is read again at deployment. The two lists are merged by block; the first read of
   *  the second index (from the deployment block) runs in the background. */
  const idxLevels = spec.levels ? new EventIndexer({
    pub: pub as any, chainId: d.chainId, abi: [...EVENTS, ...EVENTS_LEVELS] as any, fromBlock: spec.fromBlock, log,
    file: spec.levels.file, contracts: spec.levels.contracts,
  }) : null;
  return {
    name: def.name, live: def.live, d, arc, LV, rails, superseded, idx, idxLevels, maxAgeMs: def.live ? 10_000 : 300_000, merged: null,
    liveProductOf: def.live ? new Map() : equivalentProducts(DEFS.live.json, def.name),
  };
}
const LIVE = makeStack(DEFS.live);
const HISTORY: Stack | null = DEFS.history ? makeStack(DEFS.history) : null;
const STACKS: Stack[] = HISTORY ? [LIVE, HISTORY] : [LIVE];
const NAMES = { live: LIVE.name, history: HISTORY?.name ?? null };

const app = new Hono();
app.use("*", cors());
const J = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

// In-memory cache: the browser reads the state through this API (one batched read on the server side) instead of
// hammering Arc's public RPC (which caps at 429). A stale entry is served at once and refreshed in the background
// (one read at a time per key): no visitor waits for a cold read, except the very first one after startup (warmed
// up at launch).
// If a read fails, the last good result stays served.
const cache = new Map<string, { t: number; v: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
function refresh(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  let p = inflight.get(key);
  if (!p) {
    p = fn().then((v) => { cache.set(key, { t: Date.now(), v }); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
async function cached(key: string, ttlMs: number, fn: () => Promise<unknown>) {
  const hit = cache.get(key);
  if (hit) {
    if (Date.now() - hit.t >= ttlMs) refresh(key, fn).catch((e) => console.warn(`refresh ${key}:`, (e as Error).message));
    return hit.v;
  }
  return refresh(key, fn);
}
/** a stack's cache entry: the same key never mixes two stacks (numbers of sessions, bounties and products repeat) */
const ck = (S: Stack, key: string) => `${S.name}:${key}`;
/** a previous stack's state changes little: read at most once a minute */
const ttl = (S: Stack, ms: number) => (S.live ? ms : Math.max(ms, 60_000));

/** Read parameters are checked (a number, an address): an unreadable value is a 400 in JSON, never a 503 "Cannot
 *  convert … to a BigInt"; a product that does not exist is a 404, never a product full of zeros. */
const ID_RE = /^\d{1,12}$/;
const badParam = (name: string, expected: string) => errorBody("invalid_param", `${name}: ${expected} expected`, { param: name });
/** a query parameter the route does not know: refused (a typo must not give another answer) */
function unknownParam(c: { req: { queries: () => Record<string, string[]> } }, allowed: string[]) {
  const k = Object.keys(c.req.queries()).find((x) => !allowed.includes(x));
  return k ? errorBody("unknown_param", `unknown query parameter: ${k} (allowed: ${allowed.join(", ") || "none"})`, { param: k }) : null;
}
/** The stack a request reads (`?stack=`): the live one by default; on the two logs of the past (/activity, /stats),
 *  both by default ("all"). null: a value the route does not take (400). */
function chooseStack(c: Context, allowAll: boolean): { kind: StackChoice; S: Stack } | null {
  const kind = parseStack(c.req.query("stack"), NAMES, { allowAll, dflt: allowAll ? "all" : "live" });
  if (kind === null) return null;
  return { kind, S: kind === "history" && HISTORY ? HISTORY : LIVE };
}
const badStack = (allowAll: boolean) => badParam("stack", `one of ${stackValues(NAMES, allowAll).join(", ")}`);

app.get("/health", (c) => c.json({ ok: true, chainId: LIVE.d.chainId, stack: LIVE.name, history: NAMES.history }));
// ---------- lists: the index says WHO exists, a batched read gives their current state ----------

async function listProducts(S: Stack) {
  const n = Number(await S.arc.productCount());
  return Promise.all(Array.from({ length: n }, (_, i) => S.arc.getProduct(BigInt(i + 1))));
}
const productsOf = (S: Stack) => cached(ck(S, "products"), ttl(S, 30_000), () => listProducts(S)) as Promise<any[]>;

/** Each enclave with its registered X25519 key, its validity window in blocks and its state at the head block
 *  (activeOperatorAt ≠ 0: it can sign now). */
async function listEnclaves(S: Stack): Promise<Array<EnclaveView & { status: EnclaveStatus; statusReason?: string }>> {
  const ev = await events(S);
  const signers: Address[] = [];
  const seen = new Set<string>();
  for (const e of ev) {
    if (e.name !== "EnclaveRegistered") continue;
    const s = String(e.args.signer).toLowerCase();
    if (!seen.has(s)) { seen.add(s); signers.push(e.args.signer as Address); }
  }
  const views = (await Promise.all(signers.map((s) => S.arc.enclaveView(s)))).filter((x): x is EnclaveView => x !== null);
  return views.map((v) => ({ ...v, ...statusOf(ev, String(v.signer), !!(v as any).active) }));
}
const enclavesOf = (S: Stack) => cached(ck(S, "enclaves"), ttl(S, 15_000), () => listEnclaves(S)) as Promise<any[]>;

/** The state of an enclave key, as the chain tells it: active (it signs now), retired by its operator
 *  (EnclaveRetired), killed (EnclaveInvalidated, with the reason) or expired (registration not renewed). The last of
 *  these events, after its latest registration, decides. */
type EnclaveStatus = "active" | "retired" | "invalidated" | "expired";
function statusOf(ev: Ev[], signer: string, active: boolean): { status: EnclaveStatus; statusReason?: string } {
  if (active) return { status: "active" };
  const s = signer.toLowerCase();
  const last = ev.find((e) => (e.name === "EnclaveRegistered" || e.name === "EnclaveRetired" || e.name === "EnclaveInvalidated") && lc(e.args.signer) === s);
  if (last?.name === "EnclaveRetired") return { status: "retired" };
  if (last?.name === "EnclaveInvalidated") return { status: "invalidated", statusReason: String(last.args.reason ?? "") };
  return { status: "expired" };
}

/** The bounties of BOTH levels. Each row keeps the SDK's fields (BountyRow) and gives its level (`level`), its
 *  contract (`contract`, `address`) and what happened on Arc: `paidOut` = USDC really paid (sum of the BountyPaid
 *  events), `claimsAccepted` and `claimsRefuted` (claims accepted, then refuted: nothing paid for them).
 *  `paidAmount` stays the on-chain field (the highest tier reserved or paid since the arming): it does NOT say that a
 *  payment took place (bounty #2 of v2.1's product 5, refuted, keeps 0.5 USDC reserved and paid nothing). */
async function listBounties(S: Stack, level: Level | "all" = "open") {
  const ev = await events(S);
  const rows: Array<{ block: number; row: Record<string, unknown> }> = [];
  for (const r of S.rails) {
    if (level !== "all" && r.level !== level) continue;
    const created = new Map<string, number>(); // number → creation block
    for (const e of ev) {
      if (e.contract === r.contract && e.name === "BountyCreated" && !created.has(String(e.args.bountyId))) created.set(String(e.args.bountyId), e.block);
    }
    const ids = [...created.keys()];
    const got: BountyRow[] = await Promise.all(ids.map((id) => r.client.getBounty(BigInt(id))));
    got.forEach((b, i) => {
      const id = ids[i]!;
      const mine = ev.filter((e) => e.contract === r.contract && String(e.args.bountyId) === id);
      const count = (n: string) => mine.filter((e) => e.name === n).length;
      rows.push({
        block: created.get(id)!,
        row: {
          ...b, level: r.level, contract: r.contract, address: r.address,
          paidOut: mine.filter((e) => e.name === "BountyPaid").reduce((s, e) => s + BigInt(String(e.args.amount)), 0n),
          claimsAccepted: count("ClaimAccepted"), claimsRefuted: count("ClaimRefuted"),
        },
      });
    });
  }
  // the most recent first, all levels together
  return rows.sort((a, b) => b.block - a.block).map((x) => x.row);
}
const bountiesOf = (S: Stack, level: Level | "all") => cached(ck(S, `bounties:${level}`), ttl(S, 20_000), () => listBounties(S, level)) as Promise<any[]>;
/** each bounty's product ("contract:number" → product), from its BountyCreated */
function bountyProducts(ev: Ev[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of ev) if (e.name === "BountyCreated") m.set(`${e.contract}:${String(e.args.bountyId)}`, String(e.args.productId));
  return m;
}

/** The session carries its enclave, price, model and unit, locked at opening. */
async function listSessionsOf(S: Stack, owner: string) {
  const o = owner.toLowerCase();
  const ids = [...new Set((await events(S)).filter((e) => e.name === "SessionOpened" && String(e.args.owner).toLowerCase() === o).map((e) => String(e.args.sessionId)))].map((x) => BigInt(x));
  const ss = await Promise.all(ids.map((id) => S.arc.getSession(id)));
  return ss.map((s) => ({
    id: s.id, productId: s.productId, deposit: s.deposit, paid: s.paid, closed: s.closed, enclave: s.enclave, operator: s.operator,
    price: s.price, expiresAt: s.expiresAt, paidUnits: s.paidUnits, verdictWritten: s.verdictWritten,
  }));
}

app.get("/products", async (c) => {
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  return c.json(J(await productsOf(ch.S)));
});

/** The TWO operator levels. For each active enclave: its machine (the PPID from Intel's certificate), whether the
 *  binding is up to date, and the Proof of Cloud alliance's attestation (verified on-chain); for each product: the
 *  level it requires and its verifiers; and when the Bounty at the verified level can slash (the bond's delay). */
async function computeLevels(S: Stack) {
  const L = S.LV;
  if (!L) return { enabled: false };
  const [enclaves, products] = await Promise.all([listEnclaves(S), listProducts(S)]);
  const rows = await Promise.all(enclaves.filter((e: any) => e.active).map(async (e: any) => {
    const r = await describeLevel(pub as any, S.d, e.signer as Address, BigInt(e.productId));
    return {
      signer: e.signer, productId: e.productId, operator: e.operator, ppid: r.machine.ppid, bindingCurrent: r.machine.current,
      level: r.verifiedByProofOfCloud ? "verified" : "open", proofOfCloud: r.proofOfCloud ?? null,
      productRequires: r.product?.required === 1 ? "verified" : "open", meetsProduct: r.product?.meets ?? true,
    };
  }));
  const policies = await Promise.all(products.map(async (_p: unknown, i: number) => {
    const pol = await readPolicy(pub as any, S.d, BigInt(i + 1));
    return { productId: i + 1, requires: pol.minLevel === 1 ? "verified" : "open", auditors: pol.auditors, pending: pol.pending ?? null };
  }));
  const bondAbi = [{ type: "function", name: "settlementApplyAt", stateMutability: "view", inputs: [{ name: "s", type: "address" }], outputs: [{ type: "uint64" }] },
    { type: "function", name: "isSettlement", stateMutability: "view", inputs: [{ name: "s", type: "address" }], outputs: [{ type: "bool" }] }] as const;
  const [applyAt, active] = await Promise.all([
    pub.readContract({ address: S.d.operatorBond, abi: bondAbi, functionName: "settlementApplyAt", args: [L.sealedBountyVerified] }),
    pub.readContract({ address: S.d.operatorBond, abi: bondAbi, functionName: "isSettlement", args: [L.sealedBountyVerified] }),
  ]);
  return {
    enabled: true, contracts: L,
    alliance: { name: "Proof of Cloud", key: PROOF_OF_CLOUD.allianceKey, peers: PROOF_OF_CLOUD.peers, source: PROOF_OF_CLOUD.source, auditor: L.proofOfCloudAuditor },
    verifiedBounty: { address: L.sealedBountyVerified, canSlash: active, slashFrom: Number(applyAt) || null },
    enclaves: rows, products: policies,
  };
}
app.get("/levels", async (c) => {
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  return c.json(J(await cached(ck(ch.S, "levels"), ttl(ch.S, 30_000), () => computeLevels(ch.S))));
});

async function productOr404(S: Stack, id: bigint) {
  const n = BigInt((await productsOf(S)).length);
  return id >= 1n && id <= n ? S.arc.getProduct(id) : null;
}
app.get("/products/:id", async (c) => {
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  const raw = c.req.param("id");
  if (!ID_RE.test(raw)) return c.json(badParam("id", "a product number"), 400);
  const p = await productOr404(ch.S, BigInt(raw));
  if (!p) return c.json(errorBody("unknown_product", `no product #${raw}`, { id: raw }), 404);
  return c.json(J(p));
});
app.get("/enclaves", async (c) => {
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  return c.json(J(await enclavesOf(ch.S)));
});
/** /bounties: the bounties of the open level (SealedBounty), as before; ?level=verified: those of the verified level
 *  (SealedBountyVerified: product 5 on v3, product 7 on v2.1); ?level=all: both, the most recent first (the number
 *  alone does not identify a bounty: read `level` or `contract`). */
app.get("/bounties", async (c) => {
  const bad = unknownParam(c, ["level", "stack"]);
  if (bad) return c.json(bad, 400);
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  const level = c.req.query("level") ?? "open";
  if (level !== "open" && level !== "verified" && level !== "all") return c.json(badParam("level", "open, verified or all"), 400);
  return c.json(J(await bountiesOf(ch.S, level)));
});
app.get("/sessions/:owner", async (c) => {
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  const owner = c.req.param("owner");
  if (!ADDR_RE.test(owner)) return c.json(errorBody("invalid_address", "address expected (0x + 40 hexadecimal characters)"), 400);
  return c.json(J(await cached(ck(ch.S, `sessions:${owner.toLowerCase()}`), ttl(ch.S, 10_000), () => listSessionsOf(ch.S, owner))));
});

app.get("/pricing", async (c) => {
  const bad = unknownParam(c, ["productId", "units"]);
  if (bad) return c.json(bad, 400);
  const rawId = c.req.query("productId"), rawUnits = c.req.query("units") ?? "1";
  if (rawId === undefined || !ID_RE.test(rawId)) return c.json(badParam("productId", "a product number"), 400);
  if (!/^\d{1,18}$/.test(rawUnits)) return c.json(badParam("units", "a whole number of units"), 400);
  const id = BigInt(rawId);
  const units = BigInt(rawUnits);
  const p = await productOr404(LIVE, id);
  if (!p) return c.json(errorBody("unknown_product", `no product #${rawId}`, { id: rawId }), 404);
  return c.json({
    productId: id.toString(), pricePerUnit: formatUnits(p.price, 6) + " USDC", units: units.toString(), total: formatUnits(p.price * units, 6) + " USDC",
    // units = ceil((input tokens + outWeight × output tokens) / unitTokens), locked when the session opens
    unitTokens: p.unitTokens, outWeight: p.outWeight,
  });
});

// ---------- console: counters, activity, proof chain (our event index) ----------

// Fallback image when an enclave's measurement is not in IMAGE_OF below: the v2 inference enclave at Phala
// (pinned by digest: enclave/phala/sealed-chat-v2.yml)
const IMAGE = process.env.INFERENCE_IMAGE ?? "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:eceb67a5bf985a9672d51db288ef85c9e2cb7908835057ea24888517793173fa";

/** The image (digest) behind every known enclave measurement, read from the deployment files (images are pinned by
 *  digest; the measurement is the imageId registered on Arc). Without a verified manifest, the proof chain names the image
 *  the chosen enclave actually ran, not the fallback image above (which only applies to the v2 inference enclave). */
const IMAGE_OF = (() => {
  const m = new Map<string, string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    const id = r.imageId ?? r.workloadId;
    if (typeof r.image === "string" && r.image.startsWith("ghcr.io/") && typeof id === "string") m.set(id.toLowerCase(), r.image);
    Object.values(r).forEach(walk);
  };
  walk(deploymentsV2);
  walk(deploymentsV21);
  // the live stack's file (DEPLOYMENTS), and the previous stack's: the images their enclaves ran
  for (const s of [DEFS.live, DEFS.history]) if (s) walk(s.json);
  // Images registered after the last deployment file (checked: the replayed measurement equals EnclaveRegistry.imageIdOf;
  // enclave/phala/copilot-site-v22.yml pins this digest): the site copilot in its enclave (product 4), registration
  // tx 0xbe9deb65…, enclave key 0xfD0F…305a
  m.set("0x7c4e666755be9d9443913f07e3f6265e6b12b5d3af73da6f5f889c1e70e39d63",
    "ghcr.io/jeanbaptistedurand/archive-copilot-enclave@sha256:eeb889b054e021ff17ee933873080403965623f4f36693986f2d780b269bf5dd");
  // The same site copilot, next image (ghcr.io/jeanbaptistedurand/archive-copilot-enclave:v22-site-r3),
  // enclave 0x09061F21A5b938cD941ea9eDfa481f89DEb716Ac
  m.set("0x5771d334e0566b3b6126c630be055e9be6b94dd8eedd66fb076955b8b8bcebe0",
    "ghcr.io/jeanbaptistedurand/archive-copilot-enclave@sha256:22a18ce87d4ec47a37b526f431e208dab057f4db7170ff8d4fdb2983e95327ec");
  return m;
})();

/** The events of a stack, up to date (synced less than 10 s ago on the live stack, 5 min on a previous one); if the RPC
 *  refuses, those already indexed. Most recent first, both indexes merged (the second, and a previous stack's main
 *  index, are awaited for 2.5 s only: a long catch-up blocks no page). */
async function events(S: Stack): Promise<Ev[]> {
  const warn = (e: unknown) => console.warn(`index (${S.name}):`, (e as Error).message.slice(0, 160));
  const second = S.idxLevels ? S.idxLevels.sync(S.maxAgeMs).catch(warn) : null;
  if (S.live) {
    try { await S.idx.sync(S.maxAgeMs); } catch (e) { warn(e); }
  } else {
    await Promise.race([S.idx.sync(S.maxAgeMs).catch(warn), sleep(2_500)]);
  }
  if (second) await Promise.race([second, sleep(2_500)]);
  const a = S.idx.events(), b = S.idxLevels?.events() ?? [];
  if (!b.length) return a;
  if (S.merged && S.merged.a === a && S.merged.b === b) return S.merged.v;
  const v = [...a, ...b].sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
  S.merged = { a, b, v };
  return v;
}
/** the live stack's index (as before: its fields at the top), and the previous stack's (`history`) */
app.get("/index", (c) => c.json({
  ...LIVE.idx.status(), levels: LIVE.idxLevels?.status() ?? null, stack: LIVE.name,
  history: HISTORY ? { stack: HISTORY.name, ...HISTORY.idx.status(), levels: HISTORY.idxLevels?.status() ?? null } : null,
}));

const sumOf = (ev: Ev[], name: string, field: string) => ev.filter((e) => e.name === name).reduce((s, e) => s + BigInt(e.args[field] as any), 0n);
const countOf = (ev: Ev[], name: string) => ev.filter((e) => e.name === name).length;

/** One stack's counters (each stack is counted on its own: its sessions, bounties and products have their own numbers). */
function statsOf(S: Stack): Promise<Record<string, unknown>> {
  return cached(ck(S, "stats"), ttl(S, 15_000), async () => {
    const ev = await events(S);
    const encs = await enclavesOf(S);
    // the bounties of both levels (SealedBounty and SealedBountyVerified)
    const bounties = await bountiesOf(S, "all");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const plist = await productsOf(S);
    const products = plist.length;
    return {
      enclaves: encs.length, enclavesActive: encs.filter((e) => e.active).length, products,
      productsActive: plist.filter((p) => p.state === "Active").length,
      sessions: countOf(ev, "SessionOpened"),
      settlements: countOf(ev, "Settled"),
      // everything settled to operators (and shared with the author and the network): sessions AND x402 paid calls
      settledUsdc: sumOf(ev, "Settled", "paidDelta") + sumOf(ev, "CallSettled", "amount"),
      sessionSettledUsdc: sumOf(ev, "Settled", "paidDelta"),
      refundedUsdc: sumOf(ev, "SessionClosed", "refund"),
      // pay per call (X402Settler.CallSettled): the number of settled calls and the USDC settled
      x402Calls: countOf(ev, "CallSettled"),
      x402SettledUsdc: sumOf(ev, "CallSettled", "amount"),
      verdicts: countOf(ev, "Recorded"),
      // skipped verdicts (VerdictSkipped) and closings without payment, hence without a verdict (VerdictNotApplicable)
      verdictsSkipped: countOf(ev, "VerdictSkipped"),
      verdictsNotApplicable: countOf(ev, "VerdictNotApplicable"),
      bounties: bounties.length, bountyPool: bounties.reduce((s, b) => s + BigInt(b.balance), 0n),
      // open: neither paused nor expired (they can be hunted now), and the count per level
      bountiesOpen: bounties.filter((b) => !b.paused && BigInt(b.deadline) >= now).length,
      bountiesByLevel: { open: bounties.filter((b) => b.level === "open").length, verified: bounties.filter((b) => b.level === "verified").length },
      bountiesPaid: ev.filter((e) => e.name === "BountyPaid").length, bountyPaidUsdc: sumOf(ev, "BountyPaid", "amount"),
      // refuted claims (nothing paid for them) and slashed bonds (OperatorBond.Slashed, second index)
      claimsRefuted: countOf(ev, "ClaimRefuted"), bondSlashedUsdc: sumOf(ev, "Slashed", "amount"), bondPostedUsdc: sumOf(ev, "Bonded", "amount"),
      head: await pub.getBlockNumber(),
      index: S.idx.status(),
    };
  }) as Promise<Record<string, unknown>>;
}
/** /stats: by default (`stack=all`) the network over both stacks: what happened (sessions, payments, verdicts, bounties
 *  paid, refutations, bonds) added up over the live stack and the previous one, what the network is now (enclaves,
 *  products, open bounties, pool) from the live stack, each stack's own counters in `byStack`. `?stack=v3` (the live
 *  stack's name) or `?stack=v2.1`: one stack alone. If the previous stack cannot be read, the live counters are served
 *  alone, with `historyError`. */
app.get("/stats", async (c) => {
  const ch = chooseStack(c, true);
  if (!ch) return c.json(badStack(true), 400);
  if (ch.kind === "all" && HISTORY) {
    const [a, b] = await Promise.all([statsOf(LIVE), statsOf(HISTORY).then((v) => ({ v, err: null }), (e) => ({ v: null, err: String((e as Error)?.message ?? e).slice(0, 160) }))]);
    return c.json(J(b.v ? mergeStats(a, b.v, NAMES) : { ...mergeStats(a, null, NAMES), historyError: b.err }));
  }
  return c.json(J({ ...(await statsOf(ch.S)), stack: ch.S.name }));
});

/** A stack's latest events, labelled. A previous stack's event says so: `stack`, a label that starts with "[v2.1] ",
 *  and `liveProductId`, the live product that continues its product (null: none, e.g. v2.1's refutation demo, product
 *  5). Its own fields (args: product, session, bounty numbers) stay as written on Arc. */
function activityOf(S: Stack, ev: Ev[], minor: boolean, limit: number): Array<Ev & { stack: string; label: string; liveProductId?: string | null }> {
  // a bounty event that carries only the number (claim, payment, refutation…) gets the product of its bounty
  // (args.productId, read from the BountyCreated of the SAME contract): numbers exist at both levels, and the number
  // alone would tie bounty #2 of one level to bounty #2 of the other
  const pid = bountyProducts(ev);
  const out: Array<Ev & { stack: string; label: string; liveProductId?: string | null }> = [];
  for (const e of ev) {
    if (!minor && MINOR_EVENTS.has(e.name)) continue;
    const p = e.args.bountyId !== undefined && e.args.productId === undefined ? pid.get(`${e.contract}:${String(e.args.bountyId)}`) : undefined;
    const x = p !== undefined ? { ...e, args: { ...e.args, productId: p } } : e;
    out.push(tagEvent(x, eventLabel(x), S));
    if (out.length >= limit) break;
  }
  return out;
}
/** /activity: the latest events, by default of both stacks (`stack=all`), the most recent first; `?stack=v3` (the live
 *  stack's name) or `?stack=v2.1`: one stack alone. */
app.get("/activity", async (c) => {
  const ch = chooseStack(c, true);
  if (!ch) return c.json(badStack(true), 400);
  const raw = Number(c.req.query("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(Math.floor(raw), 100)) : 25;
  // the bond's bookkeeping events (reserve, release, exposure) only on request (?minor=1)
  const minor = c.req.query("minor") === "1";
  const stacks = ch.kind === "all" ? STACKS : [ch.S];
  const lists = await Promise.all(stacks.map(async (S) => activityOf(S, await events(S), minor, limit)));
  // each event keeps its shape (contract, name, args, block, logIndex, tx); `label`: its readable label (English);
  // `stack`: the stack it happened on
  return c.json(J(mergeByBlock(lists, limit)));
});

// Signer of the receipt paid by a settle(r, signature) transaction: read from its calldata (immutable, cached).
const settleSigner = new Map<string, string | null>();
async function signerOfSettle(S: Stack, tx: string): Promise<string | null> {
  const key = ck(S, tx);
  if (settleSigner.has(key)) return settleSigner.get(key)!;
  let who: string | null = null;
  try {
    const t = await S.arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: sessionPayAbi, data: t.input });
    if (d.functionName === "settle") {
      const [r, sig] = d.args as unknown as [any, Hex];
      who = (await recoverReceiptSigner(S.d.sessionPay, r, sig, S.d.chainId)).toLowerCase();
    }
  } catch { return null; } // a failed read: retried at the next refresh
  settleSigner.set(key, who);
  return who;
}

/** The enclave that signed the receipt of an x402 paid call: X402Settler.settle(cr, enclaveSig, auth), read from the
 *  transaction's calldata (immutable, cached); null if the call went through another contract. */
const callSigner = new Map<string, string | null>();
async function signerOfCall(S: Stack, tx: string): Promise<string | null> {
  const key = ck(S, tx);
  if (callSigner.has(key)) return callSigner.get(key)!;
  let who: string | null = null;
  try {
    const t = await S.arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: x402Abi, data: t.input });
    if (d.functionName === "settle") {
      const [cr, sig] = d.args as unknown as [any, Hex];
      who = (await recoverCallReceiptSigner(S.d.x402Settler, cr, sig, S.d.chainId)).toLowerCase();
    }
  } catch { return null; }
  callSigner.set(key, who);
  return who;
}

/** The enclaves that signed an accepted bounty claim: acceptClaim(claim, signatures) or claim(claim, signatures, cP),
 *  read from the transaction's calldata (immutable, cached). */
const claimSigners = new Map<string, string[]>();
async function signersOfClaim(S: Stack, tx: string, contract: Address): Promise<string[] | null> {
  const key = `${contract.toLowerCase()}:${tx}`;
  if (claimSigners.has(key)) return claimSigners.get(key)!;
  const who: string[] = [];
  try {
    const t = await S.arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: sealedBountyAbi, data: t.input });
    if (d.functionName === "acceptClaim" || d.functionName === "claim") {
      const [claim, sigs] = d.args as unknown as [any, Hex[]];
      const c = normalizeClaim(claim);
      for (const s of sigs) who.push((await recoverClaimSigner(contract, c, s, S.d.chainId)).toLowerCase());
    }
  } catch { return null; }
  claimSigners.set(key, who);
  return who;
}

/** A product's settlement rail on its stack (stacks.ts, railOf): prepaid session, x402 paid call, Sealed Bounty (two
 *  levels: the bounty rail of the stack), free (no settlement contract: the attested copilot) or other. */
function railOf(S: Stack, settlement: string): { rail: Rail; bounty?: BountyRail } {
  const r = railKind(S.d, S.superseded, settlement);
  const bounty = r.level ? S.rails.find((x) => x.level === r.level) : undefined;
  return bounty ? { rail: r.rail, bounty } : { rail: r.rail };
}

// The proof chain shows ONLY facts of the enclave on display: its registration, a payment settled on a receipt it
// signed (signer found in the settle call), and the verdict written when one of its sessions closed.
// Never a fact borrowed from another enclave (e.g. the bounty's demo machine).
// When no verdict is written, the chain says why for the session shown (proofVerdict, events.ts):
// skipped (VerdictSkipped, with the reason), not applicable (session closed without payment: VerdictNotApplicable) or pending.

/** A session's locked enclave (immutable from opening): read once on-chain, then kept (per stack: numbers repeat). */
const sessionEnclave = new Map<string, string>();
/** This product's sessions closed WITHOUT payment (VerdictNotApplicable) and locked to this enclave: no settlement
 *  ties them to it, so their enclave is read on-chain (the 20 most recent, in batched reads). */
async function unpaidSessionsOf(S: Stack, signer: string, productId: string, ev: Ev[], outcomes: Map<string, SessionVerdict>): Promise<Set<string>> {
  const ofProduct = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === productId).map((e) => String(e.args.sessionId)));
  const ids = [...outcomes.values()]
    .filter((v) => v.outcome === "not_applicable" && ofProduct.has(v.sessionId))
    .sort((a, b) => (b.block ?? 0) - (a.block ?? 0)).slice(0, 20).map((v) => v.sessionId);
  const out = new Set<string>();
  await Promise.all(ids.map(async (id) => {
    let enc = sessionEnclave.get(ck(S, id));
    if (enc === undefined) {
      try { enc = String((await S.arc.getSession(BigInt(id))).enclave).toLowerCase(); } catch { return; } // read again on the next pass
      sessionEnclave.set(ck(S, id), enc);
    }
    if (enc === signer) out.add(id);
  }));
  return out;
}
// The image shown at link 1 is the one the product's AUTHOR pinned: its public manifest, whose hash is registered in
// ProductRegistry. It shows as pinned only if keccak256(manifest) = the on-chain manifestHash.
const manifests = new Map<string, { t: number; v: { image: string; manifestURI: string; manifestVerified: boolean } }>();
/** The image a manifest pins: its `image` field, otherwise the single image of its `composes` (the refutation demo's
 *  manifest, v2.1's product 5, describes three VMs on the same image); none (empty) if it names no single image.
 *  Never the default image above. */
function imageOfManifest(m: any): string {
  const ok = (x: unknown): x is string => typeof x === "string" && x.startsWith("ghcr.io/");
  if (ok(m?.image)) return m.image;
  const all = [...new Set((Array.isArray(m?.composes) ? m.composes : []).map((c: any) => c?.image).filter(ok))];
  return all.length === 1 ? String(all[0]) : "";
}
async function pinnedImage(S: Stack, productId: bigint) {
  const p = await S.arc.getProduct(productId) as any;
  const key = ck(S, `${productId}:${p.manifestHash}`);
  const hit = manifests.get(key);
  if (hit && Date.now() - hit.t < 600_000) return hit.v;
  let v = { image: IMAGE, manifestURI: String(p.manifestURI ?? ""), manifestVerified: false };
  try {
    const res = await fetch(p.manifestURI, { signal: AbortSignal.timeout(5_000) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok && keccak256(bytes).toLowerCase() === String(p.manifestHash).toLowerCase()) {
      // verified = the manifest is the one registered on Arc AND it pins an image (otherwise, link 1 falls back to the
      // image id replayed at registration and to our deployments)
      const img = imageOfManifest(JSON.parse(new TextDecoder().decode(bytes)));
      v = { image: img || IMAGE, manifestURI: p.manifestURI, manifestVerified: !!img };
    }
  } catch { /* manifest unreachable: default image, not marked verified */ }
  manifests.set(key, { t: Date.now(), v });
  return v;
}

/** The proof chain of ONE enclave of a stack. With no parameter: the inference enclave (the one in service, otherwise
 *  the one that served the last paid session), as before. `signer` (a registered enclave key) or `product` (the
 *  product's active enclave, otherwise its latest registered one). Links 5 and 6 follow the product's RAIL: session
 *  (Settled paid on a receipt signed by the enclave, then the closing verdict), x402 paid call (a CallSettled whose call
 *  receipt the enclave signed; a call writes no ERC-8004 verdict), bounty (BountyPaid of a claim the enclave signed, and
 *  the verdict written with it), free (the attested copilot: nothing to settle, no verdict). */
async function computeProof(S: Stack, o: { signer?: string; product?: string } = {}) {
  const ev = await events(S);
  const encs = await enclavesOf(S);
  // never a demo machine (image id "demo", measurements declared to the test module)
  const DEMO_WORKLOAD = "0x595b5067f7b9e6b4153462ea198226ec97dfbc2f5a8200b0c4ce763c983f54e4";
  const real = encs.filter((e) => String(e.workloadId).toLowerCase() !== DEMO_WORKLOAD);
  const inference = String(S.d.products?.inference ?? 1n);
  let act = o.signer !== undefined ? encs.find((e) => lc(e.signer) === lc(o.signer)) ?? null
    : o.product !== undefined ? (() => {
      const mine = real.filter((e) => String(e.productId) === o.product);
      return mine.find((e) => e.active) ?? [...mine].sort((a, b) => Number(b.registeredAt) - Number(a.registeredAt))[0] ?? null;
    })()
    : real.find((e) => e.active && String(e.productId) === inference) ?? real.find((e) => e.active) ?? null;
  if (!act && o.signer === undefined && o.product === undefined) {
    // with no active enclave (VM paused): the INFERENCE enclave that served the last paid session (full chain:
    // settlement and verdict), otherwise the latest inference enclave; never the first one found (often the copilot,
    // with no settlement or verdict: 3 empty links)
    const infSessions = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === inference).map((e) => String(e.args.sessionId)));
    const served = new Set<string>();
    for (const e of ev) {
      if (e.name !== "Settled" || !infSessions.has(String(e.args.sessionId))) continue;
      const who = await signerOfSettle(S, e.tx);
      if (who) served.add(who.toLowerCase());
    }
    act = real.find((e) => String(e.productId) === inference && served.has(String(e.signer).toLowerCase()))
      ?? real.find((e) => String(e.productId) === inference) ?? real[0] ?? null;
  }
  const signer = act ? String(act.signer).toLowerCase() : "";
  const reg = act ? ev.find((e) => e.name === "EnclaveRegistered" && String(e.args.signer).toLowerCase() === signer) : undefined;
  const plist = await productsOf(S);
  const prod = act ? plist[Number(act.productId) - 1] : undefined;
  const { rail, bounty } = prod ? railOf(S, String(prod.settlement)) : { rail: null, bounty: undefined };
  let settle: Ev | undefined;
  let settleUsdc: unknown = null;
  let settleBounty: string | null = null;
  // bounty: the verdict written (or skipped) in the claim's or the payment's transaction
  let paidVerdict: Partial<SessionVerdict> & { outcome: "written" | "skipped" | "none"; tx: string | null } | null = null;
  const servedSessions = new Set<string>();
  if (act && reg && rail === "session") {
    const ofProduct = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === String(act.productId)).map((e) => String(e.args.sessionId)));
    for (const e of ev) { // most recent first
      // no filter by block: a re-registration (same key) must not erase its settlements; the proof is the signer
      if (e.name !== "Settled" || !ofProduct.has(String(e.args.sessionId))) continue;
      if ((await signerOfSettle(S, e.tx)) !== signer) continue;
      servedSessions.add(String(e.args.sessionId));
      settle ??= e;
    }
    settleUsdc = settle?.args.paidDelta ?? null;
  } else if (act && reg && rail === "x402") {
    for (const e of ev) {
      if (e.name !== "CallSettled" || String(e.args.productId) !== String(act.productId) || lc(e.args.operator) !== lc(act.operator)) continue;
      if ((await signerOfCall(S, e.tx)) !== signer) continue;
      settle = e;
      break;
    }
    settleUsdc = settle?.args.amount ?? null;
  } else if (act && reg && rail === "bounty" && bounty) {
    for (const p of ev) {
      if (p.contract !== bounty.contract || p.name !== "BountyPaid") continue;
      const id = String(p.args.bountyId);
      // the paid claim: the latest accepted for this bounty, at the latest in the payment's block
      const claim = ev.find((e) => e.contract === bounty.contract && e.name === "ClaimAccepted" && String(e.args.bountyId) === id && e.block <= p.block);
      if (!claim || !(await signersOfClaim(S, claim.tx, bounty.address))?.includes(signer)) continue;
      settle = p; settleUsdc = p.args.amount; settleBounty = id;
      const txs = new Set([p.tx, claim.tx]);
      const rec = ev.find((e) => e.name === "Recorded" && txs.has(e.tx));
      const skip = ev.find((e) => e.name === "VerdictSkipped" && e.contract === bounty.contract && txs.has(e.tx));
      paidVerdict = rec ? { outcome: "written", tx: rec.tx, agentId: String(rec.args.agentId), response: Number(rec.args.response) }
        : skip ? { outcome: "skipped", tx: skip.tx, reasonData: String(skip.args.reason ?? "0x"), reason: decodeSkipReason(skip.args.reason) }
        : { outcome: "none", tx: null };
      break;
    }
  }
  // the outcome of each session's closing verdict, and the one the chain shows (written, otherwise why not)
  const outcomes = sessionVerdicts(ev);
  const unpaid = act && rail === "session" ? await unpaidSessionsOf(S, signer, String(act.productId), ev, outcomes) : new Set<string>();
  const shown = !act ? null
    : rail === "session" ? proofVerdict(outcomes, servedSessions, unpaid, settle ? String(settle.args.sessionId) : null)
    : rail === "bounty" ? (paidVerdict as SessionVerdict | null)
    // an x402 paid call and a free product write no ERC-8004 verdict (only sessions and bounties write one)
    : ({ sessionId: "", outcome: "no_verdict_rail", tx: null, block: null } as unknown as SessionVerdict);
  const verdict = shown?.outcome === "written" ? shown : null; // the most recent WRITTEN verdict of a served session
  // the enclave's IMAGE id (RTMR3 event log replayed on-chain at registration), if it was emitted
  const image = act ? ev.find((e) => e.name === "EnclaveImage" && String(e.args.signer).toLowerCase() === signer) : undefined;
  const pin = act ? await pinnedImage(S, BigInt(act.productId)) : { image: IMAGE, manifestURI: "", manifestVerified: false };
  // without a verified manifest: the image THIS enclave ran (its image id, read on Arc, is in our deployments);
  // unknown: empty, never the default image
  const ran = act ? IMAGE_OF.get(String(image?.args.imageId ?? act.workloadId).toLowerCase()) : undefined;
  const imageRef = pin.manifestVerified ? pin.image : (ran ?? "");
  const imageSource = pin.manifestVerified ? "manifest" : ran ? "deployments" : "unknown";
  return {
    image: imageRef, imageSource, manifestURI: pin.manifestURI, manifestVerified: pin.manifestVerified, enclave: act ?? null, registerTx: reg?.tx ?? null,
    // the rail of the enclave's product (session | x402 | bounty | free | other); the settlement shown at link 5
    // is a session (`settleSession`), a paid call (CallSettled) or a bounty (`settleBounty`, at level `settleLevel`)
    rail, settleTx: settle?.tx ?? null, settleUsdc, settleSession: rail === "session" ? settle?.args.sessionId ?? null : null,
    settleBounty, settleLevel: settleBounty !== null ? bounty?.level ?? null : null,
    verdictTx: verdict?.tx ?? null, verdictAgentId: verdict?.agentId ?? null, verdictResponse: verdict?.response ?? null,
    // added fields: the session the "verdict" link speaks of, and the outcome of its verdict
    // ("written" | "not_applicable": closed without payment | "skipped": write refused, `verdictReason` | "none" | "pending"
    // | "no_verdict_rail": x402 paid call or free product, which write no verdict)
    verdictSession: shown?.sessionId || null, verdictStatus: shown?.outcome ?? null, verdictStatusTx: shown?.tx ?? null,
    verdictReason: shown?.reason ?? null, verdictReasonData: shown?.reasonData ?? null, verdictSalted: shown?.salted ?? null,
    enclaveImage: image ? {
      imageId: String(image.args.imageId), composeHash: String(image.args.composeHash), osImageHash: String(image.args.osImageHash), tx: image.tx,
    } : null,
    // the stack this chain was read on
    stack: S.name,
    index: S.idx.status(),
  };
}
/** /proof: the inference enclave's chain; ?signer=0x…: that of a registered enclave key; ?product=N: that of the
 *  product's active enclave N (otherwise its latest registered one). A key or a product without an enclave: 404 (never
 *  another enclave's chain). The live stack's, or with ?stack=v2.1 the previous stack's (its numbers: product 7 there). */
app.get("/proof", async (c) => {
  const bad = unknownParam(c, ["signer", "product", "stack"]);
  if (bad) return c.json(bad, 400);
  const ch = chooseStack(c, false);
  if (!ch) return c.json(badStack(false), 400);
  const S = ch.S;
  const signer = c.req.query("signer"), product = c.req.query("product");
  if (signer !== undefined && product !== undefined) return c.json(errorBody("invalid_param", "signer or product, not both", { param: "product" }), 400);
  if (signer !== undefined && !ADDR_RE.test(signer)) return c.json(badParam("signer", "an enclave key (0x + 40 hexadecimal characters)"), 400);
  if (product !== undefined && !ID_RE.test(product)) return c.json(badParam("product", "a product number"), 400);
  if (signer !== undefined || product !== undefined) {
    const encs = await enclavesOf(S);
    if (signer !== undefined && !encs.some((e) => lc(e.signer) === lc(signer))) {
      return c.json(errorBody("unknown_enclave", `no enclave key ${signer} is registered`, { signer }), 404);
    }
    if (product !== undefined && !encs.some((e) => String(e.productId) === product)) {
      return c.json(errorBody("unknown_product", `no enclave was ever registered for product #${product}`, { id: product }), 404);
    }
  }
  const key = signer !== undefined ? `proof:s:${lc(signer)}` : product !== undefined ? `proof:p:${product}` : "proof";
  return c.json(J(await cached(ck(S, key), ttl(S, 15_000), () => computeProof(S, { signer, product }))));
});

/** A receipt is checked EXACTLY as SessionPay.settle will check it (the session's locked enclave, active at the anchor
 *  block with the session's operator, locked model, increasing cumulative total); `active` keeps its old meaning. On the
 *  live stack: a receipt is signed for one SessionPay contract, and only the live one settles. */
app.post("/verify-receipt", async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  if (!body?.receipt || !body?.signature) return c.json(errorBody("receipt_expected", "expected { receipt, signature }"), 400);
  let r;
  try { r = normalizeReceipt(body.receipt); } catch { return c.json(errorBody("receipt_unreadable", "unreadable receipt"), 400); }
  let signer: Address;
  try { signer = await recoverReceiptSigner(LIVE.d.sessionPay, r, body.signature as Hex, LIVE.d.chainId); } catch { return c.json(errorBody("signature_unreadable", "unreadable signature"), 400); }
  void signer; // a readable signature: the full check follows
  const v = await LIVE.arc.verifyReceipt(r, body.signature as Hex);
  return c.json(J({
    signer: v.signer, operator: v.activeOperatorAtAnchor, active: v.checks.find((x) => x.id === "active")?.ok ?? false,
    settleable: v.settleable, payableNow: v.payableNow, checks: v.checks,
  }));
});

// arrival of the operators' machines: pairing by code, arcop_ keys, heartbeats, diagnosis (live stack)
registerOperatorRoutes(app, LIVE.arc);
// test mode (testnet): a provisioned server wallet, off without TEST_SIGNER_PK + TEST_SIGNER_TOKEN; it signs only
// toward the live stack's contracts
registerTestSigner(app, LIVE.d);

// any unexpected error leaves as readable JSON (never an empty HTML page), with its stable code
app.onError((err, c) => c.json(errorBody("server_error", String(err?.message ?? err)), 503));
// an unknown route too (never a plain-text "404 Not Found")
app.notFound((c) => c.json(errorBody("not_found", `unknown route: ${c.req.method} ${c.req.path}`), 404));

serve({ fetch: app.fetch, port: PORT });
console.log(`ArcHive API on http://localhost:${PORT}  (products, enclaves, bounties, sessions/:owner, pricing, verify-receipt)`);
console.log(`stack ${LIVE.name} (${DEFS.live.source}), EnclaveRegistry ${LIVE.d.enclaveRegistry}, index from block ${LIVE.idx.status().fromBlock}`
  + (HISTORY ? `; previous stack ${HISTORY.name}, read only (${DEFS.history?.source}), EnclaveRegistry ${HISTORY.d.enclaveRegistry}` : "; no previous stack"));
// the index stays up to date even with no visitor (otherwise the first visit after a long pause waits for the catch-up);
// a previous stack every 5 minutes
setInterval(() => {
  for (const S of STACKS) {
    const age = S.live ? 30_000 : S.maxAgeMs;
    S.idx.sync(age).catch((e) => console.warn(`index (${S.name}):`, (e as Error).message.slice(0, 160)));
    S.idxLevels?.sync(age).catch((e) => console.warn(`index (${S.name}, levels):`, (e as Error).message.slice(0, 160)));
  }
}, 60_000).unref();
// warm-up: the first visit does not pay for a cold read of the events (the second index reads in the background)
LIVE.idxLevels?.sync(0).catch((e) => console.warn("index (levels):", (e as Error).message))
  .then(() => LIVE.idxLevels && console.log(`levels index: ${LIVE.idxLevels.status().events} events up to block ${LIVE.idxLevels.status().lastBlock}`));
LIVE.idx.sync(0).catch((e) => console.warn("index:", (e as Error).message))
  .then(() => cached(ck(LIVE, "proof"), 15_000, () => computeProof(LIVE)))
  .then(() => console.log(`cache warmed: ${LIVE.idx.status().events} events indexed up to block ${LIVE.idx.status().lastBlock}`))
  .catch((e) => console.warn("warm-up:", (e as Error).message));
// the previous stack's catch-up starts 15 s later (its files are usually up to date: a few chunks), so that the live
// index has the RPC first
if (HISTORY) {
  const H = HISTORY;
  setTimeout(() => {
    Promise.all([H.idx.sync(0), H.idxLevels?.sync(0)])
      .then(() => console.log(`[${H.name}] index read only: ${H.idx.status().events} + ${H.idxLevels?.status().events ?? 0} events up to block ${H.idx.status().lastBlock}`))
      .catch((e) => console.warn(`index (${H.name}):`, (e as Error).message));
  }, 15_000).unref();
}
