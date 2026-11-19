/** arc.ts — console helpers for the ArcHive v2.1 stack on Arc testnet.
 *  - the deployment's reference products (1 = Private inference, 2 = Sealed bounty);
 *  - the verification label, which follows the deployment's attestation module ("dcap": verified by Arc) and the
 *    site's language (verifiedLabel, dcapGasLabel: functions, read at display time);
 *  - useVerifiedEnclave: an enclave's keys CHECKED against the chain (verifyEnclaveKeys) before any encryption.
 *    /pubkeys goes through the site's same-origin proxy: only the key registered on-chain counts;
 *  - waitOk / trackTxs: wait for a transaction, follow the transactions of a multi-step action;
 *  - closeOutcome: what became of the ERC-8004 verdict when a session closed (v2.1 stack: written, not applicable
 *    without a payment, or skipped), read from the events of its transaction. */
import { useEffect, useState } from "react";
import { decodeErrorResult, parseAbi, parseEventLogs, parseUnits, type Hex, type Log, type TransactionReceipt } from "viem";
import {
  createArcClient, testnet, arcErrorsAbi, DCAP_REGISTER_GAS_ESTIMATE,
  type ArcClient, type EnclaveKeyMismatchReason, type VerifiedEnclaveKeys,
} from "@arcvault/sdk";
import { explainError } from "./errors";
import { fmtNum, t, type StaticKey } from "./i18n";
import { MsgError, msg } from "./msg";

/** Reference products of the live stack (read on-chain): Private inference (SessionPay), Sealed bounty (SealedBounty). */
export const INFERENCE_PRODUCT: bigint = testnet.products?.inference ?? 1n;
export const BOUNTY_PRODUCT: bigint = testnet.products?.bounty ?? 2n;
/** v2.1: inference paid per call (X402Settler, x402 rail), product 3. */
export const X402_PRODUCT: bigint = testnet.products?.x402 ?? 3n;

/** The bounty at the VERIFIED level (product 7) runs the same code as SealedBounty on another contract
 *  (SealedBountyVerified): a level's client is the same client, with this contract in place of SealedBounty. */
export type BountyLevel = "open" | "verified";
export const VERIFIED_BOUNTY: string | null = testnet.levels?.sealedBountyVerified ?? null;
export function arcForLevel(arc: ArcClient, level: BountyLevel): ArcClient {
  if (level === "open" || !VERIFIED_BOUNTY) return arc;
  return createArcClient({ publicClient: arc.pub, walletClient: arc.wallet, account: arc.account, deployment: { ...arc.d, sealedBounty: VERIFIED_BOUNTY as Hex } });
}
/** The first SealedBountyVerified (deployments.v21.testnet.json, levels.superseded): the settlement contract of the
 *  former product #6, retired after a security fix and replaced by product #7. It is not a usable level (bountyLevelOf
 *  skips it, so no bounty is created there); it is only recognised as a bounty. */
export const SUPERSEDED_VERIFIED_BOUNTY = "0x242ca1c4d0a5a6fe5a806f215ca5f127422364d2";
/** the level of a product settled by a bounty (its settlement contract), otherwise null */
export function bountyLevelOf(settlement: string): BountyLevel | null {
  const s = settlement.toLowerCase();
  if (s === testnet.sealedBounty.toLowerCase()) return "open";
  if (VERIFIED_BOUNTY && s === VERIFIED_BOUNTY.toLowerCase()) return "verified";
  return null;
}

/** True if the registry itself verifies Intel's signature (DCAP): only then does the site write "verified". */
export const DCAP = testnet.attestation === "dcap";
/** "verified by Arc" / « vérifiée par Arc » (or "registered" without DCAP), in the current language. */
export const verifiedLabel = (): string => t(DCAP ? "arc.verified" : "arc.registered");
/** Gas of a registration through the real DCAP verifier, shown before signing ("≈ 5.7 M gas" / « ≈ 5,7 M gas »). */
export const dcapGasLabel = (): string => t("arc.gas", { m: fmtNum(Number(DCAP_REGISTER_GAS_ESTIMATE) / 1e6, { maximumFractionDigits: 1 }) });

/** A USDC amount typed by a person ("2", "0.5", "0,5") → base units (6 decimals), with a readable refusal (in the
 *  language current when it is displayed). `what`: the key of the amount's name ("what.deposit"…). */
export function parseUsdc(v: string, what: StaticKey = "what.amount"): bigint {
  const s = v.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new MsgError(msg("arc.badUsdc", { what: msg(what), v }));
  return parseUnits(s, 6);
}

/** A transaction mined but reverted: nothing changed on-chain. */
export class TxRevertedError extends MsgError {
  constructor(what: StaticKey, readonly hash: Hex) {
    super(msg("arc.reverted", { what: msg(what), hash }), "TxRevertedError");
  }
}

/** Waits for a transaction's confirmation; throws TxRevertedError if it reverts on-chain. Returns the receipt (events).
 *  `what`: the key of the awaited transaction ("tx.openSession"…). */
export async function waitOk(arc: ArcClient, hash: Hex, what: StaticKey = "tx.default"): Promise<TransactionReceipt> {
  const r = await arc.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new TxRevertedError(what, hash);
  return r;
}

/** The events of a session close that tell what became of its ERC-8004 verdict (VerdictLog.Recorded;
 *  v2.1: SessionPay.VerdictNotApplicable, a session closed without payment; SessionPay.VerdictSkipped, the write refused). */
const CLOSE_EVENTS = parseAbi([
  "event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag)",
  "event VerdictNotApplicable(uint256 indexed sessionId)",
  "event VerdictSkipped(bytes32 indexed requestHash, bytes reason)",
]);
const REASON_ABI = [...arcErrorsAbi, ...parseAbi(["error AlreadyRecorded()"])];

/** Why a verdict was skipped (revert data bounded to 132 bytes), in the current language: the named error if it is
 *  known ("Name(arguments)"); an empty or unreadable revert says what it is; unknown bytes are summarised by their
 *  selector and size (the full bytes stay in the transaction). The same sentence everywhere: link 6 of the Overview,
 *  the activity feed, closing a session. */
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

/** What became of the ERC-8004 verdict of the session closed by this transaction: "written" (VerdictLog wrote it),
 *  "not_applicable" (v2.1: no payment, nothing to attest), "skipped" (v2.1: the registry refused; `reasonData`: its
 *  bytes, put into words at display time by skipReason), "none" (none of these: a v2 contract without the event, or an
 *  operator struck off). */
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
 * The same client, whose wallet reports each transaction: "sign" when the SDK hands it to the wallet, "sent" once it has
 * left. Used to show the steps of a multi-transaction action (acceptAndDeliver), without changing anything the SDK sends.
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
 * Reads {enclaveUrl}/pubkeys and checks it against the EnclaveRegistry for this product (SDK verifyEnclaveKeys): the X25519
 * key must be the registered one and the enclave active at the head block. Rerun when the address or the product changes
 * (and on `recheck`). Reads only: no transaction, no signature.
 */
export function useVerifiedEnclave(arc: ArcClient | null, enclaveUrl: string, productId: string | bigint): [EnclaveCheck, () => void] {
  // the refusal is kept as is and put into words at display time: it follows the site's language without re-reading the chain
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
  }, [pub, url, pid, nonce]); // `arc` changes when the wallet connects; only its chain read (pub) matters here
  const shown: EnclaveCheck = check.state === "bad" ? { state: "bad", message: explainError(check.error), reason: check.reason } : check;
  return [shown, () => setNonce((n) => n + 1)];
}
