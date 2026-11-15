/** close-when-due.ts — attend que la session soit clôturable (pile v2 : échéance + SETTLE_GRACE, ou plus tôt si l'enclave
 *  liée ne peut plus rien régler), puis la clôt : reste remboursé au propriétaire et verdict écrit dans ERC-8004 (le SDK
 *  envoie avec la marge de gaz du verdict). Usage : SESSION=<id> npx tsx scripts/close-when-due.ts */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, explainArcError } from "../src/index";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 1000 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
if (!process.env.SESSION) { console.error("SESSION=<id> requis"); process.exit(1); }
const id = BigInt(process.env.SESSION);

async function main() {
  for (;;) {
    const c = await arc.sessionClosability(id);
    if (c.closableNow) break;
    const left = Number(c.atTime - c.now) + 15;
    console.log(`session #${id} : clôturable dans ${left} s (ou après le bloc ${c.afterBlock} si l'enclave liée cesse de pouvoir régler)`);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(left, 5), 300) * 1000));
  }
  const tx = await arc.closeSession(id);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  const after = await arc.getSession(id);
  console.log(`close #${id} : ${tx} (statut ${r.status}, gas ${r.gasUsed}, ${r.logs.length} logs) ; payé ${formatUnits(after.paid, 6)} USDC, fermée ${after.closed}`);
}
main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
