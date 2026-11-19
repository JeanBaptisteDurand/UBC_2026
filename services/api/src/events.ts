/** events.ts — the events of ArcHive's contracts that the API indexes, and what it derives from them:
 *  - EVENTS: the events' ABI (v2 stack, plus the v2.1 ones: EnclaveImage, VerdictNotApplicable, VerdictSkipped,
 *    RequestHashSalted, ManifestURIUpdateProposed / ManifestURIUpdated…). Additions only: on v2, the v2.1 events
 *    simply never arrive;
 *  - eventLabel: an event's readable label (in English, the public API's language), for /activity;
 *  - sessionVerdicts: the outcome of the ERC-8004 verdict written when each session closes — written (Recorded), not
 *    applicable (VerdictNotApplicable: a session closed with no payment), skipped (VerdictSkipped, with its reason), none
 *    (closed with no verdict and no event: v2 stack, operator banned…) or pending (session not closed yet);
 *  - indexStartBlock: the index's start block (the deployment's deployBlock when known).
 *  Pure functions (no network call): tested in test/events.test.ts. */
import { decodeErrorResult, formatUnits, parseAbi, type Hex } from "viem";
import { arcErrorsAbi } from "@arcvault/sdk";
import type { Ev } from "./indexer";

export const EVENTS = parseAbi([
  "event EnclaveRegistered(address indexed signer, uint256 indexed productId, address indexed operator, bytes32 workloadId, uint64 expiresAt)",
  "event SessionOpened(uint256 indexed sessionId, address indexed owner, uint256 indexed productId, uint256 deposit)",
  "event SessionToppedUp(uint256 indexed sessionId, uint256 amount)",
  "event SessionKeyRotated(uint256 indexed sessionId, address newKey)",
  "event Settled(uint256 indexed sessionId, uint128 cumulativeUnits, uint256 paidDelta)",
  "event SessionClosed(uint256 indexed sessionId, uint256 refund)",
  "event EquivocationSlashed(uint256 indexed id, address indexed signer, address operator)",
  "event BountyCreated(uint256 indexed bountyId, address indexed protocol, uint256 productId, uint256 funding)",
  "event BountyFunded(uint256 indexed bountyId, uint256 amount)",
  "event ExploitDelivered(uint256 indexed bountyId, bytes cP)",
  "event BountyPaid(uint256 indexed bountyId, address indexed payee, uint256 amount, uint8 tier)",
  "event RemainingWithdrawn(uint256 indexed bountyId, uint256 amount)",
  "event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag)",
  "event CallSettled(uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce)",
  "event ProductUpdated(uint256 indexed productId, uint64 version)",
  // v2 stack
  "struct Claim { uint256 bountyId; address payee; uint64 blockN; bytes32 blockHashN; bytes32 predicateHash; uint256 loss; uint8 tier; bytes32 fingerprint; bytes32 cPHash; uint64 deadline; }",
  "event ClaimAccepted(uint256 indexed bountyId, bytes32 indexed claimDigest, Claim claim, address[] operators, uint256 amount)",
  "event EnclaveRetired(address indexed signer)",
  "event EnclaveInvalidated(address indexed signer, string reason)",
  "event ProductProposed(uint256 indexed productId, address indexed author, uint64 activatesAt)",
  "event ProductActivated(uint256 indexed productId)",
  "event ProductUpdateProposed(uint256 indexed productId, uint64 applyAt)",
  "event WorkloadProposed(uint256 indexed productId, bytes32 workloadId, uint64 applyAt)",
  "event WorkloadAdded(uint256 indexed productId, bytes32 workloadId)",
  "event WorkloadRetired(uint256 indexed productId, bytes32 workloadId)",
  "event ClaimRefuted(uint256 indexed bountyId, bytes32 indexed claimDigest, address indexed reporter)",
  "event BountyReopened(uint256 indexed bountyId, uint64 fromBlock)",
  "event BountyPauseSet(uint256 indexed bountyId, bool paused, uint64 fromBlock)",
  "event UndeliveredCancelled(uint256 indexed bountyId, bytes32 indexed fingerprint, uint256 returned)",
  "event Credited(address indexed to, uint256 amount)",
  // v2.1 stack (contracts/src)
  "event EnclaveImage(address indexed signer, uint256 indexed productId, bytes32 indexed imageId, bytes32 composeHash, bytes32 osImageHash)",
  "event VerdictNotApplicable(uint256 indexed sessionId)",
  "event VerdictSkipped(bytes32 indexed requestHash, bytes reason)",
  "event RequestHashSalted(bytes32 indexed requestHash, bytes32 indexed saltedHash)",
  "event ManifestURIUpdateProposed(uint256 indexed productId, string manifestURI, uint64 applyAt)",
  "event ManifestURIUpdated(uint256 indexed productId, string manifestURI)",
]);

/** 19/11 : les événements du SECOND index (server.ts, idxLevels) : la caution des opérateurs (OperatorBond) et les deux
 *  niveaux (MachineRegistry, ProofOfCloudAuditor). La Prime au niveau vérifié (SealedBountyVerified, même code que
 *  SealedBounty) émet les événements d'EVENTS. Gardés hors d'EVENTS : l'empreinte de l'index principal ne change pas
 *  (pas de relecture de toute la chaîne au déploiement). */
export const EVENTS_LEVELS = parseAbi([
  "event Bonded(address indexed operator, uint256 amount)",
  "event UnbondRequested(address indexed operator, uint256 amount, uint64 withdrawableAt)",
  "event Withdrawn(address indexed operator, uint256 amount)",
  "event ExposureConsumed(address indexed operator, uint256 indexed productId, uint256 amount)",
  "event Slashed(address indexed operator, address indexed reporter, address victim, uint256 amount)",
  "event BondReserved(address indexed operator, address indexed signer, uint256 amount)",
  "event BondReleased(address indexed operator, address indexed signer, uint256 amount)",
  "event SettlementProposed(address indexed settlement, uint64 applyAt)",
  "event SettlementAuthorized(address indexed settlement)",
  "event SettlementRemoved(address indexed settlement)",
  "event AgentIdSet(address indexed operator, uint256 agentId)",
  "event MachineBound(address indexed signer, bytes16 indexed ppid, bytes32 quoteHash)",
  "event MachineAttested(address indexed auditor, bytes16 indexed ppid, uint64 expiresAt, string site, string evidence)",
  "event MachineRevoked(address indexed auditor, bytes16 indexed ppid, string reason)",
  "event PolicyProposed(uint256 indexed productId, uint8 minLevel, address[] auditors, uint64 applyAt)",
  "event PolicyApplied(uint256 indexed productId, uint8 minLevel, address[] auditors)",
  "event ProofOfCloudToken(bytes16 indexed ppid, uint64 timestamp, uint64 expiresAt, bytes32 quoteSha256, string label)",
]);

/** Les écritures qui accompagnent CHAQUE inscription et chaque règlement : réserve, libération et exposition de la caution,
 *  et la liaison de l'enclave à la puce de sa machine (refaite à chaque renouvellement, toutes les quatre heures). Comptées
 *  et lisibles, mais hors de /activity par défaut (?minor=1 les montre) : la fenêtre des 100 derniers événements reste
 *  celle des faits (inscriptions, paiements, primes, verdicts, saisies).
 *  19/11 (r2) : aussi les écritures d'administration des deux niveaux (déclarations de machines et jetons de l'alliance
 *  Proof of Cloud, renouvelés par le registrar ; contrats de règlement autorisés par la caution ; politiques des
 *  produits ; identité ERC-8004 d'un opérateur) : sans cela, elles poussaient hors de la fenêtre de 100 des faits plus
 *  anciens que le site lit pour dire l'état des produits (inscriptions, invalidations, manifestes). Les primes, les
 *  dépôts de caution (Bonded) et les saisies (Slashed) restent dans la fenêtre par défaut. */
export const MINOR_EVENTS: ReadonlySet<string> = new Set([
  "BondReserved", "BondReleased", "ExposureConsumed", "MachineBound",
  "MachineAttested", "ProofOfCloudToken", "SettlementProposed", "SettlementAuthorized", "SettlementRemoved",
  "PolicyProposed", "PolicyApplied", "AgentIdSet",
]);

// ---------------------------------------------------------------- libellés (/activity)

const usdc = (v: unknown): string => {
  try { return `${formatUnits(BigInt(String(v)), 6)} USDC`; } catch { return "? USDC"; }
};
const short = (h: unknown): string => {
  const s = String(h ?? "");
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
};
/** les primes au niveau vérifié (SealedBountyVerified) ont leurs propres numéros : le libellé le dit */
const lvl = (e: Ev): string => (e.contract === "SealedBountyVerified" ? " (verified level)" : "");

/** Le libellé anglais d'un événement indexé, d'après son nom et ses valeurs (contrat émetteur pour les homonymes). */
const LABELS: Record<string, (a: Record<string, unknown>, e: Ev) => string> = {
  EnclaveRegistered: (a) => `Enclave ${short(a.signer)} registered (product #${a.productId})`,
  EnclaveImage: (a) => `Enclave image fingerprint recorded (product #${a.productId}, image ${short(a.imageId)})`,
  EnclaveRetired: (a) => `Enclave ${short(a.signer)} retired by its operator`,
  EnclaveInvalidated: (a) => `Enclave ${short(a.signer)} invalidated (${String(a.reason ?? "")})`,
  SessionOpened: (a) => `Session #${a.sessionId} opened (deposit ${usdc(a.deposit)})`,
  SessionToppedUp: (a) => `Session #${a.sessionId} topped up (${usdc(a.amount)})`,
  SessionKeyRotated: (a) => `Session #${a.sessionId} key changed`,
  Settled: (a) => `Session #${a.sessionId} settled (${usdc(a.paidDelta)})`,
  SessionClosed: (a) => `Session #${a.sessionId} closed (refunded ${usdc(a.refund)})`,
  VerdictNotApplicable: (a) => `Session #${a.sessionId} closed without payment: no verdict to write`,
  VerdictSkipped: (a, e) => `ERC-8004 verdict skipped (${e.contract}): ${decodeSkipReason(a.reason)}`,
  Recorded: (a) => `Verdict written to ERC-8004 (agent ${a.agentId}, score ${a.response})`,
  RequestHashSalted: () => "Verdict request hash was taken: written under a salted hash",
  EquivocationSlashed: (_a, e) => `Bond slashed for double signing (${e.contract})`,
  CallSettled: (a) => `Pay-per-call settled (x402): ${usdc(a.amount)} (product #${a.productId})`,
  BountyCreated: (a, e) => `Bounty #${a.bountyId}${lvl(e)} posted (pool ${usdc(a.funding)})`,
  BountyFunded: (a, e) => `Bounty #${a.bountyId}${lvl(e)} funded (${usdc(a.amount)})`,
  ExploitDelivered: (a, e) => `Encrypted report delivered (bounty #${a.bountyId}${lvl(e)})`,
  BountyPaid: (a, e) => `Bounty #${a.bountyId}${lvl(e)} paid to the hunter (${usdc(a.amount)})`,
  RemainingWithdrawn: (a, e) => `Bounty #${a.bountyId}${lvl(e)} remainder withdrawn (${usdc(a.amount)})`,
  ClaimAccepted: (a, e) => `Claim accepted (bounty #${a.bountyId}${lvl(e)}): payout reserved`,
  ClaimRefuted: (a, e) => `Claim refuted (bounty #${a.bountyId}${lvl(e)}): nothing paid`,
  BountyReopened: (a, e) => `Bounty #${a.bountyId}${lvl(e)} re-armed`,
  BountyPauseSet: (a, e) => `Bounty #${a.bountyId}${lvl(e)} ${String(a.paused) === "true" ? "paused" : "resumed"}`,
  UndeliveredCancelled: (a, e) => `Undelivered payout returned to the pool (bounty #${a.bountyId}${lvl(e)}, ${usdc(a.returned)})`,
  // 19/11 : la caution et les deux niveaux (second index)
  Bonded: (a) => `Operator ${short(a.operator)} posted a bond (${usdc(a.amount)})`,
  UnbondRequested: (a) => `Operator ${short(a.operator)} asked to withdraw ${usdc(a.amount)} of bond`,
  Withdrawn: (a) => `Operator ${short(a.operator)} withdrew ${usdc(a.amount)} of bond`,
  ExposureConsumed: (a) => `Operator exposure used on product #${a.productId} (${usdc(a.amount)})`,
  Slashed: (a) => `Bond seized from operator ${short(a.operator)}: ${usdc(a.amount)}`,
  BondReserved: (a) => `Bond reserved for enclave ${short(a.signer)} (${usdc(a.amount)})`,
  BondReleased: (a) => `Bond released for enclave ${short(a.signer)} (${usdc(a.amount)})`,
  SettlementProposed: (a) => `Settlement contract ${short(a.settlement)} proposed for operator bonds`,
  SettlementAuthorized: (a) => `Settlement contract ${short(a.settlement)} allowed to use operator bonds`,
  SettlementRemoved: (a) => `Settlement contract ${short(a.settlement)} removed from operator bonds`,
  AgentIdSet: (a) => `Operator ${short(a.operator)} linked to ERC-8004 agent ${a.agentId}`,
  MachineBound: (a) => `Enclave ${short(a.signer)} tied to its machine's chip (PPID ${short(a.ppid)})`,
  MachineAttested: (a) => `Machine ${short(a.ppid)} declared in a known datacenter (${String(a.site ?? "")})`,
  MachineRevoked: (a) => `Machine ${short(a.ppid)} declaration revoked`,
  PolicyProposed: (a) => `Product #${a.productId} level policy proposed`,
  PolicyApplied: (a) => `Product #${a.productId} level policy applied (${String(a.minLevel) === "1" ? "verified" : "open"} level)`,
  ProofOfCloudToken: (a) => `Proof of Cloud token checked on Arc for machine ${short(a.ppid)}`,
  Credited: (a) => `Payout credited (transfer refused): ${usdc(a.amount)}`,
  ProductProposed: (a) => `Product #${a.productId} proposed`,
  ProductActivated: (a) => `Product #${a.productId} activated`,
  ProductUpdateProposed: (a) => `Product #${a.productId} update proposed`,
  ProductUpdated: (a) => `Product #${a.productId} updated (version ${a.version})`,
  ManifestURIUpdateProposed: (a) => `Product #${a.productId} manifest URI change proposed: ${String(a.manifestURI ?? "")}`,
  ManifestURIUpdated: (a) => `Product #${a.productId} manifest URI changed: ${String(a.manifestURI ?? "")}`,
  WorkloadProposed: (a) => `New image proposed (product #${a.productId})`,
  WorkloadAdded: (a) => `New image allowed (product #${a.productId})`,
  WorkloadRetired: (a) => `Image retired (product #${a.productId})`,
};

export function eventLabel(e: Ev): string {
  const f = Object.prototype.hasOwnProperty.call(LABELS, e.name) ? LABELS[e.name] : undefined;
  try { return f ? f(e.args ?? {}, e) : e.name; } catch { return e.name; }
}

// ---------------------------------------------------------------- raison d'un verdict sauté

/** Les erreurs du réseau (SDK : NotCaller de VerdictLog, InsufficientGasForVerdict…), plus AlreadyRecorded (VerdictLog
 *  v2.1 : un verdict déjà écrit pour ce requestHash) ; Error(string) et Panic(uint256) sont décodés par viem lui-même. */
const REASON_ABI = [...arcErrorsAbi, ...parseAbi(["error AlreadyRecorded()"])] as const;

/** La raison d'un VerdictSkipped (données de revert, 132 octets au plus) en clair : nom et valeurs de l'erreur si elle
 *  est connue, sinon les octets tels quels ; vide : revert sans raison (registre qui refuse sans message, gaz épuisé). */
export function decodeSkipReason(data: unknown): string {
  const hex = typeof data === "string" && /^0x([0-9a-fA-F]{2})*$/.test(data) ? (data as Hex) : null;
  if (!hex) return "unreadable revert data";
  if (hex === "0x") return "empty revert (no reason given)";
  try {
    const d = decodeErrorResult({ abi: REASON_ABI as any, data: hex });
    const args = (d.args ?? []).map((x: unknown) => (typeof x === "bigint" ? x.toString() : String(x)));
    return `${d.errorName}(${args.join(", ")})`;
  } catch {
    return hex;
  }
}

// ---------------------------------------------------------------- issue du verdict de chaque session (/proof)

export type VerdictOutcome = "written" | "not_applicable" | "skipped" | "none" | "pending";

export interface SessionVerdict {
  sessionId: string;
  outcome: VerdictOutcome;
  /** la transaction de fermeture (null : session pas encore close) */
  tx: string | null;
  block: number | null;
  /** written : l'agent et la note écrits (Recorded), et le hash réellement écrit (salé s'il le fallait) */
  agentId?: string;
  response?: number;
  requestHash?: string;
  salted?: boolean;
  /** skipped : la raison décodée, et les octets de revert tels quels */
  reason?: string;
  reasonData?: string;
}

const isClosing = (e: Ev) => e.contract === "SessionPay" && (e.name === "VerdictNotApplicable" || e.name === "VerdictSkipped");
const isVerdictLog = (e: Ev) => e.contract === "VerdictLog" && (e.name === "Recorded" || e.name === "RequestHashSalted");

/**
 * L'issue du verdict de fermeture de chaque session, d'après les événements indexés (dans n'importe quel ordre).
 * Dans la transaction de fermeture, SessionPay émet d'abord l'issue — VerdictLog.Recorded (précédé de RequestHashSalted
 * si le hash était pris), SessionPay.VerdictSkipped, ou SessionPay.VerdictNotApplicable — puis SessionClosed(sessionId).
 * Une issue appartient donc au SessionClosed qui la SUIT dans la même transaction, après le SessionClosed précédent
 * (plusieurs fermetures dans une même transaction, par un portefeuille qui groupe ses appels, restent distinctes).
 * Les sessions ouvertes et pas encore closes sont « pending ».
 */
export function sessionVerdicts(events: readonly Ev[]): Map<string, SessionVerdict> {
  const out = new Map<string, SessionVerdict>();
  const byTx = new Map<string, Ev[]>();
  for (const e of events) {
    if (!(e.contract === "SessionPay" && e.name === "SessionClosed") && !isClosing(e) && !isVerdictLog(e)) continue;
    const list = byTx.get(e.tx);
    if (list) list.push(e); else byTx.set(e.tx, [e]);
  }
  for (const [tx, list] of byTx) {
    list.sort((a, b) => a.logIndex - b.logIndex);
    let pending: Ev[] = [];
    for (const e of list) {
      if (!(e.name === "SessionClosed")) { pending.push(e); continue; }
      const id = String(e.args.sessionId);
      const v: SessionVerdict = { sessionId: id, outcome: "none", tx, block: e.block };
      const na = pending.find((x) => x.name === "VerdictNotApplicable" && String(x.args.sessionId) === id);
      const rec = [...pending].reverse().find((x) => x.name === "Recorded");
      const skip = [...pending].reverse().find((x) => x.name === "VerdictSkipped");
      if (na) v.outcome = "not_applicable";
      else if (rec) {
        v.outcome = "written";
        v.agentId = String(rec.args.agentId);
        v.response = Number(rec.args.response);
        v.requestHash = String(rec.args.requestHash);
        v.salted = pending.some((x) => x.name === "RequestHashSalted" && String(x.args.saltedHash) === v.requestHash);
      } else if (skip) {
        v.outcome = "skipped";
        v.reasonData = String(skip.args.reason ?? "0x");
        v.reason = decodeSkipReason(skip.args.reason);
      }
      // la même session ne se ferme qu'une fois : en cas de doublon (index relu), la fermeture la plus récente l'emporte
      const prev = out.get(id);
      if (!prev || (prev.block ?? 0) <= e.block) out.set(id, v);
      pending = [];
    }
  }
  for (const e of events) {
    if (e.contract !== "SessionPay" || e.name !== "SessionOpened") continue;
    const id = String(e.args.sessionId);
    if (!out.has(id)) out.set(id, { sessionId: id, outcome: "pending", tx: null, block: null });
  }
  return out;
}

/**
 * La session dont parle le maillon « verdict » de la chaîne de preuves, parmi celles de l'enclave montrée :
 *  1. la plus récente dont le verdict est ÉCRIT, parmi les sessions qu'elle a servies (un règlement payé sur un reçu
 *     qu'elle a signé) : c'est la preuve, comme avant ;
 *  2. sinon, sa fermeture la plus récente sans verdict écrit : sautée (raison), sans objet (session close sans
 *     paiement : `unpaid`, sessions verrouillées sur cette enclave) ou aucun verdict ;
 *  3. sinon, la session du règlement montré, encore ouverte : « pending », le verdict s'écrit à sa fermeture ;
 *  4. sinon, null.
 */
export function proofVerdict(
  outcomes: ReadonlyMap<string, SessionVerdict>, served: ReadonlySet<string>, unpaid: ReadonlySet<string>, settleSession: string | null,
): SessionVerdict | null {
  const newest = (xs: SessionVerdict[]) => xs.sort((a, b) => (b.block ?? 0) - (a.block ?? 0))[0] ?? null;
  const mine = [...served, ...unpaid].map((id) => outcomes.get(id)).filter((v): v is SessionVerdict => !!v);
  const written = newest(mine.filter((v) => v.outcome === "written" && served.has(v.sessionId)));
  if (written) return written;
  const closed = newest(mine.filter((v) => v.tx !== null && v.outcome !== "pending"));
  if (closed) return closed;
  if (settleSession !== null) return outcomes.get(settleSession) ?? { sessionId: settleSession, outcome: "pending", tx: null, block: null };
  return null;
}

// ---------------------------------------------------------------- bloc de départ de l'index

/** Le bloc de départ de l'index : celui du déploiement (deployBlock) s'il est connu (> 0) ; sinon INDEX_FROM_BLOCK
 *  (entier décimal) ; sinon 0, c'est-à-dire toute la chaîne (lent : à éviter, d'où l'avertissement de server.ts). */
export function indexStartBlock(deployBlock: bigint | number | undefined | null, envValue?: string): { block: bigint; source: "deployment" | "env" | "genesis" } {
  const d = deployBlock === undefined || deployBlock === null ? 0n : BigInt(deployBlock);
  if (d > 0n) return { block: d, source: "deployment" };
  const v = (envValue ?? "").trim();
  if (/^\d{1,12}$/.test(v) && BigInt(v) > 0n) return { block: BigInt(v), source: "env" };
  return { block: 0n, source: "genesis" };
}
