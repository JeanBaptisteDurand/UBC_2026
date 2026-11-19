/** quote.ts — lecture hors chaîne d'un quote Intel TDX (v4 ou v5) : les mesures que l'EnclaveRegistry exigera, pour
 *  savoir AVANT d'envoyer une inscription (≈ 5,7 M gas par le vrai DCAP) si elle passera la politique :
 *  image autorisée (workloadId, P5), DEBUG à 0 (P3), SEPT_VE_DISABLE (P4), liaison REPORTDATA (P6/P7).
 *  Rien ici ne VÉRIFIE la signature d'Intel : c'est le rôle du contrat (TdxAttestationModule → DCAP d'Automata). */
import { type Address, type Hex, concat, encodeAbiParameters, keccak256, size, slice, toBytes } from "viem";

export interface TdxQuoteMeasurements {
  version: number; // 4 ou 5
  bodyType: number; // 2 = TD1.0, 3 = TD1.5
  tdAttributes: Hex; // 8 octets
  xfam: Hex; // 8 octets
  mrtd: Hex; // 48 octets
  mrConfigId: Hex;
  rtmr0: Hex;
  rtmr1: Hex;
  rtmr2: Hex;
  rtmr3: Hex;
  reportData: Hex; // 64 octets
  /** keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES) : le calcul d'EnclaveRegistry._workloadId. */
  workloadId: Hex;
  /** bit DEBUG de tdAttributes (bit 0 de l'octet 0) : une enclave en DEBUG est refusée (DebugEnclave). */
  debug: boolean;
  /** bit 28 SEPT_VE_DISABLE (bit 4 de l'octet 3) : exigé par la pile v2 de testnet (requireSeptVeDisable). */
  septVeDisabled: boolean;
}

const HEADER = 48;
const BODY = { tdAttributes: 120, xfam: 128, mrtd: 136, mrConfigId: 184, rtmr0: 328, rtmr1: 376, rtmr2: 424, rtmr3: 472, reportData: 520 };

/** Découpe le corps TD d'un quote brut (même décalages que TdxAttestationModule ; v5 : descripteur de 6 octets). */
export function parseTdxQuote(quote: Hex): TdxQuoteMeasurements {
  const b = toBytes(quote);
  if (b.length < HEADER + 584) throw new Error(`quote TDX trop court (${b.length} octets)`);
  const version = b[0]! | (b[1]! << 8);
  const teeType = b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24);
  if (teeType !== 0x81) throw new Error(`quote non TDX (type de TEE 0x${teeType.toString(16)})`);
  let start = HEADER;
  let bodyType = 2;
  if (version === 5) {
    bodyType = b[48]! | (b[49]! << 8);
    start = HEADER + 6;
  } else if (version !== 4) {
    throw new Error(`version de quote ${version} non prise en charge (4 ou 5)`);
  }
  if (bodyType !== 2 && bodyType !== 3) throw new Error(`corps de quote de type ${bodyType} : TD1.0 (2) ou TD1.5 (3) attendu`);
  const at = (off: number, len: number) => slice(quote, start + off, start + off + len);
  const m = {
    tdAttributes: at(BODY.tdAttributes, 8), xfam: at(BODY.xfam, 8), mrtd: at(BODY.mrtd, 48), mrConfigId: at(BODY.mrConfigId, 48),
    rtmr0: at(BODY.rtmr0, 48), rtmr1: at(BODY.rtmr1, 48), rtmr2: at(BODY.rtmr2, 48), rtmr3: at(BODY.rtmr3, 48),
    reportData: at(BODY.reportData, 64),
  };
  const attr = toBytes(m.tdAttributes);
  return {
    version, bodyType, ...m,
    workloadId: keccak256(concat([m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes])),
    debug: (attr[0]! & 0x01) !== 0,
    septVeDisabled: (attr[3]! & 0x10) !== 0,
  };
}

/** L'empreinte de l'image (workloadId) d'un quote : la valeur que l'auteur d'un produit autorise (ProposeParams.workloadIds,
 *  ou proposeWorkload → applyWorkload). */
export function workloadIdFromQuote(quote: Hex): Hex {
  return parseTdxQuote(quote).workloadId;
}

/** REPORTDATA[0:32] attendu par EnclaveRegistry (P6) : la liaison chaîne, registre, produit, opérateur, clés. */
export function expectedReportData0(b: {
  chainId: number | bigint; registry: Address; productId: bigint; operator: Address; signer: Address; x25519: Hex;
}): Hex {
  if (size(b.x25519) !== 32) throw new Error("x25519 : 32 octets attendus");
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      ["ARC-ENCLAVE-v1", BigInt(b.chainId), b.registry, b.productId, b.operator, b.signer, b.x25519],
    ),
  );
}
