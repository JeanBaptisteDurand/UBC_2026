// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/erc8004-setup.ts`.
/**
 * erc8004-setup.ts — makes the ERC-8004 verdicts live on Arc testnet:
 *  1) the operator creates its agent identity in Circle's ERC-8004 identity registry (if needed);
 *  2) it allows VerdictLog to write for its agentId (setApprovalForAll);
 *  3) it declares its agentId in OperatorBond (setAgentId);
 *  4) the closable sessions are closed (expiry + 1 h of grace, or a bound enclave that can no longer settle anything):
 *     each closing refunds the rest and writes a verdict of 100 ("verified and paid") to the ERC-8004 validation
 *     registry; the SDK sends with the gas margin the verdict requires (otherwise InsufficientGasForVerdict).
 * Usage: npx tsx packages/sdk/scripts/erc8004-setup.ts   (key read from .secrets/deployer.json, never shown)
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, testnet, createArcClient, sessionPayAbi, explainArcError } from "../src/index";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address; // ERC-8004 identity registry on Arc testnet (as getIdentityRegistry() returns it)
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

const idAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const bondAbi = parseAbi([
  "function setAgentId(uint256 agentId)",
  "function agentIdOf(address operator) view returns (uint256)",
]);
const vlAbi = parseAbi(["event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag)"]);

async function send(address: Address, abi: any, functionName: string, args: unknown[]) {
  const { request, result } = await pub.simulateContract({ account, address, abi, functionName, args } as any);
  const hash = await wallet.writeContract(request as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} failed (${hash})`);
  return { hash, rc, result };
}

async function main() {
  const op = account.address;
  console.log("operator:", op);

  // 1) ERC-8004 identity
  let agentId = (await pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "agentIdOf", args: [op] })) as bigint;
  if (agentId === 0n) {
    const card = { type: "agent", name: "ArcHive — enclave operator", description: "Operator of Intel TDX enclaves whose attestation an Arc contract verifies (ArcHive).", url: "http://62.171.153.35:8900" };
    const agentURI = "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");
    const r = await send(IDENTITY, idAbi, "register", [agentURI]);
    const minted = parseEventLogs({ abi: idAbi, logs: r.rc.logs, eventName: "Transfer" }).find((l: any) => (l.args.to as string).toLowerCase() === op.toLowerCase());
    agentId = (minted?.args as any)?.tokenId ?? (r.result as bigint);
    console.log(`1) ERC-8004 identity created: agentId ${agentId}  tx ${r.hash}`);
  } else {
    console.log(`1) identity already declared: agentId ${agentId}`);
  }

  // 2) VerdictLog allowed to write for this agent
  const approved = await pub.readContract({ address: IDENTITY, abi: idAbi, functionName: "isApprovedForAll", args: [op, testnet.verdictLog] });
  if (!approved) {
    const r = await send(IDENTITY, idAbi, "setApprovalForAll", [testnet.verdictLog, true]);
    console.log(`2) VerdictLog allowed  tx ${r.hash}`);
  } else console.log("2) VerdictLog already allowed");

  // 3) agentId declared in the bond
  const cur = (await pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "agentIdOf", args: [op] })) as bigint;
  if (cur !== agentId) {
    const r = await send(testnet.operatorBond, bondAbi, "setAgentId", [agentId]);
    console.log(`3) setAgentId(${agentId})  tx ${r.hash}`);
  } else console.log("3) agentId already set in OperatorBond");

  // 4) closing the closable sessions → verdicts
  const count = (await pub.readContract({ address: testnet.sessionPay, abi: sessionPayAbi, functionName: "sessionCount" })) as bigint;
  let written = 0;
  for (let id = 1n; id <= count; id++) {
    const s = await arc.getSession(id);
    if (s.owner.toLowerCase() !== op.toLowerCase()) continue;
    if (s.closed) { console.log(`   session ${id}: already closed`); continue; }
    const c = await arc.sessionClosability(id);
    if (!c.closableNow) { console.log(`   session ${id}: not closable yet (in ${Number(c.atTime - c.now)} s, or after block ${c.afterBlock})`); continue; }
    const hash = await arc.closeSession(id);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`closeSession(${id}) failed (${hash})`);
    const rec = parseEventLogs({ abi: vlAbi, logs: rc.logs, eventName: "Recorded" });
    written += rec.length;
    console.log(`4) session ${id} closed (deposit ${s.deposit}, paid ${s.paid})  tx ${hash}  ERC-8004 verdict written: ${rec.length ? "yes" : "NO"}`);
  }
  console.log(`\nERC-8004 verdicts written during this pass: ${written}`);
}

main().catch((e) => { console.error("FAILED:", explainArcError(e)); process.exit(1); });
