// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/close-when-due.ts`.
/** close-when-due.ts — waits until the session can be closed (expiry + SETTLE_GRACE, or earlier if the bound enclave
 *  can no longer settle anything), then closes it: the rest is refunded to the owner and a verdict is written to ERC-8004
 *  (the SDK sends with the verdict's gas margin). Usage: SESSION=<id> npx tsx scripts/close-when-due.ts */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, explainArcError } from "../src/index";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 1000 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
if (!process.env.SESSION) { console.error("SESSION=<id> required"); process.exit(1); }
const id = BigInt(process.env.SESSION);

async function main() {
  for (;;) {
    const c = await arc.sessionClosability(id);
    if (c.closableNow) break;
    const left = Number(c.atTime - c.now) + 15;
    console.log(`session #${id}: closable in ${left} s (or after block ${c.afterBlock} if the bound enclave can no longer settle)`);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(left, 5), 300) * 1000));
  }
  const tx = await arc.closeSession(id);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  const after = await arc.getSession(id);
  console.log(`close #${id}: ${tx} (status ${r.status}, gas ${r.gasUsed}, ${r.logs.length} logs); paid ${formatUnits(after.paid, 6)} USDC, closed ${after.closed}`);
}
main().catch((e) => { console.error("FAILED:", explainArcError(e, "en")); process.exit(1); });
