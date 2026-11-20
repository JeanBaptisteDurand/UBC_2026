/**
 * rpc-quorum.ts — a READ-ONLY proxy with a quorum.
 *
 * The enclave must never trust a single RPC. Each read goes to N providers AT THE SAME BLOCK; the answers must be
 * identical, otherwise the read is refused. Only read methods are allowed; sending a transaction is forbidden.
 * A known limit: the providers see which storage slots the enclave reads.
 */
import { createPublicClient, http, type PublicClient, type Hex, type Transport } from "viem";

export const ALLOWED_METHODS = new Set<string>([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_call",
]);

export class QuorumError extends Error {}

export class RpcQuorum {
  private clients: PublicClient[];

  /** `providers`: HTTP URLs of the providers (or viem transports already built, for tests). */
  constructor(providers: Array<string | Transport>) {
    if (providers.length === 0) throw new Error("at least one RPC provider");
    this.clients = providers.map((p) => createPublicClient({ transport: typeof p === "string" ? http(p) : p }));
  }

  /** Number of providers (the quorum requires unanimity). */
  get size(): number {
    return this.clients.length;
  }

  /** Raw read on every provider; requires identical answers. */
  async read<T>(fn: (c: PublicClient) => Promise<T>): Promise<T> {
    const results = await Promise.all(this.clients.map(fn));
    const first = JSON.stringify(results[0], bigintReplacer);
    for (let i = 1; i < results.length; i++) {
      if (JSON.stringify(results[i], bigintReplacer) !== first) {
        throw new QuorumError("RPC providers disagree");
      }
    }
    return results[0] as T;
  }

  /**
   * The common block: the lowest head seen across the providers (Arc is final at each block, so this block exists and
   * no longer changes on any of them).
   */
  async commonHead(): Promise<bigint> {
    const heads = await Promise.all(this.clients.map((c) => c.getBlockNumber({ cacheTime: 0 })));
    return heads.reduce((a, b) => (b < a ? b : a));
  }

  /** A read on every provider AT THE SAME BLOCK (the common head); identical answers required. */
  async readAtCommonHead<T>(fn: (c: PublicClient, blockNumber: bigint) => Promise<T>): Promise<T> {
    const blockNumber = await this.commonHead();
    return this.read((c) => fn(c, blockNumber));
  }

  /** The hash of a block, checked through the quorum (only the hash is compared: the providers do not all expose the
   *  same extra fields of a block). */
  async blockHash(blockNumber: bigint): Promise<Hex> {
    return this.read(async (c) => (await c.getBlock({ blockNumber, includeTransactions: false })).hash as Hex);
  }

  async blockNumber(): Promise<bigint> {
    return this.read((c) => c.getBlockNumber());
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}
