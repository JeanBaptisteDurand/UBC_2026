/**
 * levels-machines.ts — the verified level, operator side (10 Nov 2026): for each enclave of the v2.1 stack,
 *   1. finds the quote of its current registration (EnclaveRegistered event → registerEnclave calldata, cross-checked
 *      with Enclave.quoteHash) and binds it to its machine (MachineRegistry.bindMachine: PPID read from Intel's certificate);
 *   2. for each machine (PPID), requests a token from the Proof of Cloud alliance (its three trust servers, an EdDSA
 *      co-signed token), verifies it locally (the alliance's published key), then submits it to ProofOfCloudAuditor,
 *      which verifies it again on-chain and declares the machine (7 days);
 *   3. prints each enclave's level with respect to the Proof of Cloud verifier.
 * Any key can do this (nothing to gain by doing it for someone else); by default the operator key
 * (.secrets/operator.json), never printed. Run it again after each registration renewal (new quote) and at least once
 * a week (token). DRY=1: sends no transaction.
 * Usage: cd enclave && npx tsx scripts/levels-machines.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { ed25519 } from "@noble/curves/ed25519";
import {
  createPublicClient, createWalletClient, decodeFunctionData, http, keccak256, parseAbiItem, type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const DEPLOY_FILE = new URL(process.env.DEPLOYMENTS ?? "deployments.v21.testnet.json", ROOT);
const D = JSON.parse(readFileSync(DEPLOY_FILE, "utf8"));
const K = D.contracts as Record<string, Address>;
const L = D.levels as Record<string, any>;
const DRY = process.env.DRY === "1";
const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
const LOGS_RPC = process.env.LOGS_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.io"; // free tier: bounded log ranges
const KEY_FILE = process.env.KEY_FILE ?? ".secrets/operator.json";
/** The alliance's trust servers (github.com/proofofcloud/trust-server, public_info/peers_list.txt) and its key. */
const PEERS = ["https://trust-server.scrtlabs.com", "https://trust-server.nillion.network", "https://trust-server.iex.ec"];
const ALLIANCE_KEY = (L.allianceKey as string).replace(/^0x/, "");

const art = (name: string) => JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, ROOT), "utf8")).abi as Abi;
const regAbi = art("EnclaveRegistry");
const machinesAbi = art("MachineRegistry");
const pocAbi = art("ProofOfCloudAuditor");

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL(KEY_FILE, ROOT), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 6, retryDelay: 800 }) });
const logs = createPublicClient({ chain, transport: http(LOGS_RPC, { retryCount: 4, retryDelay: 1000 }) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const REGISTERED = parseAbiItem("event EnclaveRegistered(address indexed signer, uint256 indexed productId, address indexed operator, bytes32 workloadId, uint64 expiresAt)");

/** The quote of `signer`'s current registration: walks back the EnclaveRegistered events to the transaction whose
 *  quote reproduces Enclave.quoteHash. */
async function currentQuote(signer: Address, quoteHash: Hex): Promise<Hex> {
  const head = await logs.getBlockNumber();
  const step = 9_000n;
  for (let to = head; to > head - 2_000_000n; to -= step) {
    const from = to - step + 1n;
    const found = await logs.getLogs({ address: K.EnclaveRegistry!, event: REGISTERED, args: { signer }, fromBlock: from, toBlock: to });
    for (const lg of found.reverse()) {
      const tx = await logs.getTransaction({ hash: lg.transactionHash! });
      const { args } = decodeFunctionData({ abi: regAbi, data: tx.input });
      const quote = (args as unknown[])[1] as Hex;
      if (keccak256(quote) === quoteHash) return quote;
    }
  }
  throw new Error(`current quote not found for ${signer}`);
}

async function send(label: string, address: Address, abi: Abi, fn: string, args: unknown[]): Promise<Hex | undefined> {
  if (DRY) {
    console.log(`  [DRY] ${label}`);
    return undefined;
  }
  const { request } = await pub.simulateContract({ account, address, abi, functionName: fn, args } as any);
  const hash = await wallet.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label}: failed`);
  console.log(`  ${label}: tx ${hash} (gas ${r.gasUsed})`);
  return hash;
}

/** POST JSON; `insecure`: TLS certificate not verified (Secret's server has a certificate that expired on 7 Sep 2026). The
 *  final token is verified separately, against the alliance's key, so its integrity does not rely on the channel. */
function postJson(url: string, body: unknown, insecure = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const rq = httpsRequest(url, { method: "POST", headers: { "content-type": "application/json", "content-length": data.length }, rejectUnauthorized: !insecure, timeout: 90_000 }, (rs) => {
      const chunks: Buffer[] = [];
      rs.on("data", (c) => chunks.push(c));
      rs.on("end", () => {
        const t = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: rs.statusCode, body: JSON.parse(t) }); } catch { resolve({ status: rs.statusCode, body: t }); }
      });
    });
    rq.on("timeout", () => rq.destroy(new Error("timeout")));
    rq.on("error", reject);
    rq.end(data);
  });
}

/** The alliance's token for `quote` (the get_jwt_token.sh flow: nonces from the three servers, then partial signatures). */
async function allianceToken(quote: Hex): Promise<{ header: string; payload: string; sig: Hex; machineId: string; ts: number }> {
  const q = quote.slice(2);
  const ts = Math.floor(Date.now() / 1000);
  const nonces: Record<string, string> = {}, urls: Record<string, string> = {};
  for (const u of PEERS) {
    const r = await postJson(`${u}/get_jwt`, { quote: q, timestamp: ts }, u.includes("scrtlabs")).catch((e) => ({ status: 0, body: String(e) }));
    if (r.status === 200 && r.body?.moniker && r.body?.nonce) {
      nonces[r.body.moniker] = r.body.nonce;
      urls[r.body.moniker] = u;
    } else console.log(`  ${u}: ${r.status} ${typeof r.body === "string" ? r.body.slice(0, 100) : JSON.stringify(r.body).slice(0, 100)}`);
  }
  const chosen = Object.keys(nonces).sort();
  if (chosen.length < 3) throw new Error(`alliance: ${chosen.length}/3 servers answered (machine not on the list, or a server is down)`);
  let partial: Record<string, string> = {};
  for (const m of chosen) {
    const r = await postJson(`${urls[m]}/get_jwt`, { quote: q, timestamp: ts, nonces, partial_sigs: partial }, urls[m]!.includes("scrtlabs"));
    if (r.status !== 200) throw new Error(`alliance: signature refused by ${m} (${r.status})`);
    if (r.body?.jwt) {
      const [header, payload, s] = (r.body.jwt as string).split(".");
      const b64 = (x: string) => Buffer.from(x.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const sig = b64(s!);
      if (!ed25519.verify(sig, Buffer.from(`${header}.${payload}`), Buffer.from(ALLIANCE_KEY, "hex"))) throw new Error("alliance: invalid token signature");
      const body = JSON.parse(b64(payload!).toString());
      if (body.quote_hash !== createHash("sha256").update(Buffer.from(q, "hex")).digest("hex")) throw new Error("alliance: token for another quote");
      return { header: header!, payload: payload!, sig: `0x${sig.toString("hex")}`, machineId: body.machine_id, ts: body.timestamp };
    }
    partial = { ...partial, ...r.body };
  }
  throw new Error("alliance: no final token");
}

async function main() {
  const machines = L.MachineRegistry as Address, poc = L.ProofOfCloudAuditor as Address;
  console.log(`key ${account.address}; MachineRegistry ${machines}; Proof of Cloud verifier ${poc}`);
  const byPpid = new Map<string, Hex>();
  L.machines ??= {};
  for (const [id, e] of Object.entries(D.enclaves as Record<string, any>)) {
    const signer = e.signer as Address;
    const enc = (await pub.readContract({ address: K.EnclaveRegistry!, abi: regAbi, functionName: "enclaveOf", args: [signer] })) as any;
    if (!enc.active) {
      console.log(`enclave ${id} (${signer}): inactive, skipped`);
      continue;
    }
    const [ppid, current] = (await pub.readContract({ address: machines, abi: machinesAbi, functionName: "machineOf", args: [signer] })) as [Hex, boolean, bigint];
    const quote = await currentQuote(signer, enc.quoteHash as Hex);
    if (current) console.log(`enclave ${id} (${signer}): already bound to machine ${ppid}`);
    else {
      console.log(`enclave ${id} (${signer}): binding to its machine…`);
      const tx = await send(`bindMachine(${id})`, machines, machinesAbi, "bindMachine", [signer, quote]);
      if (tx) L.txs[`bindMachine-${id}`] = tx;
    }
    const [p] = (await pub.readContract({ address: machines, abi: machinesAbi, functionName: "machineOf", args: [signer] })) as [Hex, boolean, bigint];
    if (p !== "0x00000000000000000000000000000000") {
      byPpid.set(p, quote);
      L.machines[id] = { signer, ppid: p };
    }
  }
  for (const [ppid, quote] of byPpid) {
    const last = Number(await pub.readContract({ address: poc, abi: pocAbi, functionName: "lastTimestamp", args: [ppid] }));
    const [exp] = (await pub.readContract({ address: machines, abi: machinesAbi, functionName: "auditOf", args: [poc, ppid] })) as [bigint, boolean];
    if (Number(exp) - Date.now() / 1000 > 3 * 86400) {
      console.log(`machine ${ppid}: declared by Proof of Cloud until ${new Date(Number(exp) * 1000).toISOString()} (token of ${new Date(last * 1000).toISOString()})`);
      continue;
    }
    console.log(`machine ${ppid}: Proof of Cloud alliance token…`);
    const t = await allianceToken(quote);
    if (`0x${t.machineId}` !== ppid.toLowerCase()) throw new Error(`token for ${t.machineId}, machine ${ppid}`);
    console.log(`  co-signed token verified locally (machine ${t.machineId}, ${new Date(t.ts * 1000).toISOString()})`);
    const tx = await send(`ProofOfCloudAuditor.submit(${ppid.slice(0, 10)})`, poc, pocAbi, "submit", [t.header, t.payload, t.sig]);
    if (tx) L.txs[`pocSubmit-${ppid.slice(2, 10)}-${t.ts}`] = tx;
  }
  for (const [id, m] of Object.entries(L.machines as Record<string, any>)) {
    const v = await pub.readContract({ address: machines, abi: machinesAbi, functionName: "isVerified", args: [m.signer, poc] });
    console.log(`enclave ${id}: ${v ? "verified (machine declared by the Proof of Cloud alliance)" : "open level"}`);
  }
  if (!DRY) writeFileSync(DEPLOY_FILE, JSON.stringify(D, null, 2) + "\n");
}
main().catch((e) => { console.error("FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
