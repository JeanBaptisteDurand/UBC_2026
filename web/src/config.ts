// URLs set at build time (VITE_*). Defaults: local services in development, replaced for the deployment.
import { isAddress, type Address } from "viem";

const env = (import.meta as any).env ?? {};
export const API_URL: string = env.VITE_API_URL ?? "http://localhost:8809"; // state reads (spares the RPC)
export const COPILOT_URL: string = env.VITE_COPILOT_URL ?? "http://localhost:8808"; // the server's copilot (requests in clear text)
export const ENCLAVE_URL: string = env.VITE_ENCLAVE_URL ?? "http://localhost:8802"; // inference (O2)
export const O3_URL: string = env.VITE_O3_URL ?? "http://localhost:8803"; // Sealed bounty (O3)
/** The enclave of the bounty at the verified level (product 5), served next to the open-level one (/enclave/bounty-verified) */
export const O3V_URL: string = env.VITE_O3V_URL ?? O3_URL.replace(/\/enclave\/bounty\/?$/, "/enclave/bounty-verified");
/** Inference paid per call (x402, product 3): optional (empty = typed on the page). */
export const X402_URL: string = String(env.VITE_X402_URL ?? "").trim();

/** The ATTESTED copilot (product 4): optional. All three variables together, otherwise the bubble talks to the
 *  server's copilot (VITE_COPILOT_URL). The expected operator is required: the enclave must be active under THAT operator. */
export interface AttestedCopilotConfig { url: string; productId: bigint; operator: Address }

function attestedCopilot(): AttestedCopilotConfig | null {
  const url = String(env.VITE_COPILOT_ENCLAVE_URL ?? "").trim();
  const pid = String(env.VITE_COPILOT_PRODUCT_ID ?? "").trim();
  const op = String(env.VITE_COPILOT_OPERATOR ?? "").trim();
  if (!url && !pid && !op) return null;
  // an incomplete or invalid configuration is never "half attested": the bubble stays on the server
  if (!/^https?:\/\/\S+$/.test(url) || !/^[0-9]{1,10}$/.test(pid) || !isAddress(op, { strict: false })) {
    console.warn("VITE_COPILOT_ENCLAVE_URL / VITE_COPILOT_PRODUCT_ID / VITE_COPILOT_OPERATOR incomplete or invalid: server copilot only");
    return null;
  }
  return { url: url.replace(/\/+$/, ""), productId: BigInt(pid), operator: op as Address };
}
export const ATTESTED_COPILOT: AttestedCopilotConfig | null = attestedCopilot();

/** The attested copilot of product 4 runs in the SITE copilot's enclave ("site" surface, /enclave/copilot-site, next to
 *  /enclave/copilot): the Hive panel checks its key against Arc there (a /pubkeys read only). Empty: no check. */
export const COPILOT_SITE_URL: string = String(env.VITE_COPILOT_SITE_ENCLAVE_URL
  ?? String(env.VITE_COPILOT_ENCLAVE_URL ?? "").trim().replace(/\/enclave\/copilot\/?$/, "/enclave/copilot-site")).trim();
