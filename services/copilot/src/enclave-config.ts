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

/** Longueur minimale du jeton de proxy, en octets. */
export const MIN_PROXY_TOKEN_BYTES = 32;

export interface CopilotEnclaveConfig {
  port: number;
  productId: bigint;
  chainId: number;
  /** EnclaveRegistry de la pile : lié dans le REPORTDATA de chaque quote. */
  registry: Address;
  rpcUrls: string[];
  deployment: Deployment;
  deploymentsPath: string;
  /** null = mode développement explicite (`*`) ; [] = personne (variable absente : on échoue fermé). */
  operatorAllowlist: Address[] | null;
  model: string;
  baseUrl: string;
  /** COPILOT_PROXY_TOKEN : exigé sur POST /chat (en-tête x-archive-proxy-token). Jamais journalisé. */
  proxyToken: string;
  /** COPILOT_SURFACE (mesurée) : la bulle de la console, ou le panneau du site (réponses signées). */
  surface: Surface;
}

type Env = Record<string, string | undefined>;

export function readCopilotEnclaveConfig(env: Env, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): CopilotEnclaveConfig {
  const pid = env.PRODUCT_ID?.trim();
  if (!pid || !/^[0-9]{1,78}$/.test(pid) || BigInt(pid) === 0n) {
    throw new Error("PRODUCT_ID requis : l'identifiant on-chain du produit « copilote attesté », lié dans le REPORTDATA");
  }
  const path = env.DEPLOYMENTS?.trim();
  if (!path) throw new Error("DEPLOYMENTS requis : chemin du deployments.*.json de la pile (embarqué dans l'image, écrit en clair dans le compose)");
  let deployment: Deployment;
  try {
    deployment = deploymentFromJson(JSON.parse(readFile(path)));
  } catch (e) {
    throw new Error(`DEPLOYMENTS (${path}) illisible : ${(e as Error).message}`);
  }
  const reg = env.REGISTRY?.trim();
  if (reg) {
    if (!isAddress(reg, { strict: false })) throw new Error(`REGISTRY : adresse invalide « ${reg} »`);
    if (reg.toLowerCase() !== deployment.enclaveRegistry.toLowerCase()) {
      throw new Error(`REGISTRY (${reg}) n'est pas l'EnclaveRegistry de ${path} (${deployment.enclaveRegistry})`);
    }
  }
  const cid = env.CHAIN_ID?.trim();
  if (cid && Number(cid) !== deployment.chainId) throw new Error(`CHAIN_ID (${cid}) n'est pas la chaîne de ${path} (${deployment.chainId})`);
  const rpc = env.RPC_URL?.trim() || "https://rpc.testnet.arc.io";
  const rpcUrls = (env.RPC_URLS ?? rpc).split(",").map((s) => s.trim()).filter(Boolean);
  if (rpcUrls.length === 0) throw new Error("RPC_URLS : au moins un fournisseur");
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (!baseUrl || !/^https:\/\/[^\s/]+/.test(baseUrl)) {
    throw new Error("OPENAI_BASE_URL requis en https (l'amont du modèle est mesuré : écrit en clair dans le compose)");
  }
  const model = env.COPILOT_MODEL?.trim();
  if (!model) throw new Error("COPILOT_MODEL requis (le modèle est mesuré : écrit en clair dans le compose)");
  if (env.COPILOT_ALLOW_PRIVATE_URLS === "1") {
    throw new Error("COPILOT_ALLOW_PRIVATE_URLS=1 refusé dans une enclave (développement local seulement)");
  }
  // la valeur n'est jamais recopiée : elle pourrait venir d'une variable chiffrée
  if (env.DEBUG !== undefined && env.DEBUG !== "") {
    throw new Error("DEBUG refusé dans une enclave, quelle qu'en soit la valeur : le client du modèle (openai) journaliserait sa clé et toute la conversation");
  }
  if ((env.ALLOWED_ORIGINS ?? "").split(",").some((s) => s.trim() === "*")) {
    throw new Error("ALLOWED_ORIGINS=* refusé dans une enclave : nommer le site (n'importe quelle page ferait dépenser le modèle)");
  }
  const proxyToken = env.COPILOT_PROXY_TOKEN ?? "";
  // jamais le jeton dans un message : seulement ce qui ne va pas
  if (Buffer.byteLength(proxyToken, "utf8") < MIN_PROXY_TOKEN_BYTES) {
    throw new Error(
      `COPILOT_PROXY_TOKEN requis (variable CHIFFRÉE de la VM, ${MIN_PROXY_TOKEN_BYTES} octets au moins, ex. openssl rand -hex 32 ; même valeur côté nginx) : ` +
        "sans lui, appeler l'URL Phala directement contournerait le débit par IP",
    );
  }
  if (!/^[\x21-\x7e]{1,1024}$/.test(proxyToken)) {
    throw new Error("COPILOT_PROXY_TOKEN : caractères ASCII visibles seulement (sans espace), 1 024 au plus (il voyage dans un en-tête HTTP)");
  }
  const portRaw = env.PORT?.trim() || "8808";
  const port = Number(portRaw);
  if (!/^[0-9]+$/.test(portRaw) || port < 1 || port > 65_535) throw new Error(`PORT invalide « ${env.PORT} »`);
  // lève sur toute valeur autre que console ou site ; « ?? "" » : absente de CET environnement = console (sinon le
  // paramètre par défaut de surfaceFromEnv relirait process.env)
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
