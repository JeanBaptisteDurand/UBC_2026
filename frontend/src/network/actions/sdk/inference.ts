/** inference.ts — client compatible OpenAI (pile v2) : chiffre vers l'enclave, signe avec la clé de session, appelle le
 *  produit d'inférence, vérifie chaque reçu. Conçu pour la boucle « un appel = un reçu ».
 *
 *  v2 (revue de sécurité du 7/11) : la clé X25519 n'est JAMAIS prise telle quelle sur /pubkeys (qui passe par un
 *  mandataire). Avant le premier chiffrement, et de nouveau toutes les `reverifyMs`, verifyEnclaveKeys exige : clé
 *  X25519 = celle inscrite on-chain pour ce signataire, enclave active pour le produit de la session au bloc de tête,
 *  signataire = l'enclave VERROUILLÉE à l'ouverture de la session, même opérateur. Sinon EnclaveKeyMismatchError et
 *  rien n'est envoyé.
 *
 *  Chaque réponse est authentifiée de bout en bout : le reçu doit être signé par CETTE enclave, porter la session et le
 *  seq de la requête, le hash de l'invite envoyée (requestHash) et celui du texte reçu (responseHash) ; sinon
 *  ReceiptMismatchError (le texte n'est pas rendu). `verified` dit en plus si SessionPay.settle paierait ce reçu
 *  (enclave active au bloc d'ancrage chez l'opérateur de la session, modèle verrouillé). */
import { type Address, type Hex, type PublicClient, keccak256, toBytes, toHex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hpkeSeal, hpkeOpen, generateX25519, type SessionKey } from "./crypto";
import { envelopeDigest, normalizeReceipt, recoverReceiptSigner, type Receipt } from "./eip712";
import { enclaveRegistryAbi } from "./abis";
import { testnet, type Deployment } from "./network";
import { verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import { readSession, type SessionInfo } from "./receipts";

export interface InferenceClientOptions {
  /** La passerelle du produit (O2), en direct ou derrière un mandataire : ses clés sont vérifiées on-chain. */
  enclaveUrl: string;
  sessionId: bigint;
  /** Clé de session (l'adresse est recalculée depuis la clé privée si elle manque ou est nulle). */
  sessionKey: SessionKey;
  publicClient: PublicClient;
  deployment?: Deployment;
  /** Revérifier les clés de l'enclave on-chain au plus tard après ce délai (ms, défaut 5 min). */
  reverifyMs?: number;
  fetch?: typeof fetch;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatRequest { messages: ChatMessage[]; temperature?: number; max_tokens?: number; seed?: number; }
/** `signature` : la signature EIP-712 du reçu par l'enclave. Gardez le dernier couple (receipt, signature) d'une session :
 *  c'est la preuve de ce que vous devez, et n'importe qui peut le régler on-chain (settle) au profit de l'opérateur. */
export interface Completion { text: string; receipt: Receipt; signature: Hex; signer: Address; verified: boolean; }

/** 402 : le solde de la session ne couvre pas cette requête. `pending` : une réponse déjà calculée attend (rechargez la
 *  session, puis `retryPending()` la livre sans relancer le modèle). */
export class InsufficientSessionBalance extends Error {
  constructor(public balance: bigint, public pending?: { seq: bigint; cost: bigint }) {
    super(pending
      ? `solde de session insuffisant : une réponse calculée attend (coût ${pending.cost} en unités de base d'USDC) ; rechargez la session puis rejouez-la`
      : "insufficient_session_balance");
    this.name = "InsufficientSessionBalance";
  }
}
/** 410 : session close, échue, ou à moins de 60 s de son échéance (l'enclave ne la sert plus). */
export class SessionExpiredError extends Error {
  constructor(message: string) { super(message); this.name = "SessionExpiredError"; }
}
/** La réponse ne vient pas de l'enclave vérifiée, ou ne correspond pas à la requête : son texte n'est pas rendu. */
export class ReceiptMismatchError extends Error {
  constructor(message: string) { super(`réponse refusée : ${message}`); this.name = "ReceiptMismatchError"; }
}

/** L'invite telle que l'enclave la hache (requestHash = keccak256 de ce texte). */
export function promptOf(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}
/** Les paramètres tels que l'enclave les hache (paramsHash = keccak256(JSON)). */
function paramsOf(req: ChatRequest) {
  return { temperature: req.temperature, maxTokens: req.max_tokens, seed: req.seed };
}

export class InferenceClient {
  private seq = 0n;
  private keys?: VerifiedEnclaveKeys;
  private session?: SessionInfo;
  private pending?: { seq: bigint; req: ChatRequest };
  private readonly d: Deployment;
  private readonly f: typeof fetch;
  private readonly account;

  constructor(private o: InferenceClientOptions) {
    this.d = o.deployment ?? testnet;
    // appelée comme fonction, jamais comme méthode : dans un navigateur, fetch appelé avec `this` = ce client lève
    // « Illegal invocation » (Node l'accepte, les tests ne le voyaient pas : vérification navigateur du 9/11)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    this.account = privateKeyToAccount(o.sessionKey.privateKey); // l'adresse vient de la clé, jamais d'un paramètre
  }

  private base() { return this.o.enclaveUrl.replace(/\/$/, ""); }

  /** Les clés de l'enclave, vérifiées on-chain contre la session (refait après `reverifyMs`). */
  async verifiedKeys(force = false): Promise<VerifiedEnclaveKeys> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    const s = await readSession(this.o.publicClient, this.d, this.o.sessionId);
    if (s.owner === zeroAddress) throw new Error(`session #${this.o.sessionId} inconnue de SessionPay`);
    if (s.closed) throw new SessionExpiredError(`session #${this.o.sessionId} close`);
    if (s.sessionKey.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error(`la clé de session fournie (${this.account.address}) n'est pas celle de la session #${this.o.sessionId} (${s.sessionKey}) : clé tournée ou erronée`);
    }
    this.keys = await verifyEnclaveKeys(this.o.enclaveUrl, s.productId, {
      publicClient: this.o.publicClient, deployment: this.d, expectedSigner: s.enclave, expectedOperator: s.operator, fetch: this.f,
    });
    this.session = s;
    return this.keys;
  }

  get models() {
    return { list: async () => (await this.f(`${this.base()}/v1/models`)).json() };
  }

  get chat() {
    return { completions: { create: (req: ChatRequest) => this.create(req) } };
  }

  /** Après un 402 avec réponse en attente et une recharge de la session : livre la réponse gardée par l'enclave. */
  async retryPending(): Promise<Completion> {
    if (!this.pending) throw new Error("aucune réponse en attente");
    return this.create(this.pending.req);
  }

  private async create(req: ChatRequest, resynced = false): Promise<Completion> {
    if (this.pending && JSON.stringify(this.pending.req) !== JSON.stringify(req)) {
      throw new Error(`une réponse déjà calculée attend (seq ${this.pending.seq}) : rechargez la session puis rejouez la même requête (retryPending)`);
    }
    const keys = await this.verifiedKeys();
    const prompt = promptOf(req.messages);
    const params = paramsOf(req);
    const eph = generateX25519();
    const sealed = await hpkeSeal(toBytes(keys.x25519), new TextEncoder().encode(prompt)); // clé VÉRIFIÉE on-chain
    const ciphertext = toHex(sealed.ciphertext);
    const enc = toHex(sealed.enc);
    const seq = this.pending?.seq ?? this.seq + 1n;
    this.seq = seq;
    const digest = envelopeDigest(this.o.sessionId, seq, ciphertext, eph.publicKey);
    const signature = await this.account.signMessage({ message: { raw: digest } });

    const res = await this.f(`${this.base()}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: this.o.sessionId.toString(), seq: seq.toString(), enc, ciphertext, clientEphemeralPub: eph.publicKey, signature, params,
      }),
    });
    if (res.status === 402) {
      const b = await res.json().catch(() => ({})) as { balance?: string; pendingSeq?: string; pendingCost?: string };
      const pending = b.pendingSeq ? { seq: BigInt(b.pendingSeq), cost: BigInt(b.pendingCost ?? "0") } : undefined;
      if (pending) this.pending = { seq: pending.seq, req };
      else this.seq = seq - 1n; // refusée avant le modèle : ce seq n'est pas consommé
      throw new InsufficientSessionBalance(BigInt(b.balance ?? "0"), pending);
    }
    if (res.status === 409) {
      const b = await res.json().catch(() => ({})) as { error?: string; expectedSeq?: string };
      // Une autre instance a servi cette session (clé aek_ partagée, redémarrage) : se recaler UNE fois sur l'enclave.
      if (!resynced && !this.pending && b.expectedSeq && /^\d+$/.test(b.expectedSeq)) {
        this.seq = BigInt(b.expectedSeq) - 1n;
        return this.create(req, true);
      }
      throw new Error(`inférence : 409 ${b.error ?? ""}`);
    }
    if (res.status === 410) {
      const b = await res.json().catch(() => ({})) as { error?: string };
      throw new SessionExpiredError(`session #${this.o.sessionId} plus servie : ${b.error ?? "close ou échue"}`);
    }
    if (res.status === 403) {
      this.keys = undefined; // à revérifier : l'enclave dit ne pas servir cette session
      const b = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(`inférence refusée par l'enclave (403) : ${b.error ?? ""}`);
    }
    if (!res.ok) throw new Error(`inférence : ${res.status} ${await res.text()}`);
    const out = await res.json() as { enc: Hex; ciphertext: Hex; receipt: any; signature: Hex };
    const plain = await hpkeOpen(eph.privateKey, toBytes(out.enc), toBytes(out.ciphertext));
    const text = new TextDecoder().decode(plain);
    this.pending = undefined;

    // Authenticité de la réponse : reçu signé par l'enclave vérifiée, pour CETTE requête et CE texte.
    const receipt = normalizeReceipt(out.receipt);
    const signer = await recoverReceiptSigner(this.d.sessionPay, receipt, out.signature, this.d.chainId);
    if (signer.toLowerCase() !== keys.signer.toLowerCase()) throw new ReceiptMismatchError(`reçu signé par ${signer}, pas par l'enclave vérifiée ${keys.signer}`);
    if (receipt.sessionId !== this.o.sessionId || receipt.seq !== seq) throw new ReceiptMismatchError(`reçu de la session #${receipt.sessionId} seq ${receipt.seq}, requête #${this.o.sessionId} seq ${seq}`);
    if (receipt.requestHash.toLowerCase() !== keccak256(toBytes(prompt)).toLowerCase()) throw new ReceiptMismatchError("le reçu ne porte pas le hash de l'invite envoyée");
    if (receipt.responseHash.toLowerCase() !== keccak256(toBytes(text)).toLowerCase()) throw new ReceiptMismatchError("le texte reçu n'est pas celui que l'enclave a signé");
    if (receipt.paramsHash.toLowerCase() !== keccak256(toBytes(JSON.stringify(params))).toLowerCase()) throw new ReceiptMismatchError("le reçu ne porte pas les paramètres envoyés");

    // Payable par SessionPay.settle ? (mêmes contrôles que le contrat, au bloc d'ancrage du reçu)
    const s = this.session!;
    const op = await this.o.publicClient.readContract({
      address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, s.productId, receipt.anchorBlock],
    }) as Address;
    const verified = receipt.productId === s.productId && signer.toLowerCase() === s.enclave.toLowerCase()
      && op.toLowerCase() === s.operator.toLowerCase() && receipt.modelHash.toLowerCase() === s.param.toLowerCase();
    return { text, receipt, signature: out.signature, signer, verified };
  }
}

export function createInferenceClient(o: InferenceClientOptions): InferenceClient { return new InferenceClient(o); }
