/**
 * sealed-x402/chain.ts — ce que l'enclave du produit x402 lit de la chaîne, par le mandataire à QUORUM du kit (chaque
 * lecture chez tous les fournisseurs RPC, au même bloc, réponses identiques exigées ; jamais de transaction).
 *
 * Adresses : seules X402SETTLER et REGISTRY viennent de l'environnement (mesurées dans le compose). Le registre des
 * produits, la caution et l'USDC sont LUS dans X402Settler (immutables du contrat) : l'enclave vérifie que ce règlement
 * s'appuie bien sur le registre auquel elle s'atteste (X402Settler.enclaves() == REGISTRY) et sur l'USDC annoncé.
 *
 * Les fragments d'ABI ci-dessous recopient packages/sdk/src/abis.ts (généré depuis contracts/out) : un test les compare
 * (test/sealed-x402.test.ts). L'image de l'enclave ne contient que enclave/ : pas d'import du SDK ici.
 */
import { type Address, type Hex, type PublicClient, getAddress, parseAbi, zeroAddress } from "viem";
import type { RpcQuorum } from "../../src/kit/rpc-quorum";
import type { X402ChainReader, X402PaymentState, X402PendingSnapshot, X402ProductView, X402Status } from "../../src/services/x402-gateway";

export const X402_SETTLER_READ_ABI = parseAbi([
  "function products() view returns (address)",
  "function enclaves() view returns (address)",
  "function bond() view returns (address)",
  "function usdc() view returns (address)",
]);

export const PRODUCT_REGISTRY_READ_ABI = parseAbi([
  "struct Product { address author; bytes32 manifestHash; bool deterministic; uint256 price; uint16 bpsOperator; uint16 bpsAuthor; uint16 bpsNetwork; uint256 minBond; uint256 exposureCap; address settlement; bytes32 param; uint64 version; uint64 activatesAt; uint8 state; uint32 unitTokens; uint32 outWeight; }",
  "function getProduct(uint256 productId) view returns (Product)",
  "function isActive(uint256 productId) view returns (bool)",
]);

export const ENCLAVE_REGISTRY_ACTIVE_ABI = parseAbi([
  "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
]);

export const OPERATOR_BOND_READ_ABI = parseAbi([
  "function availableBond(address operator) view returns (uint256)",
  "function totalExposureOf(address operator) view returns (uint256)",
  "function exposureOf(address operator, uint256 productId) view returns (uint256)",
  "function banned(address) view returns (bool)",
]);

/** USDC d'Arc : ERC-20 + EIP-3009 (FiatToken). */
export const USDC_READ_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

export interface X402Addresses {
  settler: Address;
  registry: Address;
  products: Address;
  bond: Address;
  usdc: Address;
}

const L = (x: string) => x.toLowerCase();

/** Lit dans X402Settler les adresses dont il dépend, et refuse un règlement branché ailleurs que sur NOTRE registre. */
export async function resolveX402Addresses(
  rpc: RpcQuorum,
  settler: Address,
  registry: Address,
  usdcExpected?: Address,
): Promise<X402Addresses> {
  const [products, enclaves, bond, usdc] = await rpc.readAtCommonHead((c, blockNumber) =>
    Promise.all(
      (["products", "enclaves", "bond", "usdc"] as const).map(
        (functionName) => c.readContract({ address: settler, abi: X402_SETTLER_READ_ABI, functionName, blockNumber }) as Promise<Address>,
      ),
    ),
  );
  if (!products || !enclaves || !bond || !usdc) throw new Error("X402Settler : lecture incomplète");
  if (L(enclaves) !== L(registry)) {
    throw new Error(`X402Settler ${settler} s'appuie sur le registre ${enclaves}, cette enclave s'atteste auprès de ${registry} : configuration incohérente`);
  }
  if (usdcExpected && L(usdc) !== L(usdcExpected)) {
    throw new Error(`X402Settler encaisse l'USDC ${usdc}, l'environnement annonce ${usdcExpected} : configuration incohérente`);
  }
  return { settler, registry, products: getAddress(products), bond: getAddress(bond), usdc: getAddress(usdc) };
}

/** Exposition encore permise (règle d'OperatorBond.consumeExposure) : ½ caution disponible − exposition totale sur 24 h,
 *  et le plafond du produit − l'exposition sur ce produit (si plafond). 0 si l'opérateur est radié. */
export function exposureCapacity(i: { availableBond: bigint; totalExposure: bigint; productExposure: bigint; cap: bigint; banned: boolean }): bigint {
  if (i.banned) return 0n;
  const half = i.availableBond / 2n;
  let cap = half > i.totalExposure ? half - i.totalExposure : 0n;
  if (i.cap !== 0n) {
    const left = i.cap > i.productExposure ? i.cap - i.productExposure : 0n;
    if (left < cap) cap = left;
  }
  return cap;
}

/**
 * Le lecteur on-chain de la passerelle x402. `addresses` est résolu à la demande (et gardé une fois lu) : une panne RPC
 * au démarrage ne fait pas redémarrer l'enclave (ce qui changerait ses clés et obligerait à la réinscrire).
 */
export function createQuorumX402Reader(rpc: RpcQuorum, addresses: () => Promise<X402Addresses>): X402ChainReader {
  type Pub = PublicClient;
  const readProduct = async (c: Pub, A: X402Addresses, productId: bigint, blockNumber: bigint): Promise<X402ProductView> => {
    const [p, active] = await Promise.all([
      c.readContract({ address: A.products, abi: PRODUCT_REGISTRY_READ_ABI, functionName: "getProduct", args: [productId], blockNumber }),
      c.readContract({ address: A.products, abi: PRODUCT_REGISTRY_READ_ABI, functionName: "isActive", args: [productId], blockNumber }),
    ]);
    return { active, price: p.price, settlement: p.settlement, param: p.param as Hex, exposureCap: p.exposureCap };
  };
  const readOperator = (c: Pub, A: X402Addresses, enclave: Address, productId: bigint, blockNumber: bigint) =>
    c.readContract({
      address: A.registry,
      abi: ENCLAVE_REGISTRY_ACTIVE_ABI,
      functionName: "activeOperatorAt",
      args: [enclave, productId, blockNumber],
      blockNumber,
    }) as Promise<Address>;

  return {
    async status(enclave, productId): Promise<X402Status> {
      const A = await addresses();
      const block = await rpc.commonHead();
      const [product, operator] = await rpc.read((c) =>
        Promise.all([readProduct(c, A, productId, block), readOperator(c, A, enclave, productId, block)]),
      );
      return { block, product, operator };
    },

    async paymentState({ enclave, productId, payer, nonce }): Promise<X402PaymentState> {
      const A = await addresses();
      const block = await rpc.commonHead();
      const [product, operator, authorizationUsed, balance, code] = await rpc.read((c) =>
        Promise.all([
          readProduct(c, A, productId, block),
          readOperator(c, A, enclave, productId, block),
          c.readContract({ address: A.usdc, abi: USDC_READ_ABI, functionName: "authorizationState", args: [payer, nonce], blockNumber: block }),
          c.readContract({ address: A.usdc, abi: USDC_READ_ABI, functionName: "balanceOf", args: [payer], blockNumber: block }),
          c.getCode({ address: payer, blockNumber: block }),
        ]),
      );
      let capacity: bigint | null = null;
      if (L(operator) !== zeroAddress) {
        const [availableBond, totalExposure, productExposure, banned] = await rpc.read((c) =>
          Promise.all([
            c.readContract({ address: A.bond, abi: OPERATOR_BOND_READ_ABI, functionName: "availableBond", args: [operator], blockNumber: block }),
            c.readContract({ address: A.bond, abi: OPERATOR_BOND_READ_ABI, functionName: "totalExposureOf", args: [operator], blockNumber: block }),
            c.readContract({ address: A.bond, abi: OPERATOR_BOND_READ_ABI, functionName: "exposureOf", args: [operator, productId], blockNumber: block }),
            c.readContract({ address: A.bond, abi: OPERATOR_BOND_READ_ABI, functionName: "banned", args: [operator], blockNumber: block }),
          ]),
        );
        capacity = exposureCapacity({ availableBond, totalExposure, productExposure, cap: product.exposureCap, banned });
      }
      return {
        block,
        product,
        operator,
        authorizationUsed,
        balance,
        payerHasCode: !!code && code !== "0x",
        capacity,
      };
    },

    async authorizationUsed(payer, nonce): Promise<boolean> {
      const A = await addresses();
      return rpc.readAtCommonHead((c, blockNumber) =>
        c.readContract({ address: A.usdc, abi: USDC_READ_ABI, functionName: "authorizationState", args: [payer, nonce], blockNumber }),
      );
    },

    /** Rapprochement et signalements : soldes et états d'autorisation, par lots, AU MÊME BLOC chez tous les fournisseurs. */
    async pendingState({ payers, auths }): Promise<X402PendingSnapshot> {
      const A = await addresses();
      const block = await rpc.commonHead();
      const [balances, used] = await rpc.read(async (c) => {
        const b = await inBatches(payers, (p) =>
          c.readContract({ address: A.usdc, abi: USDC_READ_ABI, functionName: "balanceOf", args: [p], blockNumber: block }),
        );
        const u = await inBatches(auths, (a) =>
          c.readContract({ address: A.usdc, abi: USDC_READ_ABI, functionName: "authorizationState", args: [a.payer, a.nonce], blockNumber: block }),
        );
        return [b, u] as const;
      });
      return {
        block,
        balances: new Map(payers.map((p, i) => [L(p), balances[i]!] as const)),
        used: new Map(auths.map((a, i) => [`${L(a.payer)}:${L(a.nonce)}`, used[i]!] as const)),
      };
    },
  };
}

/** Lectures par lots de READ_BATCH (en parallèle dans un lot, lots l'un après l'autre) : borne la charge par fournisseur. */
const READ_BATCH = 16;
async function inBatches<T, R>(xs: readonly T[], f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += READ_BATCH) out.push(...(await Promise.all(xs.slice(i, i + READ_BATCH).map(f))));
  return out;
}
