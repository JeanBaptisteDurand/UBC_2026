/** close-v1-sessions.ts — clôt les sessions de la pile v1 (retirée du site) qui appartiennent au déployeur et dont
 *  l'échéance + grâce est passée : rembourse les dépôts restés bloqués (USDC de testnet). */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const V1: Address = "0x1111111111111111111111111111111111111111";
const abi = parseAbi([
  "struct Session { address owner; uint256 productId; address operator; address sessionKey; uint256 deposit; uint256 cap; uint128 paidUnits; uint256 paid; uint64 expiresAt; bool closed; }",
  "function getSession(uint256 id) view returns (Session)", "function sessionCount() view returns (uint256)", "function closeSession(uint256 sessionId)",
]);
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL("../../.secrets/deployer.json", import.meta.url), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 1000, timeout: 60_000 }) });
const wallet = createWalletClient({ account, chain, transport: http(undefined, { timeout: 90_000, retryCount: 0 }) });
const n = await pub.readContract({ address: V1, abi, functionName: "sessionCount" });
const now = BigInt(Math.floor(Date.now() / 1000));
let refunded = 0n;
for (let i = 1n; i <= n; i++) {
  const s = await pub.readContract({ address: V1, abi, functionName: "getSession", args: [i] }) as any;
  if (s.closed || s.owner.toLowerCase() !== account.address.toLowerCase() || s.expiresAt + 3600n > now) continue;
  const h = await wallet.writeContract({ address: V1, abi, functionName: "closeSession", args: [i], gas: 450_000n });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  const back = BigInt(s.deposit) - BigInt(s.paid); refunded += back;
  console.log(`v1 session #${i} close : ${h} (${r.status}) ; remboursé ≈ ${formatUnits(back, 6)} USDC`);
}
console.log(`total remboursé ≈ ${formatUnits(refunded, 6)} USDC`);
