// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/open-and-use.ts`.
/** open-and-use.ts — opens a real session on the inference enclave and uses it WITHOUT settling on the client side:
 *  it proves that the operator's registrar settles by itself (receipts read from the enclave). Usage: N=3 npx tsx scripts/open-and-use.ts */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, testnet } from "../src/index";
const URL_ = process.env.ENCLAVE_URL ?? "https://archive.62-171-153-35.sslip.io/enclave/inference";
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800, timeout: 60_000 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(undefined, { timeout: 90_000, retryCount: 0 }) });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
const s = await arc.openSession({ productId: testnet.products?.inference ?? 1n, enclaveUrl: URL_, deposit: parseUnits("1", 6), expiresInSeconds: 3600 });
await pub.waitForTransactionReceipt({ hash: s.tx });
console.log(`session #${s.sessionId} opened (through the site's proxy, the enclave's key verified on Arc): ${s.tx}`);
const ai = createInferenceClient({ enclaveUrl: URL_, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
for (let i = 0; i < Number(process.env.N ?? "3"); i++) {
  const r = await ai.chat.completions.create({ messages: [{ role: "user", content: `Question ${i + 1}: explain in three sentences what an Intel TDX attestation is.` }] });
  console.log(`answer ${i + 1}: cumulative ${r.receipt.cumulativeUnits} units (${Number(r.receipt.cumulativeUnits) * 0.0001} USDC due), payable ${r.verified}`);
}
console.log("no settlement on the client side: the operator's registrar must settle by itself (it checks every 10 min).");
