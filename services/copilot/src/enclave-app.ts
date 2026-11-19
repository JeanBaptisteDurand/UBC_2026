/** enclave-app.ts — the copilot INSIDE an Intel TDX enclave (Phala dstack), with no side effect (testable outside a VM):
 *  the SAME app as server.ts (same tools, same guards, same prompt), plus ArcHive's enclave kit:
 *   - keys born in memory at start (secp256k1 + X25519), never written;
 *   - POST /attest (operator): a REAL TDX quote from dstack whose REPORTDATA binds the chain, the registry, the copilot's
 *     product, the operator and both keys; the same rules as the other products (OPERATOR_ALLOWLIST, fail closed;
 *     refused if the key is already registered for another operator); outside TDX, a SIMULATED quote (mock: true) that
 *     no on-chain registration accepts, so a client (site, SDK) always refuses that copilot;
 *   - GET /pubkeys (public, open CORS): the X25519 key the client checks against the chain before encrypting;
 *   - POST /chat: besides clear mode, the encrypted conversation (HPKE to the enclave's X25519 key, tag
 *     ARC-COPILOT-CHAT-v1, info bound to the chain, the registry, the product and the signer); the reply goes back
 *     sealed for that client only (enclave/src/kit/hpke-exchange.ts; client: the SDK's createAttestedCopilotClient);
 *   - POST /chat ONLY through the site's proxy (proxyToken = COPILOT_PROXY_TOKEN, an encrypted variable: header
 *     x-archive-proxy-token set by nginx, otherwise 403 proxy_required); X-Forwarded-For is trusted only when it is right
 *     (the peer seen here is always Phala's gateway), so the per-IP rate cannot be bypassed by calling the Phala URL
 *     directly. /attest, /pubkeys and /health stay public.
 *  The model's API key and the proxy token stay ENCRYPTED variables of the enclave: never measured, never logged; the
 *  key is removed from everything that goes out (app.ts's secrets filter).
 *  "site" surface (COPILOT_SURFACE=site, enclave-site.ts): AskHive, the site panel's copilot, in the enclave; with
 *  `signReplies`, every sealed reply is also SIGNED by the enclave's key (the sig field, checked by the panel). Outside
 *  TDX (simulated quote), the console's note no longer says it runs in an enclave. */
import { COPILOT_SEALED_TAG } from "@arcvault/sdk";
import type { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import { createAttestServer, type AttestServerOptions } from "../../../enclave/src/server/attest-server";
import { createCopilotApp, type CopilotAppOptions, type SealedChannel } from "./app";
import { signingSealedChannel } from "./enclave-site";
import type { Lang } from "./i18n";

/** Routes servies par le kit (CORS ouvert : tout y est public) ; tout le reste va au copilote (CORS du site). */
export const KIT_ROUTES: ReadonlySet<string> = new Set(["/attest", "/pubkeys"]);

/** La conversation chiffrée, ouverte par la clé X25519 de CETTE enclave. */
export function copilotSealedChannel(kit: EnclaveKit): SealedChannel {
  return {
    tag: COPILOT_SEALED_TAG,
    async open(enc, ciphertext) {
      const x = await kit.openExchange(COPILOT_SEALED_TAG, enc, ciphertext);
      return { plaintext: x.plaintext, seal: (response) => x.sealResponse(response) };
    },
  };
}

export interface EnclaveFacts {
  signer: string;
  productId: bigint;
  chainId: number;
  registry: string;
  model: string;
  provider: string;
  /** Quote simulé (hors TDX) : cette instance ne peut pas être inscrite. */
  mock: boolean;
  /** 11/11 : la passerelle du modèle, VÉRIFIÉE par l'enclave (model-attestation.ts), si MODEL_ATTESTATION=aci. */
  modelAttested?: { origin: string; composeHash: string };
}

/** Ce que le copilote sait de l'endroit où il tourne (ajouté à son invite, pour répondre juste si on le lui demande). */
export function enclaveSystemNote(f: EnclaveFacts): (x: { sealed: boolean; lang: Lang }) => string {
  return ({ sealed }) => [
    `OÙ TU TOURNES (à dire sobrement si on te le demande, sans promettre plus) : ${f.mock ? "le programme du copilote attesté, ici HORS de toute enclave Intel TDX (développement : quote simulé, voir plus bas)" : "dans une enclave Intel TDX (VM confidentielle Phala dstack)"}. Ta clé de signature ${f.signer} est faite pour être inscrite sur Arc pour le produit #${f.productId} (registre ${f.registry}, chaîne ${f.chainId}) par un quote TDX vérifié on-chain (DCAP), l'opérateur qui l'inscrit y engageant sa caution (la caution minimale du produit, lue on-chain : appelle un outil si on te demande son montant) ; c'est le client (site, SDK) qui vérifie sur la chaîne qu'elle l'est avant de chiffrer. Le modèle que tu appelles (${f.model}, chez ${f.provider}) est fixé par la configuration mesurée de l'image ; la question et ta réponse passent par ce fournisseur (connexion TLS depuis l'enclave). ${f.modelAttested
      ? `L'enclave a VÉRIFIÉ ce fournisseur avant de l'appeler : sa passerelle (${f.modelAttested.origin}) tourne elle-même dans une enclave Intel TDX attestée (quote vérifié jusqu'à la racine d'Intel, image système de production, compose mesuré ${f.modelAttested.composeHash.slice(0, 12)}…), la connexion est épinglée sur sa clé attestée, et chaque réponse exige un reçu de la passerelle citant un service amont vérifié. Dis donc, sobrement : la conversation n'est lue que par des enclaves attestées (celle-ci, la passerelle du modèle et son service amont), ni par leurs opérateurs ni par nous. Ne promets pas plus : le code de la passerelle est ouvert mais sa version n'est pas épinglée.`
      : "Ne dis JAMAIS que seule l'enclave (ou « personne d'autre ») peut lire la conversation : le fournisseur du modèle la reçoit en clair pour faire l'inférence."} Ce que l'enclave garantit : ni l'opérateur ni le serveur web du site ne la lisent ni ne la modifient, et le modèle appelé est celui de la configuration mesurée.`,
    f.mock ? "DÉVELOPPEMENT : quote SIMULÉ (pas de TDX ici) ; cette instance ne peut pas être inscrite sur Arc : ne prétends pas le contraire." : "",
    sealed
      ? "Cette conversation est arrivée CHIFFRÉE (HPKE) vers la clé de cette enclave : le serveur web qui la relaie ne peut pas la lire."
      : "Cette conversation est arrivée EN CLAIR (mode compatible) : le serveur web qui la relaie peut la lire.",
  ].filter(Boolean).join(" ");
}

export interface CopilotEnclaveAppOptions {
  kit: EnclaveKit;
  /** Le copilote (options de createCopilotApp, sans `sealed` ni `proxyToken` : le kit et l'enclave les apportent). */
  copilot: Omit<CopilotAppOptions, "sealed" | "proxyToken">;
  /** Jeton du mandataire du site (COPILOT_PROXY_TOKEN, variable chiffrée) : exigé sur POST /chat. */
  proxyToken: string;
  /** Options de /attest (défaut : OPERATOR_ALLOWLIST lue dans l'environnement). */
  attest?: AttestServerOptions;
  /** 18/11 (surface site) : chaque réponse scellée est aussi signée par la clé de l'enclave (enclave-site.ts, champ sig). */
  signReplies?: boolean;
}

/** L'application de l'enclave : /attest et /pubkeys par le kit, tout le reste par le copilote (conversation chiffrée
 *  comprise, jeton du mandataire exigé sur POST /chat). `fetch` se branche tel quel sur @hono/node-server (les infos de
 *  connexion suivent : débit par IP). */
export function createCopilotEnclaveApp(o: CopilotEnclaveAppOptions) {
  if (!o.proxyToken) throw new Error("copilote en enclave : jeton du mandataire (COPILOT_PROXY_TOKEN) requis");
  const attest = createAttestServer(o.kit, o.attest);
  const sealed = o.signReplies ? signingSealedChannel(o.kit, o.copilot.log) : copilotSealedChannel(o.kit);
  const chat = createCopilotApp({ ...o.copilot, sealed, proxyToken: o.proxyToken });
  const fetch = (req: Request, env?: unknown): Response | Promise<Response> =>
    KIT_ROUTES.has(new URL(req.url).pathname) ? attest.fetch(req, env as any) : chat.fetch(req, env as any);
  return { fetch, attest, chat };
}
