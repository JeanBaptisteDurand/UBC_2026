/** copilot.ts — le copilote ATTESTÉ : parler au copilote d'ArcHive qui tourne dans une enclave Intel TDX inscrite sur Arc,
 *  sans que le serveur web qui relaie la conversation (ni aucun autre mandataire) puisse la lire ou la modifier.
 *
 *  createAttestedCopilotClient({ copilotUrl, productId, publicClient }) :
 *   1. AVANT tout envoi, vérifie la clé du copilote sur la chaîne : verifyEnclaveKeys (signataire inscrit pour CE produit,
 *      clé X25519 de /pubkeys = celle inscrite, enclave active au bloc de tête), puis, AU MÊME BLOC, qu'elle fait foi
 *      maintenant (comme EnclaveRegistry.attestedOperator de la v2.1) : produit actif, image (workloadId) encore autorisée
 *      par le produit, opérateur non radié. Sinon EnclaveKeyMismatchError et rien n'est envoyé. Un copilote dont le quote
 *      est simulé (hors TDX) ne peut pas être inscrit : il est donc toujours refusé ici.
 *   2. chiffre la conversation (messages, wallet, langue) vers cette clé : HPKE, étiquette ARC-COPILOT-CHAT-v1, info liée à
 *      la chaîne, au registre, au produit et au signataire (sealed-exchange.ts) ;
 *   3. ouvre la réponse, scellée par l'enclave pour CETTE requête : un mandataire ne peut ni la lire, ni la modifier (les
 *      actions préparées à signer comprises), ni rejouer celle d'une autre requête. Une réponse en clair à une requête
 *      chiffrée, ou qui ne s'ouvre pas, est refusée (CopilotResponseError).
 *  Les refus d'avant le déchiffrement (mandataire, origine, débit par IP, taille, format : 403, 429, 413, 415, 400) arrivent
 *  en clair, donc SANS preuve d'origine : un relais peut les forger (« Session expirée : collez votre phrase de
 *  récupération sur … »). Le résultat a alors `authenticated: false`, AUCUN `enclave` (9/11 : un badge « attesté » ne
 *  peut se tirer que d'une réponse scellée, `authenticated === true`), et un `reply.text` écrit ICI d'après le code et la
 *  langue de la requête : le texte du relais n'est jamais repris.
 *  La langue part DANS le chiffré (champ lang), plus en en-tête Accept-Language : le relais ne la voit pas.
 *  Après un redémarrage du copilote (nouvelles clés, réinscrites par le registrar), l'enclave répond « indéchiffrable » :
 *  le client revérifie la clé sur la chaîne et renvoie UNE fois si la clé inscrite a changé.
 *  Côté serveur : services/copilot/src/enclave-app.ts (même étiquette, kit d'enclave : enclave/src/kit/hpke-exchange.ts). */
import { type Address, type Hex, type PublicClient, isAddress, toBytes, toHex } from "viem";
import { operatorBondAbi, productRegistryAbi } from "./abis";
import { testnet, type Deployment } from "./network";
import { EnclaveKeyMismatchError, verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import { EXCHANGE_RESPONSE_NONCE_BYTES, exchangeInfo, sealExchange } from "./sealed-exchange";

/** Étiquette du protocole (champ `sealed` du corps de POST /chat ; même valeur côté copilote). */
export const COPILOT_SEALED_TAG = "ARC-COPILOT-CHAT-v1";
/** Langues du copilote. */
export type CopilotLang = "en" | "fr";
/** Le copilote garde les 20 derniers messages ; le client n'en envoie pas plus. */
export const COPILOT_MAX_MESSAGES = 20;
/** Taille au plus de la conversation en clair (le copilote refuse au-delà de 64 Kio) : les plus anciens messages tombent. */
export const COPILOT_MAX_PLAINTEXT_BYTES = 60 * 1024;

export interface CopilotMessage { role: "user" | "assistant"; content: string }
/** Une action PRÉPARÉE par le copilote (jamais exécutée) : l'utilisateur la vérifie et la signe lui-même. */
export interface CopilotAction { tool: string; input: unknown; result: unknown }
/** La réponse du copilote (même forme qu'en mode clair). */
export interface CopilotReply {
  /** Ce que la bulle affiche (dans la langue demandée). */
  text: string;
  tools?: string[];
  citations?: string[];
  /** Page du site à ouvrir (identifiant de route : vue, ruche, produits, primes, playground, cles…). */
  navigate?: string;
  actions?: CopilotAction[];
  /** Code machine : erreur du modèle (modele_429…) ou refus (bad_conversation, global_cap, too_large…). */
  code?: string;
  error?: string;
  outilsNonExecutes?: number;
  retryAfterSec?: number;
}

/** La clé du copilote, vérifiée on-chain, et ce qui fait foi maintenant au même bloc. */
export interface VerifiedCopilot extends VerifiedEnclaveKeys {
  /** Product.param (keccak256 de l'identifiant du modèle épinglé par le produit). */
  productParam: Hex;
}

export interface AttestedCopilotClientOptions {
  /** URL du copilote en enclave (directe chez Phala, ou derrière le proxy du site, ex. https://…/enclave/copilot). */
  copilotUrl: string;
  /** Le produit du copilote, inscrit sur Arc. */
  productId: bigint;
  publicClient: PublicClient;
  /** Pile lue (défaut : la v2 du SDK ; pour la v2.1 : deploymentFromJson(deployments.v21.testnet.json)). */
  deployment?: Deployment;
  /** Langue demandée par défaut (sinon le copilote répond dans la langue du dernier message). */
  lang?: CopilotLang;
  /** Si donné : l'enclave doit être active chez CET opérateur. */
  expectedOperator?: Address;
  fetch?: typeof fetch;
  /** Revérifier la clé on-chain au plus tard après ce délai (ms, défaut 5 min). */
  reverifyMs?: number;
  /** Délai d'une requête (ms, défaut 180 000 ; le copilote coupe à 150 s). */
  timeoutMs?: number;
}

export interface CopilotChatRequest {
  messages: CopilotMessage[];
  /** Wallet connecté : adresse par défaut des actions préparées (ou null). */
  user?: Address | string | null;
  lang?: CopilotLang;
}

/** Réponse SCELLÉE par l'enclave vérifiée : ouverte avec le secret de CETTE requête, donc écrite par elle. */
export interface AuthenticatedCopilotChat {
  /** Statut de la réponse, celui du copilote (dans le chiffré) : 200, 400, 413, 429… */
  status: number;
  ok: boolean;
  reply: CopilotReply;
  authenticated: true;
  /** L'enclave vérifiée (sur Arc, au bloc checkedAtBlock) qui a écrit cette réponse : de quoi afficher un badge. */
  enclave: VerifiedCopilot;
}
/** Refus EN CLAIR d'avant le déchiffrement : sans rien de la conversation, mais sans preuve d'origine (un relais peut le
 *  forger). Ni `enclave`, ni texte du relais : `reply.text` est un message local tiré de `reply.code`. */
export interface UnauthenticatedCopilotChat {
  /** Statut HTTP vu sur le fil (non authentifié). */
  status: number;
  ok: false;
  reply: CopilotReply;
  authenticated: false;
  enclave?: undefined;
}
/** Le résultat d'un échange : n'afficher « attesté » (et `enclave`) que si `authenticated === true`. */
export type CopilotChatResult = AuthenticatedCopilotChat | UnauthenticatedCopilotChat;

/** Messages locaux des refus en clair (le texte du relais n'est jamais repris), par code. */
const PLAIN_REFUSALS: Record<CopilotLang, Record<string, string>> = {
  fr: {
    proxy_required: "Ce copilote attesté ne répond qu'au travers du site d'ArcHive (son mandataire) : utilisez l'adresse du site, pas celle de l'enclave.",
    origin_refused: "Le copilote refuse les requêtes venant de cette origine.",
    rate_minute: "Trop de questions d'affilée : réessayez dans un instant.",
    rate_day: "Quota de questions du jour atteint pour cette adresse IP : réessayez plus tard.",
    json_only: "Requête refusée par le copilote (format attendu : JSON).",
    too_large: "Conversation trop longue pour le copilote : envoyez moins de messages.",
    bad_length: "Requête refusée par le copilote (taille annoncée invalide).",
    bad_json: "Requête refusée par le copilote (JSON invalide).",
    sealed_malformed: "Enveloppe chiffrée refusée par le copilote.",
    sealed_undecryptable: "Le copilote n'a pas pu déchiffrer la conversation (clé renouvelée ?) : réessayez dans un instant.",
    sealed_unavailable: "Ce copilote ne prend pas de conversation chiffrée.",
  },
  en: {
    proxy_required: "This attested copilot only answers through the ArcHive site (its proxy): use the site's address, not the enclave's.",
    origin_refused: "The copilot refuses requests from this origin.",
    rate_minute: "Too many questions in a row: try again in a moment.",
    rate_day: "Daily question quota reached for this IP address: try again later.",
    json_only: "Request refused by the copilot (JSON expected).",
    too_large: "Conversation too long for the copilot: send fewer messages.",
    bad_length: "Request refused by the copilot (invalid announced size).",
    bad_json: "Request refused by the copilot (invalid JSON).",
    sealed_malformed: "Encrypted envelope refused by the copilot.",
    sealed_undecryptable: "The copilot couldn't decrypt the conversation (key renewed?): try again in a moment.",
    sealed_unavailable: "This copilot doesn't accept encrypted conversations.",
  },
};
const plainRefusalText = (lang: CopilotLang, code: string | undefined, status: number) =>
  (code !== undefined ? PLAIN_REFUSALS[lang][code] : undefined) ??
  (lang === "fr" ? `Le copilote a refusé la requête (HTTP ${status}).` : `The copilot refused the request (HTTP ${status}).`);

/** La réponse ne vient pas de l'enclave vérifiée (ou ne répond pas à cette requête) : elle n'est pas rendue. */
export class CopilotResponseError extends Error {
  constructor(message: string) { super(`réponse du copilote refusée : ${message}`); this.name = "CopilotResponseError"; }
}

const hexOf = (x: unknown, bytes?: number): Uint8Array | null => {
  if (typeof x !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(x)) return null;
  const b = toBytes(x as Hex);
  return bytes === undefined || b.length === bytes ? b : null;
};

/** La conversation en clair telle qu'elle part chiffrée : les 20 derniers messages, puis les plus anciens retirés tant
 *  qu'elle dépasse 60 Kio ; seuls role et content sont recopiés. */
export function copilotRequestBytes(messages: CopilotMessage[], user?: string | null, lang?: CopilotLang): Uint8Array {
  const enc = new TextEncoder();
  let kept = messages.slice(-COPILOT_MAX_MESSAGES).map((m) => ({ role: m.role, content: m.content }));
  const make = () => enc.encode(JSON.stringify({ messages: kept, user: user && isAddress(user, { strict: false }) ? user : null, ...(lang ? { lang } : {}) }));
  let bytes = make();
  while (kept.length > 1 && bytes.length > COPILOT_MAX_PLAINTEXT_BYTES) {
    kept = kept.slice(1);
    bytes = make();
  }
  return bytes;
}

export class AttestedCopilotClient {
  readonly d: Deployment;
  private keys?: VerifiedCopilot;
  private readonly f: typeof fetch;

  constructor(private o: AttestedCopilotClientOptions) {
    this.d = o.deployment ?? testnet;
    // appelée comme fonction, jamais comme méthode : dans un navigateur, fetch appelé avec `this` = ce client lève
    // « Illegal invocation » (Node l'accepte, les tests ne le voyaient pas : vérification navigateur du 9/11)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    if (!o.copilotUrl) throw new Error("copilote attesté : copilotUrl requis");
  }

  private base() { return this.o.copilotUrl.replace(/\/+$/, ""); }

  /** La clé du copilote, vérifiée on-chain (refait après `reverifyMs`, ou tout de suite avec force). */
  async verifiedKeys(force = false): Promise<VerifiedCopilot> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    const k = await verifyEnclaveKeys(this.o.copilotUrl, this.o.productId, {
      publicClient: this.o.publicClient, deployment: this.d, fetch: this.f,
      ...(this.o.expectedOperator ? { expectedOperator: this.o.expectedOperator } : {}),
    });
    // fait foi MAINTENANT (EnclaveRegistry.attestedOperator, v2.1) : lu au bloc même de la vérification
    const blockNumber = k.checkedAtBlock;
    const pub = this.o.publicClient;
    const [active, allowed, banned, product] = (await Promise.all([
      pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "isActive", args: [k.productId], blockNumber }),
      pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "isWorkloadAllowed", args: [k.productId, k.workloadId], blockNumber }),
      pub.readContract({ address: this.d.operatorBond, abi: operatorBondAbi, functionName: "banned", args: [k.operator], blockNumber }),
      pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [k.productId], blockNumber }),
    ])) as [boolean, boolean, boolean, { param: Hex }];
    const at = { enclaveUrl: k.enclaveUrl, productId: k.productId, signer: k.signer, announcedX25519: k.x25519, registeredX25519: k.x25519, block: blockNumber };
    if (!active) throw new EnclaveKeyMismatchError("inactive", `le produit #${k.productId} n'est pas actif au bloc ${blockNumber}`, at);
    if (!allowed) {
      throw new EnclaveKeyMismatchError("inactive", `l'image de l'enclave ${k.signer} (${k.workloadId}) n'est plus autorisée par le produit #${k.productId}`, at);
    }
    if (banned) throw new EnclaveKeyMismatchError("inactive", `l'opérateur ${k.operator} de l'enclave ${k.signer} est radié`, at);
    this.keys = { ...k, productParam: product.param };
    return this.keys;
  }

  /** Envoie la conversation chiffrée et rend la réponse ouverte (ou un refus en clair d'avant le déchiffrement). */
  async chat(req: CopilotChatRequest): Promise<CopilotChatResult> {
    return this.send(req, false);
  }

  private async send(req: CopilotChatRequest, retried: boolean): Promise<CopilotChatResult> {
    if (!req || !Array.isArray(req.messages) || req.messages.length === 0) throw new Error("copilote : au moins un message");
    const lang = req.lang ?? this.o.lang;
    const keys = await this.verifiedKeys();
    const plaintext = copilotRequestBytes(req.messages, req.user ?? null, lang);
    // info liée à la chaîne, au registre, au produit et au signataire VÉRIFIÉS : seule cette enclave ouvre la requête
    const info = exchangeInfo(COPILOT_SEALED_TAG, this.d.chainId, this.d.enclaveRegistry, keys.productId, keys.signer);
    const sx = await sealExchange(toBytes(keys.x25519), COPILOT_SEALED_TAG, info, plaintext);
    const res = await this.f(`${this.base()}/chat`, {
      method: "POST",
      // aucun en-tête Accept-Language : la langue est DANS le chiffré (le relais ne la voit pas) ; les refus d'avant le
      // déchiffrement sont mis en mots ici, dans cette langue
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sealed: COPILOT_SEALED_TAG, enc: toHex(sx.enc), ciphertext: toHex(sx.ciphertext) }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 180_000),
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (res.ok && j && j.sealed === COPILOT_SEALED_TAG) {
      const nonce = hexOf(j.nonce, EXCHANGE_RESPONSE_NONCE_BYTES);
      const ct = hexOf(j.ciphertext);
      if (!nonce || !ct) throw new CopilotResponseError("réponse scellée illisible (nonce de 32 octets et chiffré hexadécimal attendus)");
      let inner: any;
      try {
        inner = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sx.openResponse(nonce, ct)));
      } catch {
        throw new CopilotResponseError("elle ne s'ouvre pas avec le secret de cette requête : elle ne vient pas de l'enclave vérifiée, ou elle a été modifiée");
      }
      if (!inner || typeof inner !== "object" || !Number.isSafeInteger(inner.status) || !inner.body || typeof inner.body !== "object" || Array.isArray(inner.body)) {
        throw new CopilotResponseError("réponse scellée de forme inattendue");
      }
      const reply = inner.body as CopilotReply;
      if (typeof reply.text !== "string") reply.text = "";
      return { status: inner.status, ok: inner.status === 200, reply, authenticated: true, enclave: keys } satisfies AuthenticatedCopilotChat;
    }
    if (res.ok) {
      throw new CopilotResponseError("réponse en clair à une requête chiffrée (ce n'est pas le copilote attesté, ou un mandataire l'a remplacée)");
    }
    // clé changée depuis la vérification (redémarrage du copilote) : revérifier sur la chaîne, renvoyer UNE fois
    if (res.status === 400 && j?.code === "sealed_undecryptable" && !retried) {
      const fresh = await this.verifiedKeys(true);
      if (fresh.signer.toLowerCase() !== keys.signer.toLowerCase() || fresh.x25519 !== keys.x25519) return this.send(req, true);
    }
    // refus EN CLAIR : rien ne prouve qu'il vienne de l'enclave vérifiée (un relais peut l'écrire) ; ni `enclave`, ni le
    // texte du relais : un message local d'après le code (seulement s'il a la forme d'un code), et le délai annoncé
    const code = typeof j?.code === "string" && /^[a-z0-9_]{1,64}$/.test(j.code) ? j.code : undefined;
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      status: res.status,
      ok: false,
      authenticated: false,
      reply: {
        text: plainRefusalText(lang ?? "en", code, res.status),
        ...(code ? { code } : {}),
        ...(Number.isSafeInteger(retryAfter) && retryAfter > 0 && retryAfter <= 86_400 ? { retryAfterSec: retryAfter } : {}),
      },
    };
  }
}

/** Le client du copilote attesté (voir l'en-tête). */
export function createAttestedCopilotClient(o: AttestedCopilotClientOptions): AttestedCopilotClient {
  return new AttestedCopilotClient(o);
}
