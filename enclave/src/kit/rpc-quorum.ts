/**
 * rpc-quorum.ts — mandataire de LECTURE SEULE à quorum.
 *
 * L'enclave ne doit jamais faire confiance à un seul RPC. Chaque lecture est faite chez N
 * fournisseurs AU MÊME BLOC ; les réponses doivent être identiques, sinon on refuse. Seules des
 * méthodes de lecture sont permises ; tout envoi de transaction est interdit.
 * Limite connue (à dire) : les fournisseurs voient quelles cases de stockage on lit.
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

  /** `providers` : URL HTTP des fournisseurs (ou transports viem déjà construits, pour les tests). */
  constructor(providers: Array<string | Transport>) {
    if (providers.length === 0) throw new Error("au moins un fournisseur RPC");
    this.clients = providers.map((p) => createPublicClient({ transport: typeof p === "string" ? http(p) : p }));
  }

  /** Nombre de fournisseurs (le quorum exige l'unanimité). */
  get size(): number {
    return this.clients.length;
  }

  /** Lecture brute chez tous les fournisseurs ; exige des réponses identiques. */
  async read<T>(fn: (c: PublicClient) => Promise<T>): Promise<T> {
    const results = await Promise.all(this.clients.map(fn));
    const first = JSON.stringify(results[0], bigintReplacer);
    for (let i = 1; i < results.length; i++) {
      if (JSON.stringify(results[i], bigintReplacer) !== first) {
        throw new QuorumError("désaccord entre fournisseurs RPC");
      }
    }
    return results[0] as T;
  }

  /**
   * Le bloc commun : la plus petite tête vue chez les fournisseurs (Arc est final au bloc, donc ce
   * bloc existe et ne change plus chez aucun d'eux).
   */
  async commonHead(): Promise<bigint> {
    const heads = await Promise.all(this.clients.map((c) => c.getBlockNumber({ cacheTime: 0 })));
    return heads.reduce((a, b) => (b < a ? b : a));
  }

  /** Lecture chez tous les fournisseurs AU MÊME BLOC (la tête commune) ; réponses identiques exigées. */
  async readAtCommonHead<T>(fn: (c: PublicClient, blockNumber: bigint) => Promise<T>): Promise<T> {
    const blockNumber = await this.commonHead();
    return this.read((c) => fn(c, blockNumber));
  }

  /** Hash d'un bloc, vérifié en quorum (seul le hash est comparé : les fournisseurs n'exposent pas
   *  tous les mêmes champs annexes d'un bloc). */
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
