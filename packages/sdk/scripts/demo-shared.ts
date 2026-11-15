/** demo-shared.ts — valeurs partagées par les scripts de démo (aucun effet de bord à l'import). Pile v2 (Arc testnet). */
import { testnet, type Predicate } from "../src/index";

/** Identique au prédicat du site (web/src/screens/Bounty.tsx) : le solde USDC de DemoVault baisse d'au moins 1 USDC. */
export const DEMO_PREDICATE: Predicate = {
  combine: "OR",
  clauses: [{ type: "ERC20_DROP", token: testnet.usdc, holder: testnet.demoVault, min: "1000000" }],
};

/** Produits de référence de la pile v2 : 1 = inférence privée (SessionPay), 2 = Prime scellée (SealedBounty). */
export const PRODUCT_INFERENCE = testnet.products?.inference ?? 1n;
export const PRODUCT_BOUNTY = testnet.products?.bounty ?? 2n;

/** Enclaves v2 en vraie VM Intel TDX (Phala), inscrites par DCAP. Leurs clés sont TOUJOURS vérifiées on-chain avant
 *  usage (verifyEnclaveKeys) : on peut donc aussi passer par un mandataire (ENCLAVE_URL / O3 = le proxy du site). */
export const V2_INFERENCE_URL = process.env.ENCLAVE_URL ?? "https://d9604a1ae63013a744dff9214780db8090aaac92-8802.dstack-pha1-prod9.phala.network";
export const V2_BOUNTY_URL = process.env.O3 ?? "https://3c61ebf0a96f55b67ffceb8978141f73c2b39dfa-8803.dstack-pha1-prod9.phala.network";
