/** quote.ts — off-chain reading of an Intel TDX quote (v4 or v5): the measurements EnclaveRegistry will require, to
 *  know BEFORE sending a registration (millions of gas through the real DCAP verification) whether it meets the policy:
 *  an allowed image (workloadId, P5), DEBUG at 0 (P3), SEPT_VE_DISABLE (P4), the REPORTDATA binding (P6/P7).
 *  Nothing here VERIFIES Intel's signature: that is the contract's job (TdxAttestationModule → Automata's DCAP). */
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
  /** keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES): the computation of EnclaveRegistry._workloadId. */
  workloadId: Hex;
  /** DEBUG bit of tdAttributes (bit 0 of byte 0): an enclave in DEBUG is refused (DebugEnclave). */
  debug: boolean;
  /** bit 28 SEPT_VE_DISABLE (bit 4 of byte 3): required by the registry by default (requireSeptVeDisable). */
  septVeDisabled: boolean;
}

const HEADER = 48;
const BODY = { tdAttributes: 120, xfam: 128, mrtd: 136, mrConfigId: 184, rtmr0: 328, rtmr1: 376, rtmr2: 424, rtmr3: 472, reportData: 520 };

/** Cuts the TD body out of a raw quote (same offsets as TdxAttestationModule; v5: a 6-byte descriptor). */
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
    throw new Error(`quote version ${version} not supported (4 or 5)`);
  }
  if (bodyType !== 2 && bodyType !== 3) throw new Error(`quote body of type ${bodyType}: TD1.0 (2) or TD1.5 (3) expected`);
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

/** The image fingerprint (workloadId) of a quote: the value a product's author allows (ProposeParams.workloadIds,
 *  or proposeWorkload → applyWorkload). */
export function workloadIdFromQuote(quote: Hex): Hex {
  return parseTdxQuote(quote).workloadId;
}

/** REPORTDATA[0:32] expected by EnclaveRegistry (P6): the binding of chain, registry, product, operator and keys. */
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
