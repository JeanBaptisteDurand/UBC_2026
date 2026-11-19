/** enclave-config.ts — la configuration du copilote EN ENCLAVE, lue dans l'environnement et VALIDÉE au démarrage, avant la
 *  naissance des clés : une valeur absente ou invalide arrête l'enclave (on échoue fermé).
 *
 *  À écrire EN CLAIR dans le compose Phala (mesuré : compose-hash → empreinte d'image autorisée par l'auteur du produit) :
 *    PRODUCT_ID (requis), DEPLOYMENTS (requis : chemin du deployments.*.json embarqué dans l'image, ex.
 *    /app/deployments/deployments.v21.testnet.json ; les outils lisent cette pile), REGISTRY et CHAIN_ID (facultatifs :
 *    s'ils sont donnés, ils doivent être ceux du fichier), RPC_URL / RPC_URLS (quorum de lecture du kit), OPENAI_BASE_URL
 *    et COPILOT_MODEL (requis : l'amont et le modèle sont mesurés), PORT, ALLOWED_ORIGINS (jamais « * »),
 *    COPILOT_RATE_PER_MINUTE, COPILOT_RATE_PER_DAY, COPILOT_GLOBAL_PER_DAY, COPILOT_MAX_TOKENS, COPILOT_MAX_TOOL_CHARS,
 *    COPILOT_MAX_INPUT_CHARS, COPILOT_MAX_INPUT_TOKENS (9/11 au soir : budget d'entrée en jetons estimés, 50 000 par
 *    défaut, valeur du code si absente), ARCHIVE_API, ENCLAVE_URL, ENCLAVE_PATH_PREFIXES.
 *  Variables CHIFFRÉES (non mesurées, jamais journalisées) : OPENAI_API_KEY, OPERATOR_ALLOWLIST, COPILOT_PROXY_TOKEN.
 *  Refusés dans une enclave : COPILOT_ALLOW_PRIVATE_URLS=1 (développement local seulement) ; DEBUG, quelle qu'en soit la
 *  valeur (openai@4 journaliserait la clé du modèle et toute la conversation, voir llm.ts).
 *
 *  COPILOT_PROXY_TOKEN (9/11, débit par IP) : le jeton que le mandataire du site (nginx) pose sur chaque requête
 *  (en-tête x-archive-proxy-token). POST /chat le exige (sinon 403 proxy_required) et X-Forwarded-For n'est cru que
 *  s'il est bon : appeler l'URL Phala directement ne permet donc plus de changer d'« IP » à chaque requête. 32 octets au
 *  moins, caractères ASCII visibles (ex. `openssl rand -hex 32`) ; variable CHIFFRÉE de la VM, même valeur côté nginx.
 *
 *  COPILOT_SURFACE (18/11, en clair donc MESURÉE) : « console » (défaut, la bulle de la console) ou « site » (le panneau du
 *  front, enclave-site.ts : réponses scellées ET signées) ; toute autre valeur arrête l'enclave avant la naissance des
 *  clés. La surface fait partie du compose, donc de l'empreinte d'image qu'autorise l'auteur du produit. */
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
