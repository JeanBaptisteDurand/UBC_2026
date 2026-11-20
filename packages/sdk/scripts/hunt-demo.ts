// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/hunt-demo.ts`.
/**
 * hunt-demo.ts — the Sealed Bounty demo, played end to end the way the browser would:
 *  0) the bounty is read ON-CHAIN (product, the protocol's X25519 key) and the bounty enclave's keys are VERIFIED
 *     on-chain (verifyEnclaveKeys: X25519 key = the registered one, enclave active for the bounty's product); otherwise
 *     nothing is encrypted: whoever serves /pubkeys (a proxy) must never be able to read the exploit;
 *  1) the hunter encrypts the exploit (cP for the protocol, cE for the verified enclave) and sends it to the enclave;
 *  2) the enclave replays it on an Arc fork, proves the loss and signs a claim, which is checked (signer, cP…);
 *  3) the SAME claim changed by one byte is refused by the contract (an acceptClaim simulation: nothing is spent);
 *  4) acceptClaim reserves the payment (cP stays out of the transaction), then deliver delivers the report and pays;
 *  5) the protocol decrypts the report with its key.
 * Usage: BOUNTY=1 [O3=https://…-8803.dstack-pha1-prod9.phala.network] npx tsx scripts/hunt-demo.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEventLogs, parseAbi, toBytes, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, testnet, createArcClient, deterministicOpen, sealedBountyAbi, arcErrorsAbi, encodeExploitTx, explainArcError,
} from "../src/index";
import { DEMO_PREDICATE, V2_BOUNTY_URL } from "./demo-shared";

if (!process.env.BOUNTY) { console.error("BOUNTY=<the bounty's id> required (see arcvault bounty list)"); process.exit(1); }
const BOUNTY = BigInt(process.env.BOUNTY);
const O3 = V2_BOUNTY_URL.replace(/\/$/, "");
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const PROTO = JSON.parse(readFileSync(new URL("../../../.secrets/demo-protocol-x25519.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
const evAbi = parseAbi([
  "event BountyPaid(uint256 indexed bountyId, address indexed payee, uint256 amount, uint8 tier)",
  "event ExploitDelivered(uint256 indexed bountyId, bytes cP)",
]);

async function main() {
  const bounty = await arc.getBounty(BOUNTY);
  if (bounty.protocol === "0x0000000000000000000000000000000000000000") throw new Error(`prime #${BOUNTY} inexistante`);
  console.log(`bounty #${BOUNTY}: product #${bounty.productId}, pool ${Number(bounty.balance) / 1e6} USDC`);

  // the REAL exploit: the demo vault's deliberate flaw (migrate without access control), replayed on an Arc fork
  const payee = account.address;
  const txs = [encodeExploitTx({ to: testnet.demoVault, data: encodeFunctionData({ abi: parseAbi(["function migrate(address to)"]), functionName: "migrate", args: [payee] }) })];

  // 0-1) the enclave's keys VERIFIED on-chain for the bounty's product, then encryption (cP to the protocol key read on-chain)
  const sealed = await arc.prepareExploit({ bountyId: BOUNTY, enclaveUrl: O3, exploit: { predicate: DEMO_PREDICATE, txs, capital: 0n }, payee });
  console.log(`0) bounty enclave verified on-chain: ${sealed.enclave.signer} (operator ${sealed.enclave.operator}, registered X25519 key, active at block ${sealed.enclave.checkedAtBlock})`);

  const t0 = Date.now();
  const proven = await arc.proveExploit(sealed);
  console.log(`1-2) the enclave proved the loss (${Number(proven.claim.loss) / 1e6} USDC, tier ${proven.claim.tier}) and signed the claim in ${Date.now() - t0} ms`);

  // 3) the same claim, changed by one byte (the loss + 1): the contract must refuse it
  const tampered = { ...proven.claim, loss: proven.claim.loss + 1n };
  try {
    await pub.simulateContract({ account, address: testnet.sealedBounty, abi: [...sealedBountyAbi, ...arcErrorsAbi], functionName: "acceptClaim", args: [tampered, [proven.signature]] });
    console.log("3) ✗ the changed claim was NOT refused");
  } catch (e) {
    console.log(`3) ✓ claim changed by one byte REFUSED by the contract (${explainArcError(e).slice(0, 110)})`);
  }

  // 4) reservation (acceptClaim), then delivery and payment (deliver)
  const { acceptTx, deliverTx } = await arc.acceptAndDeliver(proven.claim, [proven.signature], proven.cP);
  const rc = await pub.waitForTransactionReceipt({ hash: deliverTx });
  const logs = parseEventLogs({ abi: evAbi, logs: rc.logs });
  const paid = logs.find((l: any) => l.eventName === "BountyPaid") as any;
  const delivered = logs.find((l: any) => l.eventName === "ExploitDelivered") as any;
  console.log(`4) ✓ reserved (${acceptTx}), then paid at block ${rc.blockNumber}: ${Number(paid?.args.amount ?? 0n) / 1e6} USDC to the hunter; report delivered: ${delivered ? "yes" : "no"}  tx ${deliverTx}`);

  // 5) the protocol decrypts the report
  if (delivered) {
    const report = new TextDecoder().decode(deterministicOpen(toBytes(PROTO.privateKey as Hex), delivered.args.cP as Hex));
    const j = JSON.parse(report);
    console.log(`5) ✓ the protocol decrypted the report: hunter ${j.payee}, capital ${Number(j.capital) / 1e6} USDC, predicate ${j.predicate.clauses[0].type}`);
  }
}
main().catch((e) => { console.error("FAILED:", explainArcError(e)); process.exit(1); });
