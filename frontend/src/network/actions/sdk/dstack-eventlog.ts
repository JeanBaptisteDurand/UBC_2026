/**
 * dstack-eventlog.ts — v2.1 : le journal RTMR3 d'une VM dstack (Phala) pour EnclaveRegistry.registerEnclave.
 *
 * Pourquoi : chez dstack, RTMR3 enregistre l'identifiant de l'INSTANCE de la VM (instance-id) ; l'empreinte complète
 * de la v2 (qui inclut RTMR3) change donc à chaque redémarrage. La v2.1 rejoue le journal RTMR3 sur la chaîne, exige
 * qu'il redonne le RTMR3 signé par Intel, et en lit compose-hash et os-image-hash : l'empreinte d'IMAGE qui en découle
 * ne dépend plus de l'instance (voir contracts/src/lib/DstackEventLog.sol, mêmes formules ici).
 *
 *   condensat V1 = SHA384(le32(0x08000001) ‖ ":" ‖ nom ‖ ":" ‖ charge)
 *   condensat V2 = SHA384({"name":nom,"payload":hex(charge),"type":134217729})   (JSON canonique RFC 8785)
 *   RTMR3 = 0^48, puis RTMR3 = SHA384(RTMR3 ‖ condensat) pour chaque événement de RTMR3, dans l'ordre
 *   empreinte d'image = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES)
 *
 * Encodage attendu par le registre : abi.encode(FORMAT_V1, (uint8 version, bytes name, bytes payload)[]).
 */
import { sha384 } from "@noble/hashes/sha512";
import {
  bytesToHex, concat, encodeAbiParameters, hexToBytes, isHex, keccak256, parseAbi, toBytes, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { parseTdxQuote, type TdxQuoteMeasurements } from "./quote";

/** Préfixe du format (premier mot de l'encodage), = DstackEventLog.FORMAT_V1. */
export const DSTACK_EVENTLOG_FORMAT_V1: Hex = keccak256(toBytes("archive.dstack.rtmr3-events.v1"));

export interface DstackRtmr3Event {
  version: 1 | 2;
  /** `event` du journal (ex. "compose-hash") */
  name: string;
  /** `event_payload`, décodé de l'hexadécimal */
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
 * Lit le journal brut renvoyé par /attest : les octets UTF-8 du JSON de dstack (le kit d'enclave les rend en
 * hexadécimal, parfois préfixés de "0x" dans le texte même), ou directement le texte JSON. Rend les événements de
 * RTMR3 dans l'ordre, ou null si le journal est vide, illisible, ou déjà au format FORMAT_V1.
 */
export function parseDstackEventLog(raw: Hex | string | undefined | null): DstackRtmr3Event[] | null {
  if (!raw || raw === "0x") return null;
  let text = raw;
  if (isHex(raw, { strict: true })) {
    if (raw.toLowerCase().startsWith(DSTACK_EVENTLOG_FORMAT_V1.toLowerCase())) return null; // déjà encodé
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

/** abi.encode(FORMAT_V1, events) : le paramètre `eventLog` de registerEnclave en v2.1. */
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
  if (/["\\\u0000-\u001f]/.test(e.name)) throw new Error(`nom d'événement V2 à échapper, refusé par le registre : ${JSON.stringify(e.name)}`);
  return toBytes(`{"name":"${e.name}","payload":"${bytesToHex(payload).slice(2)}","type":134217729}`);
}

export interface DstackReplay {
  /** RTMR3 rejoué (48 octets) : doit être celui du quote */
  rtmr3: Hex;
  /** compose-hash et os-image-hash lus sans ambiguïté AVANT « system-ready » (règle du registre) */
  imageKnown: boolean;
  composeHash: Hex | null;
  osImageHash: Hex | null;
}

/** Rejoue les événements de RTMR3 exactement comme DstackEventLog.replay. */
export function replayDstackRtmr3(events: DstackRtmr3Event[]): DstackReplay {
  let rtmr: Uint8Array = new Uint8Array(48);
  let ready = false;
  let nCompose = 0;
  let nOs = 0;
  let compose: Hex | null = null;
  let os: Hex | null = null;
  for (const e of events) {
    rtmr = sha384(concat([rtmr, sha384(preimage(e))]));
    if (ready) continue; // après « system-ready » : rejoué, jamais interprété
    const size = (e.payload.length - 2) / 2;
    if (e.name === "system-ready") ready = true;
    else if (e.name === "compose-hash") { nCompose++; if (size === 32) compose = e.payload; else nCompose = 2; }
    else if (e.name === "os-image-hash") { nOs++; if (size === 32) os = e.payload; else nOs = 2; }
  }
  const imageKnown = ready && nCompose === 1 && nOs === 1;
  return { rtmr3: bytesToHex(rtmr), imageKnown, composeHash: imageKnown ? compose : null, osImageHash: imageKnown ? os : null };
}

/** L'empreinte d'IMAGE (v2.1), = EnclaveRegistry.imageIdOf : sans RTMR3 ni MRCONFIGID, donc stable d'un redémarrage à l'autre. */
export function dstackImageId(m: Pick<TdxQuoteMeasurements, "mrtd" | "rtmr0" | "rtmr1" | "rtmr2" | "xfam" | "tdAttributes">, composeHash: Hex, osImageHash: Hex): Hex {
  return keccak256(concat([m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, composeHash, osImageHash, m.xfam, m.tdAttributes]));
}

export interface DstackImage {
  /** journal encodé pour registerEnclave (FORMAT_V1), ou null si le journal brut est absent ou illisible */
  eventLog: Hex | null;
  /** le rejeu redonne le RTMR3 du quote */
  rtmr3Matches: boolean;
  imageKnown: boolean;
  composeHash: Hex | null;
  osImageHash: Hex | null;
  /** empreinte d'image, si le rejeu concorde et que l'image est connue */
  imageId: Hex | null;
  /** empreinte complète de la v2 (inclut RTMR3, donc l'instance) */
  workloadId: Hex;
}

/** Tout en un, à partir de ce que rend /attest : quote + journal brut. Rien n'est vérifié ici de la signature d'Intel. */
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
/** Sélecteur de replayEventLog(bytes) : présent dans le code d'un registre v2.1, absent d'un registre v2. */
const REPLAY_SELECTOR = "fb7be405";

export interface RegistrationLogPlan {
  /** le paramètre `eventLog` à passer à registerEnclave */
  eventLog: Hex;
  /** ce qui admettra l'enclave : son empreinte d'IMAGE (v2.1), son empreinte complète (v2), ou rien (refus prévisible) */
  admittedBy: "image" | "workload" | null;
  /** le registre sait rejouer le journal RTMR3 (v2.1) */
  v21: boolean;
  imageId: Hex | null;
  workloadId: Hex;
  composeHash: Hex | null;
  osImageHash: Hex | null;
  /** pourquoi l'empreinte d'image n'est pas utilisable, le cas échéant */
  note?: string;
}

/**
 * Choisit, AVANT d'envoyer une inscription (≈ 5,7 à 7 M gas), le journal à transmettre et l'empreinte qui admettra
 * l'enclave. Sur un registre v2.1 dont le produit autorise l'empreinte d'IMAGE : journal encodé (FORMAT_V1), rejoué
 * aussi par le registre (lecture), qui doit redonner le RTMR3 du quote. Sinon : journal brut, empreinte complète (v2).
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
    if (!img.eventLog) note = "journal RTMR3 absent ou illisible dans /attest";
    else if (!img.rtmr3Matches) note = "le journal RTMR3 ne redonne pas le RTMR3 du quote";
    else if (!img.imageId) note = "image non reconnue dans le journal (compose-hash ou os-image-hash manquant ou ambigu)";
    else {
      const [rtmr3, known, compose, os] = await pub.readContract({ address: q.registry, abi: V21_ABI, functionName: "replayEventLog", args: [img.eventLog] });
      const m = parseTdxQuote(q.quote);
      const onchain = await pub.readContract({
        address: q.registry, abi: V21_ABI, functionName: "imageIdOf",
        args: [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, img.composeHash!, img.osImageHash!, m.xfam, m.tdAttributes],
      });
      if (rtmr3.toLowerCase() !== m.rtmr3.toLowerCase() || !known || compose.toLowerCase() !== img.composeHash!.toLowerCase()
        || os.toLowerCase() !== img.osImageHash!.toLowerCase() || onchain.toLowerCase() !== img.imageId.toLowerCase()) {
        note = "le rejeu du registre diffère du rejeu local : journal non transmis";
      } else if (await allowed(img.imageId)) {
        return { ...base, eventLog: img.eventLog, admittedBy: "image" };
      } else note = `l'empreinte d'image ${img.imageId} n'est pas autorisée par le produit`;
    }
  }
  return { ...base, eventLog: raw, admittedBy: (await allowed(img.workloadId)) ? "workload" : null, note };
}
