/** server.ts — API de lecture d'ArcHive. Expose l'état du réseau en HTTP : produits, enclaves (la ruche), primes,
 *  sessions d'un compte, prix, vérification de reçu, compteurs, activité, chaîne de preuves.
 *  Les événements viennent de NOTRE index (indexer.ts : RPC d'Arc, enregistré sur disque), plus de l'explorateur ;
 *  les lectures d'état sont groupées par Multicall3 (un seul appel RPC pour des dizaines de lectures).
 *  9/11 (pile v2.1, champs AJOUTÉS seulement, la forme des réponses ne change pas) : les événements v2.1 sont indexés
 *  (events.ts) ; /activity donne à chaque événement un libellé (`label`, anglais) ; /stats compte à part les appels payés
 *  x402 (x402Calls, x402SettledUsdc) ; /proof dit l'issue du verdict de la session montrée (écrit, sans objet, sauté et
 *  pourquoi, en attente) et l'empreinte d'image de l'enclave (EnclaveImage) ; l'index part du bloc du déploiement. */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createPublicClient, http, formatUnits, keccak256, decodeFunctionData, type Address, type Hex } from "viem";
import {
  arcTestnet, createArcClient, normalizeReceipt, recoverReceiptSigner, testnet, sessionPayAbi, type EnclaveView, type BountyRow,
  PROOF_OF_CLOUD, describeLevel, readPolicy, x402Abi, recoverCallReceiptSigner, sealedBountyAbi, recoverClaimSigner, normalizeClaim,
  type ArcClient,
} from "@arcvault/sdk";
import { EventIndexer, type Ev } from "./indexer";
import {
  EVENTS, EVENTS_LEVELS, MINOR_EVENTS, decodeSkipReason, eventLabel, indexStartBlock, proofVerdict, sessionVerdicts, type SessionVerdict,
} from "./events";
import { errorBody, registerOperatorRoutes } from "./operators";
import { registerTestSigner } from "./testSigner";
import deploymentsV2 from "../../../deployments.v2.testnet.json";
import deploymentsV21 from "../../../deployments.v21.testnet.json";

const PORT = Number(process.env.PORT ?? "8809");
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const; // présent sur Arc testnet (vérifié le 7/11)
const pub = createPublicClient({
  chain: { ...arcTestnet, contracts: { multicall3: { address: MULTICALL3 } } },
  batch: { multicall: { wait: 16 } }, // les lectures lancées ensemble partent en UN eth_call
  transport: http(process.env.RPC_URL, { retryCount: 6, retryDelay: 700 }), // le RPC public refuse les rafales (429)
});
const arc = createArcClient({ publicClient: pub as any });
/** 19/11 : la Prime au niveau vérifié (produit 7) est le même code que SealedBounty, sur un autre contrat
 *  (SealedBountyVerified, branché sur PolicyEnclaves) : ses primes ont leurs propres numéros (n° 1 et 2 existent aux deux
 *  niveaux). Le client du SDK la lit en remplaçant l'adresse de SealedBounty. */
const LV = testnet.levels;
const arcVerified = LV ? createArcClient({ publicClient: pub as any, deployment: { ...testnet, sealedBounty: LV.sealedBountyVerified } }) : null;
type Level = "open" | "verified";
interface BountyRail { contract: "SealedBounty" | "SealedBountyVerified"; level: Level; address: Address; client: ArcClient }
const BOUNTY_RAILS: BountyRail[] = [
  { contract: "SealedBounty", level: "open", address: testnet.sealedBounty, client: arc },
  ...(LV && arcVerified ? [{ contract: "SealedBountyVerified" as const, level: "verified" as const, address: LV.sealedBountyVerified, client: arcVerified }] : []),
];
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const lc = (x: unknown) => String(x ?? "").toLowerCase();

const app = new Hono();
app.use("*", cors());
const J = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

// Cache mémoire : le navigateur lit l'état via cette API (une lecture groupée côté serveur), au lieu de
// marteler le RPC public d'Arc (qui plafonne à 429). Une entrée périmée est servie tout de suite et
// rafraîchie en arrière-plan (une seule lecture à la fois par clé) : aucun visiteur n'attend une lecture
// à froid, sauf la toute première après le démarrage (préchauffée au lancement). Si la lecture échoue,
// le dernier bon résultat reste servi.
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
    if (Date.now() - hit.t >= ttlMs) refresh(key, fn).catch((e) => console.warn(`rafraîchissement ${key} :`, (e as Error).message));
    return hit.v;
  }
  return refresh(key, fn);
}

app.get("/health", (c) => c.json({ ok: true, chainId: testnet.chainId }));
// ---------- listes : l'index donne QUI existe, une lecture groupée donne leur état actuel ----------

async function listProducts() {
  const n = Number(await arc.productCount());
  return Promise.all(Array.from({ length: n }, (_, i) => arc.getProduct(BigInt(i + 1))));
}

/** v2 : chaque enclave avec sa clé X25519 inscrite, sa fenêtre de validité en blocs et son état au bloc de tête
 *  (activeOperatorAt ≠ 0 : elle peut signer maintenant). */
async function listEnclaves(): Promise<Array<EnclaveView & { status: EnclaveStatus; statusReason?: string }>> {
  const ev = await events();
  const signers: Address[] = [];
  const seen = new Set<string>();
  for (const e of ev) {
    if (e.name !== "EnclaveRegistered") continue;
    const s = String(e.args.signer).toLowerCase();
    if (!seen.has(s)) { seen.add(s); signers.push(e.args.signer as Address); }
  }
  const views = (await Promise.all(signers.map((s) => arc.enclaveView(s)))).filter((x): x is EnclaveView => x !== null);
  return views.map((v) => ({ ...v, ...statusOf(ev, String(v.signer), !!(v as any).active) }));
}

/** 19/11 : l'état d'une clé d'enclave, dit par la chaîne : active (elle signe maintenant), retirée par son opérateur
 *  (EnclaveRetired), invalidée (EnclaveInvalidated, avec la raison) ou expirée (inscription non renouvelée). C'est le
 *  dernier de ces événements, après sa dernière inscription, qui décide. */
type EnclaveStatus = "active" | "retired" | "invalidated" | "expired";
function statusOf(ev: Ev[], signer: string, active: boolean): { status: EnclaveStatus; statusReason?: string } {
  if (active) return { status: "active" };
  const s = signer.toLowerCase();
  const last = ev.find((e) => (e.name === "EnclaveRegistered" || e.name === "EnclaveRetired" || e.name === "EnclaveInvalidated") && lc(e.args.signer) === s);
  if (last?.name === "EnclaveRetired") return { status: "retired" };
  if (last?.name === "EnclaveInvalidated") return { status: "invalidated", statusReason: String(last.args.reason ?? "") };
  return { status: "expired" };
}

/** 19/11 : les primes des DEUX niveaux. Chaque ligne garde les champs du SDK (BountyRow) et dit son niveau (`level`), son
 *  contrat (`contract`, `address`) et ce qui s'est passé sur Arc : `paidOut` = USDC réellement versés (somme des
 *  BountyPaid), `claimsAccepted` et `claimsRefuted` (réclamations acceptées, puis réfutées : rien de payé pour elles).
 *  `paidAmount` reste le champ on-chain (le plus haut palier réservé ou payé depuis l'armement) : il ne dit PAS qu'un
 *  paiement a eu lieu (la prime n° 2 du produit 5, réfutée le 10/11, garde 0,5 USDC réservés et n'a rien payé). */
async function listBounties(level: Level | "all" = "open") {
  const ev = await events();
  const rows: Array<{ block: number; row: Record<string, unknown> }> = [];
  for (const r of BOUNTY_RAILS) {
    if (level !== "all" && r.level !== level) continue;
    const created = new Map<string, number>(); // numéro → bloc de création
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
  // la plus récente d'abord, tous niveaux confondus
  return rows.sort((a, b) => b.block - a.block).map((x) => x.row);
}
/** le produit de chaque prime (« contrat:numéro » → produit), d'après son BountyCreated */
function bountyProducts(ev: Ev[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of ev) if (e.name === "BountyCreated") m.set(`${e.contract}:${String(e.args.bountyId)}`, String(e.args.productId));
  return m;
}

/** v2 : la session porte son enclave, son prix, son modèle et son unité, verrouillés à l'ouverture. */
async function listSessionsOf(owner: string) {
  const o = owner.toLowerCase();
  const ids = [...new Set((await events()).filter((e) => e.name === "SessionOpened" && String(e.args.owner).toLowerCase() === o).map((e) => String(e.args.sessionId)))].map((x) => BigInt(x));
  const ss = await Promise.all(ids.map((id) => arc.getSession(id)));
  return ss.map((s) => ({
    id: s.id, productId: s.productId, deposit: s.deposit, paid: s.paid, closed: s.closed, enclave: s.enclave, operator: s.operator,
    price: s.price, expiresAt: s.expiresAt, paidUnits: s.paidUnits, verdictWritten: s.verdictWritten,
  }));
}

app.get("/products", async (c) => c.json(J(await cached("products", 30_000, listProducts))));

/** 10/11 : les DEUX NIVEAUX d'opérateur. Pour chaque enclave active : sa machine (PPID du certificat d'Intel), si la
 *  liaison est à jour, et la déclaration de l'alliance Proof of Cloud (vérifiée on-chain) ; pour chaque produit : le
 *  niveau qu'il exige et ses vérificateurs ; et quand la Prime au niveau vérifié peut saisir (délai de la caution). */
async function computeLevels() {
  const L = testnet.levels;
  if (!L) return { enabled: false };
  const [enclaves, products] = await Promise.all([listEnclaves(), listProducts()]);
  const rows = await Promise.all(enclaves.filter((e: any) => e.active).map(async (e: any) => {
    const r = await describeLevel(pub as any, testnet, e.signer as Address, BigInt(e.productId));
    return {
      signer: e.signer, productId: e.productId, operator: e.operator, ppid: r.machine.ppid, bindingCurrent: r.machine.current,
      level: r.verifiedByProofOfCloud ? "verified" : "open", proofOfCloud: r.proofOfCloud ?? null,
      productRequires: r.product?.required === 1 ? "verified" : "open", meetsProduct: r.product?.meets ?? true,
    };
  }));
  const policies = await Promise.all(products.map(async (_p: unknown, i: number) => {
    const pol = await readPolicy(pub as any, testnet, BigInt(i + 1));
    return { productId: i + 1, requires: pol.minLevel === 1 ? "verified" : "open", auditors: pol.auditors, pending: pol.pending ?? null };
  }));
  const bondAbi = [{ type: "function", name: "settlementApplyAt", stateMutability: "view", inputs: [{ name: "s", type: "address" }], outputs: [{ type: "uint64" }] },
    { type: "function", name: "isSettlement", stateMutability: "view", inputs: [{ name: "s", type: "address" }], outputs: [{ type: "bool" }] }] as const;
  const [applyAt, active] = await Promise.all([
    pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "settlementApplyAt", args: [L.sealedBountyVerified] }),
    pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "isSettlement", args: [L.sealedBountyVerified] }),
  ]);
  return {
    enabled: true, contracts: L,
    alliance: { name: "Proof of Cloud", key: PROOF_OF_CLOUD.allianceKey, peers: PROOF_OF_CLOUD.peers, source: PROOF_OF_CLOUD.source, auditor: L.proofOfCloudAuditor },
    verifiedBounty: { address: L.sealedBountyVerified, canSlash: active, slashFrom: Number(applyAt) || null },
    enclaves: rows, products: policies,
  };
}
app.get("/levels", async (c) => c.json(J(await cached("levels", 30_000, computeLevels))));

/** 19/11 : les paramètres de lecture sont vérifiés (un numéro, une adresse) : une valeur illisible est un 400 en JSON,
 *  jamais un 503 « Cannot convert … to a BigInt » ; un produit qui n'existe pas est un 404, jamais un produit tout à zéro. */
const ID_RE = /^\d{1,12}$/;
const badParam = (name: string, expected: string) => errorBody("invalid_param", `${name}: ${expected} expected`, { param: name });
/** un paramètre de requête que la route ne connaît pas : refusé (une faute de frappe ne doit pas donner une autre réponse) */
function unknownParam(c: { req: { queries: () => Record<string, string[]> } }, allowed: string[]) {
  const k = Object.keys(c.req.queries()).find((x) => !allowed.includes(x));
  return k ? errorBody("unknown_param", `unknown query parameter: ${k} (allowed: ${allowed.join(", ") || "none"})`, { param: k }) : null;
}
async function productOr404(id: bigint) {
  const n = BigInt(Number((await cached("products", 30_000, listProducts) as unknown[]).length));
  return id >= 1n && id <= n ? arc.getProduct(id) : null;
}
app.get("/products/:id", async (c) => {
  const raw = c.req.param("id");
  if (!ID_RE.test(raw)) return c.json(badParam("id", "a product number"), 400);
  const p = await productOr404(BigInt(raw));
  if (!p) return c.json(errorBody("unknown_product", `no product #${raw}`, { id: raw }), 404);
  return c.json(J(p));
});
app.get("/enclaves", async (c) => c.json(J(await cached("enclaves", 15_000, listEnclaves))));
/** /bounties : les primes du niveau ouvert (SealedBounty), comme avant ; ?level=verified : celles du niveau vérifié
 *  (SealedBountyVerified, produit 7) ; ?level=all : les deux, la plus récente d'abord (le numéro seul ne suffit pas à
 *  désigner une prime : lire `level` ou `contract`). */
app.get("/bounties", async (c) => {
  const bad = unknownParam(c, ["level"]);
  if (bad) return c.json(bad, 400);
  const level = c.req.query("level") ?? "open";
  if (level !== "open" && level !== "verified" && level !== "all") return c.json(badParam("level", "open, verified or all"), 400);
  return c.json(J(await cached(`bounties:${level}`, 20_000, () => listBounties(level))));
});
app.get("/sessions/:owner", async (c) => {
  const owner = c.req.param("owner");
  if (!ADDR_RE.test(owner)) return c.json(errorBody("invalid_address", "address expected (0x + 40 hexadecimal characters)"), 400);
  return c.json(J(await cached(`sessions:${owner.toLowerCase()}`, 10_000, () => listSessionsOf(owner))));
});

app.get("/pricing", async (c) => {
  const bad = unknownParam(c, ["productId", "units"]);
  if (bad) return c.json(bad, 400);
  const rawId = c.req.query("productId"), rawUnits = c.req.query("units") ?? "1";
  if (rawId === undefined || !ID_RE.test(rawId)) return c.json(badParam("productId", "a product number"), 400);
  if (!/^\d{1,18}$/.test(rawUnits)) return c.json(badParam("units", "a whole number of units"), 400);
  const id = BigInt(rawId);
  const units = BigInt(rawUnits);
  const p = await productOr404(id);
  if (!p) return c.json(errorBody("unknown_product", `no product #${rawId}`, { id: rawId }), 404);
  return c.json({
    productId: id.toString(), pricePerUnit: formatUnits(p.price, 6) + " USDC", units: units.toString(), total: formatUnits(p.price * units, 6) + " USDC",
    // v2 : unités = ceil((jetons d'entrée + outWeight × jetons de sortie) / unitTokens), verrouillées à l'ouverture de session
    unitTokens: p.unitTokens, outWeight: p.outWeight,
  });
});

// ---------- console : compteurs, activité, chaîne de preuves (notre index d'événements) ----------

// image de l'enclave d'inférence v2 déployée chez Phala (épinglée par digest : enclave/phala/sealed-chat-v2.yml)
const IMAGE = process.env.INFERENCE_IMAGE ?? "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:eceb67a5bf985a9672d51db288ef85c9e2cb7908835057ea24888517793173fa";

/** 17/11 : l'image (digest) de chaque empreinte d'enclave connue, d'après nos fichiers de déploiement (images épinglées par
 *  digest ; l'empreinte est l'imageId inscrit sur Arc). Sans manifeste vérifié, la chaîne de preuves nomme l'image que
 *  l'enclave choisie a VRAIMENT fait tourner, au lieu de l'image par défaut ci-dessus (celle de la v2, fausse pour toute
 *  autre enclave : la chaîne du 16/11 montrait eceb67a5… pour une enclave qui faisait tourner 5699da22…). */
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
  // les images inscrites après le dernier fichier de déploiement (VERIFIED : l'empreinte rejouée est égale à
  // EnclaveRegistry.imageIdOf ; enclave/phala/copilot-site-v22.yml épingle ce
  // condensat) : le copilote du site en enclave (produit 4), image r2, inscrit le 19/11 (tx 0xbe9deb65…), clé 0xfD0F…305a
  m.set("0x7c4e666755be9d9443913f07e3f6265e6b12b5d3af73da6f5f889c1e70e39d63",
    "ghcr.io/jeanbaptistedurand/archive-copilot-enclave@sha256:eeb889b054e021ff17ee933873080403965623f4f36693986f2d780b269bf5dd");
  // 19/11 (r3) : the same site copilot, image v22-site-r3 (ghcr.io/jeanbaptistedurand/archive-copilot-enclave:v22-site-r3),
  // enclave 0x09061F21A5b938cD941ea9eDfa481f89DEb716Ac
  m.set("0x5771d334e0566b3b6126c630be055e9be6b94dd8eedd66fb076955b8b8bcebe0",
    "ghcr.io/jeanbaptistedurand/archive-copilot-enclave@sha256:22a18ce87d4ec47a37b526f431e208dab057f4db7170ff8d4fdb2983e95327ec");
  return m;
})();
/** 19/11 (r2) : les SealedBountyVerified remplacés (deployments.v21.testnet.json, levels.superseded : celui de l'ancien
 *  produit 6, désactivé le 10/11 et remplacé par le 7). Hors de l'index (aucune prime n'y a été payée), mais leur produit
 *  reste une PRIME : la chaîne de preuves dit « aucune prime payée », jamais « appel payé ou gratuit, pas de verdict ». */
const SUPERSEDED_BOUNTIES: ReadonlySet<string> = new Set(
  (((deploymentsV21 as any).levels?.superseded ?? []) as any[]).map((x) => lc(x?.SealedBountyVerified)).filter((x) => ADDR_RE.test(x)),
);

// L'index tient les événements de NOS contrats (fichier par déploiement : un nouveau déploiement repart de zéro). Il part
// du bloc du déploiement (deployBlock) s'il est connu ; sinon de INDEX_FROM_BLOCK ; sinon de 0 (toute la chaîne : lent).
const START = indexStartBlock(testnet.deployBlock, process.env.INDEX_FROM_BLOCK);
if (START.source === "genesis") console.warn("index : déploiement sans deployBlock et INDEX_FROM_BLOCK absent : lecture depuis le bloc 0 (lente)");
const idx = new EventIndexer({
  pub: pub as any, chainId: testnet.chainId, abi: EVENTS as any, fromBlock: START.block,
  file: `${DATA_DIR}/events-${testnet.chainId}-${testnet.enclaveRegistry.slice(2, 10).toLowerCase()}.json`,
  contracts: {
    EnclaveRegistry: testnet.enclaveRegistry, SessionPay: testnet.sessionPay, SealedBounty: testnet.sealedBounty,
    VerdictLog: testnet.verdictLog, X402Settler: testnet.x402Settler, ProductRegistry: testnet.productRegistry,
  },
});
/** 19/11 : le SECOND index, dans son propre fichier : la Prime au niveau vérifié (SealedBountyVerified : ses primes, ses
 *  réclamations, ses paiements), la caution des opérateurs (OperatorBond : dépôts, saisies) et les deux niveaux
 *  (MachineRegistry : machines liées à leur puce, déclarations, politiques ; ProofOfCloudAuditor : jetons de l'alliance).
 *  L'index principal garde son fichier et son empreinte : rien à relire au déploiement. Les deux listes sont fusionnées
 *  par bloc ; la première lecture du second index (depuis le bloc du déploiement) se fait en arrière-plan. */
const idxLevels = LV ? new EventIndexer({
  pub: pub as any, chainId: testnet.chainId, abi: [...EVENTS, ...EVENTS_LEVELS] as any, fromBlock: START.block,
  file: `${DATA_DIR}/events-${testnet.chainId}-levels-${LV.machineRegistry.slice(2, 10).toLowerCase()}.json`,
  contracts: {
    SealedBountyVerified: LV.sealedBountyVerified, OperatorBond: testnet.operatorBond,
    MachineRegistry: LV.machineRegistry, ProofOfCloudAuditor: LV.proofOfCloudAuditor,
  },
}) : null;
let merged: { a: Ev[]; b: Ev[]; v: Ev[] } | null = null;
/** Les événements à jour (synchronisés il y a moins de 10 s) ; si le RPC refuse, ceux déjà indexés. Du plus récent au plus
 *  ancien, les deux index fusionnés (le second n'est attendu que 2,5 s : une longue reprise ne bloque aucune page). */
async function events(): Promise<Ev[]> {
  const warn = (e: unknown) => console.warn("index :", (e as Error).message.slice(0, 160));
  const second = idxLevels ? idxLevels.sync(10_000).catch(warn) : null;
  try { await idx.sync(10_000); } catch (e) { warn(e); }
  if (second) await Promise.race([second, new Promise((r) => setTimeout(r, 2_500))]);
  const a = idx.events(), b = idxLevels?.events() ?? [];
  if (!b.length) return a;
  if (merged && merged.a === a && merged.b === b) return merged.v;
  const v = [...a, ...b].sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
  merged = { a, b, v };
  return v;
}
app.get("/index", (c) => c.json({ ...idx.status(), levels: idxLevels?.status() ?? null }));

const sumOf = (ev: Ev[], name: string, field: string) => ev.filter((e) => e.name === name).reduce((s, e) => s + BigInt(e.args[field] as any), 0n);
const countOf = (ev: Ev[], name: string) => ev.filter((e) => e.name === name).length;

app.get("/stats", async (c) => c.json(J(await cached("stats", 15_000, async () => {
  const ev = await events();
  const encs = await cached("enclaves", 15_000, listEnclaves) as any[];
  // 19/11 : les primes des deux niveaux (SealedBounty et SealedBountyVerified)
  const bounties = await cached("bounties:all", 20_000, () => listBounties("all")) as any[];
  const now = BigInt(Math.floor(Date.now() / 1000));
  const plist = await cached("products", 30_000, listProducts) as any[];
  const products = plist.length;
  return {
    enclaves: encs.length, enclavesActive: encs.filter((e) => e.active).length, products,
    productsActive: plist.filter((p) => p.state === "Active").length,
    sessions: countOf(ev, "SessionOpened"),
    settlements: countOf(ev, "Settled"),
    // tout ce qui est réglé aux opérateurs (et partagé avec l'auteur et le réseau) : sessions ET appels payés x402
    settledUsdc: sumOf(ev, "Settled", "paidDelta") + sumOf(ev, "CallSettled", "amount"),
    sessionSettledUsdc: sumOf(ev, "Settled", "paidDelta"),
    refundedUsdc: sumOf(ev, "SessionClosed", "refund"),
    // paiement à l'appel (X402Settler.CallSettled) : nombre d'appels réglés et USDC réglés
    x402Calls: countOf(ev, "CallSettled"),
    x402SettledUsdc: sumOf(ev, "CallSettled", "amount"),
    verdicts: countOf(ev, "Recorded"),
    // v2.1 : verdicts sautés (VerdictSkipped) et fermetures sans paiement, donc sans verdict (VerdictNotApplicable)
    verdictsSkipped: countOf(ev, "VerdictSkipped"),
    verdictsNotApplicable: countOf(ev, "VerdictNotApplicable"),
    bounties: bounties.length, bountyPool: bounties.reduce((s, b) => s + BigInt(b.balance), 0n),
    // ouvertes : ni en pause ni échues (on peut les chasser maintenant), et le compte par niveau
    bountiesOpen: bounties.filter((b) => !b.paused && BigInt(b.deadline) >= now).length,
    bountiesByLevel: { open: bounties.filter((b) => b.level === "open").length, verified: bounties.filter((b) => b.level === "verified").length },
    bountiesPaid: ev.filter((e) => e.name === "BountyPaid").length, bountyPaidUsdc: sumOf(ev, "BountyPaid", "amount"),
    // réclamations réfutées (rien de payé pour elles) et cautions saisies (OperatorBond.Slashed, second index)
    claimsRefuted: countOf(ev, "ClaimRefuted"), bondSlashedUsdc: sumOf(ev, "Slashed", "amount"), bondPostedUsdc: sumOf(ev, "Bonded", "amount"),
    head: await pub.getBlockNumber(),
    index: idx.status(),
  };
}))));

app.get("/activity", async (c) => {
  const raw = Number(c.req.query("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(Math.floor(raw), 100)) : 25;
  // 19/11 : les écritures de la caution (réserve, libération, exposition) seulement sur demande (?minor=1)
  const minor = c.req.query("minor") === "1";
  const ev = await events();
  // 19/11 : un événement de prime qui ne porte que le numéro (réclamation, paiement, réfutation…) reçoit le produit de
  // sa prime (args.productId, lu dans le BountyCreated du MÊME contrat) : les numéros existent aux deux niveaux, le
  // numéro seul rattacherait la prime n° 2 du produit 7 à la prime n° 2 du produit 5
  const pid = bountyProducts(ev);
  const out: Array<Ev & { label: string }> = [];
  for (const e of ev) {
    if (!minor && MINOR_EVENTS.has(e.name)) continue;
    const p = e.args.bountyId !== undefined && e.args.productId === undefined ? pid.get(`${e.contract}:${String(e.args.bountyId)}`) : undefined;
    const x = p !== undefined ? { ...e, args: { ...e.args, productId: p } } : e;
    out.push({ ...x, label: eventLabel(x) });
    if (out.length >= limit) break;
  }
  // chaque événement garde sa forme (contract, name, args, block, logIndex, tx) ; `label` : son libellé lisible (anglais)
  return c.json(J(out));
});

// Signataire du reçu payé par une transaction settle(r, signature) : lu dans ses données d'appel (immuable, mis en cache).
const settleSigner = new Map<string, string | null>();
async function signerOfSettle(tx: string): Promise<string | null> {
  if (settleSigner.has(tx)) return settleSigner.get(tx)!;
  let who: string | null = null;
  try {
    const t = await arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: sessionPayAbi, data: t.input });
    if (d.functionName === "settle") {
      const [r, sig] = d.args as unknown as [any, Hex];
      who = (await recoverReceiptSigner(testnet.sessionPay, r, sig, testnet.chainId)).toLowerCase();
    }
  } catch { return null; } // lecture ratée : on réessaiera au prochain rafraîchissement
  settleSigner.set(tx, who);
  return who;
}

/** 19/11 : l'enclave qui a signé le reçu d'un appel payé x402 : X402Settler.settle(cr, enclaveSig, auth), lu dans les
 *  données d'appel de la transaction (immuable, mis en cache) ; null si l'appel est passé par un autre contrat. */
const callSigner = new Map<string, string | null>();
async function signerOfCall(tx: string): Promise<string | null> {
  if (callSigner.has(tx)) return callSigner.get(tx)!;
  let who: string | null = null;
  try {
    const t = await arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: x402Abi, data: t.input });
    if (d.functionName === "settle") {
      const [cr, sig] = d.args as unknown as [any, Hex];
      who = (await recoverCallReceiptSigner(testnet.x402Settler, cr, sig, testnet.chainId)).toLowerCase();
    }
  } catch { return null; }
  callSigner.set(tx, who);
  return who;
}

/** 19/11 : les enclaves qui ont signé une réclamation de prime acceptée : acceptClaim(claim, signatures) ou
 *  claim(claim, signatures, cP), lus dans les données d'appel de la transaction (immuable, mis en cache). */
const claimSigners = new Map<string, string[]>();
async function signersOfClaim(tx: string, contract: Address): Promise<string[] | null> {
  const key = `${contract.toLowerCase()}:${tx}`;
  if (claimSigners.has(key)) return claimSigners.get(key)!;
  const who: string[] = [];
  try {
    const t = await arc.pub.getTransaction({ hash: tx as Hex });
    const d = decodeFunctionData({ abi: sealedBountyAbi, data: t.input });
    if (d.functionName === "acceptClaim" || d.functionName === "claim") {
      const [claim, sigs] = d.args as unknown as [any, Hex[]];
      const c = normalizeClaim(claim);
      for (const s of sigs) who.push((await recoverClaimSigner(contract, c, s, testnet.chainId)).toLowerCase());
    }
  } catch { return null; }
  claimSigners.set(key, who);
  return who;
}

/** Le rail de règlement d'un produit : session prépayée, appel payé x402, prime scellée (deux niveaux), gratuit (aucun
 *  contrat de règlement : le copilote attesté) ou autre. */
type Rail = "session" | "x402" | "bounty" | "free" | "other";
function railOf(settlement: string): { rail: Rail; bounty?: BountyRail } {
  const s = settlement.toLowerCase();
  if (s === testnet.sessionPay.toLowerCase()) return { rail: "session" };
  if (s === testnet.x402Settler.toLowerCase()) return { rail: "x402" };
  const b = BOUNTY_RAILS.find((r) => r.address.toLowerCase() === s);
  if (b) return { rail: "bounty", bounty: b };
  if (SUPERSEDED_BOUNTIES.has(s)) return { rail: "bounty" };
  if (/^0x0{40}$/.test(s)) return { rail: "free" };
  return { rail: "other" };
}

// La chaîne de preuves ne montre QUE des faits de l'enclave affichée : son inscription, un règlement payé sur un reçu
// qu'elle a signé (signataire retrouvé dans l'appel settle), et le verdict écrit à la clôture d'une de ses sessions.
// Jamais un fait emprunté à une autre enclave (ex. la machine de démo de la prime).
// v2.1 : quand aucun verdict n'est écrit, la chaîne dit pourquoi pour la session montrée (proofVerdict, events.ts) :
// sautée (VerdictSkipped, avec la raison), sans objet (session close sans paiement : VerdictNotApplicable) ou en attente.

/** L'enclave verrouillée d'une session (immuable dès l'ouverture) : lue une fois on-chain, gardée. */
const sessionEnclave = new Map<string, string>();
/** Les sessions de ce produit closes SANS paiement (VerdictNotApplicable) et verrouillées sur cette enclave : aucun
 *  règlement ne les relie à elle, leur enclave se lit donc on-chain (les 20 plus récentes, lectures groupées). */
async function unpaidSessionsOf(signer: string, productId: string, ev: Ev[], outcomes: Map<string, SessionVerdict>): Promise<Set<string>> {
  const ofProduct = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === productId).map((e) => String(e.args.sessionId)));
  const ids = [...outcomes.values()]
    .filter((v) => v.outcome === "not_applicable" && ofProduct.has(v.sessionId))
    .sort((a, b) => (b.block ?? 0) - (a.block ?? 0)).slice(0, 20).map((v) => v.sessionId);
  const out = new Set<string>();
  await Promise.all(ids.map(async (id) => {
    let enc = sessionEnclave.get(id);
    if (enc === undefined) {
      try { enc = String((await arc.getSession(BigInt(id))).enclave).toLowerCase(); } catch { return; } // relue au prochain passage
      sessionEnclave.set(id, enc);
    }
    if (enc === signer) out.add(id);
  }));
  return out;
}
// L'image affichée au maillon 1 est celle que l'AUTEUR du produit a épinglée : son manifeste public, dont le hash est
// inscrit dans ProductRegistry. On ne l'affiche comme épinglée que si keccak256(manifeste) = manifestHash on-chain.
const manifests = new Map<string, { t: number; v: { image: string; manifestURI: string; manifestVerified: boolean } }>();
/** 19/11 (r2) : l'image qu'un manifeste épingle : son champ `image`, sinon l'image unique de ses `composes` (le manifeste
 *  de la démo de réfutation, produit 5, décrit trois VM sur la même image) ; aucune (vide) s'il n'en nomme pas une seule.
 *  Jamais l'image par défaut ci-dessus : la chaîne du produit 5 montrait l'image de l'IA privée comme « épinglée ». */
function imageOfManifest(m: any): string {
  const ok = (x: unknown): x is string => typeof x === "string" && x.startsWith("ghcr.io/");
  if (ok(m?.image)) return m.image;
  const all = [...new Set((Array.isArray(m?.composes) ? m.composes : []).map((c: any) => c?.image).filter(ok))];
  return all.length === 1 ? String(all[0]) : "";
}
async function pinnedImage(productId: bigint) {
  const p = await arc.getProduct(productId) as any;
  const key = `${productId}:${p.manifestHash}`;
  const hit = manifests.get(key);
  if (hit && Date.now() - hit.t < 600_000) return hit.v;
  let v = { image: IMAGE, manifestURI: String(p.manifestURI ?? ""), manifestVerified: false };
  try {
    const res = await fetch(p.manifestURI, { signal: AbortSignal.timeout(5_000) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok && keccak256(bytes).toLowerCase() === String(p.manifestHash).toLowerCase()) {
      // vérifié = le manifeste est celui inscrit sur Arc ET il épingle une image (sinon, le maillon 1 se rabat sur
      // l'empreinte rejouée à l'inscription et sur nos déploiements)
      const img = imageOfManifest(JSON.parse(new TextDecoder().decode(bytes)));
      v = { image: img || IMAGE, manifestURI: p.manifestURI, manifestVerified: !!img };
    }
  } catch { /* manifeste injoignable : image par défaut, non marquée vérifiée */ }
  manifests.set(key, { t: Date.now(), v });
  return v;
}

/** La chaîne de preuves d'UNE enclave. Sans paramètre : l'enclave d'inférence (celle en service, sinon celle qui a servi
 *  la dernière session payée), comme avant. 19/11 : `signer` (une clé d'enclave inscrite) ou `product` (l'enclave active
 *  de ce produit, sinon sa dernière inscrite). Les maillons 5 et 6 suivent le RAIL du produit : session (Settled payé sur
 *  un reçu signé par l'enclave, puis le verdict de fermeture), appel payé x402 (CallSettled dont le reçu d'appel est signé
 *  par l'enclave ; un appel n'écrit pas de verdict ERC-8004), prime (BountyPaid d'une réclamation signée par l'enclave, et
 *  le verdict écrit avec), gratuit (le copilote attesté : rien à régler, pas de verdict). */
async function computeProof(o: { signer?: string; product?: string } = {}) {
  const ev = await events();
  const encs = await cached("enclaves", 15_000, listEnclaves) as any[];
  // jamais une machine de démo (empreinte « démo », mesures déclarées au module de test)
  const DEMO_WORKLOAD = "0x595b5067f7b9e6b4153462ea198226ec97dfbc2f5a8200b0c4ce763c983f54e4";
  const real = encs.filter((e) => String(e.workloadId).toLowerCase() !== DEMO_WORKLOAD);
  const inference = String(testnet.products?.inference ?? 1n);
  let act = o.signer !== undefined ? encs.find((e) => lc(e.signer) === lc(o.signer)) ?? null
    : o.product !== undefined ? (() => {
      const mine = real.filter((e) => String(e.productId) === o.product);
      return mine.find((e) => e.active) ?? [...mine].sort((a, b) => Number(b.registeredAt) - Number(a.registeredAt))[0] ?? null;
    })()
    : real.find((e) => e.active && String(e.productId) === inference) ?? real.find((e) => e.active) ?? null;
  if (!act && o.signer === undefined && o.product === undefined) {
    // 16/11 : sans enclave active (VM en pause), l'enclave d'INFÉRENCE qui a servi la dernière session payée (chaîne
    // complète : règlement et verdict), sinon la dernière enclave d'inférence ; jamais la première venue (souvent le
    // copilote, sans règlement ni verdict : 3 maillons vides)
    const infSessions = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === inference).map((e) => String(e.args.sessionId)));
    const served = new Set<string>();
    for (const e of ev) {
      if (e.name !== "Settled" || !infSessions.has(String(e.args.sessionId))) continue;
      const who = await signerOfSettle(e.tx);
      if (who) served.add(who.toLowerCase());
    }
    act = real.find((e) => String(e.productId) === inference && served.has(String(e.signer).toLowerCase()))
      ?? real.find((e) => String(e.productId) === inference) ?? real[0] ?? null;
  }
  const signer = act ? String(act.signer).toLowerCase() : "";
  const reg = act ? ev.find((e) => e.name === "EnclaveRegistered" && String(e.args.signer).toLowerCase() === signer) : undefined;
  const plist = await cached("products", 30_000, listProducts) as any[];
  const prod = act ? plist[Number(act.productId) - 1] : undefined;
  const { rail, bounty } = prod ? railOf(String(prod.settlement)) : { rail: null, bounty: undefined };
  let settle: Ev | undefined;
  let settleUsdc: unknown = null;
  let settleBounty: string | null = null;
  // prime : le verdict écrit (ou sauté) dans la transaction de la réclamation ou du paiement
  let paidVerdict: Partial<SessionVerdict> & { outcome: "written" | "skipped" | "none"; tx: string | null } | null = null;
  const servedSessions = new Set<string>();
  if (act && reg && rail === "session") {
    const ofProduct = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === String(act.productId)).map((e) => String(e.args.sessionId)));
    for (const e of ev) { // du plus récent au plus ancien
      // pas de filtre par bloc : une réinscription (même clé) ne doit pas effacer ses règlements ; la preuve, c'est le signataire
      if (e.name !== "Settled" || !ofProduct.has(String(e.args.sessionId))) continue;
      if ((await signerOfSettle(e.tx)) !== signer) continue;
      servedSessions.add(String(e.args.sessionId));
      settle ??= e;
    }
    settleUsdc = settle?.args.paidDelta ?? null;
  } else if (act && reg && rail === "x402") {
    for (const e of ev) {
      if (e.name !== "CallSettled" || String(e.args.productId) !== String(act.productId) || lc(e.args.operator) !== lc(act.operator)) continue;
      if ((await signerOfCall(e.tx)) !== signer) continue;
      settle = e;
      break;
    }
    settleUsdc = settle?.args.amount ?? null;
  } else if (act && reg && rail === "bounty" && bounty) {
    for (const p of ev) {
      if (p.contract !== bounty.contract || p.name !== "BountyPaid") continue;
      const id = String(p.args.bountyId);
      // la réclamation payée : la dernière acceptée pour cette prime au plus tard dans le bloc du paiement
      const claim = ev.find((e) => e.contract === bounty.contract && e.name === "ClaimAccepted" && String(e.args.bountyId) === id && e.block <= p.block);
      if (!claim || !(await signersOfClaim(claim.tx, bounty.address))?.includes(signer)) continue;
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
  // l'issue du verdict de fermeture de chaque session, et celle que montre la chaîne (écrit, sinon pourquoi pas)
  const outcomes = sessionVerdicts(ev);
  const unpaid = act && rail === "session" ? await unpaidSessionsOf(signer, String(act.productId), ev, outcomes) : new Set<string>();
  const shown = !act ? null
    : rail === "session" ? proofVerdict(outcomes, servedSessions, unpaid, settle ? String(settle.args.sessionId) : null)
    : rail === "bounty" ? (paidVerdict as SessionVerdict | null)
    // un appel payé x402 et un produit gratuit n'écrivent pas de verdict ERC-8004 (seules les sessions et les primes en écrivent)
    : ({ sessionId: "", outcome: "no_verdict_rail", tx: null, block: null } as unknown as SessionVerdict);
  const verdict = shown?.outcome === "written" ? shown : null; // le verdict ÉCRIT le plus récent d'une session servie
  // v2.1 : l'empreinte d'IMAGE de l'enclave (journal RTMR3 rejoué on-chain à l'inscription), si elle a été émise
  const image = act ? ev.find((e) => e.name === "EnclaveImage" && String(e.args.signer).toLowerCase() === signer) : undefined;
  const pin = act ? await pinnedImage(BigInt(act.productId)) : { image: IMAGE, manifestURI: "", manifestVerified: false };
  // 17/11 : sans manifeste vérifié, l'image que CETTE enclave a fait tourner (son empreinte, lue sur Arc, est dans nos
  // déploiements) ; inconnue : vide, jamais l'image par défaut
  const ran = act ? IMAGE_OF.get(String(image?.args.imageId ?? act.workloadId).toLowerCase()) : undefined;
  const imageRef = pin.manifestVerified ? pin.image : (ran ?? "");
  const imageSource = pin.manifestVerified ? "manifest" : ran ? "deployments" : "unknown";
  return {
    image: imageRef, imageSource, manifestURI: pin.manifestURI, manifestVerified: pin.manifestVerified, enclave: act ?? null, registerTx: reg?.tx ?? null,
    // 19/11 : le rail du produit de l'enclave (session | x402 | bounty | free | other) ; le règlement montré au maillon 5
    // est une session (`settleSession`), un appel payé (CallSettled) ou une prime (`settleBounty`, de niveau `settleLevel`)
    rail, settleTx: settle?.tx ?? null, settleUsdc, settleSession: rail === "session" ? settle?.args.sessionId ?? null : null,
    settleBounty, settleLevel: settleBounty !== null ? bounty?.level ?? null : null,
    verdictTx: verdict?.tx ?? null, verdictAgentId: verdict?.agentId ?? null, verdictResponse: verdict?.response ?? null,
    // champs ajoutés (9/11) : la session dont parle le maillon « verdict » et l'issue de son verdict
    // ("written" | "not_applicable" : close sans paiement | "skipped" : écriture refusée, `verdictReason` | "none" | "pending"
    // | 19/11 "no_verdict_rail" : appel payé x402 ou produit gratuit, qui n'écrivent pas de verdict)
    verdictSession: shown?.sessionId || null, verdictStatus: shown?.outcome ?? null, verdictStatusTx: shown?.tx ?? null,
    verdictReason: shown?.reason ?? null, verdictReasonData: shown?.reasonData ?? null, verdictSalted: shown?.salted ?? null,
    enclaveImage: image ? {
      imageId: String(image.args.imageId), composeHash: String(image.args.composeHash), osImageHash: String(image.args.osImageHash), tx: image.tx,
    } : null,
    index: idx.status(),
  };
}
/** /proof : la chaîne de l'enclave d'inférence ; ?signer=0x… : celle d'une clé d'enclave inscrite ; ?product=N : celle de
 *  l'enclave active du produit N (sinon sa dernière inscrite). Une clé ou un produit sans enclave : 404 (jamais la chaîne
 *  d'une autre enclave). */
app.get("/proof", async (c) => {
  const bad = unknownParam(c, ["signer", "product"]);
  if (bad) return c.json(bad, 400);
  const signer = c.req.query("signer"), product = c.req.query("product");
  if (signer !== undefined && product !== undefined) return c.json(errorBody("invalid_param", "signer or product, not both", { param: "product" }), 400);
  if (signer !== undefined && !ADDR_RE.test(signer)) return c.json(badParam("signer", "an enclave key (0x + 40 hexadecimal characters)"), 400);
  if (product !== undefined && !ID_RE.test(product)) return c.json(badParam("product", "a product number"), 400);
  if (signer !== undefined || product !== undefined) {
    const encs = await cached("enclaves", 15_000, listEnclaves) as any[];
    if (signer !== undefined && !encs.some((e) => lc(e.signer) === lc(signer))) {
      return c.json(errorBody("unknown_enclave", `no enclave key ${signer} is registered`, { signer }), 404);
    }
    if (product !== undefined && !encs.some((e) => String(e.productId) === product)) {
      return c.json(errorBody("unknown_product", `no enclave was ever registered for product #${product}`, { id: product }), 404);
    }
  }
  const key = signer !== undefined ? `proof:s:${lc(signer)}` : product !== undefined ? `proof:p:${product}` : "proof";
  return c.json(J(await cached(key, 15_000, () => computeProof({ signer, product }))));
});

/** v2 : un reçu est vérifié EXACTEMENT comme SessionPay.settle le fera (enclave verrouillée de la session, active au bloc
 *  d'ancrage chez l'opérateur de la session, modèle verrouillé, cumul croissant) ; `active` garde l'ancien sens. */
app.post("/verify-receipt", async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  if (!body?.receipt || !body?.signature) return c.json(errorBody("receipt_expected", "expected { receipt, signature }"), 400);
  let r;
  try { r = normalizeReceipt(body.receipt); } catch { return c.json(errorBody("receipt_unreadable", "unreadable receipt"), 400); }
  let signer: Address;
  try { signer = await recoverReceiptSigner(testnet.sessionPay, r, body.signature as Hex, testnet.chainId); } catch { return c.json(errorBody("signature_unreadable", "unreadable signature"), 400); }
  void signer; // signature lisible : la vérification complète suit
  const v = await arc.verifyReceipt(r, body.signature as Hex);
  return c.json(J({
    signer: v.signer, operator: v.activeOperatorAtAnchor, active: v.checks.find((x) => x.id === "active")?.ok ?? false,
    settleable: v.settleable, payableNow: v.payableNow, checks: v.checks,
  }));
});

// arrivée des machines d'opérateurs : appairage par code, clés arcop_, battements de cœur, diagnostic
registerOperatorRoutes(app, arc);
// mode test (testnet) : wallet serveur provisionné, désactivé sans TEST_SIGNER_PK + TEST_SIGNER_TOKEN
registerTestSigner(app);

// toute erreur non prévue sort en JSON lisible (jamais une page HTML vide), avec son code stable
app.onError((err, c) => c.json(errorBody("server_error", String(err?.message ?? err)), 503));
// 19/11 : une route inconnue aussi (jamais le « 404 Not Found » en texte brut)
app.notFound((c) => c.json(errorBody("not_found", `unknown route: ${c.req.method} ${c.req.path}`), 404));

serve({ fetch: app.fetch, port: PORT });
console.log(`API ArcHive sur http://localhost:${PORT}  (products, enclaves, bounties, sessions/:owner, pricing, verify-receipt)`);
// l'index reste à jour même sans visiteur (sinon la première visite après une longue pause attend le rattrapage)
setInterval(() => {
  idx.sync(30_000).catch((e) => console.warn("index :", (e as Error).message.slice(0, 160)));
  idxLevels?.sync(30_000).catch((e) => console.warn("index (niveaux) :", (e as Error).message.slice(0, 160)));
}, 60_000).unref();
// préchauffage : la première visite ne paie pas la lecture à froid des événements (le second index lit en arrière-plan)
idxLevels?.sync(0).catch((e) => console.warn("index (niveaux) :", (e as Error).message))
  .then(() => idxLevels && console.log(`index des niveaux : ${idxLevels.status().events} événements jusqu'au bloc ${idxLevels.status().lastBlock}`));
idx.sync(0).catch((e) => console.warn("index :", (e as Error).message))
  .then(() => cached("proof", 15_000, computeProof))
  .then(() => console.log(`cache préchauffé : ${idx.status().events} événements indexés jusqu'au bloc ${idx.status().lastBlock}`))
  .catch((e) => console.warn("préchauffage :", (e as Error).message));
