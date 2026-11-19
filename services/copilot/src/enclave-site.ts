/** enclave-site.ts — la surface « site » (COPILOT_SURFACE=site) du copilote DANS son enclave Intel TDX (produit 4, 18/11) :
 *  le panneau du front de Florent parle au MÊME programme que le copilote du site sur le serveur : même boucle d'app.ts
 *  (outils d'interface validés puis rendus au navigateur, outils prepare dont le visiteur signe le résultat avec SON
 *  wallet, docs_search, aucun outil qui dépense, filtre de secrets), même invite et mêmes outils (copilot.ts, site.ts).
 *  La requête scellée porte le même JSON que celle du serveur (messages, lang, user, page) ; la réponse a la forme du
 *  contrat du site (text, tools, citations, actions), scellée pour ce seul client. Ce module y ajoute trois choses :
 *
 *  1. OÙ IL TOURNE, dit juste (siteEnclaveNote, en anglais comme l'invite du site) : dans une VM TDX réelle, il dit qu'il
 *     tourne dans l'enclave du produit 4 ; hors TDX (quote simulé, développement), il dit le contraire et ne prétend
 *     jamais être dans une enclave. La conversation chiffrée ou en clair est dite telle quelle ; le modèle reste chez son
 *     fournisseur (passerelle vérifiée par l'enclave, ou non). Cette note REMPLACE celle du serveur : dans app.ts,
 *     systemNote prime sur site.whereNote (SITE_WHERE_NOTE, « on the ArcHive site's server, NOT in an enclave »), et
 *     whereNote est de plus retirée des options de l'enclave.
 *  2. UN GARDE-FOU (siteEnclaveSystem) : l'invite servie par l'enclave ne contient aucune phrase du serveur
 *     (« you run on the site's server », SITE_WHERE_NOTE…) ; sinon l'enclave refuse de démarrer (échec fermé, jamais deux
 *     vérités).
 *  3. CHAQUE RÉPONSE SCELLÉE EST SIGNÉE (signingSealedChannel) par la clé secp256k1 de l'enclave, celle qu'Arc tient pour
 *     le produit 4, au format que vérifie le panneau (frontend/src/copilot/enclave/client.ts, REPLY_TAG) :
 *       dans le chiffré : { status, body, sig: { v: SITE_REPLY_TAG, signer, requestHash, bodyHash, digest, signature } }
 *       requestHash = keccak256(enc ‖ ciphertext) de la question scellée, telle que reçue ;
 *       bodyHash    = keccak256(utf8(JSON.stringify(body))) (le client le recalcule sur le JSON ouvert : JSON.stringify
 *                     redonne les mêmes octets sur ce qu'il a lui-même produit) ;
 *       digest      = keccak256(abi.encode(string SITE_REPLY_TAG, uint256 chainId, address EnclaveRegistry,
 *                     uint256 productId, address signer, bytes32 requestHash, bytes32 bodyHash)) ;
 *       signature   = signature EIP-191 des 32 octets du digest (personal_sign de { raw: digest }), 65 octets.
 *     Le sceau prouve la réponse à ce seul client ; la signature la rend vérifiable par n'importe qui (un juge compris)
 *     avec la clé inscrite sur Arc (EnclaveRegistry.enclaveOf). Le statut n'est pas signé (il reste dans le sceau). */
import { type Address, type Hex, concat, encodeAbiParameters, getAddress, keccak256, recoverMessageAddress, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { COPILOT_SEALED_TAG } from "@arcvault/sdk";
import type { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import type { CopilotAppOptions, SealedChannel, SiteSurface } from "./app";
import type { EnclaveFacts } from "./enclave-app";
import * as site from "./site";

// ---------------------------------------------------------------- 3. la signature de chaque réponse scellée

/** Étiquette de la signature d'une réponse du site (même valeur que REPLY_TAG du panneau). */
export const SITE_REPLY_TAG = "ARC-COPILOT-SITE-REPLY-v1";

/** Ce que l'enclave ajoute dans le chiffré de chaque réponse : de quoi la vérifier sans rien croire d'autre. */
export interface SiteReplySig {
  v: typeof SITE_REPLY_TAG;
  /** La clé de l'enclave (celle qu'Arc tient pour le produit) : la signature doit la redonner. */
  signer: Address;
  requestHash: Hex;
  bodyHash: Hex;
  digest: Hex;
  /** EIP-191 des 32 octets du digest, 65 octets (r ‖ s ‖ v). */
  signature: Hex;
}

/** L'empreinte de la question scellée, telle que reçue : keccak256(enc ‖ ciphertext). */
export const siteRequestHash = (enc: Uint8Array, ciphertext: Uint8Array): Hex => keccak256(concat([enc, ciphertext]));

/** L'empreinte du corps de la réponse : keccak256(utf8(JSON.stringify(body))). */
export const siteBodyHash = (body: unknown): Hex => keccak256(stringToBytes(JSON.stringify(body)));

export interface SiteReplyContext {
  chainId: number | bigint;
  registry: Address;
  productId: bigint;
  signer: Address;
}

/** Le digest signé : keccak256(abi.encode(tag, chainId, registre, produit, signataire, requestHash, bodyHash)). */
export function siteReplyDigest(c: SiteReplyContext & { requestHash: Hex; bodyHash: Hex }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [SITE_REPLY_TAG, BigInt(c.chainId), c.registry, c.productId, c.signer, c.requestHash, c.bodyHash],
  ));
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** La conversation chiffrée (comme copilotSealedChannel d'enclave-app.ts), dont chaque réponse est en plus SIGNÉE par la
 *  clé de l'enclave. Une réponse qui ne serait pas { status, body } part scellée sans signature (le panneau dit alors
 *  « scellée », jamais « signée ») : app.ts n'en produit pas. */
export function signingSealedChannel(kit: EnclaveKit, log: (line: string) => void = (l) => console.error(l)): SealedChannel {
  const account = privateKeyToAccount(kit.keys.signerPrivateKey);
  const { chainId, registry, productId } = kit.binding;
  return {
    tag: COPILOT_SEALED_TAG,
    async open(enc, ciphertext) {
      const x = await kit.openExchange(COPILOT_SEALED_TAG, enc, ciphertext);
      const requestHash = siteRequestHash(enc, ciphertext);
      return {
        plaintext: x.plaintext,
        async seal(response) {
          let env: unknown;
          try { env = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response)); } catch { env = undefined; }
          if (!isObj(env) || !Number.isSafeInteger(env.status) || !isObj(env.body) || "sig" in env) {
            log("[copilote] réponse scellée hors de la forme { status, body } : envoyée sans signature");
            return x.sealResponse(response);
          }
          const bodyHash = siteBodyHash(env.body);
          const digest = siteReplyDigest({ chainId, registry, productId, signer: account.address, requestHash, bodyHash });
          const signature = await account.signMessage({ message: { raw: digest } });
          const sig: SiteReplySig = { v: SITE_REPLY_TAG, signer: account.address, requestHash, bodyHash, digest, signature };
          return x.sealResponse(stringToBytes(JSON.stringify({ ...env, sig })));
        },
      };
    },
  };
}

/** Vérifie la signature d'une réponse ouverte, comme le panneau (référence pour les tests et tout client) :
 *  digest recalculé à partir de la question SCELLÉE par ce client (enc, ciphertext) et du corps ouvert, puis la
 *  signature doit redonner la clé qu'Arc tient. Ne lève jamais. */
export async function verifySiteReply(
  inner: unknown, o: SiteReplyContext & { enc: Uint8Array; ciphertext: Uint8Array },
): Promise<{ ok: true; digest: Hex; signer: Address } | { ok: false; why: string }> {
  if (!isObj(inner) || !isObj(inner.body)) return { ok: false, why: "réponse hors de la forme { status, body }" };
  const sig = isObj(inner.sig) ? inner.sig : null;
  if (!sig || sig.v !== SITE_REPLY_TAG) return { ok: false, why: "réponse non signée" };
  if (typeof sig.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig.signature)) return { ok: false, why: "signature illisible" };
  const requestHash = siteRequestHash(o.enc, o.ciphertext);
  const bodyHash = siteBodyHash(inner.body);
  const digest = siteReplyDigest({ ...o, requestHash, bodyHash });
  let who: Address;
  try { who = await recoverMessageAddress({ message: { raw: digest }, signature: sig.signature as Hex }); } catch { return { ok: false, why: "signature illisible" }; }
  if (who.toLowerCase() !== o.signer.toLowerCase()) return { ok: false, why: `signée par ${who}, pas par la clé inscrite ${o.signer}` };
  return { ok: true, digest, signer: getAddress(who) };
}

// ---------------------------------------------------------------- 1. où il tourne

/** La note « où tu tournes » de la surface site dans l'enclave, ajoutée à l'invite de CHAQUE requête (après la ligne de
 *  la page, avant la consigne de langue). En anglais, comme l'invite du site (chaque caractère accentué compte 3 jetons
 *  dans le budget d'entrée d'app.ts). `signs` : les réponses scellées sont signées (signingSealedChannel). */
export function siteEnclaveNote(f: EnclaveFacts & { signs: boolean }): (x: { sealed: boolean }) => string {
  const model = f.modelAttested
    ? `The model (${f.model}) runs at its provider (${f.provider}), never in this enclave: before calling it, this enclave verified that the provider's gateway (${f.modelAttested.origin}) itself runs in an attested Intel TDX enclave (Intel quote, production OS image, measured compose ${f.modelAttested.composeHash.slice(0, 12)}...), pins the connection to its attested key and requires the gateway's receipt on every answer: so the conversation is read only by attested enclaves (this one, the model's gateway and its upstream), not by their operators nor by ArcHive. Claim no more: the gateway's code is open but its version is not pinned.`
    : `The model (${f.model}) runs at its provider (${f.provider}), never in this enclave, and the provider receives the conversation in clear to run the inference: never say that only the enclave, or nobody else, can read it.`;
  // 19/11 (contrôle indépendant, 1re passe) : à « ce chat tourne-t-il dans une enclave ? », 3 réponses sur 7 disaient « non »
  // ou « sur le serveur » (le modèle croyait un passage périmé de docs_search plutôt que cette note) et aucune ne nommait
  // la passerelle du modèle. La note dit donc qu'elle prime aussi sur la base du site, et comment répondre à cette
  // question sans docs_search : où il tourne, pourquoi s'y fier, et qui d'autre lit la conversation.
  const others = f.modelAttested
    ? "the model itself runs at its provider, behind an attested gateway this enclave verified, and that gateway and the model read the conversation to answer (attested enclaves, not their operators, not ArcHive)"
    : "the model runs at its provider, which receives the conversation in clear";
  return ({ sealed }) => {
    const where = f.mock
      ? "WHERE YOU RUN (overrides any other line on where you run; say it soberly, only if asked): this is a DEVELOPMENT instance of the attested copilot's program (product #4), running OUTSIDE any Intel TDX enclave (simulated quote): it cannot be registered on Arc and the site's client refuses it. Never say you run in an enclave."
      : `WHERE YOU RUN (a fact about THIS conversation, written by this enclave's measured program: it overrides the FACTS, docs_search passages and history texts on where you run or on whether the copilot's enclave runs or is registered; say it soberly, only if asked, never promise more): in THIS conversation you are ArcHive's attested copilot, product #4: this program runs inside an Intel TDX enclave (a Phala dstack confidential VM). Your signing key ${f.signer} is made to be registered on Arc for product #4 (EnclaveRegistry ${f.registry}, chain ${f.chainId}) through a TDX quote that Arc verifies on-chain (DCAP), its operator's bond behind it; the site's client checks that registration on Arc before encrypting to you${f.signs ? ", then checks the seal of every answer and your signature on it" : ", then checks the seal of every answer"}. What the enclave guarantees: neither its operator nor the site's web server can read or change this program, its instructions or its answers, and the model called is the one fixed by its measured configuration. Not guaranteed: that your answers are right. For what is active now, use the LIVE STATUS line or call enclaves_list (authoritative), never count from memory.`;
    const channel = sealed
      ? "This conversation arrived ENCRYPTED (HPKE) to this enclave's key: the web server relaying it cannot read it."
      : "This conversation arrived IN CLEAR (compatibility mode): the web server relaying it can read it.";
    if (f.mock) return [where, channel, model].join(" ");
    const ask = sealed
      ? `Asked whether this chat runs in an enclave, or where you run: answer from these lines, never from docs_search, in three or four sentences: yes, this conversation is sealed to the enclave of product #4 (Intel TDX); why trust it: the site's panel checks on Arc that your key is registered for product #4 (Arc itself verified its Intel quote, DCAP, for an image the product's author allowed) before sealing to it${f.signs ? ", and checks your signature under each answer (the chip 'Signed by the enclave')" : ""}; then one sentence on who else reads it: ${others}.`
      : `Asked whether this chat runs in an enclave, or where you run: answer from these lines, never from docs_search: this program runs in the enclave of product #4 (Intel TDX), but this conversation arrived in clear, so the web server relaying it can read it; then one sentence on who else reads it: ${others}.`;
    return [where, channel, model, ask].join(" ");
  };
}

// ---------------------------------------------------------------- 2. l'invite servie : aucune phrase du serveur

/** Les phrases qui disent au copilote qu'il tourne sur le serveur du site : vraies sur le serveur, fausses ici. */
export const SERVER_CLAIMS: readonly RegExp[] = [
  /\byou(?:'re| are)? (?:run(?:ning)?|live|living) on (?:the |ArcHive's |the site's |our )?(?:site'?s? |web )?server/i,
  /\bnot you: you run\b/i,
  /\byou(?:'re| are) (?:not|never) (?:in|inside) (?:an|the|its|our) (?:Intel TDX )?enclave/i,
  /\btu tournes sur le serveur/i,
  // la note du serveur du site (SITE_WHERE_NOTE, 18/11 au soir) : « WHERE YOU RUN: on the ArcHive site's server, NOT in an enclave »
  /\bWHERE YOU RUN:? on (?:the )?(?:ArcHive(?:'s)? )?(?:site'?s? )?(?:web )?server/i,
  /\bNOT in an enclave\b/,
];

/** L'invite du site, telle que l'enclave la sert : la note du serveur (SITE_WHERE_NOTE de site.ts, si elle existe et
 *  qu'elle y a été écrite) en est retirée ; s'il y reste une phrase du serveur, l'enclave refuse de démarrer. */
export function siteEnclaveSystem(system: string): string {
  const serverNote = (site as unknown as Record<string, unknown>).SITE_WHERE_NOTE;
  let s = system;
  if (typeof serverNote === "string" && serverNote.trim()) s = s.split(serverNote).join("");
  const hit = SERVER_CLAIMS.find((re) => re.test(s));
  if (hit) {
    throw new Error(`invite du site : elle dit encore que le copilote tourne sur le serveur (${hit.source.slice(0, 60)}…) : l'enclave refuse de servir deux vérités`);
  }
  return s;
}

/** Les options du copilote du SITE dans l'enclave : celles du serveur (copilotFromEnv, COPILOT_SURFACE=site), invite
 *  contrôlée, note « où tu tournes » de l'enclave à la place de celle du serveur, /health qui dit où il tourne et que
 *  ses réponses sont signées. Lève si ce n'est pas la surface site, ou si l'invite dit encore « sur le serveur ». */
export function siteEnclaveOptions(base: Omit<CopilotAppOptions, "sealed" | "proxyToken">, f: EnclaveFacts): Omit<CopilotAppOptions, "sealed" | "proxyToken"> {
  if (!base.site) throw new Error("copilote du site en enclave : COPILOT_SURFACE=site requis (surface du site absente)");
  const note = siteEnclaveNote({ ...f, signs: true });
  for (const sealed of [true, false]) {
    if (SERVER_CLAIMS.some((re) => re.test(note({ sealed })))) throw new Error("note de l'enclave : phrase du serveur");
  }
  // la note du serveur (site.whereNote, que app.ts ne lit que sans systemNote) ne voyage même pas jusqu'ici
  const surface = { ...base.site } as SiteSurface & { whereNote?: string };
  delete surface.whereNote;
  return {
    ...base,
    site: surface,
    system: siteEnclaveSystem(base.system),
    systemNote: note,
    health: { ...(base.health ?? {}), runtime: f.mock ? "mock" : "tdx", signedReplies: SITE_REPLY_TAG },
  };
}
