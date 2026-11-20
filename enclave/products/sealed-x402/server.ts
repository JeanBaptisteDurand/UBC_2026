/**
 * sealed-x402/server.ts — the "inference paid per call" product (x402, "exact" scheme), as an HTTP service (see ./app.ts).
 * The SAME IMAGE as sealed-chat (enclave/Dockerfile also builds dist/sealed-x402.mjs), another command:
 *   node dist/sealed-x402.mjs
 * Its keys are created in memory like sealed-chat's; it registers for ITS product (PRODUCT_ID, settled by
 * X402Settler): the same VM, the same image fingerprint, another key, another product.
 * Configuration (measured or encrypted): see ./config.ts.
 */
import { AttestedModel, composeHashesFromEnv, modelAttestationBody, osImagesFromEnv } from "../../src/services/model-attestation";
import { serve } from "@hono/node-server";
import { keccak256, toBytes } from "viem";
import { EnclaveKit } from "../../src/kit/enclave-kit";
import { RpcQuorum } from "../../src/kit/rpc-quorum";
import { createDstackClient } from "../../src/kit/dstack";
import { X402Gateway } from "../../src/services/x402-gateway";
import { createSealedX402App } from "./app";
import { createQuorumX402Reader, resolveX402Addresses, type X402Addresses } from "./chain";
import { readSealedX402Config } from "./config";
import { createMockModel, createRedpillModel, MOCK_MODEL_ID } from "./model";

async function main() {
  // Configuration read and validated BEFORE the keys are created: an invalid value stops the enclave.
  const cfg = readSealedX402Config(process.env);
  const rpc = new RpcQuorum(cfg.rpcUrls);
  const dstack = await createDstackClient();
  const kit = new EnclaveKit({ productId: cfg.productId, chainId: cfg.chainId, registry: cfg.registry, rpc, dstack: dstack ?? undefined });
  console.log(dstack ? "quote: real dstack TDX" : "quote: mock (outside a TDX VM)");

  // Addresses read from X402Settler on demand, kept once read (an RPC outage at start-up does not make the enclave
  // restart: a restart would change its keys and require registering it again).
  let resolved: Promise<X402Addresses> | undefined;
  const addresses = () =>
    (resolved ??= resolveX402Addresses(rpc, cfg.settler, cfg.registry, cfg.usdc).catch((e) => {
      resolved = undefined;
      throw e;
    }));

  // The model's fingerprint is COMPUTED from the model really called; the product pins it (param) and the gateway
  // refuses to serve if they differ. Without an upstream key: a fake model, with a different fingerprint.
  const modelId = cfg.redpill.apiKey ? cfg.redpill.model : MOCK_MODEL_ID;
  const modelHash = keccak256(toBytes(modelId));
  // 11 Nov: MODEL_ATTESTATION=aci (measured): the model gateway is VERIFIED, TLS pinned, receipts required (model-attestation.ts)
  const modelAttestation = process.env.MODEL_ATTESTATION?.trim() || "none";
  let attested: AttestedModel | undefined;
  if (modelAttestation === "aci") {
    if (!cfg.redpill.apiKey) throw new Error("MODEL_ATTESTATION=aci exige REDPILL_API_KEY");
    attested = await AttestedModel.open({ baseUrl: cfg.redpill.baseUrl, osImages: osImagesFromEnv(process.env.MODEL_GATEWAY_OS_IMAGES), composeHashes: composeHashesFromEnv(process.env.MODEL_GATEWAY_COMPOSE_HASHES), log: (m) => console.log(m) });
  } else if (modelAttestation !== "none") {
    throw new Error("MODEL_ATTESTATION: \"aci\" or \"none\"");
  }
  const model = cfg.redpill.apiKey
    ? createRedpillModel({ baseUrl: cfg.redpill.baseUrl, model: cfg.redpill.model, apiKey: cfg.redpill.apiKey, ...(attested ? { fetch: attested.fetch } : {}) })
    : createMockModel();

  const gateway = new X402Gateway(
    kit,
    {
      chainId: cfg.chainId,
      settler: cfg.settler,
      usdc: cfg.usdc,
      network: cfg.network,
      usdcName: cfg.usdcName,
      usdcVersion: cfg.usdcVersion,
      modelHash,
      modelLabel: modelId,
      operators: cfg.operatorAllowlist,
      authValiditySeconds: cfg.authValiditySeconds,
      minSettleWindowSeconds: cfg.minSettleWindowSeconds,
      maxRequestBytes: cfg.maxRequestBytes,
      maxOutputTokens: cfg.maxOutputTokens,
      maxPendingPerPayer: cfg.maxPendingPerPayer,
      maxStoredCalls: cfg.maxStoredCalls,
      maxUnsettledPerWindow: cfg.maxUnsettledPerWindow,
      unsettledWindowSeconds: cfg.unsettledWindowSeconds,
      modelTimeoutMs: cfg.modelTimeoutMs,
      checkBalance: cfg.checkBalance,
      paymentReadsPerMinute: cfg.paymentReadsPerMinute,
      paymentReadsPerMinutePerIp: cfg.paymentReadsPerMinutePerIp,
    },
    createQuorumX402Reader(rpc, addresses),
    model,
  );

  const app = createSealedX402App({ kit, gateway, attest: { operatorAllowlist: cfg.operatorAllowlist } });
  app.get("/model-attestation", (c) => c.json(modelAttestationBody(attested) as any));
  serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" });
  setInterval(() => gateway.prune(), 60_000).unref();

  console.log(
    `sealed-x402 (x402 exact) on http://localhost:${cfg.port}  signer=${kit.keys.signer}  product=${cfg.productId}  ` +
      `X402Settler=${cfg.settler}  model=${modelId}  modelHash=${modelHash}  MAX_OUTPUT_TOKENS=${cfg.maxOutputTokens}  quorum=${cfg.rpcUrls.length} RPC  ` +
      `authorizations ≤ ${cfg.authValiditySeconds} s  bound ${cfg.maxUnsettledPerWindow} unsettled / ${cfg.unsettledWindowSeconds} s  ` +
      `${cfg.maxPendingPerPayer} pending per payer  paid reads ${cfg.paymentReadsPerMinute}/min (${cfg.paymentReadsPerMinutePerIp}/min per seen IP)`,
  );
  addresses()
    .then((A) => console.log(`X402Settler → product registry ${A.products}, bond ${A.bond}, USDC ${A.usdc} (registry ${A.registry} checked)`))
    .catch((e) => console.warn(`⚠️ X402Settler addresses not read yet (${(e as Error).message}): 503 until the next successful read`));
}

main().catch((e) => {
  console.error(`sealed-x402: start-up refused: ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
