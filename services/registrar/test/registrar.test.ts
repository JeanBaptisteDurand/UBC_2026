/** registrar.test.ts — the registrar against a stub Arc RPC and a stub enclave: no chain, no real key, no network.
 *
 *  Each test starts the REAL src/server.ts in a child process (tsx). RPC_URL and ENCLAVE_URL point at one local HTTP
 *  server: /rpc answers JSON-RPC like Arc (eth_call is decoded with the SDK's ABIs and answered from an in-memory
 *  registry, sessions and product), /enclave answers like the enclave (/pubkeys, /attest, the session receipts).
 *  Transactions are decoded from eth_sendRawTransaction and never leave the process. The operator's key and the
 *  enclave's keys are generated for each test.
 *
 *  Covered: the renewal window (re-attest only when the window ends sooner than RENEW_BEFORE_HOURS), a single
 *  settlement per session receipt over several passes, and the retirement of the previous key after a restart. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiItem,
  parseTransaction, toHex, zeroAddress, type Abi, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { testnet, enclaveRegistryAbi, sessionPayAbi, productRegistryAbi, receiptTypes, networkDomain } from "@arcvault/sdk";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(DIR, "node_modules", ".bin", "tsx");
const D = testnet;
const PRODUCT = 1n;
const HEAD = D.deployBlock + 20_000n;
const BLOCK_MS = 500n; // 12 h (the default RENEW_BEFORE_HOURS) = 86,400 blocks
const L = (a: string) => a.toLowerCase();
const H32 = (n: number) => toHex(n, { size: 32 });

interface Enc { signer: Address; operator: Address; productId: bigint; active: boolean; fromBlock: bigint; untilBlock: bigint }
interface Sess {
  owner: Address; productId: bigint; operator: Address; sessionKey: Address; deposit: bigint; cap: bigint; paidUnits: bigint;
  paid: bigint; expiresAt: bigint; closed: boolean; verdictWritten: boolean; price: bigint; enclave: Address; unitTokens: number;
  outWeight: number; param: Hex;
}
interface Sent { functionName: string; args: readonly unknown[] }

/** The stub chain and enclave, with what the registrar did to them. */
function makeStub() {
  const st = {
    enclaves: new Map<string, Enc>(),
    sessions: new Map<bigint, Sess>(),
    settlement: D.sessionPay as Address,
    /** The signers /pubkeys serves, one per call; the last one stays. */
    pubkeys: [] as Address[],
    pubkeysCalls: 0,
    attestCalls: [] as { operator: string; anchorR: string }[],
    receipts: new Map<bigint, { receipt: Record<string, string>; signature: Hex }>(),
    sent: [] as Sent[],
    txs: new Map<Hex, Address>(),
    raw: new Map<Hex, { to: Address; data: Hex; nonce: number; gas: bigint }>(),
    unknown: [] as string[],
  };
  const abiOf = (to: string): Abi | undefined =>
    L(to) === L(D.enclaveRegistry) ? (enclaveRegistryAbi as Abi) : L(to) === L(D.sessionPay) ? (sessionPayAbi as Abi)
      : L(to) === L(D.productRegistry) ? (productRegistryAbi as Abi) : undefined;
  const enclaveStruct = (signer: Address) => {
    const e = st.enclaves.get(L(signer));
    return {
      signer: e ? e.signer : zeroAddress, x25519: H32(e ? 1 : 0), productId: e?.productId ?? 0n, operator: e?.operator ?? zeroAddress,
      workloadId: H32(0), fmspc: "0x000000000000" as Hex, tcbStatus: 0, quoteHash: H32(0), anchorBlock: e?.fromBlock ?? 0n,
      registeredAt: 0n, expiresAt: 0n, active: e?.active ?? false, fromBlock: e?.fromBlock ?? 0n, untilBlock: e?.untilBlock ?? 0n,
    };
  };
  const zeroSession = (): Sess => ({
    owner: zeroAddress, productId: 0n, operator: zeroAddress, sessionKey: zeroAddress, deposit: 0n, cap: 0n, paidUnits: 0n, paid: 0n,
    expiresAt: 0n, closed: false, verdictWritten: false, price: 0n, enclave: zeroAddress, unitTokens: 0, outWeight: 0, param: H32(0),
  });
  function call(to: string, data: Hex): Hex {
    const abi = abiOf(to);
    if (!abi) throw new Error(`eth_call to an unknown address ${to}`);
    const { functionName, args = [] } = decodeFunctionData({ abi, data });
    const out = (result: unknown) => encodeFunctionResult({ abi, functionName, result } as any);
    switch (functionName) {
      case "BLOCK_TIME_MS": return out(BLOCK_MS);
      case "enclaveOf": return out(enclaveStruct(args[0] as Address));
      case "activeOperatorAt": {
        const e = st.enclaves.get(L(args[0] as string));
        const b = args[2] as bigint;
        return out(e && e.active && e.productId === args[1] && b >= e.fromBlock && b <= e.untilBlock ? e.operator : zeroAddress);
      }
      case "getProduct": return out({
        author: zeroAddress, manifestHash: H32(0), deterministic: false, price: 1n, bpsOperator: 9500, bpsAuthor: 400, bpsNetwork: 100,
        minBond: 0n, exposureCap: 0n, settlement: st.settlement, param: H32(0), version: 1n, activatesAt: 0n, state: 1, unitTokens: 1000,
        outWeight: 1,
      });
      case "manifestURI": return out("ipfs://stub");
      case "getSession": return out(st.sessions.get(args[0] as bigint) ?? zeroSession());
      case "settle": case "retire": return "0x"; // simulation of a write that succeeds
      default: throw new Error(`eth_call ${functionName}: not stubbed`);
    }
  }
  /** A transaction reaches the stub chain: it is recorded and applied. */
  function apply(raw: Hex): Hex {
    const tx = parseTransaction(raw);
    const abi = abiOf(tx.to!);
    if (!abi) throw new Error(`transaction to an unknown address ${tx.to}`);
    const { functionName, args = [] } = decodeFunctionData({ abi, data: tx.data! });
    st.sent.push({ functionName, args });
    if (functionName === "retire" && L(tx.to!) === L(D.enclaveRegistry)) {
      const e = st.enclaves.get(L(args[0] as string));
      if (e) e.active = false;
    }
    if (functionName === "settle" && L(tx.to!) === L(D.sessionPay)) {
      const r = args[0] as { sessionId: bigint; cumulativeUnits: bigint };
      const s = st.sessions.get(r.sessionId)!;
      s.paidUnits = r.cumulativeUnits;
      const owed = r.cumulativeUnits * s.price;
      s.paid = owed > s.deposit ? s.deposit : owed;
    }
    const hash = keccak256(raw);
    st.txs.set(hash, tx.to!);
    st.raw.set(hash, { to: tx.to!, data: tx.data!, nonce: tx.nonce ?? 0, gas: tx.gas ?? 0n });
    return hash;
  }
  const opened = parseAbiItem("event SessionOpened(uint256 indexed sessionId, address indexed owner, uint256 indexed productId, uint256 deposit)");
  function logs(f: { address?: string; fromBlock: Hex; toBlock: Hex }) {
    if (!f.address || L(f.address) !== L(D.sessionPay)) return [];
    const from = BigInt(f.fromBlock), to = BigInt(f.toBlock), at = HEAD - 100n;
    if (at < from || at > to) return [];
    return [...st.sessions.entries()].filter(([, s]) => s.productId === PRODUCT).map(([id, s], i) => ({
      address: D.sessionPay, blockNumber: toHex(at), blockHash: H32(7), transactionHash: H32(100 + i), transactionIndex: "0x0",
      logIndex: toHex(i), removed: false,
      topics: encodeEventTopics({ abi: [opened], eventName: "SessionOpened", args: { sessionId: id, owner: s.owner, productId: s.productId } }),
      data: encodeAbiParameters([{ type: "uint256" }], [s.deposit]),
    }));
  }
  function rpc(method: string, params: any[]): unknown {
    switch (method) {
      case "eth_chainId": return toHex(D.chainId);
      case "eth_blockNumber": return toHex(HEAD);
      case "eth_getBlockByNumber": return {
        number: toHex(HEAD), hash: H32(9), parentHash: H32(8), timestamp: toHex(Math.floor(Date.now() / 1000)), gasLimit: "0x1c9c380",
        gasUsed: "0x0", baseFeePerGas: "0x1", miner: zeroAddress, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x",
        logsBloom: `0x${"0".repeat(512)}`, nonce: "0x0000000000000000", sha3Uncles: H32(0), size: "0x0", stateRoot: H32(0),
        transactionsRoot: H32(0), receiptsRoot: H32(0), mixHash: H32(0), transactions: [], uncles: [],
      };
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_gasPrice": return "0x2";
      case "eth_estimateGas": return "0x30000";
      case "eth_getTransactionCount": return toHex(st.sent.length);
      case "eth_call": return call(params[0].to, (params[0].data ?? params[0].input) as Hex);
      case "eth_getLogs": return logs(params[0]);
      case "eth_sendRawTransaction": return apply(params[0]);
      case "eth_getTransactionByHash": {
        const t = st.raw.get(params[0]);
        if (!t) return null;
        return {
          hash: params[0], blockHash: H32(9), blockNumber: toHex(HEAD), transactionIndex: "0x0", from: zeroAddress, to: t.to,
          input: t.data, nonce: toHex(t.nonce), gas: toHex(t.gas), gasPrice: "0x2", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x1",
          value: "0x0", type: "0x2", chainId: toHex(D.chainId), accessList: [], v: "0x0", yParity: "0x0", r: H32(1), s: H32(2),
        };
      }
      case "eth_getTransactionReceipt": {
        const to = st.txs.get(params[0]);
        if (!to) return null;
        return {
          transactionHash: params[0], blockHash: H32(9), blockNumber: toHex(HEAD), transactionIndex: "0x0", from: zeroAddress, to,
          status: "0x1", gasUsed: "0x5208", cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x1", type: "0x2", contractAddress: null,
          logs: [], logsBloom: `0x${"0".repeat(512)}`,
        };
      }
      default: st.unknown.push(method); throw Object.assign(new Error(`method ${method} not stubbed`), { code: -32601 });
    }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let body = "";
    for await (const c of req) body += c;
    const send = (status: number, j: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const url = req.url ?? "";
    if (url === "/rpc") {
      const one = (m: any) => {
        try { return { jsonrpc: "2.0", id: m.id, result: rpc(m.method, m.params ?? []) }; }
        catch (e: any) { return { jsonrpc: "2.0", id: m.id, error: { code: e.code ?? 3, message: String(e.message ?? e) } }; }
      };
      const m = JSON.parse(body);
      return send(200, Array.isArray(m) ? m.map(one) : one(m));
    }
    if (url === "/enclave/pubkeys") {
      const s = st.pubkeys[Math.min(st.pubkeysCalls, st.pubkeys.length - 1)];
      st.pubkeysCalls++;
      return send(200, { signer: s });
    }
    if (url === "/enclave/attest") {
      st.attestCalls.push(JSON.parse(body || "{}"));
      return send(503, { error: "stub enclave: no quote in this test" });
    }
    const m = /^\/enclave\/v1\/session\/(\d+)\/receipt$/.exec(url);
    if (m && st.receipts.has(BigInt(m[1]!))) return send(200, st.receipts.get(BigInt(m[1]!)));
    if (url.startsWith("/enclave/x402/")) return send(200, { pending: [] });
    return send(404, { error: "not found" });
  }
  const server = createServer((req, res) => { handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }); });
  return { st, server };
}

/** Starts the stub, then the real registrar against it; `until` is polled until true (or the registrar exits). */
async function runRegistrar(
  setup: (st: ReturnType<typeof makeStub>["st"], operator: Address) => void | Promise<void>,
  env: Record<string, string>,
  until?: (st: ReturnType<typeof makeStub>["st"]) => boolean,
) {
  const pk = generatePrivateKey();
  const operator = privateKeyToAccount(pk).address;
  const { st, server } = makeStub();
  await setup(st, operator);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const child = spawn(TSX, ["src/server.ts"], {
    cwd: DIR,
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp",
      ENCLAVE_URL: `http://127.0.0.1:${port}/enclave`, RPC_URL: `http://127.0.0.1:${port}/rpc`, ARC_PK: pk,
      PRODUCT_ID: String(PRODUCT), LEVELS: "0", SESSION_SCAN_PAUSE_MS: "0", ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  let done = false;
  void exited.then(() => (done = true));
  const deadline = Date.now() + 40_000;
  while (!done && Date.now() < deadline && !(until && until(st))) await new Promise((r) => setTimeout(r, 50));
  if (!done) { child.kill("SIGTERM"); await exited; }
  await new Promise<void>((r) => server.close(() => r()));
  return { st, out, operator };
}

const enclave = (operator: Address, untilIn: bigint, extra: Partial<Enc> = {}) => {
  const signer = privateKeyToAccount(generatePrivateKey()).address;
  return { signer, operator, productId: PRODUCT, active: true, fromBlock: HEAD - 10_000n, untilBlock: HEAD + untilIn, ...extra } as Enc;
};

test("renewal window: an enclave whose window ends in more than RENEW_BEFORE_HOURS is not re-attested", async () => {
  const { st, out } = await runRegistrar((st, op) => {
    const e = enclave(op, 100_000n); // ≈ 13.9 h left, RENEW_BEFORE_HOURS defaults to 12 h (86,400 blocks)
    st.enclaves.set(L(e.signer), e);
    st.pubkeys = [e.signer];
  }, { ONCE: "1", SETTLE: "0" });
  assert.equal(st.attestCalls.length, 0, out);
  assert.equal(st.sent.length, 0, out);
  assert.doesNotMatch(out, /re-attestation/);
  assert.deepEqual(st.unknown, []);
});

test("renewal window: an enclave whose window ends sooner is re-attested (a fresh quote is requested for this operator)", async () => {
  let op: Address = zeroAddress;
  const { st, out } = await runRegistrar((st, operator) => {
    op = operator;
    const e = enclave(operator, 50_000n); // ≈ 6.9 h left < 12 h
    st.enclaves.set(L(e.signer), e);
    st.pubkeys = [e.signer];
  }, { ONCE: "1", SETTLE: "0" });
  assert.match(out, /re-attestation: window ends in 50000 blocks/);
  assert.equal(st.attestCalls.length, 1, out);
  assert.equal(L(st.attestCalls[0]!.operator), L(op));
  assert.equal(st.attestCalls[0]!.anchorR, String(HEAD - 10n));
  // the stub enclave has no quote: nothing is sent to the registry
  assert.equal(st.sent.length, 0, out);
});

test("renewal window: RENEW_BEFORE_HOURS moves the threshold", async () => {
  const { st, out } = await runRegistrar((st, op) => {
    const e = enclave(op, 50_000n); // ≈ 6.9 h left, threshold set to 6 h
    st.enclaves.set(L(e.signer), e);
    st.pubkeys = [e.signer];
  }, { ONCE: "1", SETTLE: "0", RENEW_BEFORE_HOURS: "6" });
  assert.equal(st.attestCalls.length, 0, out);
});

test("renewal window: a signer that is not active for this product is re-attested", async () => {
  const { st, out } = await runRegistrar((st, op) => {
    const e = enclave(op, 100_000n, { active: false });
    st.enclaves.set(L(e.signer), e);
    st.pubkeys = [e.signer];
  }, { ONCE: "1", SETTLE: "0" });
  assert.match(out, /re-attestation: signer 0x[0-9a-fA-F]{40} not active for product #1/);
  assert.equal(st.attestCalls.length, 1, out);
});

test("settlement: a session receipt is settled once, however many passes run", async () => {
  const PRICE = 10n, UNITS = 5_000n; // 0.05 USDC due ≥ SETTLE_MIN (0.02 USDC)
  const { st, out } = await runRegistrar(async (st, op) => {
    const key = generatePrivateKey();
    const e = enclave(op, 100_000n, { signer: privateKeyToAccount(key).address });
    st.enclaves.set(L(e.signer), e);
    st.pubkeys = [e.signer];
    const model = H32(42);
    st.sessions.set(7n, {
      owner: privateKeyToAccount(generatePrivateKey()).address, productId: PRODUCT, operator: op, sessionKey: zeroAddress,
      deposit: 1_000_000n, cap: 0n, paidUnits: 0n, paid: 0n, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86_400), closed: false,
      verdictWritten: false, price: PRICE, enclave: e.signer, unitTokens: 1000, outWeight: 1, param: model,
    });
    const receipt = {
      productId: PRODUCT, sessionId: 7n, seq: 3n, modelHash: model, paramsHash: H32(1), requestHash: H32(2), responseHash: H32(3),
      tokensIn: 100n, tokensOut: 200n, cumulativeUnits: UNITS, anchorBlock: HEAD - 50n,
    };
    const signature = await privateKeyToAccount(key).signTypedData({
      domain: networkDomain(D.sessionPay, D.chainId) as any, types: receiptTypes, primaryType: "Receipt", message: receipt,
    });
    st.receipts.set(7n, { receipt: Object.fromEntries(Object.entries(receipt).map(([k, v]) => [k, String(v)])), signature });
  }, { SETTLE: "1", CHECK_MINUTES: "0.002" }, (st) => st.pubkeysCalls >= 5);
  assert.ok(st.pubkeysCalls >= 5, `only ${st.pubkeysCalls} passes\n${out}`);
  const settles = st.sent.filter((t) => t.functionName === "settle");
  assert.equal(settles.length, 1, out);
  assert.equal((settles[0]!.args[0] as { cumulativeUnits: bigint }).cumulativeUnits, UNITS);
  assert.equal(st.sessions.get(7n)!.paid, UNITS * PRICE);
  assert.match(out, /session #7 settled: \+0\.05 USDC/);
});

test("restart: the key this URL served before is retired once, the new one is kept", async () => {
  let a: Enc | undefined, b: Enc | undefined;
  const { st, out } = await runRegistrar((st, op) => {
    a = enclave(op, 100_000n);
    b = enclave(op, 100_000n);
    st.enclaves.set(L(a.signer), a);
    st.enclaves.set(L(b.signer), b);
    st.pubkeys = [a.signer, b.signer]; // the enclave restarts between the first and the second pass
  }, { SETTLE: "0", CHECK_MINUTES: "0.002" }, (st) => st.pubkeysCalls >= 5);
  assert.ok(st.pubkeysCalls >= 5, `only ${st.pubkeysCalls} passes\n${out}`);
  assert.deepEqual(st.sent.map((t) => [t.functionName, L(t.args[0] as string)]), [["retire", L(a!.signer)]], out);
  assert.equal(st.enclaves.get(L(a!.signer))!.active, false);
  assert.equal(st.enclaves.get(L(b!.signer))!.active, true);
  assert.match(out, /old key 0x[0-9a-fA-F]{40} retired \(enclave restarted\)/);
});

test("restart: a previous key that belongs to another operator is left alone", async () => {
  const { st, out } = await runRegistrar((st, op) => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const a = enclave(other, 100_000n);
    const b = enclave(op, 100_000n);
    st.enclaves.set(L(a.signer), a);
    st.enclaves.set(L(b.signer), b);
    st.pubkeys = [a.signer, b.signer];
  }, { SETTLE: "0", CHECK_MINUTES: "0.002" }, (st) => st.pubkeysCalls >= 5);
  assert.ok(st.pubkeysCalls >= 5, `only ${st.pubkeysCalls} passes\n${out}`);
  assert.deepEqual(st.sent, [], out);
});

test("restart: RETIRE_PREVIOUS=0 keeps the previous key", async () => {
  const { st, out } = await runRegistrar((st, op) => {
    const a = enclave(op, 100_000n);
    const b = enclave(op, 100_000n);
    st.enclaves.set(L(a.signer), a);
    st.enclaves.set(L(b.signer), b);
    st.pubkeys = [a.signer, b.signer];
  }, { SETTLE: "0", CHECK_MINUTES: "0.002", RETIRE_PREVIOUS: "0" }, (st) => st.pubkeysCalls >= 5);
  assert.ok(st.pubkeysCalls >= 5, `only ${st.pubkeysCalls} passes\n${out}`);
  assert.deepEqual(st.sent, [], out);
});
