/**
 * sealed-x402/chain.ts — what the x402 product's enclave reads from the chain, through the kit's QUORUM proxy (each read
 * on every RPC provider, at one block, identical answers required; never a transaction).
 *
 * Addresses: only X402SETTLER and REGISTRY come from the environment (measured in the compose file). The product
 * registry, the bond and USDC are READ from X402Settler (the contract's immutables): the enclave checks that this
 * settlement relies on the registry it attests to (X402Settler.enclaves() == REGISTRY) and on the announced USDC.
 *
 * The ABI fragments below copy packages/sdk/src/abis.ts (generated from contracts/out): a test compares them
 * (test/sealed-x402.test.ts). The enclave's image contains only enclave/: no SDK import here.
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

/** Arc's USDC: ERC-20 + EIP-3009 (FiatToken). */
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

/** Reads from X402Settler the addresses it depends on, and refuses a settlement wired to anything but OUR registry. */
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
  if (!products || !enclaves || !bond || !usdc) throw new Error("X402Settler: incomplete read");
  if (L(enclaves) !== L(registry)) {
    throw new Error(`X402Settler ${settler} relies on registry ${enclaves}; this enclave attests to ${registry}: inconsistent configuration`);
  }
  if (usdcExpected && L(usdc) !== L(usdcExpected)) {
    throw new Error(`X402Settler collects USDC ${usdc}; the environment announces ${usdcExpected}: inconsistent configuration`);
  }
  return { settler, registry, products: getAddress(products), bond: getAddress(bond), usdc: getAddress(usdc) };
}

/** The exposure still allowed (OperatorBond.consumeExposure's rule): ½ of the available bond − the total exposure over
 *  24 h, and the product's cap − the exposure on this product (if capped). 0 if the operator is struck off. */
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
 * The x402 gateway's on-chain reader. `addresses` is resolved on demand (and kept once read): an RPC outage at start-up
 * does not make the enclave restart (which would change its keys and require registering it again).
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

    /** Reconciliation and reports: balances and authorization states, in batches, AT ONE BLOCK on every provider. */
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

/** Reads in batches of READ_BATCH (parallel within a batch, batches one after the other): bounds the load per provider. */
const READ_BATCH = 16;
async function inBatches<T, R>(xs: readonly T[], f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += READ_BATCH) out.push(...(await Promise.all(xs.slice(i, i + READ_BATCH).map(f))));
  return out;
}
