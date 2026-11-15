/**
 * sealed-x402/server.ts — Produit « inférence payée à l'appel » (x402, schéma « exact »), en service HTTP (voir ./app.ts).
 * MÊME IMAGE que sealed-chat (enclave/Dockerfile construit aussi dist/sealed-x402.mjs), autre commande :
 *   node dist/sealed-x402.mjs
 * Ses clés naissent en mémoire comme celles de sealed-chat ; elle s'inscrit pour SON produit (PRODUCT_ID, réglé par
 * X402Settler) : même VM, même empreinte d'image, autre clé, autre produit.
 * Configuration (mesurée ou chiffrée) : voir ./config.ts.
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
  // Configuration lue et validée AVANT la naissance des clés : une valeur invalide arrête l'enclave.
  const cfg = readSealedX402Config(process.env);
  const rpc = new RpcQuorum(cfg.rpcUrls);
  const dstack = await createDstackClient();
  const kit = new EnclaveKit({ productId: cfg.productId, chainId: cfg.chainId, registry: cfg.registry, rpc, dstack: dstack ?? undefined });
  console.log(dstack ? "quote: dstack TDX réel" : "quote: mock (hors VM TDX)");

  // Adresses lues dans X402Settler à la demande, gardées une fois lues (une panne RPC au démarrage ne fait pas redémarrer
  // l'enclave : un redémarrage changerait ses clés et obligerait à la réinscrire).
  let resolved: Promise<X402Addresses> | undefined;
  const addresses = () =>
    (resolved ??= resolveX402Addresses(rpc, cfg.settler, cfg.registry, cfg.usdc).catch((e) => {
      resolved = undefined;
      throw e;
    }));

  // L'empreinte du modèle est CALCULÉE à partir du modèle réellement appelé ; le produit l'épingle (param) et la
  // passerelle refuse de servir si elles diffèrent. Sans clé amont : modèle factice, d'empreinte différente.
  const modelId = cfg.redpill.apiKey ? cfg.redpill.model : MOCK_MODEL_ID;
  const modelHash = keccak256(toBytes(modelId));
  // 11/11 : MODEL_ATTESTATION=aci (mesurée) : passerelle du modèle VÉRIFIÉE, TLS épinglé, reçus exigés (model-attestation.ts)
  const modelAttestation = process.env.MODEL_ATTESTATION?.trim() || "none";
  let attested: AttestedModel | undefined;
  if (modelAttestation === "aci") {
    if (!cfg.redpill.apiKey) throw new Error("MODEL_ATTESTATION=aci exige REDPILL_API_KEY");
    attested = await AttestedModel.open({ baseUrl: cfg.redpill.baseUrl, osImages: osImagesFromEnv(process.env.MODEL_GATEWAY_OS_IMAGES), composeHashes: composeHashesFromEnv(process.env.MODEL_GATEWAY_COMPOSE_HASHES), log: (m) => console.log(m) });
  } else if (modelAttestation !== "none") {
    throw new Error("MODEL_ATTESTATION : « aci » ou « none »");
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
    `sealed-x402 (x402 exact) sur http://localhost:${cfg.port}  signer=${kit.keys.signer}  produit=${cfg.productId}  ` +
      `X402Settler=${cfg.settler}  modèle=${modelId}  modelHash=${modelHash}  MAX_OUTPUT_TOKENS=${cfg.maxOutputTokens}  quorum=${cfg.rpcUrls.length} RPC  ` +
      `autorisations ≤ ${cfg.authValiditySeconds} s  borne ${cfg.maxUnsettledPerWindow} non réglés / ${cfg.unsettledWindowSeconds} s  ` +
      `${cfg.maxPendingPerPayer} en attente par payeur  lectures payées ${cfg.paymentReadsPerMinute}/min (${cfg.paymentReadsPerMinutePerIp}/min par IP vue)`,
  );
  addresses()
    .then((A) => console.log(`X402Settler → registre des produits ${A.products}, caution ${A.bond}, USDC ${A.usdc} (registre ${A.registry} vérifié)`))
    .catch((e) => console.warn(`⚠️ adresses de X402Settler pas encore lues (${(e as Error).message}) : 503 jusqu'à la prochaine lecture réussie`));
}

main().catch((e) => {
  console.error(`sealed-x402 : démarrage refusé : ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
