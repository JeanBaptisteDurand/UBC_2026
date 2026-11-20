/**
 * enclave-kit.ts — the kit shared by every product (O1), assembled.
 * It holds the keys in memory, computes the attestation (REPORTDATA), signs receipts and claims, opens and encrypts
 * with HPKE, and reads the chain through the quorum proxy.
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
  dstack?: DstackClient; // present in a real TDX VM
  rpc?: RpcQuorum; // read proxy
  /** Local development: imitates the EIP-2935 history (keccak256(bytes32(R))), like the contracts' MockHistory. */
  mockBlockHash?: boolean;
}

export interface AttestInput {
  operator: Address;
  anchorR: bigint;
}

/** Read-only view of the EnclaveRegistry (IEnclaveRegistry.enclaveOf, ABI v1 unchanged). */
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
    if (!this.cfg.rpc) throw new Error("neither rpc nor mockBlockHash: cannot anchor");
    return this.cfg.rpc.blockHash(r);
  }

  /** Produces a quote whose REPORTDATA binds the operator, the product and the two keys (P6/P7). */
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

  /** This enclave's product (PRODUCT_ID, bound in the REPORTDATA). */
  get productId(): bigint {
    return this.cfg.productId;
  }

  pubkeys(): { signer: Address; x25519: Hex; lastQuote: Hex } {
    return { signer: this.keys.signer, x25519: this.keys.x25519PublicKey, lastQuote: this.lastQuote };
  }

  /**
   * The operator under which THIS enclave's key is already registered in the EnclaveRegistry (the zero address if it
   * is not), read through the RPC quorum at the same block on every provider.
   * `null` if no RPC is configured (local development): the check could not run.
   * Throws if the read fails or if the providers disagree.
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

  /** Receipt of a call paid per call (x402 rail): X402Settler domain, verified by X402Settler.settle. */
  signCallReceipt(x402Settler: Address, cr: CallReceipt): Promise<Hex> {
    return signCallReceipt(this.keys.signerPrivateKey, this.domain(x402Settler), cr);
  }

  seal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Sealed> {
    return seal(recipientPublicRaw, plaintext, aad);
  }

  open(enc: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    return open(this.keys.x25519PrivateKey, enc, ciphertext, aad);
  }

  /** HPKE info of THIS enclave's `tag` exchanges: bound to the chain, the registry, the product and the signer. */
  exchangeInfo(tag: string): Uint8Array {
    return exchangeInfo(tag, this.cfg.chainId, this.cfg.registry, this.cfg.productId, this.keys.signer);
  }

  /** Opens a sealed request for THIS enclave (protocol `tag`, see hpke-exchange.ts); the reply is sealed for the one
   *  client of that request. Throws if the request is not for this enclave or was modified. */
  openExchange(tag: string, enc: Uint8Array, ciphertext: Uint8Array): Promise<OpenedExchange> {
    return openExchange(this.keys.x25519PrivateKey, tag, this.exchangeInfo(tag), enc, ciphertext);
  }

  /** The chain and the registry bound in this enclave's REPORTDATA (public). */
  get binding(): { chainId: number; registry: Address; productId: bigint } {
    return { chainId: this.cfg.chainId, registry: this.cfg.registry, productId: this.cfg.productId };
  }

  get rpc(): RpcQuorum | undefined {
    return this.cfg.rpc;
  }
}
