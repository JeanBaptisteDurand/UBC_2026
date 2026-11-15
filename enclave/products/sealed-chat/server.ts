/**
 * sealed-chat/server.ts — Produit B : l'inférence d'IA en enclave (O2), en service HTTP.
 * Routes compatibles OpenAI (voir ./app.ts). L'enclave déchiffre la requête, interroge le modèle,
 * signe un reçu cumulatif, chiffre la réponse. En vraie VM TDX : llama-server + Qwen2.5-1.5B, ou RedPill.
 *
 * Variables d'environnement v2 :
 *  - UNIT_TOKENS, OUT_WEIGHT : comptage des unités facturées (défaut 1 et 1 = v1). À écrire EN CLAIR
 *    dans le docker-compose (donc mesurées dans le workloadId), jamais en variable chiffrée : sinon un
 *    opérateur changerait la facture sans changer l'empreinte de l'image.
 *  - OPERATOR_ALLOWLIST : opérateurs autorisés à recevoir un quote (voir src/server/attest-server.ts) ; v2 bis :
 *    absente = personne (on échoue fermé), `*` = développement ; ce sont aussi les seuls opérateurs dont l'enclave
 *    sert les sessions.
 *  - RPC_URLS : fournisseurs du quorum de lecture, séparés par des virgules (défaut : RPC_URL seul).
 *  - MODEL_TIMEOUT_MS : délai maximal d'un appel au modèle (défaut 120 000).
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
const SESSIONPAY = (process.env.SESSIONPAY ?? "0x1111111111111111111111111111111111111111") as Address;
const REGISTRY = (process.env.REGISTRY ?? "0x1111111111111111111111111111111111111111") as Address;
const PORT = Number(process.env.PORT ?? "8802");

const pub = createPublicClient({ transport: http(RPC) });
// v2 bis : la session porte tout ce qui est verrouillé à l'ouverture (prix, enclave, unité, modèle) : plus besoin
// de lire le produit (dont le prix ou le modèle ont pu changer depuis).
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

// Modèle : RedPill (inférence confidentielle en TEE, compatible OpenAI) si REDPILL_API_KEY présent,
// sinon mock déterministe (dev). En option : llama-server local dans l'enclave (souverain).
const REDPILL_KEY = process.env.REDPILL_API_KEY;
const REDPILL_URL = (process.env.REDPILL_BASE_URL ?? "https://api.redpill.ai/v1").replace(/\/$/, "");
const REDPILL_MODEL = process.env.REDPILL_MODEL ?? "openai/gpt-oss-120b";
// L'empreinte du modèle est CALCULÉE à partir du modèle réellement appelé, jamais fournie à part (plus de MODEL_HASH) :
// chaque reçu porte keccak256(identifiant du modèle). Le produit fixe cette empreinte (param) et chaque session la
// verrouille à l'ouverture : un opérateur qui change de modèle ne peut plus produire de reçu payable. Écrire
// REDPILL_MODEL et REDPILL_BASE_URL EN CLAIR dans le compose (mesurés dans le workloadId) ; seule la clé est secrète.
// Sans clé amont : modèle factice local (développement), d'empreinte différente, refusé par toute session réelle.
// 9/11 : une erreur de RedPill ne remonte que son statut (model.ts) : son corps, qui peut recopier la clé, n'est jamais lu
// ni journalisé ; app.ts répond alors un message générique avec un code (upstream_model).
const MODEL_ID = REDPILL_KEY ? REDPILL_MODEL : MOCK_MODEL_ID;
const MODEL_HASH = keccak256(toBytes(MODEL_ID)) as Hex;
// 11/11 : MODEL_ATTESTATION=aci (mesurée) : la passerelle de RedPill est VÉRIFIÉE avant tout appel (quote Intel, clés liées,
// compose mesuré, image système de production), chaque appel part en TLS épinglé sur sa clé attestée et chaque réponse
// exige un reçu citant un service amont vérifié (src/services/model-attestation.ts). Échec au démarrage : l'enclave refuse
// de démarrer.
const MODEL_ATTESTATION = process.env.MODEL_ATTESTATION?.trim() || "none";
let llama: LlamaClient = REDPILL_KEY
  ? createRedpillLlama({ baseUrl: REDPILL_URL, model: REDPILL_MODEL, apiKey: REDPILL_KEY })
  : createMockLlama();
const blocks: BlockSource = { current: () => pub.getBlockNumber() };

async function main() {
  // Configuration lue et validée au démarrage : une valeur invalide arrête l'enclave.
  const billing = billingFromEnv();
  const operatorAllowlist = parseOperatorAllowlist(process.env.OPERATOR_ALLOWLIST);
  const inferTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? "120000");
  if (!Number.isSafeInteger(inferTimeoutMs) || inferTimeoutMs < 1) {
    throw new Error(`MODEL_TIMEOUT_MS doit être un entier ≥ 1 (reçu « ${process.env.MODEL_TIMEOUT_MS} »)`);
  }

  let attested: AttestedModel | undefined;
  if (MODEL_ATTESTATION === "aci") {
    if (!REDPILL_KEY) throw new Error("MODEL_ATTESTATION=aci exige REDPILL_API_KEY");
    attested = await AttestedModel.open({ baseUrl: REDPILL_URL, osImages: osImagesFromEnv(process.env.MODEL_GATEWAY_OS_IMAGES), composeHashes: composeHashesFromEnv(process.env.MODEL_GATEWAY_COMPOSE_HASHES), log: (m) => console.log(m) });
    llama = createRedpillLlama({ baseUrl: REDPILL_URL, model: REDPILL_MODEL, apiKey: REDPILL_KEY, fetch: attested.fetch });
  } else if (MODEL_ATTESTATION !== "none") {
    throw new Error("MODEL_ATTESTATION : « aci » ou « none »");
  }

  const dstack = await createDstackClient();
  const kit = new EnclaveKit({ productId: PRODUCT_ID, chainId: CHAIN_ID, registry: REGISTRY, rpc: new RpcQuorum(RPC_URLS), dstack: dstack ?? undefined });
  console.log(dstack ? "quote: dstack TDX réel" : "quote: mock (hors VM TDX)");
  const gateway = new InferenceGateway(
    kit,
    // v2 bis : seules les sessions des opérateurs de cette enclave sont servies (null = développement, `*`)
    { sessionPay: SESSIONPAY, modelHash: MODEL_HASH, ...billing, inferTimeoutMs, operators: operatorAllowlist ?? undefined },
    reader, llama, blocks,
  );

  const app = createSealedChatApp({ kit, gateway, reader, modelHash: MODEL_HASH, attest: { operatorAllowlist } });
  // public : ce que l'enclave a vérifié du fournisseur du modèle
  app.get("/model-attestation", (c) => c.json(modelAttestationBody(attested) as any));

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(
    `sealed-chat (O2) sur http://localhost:${PORT}  signer=${kit.keys.signer}  modèle=${MODEL_ID}  modelHash=${MODEL_HASH}  ` +
      `UNIT_TOKENS=${billing.unitTokens}  OUT_WEIGHT=${billing.outWeight}  quorum=${RPC_URLS.length} RPC`,
  );
}

// au démarrage, seul le message (configuration invalide…) : jamais l'objet d'erreur entier
main().catch((e) => { console.error(`sealed-chat : démarrage refusé : ${(e as Error)?.message ?? e}`); process.exit(1); });
