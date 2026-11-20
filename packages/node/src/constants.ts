/** constants.ts — the operator agent's defaults (overridden by options or the environment). */

export const DEFAULT_API = "https://archive.62-171-153-35.sslip.io/api"; // HTTPS: the arcop_ key never travels in clear text
export const DEFAULT_WEB = "https://archive.62-171-153-35.sslip.io";
export const DEFAULT_RPC = "https://rpc.testnet.arc.io";

export const DEFAULT_PORT = 8802;
/** the enclave's listening port INSIDE the container (sealed-chat image: PORT=8802) */
export const ENCLAVE_INNER_PORT = 8802;
export const CONTAINER = "archive-enclave";
/** Inference enclave image, v2.1 stack (the one in enclave/phala/sealed-chat-v21.yml), pinned by digest */
export const DEFAULT_IMAGE =
  "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:5699da226fb3f1e0f09234c8f9330b5a5414eb8d5bc619854953d10dbe7edc3f";

/** Default product: 1, private inference on the v3 stack (a real Intel TDX machine). Without TDX (--demo): a LOCAL
 *  trial only, nothing is registered on the network (the registry verifies every quote through DCAP: a simulated
 *  attestation is refused). */
export const PRODUCT_TDX = 1;
export const PRODUCT_DEMO = 1;

/** Arc testnet, v3 stack (deployments.v3.testnet.json, deployed on 19 Nov 2026): passed to the container (the image
 *  has no default address valid for the v3 stack). */
export const CHAIN_ID = 5042002;
export const ENCLAVE_REGISTRY = "0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E";
export const SESSION_PAY = "0x606c379cd8758E3562e7ECC9972d0feF693F0763";

export const HEARTBEAT_MS = 30_000;
/** while the enclave starts, heartbeats are faster so the site shows "in service" sooner */
export const HEARTBEAT_STARTING_MS = 5_000;
/** beyond this, an enclave that still does not answer is "in error" */
export const STARTUP_GRACE_MS = 120_000;
export const MAX_LOG_LINES = 100;
export const CLOCK_MAX_SKEW_S = 30;

export const DSTACK_SOCKET = "/var/run/dstack.sock";
export const TDX_DEVICES = ["/dev/tdx_guest", "/dev/tdx-guest"] as const;
export const TSM_REPORT_DIR = "/sys/kernel/config/tsm/report";

/** Docker labels set on the container: they say it is ours and with which configuration */
export const LABEL_OWNER = "io.archive.owner";
/** revision of the "docker run" command: changing it replaces the existing containers
 *  (revision 3 brought the v2 contracts, OPERATOR_ALLOWLIST and the v2 image; revision 4, the v3 contracts: a
 *  container started with the v2.1 addresses is replaced, not kept) */
export const RUN_SPEC = "4";
