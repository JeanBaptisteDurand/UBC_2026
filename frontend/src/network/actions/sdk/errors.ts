/** errors.ts — the refusals of the network's contracts, named and explained in French and in English.
 *  Each table serves every client (SDK, CLI, copilot, MCP, site): each error in `arcErrorsAbi` has its sentence in
 *  both (a test checks it). The console shows the French sentences as they are; the English table is the console's own
 *  (web/src/i18n/contract-errors.en.ts). viem errors can come from several copies of viem (SDK, CLI, service), so
 *  they are recognized by name, walking up the chain of causes, without `instanceof`. */
import { decodeErrorResult, type Hex } from "viem";
import { arcErrorsAbi } from "./abis";

/** Error name (without parameters) → explanation in French (the French side of the console's translations). */
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
  // ---- EnclaveRegistry ("fail closed" policy)
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

/** Error name → explanation in English: the same table as the console's (web/src/i18n/contract-errors.en.ts),
 *  for the English clients (CLI, registrar, scripts). */
export const ARC_ERRORS_EN: Record<string, string> = {
  // ---- ProductRegistry
  AuthorShareTooHigh: "the author's share is above the network cap (MAX_AUTHOR_BPS, 30%)",
  BadShares: "operator + author + network shares must add up to exactly 10,000 basis points",
  BadState: "the product's state doesn't allow this action (already active, retired, or unknown)",
  NetworkShareTooLow: "the network's share is below the minimum (MIN_NETWORK_BPS)",
  NoPendingUpdate: "no pending product update",
  NoPendingWorkload: "no image (workloadId) waiting to be allowed: call proposeWorkload first",
  NotAuthor: "only the product's author can do this",
  TooEarly: "the timelock hasn't passed: try again after the announced time",
  // ---- OperatorBond
  AlreadyInitialized: "contract already initialized",
  BadParams: "invalid parameters",
  Banned: "operator banned (bond slashed for a proven fault)",
  ExposureCapExceeded: "the product's 24 h exposure cap is exceeded for this operator: settle earlier and more often",
  InsufficientBond: "bond too low",
  NoPendingSettlement: "no settlement contract waiting to be allowed",
  NotAgentOwner: "this ERC-8004 agentId doesn't belong to the operator",
  NotDeployer: "only the deployer can do this",
  NotOwner: "only the owner (of the session or the contract) can do this",
  NotRegistry: "only the enclave registry can do this",
  NotSettlement: "caller not allowed (settlement contract)",
  NothingToWithdraw: "nothing to withdraw",
  TooMuchExposure: "above half of the available bond over 24 h: settle earlier and more often, or raise the bond",
  UnbondLocked: "bond withdrawal locked (7 days after the request)",
  // ---- EnclaveRegistry ("fail closed" policy)
  AnchorHashMismatch: "REPORTDATA[32:64] differs from the EIP-2935 hash of the anchor block (P7): ask the enclave for a new quote",
  AnchorTooOld: "anchor block (or block N) outside the 8,191-block EIP-2935 window, or not produced yet",
  DebugEnclave: "enclave in DEBUG mode: refused (P3, the host could read its memory)",
  EnclaveHeldByOtherOperator: "this enclave key is held by another operator (current window or grace period): it can't be taken over",
  EnclaveKilled: "enclave key invalidated with no grace (image retired): it can't register again",
  HistoryCallFailed: "couldn't read the block history (EIP-2935)",
  NotOperator: "only the enclave's operator can do this",
  NotTdx: "the quote doesn't have an Intel TDX body (P1)",
  OperatorUnderbonded: "the operator's free bond is below the product's minimum bond (each registered key reserves one), or the operator is banned",
  ProductNotActive: "product not active (timelock running, or product retired)",
  QuoteInvalid: "quote refused by Intel's verification (Automata DCAP: signature, collateral or version)",
  QuoteMismatch: "this quote isn't the enclave's",
  QuoteReused: "this quote was already used (P9): ask the enclave for a new quote",
  ReportDataMismatch: "REPORTDATA doesn't bind chain, registry, product, operator and keys (P6): the quote must be produced for the address that signs the transaction",
  SeptVeNotDisabled: "the registry requires SEPT_VE_DISABLE (P4): the VM must enable it",
  SignerBoundElsewhere: "this enclave key is bound for life to another operator or another product",
  StillValid: "the attestation is still valid: no invalidation",
  TcbNotAllowed: "Intel TCB level refused by the product's policy (P2)",
  UnknownEnclave: "enclave unknown to the registry",
  WorkloadNotAllowed: "the enclave's image (workloadId) isn't allowed for this product (P5): the author must propose then apply it",
  // ---- SessionPay
  BadExpiry: "session expiry out of bounds: between now + 10 min and now + 30 days",
  BadProduct: "product inactive, or bounty unknown",
  Closed: "session closed",
  ECDSAInvalidSignature: "invalid signature",
  ECDSAInvalidSignatureLength: "invalid signature length",
  ECDSAInvalidSignatureS: "malleable signature refused",
  InactiveEnclave: "the enclave isn't active for this product at this block (receipt or enclave expired, invalidated, or unknown signer)",
  InsufficientGasForVerdict: "not enough gas to write the ERC-8004 verdict: resend with a higher gas limit",
  InvalidShortString: "invalid short string (EIP-712 domain)",
  ModelMismatch: "the receipt's model (modelHash) isn't the one locked when the session opened",
  NotEquivocation: "the two messages aren't an equivocation (same inputs, different outputs, same signer)",
  NotExpired: "too early: the expiry (+ grace period) isn't reached, and the bound enclave can still settle",
  NotIncreasing: "cumulative total not increasing: this receipt, or a newer one, is already settled",
  SessionMismatch: "unknown session, or the receipt's product differs from the session's",
  StringTooLong: "string too long (EIP-712 domain)",
  WrongEnclave: "the receipt is signed by another enclave than the one bound to the session when it opened",
  WrongOperator: "the enclave doesn't belong to the session's operator",
  WrongSettlement: "this product isn't settled by this contract",
  ZeroPrice: "product priced at 0: no prepaid session",
  // ---- SealedBounty
  AlreadyPaid: "fingerprint already paid: this exploit was already rewarded",
  AlreadyRefuted: "claim already refuted",
  AnchorBeforeLastPayout: "claim anchored before (or at the block of) the last payout or re-arming: replay on a more recent block",
  AnchorMismatch: "blockHashN differs from the EIP-2935 hash of block N",
  BadK: "k must be between 1 and 5 (MAX_SIGS)",
  BadOps: "operator list differs from the accepted claim's (ClaimAccepted event)",
  BadTierIndex: "no such tier",
  BadTiers: "invalid tiers: non-empty lists of the same length, thresholds AND amounts strictly increasing, first amount > 0",
  BountyPausedErr: "bounty paused for claims anchored from the pause block on",
  CipherMismatch: "keccak256(cP) differs from the claim's cPHash",
  ClaimExpired: "the claim's signed deadline has passed: ask the enclave for a new proof",
  DeliveryWindowOpen: "the delivery window (24 h) isn't over: the reservation can't return to the pool yet",
  Expired: "bounty expired",
  LossTooLow: "measured loss below the tier's threshold",
  NeedMoreEnclaves: "amount above a single enclave's cap: k signatures from distinct operators are required",
  NeedMoreRefuters: "not enough distinct operators behind the refutation (at least 2, and more than the claim's)",
  NoValidSigner: "no signature from an active enclave of the product at block N (claim altered, enclave expired or invalidated)",
  NotARefutation: "this verdict doesn't contradict the claim (same result, or another claim)",
  NotEnoughGasForPause: "not enough gas to pause the target: resend with a higher gas limit",
  NotProtocol: "only the protocol that created the bounty can do this",
  NothingToDeliver: "no payout reserved for this fingerprint (already delivered, cancelled, or never accepted)",
  PoolTooSmall: "bounty balance too low (tier + network and operator fees)",
  PredicateMismatch: "the claim's predicateHash differs from the bounty's",
  Reentrancy: "reentrant call refused",
  RefuteWindowOver: "refutation window (3 days) over",
  RefuterIsClaimOperator: "an operator that signed the claim can't refute it",
  TierAlreadyPaid: "this tier (or a higher one) is already paid since the bounty was last re-armed",
  UnknownClaim: "unknown claim (never accepted)",
  // ---- X402Settler
  ZeroAmount: "zero amount",
  // ---- VerdictLog
  NoPendingCaller: "no caller waiting to be allowed",
  NotCaller: "caller not allowed by VerdictLog",
};

export interface ArcErrorInfo {
  /** Name of the contract error (e.g. WrongEnclave). */
  name: string;
  /** Decoded arguments, if any (e.g. EnclaveHeldByOtherOperator(operator, freeFromBlock)). */
  args: readonly unknown[];
  /** Explanation in French. */
  fr: string;
  /** Explanation in English. */
  en: string;
}

/** Revert data (0x + selector…) found in a viem error, walking up the causes. */
function revertData(e: unknown): Hex | undefined {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    for (const d of [x?.data, x?.data?.data, x?.raw]) {
      if (typeof d === "string" && /^0x[0-9a-fA-F]{8}/.test(d)) return d as Hex;
    }
  }
  return undefined;
}

/** The error of one of our contracts contained in `e` (a viem simulation or transaction), or undefined. */
export function arcErrorOf(e: unknown): ArcErrorInfo | undefined {
  // 1) viem already decoded the error (the call's ABI contained it)
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    const name = x?.data?.errorName ?? (x?.name === "ContractFunctionRevertedError" ? x?.errorName : undefined);
    if (typeof name === "string" && ARC_ERRORS_FR[name]) {
      return { name, args: (x?.data?.args ?? []) as readonly unknown[], fr: ARC_ERRORS_FR[name]!, en: ARC_ERRORS_EN[name] ?? name };
    }
  }
  // 2) raw data: decode it with EVERY error of the network (a refusal raised inside a called contract)
  const data = revertData(e);
  if (data) {
    try {
      const d = decodeErrorResult({ abi: arcErrorsAbi, data });
      const fr = ARC_ERRORS_FR[d.errorName];
      if (fr) return { name: d.errorName, args: (d.args ?? []) as readonly unknown[], fr, en: ARC_ERRORS_EN[d.errorName] ?? d.errorName };
    } catch { /* an error outside our contracts */ }
  }
  return undefined;
}

/** A readable message for a simulation or transaction error; otherwise the error's own message. French by default,
 *  as the console shows it in French; `"en"` gives the English sentence (CLI, registrar, scripts). */
export function explainArcError(e: unknown, lang: "fr" | "en" = "fr"): string {
  const hit = arcErrorOf(e);
  if (hit) {
    const args = hit.args.length ? ` (${hit.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ")})` : "";
    return lang === "en" ? `refused by the contract: ${hit.name}${args}: ${hit.en}` : `refusé par le contrat : ${hit.name}${args} — ${hit.fr}`;
  }
  const chain: any[] = [];
  for (let x: any = e; x && chain.length < 12; x = x.cause) chain.push(x);
  if (chain.some((x) => x?.name === "HttpRequestError" && x.status === 429)) {
    return lang === "en"
      ? "Arc's RPC is limiting the rate (HTTP 429): try again in a few seconds"
      : "le RPC d'Arc limite le débit (HTTP 429) : réessayez dans quelques secondes";
  }
  const first = chain[0];
  return String(first?.shortMessage ?? first?.message ?? e);
}
