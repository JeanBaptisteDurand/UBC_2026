/**
 * operator-setup.ts — sépare les rôles (audit de sécurité du 7/11, faille n° 6) : l'OPÉRATEUR qui fait tourner les
 * enclaves et le registrar n'est plus la clé du déployeur, propriétaire (owner) des contrats v2.
 *  1) crée la clé d'opérateur (.secrets/operator.json, jamais affichée) si elle n'existe pas ;
 *  2) le déployeur lui envoie de quoi payer le gas et la caution ;
 *  3) l'opérateur crée SON identité d'agent ERC-8004, autorise VerdictLog à écrire ses verdicts,
 *     dépose sa caution (EIP-3009) et déclare son agentId dans OperatorBond.
 * Idempotent. Usage : cd enclave && npx tsx scripts/operator-setup.ts
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, parseEventLogs, toHex, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const ob = JSON.parse(readFileSync(new URL("contracts/out/OperatorBond.sol/OperatorBond.json", ROOT), "utf8")).abi as Abi;
const idAbi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true }] },
] as const;

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const OPF = new URL(".secrets/operator.json", ROOT);
if (!existsSync(OPF)) {
  const pk = generatePrivateKey();
  writeFileSync(OPF, JSON.stringify({ address: privateKeyToAccount(pk).address, privateKey: pk, role: "opérateur ArcHive (enclaves + registrar), pas owner des contrats" }, null, 2));
  chmodSync(OPF, 0o600);
  console.log("clé d'opérateur créée dans .secrets/operator.json");
}
const OP = JSON.parse(readFileSync(OPF, "utf8"));
const operator = privateKeyToAccount(OP.privateKey as Hex);
const deployer = privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
const asOp = createWalletClient({ account: operator, chain, transport: http() });
const asDeployer = createWalletClient({ account: deployer, chain, transport: http() });

async function send(w: typeof asOp, address: Address, a: Abi, functionName: string, args: unknown[], label: string) {
  const { request } = await pub.simulateContract({ account: w.account!, address, abi: a, functionName, args } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label} : ${hash} (statut ${r.status}, gas ${r.gasUsed})`);
  if (r.status !== "success") throw new Error(`${label} a échoué`);
  return r;
}

async function main() {
  console.log(`opérateur ${operator.address} (owner des contrats : ${deployer.address})`);
  const bal = await pub.getBalance({ address: operator.address });
  // v2.1 : FUND_USDC (défaut 6) = ce que l'opérateur doit avoir pour le gas ET la caution (BOND_USDC, défaut 3)
  const fund = parseEther(process.env.FUND_USDC ?? "6");
  if (bal < fund - parseEther("1")) {
    const hash = await asDeployer.sendTransaction({ to: operator.address, value: fund - bal });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`opérateur doté : ${hash}`);
  }

  let agentId: bigint | undefined = OP.agentId !== undefined ? BigInt(OP.agentId) : undefined;
  if (agentId === undefined) {
    const card = { type: "agent", name: "ArcHive — opérateur d'enclaves n° 1", description: "Fait tourner des enclaves Intel TDX (chez Phala) dont l'attestation est vérifiée par DCAP sur Arc ; cautionné dans OperatorBond.", url: "https://archive.62-171-153-35.sslip.io" };
    const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");
    const r = await send(asOp, X.ERC8004_Identity!, idAbi as unknown as Abi, "register", [uri], "identité ERC-8004 créée");
    const t = parseEventLogs({ abi: idAbi as unknown as Abi, logs: r.logs, eventName: "Transfer" })[0] as any;
    agentId = t.args.tokenId as bigint;
    writeFileSync(OPF, JSON.stringify({ ...OP, agentId: agentId.toString() }, null, 2));
    chmodSync(OPF, 0o600);
  }
  console.log(`agentId de l'opérateur : ${agentId}`);
  if (!(await pub.readContract({ address: X.ERC8004_Identity!, abi: idAbi, functionName: "isApprovedForAll", args: [operator.address, K.VerdictLog!] })))
    await send(asOp, X.ERC8004_Identity!, idAbi as unknown as Abi, "setApprovalForAll", [K.VerdictLog!, true], "VerdictLog autorisé à écrire ses verdicts");

  const want = BigInt(Math.round(Number(process.env.BOND_USDC ?? "3") * 1e6));
  const have = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [operator.address] })) as bigint;
  if (have < want) {
    const value = want - have;
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await asOp.signTypedData({
      account: operator,
      domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: X.USDC! },
      types: { ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] },
      primaryType: "ReceiveWithAuthorization",
      message: { from: operator.address, to: K.OperatorBond!, value, validAfter: 0n, validBefore, nonce },
    });
    await send(asOp, K.OperatorBond!, ob, "bond", [value, { validAfter: 0n, validBefore, nonce, signature }], `caution +${Number(value) / 1e6} USDC`);
  }
  const cur = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "agentIdOf", args: [operator.address] })) as bigint;
  if (cur !== agentId) await send(asOp, K.OperatorBond!, ob, "setAgentId", [agentId], `agentId ${agentId} déclaré`);
  const bond = await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [operator.address] });
  console.log(`prêt : caution ${Number(bond) / 1e6} USDC, agentId ${agentId}, gas ${Number(await pub.getBalance({ address: operator.address })) / 1e18} USDC`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
