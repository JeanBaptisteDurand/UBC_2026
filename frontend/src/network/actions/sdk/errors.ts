/** errors.ts — les refus des contrats du réseau (pile v2), nommés et expliqués en français.
 *  Une seule table pour tous les clients (SDK, CLI, copilote, MCP, site) : chaque erreur de `arcErrorsAbi` y a sa phrase
 *  (un test le vérifie). Les erreurs viem peuvent venir de plusieurs copies de viem (SDK, CLI, service) : on les
 *  reconnaît par leur nom et on remonte la chaîne des causes, sans `instanceof`. */
import { decodeErrorResult, type Hex } from "viem";
import { arcErrorsAbi } from "./abis";

/** Nom de l'erreur (sans les paramètres) → explication en français. */
export const ARC_ERRORS_FR: Record<string, string> = {
  // ---- ProductRegistry
  AuthorShareTooHigh: "la part de l'auteur dépasse le plafond du réseau (MAX_AUTHOR_BPS, 30 %)",
  BadShares: "les parts opérateur + auteur + réseau doivent faire exactement 10 000 points de base",
  BadState: "état du produit incompatible avec cette action (déjà actif, retiré, ou inexistant)",
  NetworkShareTooLow: "la part du réseau est sous le minimum (MIN_NETWORK_BPS)",
  NoPendingUpdate: "aucune mise à jour de produit en attente",
  NoPendingWorkload: "aucune image (workloadId) en attente d'autorisation : proposeWorkload d'abord",
  NotAuthor: "réservé à l'auteur du produit",
  TooEarly: "délai (timelock) non écoulé : réessayez après l'échéance annoncée",
  // ---- OperatorBond
  AlreadyInitialized: "contrat déjà initialisé",
  BadParams: "paramètres invalides",
  Banned: "opérateur radié (caution saisie pour une faute prouvée)",
  ExposureCapExceeded: "plafond d'exposition du produit dépassé sur 24 h pour cet opérateur : réglez plus tôt et plus souvent",
  InsufficientBond: "caution insuffisante",
  NoPendingSettlement: "aucun contrat de règlement en attente d'autorisation",
  NotAgentOwner: "cet agentId ERC-8004 n'appartient pas à l'opérateur",
  NotDeployer: "réservé au déployeur",
  NotOwner: "réservé au propriétaire (de la session ou du contrat)",
  NotRegistry: "réservé au registre d'enclaves",
  NotSettlement: "appelant non autorisé (contrat de règlement)",
  NothingToWithdraw: "rien à retirer",
  TooMuchExposure: "au-delà de la moitié de la caution disponible sur 24 h : réglez plus tôt et plus souvent, ou augmentez la caution",
  UnbondLocked: "retrait de caution verrouillé (7 jours après la demande)",
  // ---- EnclaveRegistry (politique « on échoue fermé »)
  AnchorHashMismatch: "REPORTDATA[32:64] différent du hash EIP-2935 du bloc d'ancrage (P7) : redemandez un quote à l'enclave",
  AnchorTooOld: "bloc d'ancrage (ou bloc N) hors de la fenêtre EIP-2935 de 8 191 blocs, ou pas encore produit",
  DebugEnclave: "enclave en mode DEBUG : refusée (P3, l'hôte pourrait lire sa mémoire)",
  EnclaveHeldByOtherOperator: "cette clé d'enclave est tenue par un autre opérateur (fenêtre en cours ou en grâce) : refus de se l'approprier",
  EnclaveKilled: "clé d'enclave invalidée sans grâce (image retirée) : elle ne se réinscrit plus",
  HistoryCallFailed: "lecture de l'historique des blocs (EIP-2935) impossible",
  NotOperator: "réservé à l'opérateur de l'enclave",
  NotTdx: "le quote n'a pas un corps Intel TDX (P1)",
  OperatorUnderbonded: "caution libre de l'opérateur inférieure à la caution minimale du produit (chaque clé inscrite en réserve une), ou opérateur radié",
  ProductNotActive: "produit non actif (timelock en cours ou produit retiré)",
  QuoteInvalid: "quote refusé par la vérification Intel (DCAP d'Automata : signature, collatéral ou version)",
  QuoteMismatch: "ce quote n'est pas celui de l'enclave",
  QuoteReused: "ce quote a déjà servi (P9) : demandez un quote neuf à l'enclave",
  ReportDataMismatch: "REPORTDATA ne lie pas chaîne, registre, produit, opérateur et clés (P6) : le quote doit être produit pour l'adresse qui signe la transaction",
  SeptVeNotDisabled: "SEPT_VE_DISABLE exigé par le registre (P4) : la VM doit l'activer",
  SignerBoundElsewhere: "cette clé d'enclave est liée à vie à un autre opérateur ou à un autre produit",
  StillValid: "l'attestation est toujours valide : pas d'invalidation",
  TcbNotAllowed: "niveau TCB d'Intel refusé par la politique du produit (P2)",
  UnknownEnclave: "enclave inconnue du registre",
  WorkloadNotAllowed: "image de l'enclave (workloadId) non autorisée pour ce produit (P5) : l'auteur doit la proposer puis l'appliquer",
  // ---- SessionPay
  BadExpiry: "échéance de session hors bornes : entre maintenant + 10 min et maintenant + 30 jours",
  BadProduct: "produit inactif, ou prime inconnue",
  Closed: "session close",
  ECDSAInvalidSignature: "signature invalide",
  ECDSAInvalidSignatureLength: "longueur de signature invalide",
  ECDSAInvalidSignatureS: "signature malléable refusée",
  InactiveEnclave: "l'enclave n'est pas active pour ce produit à ce bloc (reçu ou enclave expirés, invalidés, ou signataire inconnu)",
  InsufficientGasForVerdict: "pas assez de gaz pour écrire le verdict ERC-8004 : renvoyez avec une limite de gaz plus haute",
  InvalidShortString: "chaîne courte invalide (domaine EIP-712)",
  ModelMismatch: "le modèle du reçu (modelHash) n'est pas celui verrouillé à l'ouverture de la session",
  NotEquivocation: "les deux messages ne forment pas une équivocation (mêmes entrées, sorties différentes, même signataire)",
  NotExpired: "trop tôt : l'échéance (+ délai de grâce) n'est pas atteinte, et l'enclave liée peut encore régler",
  NotIncreasing: "cumul non croissant : ce reçu, ou un plus récent, est déjà réglé",
  SessionMismatch: "session inconnue, ou produit du reçu différent de celui de la session",
  StringTooLong: "chaîne trop longue (domaine EIP-712)",
  WrongEnclave: "le reçu est signé par une autre enclave que celle liée à la session à son ouverture",
  WrongOperator: "l'enclave n'appartient pas à l'opérateur de la session",
  WrongSettlement: "ce produit ne se règle pas par ce contrat",
  ZeroPrice: "produit au prix 0 : pas de session prépayée",
  // ---- SealedBounty
  AlreadyPaid: "empreinte déjà payée : cet exploit a déjà été récompensé",
  AlreadyRefuted: "réclamation déjà réfutée",
  AnchorBeforeLastPayout: "réclamation ancrée avant (ou au bloc du) dernier paiement ou réarmement : rejouez sur un bloc plus récent",
  AnchorMismatch: "blockHashN différent du hash EIP-2935 du bloc N",
  BadK: "k doit être entre 1 et 5 (MAX_SIGS)",
  BadOps: "liste des opérateurs différente de celle de la réclamation acceptée (événement ClaimAccepted)",
  BadTierIndex: "palier inexistant",
  BadTiers: "paliers invalides : listes non vides, de même taille, seuils ET montants strictement croissants, premier montant > 0",
  BountyPausedErr: "prime en pause pour les réclamations ancrées à partir du bloc de la pause",
  CipherMismatch: "keccak256(cP) différent du cPHash de la réclamation",
  ClaimExpired: "échéance signée de la réclamation dépassée : redemandez une preuve à l'enclave",
  DeliveryWindowOpen: "le délai de livraison (24 h) n'est pas écoulé : la réservation ne peut pas encore retourner au pool",
  Expired: "prime échue",
  LossTooLow: "perte mesurée sous le seuil du palier",
  NeedMoreEnclaves: "montant au-dessus du plafond d'une seule enclave : il faut k signatures d'opérateurs distincts",
  NeedMoreRefuters: "pas assez d'opérateurs distincts derrière la réfutation (au moins 2, et plus que ceux de la réclamation)",
  NoValidSigner: "aucune signature d'enclave active du produit au bloc N (réclamation modifiée, enclave expirée ou invalidée)",
  NotARefutation: "ce verdict ne contredit pas la réclamation (même résultat, ou autre réclamation)",
  NotEnoughGasForPause: "pas assez de gaz pour mettre la cible en pause : renvoyez avec une limite de gaz plus haute",
  NotProtocol: "réservé au protocole qui a créé la prime",
  NothingToDeliver: "aucun paiement réservé pour cette empreinte (déjà livré, annulé, ou jamais accepté)",
  PoolTooSmall: "solde de la prime insuffisant (palier + frais réseau et opérateurs)",
  PredicateMismatch: "predicateHash de la réclamation différent de celui de la prime",
  Reentrancy: "appel réentrant refusé",
  RefuteWindowOver: "délai de réfutation (3 jours) écoulé",
  RefuterIsClaimOperator: "un opérateur signataire de la réclamation ne peut pas la réfuter",
  TierAlreadyPaid: "ce palier (ou un plus haut) est déjà payé depuis le dernier réarmement de la prime",
  UnknownClaim: "réclamation inconnue (jamais acceptée)",
  // ---- X402Settler
  ZeroAmount: "montant nul",
  // ---- VerdictLog
  NoPendingCaller: "aucun appelant en attente d'autorisation",
  NotCaller: "appelant non autorisé par VerdictLog",
};

export interface ArcErrorInfo {
  /** Nom de l'erreur du contrat (ex. WrongEnclave). */
  name: string;
  /** Arguments décodés, s'il y en a (ex. EnclaveHeldByOtherOperator(operator, freeFromBlock)). */
  args: readonly unknown[];
  /** Explication en français. */
  fr: string;
}

/** Données de revert (0x + sélecteur…) trouvées dans une erreur viem, en remontant les causes. */
function revertData(e: unknown): Hex | undefined {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    for (const d of [x?.data, x?.data?.data, x?.raw]) {
      if (typeof d === "string" && /^0x[0-9a-fA-F]{8}/.test(d)) return d as Hex;
    }
  }
  return undefined;
}

/** Erreur d'un de nos contrats contenue dans `e` (simulation ou transaction viem), ou undefined. */
export function arcErrorOf(e: unknown): ArcErrorInfo | undefined {
  // 1) viem a déjà décodé l'erreur (l'ABI de l'appel la contenait)
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    const name = x?.data?.errorName ?? (x?.name === "ContractFunctionRevertedError" ? x?.errorName : undefined);
    if (typeof name === "string" && ARC_ERRORS_FR[name]) {
      return { name, args: (x?.data?.args ?? []) as readonly unknown[], fr: ARC_ERRORS_FR[name]! };
    }
  }
  // 2) données brutes : on les décode avec TOUTES les erreurs du réseau (un refus remonté d'un contrat appelé)
  const data = revertData(e);
  if (data) {
    try {
      const d = decodeErrorResult({ abi: arcErrorsAbi, data });
      const fr = ARC_ERRORS_FR[d.errorName];
      if (fr) return { name: d.errorName, args: (d.args ?? []) as readonly unknown[], fr };
    } catch { /* erreur hors de nos contrats */ }
  }
  return undefined;
}

/** Message lisible en français pour une erreur de simulation ou de transaction ; `undefined` si rien de connu. */
export function explainArcError(e: unknown): string {
  const hit = arcErrorOf(e);
  if (hit) {
    const args = hit.args.length ? ` (${hit.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ")})` : "";
    return `refusé par le contrat : ${hit.name}${args} — ${hit.fr}`;
  }
  const chain: any[] = [];
  for (let x: any = e; x && chain.length < 12; x = x.cause) chain.push(x);
  if (chain.some((x) => x?.name === "HttpRequestError" && x.status === 429)) {
    return "le RPC d'Arc limite le débit (HTTP 429) : réessayez dans quelques secondes";
  }
  const first = chain[0];
  return String(first?.shortMessage ?? first?.message ?? e);
}
