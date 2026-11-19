/**
 * replay-check.ts — vérifie le VRAI rejeu (AnvilForkRunner) contre Arc testnet, sans enclave ni contrat :
 *  1) un exploit réel (DemoVault.migrate) : le prédicat « le solde USDC du coffre baisse d'au moins 1 USDC » est prouvé ;
 *  2) une transaction inoffensive (pause) : rien ne baisse, le prédicat n'est PAS prouvé ;
 *  3) l'ancien « exploit » vide de la démo (txs: ["0x"]) : refusé avant tout rejeu.
 * Pré-requis : anvil dans le PATH (ou ANVIL_BIN), et un coffre doté d'au moins 1 USDC (FUND=1 le dote depuis le déployeur).
 * Usage : FUND=1 npx tsx scripts/replay-check.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AnvilForkRunner, encodeExploitTx, ARC_USDC } from "../src/services/anvil-fork";
import { evaluate, type Predicate } from "../src/services/predicate";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
const VAULT = (process.env.VAULT ?? "0x250C64fcbb61Ca4B9278330ae3711DCcADD1AB09") as Address; // DemoVault de la pile v2.1
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const vaultAbi = parseAbi(["function migrate(address to)", "function pause()"]);
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 800 }) });

const predicate: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: ARC_USDC, holder: VAULT, min: "1000000" }] };
const bundle = (txs: Hex[]) => ({ bountyId: 0n, payee: HUNTER, capital: 0n, predicate, txs, r: "0x" as Hex, cP: "0x" as Hex });

async function main() {
  let bal = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [VAULT] });
  if (bal < 1_000_000n && process.env.FUND === "1") {
    const sec = JSON.parse(readFileSync(new URL("../../.secrets/deployer.json", import.meta.url), "utf8"));
    const account = privateKeyToAccount(sec.privateKey as Hex);
    const wallet = createWalletClient({ account, chain, transport: http(RPC) });
    const tx = await wallet.writeContract({ address: ARC_USDC, abi: usdcAbi, functionName: "transfer", args: [VAULT, 1_000_000n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`coffre doté de 1 USDC : ${tx}`);
    bal = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [VAULT] });
  }
  console.log(`coffre ${VAULT} : ${Number(bal) / 1e6} USDC sur la chaîne`);
  const N = (await pub.getBlockNumber()) - 3n;
  const runner = new AnvilForkRunner({ forkUrl: RPC, anvilBin: process.env.ANVIL_BIN });

  const t0 = Date.now();
  const exploit = await runner.run({ blockN: N, bundle: bundle([encodeExploitTx({ to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: "migrate", args: [HUNTER] }) })]) });
  const r1 = evaluate(predicate, exploit.ctx);
  console.log(`1) exploit réel : prouvé=${r1.satisfied}, perte ${Number(r1.loss) / 1e6} USDC, profit du chasseur ${Number(exploit.ctx.attackerProfit(ARC_USDC)) / 1e6} USDC, empreinte ${exploit.fingerprint.slice(0, 18)}… (${Date.now() - t0} ms)`);

  const harmless = await runner.run({ blockN: N, bundle: bundle([encodeExploitTx({ to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: "pause" }) })]) });
  const r2 = evaluate(predicate, harmless.ctx);
  console.log(`2) transaction inoffensive : prouvé=${r2.satisfied}, perte ${Number(r2.loss) / 1e6} USDC`);

  try { await runner.run({ blockN: N, bundle: bundle(["0x"]) }); console.log("3) ÉCHEC : l'exploit vide a été accepté"); }
  catch (e) { console.log(`3) exploit vide refusé : ${(e as Error).message.slice(0, 80)}`); }

  const after = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [VAULT] });
  console.log(`coffre sur la vraie chaîne après les rejeux : ${Number(after) / 1e6} USDC (inchangé : le rejeu ne touche que le fork)`);
  if (!r1.satisfied || r2.satisfied) process.exit(1);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
