/** demo-shared.ts — values shared by the demo scripts (no side effect on import), for Arc testnet. */
import { testnet, type Predicate } from "../src/index";

/** The same predicate as the site's (web/src/screens/Bounty.tsx): DemoVault's USDC balance drops by at least 1 USDC. */
export const DEMO_PREDICATE: Predicate = {
  combine: "OR",
  clauses: [{ type: "ERC20_DROP", token: testnet.usdc, holder: testnet.demoVault, min: "1000000" }],
};

/** The SDK stack's reference products, with 1 (private inference, SessionPay) and 2 (Sealed Bounty, SealedBounty) as fallbacks. */
export const PRODUCT_INFERENCE = testnet.products?.inference ?? 1n;
export const PRODUCT_BOUNTY = testnet.products?.bounty ?? 2n;

/** Default URLs of enclaves in Intel TDX VMs (Phala), registered through DCAP. Their keys are ALWAYS verified on-chain
 *  before use (verifyEnclaveKeys), so a proxy works too (ENCLAVE_URL / O3 = the site's proxy). */
export const V2_INFERENCE_URL = process.env.ENCLAVE_URL ?? "https://d9604a1ae63013a744dff9214780db8090aaac92-8802.dstack-pha1-prod9.phala.network";
export const V2_BOUNTY_URL = process.env.O3 ?? "https://3c61ebf0a96f55b67ffceb8978141f73c2b39dfa-8803.dstack-pha1-prod9.phala.network";
