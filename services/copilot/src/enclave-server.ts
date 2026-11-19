/** enclave-server.ts — point d'entrée de l'image « copilot-enclave » (enclave/Dockerfile.copilot) : le copilote d'ArcHive
 *  dans une VM Intel TDX (Phala dstack), avec le kit d'enclave (voir enclave-app.ts).
 *   1. configuration lue et VALIDÉE avant la naissance des clés (enclave-config.ts) : une valeur invalide arrête l'enclave
 *      (DEBUG présent, COPILOT_PROXY_TOKEN absent ou trop court compris) ;
 *   2. DEBUG retiré de l'environnement avant de monter le client du modèle (llm.ts) ;
 *   3. clés nées en mémoire ; quote par l'agent invité dstack (/var/run/dstack.sock), sinon SIMULÉ (hors TDX, inscription
 *      impossible) ;
 *   4. le MÊME copilote que server.ts (copilot.ts), les outils lisant la pile de DEPLOYMENTS ;
 *   5. /attest, /pubkeys et /health publics ; POST /chat (en clair ou chiffré) seulement avec le jeton du mandataire du
 *      site (COPILOT_PROXY_TOKEN, en-tête x-archive-proxy-token), qui seul fait croire X-Forwarded-For (débit par IP).
 *  Aucun secret au journal : ni la clé du modèle (OPENAI_API_KEY, variable chiffrée), ni le jeton du mandataire, ni la
 *  conversation.
 *  18/11 : COPILOT_SURFACE=site (mesurée) : le copilote du PANNEAU DU SITE (enclave-site.ts) : même invite, mêmes outils
 *  d'interface et prepare que le copilote du site sur le serveur, sa propre note « où tu tournes » (juste en TDX comme
 *  hors TDX), une invite contrôlée (aucune phrase du serveur, sinon refus de démarrer) et des réponses scellées SIGNÉES
 *  par la clé de l'enclave (champ sig, vérifié par le panneau). Sans la variable : la console, comme avant. */
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
    // site : invite contrôlée (aucune phrase du serveur), note de l'enclave, /health qui dit où il tourne ; console : inchangé
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
