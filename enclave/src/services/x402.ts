/**
 * x402.ts — la couche HTTP du protocole x402 (schéma « exact », adapté à notre règlement).
 *
 * Flux : le service répond `402 Payment Required` avec les exigences de paiement ; le client renvoie
 * un en-tête `X-PAYMENT` (base64) contenant une autorisation EIP-3009 signée ; le facilitateur vérifie,
 * puis règle on-chain via `X402Settler.settle` (avec le reçu d'appel signé par l'enclave).
 *
 * Adaptation : `payTo` = le contrat X402Settler, qui encaisse par `receiveWithAuthorization`
 * (`to == msg.sender`), répartit, et exige la preuve d'enclave — paiement + preuve + split atomiques.
 *
 * v2.1 (produit « inférence payée à l'appel », enclave/products/sealed-x402) :
 *  - MONTANT EXACT : X402Settler encaisse `units × price` et la signature EIP-3009 couvre `value` : une autorisation
 *    d'un autre montant (plus OU moins) ne se règle jamais. On exige donc l'égalité stricte.
 *  - SIGNATURE CANONIQUE : l'USDC (FiatToken) refuse une signature à `s` haut ou à `v` ≠ 27/28, que viem accepte ; un
 *    appel payé ainsi serait servi puis impayable (gratuit). On exige 65 octets, `s` bas, `v` = 27 ou 28.
 *  - NONCE LIÉ À LA REQUÊTE : le nonce EIP-3009 = engagement sur la requête chiffrée (callNonce). Un en-tête X-PAYMENT
 *    rejoué sur une autre requête (mandataire, rejeu) ne correspond plus : refus avant tout appel au modèle.
 *  - responseHash LIÉ À LA REQUÊTE (callResponseHash) : le reçu part on-chain au règlement ; un hash nu d'une réponse
 *    courte (« oui », « 42 ») se devinerait. Mêlé au requestHash (requête salée par le client), il ne se devine pas.
 */
import { type Address, type Hex, encodeAbiParameters, getAddress, isAddress, keccak256, recoverTypedDataAddress, toBytes } from "viem";

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // ex. "arc-testnet"
  maxAmountRequired: string; // atomique (USDC 6 déc.)
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address; // = X402Settler
  maxTimeoutSeconds: number;
  asset: Address; // USDC
  /** Domaine EIP-712 du token (name, version) ; nos extensions (produit, enclave, règle du nonce…) s'y ajoutent. */
  extra: { name: string; version: string; [k: string]: string };
}

export interface Challenge {
  x402Version: 1;
  error: string;
  accepts: PaymentRequirements[];
}

export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Eip3009Authorization };
}

export interface ChallengeInput {
  network: string;
  amount: bigint;
  resource: string;
  description?: string;
  payTo: Address; // X402Settler
  asset: Address; // USDC
  usdcName: string; // "USDC"
  usdcVersion: string; // "2"
  maxTimeoutSeconds?: number;
  /** Nos extensions, ajoutées au domaine du token dans `extra` (les clients x402 ignorent ce qu'ils ne connaissent pas). */
  extra?: Record<string, string>;
  /** Code d'erreur x402 du 402 (défaut « payment_required »). */
  error?: string;
}

export function buildChallenge(i: ChallengeInput): Challenge {
  return {
    x402Version: 1,
    error: i.error ?? "payment_required",
    accepts: [
      {
        scheme: "exact",
        network: i.network,
        maxAmountRequired: i.amount.toString(),
        resource: i.resource,
        description: i.description ?? "",
        mimeType: "application/json",
        payTo: i.payTo,
        maxTimeoutSeconds: i.maxTimeoutSeconds ?? 120,
        asset: i.asset,
        extra: { ...(i.extra ?? {}), name: i.usdcName, version: i.usdcVersion },
      },
    ],
  };
}

export function encodeXPayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}

export function decodeXPayment(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
}

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Signe l'autorisation EIP-3009 (côté client). `signTypedData` est injecté (pas de clé ici). */
export async function buildPayerAuthorization(
  signTypedData: (args: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: typeof RECEIVE_TYPES;
    primaryType: "ReceiveWithAuthorization";
    message: Record<string, unknown>;
  }) => Promise<Hex>,
  req: PaymentRequirements,
  chainId: number,
  from: Address,
  nonce: Hex,
  validBefore: bigint,
  value: bigint = BigInt(req.maxAmountRequired),
): Promise<PaymentPayload> {
  const authorization: Eip3009Authorization = {
    from,
    to: req.payTo,
    value: value.toString(),
    validAfter: "0",
    validBefore: validBefore.toString(),
    nonce,
  };
  const signature = await signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: RECEIVE_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from,
      to: req.payTo,
      value,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  return { x402Version: 1, scheme: "exact", network: req.network, payload: { signature, authorization } };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Résultat détaillé : `code` suit les codes d'erreur x402 quand ils existent, `reason` est en français. */
export type ExactVerifyResult = { ok: true } | { ok: false; code: string; reason: string };

export interface ExactVerifyOptions {
  /** L'autorisation doit rester valable au moins ce délai (s) : le temps que l'opérateur règle. Défaut 0. */
  minRemainingSeconds?: bigint;
  /** Validité maximale acceptée (s) à partir de maintenant ; absente = pas de borne. */
  maxValiditySeconds?: bigint;
}

/** n/2 de secp256k1 : au-delà, l'USDC (ECRecover de FiatToken) refuse la signature (« invalid signature 's' value »). */
const SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/**
 * Ce qui empêcherait l'USDC d'accepter cette signature EIP-3009 alors que viem l'accepte, ou null si elle est canonique :
 * 65 octets, r ≠ 0, 0 < s ≤ n/2, v = 27 ou 28.
 */
export function eip3009SignatureProblem(sig: unknown): string | null {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return "signature ECDSA de 65 octets attendue (r ‖ s ‖ v)";
  const r = BigInt(`0x${sig.slice(2, 66)}`);
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  if (r === 0n || s === 0n) return "signature nulle";
  if (s > SECP256K1_HALF_N) return "signature malléable (s dans la moitié haute) : l'USDC la refuserait au règlement";
  if (v !== 27 && v !== 28) return `octet v = ${v} : l'USDC exige 27 ou 28`;
  return null;
}

/**
 * Vérification STRICTE d'un paiement « exact » vers X402Settler (sans lecture de la chaîne) : schéma, réseau, payTo,
 * montant EXACT, fenêtre de validité, signature canonique et signataire = `from`.
 */
export async function verifyExactPayment(
  p: PaymentPayload,
  req: PaymentRequirements,
  chainId: number,
  nowSeconds: bigint,
  o: ExactVerifyOptions = {},
): Promise<ExactVerifyResult> {
  const no = (code: string, reason: string): ExactVerifyResult => ({ ok: false, code, reason });
  if (p.x402Version !== 1) return no("invalid_x402_version", "version x402 1 attendue");
  if (p.scheme !== "exact" || req.scheme !== "exact") return no("unsupported_scheme", "schéma « exact » attendu");
  if (p.network !== req.network) return no("invalid_network", `réseau « ${req.network} » attendu`);
  const a = p.payload.authorization;
  if (!isAddress(a.from, { strict: false }) || !isAddress(a.to, { strict: false })) return no("invalid_payload", "adresses de l'autorisation invalides");
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return no("invalid_exact_evm_payload_recipient_mismatch", `l'autorisation doit désigner X402Settler (${req.payTo}) comme destinataire`);
  }
  const value = BigInt(a.value);
  const validAfter = BigInt(a.validAfter);
  const validBefore = BigInt(a.validBefore);
  if (value !== BigInt(req.maxAmountRequired)) {
    return no(
      "invalid_exact_evm_payload_authorization_value",
      `montant ${value} ≠ ${req.maxAmountRequired} exigé (X402Settler encaisse exactement le prix ; tout autre montant ne se règle pas)`,
    );
  }
  if (validAfter >= nowSeconds) return no("invalid_exact_evm_payload_authorization_valid_after", "autorisation pas encore valable (validAfter)");
  if (validBefore <= nowSeconds + (o.minRemainingSeconds ?? 0n)) {
    return no(
      "invalid_exact_evm_payload_authorization_valid_before",
      o.minRemainingSeconds
        ? `autorisation expirée ou trop courte : elle doit rester valable au moins ${o.minRemainingSeconds} s, le temps du règlement`
        : "autorisation expirée",
    );
  }
  if (o.maxValiditySeconds !== undefined && validBefore > nowSeconds + o.maxValiditySeconds) {
    return no("authorization_validity_too_long", `autorisation valable trop longtemps : au plus ${o.maxValiditySeconds} s`);
  }
  const problem = eip3009SignatureProblem(p.payload.signature);
  if (problem) return no("invalid_exact_evm_payload_signature", problem);

  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
      types: RECEIVE_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from: a.from, to: a.to, value, validAfter, validBefore, nonce: a.nonce },
      signature: p.payload.signature,
    });
  } catch {
    return no("invalid_exact_evm_payload_signature", "signature EIP-3009 illisible");
  }
  if (signer.toLowerCase() !== a.from.toLowerCase()) {
    return no("invalid_exact_evm_payload_signature", "signature EIP-3009 qui n'est pas celle du payeur (from)");
  }
  return { ok: true };
}

const LEGACY_REASONS: Record<string, string> = {
  invalid_x402_version: "schéma/réseau",
  unsupported_scheme: "schéma/réseau",
  invalid_network: "schéma/réseau",
  invalid_exact_evm_payload_recipient_mismatch: "payTo",
  invalid_exact_evm_payload_authorization_value: "montant",
  invalid_exact_evm_payload_authorization_valid_after: "pas encore valide",
  invalid_exact_evm_payload_authorization_valid_before: "expiré",
  invalid_exact_evm_payload_signature: "signature",
};

/**
 * Vérifie la structure, le montant (EXACT, v2.1), la fraîcheur et la signature EIP-3009 (facilitateur).
 * Raison courte en français (« montant », « payTo », « expiré », « signature »…).
 */
export async function facilitatorVerify(
  p: PaymentPayload,
  req: PaymentRequirements,
  chainId: number,
  nowSeconds: bigint,
): Promise<VerifyResult> {
  const r = await verifyExactPayment(p, req, chainId, nowSeconds);
  if (r.ok) return { ok: true };
  return { ok: false, reason: LEGACY_REASONS[r.code] ?? r.reason };
}

/** Passe le règlement on-chain à un client (qui appelle X402Settler.settle avec le reçu d'enclave). */
export interface SettlerClient {
  settleCall(
    callReceipt: unknown,
    enclaveSig: Hex,
    auth: { validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex },
  ): Promise<Hex>;
}

export function authFromPayload(p: PaymentPayload): {
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
} {
  const a = p.payload.authorization;
  return {
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
    signature: p.payload.signature,
  };
}

// ---------------------------------------------------------------- v2.1 : l'appel payé (produit sealed-x402)

/** Unités facturées par appel : un appel coûte Product.price × 1 (X402Settler : montant = units × price). */
export const X402_UNITS_PER_CALL = 1n;

/** Étiquette de l'engagement du nonce (callNonce) : changer la construction = changer d'étiquette. */
export const X402_CALL_TAG = "ARC-X402-CALL-v1";

/** Longueur maximale de l'en-tête X-PAYMENT (base64) acceptée. */
export const MAX_X_PAYMENT_LENGTH = 4096;

/** Nom de réseau x402 d'une chaîne Arc. */
export function x402NetworkName(chainId: number): string {
  if (chainId === 5042002) return "arc-testnet";
  if (chainId === 5042) return "arc";
  return `eip155:${chainId}`;
}

/** La requête chiffrée d'un appel (HPKE vers la clé X25519 de l'enclave ; réponse chiffrée vers clientEphemeralPub). */
export interface CallEnvelope {
  enc: Hex;
  ciphertext: Hex;
  clientEphemeralPub: Hex; // 32 octets
}

/**
 * Le nonce EIP-3009 d'un appel x402 = engagement sur la requête chiffrée, pour CETTE enclave, ce produit, ce contrat de
 * règlement et cette chaîne :
 *   keccak256(abi.encode("ARC-X402-CALL-v1", chainId, x402Settler, productId, enclave, keccak256(enc),
 *                        keccak256(ciphertext), clientEphemeralPub))
 * Un même en-tête X-PAYMENT ne paie donc qu'UNE requête ; rejoué sur une autre (ou une requête modifiée en route), il est
 * refusé avant tout appel au modèle. Le SDK calcule exactement la même valeur (packages/sdk/src/x402.ts).
 */
export function callNonce(
  i: { chainId: number | bigint; settler: Address; productId: bigint; enclave: Address } & CallEnvelope,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [X402_CALL_TAG, BigInt(i.chainId), i.settler, i.productId, i.enclave, keccak256(i.enc), keccak256(i.ciphertext), i.clientEphemeralPub],
    ),
  );
}

/** responseHash d'un appel x402 = keccak256(abi.encode(requestHash, keccak256(texte UTF-8))) : lié à la requête. */
export function callResponseHash(requestHash: Hex, text: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [requestHash, keccak256(toBytes(text))]));
}

/** En-tête X-PAYMENT illisible : `code` x402 et raison en français. */
export class X402PayloadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "X402PayloadError";
  }
}

const DEC = /^[0-9]{1,78}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Décode et VALIDE l'en-tête X-PAYMENT (base64 d'un JSON x402 v1, schéma « exact ») sans rien lui faire confiance :
 * tailles bornées, adresses, entiers décimaux, nonce de 32 octets. Lève X402PayloadError.
 */
export function parseXPayment(header: string): PaymentPayload {
  if (typeof header !== "string" || header.length === 0 || header.length > MAX_X_PAYMENT_LENGTH) {
    throw new X402PayloadError("invalid_payload", `en-tête X-PAYMENT absent ou trop long (au plus ${MAX_X_PAYMENT_LENGTH} caractères)`);
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(header.trim())) throw new X402PayloadError("invalid_payload", "en-tête X-PAYMENT : base64 attendu");
  let j: any;
  try {
    j = JSON.parse(Buffer.from(header.trim(), "base64").toString("utf8"));
  } catch {
    throw new X402PayloadError("invalid_payload", "en-tête X-PAYMENT : JSON illisible");
  }
  if (!j || typeof j !== "object") throw new X402PayloadError("invalid_payload", "en-tête X-PAYMENT : objet attendu");
  if (j.x402Version !== 1) throw new X402PayloadError("invalid_x402_version", "x402Version 1 attendue");
  if (j.scheme !== "exact") throw new X402PayloadError("unsupported_scheme", "schéma « exact » attendu");
  if (typeof j.network !== "string" || j.network.length > 64) throw new X402PayloadError("invalid_network", "réseau illisible");
  const sig = j.payload?.signature;
  const a = j.payload?.authorization;
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{2,1024}$/.test(sig)) throw new X402PayloadError("invalid_payload", "signature illisible");
  if (!a || typeof a !== "object") throw new X402PayloadError("invalid_payload", "autorisation absente");
  if (typeof a.from !== "string" || !isAddress(a.from, { strict: false })) throw new X402PayloadError("invalid_payload", "from : adresse invalide");
  if (typeof a.to !== "string" || !isAddress(a.to, { strict: false })) throw new X402PayloadError("invalid_payload", "to : adresse invalide");
  for (const k of ["value", "validAfter", "validBefore"] as const) {
    if (typeof a[k] !== "string" || !DEC.test(a[k])) throw new X402PayloadError("invalid_payload", `${k} : entier décimal attendu`);
  }
  if (typeof a.nonce !== "string" || !HEX32.test(a.nonce)) throw new X402PayloadError("invalid_payload", "nonce : 32 octets hexadécimaux attendus");
  return {
    x402Version: 1,
    scheme: "exact",
    network: j.network,
    payload: {
      signature: sig.toLowerCase() as Hex,
      authorization: {
        from: getAddress(a.from.toLowerCase()),
        to: getAddress(a.to.toLowerCase()),
        value: a.value,
        validAfter: a.validAfter,
        validBefore: a.validBefore,
        nonce: a.nonce.toLowerCase() as Hex,
      },
    },
  };
}
