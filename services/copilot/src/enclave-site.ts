/** enclave-site.ts — the "site" surface (COPILOT_SURFACE=site) of the copilot INSIDE its Intel TDX enclave (product 4):
 *  the site's panel talks to the SAME program as the site copilot on the server: the same app.ts loop (interface tools
 *  validated then returned to the browser, prepare tools whose result the visitor signs with THEIR OWN wallet,
 *  docs_search, no tool that spends, secrets filter), the same prompt and the same tools (copilot.ts, site.ts).
 *  The sealed request carries the same JSON as the server's (messages, lang, user, page); the reply has the site
 *  contract's shape (text, tools, citations, actions), sealed for that client only. This module adds three things:
 *
 *  1. WHERE IT RUNS, stated correctly (siteEnclaveNote, in English like the site's prompt): in a real TDX VM, it says it
 *     runs in product 4's enclave; outside TDX (simulated quote, development), it says the opposite and never claims to
 *     be in an enclave. Whether the conversation is encrypted or in clear is stated as it is; the model stays at its
 *     provider (behind a gateway the enclave verifies, or not). This note REPLACES the server's: in app.ts, systemNote
 *     takes precedence over site.whereNote (SITE_WHERE_NOTE, "on the ArcHive site's server, NOT in an enclave"), and
 *     whereNote is also removed from the enclave's options.
 *  2. A GUARD (siteEnclaveSystem): the prompt the enclave serves contains no server sentence ("you run on the site's
 *     server", SITE_WHERE_NOTE…); otherwise the enclave refuses to start (fail closed, never two truths).
 *  3. EVERY SEALED REPLY IS SIGNED (signingSealedChannel) by the enclave's secp256k1 key, the one Arc holds for
 *     product 4, in a format any client can check (verifySiteReply below):
 *       inside the ciphertext: { status, body, sig: { v: SITE_REPLY_TAG, signer, requestHash, bodyHash, digest, signature } }
 *       requestHash = keccak256(enc ‖ ciphertext) of the sealed question, as received;
 *       bodyHash    = keccak256(utf8(JSON.stringify(body))) (the client recomputes it on the opened JSON: JSON.stringify
 *                     gives back the same bytes on what it produced itself);
 *       digest      = keccak256(abi.encode(string SITE_REPLY_TAG, uint256 chainId, address EnclaveRegistry,
 *                     uint256 productId, address signer, bytes32 requestHash, bytes32 bodyHash));
 *       signature   = an EIP-191 signature of the digest's 32 bytes (personal_sign of { raw: digest }), 65 bytes.
 *     The seal proves the reply to that client only; the signature makes it verifiable by anyone (a judge included)
 *     with the key registered on Arc (EnclaveRegistry.enclaveOf). The status is not signed (it stays inside the seal).
 *     The site's panel relies on the seal; checking the signature in the panel too is a next step. */
import { type Address, type Hex, concat, encodeAbiParameters, getAddress, keccak256, recoverMessageAddress, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { COPILOT_SEALED_TAG } from "@arcvault/sdk";
import type { EnclaveKit } from "../../../enclave/src/kit/enclave-kit";
import type { CopilotAppOptions, SealedChannel, SiteSurface } from "./app";
import type { EnclaveFacts } from "./enclave-app";
import * as site from "./site";

// ---------------------------------------------------------------- 3. the signature of every sealed reply

/** The signature tag of a site reply. */
export const SITE_REPLY_TAG = "ARC-COPILOT-SITE-REPLY-v1";

/** What the enclave adds inside the ciphertext of every reply: what is needed to verify it without trusting anything
 *  else. */
export interface SiteReplySig {
  v: typeof SITE_REPLY_TAG;
  /** The enclave's key (the one Arc holds for the product): the signature must recover it. */
  signer: Address;
  requestHash: Hex;
  bodyHash: Hex;
  digest: Hex;
  /** EIP-191 over the digest's 32 bytes, 65 bytes (r ‖ s ‖ v). */
  signature: Hex;
}

/** The fingerprint of the sealed question, as received: keccak256(enc ‖ ciphertext). */
export const siteRequestHash = (enc: Uint8Array, ciphertext: Uint8Array): Hex => keccak256(concat([enc, ciphertext]));

/** The fingerprint of the reply body: keccak256(utf8(JSON.stringify(body))). */
export const siteBodyHash = (body: unknown): Hex => keccak256(stringToBytes(JSON.stringify(body)));

export interface SiteReplyContext {
  chainId: number | bigint;
  registry: Address;
  productId: bigint;
  signer: Address;
}

/** The signed digest: keccak256(abi.encode(tag, chainId, registry, product, signer, requestHash, bodyHash)). */
export function siteReplyDigest(c: SiteReplyContext & { requestHash: Hex; bodyHash: Hex }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [SITE_REPLY_TAG, BigInt(c.chainId), c.registry, c.productId, c.signer, c.requestHash, c.bodyHash],
  ));
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The sealed conversation (like enclave-app.ts's copilotSealedChannel), each reply of which is also SIGNED by the
 *  enclave's key. A reply that is not { status, body } would go out sealed without a signature (a client then sees it
 *  as sealed, never signed); app.ts produces none. */
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
            log("[copilot] sealed reply outside the { status, body } shape: sent without a signature");
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

/** Verifies the signature of an opened reply (the reference for the tests and for any client): the
 *  digest is recomputed from the question this client SEALED (enc, ciphertext) and the opened body, then the signature
 *  must recover the key Arc holds. Never throws. */
export async function verifySiteReply(
  inner: unknown, o: SiteReplyContext & { enc: Uint8Array; ciphertext: Uint8Array },
): Promise<{ ok: true; digest: Hex; signer: Address } | { ok: false; why: string }> {
  if (!isObj(inner) || !isObj(inner.body)) return { ok: false, why: "reply outside the { status, body } shape" };
  const sig = isObj(inner.sig) ? inner.sig : null;
  if (!sig || sig.v !== SITE_REPLY_TAG) return { ok: false, why: "unsigned reply" };
  if (typeof sig.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig.signature)) return { ok: false, why: "unreadable signature" };
  const requestHash = siteRequestHash(o.enc, o.ciphertext);
  const bodyHash = siteBodyHash(inner.body);
  const digest = siteReplyDigest({ ...o, requestHash, bodyHash });
  let who: Address;
  try { who = await recoverMessageAddress({ message: { raw: digest }, signature: sig.signature as Hex }); } catch { return { ok: false, why: "unreadable signature" }; }
  if (who.toLowerCase() !== o.signer.toLowerCase()) return { ok: false, why: `signed by ${who}, not by the registered key ${o.signer}` };
  return { ok: true, digest, signer: getAddress(who) };
}

// ---------------------------------------------------------------- 1. where it runs

/** The "where you run" note of the site surface in the enclave, added to the prompt of EVERY request (after the page
 *  line, before the language instruction). In English, like the site's prompt (each accented character counts 3 tokens
 *  in app.ts's input budget). `signs`: the sealed replies are signed (signingSealedChannel). */
export function siteEnclaveNote(f: EnclaveFacts & { signs: boolean }): (x: { sealed: boolean }) => string {
  const model = f.modelAttested
    ? `The model (${f.model}) runs at its provider (${f.provider}), never in this enclave: before calling it, this enclave verified that the provider's gateway (${f.modelAttested.origin}) itself runs in an attested Intel TDX enclave (Intel quote, production OS image, measured compose ${f.modelAttested.composeHash.slice(0, 12)}...), pins the connection to its attested key and requires the gateway's receipt on every answer: so the conversation is read only by attested enclaves (this one, the model's gateway and its upstream), not by their operators nor by ArcHive. Claim no more: the gateway's code is open but its version is not pinned.`
    : `The model (${f.model}) runs at its provider (${f.provider}), never in this enclave, and the provider receives the conversation in clear to run the inference: never say that only the enclave, or nobody else, can read it.`;
  // In an independent check, 3 answers out of 7 to "does this chat run in an enclave?" said "no" or "on the server" (the
  // model trusted a stale docs_search passage over this note), and none named the model's gateway. So the note says that
  // it also overrides the site's knowledge base, and how to answer that question without docs_search: where it runs, why
  // to trust it, and who else reads the conversation.
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
      ? `Asked whether this chat runs in an enclave, or where you run: answer from these lines, never from docs_search, in three or four sentences: yes, this conversation is sealed to the enclave of product #4 (Intel TDX); why trust it: the site's panel checks on Arc that your key is registered for product #4 (Arc itself verified its Intel quote, DCAP, for an image the product's author allowed) before sealing to it${f.signs ? ", and each answer carries your signature, which any client can check against that key" : ""}; then one sentence on who else reads it: ${others}.`
      : `Asked whether this chat runs in an enclave, or where you run: answer from these lines, never from docs_search: this program runs in the enclave of product #4 (Intel TDX), but this conversation arrived in clear, so the web server relaying it can read it; then one sentence on who else reads it: ${others}.`;
    return [where, channel, model, ask].join(" ");
  };
}

// ---------------------------------------------------------------- 2. l'invite servie : aucune phrase du serveur

/** The sentences that tell the copilot it runs on the site's server: true on the server, false here. */
export const SERVER_CLAIMS: readonly RegExp[] = [
  /\byou(?:'re| are)? (?:run(?:ning)?|live|living) on (?:the |ArcHive's |the site's |our )?(?:site'?s? |web )?server/i,
  /\bnot you: you run\b/i,
  /\byou(?:'re| are) (?:not|never) (?:in|inside) (?:an|the|its|our) (?:Intel TDX )?enclave/i,
  /\btu tournes sur le serveur/i,
  // the site server's note (SITE_WHERE_NOTE): "WHERE YOU RUN: on the ArcHive site's server, NOT in an enclave"
  /\bWHERE YOU RUN:? on (?:the )?(?:ArcHive(?:'s)? )?(?:site'?s? )?(?:web )?server/i,
  /\bNOT in an enclave\b/,
];

/** The site's prompt as the enclave serves it: the server's note (site.ts's SITE_WHERE_NOTE, when it exists and was
 *  written into it) is removed; if a server sentence remains, the enclave refuses to start. */
export function siteEnclaveSystem(system: string): string {
  const serverNote = (site as unknown as Record<string, unknown>).SITE_WHERE_NOTE;
  let s = system;
  if (typeof serverNote === "string" && serverNote.trim()) s = s.split(serverNote).join("");
  const hit = SERVER_CLAIMS.find((re) => re.test(s));
  if (hit) {
    throw new Error(`site prompt: it still says the copilot runs on the server (${hit.source.slice(0, 60)}…); the enclave refuses to serve two truths`);
  }
  return s;
}

/** The options of the SITE copilot in the enclave: the server's (copilotFromEnv, COPILOT_SURFACE=site), a checked
 *  prompt, the enclave's "where you run" note in place of the server's, and a /health that says where it runs and that
 *  its replies are signed. Throws when the surface is not site, or when the prompt still says "on the server". */
export function siteEnclaveOptions(base: Omit<CopilotAppOptions, "sealed" | "proxyToken">, f: EnclaveFacts): Omit<CopilotAppOptions, "sealed" | "proxyToken"> {
  if (!base.site) throw new Error("site copilot in an enclave: COPILOT_SURFACE=site required (site surface missing)");
  const note = siteEnclaveNote({ ...f, signs: true });
  for (const sealed of [true, false]) {
    if (SERVER_CLAIMS.some((re) => re.test(note({ sealed })))) throw new Error("enclave note: a server sentence");
  }
  // the server's note (site.whereNote, which app.ts reads only without a systemNote) does not even travel here
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
