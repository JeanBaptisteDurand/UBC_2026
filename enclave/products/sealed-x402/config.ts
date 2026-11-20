/**
 * sealed-x402/config.ts — the configuration of the "inference paid per call" enclave, read from the environment and
 * VALIDATED at start-up: a missing or invalid value stops the enclave BEFORE its keys are created.
 *
 * No contract address has a default value: they come from the compose file (the chosen stack, v2.1).
 *
 * To write IN CLEAR in the compose file (measured: compose hash → the image fingerprint the product's author allows):
 *   PRODUCT_ID, CHAIN_ID, REGISTRY, X402SETTLER, USDC, RPC_URL / RPC_URLS, REDPILL_BASE_URL, REDPILL_MODEL,
 *   X402_NETWORK, USDC_NAME, USDC_VERSION, AUTH_VALIDITY_SECONDS, MIN_SETTLE_WINDOW_SECONDS, MAX_REQUEST_BYTES,
 *   MAX_OUTPUT_TOKENS, MAX_PENDING_PER_PAYER, MAX_STORED_CALLS, MAX_UNSETTLED_PER_WINDOW, UNSETTLED_WINDOW_SECONDS,
 *   MODEL_TIMEOUT_MS, CHECK_PAYER_BALANCE, PAYMENT_READS_PER_MINUTE, PAYMENT_READS_PER_MINUTE_PER_IP, PORT.
 *   (The price is fixed per call and the output-token cap is part of it: an operator must not be able to change it
 *   without changing the image fingerprint.)
 *   9 Nov: AUTH_VALIDITY_SECONDS is 900 by default (instead of 3,600): an unpayable call (balance emptied after the
 *   service) now counts for a quarter of an hour at most; MIN_SETTLE_WINDOW_SECONDS (600) stays compatible. Global
 *   bound: at most MAX_UNSETTLED_PER_WINDOW (300) served and unsettled calls over UNSETTLED_WINDOW_SECONDS (600 s).
 *   Evening of 9 Nov: AUTH_VALIDITY_SECONDS is the MAXIMUM accepted validity (the 402 announces 60 s less, for the
 *   clients' clocks); MAX_PENDING_PER_PAYER is 3 by default (instead of 20; a value written in the compose file wins:
 *   write 3 there); PAYMENT_READS_PER_MINUTE (120) and PAYMENT_READS_PER_MINUTE_PER_IP (60) bound the on-chain reads
 *   of paid requests (see src/services/x402-gateway.ts).
 * ENCRYPTED variables (not measured): REDPILL_API_KEY, OPERATOR_ALLOWLIST (also: the only accepted signers of
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
  /** null = explicit development mode (`*`); [] = nobody (variable absent: it fails closed). */
  operatorAllowlist: Address[] | null;
}

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, dflt: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return dflt;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) throw new Error(`${name} must be an integer (got "${raw}")`);
  const v = Number(t);
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`${name} must be between ${min} and ${max} (got "${raw}")`);
  return v;
}

function address(env: Env, name: string): Address {
  const raw = env[name]?.trim();
  if (!raw) throw new Error(`${name} required (the contract address of the deployed stack, written in clear in the compose file)`);
  if (!isAddress(raw, { strict: false }) || raw.toLowerCase() === zeroAddress) throw new Error(`${name}: invalid address "${raw}"`);
  return getAddress(raw.toLowerCase());
}

export function readSealedX402Config(env: Env): SealedX402Config {
  const chainId = int(env, "CHAIN_ID", 5042002);
  const pidRaw = env.PRODUCT_ID?.trim();
  if (!pidRaw || !/^[0-9]{1,78}$/.test(pidRaw) || BigInt(pidRaw) === 0n) {
    throw new Error("PRODUCT_ID required: the on-chain id of the x402 product (settled by X402Settler), bound in the REPORTDATA");
  }
  const rpc = env.RPC_URL?.trim() || "https://rpc.testnet.arc.io";
  const rpcUrls = (env.RPC_URLS ?? rpc).split(",").map((s) => s.trim()).filter(Boolean);
  if (rpcUrls.length === 0) throw new Error("RPC_URLS: at least one provider");
  const authValiditySeconds = int(env, "AUTH_VALIDITY_SECONDS", 900, 60, 86_400);
  const minSettleWindowSeconds = int(env, "MIN_SETTLE_WINDOW_SECONDS", 600, 30, 86_400);
  if (authValiditySeconds < minSettleWindowSeconds + 120) {
    throw new Error("AUTH_VALIDITY_SECONDS must exceed MIN_SETTLE_WINDOW_SECONDS by at least 120 s");
  }
  const checkRaw = (env.CHECK_PAYER_BALANCE ?? "1").trim();
  if (checkRaw !== "0" && checkRaw !== "1") throw new Error(`CHECK_PAYER_BALANCE: 0 or 1 (got "${env.CHECK_PAYER_BALANCE}")`);
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
