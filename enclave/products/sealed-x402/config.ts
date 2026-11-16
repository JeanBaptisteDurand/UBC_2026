/**
 * sealed-x402/config.ts — la configuration de l'enclave « inférence payée à l'appel », lue dans l'environnement et
 * VALIDÉE au démarrage : une valeur absente ou invalide arrête l'enclave AVANT la naissance de ses clés.
 *
 * Aucune adresse de contrat n'a de valeur par défaut : elles viennent du compose (pile choisie, v2.1).
 *
 * À écrire EN CLAIR dans le compose (mesuré : compose-hash → empreinte d'image autorisée par l'auteur du produit) :
 *   PRODUCT_ID, CHAIN_ID, REGISTRY, X402SETTLER, USDC, RPC_URL / RPC_URLS, REDPILL_BASE_URL, REDPILL_MODEL,
 *   X402_NETWORK, USDC_NAME, USDC_VERSION, AUTH_VALIDITY_SECONDS, MIN_SETTLE_WINDOW_SECONDS, MAX_REQUEST_BYTES,
 *   MAX_OUTPUT_TOKENS, MAX_PENDING_PER_PAYER, MAX_STORED_CALLS, MAX_UNSETTLED_PER_WINDOW, UNSETTLED_WINDOW_SECONDS,
 *   MODEL_TIMEOUT_MS, CHECK_PAYER_BALANCE, PAYMENT_READS_PER_MINUTE, PAYMENT_READS_PER_MINUTE_PER_IP, PORT.
 *   (Le prix est fixe par appel et le plafond de jetons de sortie en fait partie : un opérateur ne doit pas pouvoir le
 *   changer sans changer l'empreinte de l'image.)
 *   9/11 : AUTH_VALIDITY_SECONDS vaut 900 par défaut (au lieu de 3 600) : un appel impayable (solde vidé après le
 *   service) ne compte plus qu'un quart d'heure au plus ; MIN_SETTLE_WINDOW_SECONDS (600) reste compatible. Borne globale :
 *   au plus MAX_UNSETTLED_PER_WINDOW (300) appels servis et non réglés sur UNSETTLED_WINDOW_SECONDS (600 s).
 *   9/11 au soir : AUTH_VALIDITY_SECONDS est la validité MAXIMALE acceptée (le 402 en annonce 60 s de moins, pour les
 *   horloges des clients) ; MAX_PENDING_PER_PAYER vaut 3 par défaut (au lieu de 20 ; une valeur écrite dans le compose
 *   l'emporte : y mettre 3) ; PAYMENT_READS_PER_MINUTE (120) et PAYMENT_READS_PER_MINUTE_PER_IP (60) bornent les lectures
 *   on-chain des requêtes payées (voir src/services/x402-gateway.ts).
 * Variables CHIFFRÉES (non mesurées) : REDPILL_API_KEY, OPERATOR_ALLOWLIST (aussi : les seuls signataires acceptés de
 *   POST /x402/settled).
 */
import { type Address, getAddress, isAddress, zeroAddress } from "viem";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { x402NetworkName } from "../../src/services/x402";

export interface SealedX402Config {
  port: number;
  chainId: number;
  productId: bigint;
  registry: Address;
  settler: Address;
  usdc: Address;
  network: string;
  usdcName: string;
  usdcVersion: string;
  rpcUrls: string[];
  redpill: { baseUrl: string; model: string; apiKey?: string };
  authValiditySeconds: number;
  minSettleWindowSeconds: number;
  maxRequestBytes: number;
  maxOutputTokens: number;
  maxPendingPerPayer: number;
  maxStoredCalls: number;
  maxUnsettledPerWindow: number;
  unsettledWindowSeconds: number;
  modelTimeoutMs: number;
  checkBalance: boolean;
  paymentReadsPerMinute: number;
  paymentReadsPerMinutePerIp: number;
  /** null = mode développement explicite (`*`) ; [] = personne (variable absente : on échoue fermé). */
  operatorAllowlist: Address[] | null;
}

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, dflt: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return dflt;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) throw new Error(`${name} doit être un entier (reçu « ${raw} »)`);
  const v = Number(t);
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`${name} doit être entre ${min} et ${max} (reçu « ${raw} »)`);
  return v;
}

function address(env: Env, name: string): Address {
  const raw = env[name]?.trim();
  if (!raw) throw new Error(`${name} requis (adresse du contrat de la pile déployée, écrite en clair dans le compose)`);
  if (!isAddress(raw, { strict: false }) || raw.toLowerCase() === zeroAddress) throw new Error(`${name} : adresse invalide « ${raw} »`);
  return getAddress(raw.toLowerCase());
}

export function readSealedX402Config(env: Env): SealedX402Config {
  const chainId = int(env, "CHAIN_ID", 5042002);
  const pidRaw = env.PRODUCT_ID?.trim();
  if (!pidRaw || !/^[0-9]{1,78}$/.test(pidRaw) || BigInt(pidRaw) === 0n) {
    throw new Error("PRODUCT_ID requis : l'identifiant on-chain du produit x402 (réglé par X402Settler), lié dans le REPORTDATA");
  }
  const rpc = env.RPC_URL?.trim() || "https://rpc.testnet.arc.io";
  const rpcUrls = (env.RPC_URLS ?? rpc).split(",").map((s) => s.trim()).filter(Boolean);
  if (rpcUrls.length === 0) throw new Error("RPC_URLS : au moins un fournisseur");
  const authValiditySeconds = int(env, "AUTH_VALIDITY_SECONDS", 900, 60, 86_400);
  const minSettleWindowSeconds = int(env, "MIN_SETTLE_WINDOW_SECONDS", 600, 30, 86_400);
  if (authValiditySeconds < minSettleWindowSeconds + 120) {
    throw new Error("AUTH_VALIDITY_SECONDS doit dépasser MIN_SETTLE_WINDOW_SECONDS d'au moins 120 s");
  }
  const checkRaw = (env.CHECK_PAYER_BALANCE ?? "1").trim();
  if (checkRaw !== "0" && checkRaw !== "1") throw new Error(`CHECK_PAYER_BALANCE : 0 ou 1 (reçu « ${env.CHECK_PAYER_BALANCE} »)`);
  const apiKey = env.REDPILL_API_KEY?.trim();
  return {
    port: int(env, "PORT", 8804, 1, 65_535),
    chainId,
    productId: BigInt(pidRaw),
    registry: address(env, "REGISTRY"),
    settler: address(env, "X402SETTLER"),
    usdc: address(env, "USDC"),
    network: env.X402_NETWORK?.trim() || x402NetworkName(chainId),
    usdcName: env.USDC_NAME?.trim() || "USDC",
    usdcVersion: env.USDC_VERSION?.trim() || "2",
    rpcUrls,
    redpill: {
      baseUrl: (env.REDPILL_BASE_URL?.trim() || "https://api.redpill.ai/v1").replace(/\/+$/, ""),
      model: env.REDPILL_MODEL?.trim() || "openai/gpt-oss-120b",
      ...(apiKey ? { apiKey } : {}),
    },
    authValiditySeconds,
    minSettleWindowSeconds,
    maxRequestBytes: int(env, "MAX_REQUEST_BYTES", 32_768, 256, 1_048_576),
    maxOutputTokens: int(env, "MAX_OUTPUT_TOKENS", 1024, 1, 65_536),
    maxPendingPerPayer: int(env, "MAX_PENDING_PER_PAYER", 3, 1, 10_000),
    maxStoredCalls: int(env, "MAX_STORED_CALLS", 2000, 1, 100_000),
    maxUnsettledPerWindow: int(env, "MAX_UNSETTLED_PER_WINDOW", 300, 1, 100_000),
    unsettledWindowSeconds: int(env, "UNSETTLED_WINDOW_SECONDS", 600, 10, 86_400),
    modelTimeoutMs: int(env, "MODEL_TIMEOUT_MS", 120_000, 1_000, 600_000),
    checkBalance: checkRaw === "1",
    paymentReadsPerMinute: int(env, "PAYMENT_READS_PER_MINUTE", 120, 1, 100_000),
    paymentReadsPerMinutePerIp: int(env, "PAYMENT_READS_PER_MINUTE_PER_IP", 60, 1, 100_000),
    operatorAllowlist: parseOperatorAllowlist(env.OPERATOR_ALLOWLIST),
  };
}
