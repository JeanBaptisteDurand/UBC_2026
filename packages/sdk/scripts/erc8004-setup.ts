// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/erc8004-setup.ts`.
/**
 * erc8004-setup.ts — rend les verdicts ERC-8004 « live » sur Arc testnet :
 *  1) l'opérateur crée son identité d'agent dans le registre d'identité ERC-8004 de Circle (si besoin)
 *  2) il autorise VerdictLog à écrire pour son agentId (setApprovalForAll)
 *  3) il déclare son agentId dans OperatorBond (setAgentId)
 *  4) on clôt les sessions clôturables (pile v2 : échéance + 1 h de grâce, ou enclave liée qui ne peut plus rien régler) :
 *     chaque clôture rembourse le reste et écrit un verdict 100 (« vérifié et payé ») dans le registre de validation
 *     ERC-8004 ; le SDK envoie avec la marge de gaz que la v2 exige pour le verdict (sinon InsufficientGasForVerdict).
 * Usage : npx tsx packages/sdk/scripts/erc8004-setup.ts   (clé lue dans .secrets/deployer.json, jamais affichée)
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, testnet, createArcClient, sessionPayAbi, explainArcError } from "../src/index";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address; // ERC-8004 identité, Arc testnet (VERIFIED : getIdentityRegistry())
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
  if (rc.status !== "success") throw new Error(`${functionName} a échoué (${hash})`);
  return { hash, rc, result };
}

async function main() {
  const op = account.address;
  console.log("opérateur :", op);

  // 1) identité ERC-8004
  let agentId = (await pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "agentIdOf", args: [op] })) as bigint;
  if (agentId === 0n) {
    const card = { type: "agent", name: "ArcHive — opérateur d'enclaves", description: "Opérateur d'enclaves Intel TDX dont l'attestation est vérifiée par un contrat d'Arc (ArcHive).", url: "http://62.171.153.35:8900" };
    const agentURI = "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");
    const r = await send(IDENTITY, idAbi, "register", [agentURI]);
    const minted = parseEventLogs({ abi: idAbi, logs: r.rc.logs, eventName: "Transfer" }).find((l: any) => (l.args.to as string).toLowerCase() === op.toLowerCase());
    agentId = (minted?.args as any)?.tokenId ?? (r.result as bigint);
    console.log(`1) identité ERC-8004 créée : agentId ${agentId}  tx ${r.hash}`);
  } else {
    console.log(`1) identité déjà déclarée : agentId ${agentId}`);
  }

  // 2) VerdictLog autorisé à écrire pour cet agent
  const approved = await pub.readContract({ address: IDENTITY, abi: idAbi, functionName: "isApprovedForAll", args: [op, testnet.verdictLog] });
  if (!approved) {
    const r = await send(IDENTITY, idAbi, "setApprovalForAll", [testnet.verdictLog, true]);
    console.log(`2) VerdictLog autorisé  tx ${r.hash}`);
  } else console.log("2) VerdictLog déjà autorisé");

  // 3) agentId déclaré dans la caution
  const cur = (await pub.readContract({ address: testnet.operatorBond, abi: bondAbi, functionName: "agentIdOf", args: [op] })) as bigint;
  if (cur !== agentId) {
    const r = await send(testnet.operatorBond, bondAbi, "setAgentId", [agentId]);
    console.log(`3) setAgentId(${agentId})  tx ${r.hash}`);
  } else console.log("3) agentId déjà posé dans OperatorBond");

  // 4) clôture des sessions clôturables → verdicts
  const count = (await pub.readContract({ address: testnet.sessionPay, abi: sessionPayAbi, functionName: "sessionCount" })) as bigint;
  let written = 0;
  for (let id = 1n; id <= count; id++) {
    const s = await arc.getSession(id);
    if (s.owner.toLowerCase() !== op.toLowerCase()) continue;
    if (s.closed) { console.log(`   session ${id} : déjà close`); continue; }
    const c = await arc.sessionClosability(id);
    if (!c.closableNow) { console.log(`   session ${id} : pas encore clôturable (dans ${Number(c.atTime - c.now)} s, ou après le bloc ${c.afterBlock})`); continue; }
    const hash = await arc.closeSession(id);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`closeSession(${id}) a échoué (${hash})`);
    const rec = parseEventLogs({ abi: vlAbi, logs: rc.logs, eventName: "Recorded" });
    written += rec.length;
    console.log(`4) session ${id} close (dépôt ${s.deposit}, payé ${s.paid})  tx ${hash}  verdict ERC-8004 écrit : ${rec.length ? "oui" : "NON"}`);
  }
  console.log(`\nverdicts ERC-8004 écrits pendant ce passage : ${written}`);
}

main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
