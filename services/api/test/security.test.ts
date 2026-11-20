/** security.test.ts — the API's safeguards (stateless nonces, the rate for a room behind one Wi-Fi, caps per account
 *  and per network, pairing by code, operator keys, test mode), against a LOCAL instance: the operator routes and
 *  the test mode mounted on a local Hono server, a SIMULATED Arc RPC (no network call, no transaction), throwaway
 *  wallet keys generated here, a long token. The signed messages are built by the site's own code
 *  (web/src/signin.ts, EIP-4361 "Sign-In with Ethereum" format).
 *  Run: cd services/api && npx tsx --test test/security.test.ts */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseAbi, parseTransaction, recoverMessageAddress,
  recoverTypedDataAddress, toHex, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, testnet, eip3009SignatureProblem, receiveWithAuthorizationTypes, usdcDomain, x402CallNonce, X402_MAX_VALIDITY_SECONDS,
} from "@arcvault/sdk";
import { buildSignIn, statementOf, type SignedAction } from "../../../web/src/signin";

// ---------------------------------------------------------------- simulated Arc RPC

const DEAD = "0x000000000000000000000000000000000000dEaD";
/** a simulated smart wallet (ERC-1271): code at its address, and the RPC answers "valid signature" for it alone */
const SMART = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe1271";
const testPk = generatePrivateKey();
const testWallet = privateKeyToAccount(testPk);
const sentRaw: Hex[] = [];
/** the smart wallet's signature checks asked of the RPC (eth_call): what a reused read no longer costs */
let smartChecks = 0;
const word = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0") + "00".repeat(32 * 3);
/** simulated owners: session 1 and bounties 1 and 7 belong to the test wallet, the rest to a third party */
function ownerOf(sel: string, id: bigint): string {
  if (sel === "0x402ff0db") return id === 1n ? testWallet.address : DEAD; // getSession
  if (sel === "0xee8c4bbf") return id === 1n || id === 7n ? testWallet.address : DEAD; // getBounty
  return DEAD;
}
const REOPEN_7 = encodeFunctionData({ abi: parseAbi(["function reopen(uint256)"]), functionName: "reopen", args: [7n] });
function rpc(method: string, params: any[]): unknown {
  switch (method) {
    case "eth_chainId": return "0x" + arcTestnet.id.toString(16);
    case "eth_blockNumber": return "0x100";
    case "eth_getCode": return String(params[0] ?? "").toLowerCase() === SMART ? "0x6080604052" : "0x";
    case "eth_getTransactionCount": return "0x0";
    case "eth_gasPrice": return "0x3b9aca00";
    case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
    case "eth_getBlockByNumber":
      return { number: "0x100", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), timestamp: "0x6700000", baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] };
    case "eth_estimateGas": return String(params[0]?.data ?? "") === REOPEN_7 ? "0x4c4b40" /* 5 M */ : "0x30d40" /* 200 000 */;
    case "eth_call": {
      const data = String(params[0]?.data ?? "");
      // viem's ERC-1271 / ERC-6492 check (universal validator without deployment): "valid" for SMART only
      if (data.toLowerCase().includes(SMART.slice(2))) { smartChecks++; return "0x" + "0".repeat(63) + "1"; }
      return word(ownerOf(data.slice(0, 10), BigInt("0x" + (data.slice(10, 74) || "0"))));
    }
    case "eth_sendRawTransaction": sentRaw.push(params[0]); return keccak256(params[0]);
  }
  throw new Error(`RPC method not simulated: ${method}`);
}
const rpcServer: Server = createServer((req, res) => {
  let s = "";
  req.on("data", (d) => (s += d));
  req.on("end", () => {
    const one = (q: any) => { try { return { jsonrpc: "2.0", id: q.id, result: rpc(q.method, q.params ?? []) }; } catch (e) { return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: (e as Error).message } }; } };
    const q = JSON.parse(s);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(q) ? q.map(one) : one(q)));
  });
});

// ---------------------------------------------------------------- initial state: expired pairings to purge

const dataDir = mkdtempSync(join(tmpdir(), "archive-api-test-"));
const TOKEN = randomBytes(36).toString("base64url"); // long token (48 characters)
const opOld = privateKeyToAccount(generatePrivateKey());
const OLD_MACHINE = "11111111-1111-4111-8111-111111111111";
const OLD_SECRET = "S".repeat(32);
const DC_EXPIRED = "a".repeat(32), DC_APPROVED = "b".repeat(32), DC_FRESH = "c".repeat(32);
const now0 = Date.now();
writeFileSync(join(dataDir, "operators.json"), JSON.stringify({
  keys: { aaaaaaaa: { keyId: "aaaaaaaa", hash: createHash("sha256").update(OLD_SECRET).digest("hex"), operator: opOld.address.toLowerCase(), label: "machine vieille", machineId: OLD_MACHINE, createdAt: now0 - 3_600_000, lastUsedAt: null, revoked: false } },
  pairs: {
    [DC_EXPIRED]: { deviceCode: DC_EXPIRED, userCode: "HIVE-ABCD", hostname: "h", mode: "demo", version: "", createdAt: now0 - 3_600_000, expiresAt: now0 - 600_000, status: "pending" },
    [DC_APPROVED]: { deviceCode: DC_APPROVED, userCode: "HIVE-EFGH", hostname: "vieille", mode: "demo", version: "", createdAt: now0 - 3_600_000, expiresAt: now0 - 600_000, status: "approved", operator: opOld.address.toLowerCase(), machineId: OLD_MACHINE, keyPlain: `arcop_aaaaaaaa_${OLD_SECRET}` },
    [DC_FRESH]: { deviceCode: DC_FRESH, userCode: "HIVE-7K2P-QX9M", hostname: "hote-secret", mode: "dstack", version: "0.1.0", createdAt: now0, expiresAt: now0 + 600_000, status: "pending" },
  },
  machines: { [OLD_MACHINE]: { machineId: OLD_MACHINE, operator: opOld.address.toLowerCase(), hostname: "vieille", mode: "demo", version: "", productId: null, enclaveUrl: null, signer: null, x25519: null, status: "paired", doctor: null, logs: ["vieux journal"], lastSeen: null, createdAt: now0 - 3_600_000 } },
}));

// ---------------------------------------------------------------- l'API locale

let base = "";
let apiServer: ReturnType<typeof serve>;
let ops: typeof import("../src/operators");
const logs: string[] = [];
const origLog = console.log;
let ipN = 0;
const freshIp = () => `203.0.113.${(++ipN % 250) + 1}`;

/** every error answer of the operator routes seen during the tests (the last test checks its stable code) */
const errorsSeen: Array<{ path: string; status: number; json: any }> = [];
async function call(path: string, o: { method?: string; body?: unknown; ip?: string; auth?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? freshIp() };
  if (o.body !== undefined || o.raw !== undefined) headers["content-type"] = "application/json";
  if (o.auth) headers.authorization = o.auth;
  const r = await fetch(base + path, { method: o.method ?? (o.body !== undefined || o.raw !== undefined ? "POST" : "GET"), headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* corps non JSON */ }
  if (r.status >= 400 && !path.startsWith("/test-signer")) errorsSeen.push({ path, status: r.status, json });
  return { status: r.status, json, headers: r.headers };
}

// ---- wallet signatures, the way the site makes them (EIP-4361) ----
const SITE = { domain: "archive.test", uri: "https://archive.test" }; // WEB_URL of the test instance
type Acct = ReturnType<typeof privateKeyToAccount>;
type Nonce = { nonce: string; issuedAt: string };
async function nonce(): Promise<Nonce> {
  const r = await call("/auth/nonce");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { nonce: r.json.nonce, issuedAt: r.json.issuedAt };
}
type SignOpts = { domain?: string; uri?: string; chainId?: number; nonce?: Nonce; address?: string; edit?: (m: string) => string };
/** the site's message for this action (a fresh API nonce by default); `edit` changes it before signing */
async function siwe(action: SignedAction, address: string, o: SignOpts = {}): Promise<string> {
  const n = o.nonce ?? (await nonce());
  const { message } = buildSignIn({
    domain: o.domain ?? SITE.domain, uri: o.uri ?? SITE.uri, chainId: o.chainId ?? arcTestnet.id,
    address, action, nonce: n.nonce, issuedAt: n.issuedAt,
  });
  return o.edit ? o.edit(message) : message;
}
/** { address, message, signature }: signed by `acct`, in the name of `o.address` (by default `acct`'s) */
async function signIn(acct: Acct, action: SignedAction, o: SignOpts = {}) {
  const address = o.address ?? acct.address;
  const message = await siwe(action, address, o);
  return { address, message, signature: await acct.signMessage({ message }) };
}
/** the same, with a nonce requested from `ip` (like an operator's site behind that address) */
async function signFrom(ip: string, acct: Acct, action: SignedAction, o: SignOpts = {}) {
  const r = await call("/auth/nonce", { ip });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return signIn(acct, action, { ...o, nonce: { nonce: r.json.nonce, issuedAt: r.json.issuedAt } });
}
const rpcCall = (method: string, params: unknown[], auth = `Bearer ${TOKEN}`) => call("/test-signer/rpc", { body: { method, params }, auth });

before(async () => {
  await new Promise<void>((ok) => rpcServer.listen(0, "127.0.0.1", ok));
  const rpcUrl = `http://127.0.0.1:${(rpcServer.address() as AddressInfo).port}`;
  Object.assign(process.env, { DATA_DIR: dataDir, WEB_URL: `${SITE.uri}/`, RPC_URL: rpcUrl, TEST_SIGNER_PK: testPk, TEST_SIGNER_TOKEN: TOKEN });
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  ops = await import("../src/operators");
  const { registerTestSigner } = await import("../src/testSigner");
  const app = new Hono();
  const pub = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  ops.registerOperatorRoutes(app, { pub, getEnclave: async () => undefined } as any);
  registerTestSigner(app);
  await new Promise<void>((ok) => { apiServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => ok()); });
  base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});
after(() => {
  console.log = origLog;
  apiServer?.close();
  rpcServer.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ================================================================ n° 3 et 5 : appairage

test("purge at startup: expired pairings erased, a key never handed over revoked, a machine never seen removed", async () => {
  assert.equal((await call("/pair/poll", { body: { deviceCode: DC_EXPIRED } })).status, 404);
  assert.equal((await call("/pair/poll", { body: { deviceCode: DC_APPROVED } })).status, 404);
  const hb = await call("/machines/heartbeat", { body: { hostname: "vieille", status: "running" }, auth: `Bearer arcop_aaaaaaaa_${OLD_SECRET}` });
  assert.equal(hb.status, 401);
  assert.match(hb.json.error, /revoked/);
  assert.equal(hb.json.code, "key_unknown_or_revoked");
  assert.equal((await call(`/machines/${OLD_MACHINE}`)).status, 404, "a machine never seen is removed");
  const fresh = await call("/pair/hive-7k2pqx9m"); // case and dash do not matter
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.hostnameHidden, true);
  assert.notEqual(fresh.json.hostname, "hote-secret");
  assert.equal(fresh.json.version, "");
  await new Promise((r) => setTimeout(r, 400)); // deferred write (200 ms)
  const disk = readFileSync(join(dataDir, "operators.json"), "utf8");
  assert.ok(!disk.includes(OLD_SECRET), "keyPlain must no longer be on disk");
  assert.ok(!disk.includes("vieux journal"), "logs are no longer written to disk");
  assert.ok(!disk.includes(DC_EXPIRED) && disk.includes(DC_FRESH));
});

test("8-character codes; the machine's name is not revealed before the signature", async () => {
  const r = await call("/pair/start", { body: { hostname: "ma-machine", mode: "dstack", version: "0.1.0" } });
  assert.equal(r.status, 200);
  assert.match(r.json.userCode, /^HIVE-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.ok(r.json.verifyUrl.endsWith(r.json.userCode));
  // the site's English route (an alias of the Operator page): no French word in the operator's terminal
  assert.equal(r.json.verifyUrl, `${SITE.uri}/#/operator?code=${r.json.userCode}`);
  const g = await call(`/pair/${r.json.userCode}`);
  assert.equal(g.status, 200);
  assert.ok(!JSON.stringify(g.json).includes("ma-machine"));
  assert.equal(g.json.mode, "dstack");
  assert.equal((await call("/pair/start", { body: { hostname: "x", mode: "root" } })).status, 400);
});

test("rate: 20 pending pairings per IP and 50 per network (/24, /48), 30 code lookups per minute per IP", async () => {
  const ip = "198.51.100.7";
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `m${i}` }, ip })).status, 200);
  const over = await call("/pair/start", { body: { hostname: "m20" }, ip });
  assert.equal(over.status, 429);
  assert.match(over.json.error, /already 20 pairings in progress from this address/);
  assert.deepEqual([over.json.code, over.json.params], ["pairings_per_ip", { max: 20, minutes: 15 }]);
  // only the LAST entry of X-Forwarded-For counts (the one Caddy sets): varying the first ones bypasses nothing
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `n${i}` }, ip: `9.9.9.${i}, 198.51.100.77` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "n20" }, ip: "8.8.8.8, 198.51.100.77" })).status, 429);
  // the same /24: 50 pending at most, all its addresses together
  for (let i = 0; i < 10; i++) assert.equal((await call("/pair/start", { body: { hostname: `p${i}` }, ip: `198.51.100.${100 + i}` })).status, 200);
  const net = await call("/pair/start", { body: { hostname: "p10" }, ip: "198.51.100.120" });
  assert.equal(net.status, 429);
  assert.match(net.json.error, /already 50 pairings in progress from this network/);
  assert.deepEqual([net.json.code, net.json.params?.max], ["pairings_per_network", 50]);
  // IPv6: the whole /64 shares one address's limit, the whole /48 a network's
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `v${i}` }, ip: `2001:db8:1:2::${(i + 1).toString(16)}` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "v20" }, ip: "2001:db8:1:2:ffff::9" })).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await call("/pair/start", { body: { hostname: `w${i}` }, ip: `2001:db8:1:${(i + 3).toString(16)}::1` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "w30" }, ip: "2001:db8:1:ff::1" })).status, 429, "le /48 a ses 50 appairages en cours");
  assert.equal((await call("/pair/start", { body: { hostname: "x" }, ip: "2001:db8:2::1" })).status, 200, "another /48 is not affected");
  // recherches de code : 30 par minute et par IP
  const ip2 = "198.51.100.8";
  for (let i = 0; i < 30; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: ip2 })).status, 404);
  const r = await call("/pair/HIVE-AAAA-AAAA", { ip: ip2 });
  assert.equal(r.status, 429);
  assert.match(r.json.error, /code lookups/);
  assert.equal(r.json.code, "rate_limited");
  assert.equal(r.json.params.scope, "code_lookups");
  assert.equal(r.json.params.retryAfter, Number(r.headers.get("retry-after")));
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: "198.51.100.9" })).status, 404, "another IP is not blocked");
});

test("wrong codes: capped per network (/24 in IPv4, /48 in IPv6), no global cap", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const s = await call("/pair/start", { body: { hostname: "salle-austin", mode: "demo" }, ip: "198.18.7.1" });
  const code = s.json.userCode as string;
  // 60 wrong codes from 60 addresses of one /24 (one lookup each: the per-IP rate plays no part)
  for (let i = 1; i <= 60; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: `192.0.2.${i}` })).status, 404);
  const blocked = await call(`/pair/${code}`, { ip: "192.0.2.200" });
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /too many wrong codes tried: try again in \d+ s/);
  assert.equal(blocked.json.code, "too_many_wrong_codes");
  // this network cannot approve either (refused before the signature)
  assert.equal((await call("/pair/approve", { body: { userCode: code, ...(await signIn(op, { kind: "pair", code })) }, ip: "192.0.2.201" })).status, 429);
  // another /24 is not affected (before: 300 wrong codes in total, 31 IPs in 78 ms, blocked ALL pairing)
  assert.equal((await call(`/pair/${code}`, { ip: "192.0.3.1" })).status, 200);
  assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: "192.0.3.2" })).status, 404);
  // IPv6: the whole /48 counts together, even from 60 different /64s
  for (let i = 1; i <= 60; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: `2001:db8:aa:${i.toString(16)}::1` })).status, 404);
  assert.equal((await call(`/pair/${code}`, { ip: "2001:db8:aa:ffff::1" })).status, 429);
  assert.equal((await call(`/pair/${code}`, { ip: "2001:db8:ab::1" })).status, 200, "another /48 is not affected");
  // approval from a healthy network passes
  const ok = await call("/pair/approve", { body: { userCode: code, ...(await signIn(op, { kind: "pair", code })) }, ip: "192.0.3.3" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

// ================================================================ EIP-4361 signed messages

test("sign-in: the site and the API write exactly the same statements, in English and in ASCII (EIP-4361 grammar)", () => {
  const MID = "11111111-1111-4111-8111-111111111111";
  const cases: Array<[SignedAction, string]> = [
    [{ kind: "pair", code: "HIVE-7K2P-QX9M" }, ops.STATEMENT.pair("HIVE-7K2P-QX9M")],
    [{ kind: "createKey" }, ops.STATEMENT.createKey()],
    [{ kind: "revokeKey", keyId: "1a2b3c4d" }, ops.STATEMENT.revokeKey("1a2b3c4d")],
    [{ kind: "removeMachine", machineId: MID }, ops.STATEMENT.removeMachine(MID)],
    [{ kind: "read" }, ops.STATEMENT.read()],
  ];
  for (const [action, statement] of cases) {
    assert.equal(statementOf(action), statement, action.kind);
    assert.match(statement, /^ArcHive: [A-Za-z0-9 :/?#[\]@!$&'()*+,;=._~-]+$/, action.kind);
    assert.ok(statement.startsWith(ops.STATEMENT_PREFIX), action.kind);
  }
  // what the signer will read in their wallet
  assert.equal(ops.STATEMENT.pair("HIVE-7K2P-QX9M"), "ArcHive: pair the machine showing code HIVE-7K2P-QX9M with my account");
  assert.equal(ops.STATEMENT.createKey(), "ArcHive: create an operator key (arcop_) that cannot spend funds");
  assert.equal(ops.STATEMENT.revokeKey("1a2b3c4d"), "ArcHive: revoke operator key arcop_1a2b3c4d");
  assert.equal(ops.STATEMENT.removeMachine(MID), `ArcHive: remove machine ${MID} from my account (its key is revoked)`);
  assert.equal(ops.STATEMENT.read(), "ArcHive: read my operator data for 10 minutes (diagnostics, logs, machine and key names)");
});

test("sign-in: nonce issued by the API, single use; replay of a signed message refused", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const n = await call("/auth/nonce");
  assert.equal(n.status, 200);
  assert.match(n.json.nonce, /^[0-9a-f]{60}$/, "issue time, randomness and the API's HMAC (alphanumeric: EIP-4361 grammar)");
  assert.deepEqual([n.json.domain, n.json.uri, n.json.chainId], [SITE.domain, SITE.uri, 5042002]);
  assert.equal(n.headers.get("cache-control"), "no-store");
  const body = { label: "cli", ...(await signIn(op, { kind: "createKey" }, { nonce: n.json })) };
  assert.match(body.message, /^archive\.test wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n\nArcHive: create an operator key \(arcop_\) that cannot spend funds\n\nURI: https:\/\/archive\.test\nVersion: 1\nChain ID: 5042002\nNonce: [0-9a-f]{60}\nIssued At: \S+\nExpiration Time: \S+$/);
  assert.ok(/^[\x20-\x7e\n]+$/.test(body.message), "message entier en ASCII imprimable");
  assert.equal((await call("/operator/keys", { body })).status, 200);
  const replay = await call("/operator/keys", { body });
  assert.equal(replay.status, 409, "replay refused");
  assert.match(replay.json.error, /already used/);
  assert.equal(replay.json.code, "signature_used");
  // two simultaneous sends of the same message: only one passes
  const twin = { label: "jumelle", ...(await signIn(op, { kind: "createKey" })) };
  const both = await Promise.all([call("/operator/keys", { body: twin }), call("/operator/keys", { body: twin })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  // a used nonce no longer works for another message, even signed by the right wallet
  const n2 = await nonce();
  const k = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n2 })) } });
  assert.equal(k.status, 200);
  const rv = await call(`/operator/keys/${k.json.keyId}/revoke`, { body: await signIn(op, { kind: "revokeKey", keyId: k.json.keyId }, { nonce: n2 }) });
  assert.equal(rv.status, 409);
  assert.equal((await call(`/operator/keys?address=${op.address}`)).json.filter((x: any) => !x.revoked).length, 3);
});

test("sign-in: nonce expired, unknown or dated before its issue; expiry too long or past: refused", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  // expired: a nonce serves 5 minutes. A read (valid 10 min) signed now and presented 6 minutes later.
  const late = await signIn(op, { kind: "read" });
  const realNow = Date.now;
  let r: Awaited<ReturnType<typeof call>>;
  try {
    Date.now = () => realNow() + 6 * 60_000;
    r = await call("/operator/keys/list", { body: late });
  } finally { Date.now = realNow; }
  assert.equal(r.status, 401);
  assert.match(r.json.error, /nonce expired|unknown or expired nonce/);
  assert.match(r.json.code, /^nonce_(expired|unknown)$/);
  // a nonce the API never issued
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: "f".repeat(32), issuedAt: new Date().toISOString() } })) } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /unknown or expired nonce/);
  assert.equal(r.json.code, "nonce_unknown");
  // "Issued At" backdated by 3 minutes relative to the nonce's issue time
  const n = await nonce();
  const back = new Date(Date.parse(n.issuedAt) - 3 * 60_000).toISOString();
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: n.nonce, issuedAt: back } })) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Issued At/);
  assert.equal(r.json.code, "issued_at_mismatch");
  // an action valid 30 minutes instead of 5
  const setExpiry = (iso: string) => (m: string) => m.replace(/^Expiration Time: .*$/m, `Expiration Time: ${iso}`);
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n, edit: setExpiry(new Date(Date.parse(n.issuedAt) + 30 * 60_000).toISOString()) })) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Expiration Time/);
  assert.deepEqual([r.json.code, r.json.params], ["malformed_message", { part: "expiry_window", minutes: 5 }]);
  // already expired
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n, edit: setExpiry(new Date(Date.now() - 1000).toISOString()) })) } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /expired/);
  assert.equal(r.json.code, "signature_expired");
  // the refusals did not consume the nonce: used properly, it passes once
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n })) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test("sign-in: message for another site, another URI, another network; old format; extra line: refused", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const post = (s: { address: string; message: string; signature: string }) => call("/operator/keys", { body: { label: "x", ...s } });
  // a foreign domain (a phisher's site): the wallet flags it, the API refuses it
  let r = await post(await signIn(op, { kind: "createKey" }, { domain: "archive-airdrop.example", uri: "https://archive-airdrop.example" }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /another site.*archive-airdrop\.example/);
  assert.deepEqual([r.json.code, r.json.params], ["wrong_site", { site: "archive-airdrop.example", expected: "archive.test" }]);
  r = await post(await signIn(op, { kind: "createKey" }, { uri: "https://archive-airdrop.example" }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /URI: https:\/\/archive\.test/);
  assert.deepEqual([r.json.code, r.json.params], ["malformed_message", { part: "uri", uri: "https://archive.test" }]);
  r = await post(await signIn(op, { kind: "createKey" }, { uri: "http://archive.test" }));
  assert.equal(r.status, 400, "the same domain over http: refused");
  r = await post(await signIn(op, { kind: "createKey" }, { chainId: 1 }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /another network/);
  assert.deepEqual([r.json.code, r.json.params], ["wrong_chain", { chainId: 5042002 }]);
  // the old "ArcHive — …" format (no domain, no nonce)
  const old = ["ArcHive — Créer une clé opérateur", `Adresse : ${op.address}`, `Horodatage : ${Date.now()}`].join("\n");
  r = await post({ address: op.address, message: old, signature: await op.signMessage({ message: old }) });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /EIP-4361/);
  assert.deepEqual([r.json.code, r.json.params?.part], ["malformed_message", "format"]);
  // one more line (resources, request id…), the address without its EIP-55 case, the statement of another action
  r = await post(await signIn(op, { kind: "createKey" }, { edit: (m) => `${m}\nResources:\n- https://archive-airdrop.example` }));
  assert.equal(r.status, 400);
  r = await post(await signIn(op, { kind: "createKey" }, { edit: (m) => m.replace(op.address, op.address.toLowerCase()) }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /address/);
  assert.equal(r.json.code, "address_mismatch");
  r = await post(await signIn(op, { kind: "read" }));
  assert.equal(r.status, 400, "a read signature creates no key");
  assert.match(r.json.error, /statement/);
  assert.equal((await call(`/operator/keys?address=${op.address}`)).json.length, 0, "no key created");
  assert.equal(r.json.code, "wrong_statement");
  assert.equal(r.json.params.statement, ops.STATEMENT.createKey());
});

test("smart wallet (ERC-1271): signature accepted through the RPC; EOA: verified locally", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const s = await signIn(owner, { kind: "createKey" }, { address: SMART });
  assert.ok(s.message.split("\n")[1] === getAddress(SMART));
  const r = await call("/operator/keys", { body: { label: "coffre", ...s } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await call(`/operator/keys?address=${SMART}`)).json.length, 1);
  // the same signature presented for an EOA (no code): refused
  const eoa = privateKeyToAccount(generatePrivateKey());
  const forged = await signIn(owner, { kind: "createKey" }, { address: eoa.address });
  const f = await call("/operator/keys", { body: { label: "x", ...forged } });
  assert.equal(f.status, 401);
  assert.match(f.json.error, /invalid signature/);
  assert.equal(f.json.code, "bad_signature");
});

// ================================================================ saturation, a room behind one Wi-Fi

/** `n` requests, `width` at a time */
async function inBatches<T>(n: number, width: number, f: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i += width) out.push(...(await Promise.all(Array.from({ length: Math.min(width, n - i) }, (_, j) => f(i + j)))));
  return out;
}

test("table-free nonces: 21,000 requests fill nothing; forged, edited or upper-case nonce: refused", async () => {
  // before: 20,000 slots, full in 1 s (670 IPs × 30), then 503 for everyone for 5 minutes
  // (50 at a time: a macOS terminal often opens only 256 files, sockets included)
  const statuses = await inBatches(21_000, 50, (i) => call("/auth/nonce", { ip: `2001:db8:5:${(i % 100).toString(16)}::1` }).then((r) => r.status));
  assert.equal(statuses.filter((s) => s === 200).length, 21_000);
  // the next visitor signs normally
  const op = privateKeyToAccount(generatePrivateKey());
  const n = await nonce();
  // the same nonce, retouched: last character of the HMAC, issue time, upper case; or 60 random characters
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "0" ? "1" : "0") + s.slice(i + 1);
  for (const [what, bad] of [["HMAC", flip(n.nonce, 59)], ["time", flip(n.nonce, 11)], ["randomness", flip(n.nonce, 20)], ["upper case", n.nonce.toUpperCase()], ["random", randomBytes(30).toString("hex")]] as const) {
    const r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: bad, issuedAt: n.issuedAt } })) } });
    assert.equal(r.status, 401, what);
    assert.match(r.json.error, /unknown or expired nonce/, what);
  }
  // the real one, intact: it passes once (the refusals did not consume it), then never again
  const body = { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n })) };
  assert.equal((await call("/operator/keys", { body })).status, 200);
  assert.equal((await call("/operator/keys", { body })).status, 409);
  // consumed, it stays refused until its expiry (4 min later: 409), then the expiry refuses it by itself
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4 * 60_000;
    assert.equal((await call("/operator/keys", { body })).status, 409);
    Date.now = () => realNow() + 6 * 60_000;
    assert.equal((await call("/operator/keys", { body })).status, 401);
  } finally { Date.now = realNow; }
});

test("demo behind one Wi-Fi: 10 operators on ONE address, at the site's pace, with no refusal; the per-IP caps remain", async () => {
  const ROOM = "198.51.100.200";
  const room = Array.from({ length: 10 }, () => privateKeyToAccount(generatePrivateKey()));
  const statuses: number[] = [];
  const mine: Array<{ read: Awaited<ReturnType<typeof signIn>>; machineId: string }> = [];
  for (const op of room) {
    // a key (signature), a machine that beats, an opened read (signature)
    const k = await call("/operator/keys", { body: { label: "portable", ...(await signFrom(ROOM, op, { kind: "createKey" })) }, ip: ROOM });
    statuses.push(k.status);
    const hb = await call("/machines/heartbeat", { body: { hostname: "portable", status: "running" }, auth: `Bearer ${k.json.key}`, ip: ROOM });
    statuses.push(hb.status);
    mine.push({ read: await signFrom(ROOM, op, { kind: "read" }), machineId: hb.json.machineId });
  }
  // one minute of site for each: the list every 10 s, the detail every 15 s, the keys twice
  // (120 signed reads from a single address; before: 60 per minute and per IP, and 10 refusals out of 42 with 7 operators)
  for (let tick = 0; tick < 6; tick++) {
    for (const { read, machineId } of mine) {
      statuses.push((await call("/machines/list", { body: read, ip: ROOM })).status);
      if (tick < 4) statuses.push((await call(`/machines/${machineId}/detail`, { body: read, ip: ROOM })).status);
      if (tick < 2) statuses.push((await call("/operator/keys/list", { body: read, ip: ROOM })).status);
    }
  }
  assert.equal(statuses.length, 10 * 2 + 120);
  assert.deepEqual([...new Set(statuses)], [200]);
  // a single address stays bounded: 240 nonces per minute, then 429
  const flood = await inBatches(241, 50, () => call("/auth/nonce", { ip: "198.51.100.250" }).then((r) => r.status));
  assert.equal(flood.filter((s) => s === 200).length, 240);
  const last = await call("/auth/nonce", { ip: "198.51.100.250" });
  assert.equal(last.status, 429);
  assert.match(last.json.error, /too many requests \(nonce requests\)/);
  assert.deepEqual([last.json.code, last.json.params.scope], ["rate_limited", "nonce_requests"]);
});

test("cost of a signature: invalid, counted per IP (30 per minute); valid, per account (30 actions, 10 open reads)", async () => {
  const victim = privateKeyToAccount(generatePrivateKey());
  const forger = privateKeyToAccount(generatePrivateKey());
  const IP = "198.51.100.210";
  // 30 invalid signatures in the victim's name: 401, then the IP gets no more verification for the minute
  for (let i = 0; i < 30; i++) {
    const r = await call("/operator/keys", { body: { label: "x", ...(await signIn(forger, { kind: "createKey" }, { address: victim.address })) }, ip: IP });
    assert.equal(r.status, 401);
  }
  const cut = await call("/operator/keys", { body: { label: "x", ...(await signIn(victim, { kind: "createKey" })) }, ip: IP });
  assert.equal(cut.status, 429, "even a valid signature, from this IP, waits for the next minute");
  assert.match(cut.json.error, /invalid signatures/);
  assert.deepEqual([cut.json.code, cut.json.params.scope], ["rate_limited", "invalid_signatures"]);
  // the targeted account lost nothing: its 30 actions of the minute (valid signatures, from other addresses) pass
  for (let i = 0; i < 30; i++) {
    const keyId = randomBytes(4).toString("hex");
    const r = await call(`/operator/keys/${keyId}/revoke`, { body: await signIn(victim, { kind: "revokeKey", keyId }) });
    assert.equal(r.status, 404, JSON.stringify(r.json)); // valid signature, unknown key
  }
  const keyId = randomBytes(4).toString("hex");
  const body = await signIn(victim, { kind: "revokeKey", keyId });
  const capped = await call(`/operator/keys/${keyId}/revoke`, { body });
  assert.equal(capped.status, 429);
  assert.match(capped.json.error, /signatures for this account/);
  assert.deepEqual([capped.json.code, capped.json.params.scope], ["rate_limited", "account_signatures"]);
  // another account, at the same moment, from the same address: nothing blocks it
  const other = privateKeyToAccount(generatePrivateKey());
  assert.equal((await call("/operator/keys", { body: { label: "x", ...(await signIn(other, { kind: "createKey" })) } })).status, 200);
  // the refusal for rate did not burn the signature: the next minute, it serves (and its key stays unknown: 404)
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 61_000;
    assert.equal((await call(`/operator/keys/${keyId}/revoke`, { body })).status, 404);
  } finally { Date.now = realNow; }

  // reads: 10 OPENED reads per minute and per account; a reused opened read always passes
  const reader = privateKeyToAccount(generatePrivateKey());
  const reads: Array<Awaited<ReturnType<typeof signIn>>> = [];
  for (let i = 0; i < 10; i++) {
    const read = await signIn(reader, { kind: "read" });
    assert.equal((await call("/machines/list", { body: read })).status, 200);
    reads.push(read);
  }
  const eleventh = await call("/machines/list", { body: await signIn(reader, { kind: "read" }) });
  assert.equal(eleventh.status, 429);
  assert.match(eleventh.json.error, /new signed reads for this account/);
  assert.deepEqual([eleventh.json.code, eleventh.json.params.scope], ["rate_limited", "account_new_reads"]);
  assert.equal((await call("/machines/list", { body: reads[0] })).status, 200);
});

test("a reused read does not redo the verification (smart wallet: no RPC call); another signature does", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const read = await signIn(owner, { kind: "read" }, { address: SMART });
  const c0 = smartChecks;
  assert.equal((await call("/machines/list", { body: read })).status, 200);
  const c1 = smartChecks;
  assert.ok(c1 > c0, "first opening: verified through the RPC (ERC-1271)");
  for (let i = 0; i < 5; i++) assert.equal((await call("/operator/keys/list", { body: read })).status, 200);
  assert.equal(smartChecks, c1, "the same signature, reused: no new verification");
  // the same message with ANOTHER signature (which the simulated RPC accepts for this wallet): verified again
  const other = { ...read, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: read.message }) };
  assert.equal((await call("/machines/list", { body: other })).status, 200);
  assert.ok(smartChecks > c1);
});

test("rate table: when full, it moves to a fixed shared table, without refusing a new key outright", () => {
  const l = new ops.Limiter(50, 60_000, 100);
  const t0 = 1_000_000;
  for (let i = 0; i < 100; i++) assert.equal(l.take(`ip-${i}`, t0), true);
  // the exact table is full for the minute: 20,000 new addresses still pass (before: all refused)
  let refused = 0;
  for (let i = 100; i < 20_100; i++) if (!l.take(`ip-${i}`, t0)) refused++;
  assert.equal(refused, 0);
  // one new address that floods stays bounded (in its shared slot)
  const flood = Array.from({ length: 60 }, () => l.take("inondation", t0 + 1));
  assert.equal(flood[0], true);
  assert.equal(flood.at(-1), false);
  assert.ok(l.count("inondation", t0 + 1) >= 50);
  assert.ok(l.retryAfter("inondation", t0 + 1) <= 60);
  // the keys of the exact table keep their exact count: 50 passes in the minute, not one more
  for (let i = 0; i < 49; i++) assert.equal(l.take("ip-0", t0 + 2), true);
  assert.equal(l.take("ip-0", t0 + 3), false, "51st pass of the minute: refused");
  // the next minute, everything starts again, and the exact table has room again
  assert.equal(l.take("inondation", t0 + 60_001), true);
  assert.equal(l.take("ip-0", t0 + 60_002), true);
});

// ================================================================ approval and refusal on the machine

const opA = privateKeyToAccount(generatePrivateKey());
const opB = privateKeyToAccount(generatePrivateKey());
let machineA = "", machineKeyA = "";

test("approval: EIP-4361 message checked line by line, single-use nonce; the key is handed over only once", async () => {
  const s = await call("/pair/start", { body: { hostname: "tdx-paris-1", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  // the signature of ANOTHER code does not approve this one
  const other = await call("/pair/approve", { body: { userCode: code, ...(await signIn(opA, { kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) } });
  assert.equal(other.status, 400);
  assert.match(other.json.error, /statement/);
  // signed by another wallet than the announced address
  const forged = await call("/pair/approve", { body: { userCode: code, ...(await signIn(opB, { kind: "pair", code }, { address: opA.address })) } });
  assert.equal(forged.status, 401);
  // the right one (code typed in lower case: normalized before the check)
  const body = { userCode: code.toLowerCase(), ...(await signIn(opA, { kind: "pair", code })) };
  const ok = await call("/pair/approve", { body });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.hostname, "tdx-paris-1", "the name is given to the one who signed");
  machineA = ok.json.machineId;
  assert.equal((await call("/pair/approve", { body })).status, 409, "replay of the same signature refused");
  const p1 = await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } });
  assert.equal(p1.json.status, "approved");
  assert.equal(p1.json.operator, opA.address.toLowerCase(), "the machine learns the full address that approved it");
  assert.match(p1.json.key, /^arcop_[0-9a-f]{8}_/);
  machineKeyA = p1.json.key;
  assert.equal((await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.status, "consumed");
});

test("refusal on the machine (\"n\"): /pair/reject revokes its key and removes it from the account that approved it", async () => {
  const intruder = privateKeyToAccount(generatePrivateKey());
  const s = await call("/pair/start", { body: { hostname: "victime-1", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  assert.equal((await call("/pair/approve", { body: { userCode: code, ...(await signIn(intruder, { kind: "pair", code })) } })).status, 200);
  const p = await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } });
  assert.equal(p.json.operator, intruder.address.toLowerCase());
  assert.equal((await call(`/machines?operator=${intruder.address}`)).json.length, 1);
  assert.equal((await call("/pair/reject", { method: "POST", auth: `Bearer ${p.json.key}` })).status, 200);
  assert.equal((await call(`/machines?operator=${intruder.address}`)).json.length, 0, "la machine quitte le compte de l'intrus");
  const hb = await call("/machines/heartbeat", { body: { hostname: "victime-1", status: "running" }, auth: `Bearer ${p.json.key}` });
  assert.equal(hb.status, 401, "the refused key no longer works");
  // a free key (no machine) cannot "refuse a pairing"; without a key: 401
  const free = await call("/operator/keys", { body: { label: "cli", ...(await signIn(intruder, { kind: "createKey" })) } });
  assert.equal((await call("/pair/reject", { method: "POST", auth: `Bearer ${free.json.key}` })).status, 400);
  assert.equal((await call("/pair/reject", { method: "POST" })).status, 401);
});

test("approval: code already approved by ANOTHER account → 409 pair_already_approved; by this account → 409 pair_already_yours; unknown or expired → 404", async () => {
  const first = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const s = await call("/pair/start", { body: { hostname: "salle-austin-2", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  const ok = await call("/pair/approve", { body: { userCode: code, ...(await signIn(first, { kind: "pair", code })) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // another account, with a valid signature for THIS code: 409 (before: 404, like an unknown code)
  const other = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
  assert.deepEqual([other.status, other.json.code], [409, "pair_already_approved"]);
  assert.ok(!JSON.stringify(other.json).includes("salle-austin-2"), "the machine's name stays reserved to the one who approved");
  // the same account (another tab, a double send): 409, without mentioning another account
  const mine = await call("/pair/approve", { body: { userCode: code.toLowerCase(), ...(await signIn(first, { kind: "pair", code })) } });
  assert.deepEqual([mine.status, mine.json.code], [409, "pair_already_yours"]);
  // once the key is handed to the machine, it is always 409 for the other account
  assert.equal((await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.status, "approved");
  const after = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
  assert.deepEqual([after.status, after.json.code], [409, "pair_already_approved"]);
  // a code never issued: 404 code_unknown (counted as a wrong code)
  const unknown = await call("/pair/approve", { body: { userCode: "HIVE-ZZZZ-ZZZZ", ...(await signIn(second, { kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) } });
  assert.deepEqual([unknown.status, unknown.json.code], [404, "code_unknown"]);
  // the same code, expired (15 minutes later): 404 too
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60_000;
    const late = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
    assert.deepEqual([late.status, late.json.code], [404, "code_unknown"]);
  } finally { Date.now = realNow; }
});

// ================================================================ n° 3 : battements, validation, bornes

test("heartbeat: fields strictly validated, bounded body", async () => {
  const auth = `Bearer ${machineKeyA}`;
  const good = {
    hostname: "tdx-paris-1", mode: "dstack", version: "0.1.0", productId: 6, status: "running",
    enclaveUrl: "http://203.0.113.50:8802", signer: "0x" + "ab".repeat(20), x25519: "0x" + "cd".repeat(32),
    doctor: { ok: false, checks: [{ id: "port", label: "Port", ok: false, detail: "closed on 203.0.113.50" }, { id: "docker", label: "Docker", ok: true, detail: "" }] },
    logs: ["\x1b[31mERROR\x1b[0m connection refused", "line 2"],
  };
  const r = await call("/machines/heartbeat", { body: good, auth });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const [field, bad, code] of [
    ["signer", "0x1234", "invalid_hex"], ["x25519", { a: 1 }, "invalid_hex"], ["productId", "12345678901", "invalid_product_id"],
    ["mode", "evil", "invalid_enum"], ["status", "pwned", "invalid_enum"], ["enclaveUrl", "javascript:alert(1)", "enclave_url_scheme"],
    ["enclaveUrl", "http://[::1", "unreadable_enclave_url"], ["enclaveUrl", "https://" + "a".repeat(200), "invalid_enclave_url"],
    ["logs", "not an array", "invalid_logs"], ["doctor", { checks: "no" }, "invalid_doctor"],
  ] as const) {
    const x = await call("/machines/heartbeat", { body: { ...good, [field]: bad }, auth });
    assert.equal(x.status, 400, `an invalid ${field} must be refused`);
    assert.equal(x.json.code, code, `${field} : ${JSON.stringify(x.json)}`);
  }
  const badMode = await call("/machines/heartbeat", { body: { ...good, mode: "evil" }, auth });
  assert.deepEqual(badMode.json.params, { field: "mode", allowed: "tdx, dstack, demo" });
  const badSigner = await call("/machines/heartbeat", { body: { ...good, signer: "0x12" }, auth });
  assert.deepEqual(badSigner.json.params, { field: "signer", length: 40 });
  const big = await call("/machines/heartbeat", { raw: JSON.stringify({ ...good, logs: ["x".repeat(100 * 1024)] }), auth });
  assert.equal(big.status, 413);
  assert.deepEqual([big.json.code, big.json.params], ["body_too_large", { maxKiB: 64 }]);
  // without Content-Length (chunked send): reading stops at 64 KiB, nothing is saved
  const payload = new TextEncoder().encode(JSON.stringify({ ...good, hostname: "gros-corps", logs: ["y".repeat(200 * 1024)] }));
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < payload.length; i += 8192) c.enqueue(payload.slice(i, i + 8192)); c.close(); } });
  const chunked = await fetch(base + "/machines/heartbeat", { method: "POST", headers: { "content-type": "application/json", authorization: auth, "x-forwarded-for": freshIp() }, body: stream, duplex: "half" } as any);
  assert.ok([400, 413].includes(chunked.status), `corps par morceaux trop gros : ${chunked.status}`);
  const after = await call(`/machines/${machineA}`, { auth });
  assert.equal(after.json.hostname, "tdx-paris-1", "the truncated body changed nothing");
});

test("reads: the list requires ?operator, a reduced public view; logs and diagnostics reserved to the operator", async () => {
  assert.equal((await call("/machines")).status, 400);
  const pubList = await call(`/machines?operator=${opA.address}`);
  assert.equal(pubList.status, 200);
  const m = pubList.json.find((x: any) => x.machineId === machineA);
  assert.ok(m);
  assert.equal(m.hostnameHidden, true);
  assert.notEqual(m.hostname, "tdx-paris-1");
  assert.equal(m.enclaveUrl, null, "an http://IP address is not public");
  assert.deepEqual(m.failing, ["port"]);
  assert.equal(m.logs, undefined);
  assert.equal(m.doctor, undefined);

  const anon = await call(`/machines/${machineA}`);
  assert.equal(anon.json.logs, undefined);
  assert.equal(anon.json.doctor, undefined);
  assert.ok(!JSON.stringify(anon.json).includes("203.0.113.50"));

  const own = await call(`/machines/${machineA}`, { auth: `Bearer ${machineKeyA}` });
  assert.equal(own.status, 200);
  assert.equal(own.json.hostname, "tdx-paris-1");
  assert.deepEqual(own.json.logs, ["ERROR connection refused", "line 2"], "ANSI sequences removed");
  assert.equal(own.json.doctor.checks.length, 2);

  // a free key of ANOTHER operator: 403
  const kB = await call("/operator/keys", { body: { label: "cli", ...(await signIn(opB, { kind: "createKey" })) } });
  assert.equal(kB.status, 200);
  assert.equal((await call(`/machines/${machineA}`, { auth: `Bearer ${kB.json.key}` })).status, 403);

  // read signature (EIP-4361): its nonce serves at first use, then it opens everything for its 10 minutes
  const read = await signIn(opA, { kind: "read" });
  assert.match(read.message, /^Expiration Time: /m);
  const d1 = await call(`/machines/${machineA}/detail`, { body: read });
  assert.equal(d1.status, 200, JSON.stringify(d1.json));
  assert.equal(d1.json.logs.length, 2);
  assert.equal(d1.json.doctor.checks.length, 2);
  assert.equal((await call(`/machines/${machineA}/detail`, { body: read })).status, 200);
  const list = await call("/machines/list", { body: read });
  assert.equal(list.status, 200);
  const full = list.json.find((x: any) => x.machineId === machineA);
  assert.equal(full.hostname, "tdx-paris-1");
  assert.equal(full.enclaveUrl, "http://203.0.113.50:8802");
  assert.equal(full.logs, undefined, "the list carries no logs");
  // another operator's read does not see this machine; a read allows no action
  assert.equal((await call(`/machines/${machineA}/detail`, { body: await signIn(opB, { kind: "read" }) })).status, 404);
  assert.equal((await call(`/machines/${machineA}/remove`, { body: read })).status, 400);
});

test("explicit origin: pairedBy \"code\" or \"key\", the address that approved, the free key that took over the machine", async () => {
  const opE = privateKeyToAccount(generatePrivateKey());
  const op = opE.address.toLowerCase();
  const s = await call("/pair/start", { body: { hostname: "tdx-austin-1", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  assert.equal((await call("/pair/approve", { body: { userCode: code, ...(await signIn(opE, { kind: "pair", code })) } })).status, 200);
  const machineKey = (await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.key as string;
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running" }, auth: `Bearer ${machineKey}` })).status, 200);
  let pub = (await call(`/machines?operator=${opE.address}`)).json;
  assert.equal(pub.length, 1);
  assert.deepEqual([pub[0].pairedBy, pub[0].approvedBy, pub[0].viaKey], ["code", op, null], "public view: the provenance, without the name");
  assert.ok(typeof pub[0].pairedAt === "number");
  // a FREE key adds another machine: "key", with its key
  const free = (await call("/operator/keys", { body: { label: "cli", ...(await signIn(opE, { kind: "createKey" })) } })).json;
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "portable", status: "running" }, auth: `Bearer ${free.key}` })).status, 200);
  const view = async () => {
    const list = (await call(`/machines?operator=${opE.address}`, { auth: `Bearer ${free.key}` })).json as any[];
    return Object.fromEntries(list.map((m) => [m.hostname, [m.pairedBy, m.approvedBy, m.viaKey]]));
  };
  assert.deepEqual(await view(), { "tdx-austin-1": ["code", op, null], portable: ["key", op, free.keyId] });
  // the free key takes over the paired machine (same name): what it announces was confirmed on no machine → "key"
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running", enclaveUrl: "https://ailleurs.example" }, auth: `Bearer ${free.key}` })).status, 200);
  assert.deepEqual((await view())["tdx-austin-1"], ["key", op, free.keyId]);
  // and it stays so, even if the machine's key beats again (caution: the free key can come back)
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running" }, auth: `Bearer ${machineKey}` })).status, 200);
  assert.deepEqual((await view())["tdx-austin-1"], ["key", op, free.keyId]);
  // the signed list carries the same fields
  const signed = (await call("/machines/list", { body: await signIn(opE, { kind: "read" }) })).json as any[];
  assert.deepEqual(signed.map((m) => m.pairedBy).sort(), ["key", "key"]);
});

test("keys: 10 free active keys per operator, labels hidden without authentication", async () => {
  const opC = privateKeyToAccount(generatePrivateKey());
  let last = "";
  for (let i = 0; i < 10; i++) {
    const r = await call("/operator/keys", { body: { label: `operator laptop ${i}`, ...(await signIn(opC, { kind: "createKey" })) } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    last = r.json.key;
  }
  const over = await call("/operator/keys", { body: { label: "one too many", ...(await signIn(opC, { kind: "createKey" })) } });
  assert.equal(over.status, 409);
  assert.match(over.json.error, /limit of 10 active keys/);
  assert.deepEqual([over.json.code, over.json.params], ["key_limit", { max: 10 }]);
  const anon = await call(`/operator/keys?address=${opC.address}`);
  assert.equal(anon.json.length, 10);
  assert.ok(anon.json.every((k: any) => !String(k.label).includes("laptop") && !("hash" in k) && k.restricted === true));
  const full = await call(`/operator/keys?address=${opC.address}`, { auth: `Bearer ${last}` });
  assert.ok(full.json.some((k: any) => String(k.label).includes("operator laptop")));
  const listed = await call("/operator/keys/list", { body: await signIn(opC, { kind: "read" }) });
  assert.equal(listed.json.length, 10);
  assert.ok(listed.json.every((k: any) => k.restricted === false && String(k.label).startsWith("operator laptop")));
  // revoking a key only affects that key; it frees one slot
  const [kid, kid2] = [anon.json[0].keyId, anon.json[1].keyId];
  assert.equal((await call(`/operator/keys/${kid2}/revoke`, { body: await signIn(opC, { kind: "revokeKey", keyId: kid }) })).status, 400);
  assert.equal((await call(`/operator/keys/${kid}/revoke`, { body: await signIn(opC, { kind: "revokeKey", keyId: kid }) })).status, 200);
  assert.equal((await call("/operator/keys", { body: { label: "replacement", ...(await signIn(opC, { kind: "createKey" })) } })).status, 200);
});

test("machines: 20 per operator; heartbeats rate-limited per key; a signed removal for THIS machine", async () => {
  const opD = privateKeyToAccount(generatePrivateKey());
  const k = (await call("/operator/keys", { body: { label: "cli", ...(await signIn(opD, { kind: "createKey" })) } })).json.key;
  for (let i = 0; i < 20; i++) {
    const r = await call("/machines/heartbeat", { body: { hostname: `hote-${i}`, status: "running" }, auth: `Bearer ${k}` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "hote-20", status: "running" }, auth: `Bearer ${k}` })).status, 409);
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await call("/machines/heartbeat", { body: { hostname: "hote-0", status: "running" }, auth: `Bearer ${k}` })).status);
  assert.ok(codes.includes(429), "above 30 heartbeats per minute and per key: 429");
  const [m1, m2] = (await call(`/machines?operator=${opD.address}`)).json.map((x: any) => x.machineId);
  assert.equal((await call(`/machines/${m2}/remove`, { body: await signIn(opD, { kind: "removeMachine", machineId: m1 }) })).status, 400, "the signature names ONE machine");
  assert.equal((await call(`/machines/${m1}/remove`, { body: await signIn(opD, { kind: "removeMachine", machineId: m1 }) })).status, 200);
  assert.equal((await call(`/machines?operator=${opD.address}`)).json.length, 19);
});

test("errors: refused keys, machines and parameters each carry their code", async () => {
  const opF = privateKeyToAccount(generatePrivateKey());
  const k = (await call("/operator/keys", { body: { label: "cli", ...(await signIn(opF, { kind: "createKey" })) } })).json.key as string;
  const expect = async (r: Promise<{ status: number; json: any }>, status: number, code: string) => {
    const x = await r;
    assert.deepEqual([x.status, x.json?.code], [status, code], JSON.stringify(x.json));
  };
  await expect(call("/pair/reject", { method: "POST" }), 401, "key_missing");
  await expect(call("/pair/reject", { method: "POST", auth: `Bearer ${k}` }), 400, "not_a_machine_key");
  await expect(call("/pair/reject", { method: "POST", auth: `Bearer ${k.slice(0, -4)}ZZZZ` }), 401, "key_invalid");
  await expect(call("/pair/poll", { body: { deviceCode: "f".repeat(32) } }), 404, "device_code_unknown");
  await expect(call("/pair/approve", { body: {} }), 400, "user_code_expected");
  await expect(call("/pair/approve", { body: { userCode: "HIVE-7K2P-QX9M" } }), 400, "signed_body_expected");
  await expect(call("/pair/approve", { body: { userCode: "HIVE-7K2P-QX9M", address: "0x12", message: "x", signature: "0x" } }), 400, "invalid_address");
  await expect(call("/pair/approve", { body: { userCode: "HIVE-7K2P-QX9M", address: opF.address, message: "x", signature: "0x12" } }), 400, "bad_message_or_signature");
  await expect(call("/machines"), 400, "operator_param_expected");
  await expect(call("/operator/keys?address=0x12"), 400, "address_param_expected");
  await expect(call("/machines/11111111-1111-4111-8111-111111111112"), 404, "machine_unknown");
  await expect(call(`/machines/${machineA}`, { auth: `Bearer ${k}` }), 403, "key_forbidden");
  await expect(call(`/machines/${machineA}/detail`, { body: await signIn(opF, { kind: "read" }) }), 404, "machine_not_found");
  await expect(call("/operator/keys/zz/revoke", { body: await signIn(opF, { kind: "revokeKey", keyId: "zz" }) }), 404, "key_not_found");
  // a signature that does not fit in 11 lines, an unreadable date: "malformed_message" and the faulty part
  const bad = await signIn(opF, { kind: "createKey" }, { edit: (m) => m.replace(/^Issued At: .*$/m, "Issued At: hier") });
  const r = await call("/operator/keys", { body: { label: "x", ...bad } });
  assert.deepEqual([r.json.code, r.json.params], ["malformed_message", { part: "time", line: "Issued At" }]);
});

// ================================================================ n° 2 : wallet de test

const AUTH_ABI = "(uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)";
const tx = parseAbi([
  `function openSession((uint256 productId, address operator, address sessionKey, uint64 expiresAt, uint256 deposit, uint256 cap, ${AUTH_ABI} auth, address enclave) q)`,
  `function topUp(uint256 sessionId, uint256 amount, ${AUTH_ABI} auth)`,
  "function settle((uint256,uint256,uint64,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint128,uint64) r, bytes signature)",
  `function fund(uint256 bountyId, uint256 amount, ${AUTH_ABI} auth)`,
  "function withdrawRemaining(uint256 bountyId)",
  "function claim((uint256 bountyId, address payee, uint64 blockN, bytes32 blockHashN, bytes32 predicateHash, uint256 loss, uint8 tier, bytes32 fingerprint, bytes32 cPHash, uint64 deadline) r, bytes[] signatures, bytes cP)",
  `function bond(uint256 amount, ${AUTH_ABI} auth)`,
  "function bondFrom(uint256 amount)",
  "function transfer(address to, uint256 value)",
  "function approve(address spender, uint256 value)",
]);
const anAuth = { validAfter: 0n, validBefore: 9_999_999_999n, nonce: ("0x" + "01".repeat(32)) as Hex, signature: ("0x" + "02".repeat(65)) as Hex };
const openData = (deposit: bigint) => encodeFunctionData({ abi: tx, functionName: "openSession", args: [{ productId: 6n, operator: DEAD as Address, sessionKey: DEAD as Address, expiresAt: 9_999_999_999n, deposit, cap: 0n, auth: anAuth, enclave: DEAD as Address }] });
const send = (to: string, data: Hex, extra: Record<string, unknown> = {}) => rpcCall("eth_sendTransaction", [{ from: testWallet.address, to, data, gas: "0x989680", ...extra }]);
function rwa(over: { to?: string; value?: string; from?: string; validBefore?: string; chainId?: number; primaryType?: string; valueType?: string } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return {
    domain: { name: "USDC", version: "2", chainId: over.chainId ?? arcTestnet.id, verifyingContract: testnet.usdc },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: over.valueType ?? "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: over.primaryType ?? "ReceiveWithAuthorization",
    message: { from: over.from ?? testWallet.address, to: over.to ?? testnet.sessionPay, value: over.value ?? "1000000", validAfter: "0", validBefore: over.validBefore ?? String(nowS + 3600), nonce: "0x" + randomBytes(32).toString("hex") },
  };
}
const signRwa = (o?: Parameters<typeof rwa>[0]) => rpcCall("eth_signTypedData_v4", [testWallet.address, JSON.stringify(rwa(o))]);

test("test mode: token required; personal_sign limited to ArcHive sign-ins (EIP-4361) for this wallet, valid nonce", async () => {
  assert.equal((await rpcCall("eth_accounts", [], "")).status, 401);
  assert.equal((await rpcCall("eth_accounts", [], "Bearer " + "x".repeat(48))).status, 401);
  const info = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  assert.equal(info.json.address, testWallet.address);
  assert.equal(info.json.budget.dailyUsdc, "10");
  assert.equal((await call("/test-signer/info")).json.address, undefined);
  // the site's message, in hex as wagmi sends it; signed, then accepted by the API end to end
  const okMsg = await siwe({ kind: "createKey" }, testWallet.address);
  const sig = await rpcCall("personal_sign", [toHex(okMsg), testWallet.address]);
  assert.ok(sig.json.result, JSON.stringify(sig.json));
  assert.equal(await recoverMessageAddress({ message: okMsg, signature: sig.json.result }), testWallet.address);
  const k = await call("/operator/keys", { body: { label: "mode test", address: testWallet.address, message: okMsg, signature: sig.json.result } });
  assert.equal(k.status, 200, JSON.stringify(k.json));
  const refused: Array<[string, string]> = [
    ["nonce already used", okMsg],
    ["old format", ["ArcHive — Créer une clé opérateur", `Adresse : ${testWallet.address}`, `Horodatage : ${Date.now()}`].join("\n")],
    ["n'importe quoi", "ArcHive — n'importe quoi"],
    ["autre adresse", await siwe({ kind: "createKey" }, DEAD)],
    ["autre site", await siwe({ kind: "createKey" }, testWallet.address, { domain: "archive-airdrop.example", uri: "https://archive-airdrop.example" })],
    ["made-up nonce", await siwe({ kind: "createKey" }, testWallet.address, { nonce: { nonce: "f".repeat(32), issuedAt: new Date().toISOString() } })],
    ["foreign statement", await siwe({ kind: "createKey" }, testWallet.address, { edit: (m) => m.replace(/^ArcHive: .*$/m, "Transfer all my funds") })],
    ["old French statement", await siwe({ kind: "createKey" }, testWallet.address, { edit: (m) => m.replace(/^ArcHive: .*$/m, "ArcHive : creer une cle operateur (arcop_), qui ne peut rien depenser") })],
  ];
  for (const [what, text] of refused) {
    const r = await rpcCall("personal_sign", [text, testWallet.address]);
    assert.equal(r.json.error?.code, 4001, `${what} : ${JSON.stringify(r.json)}`);
  }
});

test("test mode: bounded EIP-3009 authorizations (recipient, amount, type, chain, duration)", async () => {
  const ok = await signRwa();
  assert.ok(ok.json.result, JSON.stringify(ok.json));
  const td = rwa();
  const again = await rpcCall("eth_signTypedData_v4", [testWallet.address, JSON.stringify(td)]);
  const who = await recoverTypedDataAddress({ ...(td as any), types: { ReceiveWithAuthorization: td.types.ReceiveWithAuthorization }, message: { ...td.message, value: 1_000_000n, validAfter: 0n, validBefore: BigInt(td.message.validBefore) }, signature: again.json.result });
  assert.equal(who, testWallet.address, "what is signed is indeed what was verified");
  const refused = [
    signRwa({ value: "2500000" }), // > 2 USDC
    signRwa({ to: testnet.operatorBond }), // a bond locks for 7 days
    signRwa({ to: DEAD }),
    signRwa({ primaryType: "TransferWithAuthorization" }),
    signRwa({ chainId: 1 }),
    signRwa({ from: DEAD }),
    signRwa({ validBefore: String(Math.floor(Date.now() / 1000) + 3 * 86400) }),
    signRwa({ valueType: "uint128" }),
  ];
  for (const r of await Promise.all(refused)) assert.equal(r.json.error?.code, 4001, JSON.stringify(r.json));
});

test("test mode: x402 payment for one call, to the SDK deployment's X402Settler, at most the per-signature cap, 1 h at most", async () => {
  // the authorization as the SDK's x402 client signs it (x402.ts, authorize): the deployment's USDC domain, payTo =
  // X402Settler, the call's exact amount, validAfter 0, validity ≤ X402_MAX_VALIDITY_SECONDS, nonce = commitment to the request
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  const nonce = x402CallNonce({
    chainId: testnet.chainId, settler: testnet.x402Settler, productId: 3n, enclave: DEAD as Address,
    enc: toHex(randomBytes(32)), ciphertext: toHex(randomBytes(64)), clientEphemeralPub: toHex(randomBytes(32)),
  });
  const x402 = (value: bigint, validity: bigint) => {
    const td = {
      domain: usdcDomain(testnet.usdc, testnet.chainId),
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        ...receiveWithAuthorizationTypes,
      },
      primaryType: "ReceiveWithAuthorization" as const,
      message: { from: testWallet.address, to: testnet.x402Settler, value, validAfter: 0n, validBefore: nowS + validity, nonce },
    };
    // as wagmi/viem send it to an EIP-1193 wallet: JSON, integers as strings
    return { td, call: rpcCall("eth_signTypedData_v4", [testWallet.address, JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v))]) };
  };

  const one = x402(1_000_000n, BigInt(X402_MAX_VALIDITY_SECONDS));
  const ok = await one.call;
  assert.match(String(ok.json.result), /^0x[0-9a-f]{130}$/, JSON.stringify(ok.json));
  const who = await recoverTypedDataAddress({
    domain: one.td.domain, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message: one.td.message, signature: ok.json.result,
  });
  assert.equal(who, testWallet.address, "signed for X402Settler, as USDC will verify it (receiveWithAuthorization)");
  assert.equal(eip3009SignatureProblem(ok.json.result), null, "canonical signature for USDC (v = 27/28, low s)");
  const line = logs.filter((l) => l.startsWith("test mode {")).map((l) => JSON.parse(l.slice("test mode ".length))).reverse()
    .find((e) => e.method === "eth_signTypedData_v4" && e.ok);
  assert.equal(line?.to, testnet.x402Settler.toLowerCase());
  assert.equal(line?.fn, "ReceiveWithAuthorization (x402)");
  assert.equal(line?.amount, "1");

  // cap per signature (2 USDC by default): just at the cap, yes (the day's budget: 10); above it, refused
  const refused: Array<[string, { call: Promise<{ json: any }> }]> = [
    ["above the per-signature cap", x402(2_000_001n, 600n)],
    ["validity beyond 1 h (the SDK's x402 client)", x402(1_000_000n, BigInt(X402_MAX_VALIDITY_SECONDS) + 120n)],
    ["montant nul", x402(0n, 600n)],
  ];
  for (const [what, r] of refused) assert.equal((await r.call).json.error?.code, 4001, `${what} : ${JSON.stringify((await r.call).json)}`);

  // the addresses come from the SDK's deployment (testnet), never written in the test mode
  const src = readFileSync(new URL("../src/testSigner.ts", import.meta.url), "utf8");
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(src), "no hard-coded address in testSigner.ts");
  assert.match(src, /testnet\.x402Settler/);
});

test("test mode: decoded transactions, allowlist, ownership read on-chain, gas set by the server", async () => {
  const refusals: Array<[string, Promise<{ json: any }>]> = [
    ["USDC.transfer", send(testnet.usdc, encodeFunctionData({ abi: tx, functionName: "transfer", args: [DEAD, 1n] }))],
    ["USDC.approve", send(testnet.usdc, encodeFunctionData({ abi: tx, functionName: "approve", args: [testnet.sessionPay, 1n] }))],
    ["autre contrat", send(DEAD, "0x")],
    ["valeur native", send(testnet.sessionPay, openData(1_000_000n), { value: "0x1" })],
    ["SessionPay.settle", send(testnet.sessionPay, encodeFunctionData({ abi: tx, functionName: "settle", args: [[1n, 1n, 1n, "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), 1n, 1n, 1n, 1n] as any, "0x"] }))],
    ["OperatorBond.bond", send(testnet.operatorBond, encodeFunctionData({ abi: tx, functionName: "bond", args: [1n, anAuth] }))],
    ["OperatorBond.bondFrom", send(testnet.operatorBond, encodeFunctionData({ abi: tx, functionName: "bondFrom", args: [1n] }))],
    ["openSession > 2 USDC", send(testnet.sessionPay, openData(3_000_000n))],
    ["topUp session d'un tiers", send(testnet.sessionPay, encodeFunctionData({ abi: tx, functionName: "topUp", args: [2n, 1n, anAuth] }))],
    ["fund of a third party's bounty", send(testnet.sealedBounty, encodeFunctionData({ abi: tx, functionName: "fund", args: [2n, 1n, anAuth] }))],
    ["withdrawRemaining of a third party's bounty", send(testnet.sealedBounty, encodeFunctionData({ abi: tx, functionName: "withdrawRemaining", args: [2n] }))],
    ["gas above the cap", send(testnet.sealedBounty, REOPEN_7)],
  ];
  for (const [what, p] of refusals) assert.equal((await p).json.error?.code, 4001, `${what} : ${JSON.stringify((await p).json)}`);
  assert.equal(sentRaw.length, 0, "no refused transaction reached the RPC");

  const accepted: Array<[string, Hex, string]> = [
    ["openSession 1 USDC", openData(1_000_000n), testnet.sessionPay],
    ["topUp de sa session", encodeFunctionData({ abi: tx, functionName: "topUp", args: [1n, 500_000n, anAuth] }), testnet.sessionPay],
    ["fund of its own bounty", encodeFunctionData({ abi: tx, functionName: "fund", args: [1n, 500_000n, anAuth] }), testnet.sealedBounty],
    ["withdrawRemaining of its own bounty", encodeFunctionData({ abi: tx, functionName: "withdrawRemaining", args: [1n] }), testnet.sealedBounty],
    ["claim (chasseur)", encodeFunctionData({ abi: tx, functionName: "claim", args: [{ bountyId: 2n, payee: DEAD, blockN: 1n, blockHashN: ("0x" + "00".repeat(32)) as Hex, predicateHash: ("0x" + "00".repeat(32)) as Hex, loss: 1n, tier: 0, fingerprint: ("0x" + "00".repeat(32)) as Hex, cPHash: ("0x" + "00".repeat(32)) as Hex, deadline: 1n }, [], "0x"] }), testnet.sealedBounty],
  ];
  for (const [what, data, to] of accepted) {
    const r = await send(to, data);
    assert.match(String(r.json.result), /^0x[0-9a-f]{64}$/, `${what} : ${JSON.stringify(r.json)}`);
    const t = parseTransaction(sentRaw.at(-1)!);
    assert.equal(t.to?.toLowerCase(), to.toLowerCase());
    assert.equal(t.data, data);
    assert.equal(t.gas, 260_000n, `${what}: gas = estimate × 1.2 + 20,000 (the client's gas, 10 M, is ignored)`);
  }
});

test("test mode: daily budget of 10 USDC (authorizations + gas), then refusal", async () => {
  const before = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  const spent0 = Number(before.json.budget.spentUsdc);
  assert.ok(spent0 >= 2, "the authorizations and gas already committed are counted");
  let refusedAt = -1;
  for (let i = 0; i < 6; i++) {
    const r = await signRwa({ value: "2000000" });
    if (r.json.error) { assert.equal(r.json.error.code, 4001); assert.match(r.json.error.message, /the day's budget/); refusedAt = i; break; }
  }
  assert.ok(refusedAt >= 0, "le budget finit par refuser");
  const after = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  assert.ok(Number(after.json.budget.spentUsdc) <= 10);
  const saved = JSON.parse(readFileSync(join(dataDir, "test-signer-budget.json"), "utf8"));
  assert.equal(saved.spent, String(Math.round(Number(after.json.budget.spentUsdc) * 1e6)));
});

test("log: one line per test-mode request, never the token; token refusals capped", async () => {
  for (let i = 0; i < 10; i++) await rpcCall("eth_accounts", [], "Bearer fake-token-" + i);
  const refusals = logs.filter((l) => l.startsWith("test mode {") && l.includes("token missing or invalid"));
  assert.ok(refusals.length <= 5, `at most 5 token-refusal lines per minute (seen: ${refusals.length})`);
  const lines = logs.filter((l) => l.startsWith("test mode {"));
  assert.ok(lines.length > 20);
  assert.ok(lines.every((l) => !l.includes(TOKEN)), "the token must never be logged");
  const sendLine = lines.map((l) => JSON.parse(l.slice("test mode ".length))).find((e) => e.fn === "SessionPay.openSession" && e.ok);
  assert.ok(sendLine && sendLine.selector === "0x18cfa0a6" && sendLine.amount === "1" && sendLine.to === testnet.sessionPay.toLowerCase());
});

test("every operator-route error carries a stable code, its message and its values: the site and the agent translate by code", () => {
  const SCOPES = ["signatures", "signed_reads", "nonce_requests", "code_requests", "code_lookups", "pairing_polls", "pairing_refusals",
    "key_reads", "heartbeats", "key_heartbeats", "account_signatures", "account_reads", "account_new_reads", "invalid_signatures"];
  assert.ok(errorsSeen.length > 100, `erreurs vues : ${errorsSeen.length}`);
  const codes = new Set<string>();
  for (const e of errorsSeen) {
    const where = `${e.path} → ${e.status} ${JSON.stringify(e.json)}`;
    assert.equal(typeof e.json?.error, "string", where);
    assert.match(String(e.json?.code), /^[a-z][a-z_]+[a-z]$/, where);
    if (e.json.params !== undefined) assert.equal(typeof e.json.params, "object", where);
    if (e.json.code === "rate_limited") {
      assert.ok(SCOPES.includes(e.json.params?.scope), where);
      assert.ok(Number.isInteger(e.json.params.retryAfter) && e.json.params.retryAfter >= 1, where);
    }
    codes.add(e.json.code);
  }
  for (const c of [
    "rate_limited", "too_many_wrong_codes", "pairings_per_ip", "pairings_per_network", "code_unknown", "pair_already_approved",
    "pair_already_yours", "malformed_message", "wrong_site", "wrong_chain", "address_mismatch", "wrong_statement", "signature_expired",
    "nonce_unknown", "signature_used", "issued_at_mismatch", "bad_signature", "key_limit", "machine_limit", "body_too_large",
    "invalid_enum", "invalid_hex", "key_unknown_or_revoked", "key_missing",
  ]) assert.ok(codes.has(c), `code jamais vu : ${c}`);
});
