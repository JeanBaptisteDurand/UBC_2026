/** enclave-config.ts — the configuration of the copilot IN AN ENCLAVE, read from the environment and VALIDATED at start,
 *  before the keys are born: a missing or invalid value stops the enclave (fail closed).
 *
 *  To write IN CLEAR in the Phala compose (measured: compose-hash → image fingerprint allowed by the product's author):
 *    PRODUCT_ID (required), DEPLOYMENTS (required: path of the deployments.*.json shipped in the image, e.g.
 *    /app/deployments/deployments.v21.testnet.json; the tools read this stack), REGISTRY and CHAIN_ID (optional: if
 *    given, they must match the file), RPC_URL / RPC_URLS (the kit's read quorum), OPENAI_BASE_URL and COPILOT_MODEL
 *    (required: the upstream and the model are measured), PORT, ALLOWED_ORIGINS (never "*"), COPILOT_RATE_PER_MINUTE,
 *    COPILOT_RATE_PER_DAY, COPILOT_GLOBAL_PER_DAY, COPILOT_MAX_TOKENS, COPILOT_MAX_TOOL_CHARS, COPILOT_MAX_INPUT_CHARS,
 *    COPILOT_MAX_INPUT_TOKENS (input budget in estimated tokens, 50,000 by default, the code's value when absent),
 *    ARCHIVE_API, ENCLAVE_URL, ENCLAVE_PATH_PREFIXES.
 *  ENCRYPTED variables (not measured, never logged): OPENAI_API_KEY, OPERATOR_ALLOWLIST, COPILOT_PROXY_TOKEN.
 *  Refused in an enclave: COPILOT_ALLOW_PRIVATE_URLS=1 (local development only); DEBUG, whatever its value (openai@4
 *  would log the model key and the whole conversation, see llm.ts).
 *
 *  COPILOT_PROXY_TOKEN (per-IP rate): the token the site's proxy (nginx) sets on every request (header
 *  x-archive-proxy-token). POST /chat requires it (otherwise 403 proxy_required) and X-Forwarded-For is trusted only
 *  when it is right: calling the Phala URL directly therefore cannot change "IP" at every request. At least 32 bytes,
 *  visible ASCII characters (e.g. `openssl rand -hex 32`); an ENCRYPTED variable of the VM, the same value on nginx's side.
 *
 *  COPILOT_SURFACE (in clear, so MEASURED): "console" (the default, the console's bubble) or "site" (the site's panel,
 *  enclave-site.ts: replies sealed AND signed); any other value stops the enclave before the keys are born. The surface
 *  is part of the compose, so of the image fingerprint the product's author allows. */
import { readFileSync } from "node:fs";
import { type Address, getAddress, isAddress } from "viem";
import { deploymentFromJson, type Deployment } from "@arcvault/sdk";
import { parseOperatorAllowlist } from "../../../enclave/src/server/attest-server";
import { surfaceFromEnv, type Surface } from "./copilot";

/** Minimum length of the proxy token, in bytes. */
export const MIN_PROXY_TOKEN_BYTES = 32;

export interface CopilotEnclaveConfig {
  port: number;
  productId: bigint;
  chainId: number;
  /** The stack's EnclaveRegistry: bound into the REPORTDATA of every quote. */
  registry: Address;
  rpcUrls: string[];
  deployment: Deployment;
  deploymentsPath: string;
  /** null = explicit development mode (`*`); [] = nobody (variable absent: fail closed). */
  operatorAllowlist: Address[] | null;
  model: string;
  baseUrl: string;
  /** COPILOT_PROXY_TOKEN: required on POST /chat (x-archive-proxy-token header). Never logged. */
  proxyToken: string;
  /** COPILOT_SURFACE (measured): the console's bubble, or the site's panel (signed replies). */
  surface: Surface;
}

type Env = Record<string, string | undefined>;

export function readCopilotEnclaveConfig(env: Env, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): CopilotEnclaveConfig {
  const pid = env.PRODUCT_ID?.trim();
  if (!pid || !/^[0-9]{1,78}$/.test(pid) || BigInt(pid) === 0n) {
    throw new Error('PRODUCT_ID required: the on-chain id of the "attested copilot" product, bound into REPORTDATA');
  }
  const path = env.DEPLOYMENTS?.trim();
  if (!path) throw new Error("DEPLOYMENTS required: path to the stack's deployments.*.json (embedded in the image, written in clear in the compose)");
  let deployment: Deployment;
  try {
    deployment = deploymentFromJson(JSON.parse(readFile(path)));
  } catch (e) {
    throw new Error(`DEPLOYMENTS (${path}) unreadable: ${(e as Error).message}`);
  }
  const reg = env.REGISTRY?.trim();
  if (reg) {
    if (!isAddress(reg, { strict: false })) throw new Error(`REGISTRY: invalid address "${reg}"`);
    if (reg.toLowerCase() !== deployment.enclaveRegistry.toLowerCase()) {
      throw new Error(`REGISTRY (${reg}) is not the EnclaveRegistry of ${path} (${deployment.enclaveRegistry})`);
    }
  }
  const cid = env.CHAIN_ID?.trim();
  if (cid && Number(cid) !== deployment.chainId) throw new Error(`CHAIN_ID (${cid}) is not the chain of ${path} (${deployment.chainId})`);
  const rpc = env.RPC_URL?.trim() || "https://rpc.testnet.arc.io";
  const rpcUrls = (env.RPC_URLS ?? rpc).split(",").map((s) => s.trim()).filter(Boolean);
  if (rpcUrls.length === 0) throw new Error("RPC_URLS: at least one provider");
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (!baseUrl || !/^https:\/\/[^\s/]+/.test(baseUrl)) {
    throw new Error("OPENAI_BASE_URL required, over https (the model's upstream is measured: written in clear in the compose)");
  }
  const model = env.COPILOT_MODEL?.trim();
  if (!model) throw new Error("COPILOT_MODEL required (the model is measured: written in clear in the compose)");
  if (env.COPILOT_ALLOW_PRIVATE_URLS === "1") {
    throw new Error("COPILOT_ALLOW_PRIVATE_URLS=1 refused in an enclave (local development only)");
  }
  // the value is never copied: it could come from an encrypted variable
  if (env.DEBUG !== undefined && env.DEBUG !== "") {
    throw new Error("DEBUG refused in an enclave, whatever its value: the model client (openai) would log its key and the whole conversation");
  }
  if ((env.ALLOWED_ORIGINS ?? "").split(",").some((s) => s.trim() === "*")) {
    throw new Error("ALLOWED_ORIGINS=* refused in an enclave: name the site (any page could spend the model)");
  }
  const proxyToken = env.COPILOT_PROXY_TOKEN ?? "";
  // never the token in a message: only what is wrong
  if (Buffer.byteLength(proxyToken, "utf8") < MIN_PROXY_TOKEN_BYTES) {
    throw new Error(
      `COPILOT_PROXY_TOKEN required (an ENCRYPTED VM variable, ${MIN_PROXY_TOKEN_BYTES} bytes at least, e.g. openssl rand -hex 32; the same value on the nginx side): ` +
        "without it, calling the Phala URL directly would bypass the per-IP rate limit",
    );
  }
  if (!/^[\x21-\x7e]{1,1024}$/.test(proxyToken)) {
    throw new Error("COPILOT_PROXY_TOKEN: visible ASCII characters only (no space), 1,024 at most (it travels in an HTTP header)");
  }
  const portRaw = env.PORT?.trim() || "8808";
  const port = Number(portRaw);
  if (!/^[0-9]+$/.test(portRaw) || port < 1 || port > 65_535) throw new Error(`invalid PORT "${env.PORT}"`);
  // throws on any value other than console or site; `?? ""`: absent from THIS environment means console (otherwise
  // surfaceFromEnv's default parameter would read process.env again)
  const surface = surfaceFromEnv(env.COPILOT_SURFACE ?? "");
  return {
    port,
    productId: BigInt(pid),
    chainId: deployment.chainId,
    registry: getAddress(deployment.enclaveRegistry.toLowerCase()),
    rpcUrls,
    deployment,
    deploymentsPath: path,
    operatorAllowlist: parseOperatorAllowlist(env.OPERATOR_ALLOWLIST),
    model,
    baseUrl,
    proxyToken,
    surface,
  };
}
