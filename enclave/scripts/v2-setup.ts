/**
 * v2-setup.ts — sets up the v2 stack on Arc testnet (idempotent: can be re-run without duplicates):
 *  1) product 1 "Private AI" (SessionPay) and product 2 "Sealed Bounty" (SealedBounty), proposed then activated,
 *     with the hash of their public manifest (web/public/manifests);
 *  2) the operator's bond (EIP-3009, no approve);
 *  3) its ERC-8004 agent identity declared in OperatorBond, and VerdictLog allowed to write its verdicts.
 * The ABIs come from the compiled artifacts (contracts/out), not from the SDK. Key read from .secrets/deployer.json, never printed.
 * Usage: cd enclave && npx tsx scripts/v2-setup.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const abi = (name: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, ROOT), "utf8")).abi;
const idAbi = [
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const AGENT_ID = 897811n; // the operator's ERC-8004 identity (created on 13 Nov 2026)
const MODEL = "openai/gpt-oss-120b";
const SITE = "https://archive.62-171-153-35.sslip.io";

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const SEC = JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http() });

async function send(address: Address, a: Abi, functionName: string, args: unknown[], label: string) {
  const { request } = await pub.simulateContract({ account, address, abi: a, functionName, args } as any);
  const hash = await wallet.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${hash} (status ${r.status}, gas ${r.gasUsed})`);
  if (r.status !== "success") throw new Error(`${label} failed`);
  return r;
}

function product(kind: "chat" | "bounty") {
  const file = kind === "chat" ? "sealed-chat-v2.json" : "sealed-bounty-v1.json";
  const bytes = readFileSync(new URL(`web/public/manifests/${file}`, ROOT));
  return {
    manifestHash: keccak256(bytes), manifestURI: `${SITE}/manifests/${file}`, workloadIds: [] as Hex[],
    deterministic: kind === "bounty", price: kind === "chat" ? 100n : 0n,
    bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 1_000_000n, exposureCap: 10_000_000n,
    settlement: kind === "chat" ? K.SessionPay! : K.SealedBounty!,
    param: kind === "chat" ? keccak256(toBytes(MODEL)) : keccak256(toBytes("anvil-1.5.1+arc-usdc-shim-v1")),
    advisoryIds: [] as string[], unitTokens: 1, outWeight: 1,
  };
}

async function main() {
  const op = account.address;
  const pr = abi("ProductRegistry"), ob = abi("OperatorBond");
  for (const [i, kind] of [[1n, "chat"], [2n, "bounty"]] as const) {
    const n = (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "productCount" })) as bigint;
    if (n < i) {
      await send(K.ProductRegistry!, pr, "propose", [product(kind)], `product ${i} (${kind}) proposed`);
      await send(K.ProductRegistry!, pr, "activate", [i], `product ${i} activated`);
    }
  }

  const want = 3_000_000n;
  const have = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [op] })) as bigint;
  if (have < want) {
    const value = want - have;
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await wallet.signTypedData({
      account,
      domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: X.USDC! },
      types: { ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] },
      primaryType: "ReceiveWithAuthorization",
      message: { from: op, to: K.OperatorBond!, value, validAfter: 0n, validBefore, nonce },
    });
    await send(K.OperatorBond!, ob, "bond", [value, { validAfter: 0n, validBefore, nonce, signature }], `bond +${Number(value) / 1e6} USDC`);
  }

  const owner = await pub.readContract({ address: X.ERC8004_Identity!, abi: idAbi, functionName: "ownerOf", args: [AGENT_ID] });
  if (owner.toLowerCase() !== op.toLowerCase()) throw new Error(`agent ${AGENT_ID} belongs to ${owner}, not to the operator`);
  const cur = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "agentIdOf", args: [op] })) as bigint;
  if (cur !== AGENT_ID) await send(K.OperatorBond!, ob, "setAgentId", [AGENT_ID], `agentId ${AGENT_ID} declared`);
  if (!(await pub.readContract({ address: X.ERC8004_Identity!, abi: idAbi, functionName: "isApprovedForAll", args: [op, K.VerdictLog!] })))
    await send(X.ERC8004_Identity!, idAbi as unknown as Abi, "setApprovalForAll", [K.VerdictLog!, true], "VerdictLog allowed (ERC-8004)");

  const count = await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "productCount" });
  const bond = await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [op] });
  const free = await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "freeBond", args: [op] });
  console.log(`products ${count}; bond ${Number(bond) / 1e6} USDC (free ${Number(free) / 1e6}); agentId ${await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "agentIdOf", args: [op] })}`);
}
main().catch((e) => { console.error("FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
