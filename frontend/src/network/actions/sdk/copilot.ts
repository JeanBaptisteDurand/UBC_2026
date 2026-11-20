/** copilot.ts — the ATTESTED copilot: talk to ArcHive's copilot, which runs in an Intel TDX enclave registered on Arc,
 *  without the web server that relays the conversation (or any other proxy) being able to read or change it.
 *
 *  createAttestedCopilotClient({ copilotUrl, productId, publicClient }):
 *   1. BEFORE anything is sent, checks the copilot's key on the chain: verifyEnclaveKeys (signer registered for THIS
 *      product, X25519 key from /pubkeys = the registered one, enclave active at the head block), then, AT THE SAME
 *      BLOCK, that it is authoritative now (as EnclaveRegistry.attestedOperator on v2.1): product active, image
 *      (workloadId) still allowed by the product, operator not banned. Otherwise EnclaveKeyMismatchError, and nothing is
 *      sent. A copilot whose quote is simulated (no TDX) cannot be registered, so it is always refused here.
 *   2. encrypts the conversation (messages, wallet, language) to that key: HPKE, label ARC-COPILOT-CHAT-v1, info bound to
 *      the chain, the registry, the product and the signer (sealed-exchange.ts);
 *   3. opens the answer, sealed by the enclave for THIS request: a proxy can neither read it, nor change it (prepared
 *      actions to sign included), nor replay the answer to another request. A plaintext answer to an encrypted request,
 *      or one that does not open, is refused (CopilotResponseError).
 *  Refusals from before decryption (proxy, origin, rate limit per IP, size, format: 403, 429, 413, 415, 400) arrive in
 *  plaintext, so WITHOUT proof of origin: a relay could forge them ("Session expired: paste your recovery phrase
 *  at …"). The result then has `authenticated: false`, NO `enclave` (an "attested" badge can only come from a sealed
 *  answer, `authenticated === true`), and a `reply.text` written HERE from the code and the request's language: the
 *  relay's text is never reused.
 *  The language travels INSIDE the ciphertext (lang field), no longer in an Accept-Language header: the relay cannot see it.
 *  After a copilot restart (new keys, registered again by the registrar), the enclave answers "undecryptable": the
 *  client checks the key on the chain again and resends ONCE if the registered key changed.
 *  Server side: services/copilot/src/enclave-app.ts (same label; enclave kit: enclave/src/kit/hpke-exchange.ts). */
import { type Address, type Hex, type PublicClient, isAddress, toBytes, toHex } from "viem";
import { operatorBondAbi, productRegistryAbi } from "./abis";
import { testnet, type Deployment } from "./network";
import { EnclaveKeyMismatchError, verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import { EXCHANGE_RESPONSE_NONCE_BYTES, exchangeInfo, sealExchange } from "./sealed-exchange";

/** The protocol label (the `sealed` field of the POST /chat body; same value on the copilot side). */
export const COPILOT_SEALED_TAG = "ARC-COPILOT-CHAT-v1";
/** Langues du copilote. */
export type CopilotLang = "en" | "fr";
/** The copilot keeps the last 20 messages; the client sends no more. */
export const COPILOT_MAX_MESSAGES = 20;
/** Maximum size of the plaintext conversation (the copilot refuses above 64 KiB): the oldest messages are dropped. */
export const COPILOT_MAX_PLAINTEXT_BYTES = 60 * 1024;

export interface CopilotMessage { role: "user" | "assistant"; content: string }
/** An action PREPARED by the copilot (never executed): the user checks it and signs it themselves. */
export interface CopilotAction { tool: string; input: unknown; result: unknown }
/** The copilot's answer (same shape as in plaintext mode). */
export interface CopilotReply {
  /** What the bubble shows (in the requested language). */
  text: string;
  tools?: string[];
  citations?: string[];
  /** Site page to open (route id, as the copilot names it: vue, ruche, produits, primes, playground, cles…). */
  navigate?: string;
  actions?: CopilotAction[];
  /** Machine code: a model error (modele_429…) or a refusal (bad_conversation, global_cap, too_large…). */
  code?: string;
  error?: string;
  outilsNonExecutes?: number;
  retryAfterSec?: number;
}

/** The copilot's key, verified on-chain, and what is authoritative now at the same block. */
export interface VerifiedCopilot extends VerifiedEnclaveKeys {
  /** Product.param (keccak256 of the model id pinned by the product). */
  productParam: Hex;
}

export interface AttestedCopilotClientOptions {
  /** URL of the copilot enclave (direct at Phala, or behind the site's proxy, e.g. https://…/enclave/copilot). */
  copilotUrl: string;
  /** The copilot's product, registered on Arc. */
  productId: bigint;
  publicClient: PublicClient;
  /** Stack to read (default: the SDK's testnet stack; or deploymentFromJson(deployments.v21.testnet.json)). */
  deployment?: Deployment;
  /** Default requested language (otherwise the copilot answers in the language of the last message). */
  lang?: CopilotLang;
  /** If given: the enclave must be active for THIS operator. */
  expectedOperator?: Address;
  fetch?: typeof fetch;
  /** Check the key on-chain again at the latest after this delay (ms, default 5 min). */
  reverifyMs?: number;
  /** Timeout of a request (ms, default 180,000; the copilot stops at 150 s). */
  timeoutMs?: number;
}

export interface CopilotChatRequest {
  messages: CopilotMessage[];
  /** Connected wallet: the default address of prepared actions (or null). */
  user?: Address | string | null;
  lang?: CopilotLang;
}

/** An answer SEALED by the verified enclave: opened with THIS request's secret, so written by that enclave. */
export interface AuthenticatedCopilotChat {
  /** Status of the answer, the copilot's own (inside the ciphertext): 200, 400, 413, 429… */
  status: number;
  ok: boolean;
  reply: CopilotReply;
  authenticated: true;
  /** The verified enclave (on Arc, at block checkedAtBlock) that wrote this answer: enough to show a badge. */
  enclave: VerifiedCopilot;
}
/** A PLAINTEXT refusal from before decryption: nothing of the conversation, but no proof of origin (a relay could
 *  forge it). No `enclave` and no relay text: `reply.text` is a local message taken from `reply.code`. */
export interface UnauthenticatedCopilotChat {
  /** HTTP status seen on the wire (not authenticated). */
  status: number;
  ok: false;
  reply: CopilotReply;
  authenticated: false;
  enclave?: undefined;
}
/** The result of an exchange: show "attested" (and `enclave`) only if `authenticated === true`. */
export type CopilotChatResult = AuthenticatedCopilotChat | UnauthenticatedCopilotChat;

/** Local messages for plaintext refusals (the relay's text is never reused), by code. */
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

/** The answer does not come from the verified enclave (or does not answer this request): it is not returned. */
export class CopilotResponseError extends Error {
  constructor(message: string) { super(`réponse du copilote refusée : ${message}`); this.name = "CopilotResponseError"; }
}

const hexOf = (x: unknown, bytes?: number): Uint8Array | null => {
  if (typeof x !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(x)) return null;
  const b = toBytes(x as Hex);
  return bytes === undefined || b.length === bytes ? b : null;
};

/** The plaintext conversation as it leaves encrypted: the last 20 messages, then the oldest removed while it is over
 *  60 KiB; only role and content are copied. */
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
    // called as a function, never as a method: in a browser, fetch called with `this` = this client throws
    // "Illegal invocation" (Node accepts it, so only a browser check shows it)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    if (!o.copilotUrl) throw new Error("copilote attesté : copilotUrl requis");
  }

  private base() { return this.o.copilotUrl.replace(/\/+$/, ""); }

  /** The copilot's key, verified on-chain (done again after `reverifyMs`, or at once with force). */
  async verifiedKeys(force = false): Promise<VerifiedCopilot> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    const k = await verifyEnclaveKeys(this.o.copilotUrl, this.o.productId, {
      publicClient: this.o.publicClient, deployment: this.d, fetch: this.f,
      ...(this.o.expectedOperator ? { expectedOperator: this.o.expectedOperator } : {}),
    });
    // authoritative NOW (EnclaveRegistry.attestedOperator, v2.1): read at the very block of the check
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

  /** Sends the encrypted conversation and returns the opened answer (or a plaintext refusal from before decryption). */
  async chat(req: CopilotChatRequest): Promise<CopilotChatResult> {
    return this.send(req, false);
  }

  private async send(req: CopilotChatRequest, retried: boolean): Promise<CopilotChatResult> {
    if (!req || !Array.isArray(req.messages) || req.messages.length === 0) throw new Error("copilote : au moins un message");
    const lang = req.lang ?? this.o.lang;
    const keys = await this.verifiedKeys();
    const plaintext = copilotRequestBytes(req.messages, req.user ?? null, lang);
    // info bound to the VERIFIED chain, registry, product and signer: only this enclave can open the request
    const info = exchangeInfo(COPILOT_SEALED_TAG, this.d.chainId, this.d.enclaveRegistry, keys.productId, keys.signer);
    const sx = await sealExchange(toBytes(keys.x25519), COPILOT_SEALED_TAG, info, plaintext);
    const res = await this.f(`${this.base()}/chat`, {
      method: "POST",
      // no Accept-Language header: the language is INSIDE the ciphertext (the relay cannot see it); refusals from before
      // decryption are put into words here, in that language
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
    // key changed since the check (copilot restart): check on the chain again, resend ONCE
    if (res.status === 400 && j?.code === "sealed_undecryptable" && !retried) {
      const fresh = await this.verifiedKeys(true);
      if (fresh.signer.toLowerCase() !== keys.signer.toLowerCase() || fresh.x25519 !== keys.x25519) return this.send(req, true);
    }
    // PLAINTEXT refusal: nothing proves it comes from the verified enclave (a relay could write it); no `enclave` and no
    // relay text: a local message from the code (only if it has the shape of a code), and the announced delay
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
