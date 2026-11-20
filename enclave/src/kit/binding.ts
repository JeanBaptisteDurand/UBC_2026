/**
 * binding.ts — the computations that BIND the enclave to the chain.
 *
 * These functions must produce exactly the same bytes as the contracts:
 *  - REPORTDATA[0:32] = keccak256(abi.encode("ARC-ENCLAVE-v1", chainId, registry, productId,
 *                                            operator, signer, x25519))   (EnclaveRegistry P6)
 *  - REPORTDATA[32:64] = hash of the anchor block R                        (EnclaveRegistry P7)
 *  - workloadId = keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES)  (P5)
 *
 * Any divergence here means the attestation is rejected on-chain. This is the most sensitive integration point;
 * tests cross-checked with `cast` lock it (see test/kit.test.ts).
 */
import {
  keccak256,
  encodeAbiParameters,
  encodePacked,
  concat,
  type Hex,
  type Address,
} from "viem";

export const REPORTDATA_TAG = "ARC-ENCLAVE-v1";

export interface ReportDataBinding {
  chainId: bigint;
  registry: Address;
  productId: bigint;
  operator: Address;
  signer: Address;
  x25519: Hex; // 32 octets
}

/** REPORTDATA[0:32]: binds the chain, the registry, the product, the operator and the two keys. */
export function computeReportData0(b: ReportDataBinding): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [REPORTDATA_TAG, b.chainId, b.registry, b.productId, b.operator, b.signer, b.x25519],
    ),
  );
}

/** The full REPORTDATA (64 bytes) = rd0 ‖ hash of the anchor block. */
export function buildReportData(b: ReportDataBinding, anchorBlockHash: Hex): Hex {
  return concat([computeReportData0(b), anchorBlockHash]);
}

export interface Measurements {
  mrtd: Hex; // 48 octets
  rtmr0: Hex;
  rtmr1: Hex;
  rtmr2: Hex;
  rtmr3: Hex;
  mrConfigId: Hex;
  xfam: Hex; // 8 octets
  tdAttributes: Hex; // 8 octets
}

/** workloadId: the image fingerprint, identical to EnclaveRegistry._workloadId. */
export function computeWorkloadId(m: Measurements): Hex {
  return keccak256(
    encodePacked(
      ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "bytes8", "bytes8"],
      [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes],
    ),
  );
}
