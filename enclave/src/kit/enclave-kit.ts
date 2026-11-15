/**
 * enclave-kit.ts — le kit commun à tous les produits (O1), assemblé.
 * Tient les clés en mémoire, calcule l'attestation (REPORTDATA), signe les reçus/réclamations,
 * ouvre/chiffre en HPKE, et lit la chaîne par le mandataire à quorum.
 */
import { type Address, type Hex, keccak256, pad, numberToHex, parseAbi } from "viem";
import { generateEnclaveKeys, type EnclaveKeys } from "./keys";
import { buildReportData, type ReportDataBinding } from "./binding";
import { getQuoteMock, getQuoteReal, type DstackClient, type QuoteResult } from "./quote";
import { RpcQuorum } from "./rpc-quorum";
import {
  signReceipt,
  signClaim,
  signCallReceipt,
  type Receipt,
  type Claim,
  type CallReceipt,
  type DomainParams,
} from "./eip712";
import { seal, open, type Sealed } from "./hpke";
import { exchangeInfo, openExchange, type OpenedExchange } from "./hpke-exchange";

export interface EnclaveConfig {
  productId: bigint;
  chainId: number;
  registry: Address;
  dstack?: DstackClient; // présent dans une vraie VM TDX
  rpc?: RpcQuorum; // mandataire de lecture
  /** Dev local : imite l'historique EIP-2935 (keccak256(bytes32(R))) comme la MockHistory des contrats. */
  mockBlockHash?: boolean;
}

export interface AttestInput {
  operator: Address;
  anchorR: bigint;
}

/** Lecture seule de l'EnclaveRegistry (IEnclaveRegistry.enclaveOf, ABI v1 inchangée). */
export const ENCLAVE_REGISTRY_READ_ABI = parseAbi([
  "struct Enclave { address signer; bytes32 x25519; uint256 productId; address operator; bytes32 workloadId; bytes6 fmspc; uint8 tcbStatus; bytes32 quoteHash; uint64 anchorBlock; uint64 registeredAt; uint64 expiresAt; bool active; }",
  "function enclaveOf(address signer) view returns (Enclave)",
]);

export interface AttestOutput {
  quote: Hex;
  eventLog: Hex;
  signer: Address;
  x25519: Hex;
  mock: boolean;
}

export class EnclaveKit {
  readonly keys: EnclaveKeys;
  private lastQuote: Hex = "0x";

  constructor(private cfg: EnclaveConfig) {
    this.keys = generateEnclaveKeys();
  }

  private async anchorBlockHash(r: bigint): Promise<Hex> {
    if (this.cfg.mockBlockHash) {
      return keccak256(pad(numberToHex(r), { size: 32 }));
    }
    if (!this.cfg.rpc) throw new Error("ni rpc ni mockBlockHash : impossible d'ancrer");
    return this.cfg.rpc.blockHash(r);
  }

  /** Produit un quote dont le REPORTDATA lie l'opérateur, le produit et les deux clés (P6/P7). */
  async attest(input: AttestInput): Promise<AttestOutput> {
    const binding: ReportDataBinding = {
      chainId: BigInt(this.cfg.chainId),
      registry: this.cfg.registry,
      productId: this.cfg.productId,
      operator: input.operator,
      signer: this.keys.signer,
      x25519: this.keys.x25519PublicKey,
    };
    const anchorHash = await this.anchorBlockHash(input.anchorR);
    const reportData = buildReportData(binding, anchorHash);

    const q: QuoteResult = this.cfg.dstack
      ? await getQuoteReal(this.cfg.dstack, reportData)
      : getQuoteMock(reportData);

    this.lastQuote = q.quote;
    return {
      quote: q.quote,
      eventLog: q.eventLog,
      signer: this.keys.signer,
      x25519: this.keys.x25519PublicKey,
      mock: q.mock,
    };
  }

  /** Le produit de cette enclave (PRODUCT_ID, lié dans le REPORTDATA). */
  get productId(): bigint {
    return this.cfg.productId;
  }

  pubkeys(): { signer: Address; x25519: Hex; lastQuote: Hex } {
    return { signer: this.keys.signer, x25519: this.keys.x25519PublicKey, lastQuote: this.lastQuote };
  }

  /**
   * L'opérateur sous lequel la clé de CETTE enclave est déjà inscrite dans l'EnclaveRegistry
   * (adresse nulle si elle ne l'est pas), lu par le quorum RPC au même bloc chez tous les fournisseurs.
   * `null` si aucun RPC n'est configuré (développement local) : la vérification n'a pas pu se faire.
   * Lève une erreur si la lecture échoue ou si les fournisseurs ne sont pas d'accord.
   */
  async registeredOperator(): Promise<Address | null> {
    const rpc = this.cfg.rpc;
    if (!rpc) return null;
    const e = await rpc.readAtCommonHead((c, blockNumber) =>
      c.readContract({
        address: this.cfg.registry,
        abi: ENCLAVE_REGISTRY_READ_ABI,
        functionName: "enclaveOf",
        args: [this.keys.signer],
        blockNumber,
      }),
    );
    return e.operator;
  }

  private domain(verifyingContract: Address): DomainParams {
    return { chainId: this.cfg.chainId, verifyingContract };
  }

  signReceipt(sessionPay: Address, receipt: Receipt): Promise<Hex> {
    return signReceipt(this.keys.signerPrivateKey, this.domain(sessionPay), receipt);
  }

  signClaim(sealedBounty: Address, claim: Claim): Promise<Hex> {
    return signClaim(this.keys.signerPrivateKey, this.domain(sealedBounty), claim);
  }

  /** Reçu d'un appel payé à l'appel (rail x402) : domaine X402Settler, vérifié par X402Settler.settle. */
  signCallReceipt(x402Settler: Address, cr: CallReceipt): Promise<Hex> {
    return signCallReceipt(this.keys.signerPrivateKey, this.domain(x402Settler), cr);
  }

  seal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Sealed> {
    return seal(recipientPublicRaw, plaintext, aad);
  }

  open(enc: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    return open(this.keys.x25519PrivateKey, enc, ciphertext, aad);
  }

  /** info HPKE des échanges `tag` de CETTE enclave : liée à la chaîne, au registre, au produit et au signataire. */
  exchangeInfo(tag: string): Uint8Array {
    return exchangeInfo(tag, this.cfg.chainId, this.cfg.registry, this.cfg.productId, this.keys.signer);
  }

  /** Ouvre une requête scellée pour CETTE enclave (protocole `tag`, voir hpke-exchange.ts) ; la réponse se scelle pour
   *  le seul client de cette requête. Lève si la requête n'est pas pour cette enclave ou a été modifiée. */
  openExchange(tag: string, enc: Uint8Array, ciphertext: Uint8Array): Promise<OpenedExchange> {
    return openExchange(this.keys.x25519PrivateKey, tag, this.exchangeInfo(tag), enc, ciphertext);
  }

  /** Chaîne et registre liés dans le REPORTDATA de cette enclave (publics). */
  get binding(): { chainId: number; registry: Address; productId: bigint } {
    return { chainId: this.cfg.chainId, registry: this.cfg.registry, productId: this.cfg.productId };
  }

  get rpc(): RpcQuorum | undefined {
    return this.cfg.rpc;
  }
}
