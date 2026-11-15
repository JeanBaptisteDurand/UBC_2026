/** arc.ts — aides du site pour la pile v2 d'Arc testnet.
 *  - les produits de référence du déploiement (1 = Inférence privée, 2 = Prime scellée) ;
 *  - le libellé de vérification, qui suit le module d'attestation du déploiement (« dcap » : vérifiée par Arc) et la
 *    langue du site (verifiedLabel, dcapGasLabel : des fonctions, lues au moment de l'affichage) ;
 *  - useVerifiedEnclave : les clés d'une enclave CONFRONTÉES à la chaîne (verifyEnclaveKeys) avant tout chiffrement.
 *    /pubkeys passe par le mandataire de même origine du site : seule la clé inscrite on-chain fait foi ;
 *  - waitOk / trackTxs : attendre une transaction, suivre les transactions d'une action en plusieurs temps ;
 *  - closeOutcome : ce qu'est devenu le verdict ERC-8004 à la fermeture d'une session (pile v2.1 : écrit, sans objet
 *    faute de paiement, ou sauté), lu dans les événements de sa transaction. */
import { useEffect, useState } from "react";
import { decodeErrorResult, parseAbi, parseEventLogs, parseUnits, type Hex, type Log, type TransactionReceipt } from "viem";
import {
  createArcClient, testnet, arcErrorsAbi, DCAP_REGISTER_GAS_ESTIMATE,
  type ArcClient, type EnclaveKeyMismatchReason, type VerifiedEnclaveKeys,
} from "@arcvault/sdk";
import { explainError } from "./errors";
import { fmtNum, t, type StaticKey } from "./i18n";
import { MsgError, msg } from "./msg";

/** Produits de référence de la pile v2 (lus on-chain le 7/11) : Inférence privée (SessionPay), Prime scellée (SealedBounty). */
export const INFERENCE_PRODUCT: bigint = testnet.products?.inference ?? 1n;
export const BOUNTY_PRODUCT: bigint = testnet.products?.bounty ?? 2n;
/** v2.1 : l'inférence payée à l'appel (X402Settler, rail x402), produit 3. */
export const X402_PRODUCT: bigint = testnet.products?.x402 ?? 3n;

/** Vrai si le registre vérifie lui-même la signature d'Intel (DCAP) : seulement alors on écrit « vérifiée ». */
export const DCAP = testnet.attestation === "dcap";
/** « verified by Arc » / « vérifiée par Arc » (ou « inscrite » sans DCAP), dans la langue du moment. */
export const verifiedLabel = (): string => t(DCAP ? "arc.verified" : "arc.registered");
/** Gaz d'une inscription par le vrai DCAP, pour prévenir avant la signature (« ≈ 5.7 M gas » / « ≈ 5,7 M gas »). */
export const dcapGasLabel = (): string => t("arc.gas", { m: fmtNum(Number(DCAP_REGISTER_GAS_ESTIMATE) / 1e6, { maximumFractionDigits: 1 }) });

/** Montant en USDC saisi par un humain (« 2 », « 0.5 », « 0,5 ») → unités de base (6 décimales), avec un refus lisible
 *  (dans la langue du moment de son affichage). `what` : la clé du nom du montant ("what.deposit"…). */
export function parseUsdc(v: string, what: StaticKey = "what.amount"): bigint {
  const s = v.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new MsgError(msg("arc.badUsdc", { what: msg(what), v }));
  return parseUnits(s, 6);
}

/** Transaction minée mais annulée (revert) : rien n'a changé on-chain. */
export class TxRevertedError extends MsgError {
  constructor(what: StaticKey, readonly hash: Hex) {
    super(msg("arc.reverted", { what: msg(what), hash }), "TxRevertedError");
  }
}

/** Attend la confirmation d'une transaction ; lève TxRevertedError si elle est annulée on-chain. Rend le reçu (événements).
 *  `what` : la clé de la transaction attendue ("tx.openSession"…). */
export async function waitOk(arc: ArcClient, hash: Hex, what: StaticKey = "tx.default"): Promise<TransactionReceipt> {
  const r = await arc.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new TxRevertedError(what, hash);
  return r;
}

/** Les événements d'une fermeture de session qui disent ce qu'est devenu son verdict ERC-8004 (VerdictLog.Recorded ;
 *  v2.1 : SessionPay.VerdictNotApplicable, session close sans paiement ; SessionPay.VerdictSkipped, écriture refusée). */
const CLOSE_EVENTS = parseAbi([
  "event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag)",
  "event VerdictNotApplicable(uint256 indexed sessionId)",
  "event VerdictSkipped(bytes32 indexed requestHash, bytes reason)",
]);
const REASON_ABI = [...arcErrorsAbi, ...parseAbi(["error AlreadyRecorded()"])];

/** La raison d'un verdict sauté (données de revert bornées à 132 octets), dans la langue du moment : l'erreur nommée si
 *  elle est connue (« Nom(arguments) ») ; un revert vide ou illisible dit ce qu'il est ; des octets inconnus sont
 *  résumés par leur sélecteur et leur taille (les octets entiers restent dans la transaction). Même phrase partout :
 *  maillon 6 de la Vue d'ensemble, activité, fermeture d'une session. */
export function skipReason(data: unknown): string {
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return t("reason.unreadable");
  if (data === "0x") return t("reason.empty");
  try {
    const d = decodeErrorResult({ abi: REASON_ABI as any, data: data as Hex });
    return `${d.errorName}(${(d.args ?? []).map((x: unknown) => String(x)).join(", ")})`;
  } catch {
    return t("reason.unknown", { selector: data.slice(0, 10), n: (data.length - 2) / 2 });
  }
}

/** Ce qu'est devenu le verdict ERC-8004 de la session fermée par cette transaction : « written » (VerdictLog l'a écrit),
 *  « not_applicable » (v2.1 : aucun paiement, rien à attester), « skipped » (v2.1 : le registre a refusé ; `reasonData` :
 *  ses octets, mis en mots à l'affichage par skipReason), « none » (rien de tout cela : pile v2 sans événement, ou
 *  opérateur radié). */
export function closeOutcome(logs: readonly Log[]): { outcome: "written" | "not_applicable" | "skipped" | "none"; reasonData?: Hex } {
  const at = (a: string) => (l: Log) => l.address.toLowerCase() === a.toLowerCase();
  const pay = parseEventLogs({ abi: CLOSE_EVENTS, logs: logs.filter(at(testnet.sessionPay)) as Log[] });
  const log = parseEventLogs({ abi: CLOSE_EVENTS, logs: logs.filter(at(testnet.verdictLog)) as Log[] });
  if (pay.some((e) => e.eventName === "VerdictNotApplicable")) return { outcome: "not_applicable" };
  if (log.some((e) => e.eventName === "Recorded")) return { outcome: "written" };
  const skip = pay.find((e) => e.eventName === "VerdictSkipped");
  if (skip && skip.eventName === "VerdictSkipped") return { outcome: "skipped", reasonData: skip.args.reason };
  return { outcome: "none" };
}

export type TxEvent = { fn: string; phase: "sign" | "sent"; hash?: Hex };

/**
 * Le même client, dont le wallet signale chaque transaction : « sign » quand le SDK la soumet au wallet, « sent » quand
 * elle est partie. Sert à afficher les étapes d'une action en plusieurs transactions (acceptAndDeliver), sans rien
 * changer à ce que le SDK envoie.
 */
export function trackTxs(arc: ArcClient, on: (e: TxEvent) => void): ArcClient {
  const w = arc.wallet;
  if (!w) return arc;
  const wallet = new Proxy(w, {
    get(target, prop, receiver) {
      if (prop !== "writeContract") return Reflect.get(target, prop, receiver);
      return async (req: any) => {
        const fn = String(req?.functionName ?? "transaction");
        on({ fn, phase: "sign" });
        const hash = (await (target as any).writeContract(req)) as Hex;
        on({ fn, phase: "sent", hash });
        return hash;
      };
    },
  });
  return createArcClient({ publicClient: arc.pub, walletClient: wallet, account: arc.account, deployment: arc.d });
}

export type EnclaveCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; keys: VerifiedEnclaveKeys }
  | { state: "bad"; message: string; reason?: EnclaveKeyMismatchReason };
type RawCheck = Exclude<EnclaveCheck, { state: "bad" }> | { state: "bad"; error: unknown; reason?: EnclaveKeyMismatchReason };

/**
 * Lit {enclaveUrl}/pubkeys et le confronte à l'EnclaveRegistry pour ce produit (SDK verifyEnclaveKeys) : clé X25519
 * = celle inscrite, enclave active au bloc de tête. Refait quand l'adresse ou le produit change (et sur `recheck`).
 * Lectures seulement : aucune transaction, aucune signature.
 */
export function useVerifiedEnclave(arc: ArcClient | null, enclaveUrl: string, productId: string | bigint): [EnclaveCheck, () => void] {
  // le refus est gardé tel quel et mis en phrase à l'affichage : il suit la langue du site sans relire la chaîne
  const [check, setCheck] = useState<RawCheck>({ state: "idle" });
  const [nonce, setNonce] = useState(0);
  const url = enclaveUrl.trim();
  const pid = typeof productId === "bigint" ? productId.toString() : productId.trim();
  const pub = arc?.pub;
  useEffect(() => {
    if (!arc || !/^https?:\/\/\S+$/.test(url) || !/^\d+$/.test(pid)) { setCheck({ state: "idle" }); return; }
    let alive = true;
    setCheck({ state: "checking" });
    const timer = setTimeout(() => {
      arc.verifyEnclaveKeys(url, BigInt(pid))
        .then((keys) => { if (alive) setCheck({ state: "ok", keys }); })
        .catch((e: any) => { if (alive) setCheck({ state: "bad", error: e, reason: e?.reason }); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [pub, url, pid, nonce]); // `arc` change quand le wallet se connecte ; seule sa lecture de la chaîne (pub) compte ici
  const shown: EnclaveCheck = check.state === "bad" ? { state: "bad", message: explainError(check.error), reason: check.reason } : check;
  return [shown, () => setNonce((n) => n + 1)];
}
