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
  PROOF_OF_CLOUD, describeLevel, readPolicy,
} from "@arcvault/sdk";
import { EventIndexer, type Ev } from "./indexer";
import { EVENTS, eventLabel, indexStartBlock, proofVerdict, sessionVerdicts, type SessionVerdict } from "./events";
import { errorBody, registerOperatorRoutes } from "./operators";
import { registerTestSigner } from "./testSigner";

const PORT = Number(process.env.PORT ?? "8809");
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const; // présent sur Arc testnet (vérifié le 7/11)
const pub = createPublicClient({
  chain: { ...arcTestnet, contracts: { multicall3: { address: MULTICALL3 } } },
  batch: { multicall: { wait: 16 } }, // les lectures lancées ensemble partent en UN eth_call
  transport: http(process.env.RPC_URL, { retryCount: 6, retryDelay: 700 }), // le RPC public refuse les rafales (429)
});
const arc = createArcClient({ publicClient: pub as any });

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
async function listEnclaves(): Promise<EnclaveView[]> {
  const ev = await events();
  const signers: Address[] = [];
  const seen = new Set<string>();
  for (const e of ev) {
    if (e.name !== "EnclaveRegistered") continue;
    const s = String(e.args.signer).toLowerCase();
    if (!seen.has(s)) { seen.add(s); signers.push(e.args.signer as Address); }
  }
  return (await Promise.all(signers.map((s) => arc.enclaveView(s)))).filter((x): x is EnclaveView => x !== null);
}

async function listBounties(): Promise<BountyRow[]> {
  const ids = [...new Set((await events()).filter((e) => e.name === "BountyCreated").map((e) => String(e.args.bountyId)))].map((x) => BigInt(x));
  return Promise.all(ids.map((id) => arc.getBounty(id)));
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
app.get("/products/:id", async (c) => c.json(J(await arc.getProduct(BigInt(c.req.param("id"))))));
app.get("/enclaves", async (c) => c.json(J(await cached("enclaves", 15_000, listEnclaves))));
app.get("/bounties", async (c) => c.json(J(await cached("bounties", 20_000, listBounties))));
app.get("/sessions/:owner", async (c) => {
  const owner = c.req.param("owner");
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return c.json(errorBody("invalid_address", "adresse attendue (0x + 40 caractères hexadécimaux)"), 400);
  return c.json(J(await cached(`sessions:${owner.toLowerCase()}`, 10_000, () => listSessionsOf(owner))));
});

app.get("/pricing", async (c) => {
  const id = BigInt(c.req.query("productId") ?? "0");
  const units = BigInt(c.req.query("units") ?? "1");
  const p = await arc.getProduct(id);
  return c.json({
    productId: id.toString(), pricePerUnit: formatUnits(p.price, 6) + " USDC", units: units.toString(), total: formatUnits(p.price * units, 6) + " USDC",
    // v2 : unités = ceil((jetons d'entrée + outWeight × jetons de sortie) / unitTokens), verrouillées à l'ouverture de session
    unitTokens: p.unitTokens, outWeight: p.outWeight,
  });
});

// ---------- console : compteurs, activité, chaîne de preuves (notre index d'événements) ----------

// image de l'enclave d'inférence v2 déployée chez Phala (épinglée par digest : enclave/phala/sealed-chat-v2.yml)
const IMAGE = process.env.INFERENCE_IMAGE ?? "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:eceb67a5bf985a9672d51db288ef85c9e2cb7908835057ea24888517793173fa";

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
/** Les événements à jour (synchronisés il y a moins de 10 s) ; si le RPC refuse, ceux déjà indexés. */
async function events(): Promise<Ev[]> {
  try { await idx.sync(10_000); } catch (e) { console.warn("index :", (e as Error).message.slice(0, 160)); }
  return idx.events();
}
app.get("/index", (c) => c.json(idx.status()));

const sumOf = (ev: Ev[], name: string, field: string) => ev.filter((e) => e.name === name).reduce((s, e) => s + BigInt(e.args[field] as any), 0n);
const countOf = (ev: Ev[], name: string) => ev.filter((e) => e.name === name).length;

app.get("/stats", async (c) => c.json(J(await cached("stats", 15_000, async () => {
  const ev = await events();
  const encs = await cached("enclaves", 15_000, listEnclaves) as any[];
  const bounties = await cached("bounties", 20_000, listBounties) as any[];
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
    bountiesPaid: ev.filter((e) => e.name === "BountyPaid").length, bountyPaidUsdc: sumOf(ev, "BountyPaid", "amount"),
    head: await pub.getBlockNumber(),
    index: idx.status(),
  };
}))));

app.get("/activity", async (c) => {
  const raw = Number(c.req.query("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(Math.floor(raw), 100)) : 25;
  // chaque événement garde sa forme (contract, name, args, block, logIndex, tx) ; `label` : son libellé lisible (anglais)
  return c.json(J((await events()).slice(0, limit).map((e) => ({ ...e, label: eventLabel(e) }))));
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
      v = { image: String(JSON.parse(new TextDecoder().decode(bytes)).image ?? IMAGE), manifestURI: p.manifestURI, manifestVerified: true };
    }
  } catch { /* manifeste injoignable : image par défaut, non marquée vérifiée */ }
  manifests.set(key, { t: Date.now(), v });
  return v;
}

async function computeProof() {
  const ev = await events();
  const encs = await cached("enclaves", 15_000, listEnclaves) as any[];
  // jamais une machine de démo (empreinte « démo », mesures déclarées au module de test)
  const DEMO_WORKLOAD = "0x595b5067f7b9e6b4153462ea198226ec97dfbc2f5a8200b0c4ce763c983f54e4";
  const real = encs.filter((e) => String(e.workloadId).toLowerCase() !== DEMO_WORKLOAD);
  const inference = String(testnet.products?.inference ?? 1n);
  const act = real.find((e) => e.active && String(e.productId) === inference) ?? real.find((e) => e.active) ?? real[0] ?? null;
  const signer = act ? String(act.signer).toLowerCase() : "";
  const reg = act ? ev.find((e) => e.name === "EnclaveRegistered" && String(e.args.signer).toLowerCase() === signer) : undefined;
  let settle: Ev | undefined;
  const servedSessions = new Set<string>();
  if (act && reg) {
    const ofProduct = new Set(ev.filter((e) => e.name === "SessionOpened" && String(e.args.productId) === String(act.productId)).map((e) => String(e.args.sessionId)));
    for (const e of ev) { // du plus récent au plus ancien
      // pas de filtre par bloc : une réinscription (même clé) ne doit pas effacer ses règlements ; la preuve, c'est le signataire
      if (e.name !== "Settled" || !ofProduct.has(String(e.args.sessionId))) continue;
      if ((await signerOfSettle(e.tx)) !== signer) continue;
      servedSessions.add(String(e.args.sessionId));
      settle ??= e;
    }
  }
  // l'issue du verdict de fermeture de chaque session, et celle que montre la chaîne (écrit, sinon pourquoi pas)
  const outcomes = sessionVerdicts(ev);
  const unpaid = act ? await unpaidSessionsOf(signer, String(act.productId), ev, outcomes) : new Set<string>();
  const shown = act ? proofVerdict(outcomes, servedSessions, unpaid, settle ? String(settle.args.sessionId) : null) : null;
  const verdict = shown?.outcome === "written" ? shown : null; // le verdict ÉCRIT le plus récent d'une session servie
  // v2.1 : l'empreinte d'IMAGE de l'enclave (journal RTMR3 rejoué on-chain à l'inscription), si elle a été émise
  const image = act ? ev.find((e) => e.name === "EnclaveImage" && String(e.args.signer).toLowerCase() === signer) : undefined;
  const pin = act ? await pinnedImage(BigInt(act.productId)) : { image: IMAGE, manifestURI: "", manifestVerified: false };
  return {
    image: pin.image, manifestURI: pin.manifestURI, manifestVerified: pin.manifestVerified, enclave: act ?? null, registerTx: reg?.tx ?? null,
    settleTx: settle?.tx ?? null, settleUsdc: settle?.args.paidDelta ?? null, settleSession: settle?.args.sessionId ?? null,
    verdictTx: verdict?.tx ?? null, verdictAgentId: verdict?.agentId ?? null, verdictResponse: verdict?.response ?? null,
    // champs ajoutés (9/11) : la session dont parle le maillon « verdict » et l'issue de son verdict
    // ("written" | "not_applicable" : close sans paiement | "skipped" : écriture refusée, `verdictReason` | "none" | "pending")
    verdictSession: shown?.sessionId ?? null, verdictStatus: shown?.outcome ?? null, verdictStatusTx: shown?.tx ?? null,
    verdictReason: shown?.reason ?? null, verdictReasonData: shown?.reasonData ?? null, verdictSalted: shown?.salted ?? null,
    enclaveImage: image ? {
      imageId: String(image.args.imageId), composeHash: String(image.args.composeHash), osImageHash: String(image.args.osImageHash), tx: image.tx,
    } : null,
    index: idx.status(),
  };
}
app.get("/proof", async (c) => c.json(J(await cached("proof", 15_000, computeProof))));

/** v2 : un reçu est vérifié EXACTEMENT comme SessionPay.settle le fera (enclave verrouillée de la session, active au bloc
 *  d'ancrage chez l'opérateur de la session, modèle verrouillé, cumul croissant) ; `active` garde l'ancien sens. */
app.post("/verify-receipt", async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  if (!body?.receipt || !body?.signature) return c.json(errorBody("receipt_expected", "attendu { receipt, signature }"), 400);
  let r;
  try { r = normalizeReceipt(body.receipt); } catch { return c.json(errorBody("receipt_unreadable", "reçu illisible"), 400); }
  let signer: Address;
  try { signer = await recoverReceiptSigner(testnet.sessionPay, r, body.signature as Hex, testnet.chainId); } catch { return c.json(errorBody("signature_unreadable", "signature illisible"), 400); }
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

serve({ fetch: app.fetch, port: PORT });
console.log(`API ArcHive sur http://localhost:${PORT}  (products, enclaves, bounties, sessions/:owner, pricing, verify-receipt)`);
// l'index reste à jour même sans visiteur (sinon la première visite après une longue pause attend le rattrapage)
setInterval(() => { idx.sync(30_000).catch((e) => console.warn("index :", (e as Error).message.slice(0, 160))); }, 60_000).unref();
// préchauffage : la première visite ne paie pas la lecture à froid des événements
idx.sync(0).catch((e) => console.warn("index :", (e as Error).message))
  .then(() => cached("proof", 15_000, computeProof))
  .then(() => console.log(`cache préchauffé : ${idx.status().events} événements indexés jusqu'au bloc ${idx.status().lastBlock}`))
  .catch((e) => console.warn("préchauffage :", (e as Error).message));
