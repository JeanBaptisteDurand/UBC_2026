/**
 * sealed-chat/server.ts — product 1: private AI in an enclave, prepaid sessions (O2), as an HTTP service.
 * OpenAI-compatible routes (see ./app.ts). The enclave decrypts the request, queries the model, signs a cumulative
 * receipt and encrypts the answer. The model is RedPill (verified, see MODEL_ATTESTATION below), or a local mock in
 * development.
 *
 * Environment variables, v2:
 *  - UNIT_TOKENS, OUT_WEIGHT: the counting of billed units (default 1 and 1 = v1). Write them IN CLEAR in the
 *    docker-compose file (so measured in the workloadId), never as an encrypted variable: otherwise an operator could
 *    change the bill without changing the image fingerprint.
 *  - OPERATOR_ALLOWLIST: the operators allowed to receive a quote (see src/server/attest-server.ts); v2 bis: absent =
 *    nobody (it fails closed), `*` = development; they are also the only operators whose sessions the enclave serves.
 *  - RPC_URLS: the providers of the read quorum, separated by commas (default: RPC_URL alone).
 *  - MODEL_TIMEOUT_MS: the maximum duration of a call to the model (default 120,000).
 */
import { AttestedModel, composeHashesFromEnv, modelAttestationBody, osImagesFromEnv } from "../../src/services/model-attestation";
import { serve } from "@hono/node-server";
import { createPublicClient, http, parseAbi, keccak256, toBytes, type Address, type Hex } from "viem";
import { EnclaveKit } from "../../src/kit/enclave-kit";
import { RpcQuorum } from "../../src/kit/rpc-quorum";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { createDstackClient } from "../../src/kit/dstack";
import {
  InferenceGateway, billingFromEnv,
  type SessionReader, type SessionView, type LlamaClient, type BlockSource,
} from "../../src/services/inference";
import { createSealedChatApp } from "./app";
import { MOCK_MODEL_ID, createMockLlama, createRedpillLlama } from "./model";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
const RPC_URLS = (process.env.RPC_URLS ?? RPC).split(",").map((s) => s.trim()).filter(Boolean);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
/** A required contract address (set and measured by the enclave's compose file): without it, stop. */
function requiredAddress(name: string): Address {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    console.error(`${name} required (the contract's address on Arc): stopping.`);
    process.exit(1);
  }
  return v as Address;
}
const SESSIONPAY = requiredAddress("SESSIONPAY");
const REGISTRY = requiredAddress("REGISTRY");
const PORT = Number(process.env.PORT ?? "8802");

const pub = createPublicClient({ transport: http(RPC) });
// v2 bis: the session carries everything locked at opening (price, enclave, unit, model): no need to read the product
// any more (its price or model may have changed since).
const sessionAbi = parseAbi([
  "struct Session { address owner; uint256 productId; address operator; address sessionKey; uint256 deposit; uint256 cap; uint128 paidUnits; uint256 paid; uint64 expiresAt; bool closed; bool verdictWritten; uint256 price; address enclave; uint32 unitTokens; uint32 outWeight; bytes32 param; }",
  "function getSession(uint256 id) view returns (Session)",
]);

const reader: SessionReader = {
  async getSession(sessionId: bigint): Promise<SessionView> {
    const s = await pub.readContract({ address: SESSIONPAY, abi: sessionAbi, functionName: "getSession", args: [sessionId] });
    return {
      owner: s.owner, productId: s.productId, operator: s.operator, sessionKey: s.sessionKey, deposit: s.deposit, cap: s.cap,
      price: s.price, paidUnits: s.paidUnits, expiresAt: s.expiresAt, closed: s.closed,
      enclave: s.enclave, param: s.param, unitTokens: BigInt(s.unitTokens), outWeight: BigInt(s.outWeight),
    };
  },
};

// Model: RedPill (confidential inference in a TEE, OpenAI-compatible) if REDPILL_API_KEY is present, otherwise a
// deterministic mock (development). The LlamaClient interface also fits a local llama-server inside the enclave; none is
// wired today.
const REDPILL_KEY = process.env.REDPILL_API_KEY;
const REDPILL_URL = (process.env.REDPILL_BASE_URL ?? "https://api.redpill.ai/v1").replace(/\/$/, "");
const REDPILL_MODEL = process.env.REDPILL_MODEL ?? "openai/gpt-oss-120b";
// The model's fingerprint is COMPUTED from the model really called, never supplied separately (no more MODEL_HASH):
// each receipt carries keccak256(model id). The product fixes this fingerprint (param) and each session locks it at
// opening: an operator who changes the model can no longer produce a payable receipt. Write REDPILL_MODEL and
// REDPILL_BASE_URL IN CLEAR in the compose file (measured in the workloadId); only the key is secret.
// Without an upstream key: a local fake model (development), with a different fingerprint that every real session refuses.
// 14 Nov: a RedPill error surfaces only its status (model.ts): its body, which can copy the key, is never read nor
// logged; app.ts then answers with a generic message and a code (upstream_model).
const MODEL_ID = REDPILL_KEY ? REDPILL_MODEL : MOCK_MODEL_ID;
const MODEL_HASH = keccak256(toBytes(MODEL_ID)) as Hex;
// 16 Nov: MODEL_ATTESTATION=aci (measured): RedPill's gateway is VERIFIED before any call (Intel quote, bound keys,
// measured compose, production OS image), each call goes over TLS pinned to its attested key, and each answer requires
// a receipt that names a verified upstream service (src/services/model-attestation.ts). If this fails at start-up, the
// enclave refuses to start.
const MODEL_ATTESTATION = process.env.MODEL_ATTESTATION?.trim() || "none";
let llama: LlamaClient = REDPILL_KEY
  ? createRedpillLlama({ baseUrl: REDPILL_URL, model: REDPILL_MODEL, apiKey: REDPILL_KEY })
  : createMockLlama();
const blocks: BlockSource = { current: () => pub.getBlockNumber() };

async function main() {
  // Configuration read and validated at start-up: an invalid value stops the enclave.
  const billing = billingFromEnv();
  const operatorAllowlist = parseOperatorAllowlist(process.env.OPERATOR_ALLOWLIST);
  const inferTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? "120000");
  if (!Number.isSafeInteger(inferTimeoutMs) || inferTimeoutMs < 1) {
    throw new Error(`MODEL_TIMEOUT_MS must be an integer ≥ 1 (got "${process.env.MODEL_TIMEOUT_MS}")`);
  }

  let attested: AttestedModel | undefined;
  if (MODEL_ATTESTATION === "aci") {
    if (!REDPILL_KEY) throw new Error("MODEL_ATTESTATION=aci exige REDPILL_API_KEY");
    attested = await AttestedModel.open({ baseUrl: REDPILL_URL, osImages: osImagesFromEnv(process.env.MODEL_GATEWAY_OS_IMAGES), composeHashes: composeHashesFromEnv(process.env.MODEL_GATEWAY_COMPOSE_HASHES), log: (m) => console.log(m) });
    llama = createRedpillLlama({ baseUrl: REDPILL_URL, model: REDPILL_MODEL, apiKey: REDPILL_KEY, fetch: attested.fetch });
  } else if (MODEL_ATTESTATION !== "none") {
    throw new Error("MODEL_ATTESTATION: \"aci\" or \"none\"");
  }

  const dstack = await createDstackClient();
  const kit = new EnclaveKit({ productId: PRODUCT_ID, chainId: CHAIN_ID, registry: REGISTRY, rpc: new RpcQuorum(RPC_URLS), dstack: dstack ?? undefined });
  console.log(dstack ? "quote: real dstack TDX" : "quote: mock (outside a TDX VM)");
  const gateway = new InferenceGateway(
    kit,
    // v2 bis: only the sessions of this enclave's operators are served (null = development, `*`)
    { sessionPay: SESSIONPAY, modelHash: MODEL_HASH, ...billing, inferTimeoutMs, operators: operatorAllowlist ?? undefined },
    reader, llama, blocks,
  );

  const app = createSealedChatApp({ kit, gateway, reader, modelHash: MODEL_HASH, attest: { operatorAllowlist } });
  // public: what the enclave verified about the model provider
  app.get("/model-attestation", (c) => c.json(modelAttestationBody(attested) as any));

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(
    `sealed-chat (O2) on http://localhost:${PORT}  signer=${kit.keys.signer}  model=${MODEL_ID}  modelHash=${MODEL_HASH}  ` +
      `UNIT_TOKENS=${billing.unitTokens}  OUT_WEIGHT=${billing.outWeight}  quorum=${RPC_URLS.length} RPC`,
  );
}

// at start-up, only the message (invalid configuration…): never the whole error object
main().catch((e) => { console.error(`sealed-chat: start-up refused: ${(e as Error)?.message ?? e}`); process.exit(1); });
