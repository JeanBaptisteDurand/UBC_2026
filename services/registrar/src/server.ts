/** server.ts — Registrar (pile v2 / v2.1) : garde UNE enclave inscrite, en renouvelant son inscription avant la fin de sa fenêtre
 *  de validité (comptée en BLOCS par le registre v2 : VALIDITY_BLOCKS ≈ 24 h).
 *  Boucle : lit le signataire actuel de l'enclave (il change à chaque redémarrage : clés en mémoire), puis l'état on-chain
 *  (activeOperatorAt au bloc de tête, fin de fenêtre) ; si besoin, SDK registerEnclave : /attest → contrôle du quote hors
 *  chaîne (quote réel, pas de DEBUG, SEPT_VE_DISABLE, image autorisée, liaison REPORTDATA) → registerEnclave, où la chaîne
 *  vérifie la signature d'Intel par DCAP. Renouvelée sans trou, la fenêtre est prolongée (les reçus émis restent réglables).
 *  Après un redémarrage de l'enclave, l'ancienne clé (servie avant par CETTE URL) est retirée : elle ne signera plus rien,
 *  et sa réserve de caution est libérée (sinon chaque redémarrage bloque la caution minimale d'une clé morte).
 *  Le registrar n'autorise JAMAIS d'image : c'est l'auteur du produit qui le fait. L'opérateur signe (ARC_PK).
 *
 *  v2.1 :
 *  - la pile se choisit par DEPLOYMENTS (chemin d'un fichier deployments.*.json, ex. deployments.v21.testnet.json) ; sans
 *    elle, la pile v2 du SDK. Aucune adresse de contrat n'est écrite ici.
 *  - le règlement suit le contrat de règlement du produit servi (lu on-chain) : SessionPay → sessions (dernier reçu de
 *    chaque session) ; X402Settler → paiement à l'appel : toutes les X402_CHECK_SECONDS (10 s par défaut depuis le 9/11 :
 *    les autorisations des payeurs ne valent plus que 15 min), les appels servis non réglés sont relevés (GET /x402/pending)
 *    et réglés (X402Settler.settle), SANS DOUBLE RÈGLEMENT ni doublon (UNE seule file, X402SettlementQueue du SDK : un
 *    passage à la fois — le suivant attend la fin du précédent —, chaque appel suivi une fois par (payeur, nonce),
 *    vérification on-chain avant chaque envoi, nonce EIP-3009 à usage unique), puis signalés à l'enclave par
 *    POST /x402/settled, SIGNÉ de la clé de l'opérateur (EIP-712 ; l'enclave refuse tout signataire hors de son
 *    OPERATOR_ALLOWLIST et revérifie on-chain), chaque clé une fois. Les appels relevés sont gardés ici jusqu'au
 *    règlement : un redémarrage de l'enclave ne les perd pas.
 *  - 9/11 au soir (preuves B, C, C2 et F du vérificateur) : toute la file est relevée, page par page (plus seulement les
 *    200 premiers) ; les appels que le solde de leur payeur couvre sont réglés d'abord, et au plus 25 « non couverts »
 *    sont revérifiés par passage (X402_UNCOVERED_CHECKS) ; chaque appel signalé dit s'il a été RÉGLÉ par X402Settler (reçu
 *    de NOTRE transaction, ou événement CallSettled) ou consommé autrement (annulé) : seul un règlement rend le payeur
 *    « connu » de l'enclave ; un signalement en échec est renvoyé au passage suivant.
 *  - 10/11 : NIVEAU VÉRIFIÉ (si le déploiement a la section levels ; LEVELS=0 pour l'arrêter) : après chaque inscription,
 *    l'enclave est LIÉE à sa machine (MachineRegistry.bindMachine, avec le quote de la transaction : PPID lu dans le
 *    certificat d'Intel) — un renouvellement change le quote, et une liaison périmée ramène l'enclave au niveau ouvert ; à
 *    chaque passage, une liaison absente ou périmée est refaite (quote retrouvé dans les événements) ; et quand la
 *    déclaration de l'alliance Proof of Cloud sur la machine expire dans moins de LEVELS_POC_RENEW_DAYS (3) jours, un jeton
 *    est redemandé à l'alliance, vérifié, puis soumis à ProofOfCloudAuditor (qui le revérifie on-chain). */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, testnet, deploymentFromJson, createArcClient, createX402SettlementQueue, enclaveRegistryAbi, explainArcError, arcErrorOf,
  sessionPayAbi, normalizeReceipt, verifyReceiptOnChain, type Deployment,
  machineRegistryAbi, proofOfCloudAuditorAbi, readMachine, quoteFromRegisterTx, findCurrentQuote,
} from "@arcvault/sdk";
// module Node seulement (non exporté par l'index du SDK, que le site importe) ; chemin relatif : build.sh fait de
// « @arcvault/sdk » un alias du FICHIER index.ts, un sous-chemin du paquet n'y survivrait pas
import { requestAllianceToken } from "../../../packages/sdk/src/proof-of-cloud";

const D: Deployment = process.env.DEPLOYMENTS ? deploymentFromJson(JSON.parse(readFileSync(process.env.DEPLOYMENTS, "utf8"))) : testnet;
const ENCLAVE = (process.env.ENCLAVE_URL ?? "").replace(/\/$/, "");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? String(D.products?.inference ?? 1n));
const INTERVAL_H = Number(process.env.INTERVAL_HOURS ?? "12");
const RETIRE_PREVIOUS = process.env.RETIRE_PREVIOUS !== "0";
const pk = process.env.ARC_PK as Hex;
if (!ENCLAVE || !pk) { console.error("ENCLAVE_URL et ARC_PK requis"); process.exit(1); }
if (D.attestation !== "dcap") { console.error("ce registrar ne sert que les piles vérifiées par DCAP (v2, v2.1)"); process.exit(1); }

const account = privateKeyToAccount(pk);
const chain = D.chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: D.chainId, name: `Arc (${D.chainId})` });
const pub = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 800 }) });
const rawWallet = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });
// Deux boucles (inscription et sessions toutes les 10 min, paiement à l'appel toutes les 10 s) envoient avec la MÊME clé :
// les envois passent l'un après l'autre, sinon deux transactions prendraient le même nonce de compte.
let txQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(send: () => Promise<T>): Promise<T> {
  const p = txQueue.then(send, send);
  txQueue = p.catch(() => {});
  return p;
}
const wallet = { ...rawWallet, writeContract: ((args: any) => oneAtATime(() => rawWallet.writeContract(args))) as typeof rawWallet.writeContract };
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account, deployment: D });

const CHECK_MIN = Number(process.env.CHECK_MINUTES ?? "10");
const RENEW_BEFORE_H = Number(process.env.RENEW_BEFORE_HOURS ?? String(Math.max(1, 24 - INTERVAL_H)));
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signataire servi en dernier par CETTE URL (pour retirer une clé morte après un redémarrage de l'enclave). */
let lastSigner: Address | undefined;

async function currentSigner(): Promise<Address> {
  // /pubkeys sans confiance : on ne chiffre rien vers cette clé, on ne fait que lire son état on-chain
  const r = await fetch(`${ENCLAVE}/pubkeys`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`/pubkeys : HTTP ${r.status}`);
  const j = (await r.json()) as { signer?: string };
  if (!j.signer || !/^0x[0-9a-fA-F]{40}$/.test(j.signer)) throw new Error("/pubkeys : signataire illisible");
  return j.signer as Address;
}

/** L'inscription est-elle à refaire ? Oui si le signataire ACTUEL n'est pas actif pour ce produit chez cet opérateur au
 *  bloc de tête, ou si sa fenêtre finit dans moins de RENEW_BEFORE_H (converti en blocs). */
async function needsReattest(signer: Address): Promise<string | null> {
  const head = await pub.getBlockNumber();
  const op = await arc.activeOperatorAt(signer, PRODUCT_ID, head);
  if (op.toLowerCase() !== account.address.toLowerCase()) {
    return op === "0x0000000000000000000000000000000000000000" ? `signataire ${signer} non actif pour le produit #${PRODUCT_ID}` : `signataire ${signer} actif pour un autre opérateur (${op})`;
  }
  const e = await arc.getEnclave(signer);
  const blockMs = (await pub.readContract({ address: D.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "BLOCK_TIME_MS" })) as bigint;
  const renewBefore = BigInt(Math.ceil((RENEW_BEFORE_H * 3_600_000) / Number(blockMs)));
  const left = BigInt(e.untilBlock) - head;
  if (left < renewBefore) return `fenêtre finissant dans ${left} blocs (≈ ${Math.round((Number(left) * Number(blockMs)) / 60_000)} min)`;
  return null;
}

async function reattest(signer: Address): Promise<{ signer: Address; tx: Hex }> {
  const r = await arc.registerEnclave(PRODUCT_ID, ENCLAVE);
  const rc = await pub.waitForTransactionReceipt({ hash: r.tx, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`registerEnclave annulée on-chain (${r.tx})`);
  const e = await arc.getEnclave(r.signer);
  console.log(`[${now()}] ré-attesté par DCAP : signer ${r.signer}, blocs ${e.fromBlock}→${e.untilBlock}, gas ${rc.gasUsed}, tx ${r.tx}`);
  if (r.signer.toLowerCase() !== signer.toLowerCase()) console.warn(`[${now()}] l'enclave a changé de clé pendant l'inscription (${signer} → ${r.signer})`);
  return { signer: r.signer as Address, tx: r.tx as Hex };
}

// ---------------------------------------------------------------- 10/11 : niveau vérifié (liaison à la machine, jeton)

const LEVELS = !!D.levels && process.env.LEVELS !== "0";
const POC_RENEW_S = Number(process.env.LEVELS_POC_RENEW_DAYS ?? "3") * 86_400;

async function sendTx(address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
  const { request } = await pub.simulateContract({ account, address, abi, functionName, args } as any);
  const hash = await wallet.writeContract(request as any);
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`${functionName} annulée on-chain (${hash})`);
  return hash;
}

/** Garde l'enclave au niveau vérifié : liaison à jour, puis déclaration de l'alliance renouvelée avant son expiration.
 *  `quote` : celui de l'inscription en cours s'il est connu (sinon retrouvé dans les événements). */
async function keepVerified(signer: Address, quote?: Hex) {
  if (!LEVELS) return;
  const L = D.levels!;
  let m = await readMachine(pub as any, D, signer);
  if (!m.current) {
    const e = await arc.getEnclave(signer);
    if (!e.active || String(e.operator).toLowerCase() !== account.address.toLowerCase()) return;
    const q = quote ?? (await findCurrentQuote(pub as any, D, signer));
    const tx = await sendTx(L.machineRegistry, machineRegistryAbi, "bindMachine", [signer, q]);
    m = await readMachine(pub as any, D, signer);
    console.log(`[${now()}] niveau vérifié : enclave ${signer} liée à sa machine ${m.ppid} (certificat d'Intel), tx ${tx}`);
    quote = q;
  }
  if (!m.ppid || process.env.LEVELS_PROOF_OF_CLOUD === "0") return;
  const [exp] = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "auditOf", args: [L.proofOfCloudAuditor, m.ppid] })) as readonly [bigint, boolean];
  if (Number(exp) - Date.now() / 1000 > POC_RENEW_S) return;
  const q = quote ?? (await findCurrentQuote(pub as any, D, signer));
  const t = await requestAllianceToken(q, { log: (s) => console.warn(`[${now()}] ${s}`) });
  if (`0x${t.machineId}` !== m.ppid.toLowerCase()) throw new Error(`jeton de l'alliance pour une autre machine (${t.machineId})`);
  const tx = await sendTx(L.proofOfCloudAuditor, proofOfCloudAuditorAbi, "submit", [t.header, t.payload, t.signature]);
  console.log(`[${now()}] niveau vérifié : machine ${m.ppid} déclarée par l'alliance Proof of Cloud (jeton du ${new Date(t.timestamp * 1000).toISOString()}), tx ${tx}`);
}

/** Retire la clé que cette URL servait avant un redémarrage, si elle est encore à nous et sur ce produit. */
async function retirePrevious(current: Address) {
  const prev = lastSigner;
  if (!RETIRE_PREVIOUS || !prev || prev.toLowerCase() === current.toLowerCase()) return;
  const e = await arc.getEnclave(prev);
  if (!e.active || String(e.operator).toLowerCase() !== account.address.toLowerCase() || BigInt(e.productId) !== PRODUCT_ID) return;
  const tx = await arc.retireEnclave(prev);
  await pub.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
  console.log(`[${now()}] ancienne clé ${prev} retirée (enclave redémarrée) : réserve de caution libérée, reçus déjà ancrés réglables pendant la grâce ; tx ${tx}`);
}

// ---------- quel règlement pour le produit servi ? (lu on-chain : Product.settlement)
type SettlementKind = "session" | "x402" | "other";
let kind: SettlementKind | undefined;
async function settlementKind(): Promise<SettlementKind> {
  if (kind) return kind;
  const p = await arc.getProduct(PRODUCT_ID);
  const s = p.settlement.toLowerCase();
  kind = s === D.sessionPay.toLowerCase() ? "session" : s === D.x402Settler.toLowerCase() ? "x402" : "other";
  return kind;
}

// ---------- règlement automatique : l'opérateur est payé sans dépendre du client ----------
// Les reçus signés partent chez le client ; l'enclave v2 garde le dernier de chaque session (GET /v1/session/:id/receipt).
// Le registrar, qui tient déjà la clé de l'opérateur, règle lui-même : quand la somme due couvre largement le gas
// (SETTLE_MIN), ou quand la session approche de sa fin (dernier règlement possible jusqu'à l'échéance + la grâce).
const SETTLE = process.env.SETTLE !== "0";
const SETTLE_MIN = BigInt(process.env.SETTLE_MIN_MICRO_USDC ?? "20000"); // 0,02 USDC ; un règlement coûte ≈ 0,005 USDC de gas
const SETTLE_BEFORE_END_S = BigInt(process.env.SETTLE_BEFORE_END_S ?? "1800");
const opened = parseAbiItem("event SessionOpened(uint256 indexed sessionId, address indexed owner, uint256 indexed productId, uint256 deposit)");
const sessionIds = new Set<bigint>();
// 19/11 : le relevé partait du bloc de déploiement (≈ 1,46 M blocs, ≈ 300 getLogs d'affilée) : le RPC public d'Arc limitait
// le débit (HTTP 429) avant la fin, à chaque passage, et AUCUNE session n'était réglée. Une session ne paie que les reçus de
// l'enclave liée à son ouverture, alors active : rien de ce que l'enclave servie ici peut régler n'a été ouvert avant le début
// de sa fenêtre (fromBlock, gardé par les renouvellements sans trou). Le relevé part donc de là (SESSION_SCAN_FROM_BLOCK force
// un autre départ ; jamais avant le déploiement), sans rafale (SESSION_SCAN_PAUSE_MS entre deux pages) ; la progression reste.
let scannedTo: bigint | undefined;
const SCAN_PAUSE_MS = Number(process.env.SESSION_SCAN_PAUSE_MS ?? "300");

async function scanStart(signer: Address): Promise<bigint> {
  const forced = process.env.SESSION_SCAN_FROM_BLOCK;
  const from = forced ? BigInt(forced) : BigInt((await arc.getEnclave(signer))?.fromBlock ?? 0);
  return from > D.deployBlock ? from : D.deployBlock;
}

async function scanSessions(signer: Address) {
  let at: bigint;
  if (scannedTo === undefined) {
    const start = await scanStart(signer);
    console.log(`[${now()}] sessions : relevé des ouvertures depuis le bloc ${start}`);
    at = start - 1n;
  } else at = scannedTo;
  const head = await pub.getBlockNumber();
  while (at < head) {
    const from = at + 1n, to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await pub.getLogs({ address: D.sessionPay, event: opened, args: { productId: PRODUCT_ID }, fromBlock: from, toBlock: to });
    for (const l of logs) sessionIds.add(l.args.sessionId!);
    at = to;
    scannedTo = at;
    if (at < head && SCAN_PAUSE_MS > 0) await sleep(SCAN_PAUSE_MS);
  }
  scannedTo = at;
}

async function settleSessions(signer: Address) {
  await scanSessions(signer);
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  for (const id of [...sessionIds]) {
    const s = await arc.getSession(id) as any;
    if (s.closed) { sessionIds.delete(id); continue; }
    if (String(s.operator).toLowerCase() !== account.address.toLowerCase()) { sessionIds.delete(id); continue; }
    const res = await fetch(`${ENCLAVE}/v1/session/${id}/receipt`).catch(() => null);
    if (!res?.ok) continue; // pas de reçu chez cette enclave (pas encore servie, ou servie avant un redémarrage)
    const j = await res.json() as { receipt: any; signature: Hex };
    const r = normalizeReceipt(j.receipt);
    const v = await verifyReceiptOnChain(pub as any, r, j.signature, D);
    if (!v.settleable || v.payableNow === 0n) continue;
    const ending = BigInt(s.expiresAt) - nowS < SETTLE_BEFORE_END_S;
    if (v.payableNow < SETTLE_MIN && !ending) continue;
    const { request } = await pub.simulateContract({ account, address: D.sessionPay, abi: sessionPayAbi, functionName: "settle", args: [r, j.signature] } as any);
    const tx = await wallet.writeContract(request as any);
    const rc = await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`[${now()}] session #${id} réglée : +${Number(v.payableNow) / 1e6} USDC (cumul ${r.cumulativeUnits} unités${ending ? ", fin de session" : ""}) : ${tx} (statut ${rc.status}, gas ${rc.gasUsed})`);
  }
}

// ---------- paiement à l'appel (x402) : chaque appel servi se règle seul, vite (l'autorisation du payeur expire en 15 min)
// UNE seule file pour ce processus : passages en série (x402Loop attend la fin d'un passage avant le suivant ; runOnce
// partage un passage en cours), appels suivis par (payeur, nonce), signalements signés sans doublon.
const X402_EVERY_S = Number(process.env.X402_CHECK_SECONDS ?? "10");
if (!Number.isFinite(X402_EVERY_S) || X402_EVERY_S < 5) { console.error("X402_CHECK_SECONDS : au moins 5"); process.exit(1); }
const X402_UNCOVERED_CHECKS = Number(process.env.X402_UNCOVERED_CHECKS ?? "25");
if (!Number.isSafeInteger(X402_UNCOVERED_CHECKS) || X402_UNCOVERED_CHECKS < 0) { console.error("X402_UNCOVERED_CHECKS : entier ≥ 0"); process.exit(1); }
const x402Queue = createX402SettlementQueue({
  enclaveUrl: ENCLAVE, publicClient: pub as any, walletClient: wallet as any, account, deployment: D,
  maxUncoveredChecks: X402_UNCOVERED_CHECKS,
  log: (m) => console.log(`[${now()}] x402 : ${m}`),
});
let lastWaitingLog = 0;

async function settleX402Once() {
  const r = await x402Queue.runOnce();
  for (const s of r.settled) {
    console.log(`[${now()}] x402 : appel ${s.nonce.slice(0, 10)}… de ${s.payer} réglé : +${Number(s.amount) / 1e6} USDC (X402Settler.settle ${s.tx}, gas ${s.gasUsed ?? "?"})`);
  }
  if (r.alreadySettled) {
    const elsewhere = r.consumedElsewhere ? ` (dont ${r.consumedElsewhere} sans règlement X402Settler visible : annulé(s) par le payeur ?)` : "";
    console.log(`[${now()}] x402 : ${r.alreadySettled} appel(s) déjà consommé(s) on-chain${elsewhere}, signalé(s) à l'enclave`);
  }
  if (r.expired) console.warn(`[${now()}] x402 : ${r.expired} appel(s) échu(s) avant leur règlement (perdus)`);
  if (r.dropped) console.warn(`[${now()}] x402 : ${r.dropped} appel(s) écarté(s) (ne paieraient pas cet opérateur)`);
  for (const f of r.failed) console.error(`[${now()}] x402 : règlement de ${f.nonce.slice(0, 10)}… impossible : ${f.error}`);
  if (r.fetchError) console.error(`[${now()}] x402 : relevé de /x402/pending impossible : ${r.fetchError} (${r.known} appel(s) déjà relevé(s) restent suivis)`);
  if (r.waiting.length && Date.now() - lastWaitingLog > 10 * 60_000) {
    lastWaitingLog = Date.now();
    console.log(`[${now()}] x402 : ${r.waiting.length} appel(s) en attente (ex. : ${r.waiting[0]!.reasons.join(" ; ")})`);
  }
}

async function x402Loop() {
  for (;;) {
    try {
      const k = await settlementKind();
      if (k !== "x402") return; // ce produit ne se paie pas à l'appel
      await settleX402Once();
    } catch (e) {
      console.error(`[${now()}] x402 : passage impossible :`, explainArcError(e));
    }
    if (process.env.ONCE === "1") return;
    await sleep(X402_EVERY_S * 1000);
  }
}

async function loop() {
  for (;;) {
    try {
      const signer = await currentSigner();
      const why = await needsReattest(signer);
      let fresh: { signer: Address; tx: Hex } | undefined;
      if (why) { console.log(`[${now()}] réattestation : ${why}`); fresh = await reattest(signer); }
      // niveau vérifié : la nouvelle inscription change le quote ; la liaison à la machine est refaite tout de suite
      const q = fresh ? await quoteFromRegisterTx(pub as any, fresh.tx).catch(() => undefined) : undefined;
      await keepVerified(fresh?.signer ?? signer, q).catch((e) => console.error(`[${now()}] niveau vérifié : entretien impossible :`, explainArcError(e)));
      await retirePrevious(signer).catch((e) => console.error(`[${now()}] retrait de l'ancienne clé impossible :`, explainArcError(e)));
      if (SETTLE) {
        const k = await settlementKind().catch(() => undefined);
        if (k === "session") await settleSessions(fresh?.signer ?? signer).catch((e) => console.error(`[${now()}] règlement automatique impossible :`, explainArcError(e)));
      }
      lastSigner = signer;
    } catch (e) {
      console.error(`[${now()}] registrar KO :`, explainArcError(e));
      if (arcErrorOf(e)?.name === "OperatorUnderbonded") {
        console.error(`[${now()}] → caution libre insuffisante : une ancienne clé réserve encore la caution minimale. Voir « arcvault operator status ${account.address} », puis « arcvault operator retire --signer <ancienne clé> », ou augmenter la caution.`);
      }
    }
    if (process.env.ONCE === "1") return; // un seul passage (essai, ou lancement par une tâche planifiée)
    await sleep(CHECK_MIN * 60_000);
  }
}

console.log(`Registrar (pile ${process.env.DEPLOYMENTS ?? "v2 du SDK"}, DCAP) : enclave ${ENCLAVE}, produit ${PRODUCT_ID}, opérateur ${account.address}, contrôle toutes les ${CHECK_MIN} min, renouvelle ${RENEW_BEFORE_H} h avant la fin de la fenêtre${RETIRE_PREVIOUS ? ", retire l'ancienne clé après un redémarrage" : ""}${LEVELS ? ", garde le niveau vérifié (liaison à la machine, jeton Proof of Cloud)" : ""}${SETTLE ? `, règle ce que l'enclave a servi (sessions : dès ${Number(SETTLE_MIN) / 1e6} USDC dus ou en fin de session ; paiement à l'appel x402 : toutes les ${X402_EVERY_S} s)` : ""}`);
void Promise.all([loop(), SETTLE ? x402Loop() : Promise.resolve()]);
