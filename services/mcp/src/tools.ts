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
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet, createArcClient, normalizeReceipt, type ArcClient } from "@arcvault/sdk";
import {
  enclaveStatus, sessionStatus, bountyList, prepareBountyCreate, operatorPlan, prepareBond, prepareRegister,
  productScaffold, machinesList, machineDiagnostics, enclavesList, productsList, sessionsList, activityList, scrubSecrets,
  type ActionCtx,
} from "../../copilot/src/arc-actions";
import { parsePrefixes } from "../../copilot/src/net-guard";

const PREP = "PRÉPARE seulement : ne signe ni n'envoie rien, renvoie les données que l'utilisateur signe dans son wallet.";
const LIST = "Lu dans l'index de l'API ArcHive ; si la liste est momentanément indisponible, l'outil le dit (aucune liste partielle).";

export const TOOLS = [
  { name: "arc_products", description: `Liste les produits du réseau d'enclaves d'Arc (prix, parts, règlement, caution minimale, état). ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = seulement les produits actifs" } } } },
  { name: "arc_enclaves", description: `Liste les enclaves (la ruche) : opérateur, produit, TCB, active ou non au bloc de tête, fenêtre de validité en blocs, clé X25519 inscrite. ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = seulement les enclaves actives" } } } },
  { name: "arc_bounties", description: `Liste les primes scellées : protocole, produit, solde, échéance, pause, ouverte ou non. ${LIST}`, inputSchema: { type: "object", properties: { onlyOpen: { type: "boolean", description: "true = seulement les primes ouvertes" } } } },
  { name: "arc_sessions", description: `Liste les sessions SessionPay ouvertes par un compte : produit, dépôt, déjà réglé, reste, fermée, échéance. ${LIST}`, inputSchema: { type: "object", properties: { owner: { type: "string", description: "adresse 0x… du compte" } }, required: ["owner"] } },
  { name: "arc_activity", description: `L'activité on-chain récente des contrats du réseau (inscriptions, sessions, règlements, primes, verdicts), du plus récent au plus ancien. ${LIST}`, inputSchema: { type: "object", properties: { limit: { type: "number", description: "nombre d'événements (1 à 50, défaut 10)" } } } },
  { name: "arc_pricing", description: "Coût d'un usage : unités × prix du produit.", inputSchema: { type: "object", properties: { productId: { type: "string" }, units: { type: "string" } }, required: ["productId", "units"] } },
  { name: "arc_verify_receipt", description: "Vérifie un reçu d'inférence comme SessionPay.settle : enclave verrouillée de la session, active au bloc d'ancrage chez son opérateur, modèle verrouillé, cumul croissant ; et ce que le règlement verserait.", inputSchema: { type: "object", properties: { receipt: { type: "object" }, signature: { type: "string" } }, required: ["receipt", "signature"] } },
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
  const arc = createArcClient({ publicClient: createPublicClient({ chain: arcTestnet, transport: http(env.RPC_URL, { retryCount: 5, retryDelay: 400 }) }) as any });
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
    case "arc_products": return productsList(arc, { all: a.onlyActive !== true }, actx);
    case "arc_enclaves": return enclavesList(arc, { onlyActive: a.onlyActive }, actx);
    case "arc_bounties": {
      const v = await bountyList(arc, { onlyOpen: a.onlyOpen }, actx);
      return {
        total: v.total, ouvertes: v.ouvertes, lueAuBloc: v.lueAuBloc, liste: v.liste,
        primes: v.primes.map((b) => ({ id: b.id, protocol: b.protocole, productId: b.produit, balance: b.solde, deadline: b.echeance, paused: b.enPause, open: b.ouverte })),
      };
    }
    case "arc_sessions": return sessionsList(arc, { owner: a.owner }, { ...actx, user: undefined });
    case "arc_activity": return activityList(arc, { limit: a.limit }, actx);
    case "arc_pricing": { const p = await arc.getProduct(BigInt(a.productId)); const u = BigInt(a.units); return { pricePerUnit: formatUnits(p.price, 6) + " USDC", units: u.toString(), total: formatUnits(p.price * u, 6) + " USDC" }; }
    case "arc_verify_receipt": {
      const v = await arc.verifyReceipt(normalizeReceipt(a.receipt), a.signature);
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
