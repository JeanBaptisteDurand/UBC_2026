/** tools.ts — les outils du serveur MCP du réseau d'enclaves (lectures, et actions PRÉPARÉES seulement), séparés de
 *  server.ts (le transport stdio) pour être testés. La logique est partagée avec le copilote
 *  (services/copilot/src/arc-actions.ts) :
 *  - les LISTES (produits, enclaves, primes, sessions d'un compte, activité) viennent de l'index de l'API ArcHive
 *    (ARCHIVE_API, délai de 8 s) ; API muette = « liste momentanément indisponible », jamais l'explorateur ni une liste
 *    partielle présentée comme complète (audit du 7/11, n° 7) ;
 *  - tout ce qui part vers l'agent (donc vers son LLM) passe par le filtre de secrets (audit n° 10) ;
 *  - les URL d'enclave (/attest, /pubkeys) ont les MÊMES gardes réseau que le copilote (restes du 8/11) : https, port
 *    443, chemin fixe, adresse publique résolue une fois, aucune redirection suivie, corps d'erreur jamais renvoyé.
 *    MCP_ALLOW_PRIVATE_URLS=1 (développement local : une VM du réseau local) permet le réseau privé, http et tout port,
 *    avec les mêmes autres gardes. */
import { readFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet, createArcClient, normalizeReceipt, testnet, deploymentFromJson, type ArcClient, type Deployment } from "@arcvault/sdk";
import {
  enclaveStatus, sessionStatus, prepareBountyCreate, operatorPlan, prepareBond, prepareRegister,
  productScaffold, machinesList, machineDiagnostics, enclavesList, productsList, sessionsList, activityList, scrubSecrets, railOf,
  type ActionCtx,
} from "../../copilot/src/arc-actions";
import { archiveBase, freshness, ListUnavailableError } from "../../copilot/src/archive-api";
import { parsePrefixes } from "../../copilot/src/net-guard";

/** 19/11 (audit de cohérence) : la pile lue par les outils, AVEC les niveaux (levels : SealedBountyVerified du produit 7).
 *  DEPLOYMENTS (chemin d'un deployments.*.json) si elle est donnée, sinon la pile v2.1 du SDK (`testnet`, niveaux compris),
 *  comme le copilote (services/copilot/src/copilot.ts). Sans elle, le produit 7 passait pour « contrat de règlement
 *  inconnu » et une prime du produit 7 se préparait sur SealedBounty (niveau ouvert) : faux. */
export function mcpDeployment(env: NodeJS.ProcessEnv = process.env): Deployment {
  const p = env.DEPLOYMENTS?.trim();
  const d = p ? deploymentFromJson(JSON.parse(readFileSync(p, "utf8"))) : testnet;
  if (!d.levels?.sealedBountyVerified) console.warn("[mcp] pile sans niveaux (levels) : le produit 7 (SealedBountyVerified) ne sera pas reconnu");
  return d;
}

/** L'ancien SealedBountyVerified (produit 6), remplacé le 11/11 par 0x36a8… (produit 7) : il ne règle plus rien. */
const SUPERSEDED_SBV = new Set(["0x242ca1c4d0a5a6fe5a806f215ca5f127422364d2"]);

/** 19/11 : l'étiquette de règlement d'un produit, telle que l'agent doit la lire (produits 5, 6, 7 précisés). */
export function productRail(arc: ArcClient, id: string, settlement: string): string {
  const s = String(settlement).toLowerCase();
  if (arc.d.levels && s === arc.d.levels.sealedBountyVerified.toLowerCase()) return "SealedBountyVerified (Sealed Bounty, verified operator level)";
  if (SUPERSEDED_SBV.has(s)) return "neutralized, replaced by #7 (ancien SealedBountyVerified remplacé le 11/11 : ne règle plus rien ; la Prime vérifiée est le produit 7)";
  if (id === "5" && s === arc.d.sealedBounty.toLowerCase()) return "SealedBounty (Sealed Bounty, open level) : refutation demo (démo de réfutation : une enclave menteuse réfutée, caution saisie, 10/11)";
  if (s === arc.d.sealedBounty.toLowerCase()) return "SealedBounty (Sealed Bounty, open level)";
  return railOf(arc, settlement);
}

/** 19/11 : les primes des DEUX niveaux, lues dans l'index de l'API (/bounties?level=all) : niveau ouvert (SealedBounty,
 *  produits 2 et 5) et niveau vérifié (SealedBountyVerified, produit 7). Un numéro seul ne désigne pas une prime (chaque
 *  contrat a son n° 1, n° 2…) : chaque ligne dit son niveau, son contrat et son adresse. API muette = liste indisponible. */
async function bountiesAllLevels(arc: ArcClient, actx: ActionCtx, onlyOpen: boolean) {
  const base = archiveBase(actx.apiBase);
  let j: unknown;
  try {
    const res = await fetch(`${base}/bounties?level=all`, { signal: AbortSignal.timeout(8_000), redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
  } catch (e: any) {
    throw new ListUnavailableError("primes", e?.name === "TimeoutError" ? "l'API ArcHive n'a pas répondu à temps" : `l'API ArcHive ne répond pas (${String(e?.message ?? e).slice(0, 80)})`);
  }
  if (!Array.isArray(j)) throw new ListUnavailableError("primes", "réponse inattendue de l'API ArcHive (tableau attendu)");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const rows = j.map((x: any, i: number) => {
    const big = (v: unknown, f: string): bigint => {
      try { if (v === undefined || v === null || v === "") throw new Error(); return BigInt(String(v)); }
      catch { throw new ListUnavailableError("primes", `réponse illisible de l'API ArcHive (prime ${i}, ${f})`); }
    };
    if (!x || typeof x !== "object") throw new ListUnavailableError("primes", `réponse illisible de l'API ArcHive (prime ${i})`);
    const level = x.level === "verified" ? "verified" : "open";
    const contract = typeof x.contract === "string" ? x.contract : level === "verified" ? "SealedBountyVerified" : "SealedBounty";
    const address = typeof x.address === "string" ? x.address : level === "verified" ? (arc.d.levels?.sealedBountyVerified ?? null) : arc.d.sealedBounty;
    const id = big(x.id, "id"), balance = big(x.balance, "balance"), deadline = big(x.deadline, "deadline");
    const paused = x.paused === true || x.paused === "true";
    const expired = now > deadline;
    return {
      ref: `${contract} #${id}`, id: id.toString(), level, contract, address, protocol: x.protocol ?? null,
      productId: x.productId === undefined ? null : String(x.productId), balance: `${formatUnits(balance, 6)} USDC`,
      deadline: new Date(Number(deadline) * 1000).toISOString(), paused, expired, open: !paused && !expired && balance > 0n,
    };
  });
  return {
    total: rows.length,
    ouvertes: rows.filter((r) => r.open).length,
    parNiveau: {
      open: { contrat: "SealedBounty", adresse: arc.d.sealedBounty, total: rows.filter((r) => r.level === "open").length, ouvertes: rows.filter((r) => r.level === "open" && r.open).length },
      verified: { contrat: "SealedBountyVerified", adresse: arc.d.levels?.sealedBountyVerified ?? null, total: rows.filter((r) => r.level === "verified").length, ouvertes: rows.filter((r) => r.level === "verified" && r.open).length },
    },
    luA: new Date(Number(now) * 1000).toISOString(),
    lecture: "Deux niveaux : open = SealedBounty (produits 2 et 5), verified = SealedBountyVerified (produit 7). Un numéro seul ne désigne pas une prime : lire contract + id (ref).",
    liste: await freshness({ base: actx.apiBase }),
    primes: onlyOpen ? rows.filter((r) => r.open) : rows,
    source: `API ArcHive ${base}/bounties?level=all (index des événements BountyCreated des deux contrats + getBounty)`,
  };
}

/** Champs d'un reçu d'inférence (EIP-712, SessionPay.settle) : entiers décimaux et bytes32. */
const RECEIPT_UINTS = ["productId", "sessionId", "seq", "tokensIn", "tokensOut", "cumulativeUnits", "anchorBlock"] as const;
const RECEIPT_HASHES = ["modelHash", "paramsHash", "requestHash", "responseHash"] as const;
const RECEIPT_SCHEMA = {
  type: "object",
  description: "le reçu signé par l'enclave, tel qu'elle le rend (champs en chaînes décimales et hex)",
  properties: {
    ...Object.fromEntries(RECEIPT_UINTS.map((k) => [k, { type: "string", description: "entier décimal ≥ 0 (uint256), ex. \"12\"" }])),
    ...Object.fromEntries(RECEIPT_HASHES.map((k) => [k, { type: "string", description: "bytes32 : 0x + 64 caractères hex" }])),
  },
  required: [...RECEIPT_UINTS, ...RECEIPT_HASHES],
};

/** Vérifie la forme d'un reçu avant tout calcul : une erreur par champ (au lieu de « Cannot convert undefined to a BigInt »). */
export function receiptErrors(r: unknown, sig: unknown): string[] {
  const errs: string[] = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) errs.push("receipt : objet attendu (object expected)");
  else {
    const o = r as Record<string, unknown>;
    for (const k of RECEIPT_UINTS) {
      const v = o[k];
      if (v === undefined || v === null || v === "") errs.push(`receipt.${k} : manquant (missing)`);
      else if (!((typeof v === "string" && /^\d{1,78}$/.test(v)) || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0)))
        errs.push(`receipt.${k} : entier décimal ≥ 0 attendu (unsigned integer expected)`);
    }
    for (const k of RECEIPT_HASHES) {
      const v = o[k];
      if (v === undefined || v === null || v === "") errs.push(`receipt.${k} : manquant (missing)`);
      else if (!(typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v))) errs.push(`receipt.${k} : bytes32 attendu, 0x + 64 hex (bytes32 expected)`);
    }
  }
  if (!(typeof sig === "string" && /^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(sig))) errs.push("signature : 0x + 130 hex attendu (65-byte signature expected)");
  return errs;
}

const PREP = "PRÉPARE seulement : ne signe ni n'envoie rien, renvoie les données que l'utilisateur signe dans son wallet.";
const LIST = "Lu dans l'index de l'API ArcHive ; si la liste est momentanément indisponible, l'outil le dit (aucune liste partielle).";

export const TOOLS = [
  { name: "arc_products", description: `Liste les produits du réseau d'enclaves d'Arc (prix, parts, règlement, caution minimale, état). ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = seulement les produits actifs" } } } },
  { name: "arc_enclaves", description: `Liste les enclaves (la ruche) : opérateur, produit, TCB, active ou non au bloc de tête, fenêtre de validité en blocs, clé X25519 inscrite. ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = seulement les enclaves actives" } } } },
  { name: "arc_bounties", description: `Liste les primes scellées des DEUX niveaux (open : SealedBounty, produits 2 et 5 ; verified : SealedBountyVerified, produit 7) : niveau, contrat, protocole, produit, solde, échéance, pause, ouverte ou non. ${LIST}`, inputSchema: { type: "object", properties: { onlyOpen: { type: "boolean", description: "true = seulement les primes ouvertes" } } } },
  { name: "arc_sessions", description: `Liste les sessions SessionPay ouvertes par un compte : produit, dépôt, déjà réglé, reste, fermée, échéance. ${LIST}`, inputSchema: { type: "object", properties: { owner: { type: "string", description: "adresse 0x… du compte" } }, required: ["owner"] } },
  { name: "arc_activity", description: `L'activité on-chain récente des contrats du réseau (inscriptions, sessions, règlements, primes, verdicts), du plus récent au plus ancien. ${LIST}`, inputSchema: { type: "object", properties: { limit: { type: "number", description: "nombre d'événements (1 à 50, défaut 10)" } } } },
  { name: "arc_pricing", description: "Coût d'un usage : unités × prix du produit.", inputSchema: { type: "object", properties: { productId: { type: "string" }, units: { type: "string" } }, required: ["productId", "units"] } },
  { name: "arc_verify_receipt", description: "Vérifie un reçu d'inférence comme SessionPay.settle : enclave verrouillée de la session, active au bloc d'ancrage chez son opérateur, modèle verrouillé, cumul croissant ; et ce que le règlement verserait.", inputSchema: { type: "object", properties: { receipt: RECEIPT_SCHEMA, signature: { type: "string", description: "signature EIP-712 de l'enclave : 0x + 130 hex (65 octets)" } }, required: ["receipt", "signature"] } },
  { name: "arc_enclave_status", description: "État d'UNE enclave par son signataire : opérateur, produit, TCB, expiration, active ou non, caution de l'opérateur (totale, disponible, exposition 24 h sur ce produit).", inputSchema: { type: "object", properties: { signer: { type: "string", description: "adresse 0x… du signataire de l'enclave" } }, required: ["signer"] } },
  { name: "arc_session_status", description: "État d'une session SessionPay : propriétaire, produit, opérateur, dépôt, déjà payé, reste, échéance, fermée.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] } },
  { name: "arc_bounty_prepare_create", description: `Création d'une prime scellée, avec assistant de prédicat (« le solde USDC du contrat target baisse d'au moins minDrop » → clause ERC20_DROP), paliers, frais lus on-chain, paramètres de createBounty et autorisation EIP-3009. ${PREP}`, inputSchema: { type: "object", properties: {
    from: { type: "string", description: "wallet du protocole, qui finance et signe" },
    target: { type: "string", description: "contrat surveillé (ex. le coffre du protocole)" },
    minDrop: { type: "string", description: "baisse minimale qui prouve l'exploit, en USDC" },
    reward: { type: "string", description: "récompense du chasseur en USDC (un palier)" },
    tiers: { type: "array", description: "plusieurs paliers [{ minLoss, amount }] en USDC", items: { type: "object", properties: { minLoss: { type: "string" }, amount: { type: "string" } } } },
    funding: { type: "string", description: "financement initial en USDC (défaut : un paiement du plus haut palier, frais compris)" },
    clauseType: { type: "string", enum: ["ERC20_DROP", "NATIVE_DROP", "ATTACKER_PROFIT"] },
    token: { type: "string" }, predicate: { type: "object", description: "prédicat complet { combine, clauses } (avancé)" },
    deadlineDays: { type: "number" }, k: { type: "number" }, singleCap: { type: "string" }, targetToPause: { type: "string" },
    protocolX25519: { type: "string", description: "clé PUBLIQUE X25519 du protocole (jamais la privée)" }, productId: { type: "string" },
  } } },
  { name: "arc_operator_plan", description: "Plan pas à pas pour devenir opérateur : VM Intel TDX (Phala), app-compose, /attest, caution, registerEnclave, renouvellement ; règles de la caution avec les chiffres lus on-chain.", inputSchema: { type: "object", properties: { operator: { type: "string" }, productId: { type: "string" } } } },
  { name: "arc_operator_prepare_bond", description: `Dépôt de caution d'opérateur : autorisation EIP-3009 pour bond(), ou approve + bondFrom encodés ; vérifie solde, bannissement, caution minimale. ${PREP}`, inputSchema: { type: "object", properties: { operator: { type: "string" }, amount: { type: "string", description: "montant en USDC" }, productId: { type: "string" } } } },
  { name: "arc_operator_prepare_register", description: `Inscription d'une enclave : bloc d'ancrage, lecture du /attest de la VM (si enclaveUrl et operator sont donnés), transaction registerEnclave encodée. ${PREP}`, inputSchema: { type: "object", properties: { productId: { type: "string" }, operator: { type: "string" }, enclaveUrl: { type: "string" }, includeCalldata: { type: "boolean", description: "calldata complète (défaut : oui)" } }, required: ["productId"] } },
  { name: "arc_product_scaffold", description: "Squelette d'un produit tiers : conteneur + kit d'enclave, app-compose, manifeste, paramètres de propose(), puis timelock et activate (bpsOperator + bpsAuthor + bpsNetwork = 10 000).", inputSchema: { type: "object", properties: {
    name: { type: "string" }, description: { type: "string" }, rail: { type: "string", enum: ["session", "x402"] }, deterministic: { type: "boolean" },
    price: { type: "string", description: "prix par unité en USDC" }, bpsOperator: { type: "number" }, bpsAuthor: { type: "number" }, bpsNetwork: { type: "number" },
    minBond: { type: "string" }, exposureCap: { type: "string" }, modelId: { type: "string" }, image: { type: "string" },
  } } },
  { name: "arc_machines_list", description: "Machines (nœuds) d'un opérateur d'après l'API ArcHive : mode (tdx, dstack, demo), en ligne, dernier signal, produit, URL et signataire de l'enclave, diagnostic OK, inscrite. Lecture seule.", inputSchema: { type: "object", properties: { operator: { type: "string", description: "adresse 0x… de l'opérateur" } }, required: ["operator"] } },
  { name: "arc_machine_diagnostics", description: "Diagnostic d'une machine d'opérateur (API ArcHive) : vérifications en échec avec la correction à faire, échecs normaux selon le mode, journal récent, attestation, inscription on-chain. Lecture seule.", inputSchema: { type: "object", properties: { machineId: { type: "string" } }, required: ["machineId"] } },
];

/** Le client Arc et le contexte des actions d'un processus MCP local (stdio). */
export function createMcpContext(env: NodeJS.ProcessEnv = process.env): { arc: ArcClient; actx: ActionCtx } {
  // le RPC public d'Arc répond 429 en rafale : viem réessaie avec un délai croissant
  // 19/11 : la pile AVEC les niveaux (produit 7 = SealedBountyVerified), comme le copilote
  const arc = createArcClient({ publicClient: createPublicClient({ chain: arcTestnet, transport: http(env.RPC_URL, { retryCount: 5, retryDelay: 400 }) }) as any, deployment: mcpDeployment(env) });
  // Processus local (stdio) : il rend la calldata complète (un agent peut la passer telle quelle au wallet de
  // l'utilisateur, qui signe). Une URL d'enclave piégée ne doit pas lui faire lire le réseau de l'utilisateur : mêmes
  // gardes que le copilote, sauf MCP_ALLOW_PRIVATE_URLS=1 (lire le /attest d'une VM du réseau local, en développement).
  const actx: ActionCtx = {
    allowPrivateUrls: env.MCP_ALLOW_PRIVATE_URLS === "1",
    enclavePathPrefixes: parsePrefixes(env.ENCLAVE_PATH_PREFIXES),
    includeCalldata: true,
    enclaveUrl: env.ENCLAVE_URL,
    apiBase: env.ARCHIVE_API,
  };
  return { arc, actx };
}

async function run(arc: ArcClient, actx: ActionCtx, name: string, a: any): Promise<unknown> {
  switch (name) {
    case "arc_products": {
      const v = await productsList(arc, { all: a.onlyActive !== true }, actx);
      return { ...v, produits: v.produits.map((p) => ({ ...p, rail: productRail(arc, p.id, p.settlement) })) };
    }
    case "arc_enclaves": return enclavesList(arc, { onlyActive: a.onlyActive }, actx);
    case "arc_bounties": return bountiesAllLevels(arc, actx, a.onlyOpen === true || String(a.onlyOpen) === "true");
    case "arc_sessions": return sessionsList(arc, { owner: a.owner }, { ...actx, user: undefined });
    case "arc_activity": return activityList(arc, { limit: a.limit }, actx);
    case "arc_pricing": { const p = await arc.getProduct(BigInt(a.productId)); const u = BigInt(a.units); return { pricePerUnit: formatUnits(p.price, 6) + " USDC", units: u.toString(), total: formatUnits(p.price * u, 6) + " USDC" }; }
    case "arc_verify_receipt": {
      let receipt: unknown = a.receipt;
      if (typeof receipt === "string") { try { receipt = JSON.parse(receipt); } catch { /* signalé ci-dessous */ } }
      const errs = receiptErrors(receipt, a.signature);
      if (errs.length) throw new Error(`reçu invalide (invalid receipt) : ${errs.join(" ; ")}`);
      const v = await arc.verifyReceipt(normalizeReceipt(receipt), a.signature);
      return { signer: v.signer, settleable: v.settleable, payableNow: formatUnits(v.payableNow, 6) + " USDC", activeOperatorAtAnchor: v.activeOperatorAtAnchor, checks: v.checks.map((c) => ({ ok: c.ok, quoi: c.fr })) };
    }
    case "arc_enclave_status": return enclaveStatus(arc, a.signer);
    case "arc_session_status": return sessionStatus(arc, a.sessionId);
    case "arc_bounty_prepare_create": return prepareBountyCreate(arc, a, actx);
    case "arc_operator_plan": return operatorPlan(arc, a, actx);
    case "arc_operator_prepare_bond": return prepareBond(arc, a, actx);
    case "arc_operator_prepare_register": return prepareRegister(arc, a, actx);
    case "arc_product_scaffold": return productScaffold(arc, a);
    case "arc_machines_list": return machinesList(a, actx);
    case "arc_machine_diagnostics": return machineDiagnostics(arc, a, actx);
    default: throw new Error(`outil inconnu: ${name}`);
  }
}

export type ToolOutput = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Exécute un outil et rend sa sortie MCP : JSON lisible, secrets masqués ; une erreur est rendue à l'agent (isError)
 *  sans faire tomber le serveur. */
export async function callTool(arc: ArcClient, actx: ActionCtx, name: string, args: unknown): Promise<ToolOutput> {
  const a = (args && typeof args === "object" ? args : {}) as any;
  try {
    const result = await run(arc, actx, name, a);
    const text = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) ?? "null";
    return { content: [{ type: "text", text: scrubSecrets(text) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: scrubSecrets(`Erreur : ${e?.shortMessage ?? e?.message ?? String(e)}`) }], isError: true };
  }
}
