/**
 * binding.ts — les calculs qui LIENT l'enclave à la chaîne.
 *
 * Ces fonctions doivent produire exactement les mêmes octets que les contrats :
 *  - REPORTDATA[0:32] = keccak256(abi.encode("ARC-ENCLAVE-v1", chainId, registry, productId,
 *                                            operator, signer, x25519))   (EnclaveRegistry P6)
 *  - REPORTDATA[32:64] = hash du bloc d'ancrage R                          (EnclaveRegistry P7)
 *  - workloadId = keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES)  (P5)
 *
 * Toute divergence ici = l'attestation est rejetée on-chain. C'est le point d'intégration
 * le plus sensible ; il est verrouillé par des tests croisés avec `cast` (voir test/binding.test.ts).
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

/** REPORTDATA[0:32] — lie la chaîne, le registre, le produit, l'opérateur et les deux clés. */
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

/** REPORTDATA complet (64 octets) = rd0 ‖ hash du bloc d'ancrage. */
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

/** workloadId — l'empreinte de l'image, identique au calcul de EnclaveRegistry._workloadId. */
export function computeWorkloadId(m: Measurements): Hex {
  return keccak256(
    encodePacked(
      ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "bytes8", "bytes8"],
      [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes],
    ),
  );
}
