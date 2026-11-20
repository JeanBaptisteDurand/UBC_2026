/** network.ts — the Arc network, the deployed addresses, the EIP-712 domains. */
import { defineChain, type Address, type TypedDataDomain } from "viem";

export const ARC_TESTNET_ID = 5042002 as const;
export const ARC_MAINNET_ID = 5042 as const;

/** Multicall3 (canonical address), present on Arc testnet: viem batches reads through it. */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.testnet.arc.io" } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export interface Deployment {
  /** "v2": the v2 family of stacks, v2.1 included (registry wired to the real DCAP module, sessions bound to one
   *  enclave, two-step bounty payment). */
  version: "v2";
  chainId: number;
  deployBlock: bigint; // lower bound for reading events (getLogs)
  blockscoutUrl?: string; // event indexer (the public RPC caps getLogs): the "hive" reads from it
  usdc: Address;
  erc8004Validation: Address;
  /** ERC-8004 identity registry (agentId ownership; OperatorBond.setAgentId requires owning it). */
  erc8004Identity: Address;
  history: Address;
  /** The registry's attestation module: TdxAttestationModule (Automata's DCAP). */
  attestationModule: Address;
  /** Automata's DCAP verifier called by the module (AutomataDcapAttestationFee). */
  dcapAttestation?: Address;
  productRegistry: Address;
  operatorBond: Address;
  enclaveRegistry: Address;
  verdictLog: Address;
  sessionPay: Address;
  sealedBounty: Address;
  x402Settler: Address;
  demoVault: Address;
  /** The network's fund (its share of payments, and seizures with no victim). */
  treasury?: Address;
  /** The deployment's reference products (read on-chain): private inference (SessionPay) and the Sealed Bounty
   *  (SealedBounty); from v2.1, pay-per-call inference (X402Settler), if present. When absent, pick them from
   *  listProducts(). */
  products?: { inference: bigint; bounty: bigint; x402?: bigint };
  /** How the attestation module verifies a quote: "dcap" = Intel's signature verified on-chain (Automata DCAP),
   *  "dev" = a test module that records declared measurements without checking the signature (never shown as verified). */
  attestation: "dcap" | "dev";
  /** The TWO operator LEVELS (levels.ts): MachineRegistry (enclave → chip binding, declarations, product policies),
   *  ProofOfCloudAuditor (the Proof of Cloud alliance's token verified on-chain), Ed25519Verifier, PolicyEnclaves (the
   *  registry seen through the product's policy) and the Bounty at the verified level. */
  levels?: {
    machineRegistry: Address;
    proofOfCloudAuditor: Address;
    ed25519Verifier: Address;
    policyEnclaves: Address;
    sealedBountyVerified: Address;
  };
}

/** The v2.1 stack on Arc testnet (deployments.v21.testnet.json, deployed on 2026-11-09, block 71481927): as v2 (registry
 *  wired to the REAL DCAP module, REQUIRE_SEPT_VE, timelock 0 on testnet), plus the IMAGE id from an on-chain replay of
 *  dstack's RTMR3 event log (stable across restarts), ERC-8004 verdicts bound to the contract and salted, and
 *  pay-per-call inference (x402, product 3). The attested copilot is product 4 (no settlement). */
export const testnet: Deployment = {
  version: "v2",
  chainId: ARC_TESTNET_ID,
  deployBlock: 71481927n,
  blockscoutUrl: "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  history: "0x0000F90827F1C53a10cb7A02335B175320002935",
  attestationModule: "0x26C1803dE523aC896Ba7F1787f1401ec792951ca",
  dcapAttestation: "0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9",
  productRegistry: "0x582a3076cf6A1347907565B57Ce9f548D33805A4",
  operatorBond: "0xe584F7590e4677372eE6259b967672c747eB6850",
  enclaveRegistry: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d",
  verdictLog: "0x2B4AB39B461Ae2bA9ADfb6bC630D34553BAb9779",
  sessionPay: "0x8Bf8A8356f53006E9aB359AA6382f783923058a6",
  sealedBounty: "0x182871d34438aB37a7FD4d8689f3e0812E447A9b",
  x402Settler: "0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634",
  demoVault: "0x250C64fcbb61Ca4B9278330ae3711DCcADD1AB09",
  treasury: "0x5724d89D610c3017b8DC161c025248341556f6Ab",
  products: { inference: 1n, bounty: 2n, x402: 3n },
  attestation: "dcap",
  // 2026-11-11: the levels stack was REDEPLOYED after the security review (PckChip fixed); the earlier one is retired
  // (see deployments.v21.testnet.json → levels.superseded). The verified Bounty is PRODUCT 7 (product 6 is neutralized);
  // it can seize bonds and write verdicts from 18 Nov 2026, 23:00 UTC.
  levels: {
    machineRegistry: "0xd671013f556b1272b25e3cc17c889d402f4dc26d",
    proofOfCloudAuditor: "0xcdc4c150344f06d506deb5500332737e8dcc8fab",
    ed25519Verifier: "0x031579dd04398249feb67852632da4a648d4b5cf",
    policyEnclaves: "0x665f4bb3c31d23463f45e4092487f6b498490417",
    sealedBountyVerified: "0x36a8ddf9fcb1308b9e86425bec9b098e933c7348",
  },
};

/** The v2 stack on Arc testnet (deployments.v2.testnet.json, deployed on 2026-11-07, block 71206317; replaced by v2.1 on
 *  2026-11-09 and kept for the record: past sessions, bounties and verdicts): the enclave registry
 *  is wired to the REAL DCAP module (each quote is verified against Intel's signature, ≈ 5.7 M gas per
 *  registration on this stack), REQUIRE_SEPT_VE on, product timelock at 0 (testnet). */
export const testnetV2: Deployment = {
  version: "v2",
  chainId: ARC_TESTNET_ID,
  deployBlock: 71206317n,
  blockscoutUrl: "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  history: "0x0000F90827F1C53a10cb7A02335B175320002935",
  attestationModule: "0x26C1803dE523aC896Ba7F1787f1401ec792951ca",
  dcapAttestation: "0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9",
  productRegistry: "0x7795d037C8727D2F2a3D03F22b206EdCA7EdE810",
  operatorBond: "0x0CFD3400736257BB1689C87C42800C2F71e3449D",
  enclaveRegistry: "0x54AeCc6500a1CfB33FD5BFB3008ed7A600Ae7d38",
  verdictLog: "0xE0d333a32128Bc1A830888AE6cd69bF437C7698A",
  sessionPay: "0x50158CDF4e7A020b198984a1D54CeDE878693193",
  sealedBounty: "0xaC8949a108e8288aBe0DdC5b5A4120De4636E4BF",
  x402Settler: "0xBeFdA057670e5efdB6aAfc2b91AcE75673594dFC",
  demoVault: "0xD4f4d2Bb6bf662e738cB8917b9Ade152c245F8a1",
  treasury: "0x5724d89D610c3017b8DC161c025248341556f6Ab",
  products: { inference: 1n, bounty: 2n },
  attestation: "dcap",
};

/**
 * A deployment file (deployments.*.testnet.json: { chainId, deployBlock, external: { USDC, … }, contracts:
 * { EnclaveRegistry, … }, treasury, products: { "1": { settlement: "SessionPay" }, … } }) → Deployment. Wires a
 * service to the chosen stack (e.g. DEPLOYMENTS=deployments.v21.testnet.json) with no hard-coded address. A missing or
 * invalid contract address throws (never a silent fallback to another stack).
 */
export function deploymentFromJson(j: any): Deployment {
  if (!j || typeof j !== "object" || !j.contracts || !j.external) throw new Error("unreadable deployment file (contracts and external expected)");
  const addr = (v: unknown, name: string): Address => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`deployment file: ${name} missing or invalid`);
    return v as Address;
  };
  const opt = (v: unknown): Address | undefined => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);
  const chainId = Number(j.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("deployment file: invalid chainId");
  const C = j.contracts, X = j.external;
  // reference products: from the settlement contract declared for each
  const bySettlement = (name: string): bigint | undefined => {
    for (const [id, p] of Object.entries((j.products ?? {}) as Record<string, any>)) {
      if (/^[0-9]+$/.test(id) && String(p?.settlement ?? "").startsWith(name)) return BigInt(id);
    }
    return undefined;
  };
  const inference = bySettlement("SessionPay"), bounty = bySettlement("SealedBounty"), x402 = bySettlement("X402Settler");
  const dcap = opt(X.AutomataDcapAttestationFee);
  const treasury = opt(j.treasury);
  return {
    version: "v2",
    chainId,
    deployBlock: BigInt(j.deployBlock ?? 0),
    ...(chainId === ARC_TESTNET_ID ? { blockscoutUrl: "https://explorer.testnet.arc.io" } : {}),
    usdc: addr(X.USDC, "external.USDC"),
    erc8004Validation: addr(X.ERC8004_Validation, "external.ERC8004_Validation"),
    erc8004Identity: addr(X.ERC8004_Identity, "external.ERC8004_Identity"),
    history: addr(X.EIP2935_History, "external.EIP2935_History"),
    attestationModule: addr(C.TdxAttestationModule ?? C.MockAttestationModule, "contracts.TdxAttestationModule"),
    ...(dcap ? { dcapAttestation: dcap } : {}),
    productRegistry: addr(C.ProductRegistry, "contracts.ProductRegistry"),
    operatorBond: addr(C.OperatorBond, "contracts.OperatorBond"),
    enclaveRegistry: addr(C.EnclaveRegistry, "contracts.EnclaveRegistry"),
    verdictLog: addr(C.VerdictLog, "contracts.VerdictLog"),
    sessionPay: addr(C.SessionPay, "contracts.SessionPay"),
    sealedBounty: addr(C.SealedBounty, "contracts.SealedBounty"),
    x402Settler: addr(C.X402Settler, "contracts.X402Settler"),
    demoVault: opt(C.DemoVault) ?? ("0x0000000000000000000000000000000000000000" as Address),
    ...(treasury ? { treasury } : {}),
    ...(inference !== undefined && bounty !== undefined ? { products: { inference, bounty, ...(x402 !== undefined ? { x402 } : {}) } } : {}),
    attestation: C.TdxAttestationModule ? "dcap" : "dev",
    ...(j.levels && opt(j.levels.MachineRegistry)
      ? {
          levels: {
            machineRegistry: addr(j.levels.MachineRegistry, "levels.MachineRegistry"),
            proofOfCloudAuditor: addr(j.levels.ProofOfCloudAuditor, "levels.ProofOfCloudAuditor"),
            ed25519Verifier: addr(j.levels.Ed25519Verifier, "levels.Ed25519Verifier"),
            policyEnclaves: addr(j.levels.PolicyEnclaves, "levels.PolicyEnclaves"),
            sealedBountyVerified: addr(j.levels.SealedBountyVerified, "levels.SealedBountyVerified"),
          },
        }
      : {}),
  };
}

export const DOMAIN_NAME = "ArcEnclaveNetwork";
export const DOMAIN_VERSION = "1";

/** EIP-712 domain of the network's contracts (SessionPay, SealedBounty, X402Settler). */
export function networkDomain(verifyingContract: Address, chainId: number = ARC_TESTNET_ID): TypedDataDomain {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract };
}

/** EIP-712 domain of Arc's USDC (EIP-3009): name "USDC", version "2", checked on Arc testnet. */
export function usdcDomain(usdc: Address, chainId: number = ARC_TESTNET_ID): TypedDataDomain {
  return { name: "USDC", version: "2", chainId, verifyingContract: usdc };
}

// ---- constants of the v2 stacks (taken from the contracts; checked by an on-chain read) ----

/** SessionPay.MIN_SESSION / MAX_SESSION: a session's expiry is within [now + 10 min, now + 30 days]. */
export const SESSION_MIN_SECONDS = 600;
export const SESSION_MAX_SECONDS = 30 * 86_400;
/** Margin the SDK takes on these bounds (the block that includes the transaction comes after the clock is read). */
export const SESSION_EXPIRY_MARGIN_SECONDS = 120;
/** SessionPay.SETTLE_GRACE: time after expiry for a last settlement, before the owner closes the session. */
export const SETTLE_GRACE_SECONDS = 3600;
/** The inference enclave stops serving a session less than 60 s before its expiry (answer 410). */
export const ENCLAVE_EXPIRY_MARGIN_SECONDS = 60;
/** SealedBounty.MAX_SIGS: at most 5 signatures (so k ≤ 5). */
export const BOUNTY_MAX_SIGS = 5;
/** Gas of a registration through the real DCAP (quote verification, RTMR3 event-log replay, policy), measured on Arc
 *  testnet (v2.1 stack): 6,849,014 to 6,866,126. */
export const DCAP_REGISTER_GAS_ESTIMATE = 6_860_000n;
