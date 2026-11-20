/**
 * dstack-eventlog.ts — the RTMR3 event log of a dstack VM (Phala) for EnclaveRegistry.registerEnclave (v2.1 registry).
 *
 * Why: on dstack, RTMR3 records the VM's INSTANCE id (instance-id), so the full v2 workload id (which includes RTMR3)
 * changes at every restart. The v2.1 registry replays the RTMR3 event log on-chain, requires it to give back the RTMR3
 * signed by Intel, and reads compose-hash and os-image-hash from it: the resulting IMAGE id no longer depends on the
 * instance (see contracts/src/lib/DstackEventLog.sol; the same formulas are used here).
 *
 *   digest V1 = SHA384(le32(0x08000001) ‖ ":" ‖ name ‖ ":" ‖ payload)
 *   digest V2 = SHA384({"name":name,"payload":hex(payload),"type":134217729})   (RFC 8785 canonical JSON)
 *   RTMR3 = 0^48, then RTMR3 = SHA384(RTMR3 ‖ digest) for each RTMR3 event, in order
 *   image id = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES)
 *
 * Encoding the registry expects: abi.encode(FORMAT_V1, (uint8 version, bytes name, bytes payload)[]).
 */
import { sha384 } from "@noble/hashes/sha512";
import {
  bytesToHex, concat, encodeAbiParameters, hexToBytes, isHex, keccak256, parseAbi, toBytes, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { parseTdxQuote, type TdxQuoteMeasurements } from "./quote";

/** Format prefix (first word of the encoding), = DstackEventLog.FORMAT_V1. */
export const DSTACK_EVENTLOG_FORMAT_V1: Hex = keccak256(toBytes("archive.dstack.rtmr3-events.v1"));

export interface DstackRtmr3Event {
  version: 1 | 2;
  /** `event` du journal (ex. "compose-hash") */
  name: string;
  /** `event_payload`, decoded from hex */
  payload: Hex;
}

const EVENT_TUPLE = [
  { type: "bytes32" },
  { type: "tuple[]", components: [{ name: "version", type: "uint8" }, { name: "name", type: "bytes" }, { name: "payload", type: "bytes" }] },
] as const;

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Reads the raw log returned by /attest: the UTF-8 bytes of dstack's JSON (the enclave kit returns them as hex,
 * sometimes prefixed with "0x" inside the text itself), or the JSON text directly. Returns the RTMR3 events in order,
 * or null if the log is empty, unreadable, or already in FORMAT_V1.
 */
export function parseDstackEventLog(raw: Hex | string | undefined | null): DstackRtmr3Event[] | null {
  if (!raw || raw === "0x") return null;
  let text = raw;
  if (isHex(raw, { strict: true })) {
    if (raw.toLowerCase().startsWith(DSTACK_EVENTLOG_FORMAT_V1.toLowerCase())) return null; // already encoded
    text = utf8(hexToBytes(raw));
  }
  text = text.trim();
  if (text.startsWith("0x[") || text.startsWith("0x{")) text = text.slice(2);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { events?: unknown })?.events) ? (parsed as { events: unknown[] }).events : null;
  if (!list) return null;
  const out: DstackRtmr3Event[] = [];
  for (const e of list as Array<Record<string, unknown>>) {
    if (!e || Number(e.imr) !== 3) continue;
    const name = typeof e.event === "string" ? e.event : "";
    const hex = typeof e.event_payload === "string" ? e.event_payload.replace(/^0x/, "") : "";
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
    out.push({ version: Number(e.version) === 2 ? 2 : 1, name, payload: (`0x${hex.toLowerCase()}`) as Hex });
  }
  return out.length ? out : null;
}

/** abi.encode(FORMAT_V1, events): the `eventLog` parameter of registerEnclave on a v2.1 registry. */
export function encodeDstackEventLog(events: DstackRtmr3Event[]): Hex {
  return encodeAbiParameters(EVENT_TUPLE, [
    DSTACK_EVENTLOG_FORMAT_V1,
    events.map((e) => ({ version: e.version, name: toHex(toBytes(e.name)), payload: e.payload })),
  ]);
}

function preimage(e: DstackRtmr3Event): Uint8Array {
  const payload = hexToBytes(e.payload);
  if (e.version === 1) {
    return concat([Uint8Array.from([0x01, 0x00, 0x00, 0x08]), toBytes(":"), toBytes(e.name), toBytes(":"), payload]);
  }
  if (/["\\\u0000-\u001f]/.test(e.name)) throw new Error(`V2 event name that needs escaping, refused by the registry: ${JSON.stringify(e.name)}`);
  return toBytes(`{"name":"${e.name}","payload":"${bytesToHex(payload).slice(2)}","type":134217729}`);
}

export interface DstackReplay {
  /** replayed RTMR3 (48 bytes): must be the quote's */
  rtmr3: Hex;
  /** compose-hash and os-image-hash read unambiguously BEFORE "system-ready" (the registry's rule) */
  imageKnown: boolean;
  composeHash: Hex | null;
  osImageHash: Hex | null;
}

/** Replays the RTMR3 events exactly as DstackEventLog.replay does. */
export function replayDstackRtmr3(events: DstackRtmr3Event[]): DstackReplay {
  let rtmr: Uint8Array = new Uint8Array(48);
  let ready = false;
  let nCompose = 0;
  let nOs = 0;
  let compose: Hex | null = null;
  let os: Hex | null = null;
  for (const e of events) {
    rtmr = sha384(concat([rtmr, sha384(preimage(e))]));
    if (ready) continue; // after "system-ready": replayed, never interpreted
    const size = (e.payload.length - 2) / 2;
    if (e.name === "system-ready") ready = true;
    else if (e.name === "compose-hash") { nCompose++; if (size === 32) compose = e.payload; else nCompose = 2; }
    else if (e.name === "os-image-hash") { nOs++; if (size === 32) os = e.payload; else nOs = 2; }
  }
  const imageKnown = ready && nCompose === 1 && nOs === 1;
  return { rtmr3: bytesToHex(rtmr), imageKnown, composeHash: imageKnown ? compose : null, osImageHash: imageKnown ? os : null };
}

/** The IMAGE id (v2.1), = EnclaveRegistry.imageIdOf: without RTMR3 or MRCONFIGID, so stable across restarts. */
export function dstackImageId(m: Pick<TdxQuoteMeasurements, "mrtd" | "rtmr0" | "rtmr1" | "rtmr2" | "xfam" | "tdAttributes">, composeHash: Hex, osImageHash: Hex): Hex {
  return keccak256(concat([m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, composeHash, osImageHash, m.xfam, m.tdAttributes]));
}

export interface DstackImage {
  /** the log encoded for registerEnclave (FORMAT_V1), or null if the raw log is missing or unreadable */
  eventLog: Hex | null;
  /** the replay gives back the quote's RTMR3 */
  rtmr3Matches: boolean;
  imageKnown: boolean;
  composeHash: Hex | null;
  osImageHash: Hex | null;
  /** image id, if the replay matches and the image is known */
  imageId: Hex | null;
  /** the full v2 workload id (includes RTMR3, hence the instance) */
  workloadId: Hex;
}

/** All in one, from what /attest returns: quote + raw log. Nothing here verifies Intel's signature. */
export function dstackImageFromAttest(quote: Hex, rawEventLog: Hex | string | undefined | null): DstackImage {
  const m = parseTdxQuote(quote);
  const events = parseDstackEventLog(rawEventLog);
  if (!events) return { eventLog: null, rtmr3Matches: false, imageKnown: false, composeHash: null, osImageHash: null, imageId: null, workloadId: m.workloadId };
  const r = replayDstackRtmr3(events);
  const rtmr3Matches = r.rtmr3.toLowerCase() === m.rtmr3.toLowerCase();
  const imageId = rtmr3Matches && r.imageKnown && r.composeHash && r.osImageHash ? dstackImageId(m, r.composeHash, r.osImageHash) : null;
  return { eventLog: encodeDstackEventLog(events), rtmr3Matches, imageKnown: r.imageKnown, composeHash: r.composeHash, osImageHash: r.osImageHash, imageId, workloadId: m.workloadId };
}

const V21_ABI = parseAbi([
  "function replayEventLog(bytes eventLog) pure returns (bytes rtmr3, bool imageKnown, bytes32 composeHash, bytes32 osImageHash)",
  "function imageIdOf(bytes mrtd, bytes rtmr0, bytes rtmr1, bytes rtmr2, bytes32 composeHash, bytes32 osImageHash, bytes8 xfam, bytes8 tdAttributes) pure returns (bytes32)",
]);
const ALLOWED_ABI = parseAbi(["function isWorkloadAllowed(uint256 productId, bytes32 workloadId) view returns (bool)"]);
/** Selector of replayEventLog(bytes): present in a v2.1 registry's code, absent from a v2 registry. */
const REPLAY_SELECTOR = "fb7be405";

export interface RegistrationLogPlan {
  /** the `eventLog` parameter to pass to registerEnclave */
  eventLog: Hex;
  /** what will admit the enclave: its IMAGE id (v2.1), its full workload id (v2), or nothing (a foreseeable refusal) */
  admittedBy: "image" | "workload" | null;
  /** the registry can replay the RTMR3 log (v2.1) */
  v21: boolean;
  imageId: Hex | null;
  workloadId: Hex;
  composeHash: Hex | null;
  osImageHash: Hex | null;
  /** why the image id cannot be used, if that is the case */
  note?: string;
}

/**
 * Chooses, BEFORE a registration is sent (≈ 5.7 to 7 M gas), the log to pass and the id that will admit the enclave.
 * On a v2.1 registry whose product allows the IMAGE id: the encoded log (FORMAT_V1), also replayed by the registry (a
 * read), which must give back the quote's RTMR3. Otherwise: the raw log and the full workload id (v2).
 */
export async function planRegistrationLog(
  pub: PublicClient,
  q: { registry: Address; productRegistry: Address; productId: bigint; quote: Hex; rawEventLog?: Hex | string | null },
): Promise<RegistrationLogPlan> {
  const img = dstackImageFromAttest(q.quote, q.rawEventLog);
  const raw = (q.rawEventLog && isHex(q.rawEventLog) ? q.rawEventLog : "0x") as Hex;
  const allowed = (id: Hex) => pub.readContract({ address: q.productRegistry, abi: ALLOWED_ABI, functionName: "isWorkloadAllowed", args: [q.productId, id] });
  const code = await pub.getCode({ address: q.registry });
  const v21 = !!code && code.toLowerCase().includes(REPLAY_SELECTOR);
  const base = { v21, imageId: img.imageId, workloadId: img.workloadId, composeHash: img.composeHash, osImageHash: img.osImageHash };
  let note: string | undefined;
  if (v21) {
    if (!img.eventLog) note = "RTMR3 event log missing or unreadable in /attest";
    else if (!img.rtmr3Matches) note = "the RTMR3 event log does not give back the quote's RTMR3";
    else if (!img.imageId) note = "image not recognized in the log (compose-hash or os-image-hash missing or ambiguous)";
    else {
      const [rtmr3, known, compose, os] = await pub.readContract({ address: q.registry, abi: V21_ABI, functionName: "replayEventLog", args: [img.eventLog] });
      const m = parseTdxQuote(q.quote);
      const onchain = await pub.readContract({
        address: q.registry, abi: V21_ABI, functionName: "imageIdOf",
        args: [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, img.composeHash!, img.osImageHash!, m.xfam, m.tdAttributes],
      });
      if (rtmr3.toLowerCase() !== m.rtmr3.toLowerCase() || !known || compose.toLowerCase() !== img.composeHash!.toLowerCase()
        || os.toLowerCase() !== img.osImageHash!.toLowerCase() || onchain.toLowerCase() !== img.imageId.toLowerCase()) {
        note = "the registry's replay differs from the local replay: log not passed";
      } else if (await allowed(img.imageId)) {
        return { ...base, eventLog: img.eventLog, admittedBy: "image" };
      } else note = `image id ${img.imageId} is not allowed by the product`;
    }
  }
  return { ...base, eventLog: raw, admittedBy: (await allowed(img.workloadId)) ? "workload" : null, note };
}
