/** enclave-server.ts — entry point of the "copilot-enclave" image (enclave/Dockerfile.copilot): ArcHive's copilot in an
 *  Intel TDX VM (Phala dstack), with the enclave kit (see enclave-app.ts).
 *   1. configuration read and VALIDATED before the keys are born (enclave-config.ts): an invalid value stops the enclave
 *      (DEBUG present, COPILOT_PROXY_TOKEN missing or too short included);
 *   2. DEBUG removed from the environment before the model client is built (llm.ts);
 *   3. keys born in memory; quote from the dstack guest agent (/var/run/dstack.sock), otherwise SIMULATED (outside TDX,
 *      registration impossible);
 *   4. the SAME copilot as server.ts (copilot.ts), its tools reading the DEPLOYMENTS stack;
 *   5. /attest, /pubkeys and /health public; POST /chat (in clear or encrypted) only with the site proxy's token
 *      (COPILOT_PROXY_TOKEN, header x-archive-proxy-token), the only thing that makes X-Forwarded-For trusted (per-IP rate).
 *  No secret in the logs: not the model key (OPENAI_API_KEY, an encrypted variable), not the proxy token, not the
 *  conversation.
 *  COPILOT_SURFACE=site (measured): the copilot of the SITE'S PANEL, AskHive (enclave-site.ts): the same prompt, the
 *  same interface and prepare tools as the site copilot on the server, its own "where you run" note (correct in TDX
 *  and outside it), a controlled prompt (no server sentence, otherwise it refuses to start) and sealed replies SIGNED
 *  by the enclave's key (the sig field, checked by the panel). Without the variable: the console, unchanged. */
import { serve } from "@hono/node-server";
import { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import { RpcQuorum } from "../../../enclave/src/kit/rpc-quorum";
import { createDstackClient } from "../../../enclave/src/kit/dstack";
import { copilotFromEnv } from "./copilot";
import { readCopilotEnclaveConfig } from "./enclave-config";
import { createCopilotEnclaveApp, enclaveSystemNote, type EnclaveFacts } from "./enclave-app";
import { SITE_REPLY_TAG, siteEnclaveOptions } from "./enclave-site";
import { stripProviderDebug } from "./llm";
import { AttestedModel, composeHashesFromEnv, modelAttestationBody, osImagesFromEnv } from "../../../enclave/src/services/model-attestation";

async function main() {
  const cfg = readCopilotEnclaveConfig(process.env);
  stripProviderDebug(); // la configuration a refusé toute valeur non vide ; une valeur vide est retirée aussi
  const dstack = await createDstackClient();
  const kit = new EnclaveKit({
    productId: cfg.productId, chainId: cfg.chainId, registry: cfg.registry, rpc: new RpcQuorum(cfg.rpcUrls), dstack: dstack ?? undefined,
  });
  console.log(dstack ? "quote: dstack TDX réel" : "quote: mock (hors VM TDX) : cette instance ne pourra pas être inscrite");

  // 11/11 : MODEL_ATTESTATION=aci (mesurée) : la passerelle du modèle est VÉRIFIÉE avant tout appel (quote Intel, image
  // système de production, TLS épinglé, reçus exigés) ; sinon l'enclave refuse de démarrer
  const ma = process.env.MODEL_ATTESTATION?.trim() || "none";
  let attested: AttestedModel | undefined;
  if (ma === "aci") {
    const base = process.env.OPENAI_BASE_URL?.trim();
    if (!base) throw new Error("MODEL_ATTESTATION=aci exige OPENAI_BASE_URL");
    attested = await AttestedModel.open({ baseUrl: base, osImages: osImagesFromEnv(process.env.MODEL_GATEWAY_OS_IMAGES), composeHashes: composeHashesFromEnv(process.env.MODEL_GATEWAY_COMPOSE_HASHES), log: (m) => console.log(m) });
  } else if (ma !== "none") {
    throw new Error("MODEL_ATTESTATION : « aci » ou « none »");
  }
  const c = copilotFromEnv({ deployment: cfg.deployment, deploymentSource: cfg.deploymentsPath, ...(attested ? { fetch: attested.fetch } : {}) });
  // la même variable lue deux fois (configuration validée, puis copilotFromEnv) : jamais deux surfaces différentes
  if (c.surface !== cfg.surface) throw new Error(`COPILOT_SURFACE : ${cfg.surface} validée, ${c.surface} montée`);
  const site = cfg.surface === "site";
  const enclave = {
    signer: kit.keys.signer, x25519: kit.keys.x25519PublicKey, productId: cfg.productId.toString(), chainId: cfg.chainId,
    registry: cfg.registry, quote: dstack ? "tdx" : "mock",
  };
  const facts: EnclaveFacts = {
    signer: kit.keys.signer, productId: cfg.productId, chainId: cfg.chainId, registry: cfg.registry,
    model: c.model, provider: c.provider, mock: !dstack,
    ...(attested ? { modelAttested: { origin: attested.status().gatewayOrigin, composeHash: attested.status().composeHash } } : {}),
  };
  const base = { ...c.options, health: { ...c.options.health, enclave } };
  const app = createCopilotEnclaveApp({
    kit,
    // site: controlled prompt (no server-side sentence), the enclave's note, /health reports where it runs; console: unchanged
    copilot: site ? siteEnclaveOptions(base, facts) : { ...base, systemNote: enclaveSystemNote(facts) },
    proxyToken: cfg.proxyToken,
    attest: { operatorAllowlist: cfg.operatorAllowlist },
    signReplies: site,
  });

  // public : ce que l'enclave a vérifié du fournisseur du modèle (11/11)
  const modelAttestation = (req: Request): Response | undefined =>
    req.method === "GET" && new URL(req.url).pathname === "/model-attestation"
      ? new Response(JSON.stringify(modelAttestationBody(attested)), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } })
      : undefined;
  serve({ fetch: (req, env) => modelAttestation(req) ?? app.fetch(req, env), port: cfg.port, hostname: "0.0.0.0" });
  console.log(
    `copilote en enclave sur http://0.0.0.0:${cfg.port}  signer=${kit.keys.signer}  x25519=${kit.keys.x25519PublicKey}  ` +
      `produit=${cfg.productId}  registre=${cfg.registry}  quorum=${cfg.rpcUrls.length} RPC  /chat : jeton du mandataire exigé  ` +
      `${site ? `surface=site, réponses scellées signées (${SITE_REPLY_TAG})  ` : ""}${c.banner}`,
  );
}

main().catch((e) => {
  console.error(`copilot-enclave : démarrage refusé : ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
