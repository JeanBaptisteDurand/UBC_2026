/** security.test.ts — garde-fous de l'API (audit du 7/11, failles n° 2, 3, 5, 8, 9 ; vérification du 8/11 : nonces sans
 *  table, débit d'une salle derrière un même Wi-Fi, plafonds par compte et par réseau), contre une instance LOCALE :
 *  les routes opérateurs et le mode test montés sur un serveur Hono local, un RPC d'Arc SIMULÉ (aucun appel réseau,
 *  aucune transaction), des clés de wallet jetables générées ici, un jeton long. Les messages signés sont construits
 *  par le code même du site (web/src/signin.ts, format EIP-4361 « Sign-In with Ethereum »).
 *  Lancer : cd services/api && npx tsx --test test/security.test.ts */
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

// ---------------------------------------------------------------- RPC d'Arc simulé

const DEAD = "0x000000000000000000000000000000000000dEaD";
/** un smart wallet (ERC-1271) simulé : du code à son adresse, et le RPC répond « signature valide » pour lui seul */
const SMART = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe1271";
const testPk = generatePrivateKey();
const testWallet = privateKeyToAccount(testPk);
const sentRaw: Hex[] = [];
/** vérifications de signature du smart wallet demandées au RPC (eth_call) : ce qu'une lecture resservie ne coûte plus */
let smartChecks = 0;
const word = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0") + "00".repeat(32 * 3);
/** propriétaires simulés : session 1 et primes 1 et 7 au wallet de test, le reste à un tiers */
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
      // vérification ERC-1271 / ERC-6492 de viem (validateur universel sans déploiement) : « valide » pour SMART seulement
      if (data.toLowerCase().includes(SMART.slice(2))) { smartChecks++; return "0x" + "0".repeat(63) + "1"; }
      return word(ownerOf(data.slice(0, 10), BigInt("0x" + (data.slice(10, 74) || "0"))));
    }
    case "eth_sendRawTransaction": sentRaw.push(params[0]); return keccak256(params[0]);
  }
  throw new Error(`méthode RPC non simulée : ${method}`);
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

// ---------------------------------------------------------------- état initial : appairages expirés à purger

const dataDir = mkdtempSync(join(tmpdir(), "archive-api-test-"));
const TOKEN = randomBytes(36).toString("base64url"); // jeton long (48 caractères)
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

/** chaque réponse d'erreur des routes opérateurs vue pendant les tests (le dernier test vérifie son code stable) */
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

// ---- signatures du wallet, comme le site les fait (EIP-4361) ----
const SITE = { domain: "archive.test", uri: "https://archive.test" }; // WEB_URL de l'instance de test
type Acct = ReturnType<typeof privateKeyToAccount>;
type Nonce = { nonce: string; issuedAt: string };
async function nonce(): Promise<Nonce> {
  const r = await call("/auth/nonce");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { nonce: r.json.nonce, issuedAt: r.json.issuedAt };
}
type SignOpts = { domain?: string; uri?: string; chainId?: number; nonce?: Nonce; address?: string; edit?: (m: string) => string };
/** le message du site pour cette action (nonce neuf de l'API par défaut) ; `edit` le modifie avant la signature */
async function siwe(action: SignedAction, address: string, o: SignOpts = {}): Promise<string> {
  const n = o.nonce ?? (await nonce());
  const { message } = buildSignIn({
    domain: o.domain ?? SITE.domain, uri: o.uri ?? SITE.uri, chainId: o.chainId ?? arcTestnet.id,
    address, action, nonce: n.nonce, issuedAt: n.issuedAt,
  });
  return o.edit ? o.edit(message) : message;
}
/** { address, message, signature } : signé par `acct`, au nom de `o.address` (par défaut celle de `acct`) */
async function signIn(acct: Acct, action: SignedAction, o: SignOpts = {}) {
  const address = o.address ?? acct.address;
  const message = await siwe(action, address, o);
  return { address, message, signature: await acct.signMessage({ message }) };
}
/** la même chose, avec un nonce demandé depuis `ip` (comme le site d'un opérateur derrière cette adresse) */
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

test("purge au démarrage : appairages expirés effacés, clé jamais remise révoquée, machine jamais vue retirée", async () => {
  assert.equal((await call("/pair/poll", { body: { deviceCode: DC_EXPIRED } })).status, 404);
  assert.equal((await call("/pair/poll", { body: { deviceCode: DC_APPROVED } })).status, 404);
  const hb = await call("/machines/heartbeat", { body: { hostname: "vieille", status: "running" }, auth: `Bearer arcop_aaaaaaaa_${OLD_SECRET}` });
  assert.equal(hb.status, 401);
  assert.match(hb.json.error, /révoquée/);
  assert.equal(hb.json.code, "key_unknown_or_revoked");
  assert.equal((await call(`/machines/${OLD_MACHINE}`)).status, 404, "machine jamais vue retirée");
  const fresh = await call("/pair/hive-7k2pqx9m"); // casse et tiret indifférents
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.hostnameHidden, true);
  assert.notEqual(fresh.json.hostname, "hote-secret");
  assert.equal(fresh.json.version, "");
  await new Promise((r) => setTimeout(r, 400)); // écriture différée (200 ms)
  const disk = readFileSync(join(dataDir, "operators.json"), "utf8");
  assert.ok(!disk.includes(OLD_SECRET), "keyPlain ne doit plus être sur disque");
  assert.ok(!disk.includes("vieux journal"), "les journaux ne sont plus écrits sur disque");
  assert.ok(!disk.includes(DC_EXPIRED) && disk.includes(DC_FRESH));
});

test("codes de 8 caractères ; le nom de la machine n'est pas révélé avant la signature", async () => {
  const r = await call("/pair/start", { body: { hostname: "ma-machine", mode: "dstack", version: "0.1.0" } });
  assert.equal(r.status, 200);
  assert.match(r.json.userCode, /^HIVE-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.ok(r.json.verifyUrl.endsWith(r.json.userCode));
  // la route anglaise du site (alias de la page Opérateur) : aucun mot français dans le terminal de l'opérateur
  assert.equal(r.json.verifyUrl, `${SITE.uri}/#/operator?code=${r.json.userCode}`);
  const g = await call(`/pair/${r.json.userCode}`);
  assert.equal(g.status, 200);
  assert.ok(!JSON.stringify(g.json).includes("ma-machine"));
  assert.equal(g.json.mode, "dstack");
  assert.equal((await call("/pair/start", { body: { hostname: "x", mode: "root" } })).status, 400);
});

test("débit : 20 appairages en cours par IP et 50 par réseau (/24, /48), 30 recherches de code par minute et par IP", async () => {
  const ip = "198.51.100.7";
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `m${i}` }, ip })).status, 200);
  const over = await call("/pair/start", { body: { hostname: "m20" }, ip });
  assert.equal(over.status, 429);
  assert.match(over.json.error, /déjà 20 appairages en cours depuis cette adresse/);
  assert.deepEqual([over.json.code, over.json.params], ["pairings_per_ip", { max: 20, minutes: 15 }]);
  // seule la DERNIÈRE entrée de X-Forwarded-For compte (celle que pose Caddy) : varier les premières ne contourne rien
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `n${i}` }, ip: `9.9.9.${i}, 198.51.100.77` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "n20" }, ip: "8.8.8.8, 198.51.100.77" })).status, 429);
  // le même /24 : 50 en cours au plus, toutes ses adresses confondues
  for (let i = 0; i < 10; i++) assert.equal((await call("/pair/start", { body: { hostname: `p${i}` }, ip: `198.51.100.${100 + i}` })).status, 200);
  const net = await call("/pair/start", { body: { hostname: "p10" }, ip: "198.51.100.120" });
  assert.equal(net.status, 429);
  assert.match(net.json.error, /déjà 50 appairages en cours depuis ce réseau/);
  assert.deepEqual([net.json.code, net.json.params?.max], ["pairings_per_network", 50]);
  // IPv6 : tout le /64 partage la limite d'une adresse, tout le /48 celle d'un réseau
  for (let i = 0; i < 20; i++) assert.equal((await call("/pair/start", { body: { hostname: `v${i}` }, ip: `2001:db8:1:2::${(i + 1).toString(16)}` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "v20" }, ip: "2001:db8:1:2:ffff::9" })).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await call("/pair/start", { body: { hostname: `w${i}` }, ip: `2001:db8:1:${(i + 3).toString(16)}::1` })).status, 200);
  assert.equal((await call("/pair/start", { body: { hostname: "w30" }, ip: "2001:db8:1:ff::1" })).status, 429, "le /48 a ses 50 appairages en cours");
  assert.equal((await call("/pair/start", { body: { hostname: "x" }, ip: "2001:db8:2::1" })).status, 200, "un autre /48 n'est pas touché");
  // recherches de code : 30 par minute et par IP
  const ip2 = "198.51.100.8";
  for (let i = 0; i < 30; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: ip2 })).status, 404);
  const r = await call("/pair/HIVE-AAAA-AAAA", { ip: ip2 });
  assert.equal(r.status, 429);
  assert.match(r.json.error, /recherches de code/);
  assert.equal(r.json.code, "rate_limited");
  assert.equal(r.json.params.scope, "code_lookups");
  assert.equal(r.json.params.retryAfter, Number(r.headers.get("retry-after")));
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: "198.51.100.9" })).status, 404, "une autre IP n'est pas bloquée");
});

test("codes faux : plafond par réseau (/24 en IPv4, /48 en IPv6), plus de plafond global", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const s = await call("/pair/start", { body: { hostname: "salle-austin", mode: "demo" }, ip: "198.18.7.1" });
  const code = s.json.userCode as string;
  // 60 codes faux depuis 60 adresses d'un même /24 (une recherche chacune : le débit par IP n'y est pour rien)
  for (let i = 1; i <= 60; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: `192.0.2.${i}` })).status, 404);
  const blocked = await call(`/pair/${code}`, { ip: "192.0.2.200" });
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /trop de codes faux essayés : réessayez dans \d+ s/);
  assert.equal(blocked.json.code, "too_many_wrong_codes");
  // ce réseau ne peut plus approuver non plus (refus avant la signature)
  assert.equal((await call("/pair/approve", { body: { userCode: code, ...(await signIn(op, { kind: "pair", code })) }, ip: "192.0.2.201" })).status, 429);
  // un autre /24 n'est pas touché (avant : 300 codes faux au total, 31 IP en 78 ms, bloquaient TOUT appairage)
  assert.equal((await call(`/pair/${code}`, { ip: "192.0.3.1" })).status, 200);
  assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: "192.0.3.2" })).status, 404);
  // IPv6 : tout le /48 compte ensemble, même depuis 60 /64 différents
  for (let i = 1; i <= 60; i++) assert.equal((await call("/pair/HIVE-AAAA-AAAA", { ip: `2001:db8:aa:${i.toString(16)}::1` })).status, 404);
  assert.equal((await call(`/pair/${code}`, { ip: "2001:db8:aa:ffff::1" })).status, 429);
  assert.equal((await call(`/pair/${code}`, { ip: "2001:db8:ab::1" })).status, 200, "un autre /48 n'est pas touché");
  // l'approbation depuis un réseau sain passe
  const ok = await call("/pair/approve", { body: { userCode: code, ...(await signIn(op, { kind: "pair", code })) }, ip: "192.0.3.3" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

// ================================================================ n° 8 : messages signés EIP-4361

test("n° 8 : le site et l'API écrivent exactement les mêmes phrases, en anglais et en ASCII (grammaire d'EIP-4361)", () => {
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
  // ce que le signataire lira dans son wallet
  assert.equal(ops.STATEMENT.pair("HIVE-7K2P-QX9M"), "ArcHive: pair the machine showing code HIVE-7K2P-QX9M with my account");
  assert.equal(ops.STATEMENT.createKey(), "ArcHive: create an operator key (arcop_) that cannot spend funds");
  assert.equal(ops.STATEMENT.revokeKey("1a2b3c4d"), "ArcHive: revoke operator key arcop_1a2b3c4d");
  assert.equal(ops.STATEMENT.removeMachine(MID), `ArcHive: remove machine ${MID} from my account (its key is revoked)`);
  assert.equal(ops.STATEMENT.read(), "ArcHive: read my operator data for 10 minutes (diagnostics, logs, machine and key names)");
});

test("n° 8 : nonce émis par l'API, à usage unique ; rejeu d'un message signé refusé", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const n = await call("/auth/nonce");
  assert.equal(n.status, 200);
  assert.match(n.json.nonce, /^[0-9a-f]{60}$/, "heure d'émission, aléa et HMAC de l'API (alphanumérique : grammaire d'EIP-4361)");
  assert.deepEqual([n.json.domain, n.json.uri, n.json.chainId], [SITE.domain, SITE.uri, 5042002]);
  assert.equal(n.headers.get("cache-control"), "no-store");
  const body = { label: "cli", ...(await signIn(op, { kind: "createKey" }, { nonce: n.json })) };
  assert.match(body.message, /^archive\.test wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n\nArcHive: create an operator key \(arcop_\) that cannot spend funds\n\nURI: https:\/\/archive\.test\nVersion: 1\nChain ID: 5042002\nNonce: [0-9a-f]{60}\nIssued At: \S+\nExpiration Time: \S+$/);
  assert.ok(/^[\x20-\x7e\n]+$/.test(body.message), "message entier en ASCII imprimable");
  assert.equal((await call("/operator/keys", { body })).status, 200);
  const replay = await call("/operator/keys", { body });
  assert.equal(replay.status, 409, "rejeu refusé");
  assert.match(replay.json.error, /déjà utilisée/);
  assert.equal(replay.json.code, "signature_used");
  // deux envois simultanés du même message : un seul passe
  const twin = { label: "jumelle", ...(await signIn(op, { kind: "createKey" })) };
  const both = await Promise.all([call("/operator/keys", { body: twin }), call("/operator/keys", { body: twin })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  // un nonce servi ne vaut plus pour un autre message, même signé par le bon wallet
  const n2 = await nonce();
  const k = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n2 })) } });
  assert.equal(k.status, 200);
  const rv = await call(`/operator/keys/${k.json.keyId}/revoke`, { body: await signIn(op, { kind: "revokeKey", keyId: k.json.keyId }, { nonce: n2 }) });
  assert.equal(rv.status, 409);
  assert.equal((await call(`/operator/keys?address=${op.address}`)).json.filter((x: any) => !x.revoked).length, 3);
});

test("n° 8 : nonce expiré, inconnu ou antérieur à son émission ; échéance trop longue ou passée : refusés", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  // expiré : un nonce sert 5 minutes. Une lecture (valable 10 min) signée maintenant et présentée 6 minutes plus tard.
  const late = await signIn(op, { kind: "read" });
  const realNow = Date.now;
  let r: Awaited<ReturnType<typeof call>>;
  try {
    Date.now = () => realNow() + 6 * 60_000;
    r = await call("/operator/keys/list", { body: late });
  } finally { Date.now = realNow; }
  assert.equal(r.status, 401);
  assert.match(r.json.error, /nonce (expiré|inconnu ou échu)/);
  assert.match(r.json.code, /^nonce_(expired|unknown)$/);
  // un nonce que l'API n'a jamais émis
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: "f".repeat(32), issuedAt: new Date().toISOString() } })) } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /nonce inconnu/);
  assert.equal(r.json.code, "nonce_unknown");
  // « Issued At » antidaté de 3 minutes par rapport à l'émission du nonce
  const n = await nonce();
  const back = new Date(Date.parse(n.issuedAt) - 3 * 60_000).toISOString();
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: n.nonce, issuedAt: back } })) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Issued At/);
  assert.equal(r.json.code, "issued_at_mismatch");
  // une action valable 30 minutes au lieu de 5
  const setExpiry = (iso: string) => (m: string) => m.replace(/^Expiration Time: .*$/m, `Expiration Time: ${iso}`);
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n, edit: setExpiry(new Date(Date.parse(n.issuedAt) + 30 * 60_000).toISOString()) })) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Expiration Time/);
  assert.deepEqual([r.json.code, r.json.params], ["malformed_message", { part: "expiry_window", minutes: 5 }]);
  // déjà échue
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n, edit: setExpiry(new Date(Date.now() - 1000).toISOString()) })) } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /expirée/);
  assert.equal(r.json.code, "signature_expired");
  // les refus n'ont pas consommé le nonce : bien utilisé, il passe une fois
  r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n })) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test("n° 8 : message pour un autre site, une autre URI, un autre réseau ; ancien format ; ligne en trop : refusés", async () => {
  const op = privateKeyToAccount(generatePrivateKey());
  const post = (s: { address: string; message: string; signature: string }) => call("/operator/keys", { body: { label: "x", ...s } });
  // domaine étranger (le site d'un hameçonneur) : le wallet le signale, l'API le refuse
  let r = await post(await signIn(op, { kind: "createKey" }, { domain: "archive-airdrop.example", uri: "https://archive-airdrop.example" }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /autre site.*archive-airdrop\.example/);
  assert.deepEqual([r.json.code, r.json.params], ["wrong_site", { site: "archive-airdrop.example", expected: "archive.test" }]);
  r = await post(await signIn(op, { kind: "createKey" }, { uri: "https://archive-airdrop.example" }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /URI: https:\/\/archive\.test/);
  assert.deepEqual([r.json.code, r.json.params], ["malformed_message", { part: "uri", uri: "https://archive.test" }]);
  r = await post(await signIn(op, { kind: "createKey" }, { uri: "http://archive.test" }));
  assert.equal(r.status, 400, "le même domaine en http : refusé");
  r = await post(await signIn(op, { kind: "createKey" }, { chainId: 1 }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /autre réseau/);
  assert.deepEqual([r.json.code, r.json.params], ["wrong_chain", { chainId: 5042002 }]);
  // l'ancien format « ArcHive — … » (sans domaine ni nonce)
  const old = ["ArcHive — Créer une clé opérateur", `Adresse : ${op.address}`, `Horodatage : ${Date.now()}`].join("\n");
  r = await post({ address: op.address, message: old, signature: await op.signMessage({ message: old }) });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /EIP-4361/);
  assert.deepEqual([r.json.code, r.json.params?.part], ["malformed_message", "format"]);
  // une ligne de plus (ressources, identifiant de requête…), l'adresse sans sa casse EIP-55, la phrase d'une autre action
  r = await post(await signIn(op, { kind: "createKey" }, { edit: (m) => `${m}\nResources:\n- https://archive-airdrop.example` }));
  assert.equal(r.status, 400);
  r = await post(await signIn(op, { kind: "createKey" }, { edit: (m) => m.replace(op.address, op.address.toLowerCase()) }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /adresse/);
  assert.equal(r.json.code, "address_mismatch");
  r = await post(await signIn(op, { kind: "read" }));
  assert.equal(r.status, 400, "une signature de lecture ne crée pas de clé");
  assert.match(r.json.error, /phrase/);
  assert.equal((await call(`/operator/keys?address=${op.address}`)).json.length, 0, "aucune clé créée");
  assert.equal(r.json.code, "wrong_statement");
  assert.equal(r.json.params.statement, ops.STATEMENT.createKey());
});

test("smart wallet (ERC-1271) : signature acceptée via le RPC ; EOA : vérifiée localement", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const s = await signIn(owner, { kind: "createKey" }, { address: SMART });
  assert.ok(s.message.split("\n")[1] === getAddress(SMART));
  const r = await call("/operator/keys", { body: { label: "coffre", ...s } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await call(`/operator/keys?address=${SMART}`)).json.length, 1);
  // la même signature présentée pour une EOA (sans code) : refusée
  const eoa = privateKeyToAccount(generatePrivateKey());
  const forged = await signIn(owner, { kind: "createKey" }, { address: eoa.address });
  const f = await call("/operator/keys", { body: { label: "x", ...forged } });
  assert.equal(f.status, 401);
  assert.match(f.json.error, /signature invalide/);
  assert.equal(f.json.code, "bad_signature");
});

// ================================================================ vérification du 8/11 : saturations, salle derrière un même Wi-Fi

/** `n` requêtes, `width` à la fois */
async function inBatches<T>(n: number, width: number, f: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i += width) out.push(...(await Promise.all(Array.from({ length: Math.min(width, n - i) }, (_, j) => f(i + j)))));
  return out;
}

test("nonces sans table : 21 000 demandes ne remplissent rien ; nonce forgé, retouché ou en majuscules : refusé", async () => {
  // avant : 20 000 places, pleines en 1 s (670 IP × 30), puis 503 pour tout le monde pendant 5 minutes
  // (50 à la fois : un terminal macOS n'ouvre souvent que 256 fichiers, sockets comprises)
  const statuses = await inBatches(21_000, 50, (i) => call("/auth/nonce", { ip: `2001:db8:5:${(i % 100).toString(16)}::1` }).then((r) => r.status));
  assert.equal(statuses.filter((s) => s === 200).length, 21_000);
  // le visiteur suivant signe normalement
  const op = privateKeyToAccount(generatePrivateKey());
  const n = await nonce();
  // le même nonce, retouché : dernier signe du HMAC, heure d'émission, majuscules ; ou 60 signes au hasard
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "0" ? "1" : "0") + s.slice(i + 1);
  for (const [what, bad] of [["HMAC", flip(n.nonce, 59)], ["heure", flip(n.nonce, 11)], ["aléa", flip(n.nonce, 20)], ["majuscules", n.nonce.toUpperCase()], ["hasard", randomBytes(30).toString("hex")]] as const) {
    const r = await call("/operator/keys", { body: { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: { nonce: bad, issuedAt: n.issuedAt } })) } });
    assert.equal(r.status, 401, what);
    assert.match(r.json.error, /nonce inconnu ou échu/, what);
  }
  // le vrai, intact : il passe une fois (les refus ne l'ont pas consommé), puis plus jamais
  const body = { label: "x", ...(await signIn(op, { kind: "createKey" }, { nonce: n })) };
  assert.equal((await call("/operator/keys", { body })).status, 200);
  assert.equal((await call("/operator/keys", { body })).status, 409);
  // consommé, il reste refusé jusqu'à son échéance (4 min plus tard : 409), puis l'échéance le refuse d'elle-même
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4 * 60_000;
    assert.equal((await call("/operator/keys", { body })).status, 409);
    Date.now = () => realNow() + 6 * 60_000;
    assert.equal((await call("/operator/keys", { body })).status, 401);
  } finally { Date.now = realNow; }
});

test("démo derrière un même Wi-Fi : 10 opérateurs sur UNE adresse, au rythme du site, sans aucun refus ; les plafonds par IP restent", async () => {
  const ROOM = "198.51.100.200";
  const room = Array.from({ length: 10 }, () => privateKeyToAccount(generatePrivateKey()));
  const statuses: number[] = [];
  const mine: Array<{ read: Awaited<ReturnType<typeof signIn>>; machineId: string }> = [];
  for (const op of room) {
    // une clé (signature), une machine qui bat, une lecture ouverte (signature)
    const k = await call("/operator/keys", { body: { label: "portable", ...(await signFrom(ROOM, op, { kind: "createKey" })) }, ip: ROOM });
    statuses.push(k.status);
    const hb = await call("/machines/heartbeat", { body: { hostname: "portable", status: "running" }, auth: `Bearer ${k.json.key}`, ip: ROOM });
    statuses.push(hb.status);
    mine.push({ read: await signFrom(ROOM, op, { kind: "read" }), machineId: hb.json.machineId });
  }
  // une minute de site pour chacun : la liste toutes les 10 s, le détail toutes les 15 s, les clés deux fois
  // (120 lectures signées depuis une seule adresse ; avant : 60 par minute et par IP, et 10 refus sur 42 à 7 opérateurs)
  for (let tick = 0; tick < 6; tick++) {
    for (const { read, machineId } of mine) {
      statuses.push((await call("/machines/list", { body: read, ip: ROOM })).status);
      if (tick < 4) statuses.push((await call(`/machines/${machineId}/detail`, { body: read, ip: ROOM })).status);
      if (tick < 2) statuses.push((await call("/operator/keys/list", { body: read, ip: ROOM })).status);
    }
  }
  assert.equal(statuses.length, 10 * 2 + 120);
  assert.deepEqual([...new Set(statuses)], [200]);
  // une seule adresse reste bornée : 240 nonces par minute, puis 429
  const flood = await inBatches(241, 50, () => call("/auth/nonce", { ip: "198.51.100.250" }).then((r) => r.status));
  assert.equal(flood.filter((s) => s === 200).length, 240);
  const last = await call("/auth/nonce", { ip: "198.51.100.250" });
  assert.equal(last.status, 429);
  assert.match(last.json.error, /trop de requêtes \(demandes de nonce\)/);
  assert.deepEqual([last.json.code, last.json.params.scope], ["rate_limited", "nonce_requests"]);
});

test("coût d'une signature : invalide, comptée par IP (30 par minute) ; valide, par compte (30 actions, 10 lectures ouvertes)", async () => {
  const victim = privateKeyToAccount(generatePrivateKey());
  const forger = privateKeyToAccount(generatePrivateKey());
  const IP = "198.51.100.210";
  // 30 signatures invalides au nom de la victime : 401, puis l'IP n'obtient plus aucune vérification de la minute
  for (let i = 0; i < 30; i++) {
    const r = await call("/operator/keys", { body: { label: "x", ...(await signIn(forger, { kind: "createKey" }, { address: victim.address })) }, ip: IP });
    assert.equal(r.status, 401);
  }
  const cut = await call("/operator/keys", { body: { label: "x", ...(await signIn(victim, { kind: "createKey" })) }, ip: IP });
  assert.equal(cut.status, 429, "même une signature valide, depuis cette IP, attend la minute suivante");
  assert.match(cut.json.error, /signatures invalides/);
  assert.deepEqual([cut.json.code, cut.json.params.scope], ["rate_limited", "invalid_signatures"]);
  // le compte visé n'a rien perdu : ses 30 actions de la minute (signatures valides, depuis d'autres adresses) passent
  for (let i = 0; i < 30; i++) {
    const keyId = randomBytes(4).toString("hex");
    const r = await call(`/operator/keys/${keyId}/revoke`, { body: await signIn(victim, { kind: "revokeKey", keyId }) });
    assert.equal(r.status, 404, JSON.stringify(r.json)); // signature valide, clé inconnue
  }
  const keyId = randomBytes(4).toString("hex");
  const body = await signIn(victim, { kind: "revokeKey", keyId });
  const capped = await call(`/operator/keys/${keyId}/revoke`, { body });
  assert.equal(capped.status, 429);
  assert.match(capped.json.error, /signatures de ce compte/);
  assert.deepEqual([capped.json.code, capped.json.params.scope], ["rate_limited", "account_signatures"]);
  // un autre compte, au même moment, depuis la même adresse : rien ne le bloque
  const other = privateKeyToAccount(generatePrivateKey());
  assert.equal((await call("/operator/keys", { body: { label: "x", ...(await signIn(other, { kind: "createKey" })) } })).status, 200);
  // le refus pour débit n'a pas brûlé la signature : la minute suivante, elle sert (et sa clé reste inconnue : 404)
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 61_000;
    assert.equal((await call(`/operator/keys/${keyId}/revoke`, { body })).status, 404);
  } finally { Date.now = realNow; }

  // lectures : 10 lectures OUVERTES par minute et par compte ; une lecture ouverte resservie passe toujours
  const reader = privateKeyToAccount(generatePrivateKey());
  const reads: Array<Awaited<ReturnType<typeof signIn>>> = [];
  for (let i = 0; i < 10; i++) {
    const read = await signIn(reader, { kind: "read" });
    assert.equal((await call("/machines/list", { body: read })).status, 200);
    reads.push(read);
  }
  const eleventh = await call("/machines/list", { body: await signIn(reader, { kind: "read" }) });
  assert.equal(eleventh.status, 429);
  assert.match(eleventh.json.error, /nouvelles lectures signées de ce compte/);
  assert.deepEqual([eleventh.json.code, eleventh.json.params.scope], ["rate_limited", "account_new_reads"]);
  assert.equal((await call("/machines/list", { body: reads[0] })).status, 200);
});

test("une lecture resservie ne refait pas la vérification (smart wallet : aucun appel au RPC) ; une autre signature, si", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const read = await signIn(owner, { kind: "read" }, { address: SMART });
  const c0 = smartChecks;
  assert.equal((await call("/machines/list", { body: read })).status, 200);
  const c1 = smartChecks;
  assert.ok(c1 > c0, "première ouverture : vérifiée par le RPC (ERC-1271)");
  for (let i = 0; i < 5; i++) assert.equal((await call("/operator/keys/list", { body: read })).status, 200);
  assert.equal(smartChecks, c1, "la même signature, resservie : pas de nouvelle vérification");
  // le même message avec une AUTRE signature (que le RPC simulé accepte pour ce wallet) : vérifiée de nouveau
  const other = { ...read, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: read.message }) };
  assert.equal((await call("/machines/list", { body: other })).status, 200);
  assert.ok(smartChecks > c1);
});

test("table de débit : pleine, elle passe à une table fixe partagée, sans refuser d'office une clé nouvelle", () => {
  const l = new ops.Limiter(50, 60_000, 100);
  const t0 = 1_000_000;
  for (let i = 0; i < 100; i++) assert.equal(l.take(`ip-${i}`, t0), true);
  // la table exacte est pleine pour la minute : 20 000 adresses nouvelles passent quand même (avant : toutes refusées)
  let refused = 0;
  for (let i = 100; i < 20_100; i++) if (!l.take(`ip-${i}`, t0)) refused++;
  assert.equal(refused, 0);
  // une adresse nouvelle qui inonde reste bornée (dans sa case partagée)
  const flood = Array.from({ length: 60 }, () => l.take("inondation", t0 + 1));
  assert.equal(flood[0], true);
  assert.equal(flood.at(-1), false);
  assert.ok(l.count("inondation", t0 + 1) >= 50);
  assert.ok(l.retryAfter("inondation", t0 + 1) <= 60);
  // les clés de la table exacte gardent leur compte exact : 50 passages dans la minute, pas un de plus
  for (let i = 0; i < 49; i++) assert.equal(l.take("ip-0", t0 + 2), true);
  assert.equal(l.take("ip-0", t0 + 3), false, "51e passage de la minute : refusé");
  // la minute suivante, tout repart, et la table exacte a de nouveau de la place
  assert.equal(l.take("inondation", t0 + 60_001), true);
  assert.equal(l.take("ip-0", t0 + 60_002), true);
});

// ================================================================ n° 5 : approbation et refus sur la machine

const opA = privateKeyToAccount(generatePrivateKey());
const opB = privateKeyToAccount(generatePrivateKey());
let machineA = "", machineKeyA = "";

test("approbation : message EIP-4361 vérifié ligne à ligne, nonce à usage unique ; la clé ne sort qu'une fois", async () => {
  const s = await call("/pair/start", { body: { hostname: "tdx-paris-1", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  // la signature d'un AUTRE code n'approuve pas celui-ci
  const other = await call("/pair/approve", { body: { userCode: code, ...(await signIn(opA, { kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) } });
  assert.equal(other.status, 400);
  assert.match(other.json.error, /phrase/);
  // signée par un autre wallet que l'adresse annoncée
  const forged = await call("/pair/approve", { body: { userCode: code, ...(await signIn(opB, { kind: "pair", code }, { address: opA.address })) } });
  assert.equal(forged.status, 401);
  // la bonne (code saisi en minuscules : normalisé avant la vérification)
  const body = { userCode: code.toLowerCase(), ...(await signIn(opA, { kind: "pair", code })) };
  const ok = await call("/pair/approve", { body });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.hostname, "tdx-paris-1", "le nom est remis à celui qui a signé");
  machineA = ok.json.machineId;
  assert.equal((await call("/pair/approve", { body })).status, 409, "rejeu de la même signature refusé");
  const p1 = await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } });
  assert.equal(p1.json.status, "approved");
  assert.equal(p1.json.operator, opA.address.toLowerCase(), "la machine apprend l'adresse complète qui l'a approuvée");
  assert.match(p1.json.key, /^arcop_[0-9a-f]{8}_/);
  machineKeyA = p1.json.key;
  assert.equal((await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.status, "consumed");
});

test("refus sur la machine (« n ») : /pair/reject révoque sa clé et la retire du compte qui l'avait approuvée", async () => {
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
  assert.equal(hb.status, 401, "la clé refusée ne sert plus");
  // une clé libre (sans machine) ne peut pas « refuser un appairage » ; sans clé : 401
  const free = await call("/operator/keys", { body: { label: "cli", ...(await signIn(intruder, { kind: "createKey" })) } });
  assert.equal((await call("/pair/reject", { method: "POST", auth: `Bearer ${free.json.key}` })).status, 400);
  assert.equal((await call("/pair/reject", { method: "POST" })).status, 401);
});

test("approbation : code déjà approuvé par un AUTRE compte → 409 pair_already_approved ; par ce compte → 409 pair_already_yours ; inconnu ou échu → 404", async () => {
  const first = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const s = await call("/pair/start", { body: { hostname: "salle-austin-2", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  const ok = await call("/pair/approve", { body: { userCode: code, ...(await signIn(first, { kind: "pair", code })) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // un autre compte, avec une signature valide pour CE code : 409 (avant : 404, comme un code inconnu)
  const other = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
  assert.deepEqual([other.status, other.json.code], [409, "pair_already_approved"]);
  assert.ok(!JSON.stringify(other.json).includes("salle-austin-2"), "le nom de la machine reste réservé à celui qui a approuvé");
  // le même compte (un autre onglet, un double envoi) : 409, sans parler d'un autre compte
  const mine = await call("/pair/approve", { body: { userCode: code.toLowerCase(), ...(await signIn(first, { kind: "pair", code })) } });
  assert.deepEqual([mine.status, mine.json.code], [409, "pair_already_yours"]);
  // la clé une fois remise à la machine, c'est toujours 409 pour l'autre compte
  assert.equal((await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.status, "approved");
  const after = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
  assert.deepEqual([after.status, after.json.code], [409, "pair_already_approved"]);
  // un code jamais émis : 404 code_unknown (compté comme code faux)
  const unknown = await call("/pair/approve", { body: { userCode: "HIVE-ZZZZ-ZZZZ", ...(await signIn(second, { kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) } });
  assert.deepEqual([unknown.status, unknown.json.code], [404, "code_unknown"]);
  // le même code, échu (15 minutes plus tard) : 404 aussi
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60_000;
    const late = await call("/pair/approve", { body: { userCode: code, ...(await signIn(second, { kind: "pair", code })) } });
    assert.deepEqual([late.status, late.json.code], [404, "code_unknown"]);
  } finally { Date.now = realNow; }
});

// ================================================================ n° 3 : battements, validation, bornes

test("battement : champs validés strictement, corps borné", async () => {
  const auth = `Bearer ${machineKeyA}`;
  const good = {
    hostname: "tdx-paris-1", mode: "dstack", version: "0.1.0", productId: 6, status: "running",
    enclaveUrl: "http://203.0.113.50:8802", signer: "0x" + "ab".repeat(20), x25519: "0x" + "cd".repeat(32),
    doctor: { ok: false, checks: [{ id: "port", label: "Port", ok: false, detail: "fermé sur 203.0.113.50" }, { id: "docker", label: "Docker", ok: true, detail: "" }] },
    logs: ["\x1b[31mERREUR\x1b[0m connexion refusée", "ligne 2"],
  };
  const r = await call("/machines/heartbeat", { body: good, auth });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const [field, bad, code] of [
    ["signer", "0x1234", "invalid_hex"], ["x25519", { a: 1 }, "invalid_hex"], ["productId", "12345678901", "invalid_product_id"],
    ["mode", "evil", "invalid_enum"], ["status", "pwned", "invalid_enum"], ["enclaveUrl", "javascript:alert(1)", "enclave_url_scheme"],
    ["enclaveUrl", "http://[::1", "unreadable_enclave_url"], ["enclaveUrl", "https://" + "a".repeat(200), "invalid_enclave_url"],
    ["logs", "pas un tableau", "invalid_logs"], ["doctor", { checks: "non" }, "invalid_doctor"],
  ] as const) {
    const x = await call("/machines/heartbeat", { body: { ...good, [field]: bad }, auth });
    assert.equal(x.status, 400, `${field} invalide doit être refusé`);
    assert.equal(x.json.code, code, `${field} : ${JSON.stringify(x.json)}`);
  }
  const badMode = await call("/machines/heartbeat", { body: { ...good, mode: "evil" }, auth });
  assert.deepEqual(badMode.json.params, { field: "mode", allowed: "tdx, dstack, demo" });
  const badSigner = await call("/machines/heartbeat", { body: { ...good, signer: "0x12" }, auth });
  assert.deepEqual(badSigner.json.params, { field: "signer", length: 40 });
  const big = await call("/machines/heartbeat", { raw: JSON.stringify({ ...good, logs: ["x".repeat(100 * 1024)] }), auth });
  assert.equal(big.status, 413);
  assert.deepEqual([big.json.code, big.json.params], ["body_too_large", { maxKiB: 64 }]);
  // sans Content-Length (envoi par morceaux) : la lecture s'arrête à 64 Kio, rien n'est enregistré
  const payload = new TextEncoder().encode(JSON.stringify({ ...good, hostname: "gros-corps", logs: ["y".repeat(200 * 1024)] }));
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < payload.length; i += 8192) c.enqueue(payload.slice(i, i + 8192)); c.close(); } });
  const chunked = await fetch(base + "/machines/heartbeat", { method: "POST", headers: { "content-type": "application/json", authorization: auth, "x-forwarded-for": freshIp() }, body: stream, duplex: "half" } as any);
  assert.ok([400, 413].includes(chunked.status), `corps par morceaux trop gros : ${chunked.status}`);
  const after = await call(`/machines/${machineA}`, { auth });
  assert.equal(after.json.hostname, "tdx-paris-1", "le corps tronqué n'a rien modifié");
});

test("lecture : liste exige ?operator, vue publique réduite ; journaux et diagnostic réservés à l'opérateur", async () => {
  assert.equal((await call("/machines")).status, 400);
  const pubList = await call(`/machines?operator=${opA.address}`);
  assert.equal(pubList.status, 200);
  const m = pubList.json.find((x: any) => x.machineId === machineA);
  assert.ok(m);
  assert.equal(m.hostnameHidden, true);
  assert.notEqual(m.hostname, "tdx-paris-1");
  assert.equal(m.enclaveUrl, null, "une adresse http://IP n'est pas publique");
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
  assert.deepEqual(own.json.logs, ["ERREUR connexion refusée", "ligne 2"], "séquences ANSI retirées");
  assert.equal(own.json.doctor.checks.length, 2);

  // une clé libre d'un AUTRE opérateur : 403
  const kB = await call("/operator/keys", { body: { label: "cli", ...(await signIn(opB, { kind: "createKey" })) } });
  assert.equal(kB.status, 200);
  assert.equal((await call(`/machines/${machineA}`, { auth: `Bearer ${kB.json.key}` })).status, 403);

  // signature de lecture (EIP-4361) : son nonce sert au premier usage, puis elle ouvre tout pendant ses 10 minutes
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
  assert.equal(full.logs, undefined, "la liste ne porte pas les journaux");
  // la lecture d'un autre opérateur ne voit pas cette machine ; une lecture n'autorise aucune action
  assert.equal((await call(`/machines/${machineA}/detail`, { body: await signIn(opB, { kind: "read" }) })).status, 404);
  assert.equal((await call(`/machines/${machineA}/remove`, { body: read })).status, 400);
});

test("provenance explicite : pairedBy « code » ou « key », l'adresse qui a approuvé, la clé libre qui a repris la machine", async () => {
  const opE = privateKeyToAccount(generatePrivateKey());
  const op = opE.address.toLowerCase();
  const s = await call("/pair/start", { body: { hostname: "tdx-austin-1", mode: "dstack", version: "0.1.0" } });
  const code = s.json.userCode as string;
  assert.equal((await call("/pair/approve", { body: { userCode: code, ...(await signIn(opE, { kind: "pair", code })) } })).status, 200);
  const machineKey = (await call("/pair/poll", { body: { deviceCode: s.json.deviceCode } })).json.key as string;
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running" }, auth: `Bearer ${machineKey}` })).status, 200);
  let pub = (await call(`/machines?operator=${opE.address}`)).json;
  assert.equal(pub.length, 1);
  assert.deepEqual([pub[0].pairedBy, pub[0].approvedBy, pub[0].viaKey], ["code", op, null], "vue publique : la provenance, sans le nom");
  assert.ok(typeof pub[0].pairedAt === "number");
  // une clé LIBRE ajoute une autre machine : « key », avec sa clé
  const free = (await call("/operator/keys", { body: { label: "cli", ...(await signIn(opE, { kind: "createKey" })) } })).json;
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "portable", status: "running" }, auth: `Bearer ${free.key}` })).status, 200);
  const view = async () => {
    const list = (await call(`/machines?operator=${opE.address}`, { auth: `Bearer ${free.key}` })).json as any[];
    return Object.fromEntries(list.map((m) => [m.hostname, [m.pairedBy, m.approvedBy, m.viaKey]]));
  };
  assert.deepEqual(await view(), { "tdx-austin-1": ["code", op, null], portable: ["key", op, free.keyId] });
  // la clé libre reprend la machine appairée (même nom) : ce qu'elle annonce n'a été confirmé sur aucune machine → « key »
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running", enclaveUrl: "https://ailleurs.example" }, auth: `Bearer ${free.key}` })).status, 200);
  assert.deepEqual((await view())["tdx-austin-1"], ["key", op, free.keyId]);
  // et le reste, même si la clé de la machine bat de nouveau (prudence : la clé libre peut revenir)
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "tdx-austin-1", status: "running" }, auth: `Bearer ${machineKey}` })).status, 200);
  assert.deepEqual((await view())["tdx-austin-1"], ["key", op, free.keyId]);
  // la liste signée porte les mêmes champs
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
  assert.match(over.json.error, /limite de 10 clés/);
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
  assert.equal((await call("/operator/keys", { body: { label: "remplaçante", ...(await signIn(opC, { kind: "createKey" })) } })).status, 200);
});

test("machines : 20 par opérateur ; battements limités par clé ; retrait signé pour CETTE machine", async () => {
  const opD = privateKeyToAccount(generatePrivateKey());
  const k = (await call("/operator/keys", { body: { label: "cli", ...(await signIn(opD, { kind: "createKey" })) } })).json.key;
  for (let i = 0; i < 20; i++) {
    const r = await call("/machines/heartbeat", { body: { hostname: `hote-${i}`, status: "running" }, auth: `Bearer ${k}` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal((await call("/machines/heartbeat", { body: { hostname: "hote-20", status: "running" }, auth: `Bearer ${k}` })).status, 409);
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await call("/machines/heartbeat", { body: { hostname: "hote-0", status: "running" }, auth: `Bearer ${k}` })).status);
  assert.ok(codes.includes(429), "au-delà de 30 battements par minute et par clé : 429");
  const [m1, m2] = (await call(`/machines?operator=${opD.address}`)).json.map((x: any) => x.machineId);
  assert.equal((await call(`/machines/${m2}/remove`, { body: await signIn(opD, { kind: "removeMachine", machineId: m1 }) })).status, 400, "la signature nomme UNE machine");
  assert.equal((await call(`/machines/${m1}/remove`, { body: await signIn(opD, { kind: "removeMachine", machineId: m1 }) })).status, 200);
  assert.equal((await call(`/machines?operator=${opD.address}`)).json.length, 19);
});

test("erreurs : clés, machines et paramètres refusés portent chacun leur code", async () => {
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
  // une signature qui ne tient pas sur 11 lignes, une date illisible : « malformed_message » et la partie fautive
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

test("mode test : jeton exigé ; personal_sign limité aux connexions ArcHive (EIP-4361) de ce wallet, nonce valable", async () => {
  assert.equal((await rpcCall("eth_accounts", [], "")).status, 401);
  assert.equal((await rpcCall("eth_accounts", [], "Bearer " + "x".repeat(48))).status, 401);
  const info = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  assert.equal(info.json.address, testWallet.address);
  assert.equal(info.json.budget.dailyUsdc, "10");
  assert.equal((await call("/test-signer/info")).json.address, undefined);
  // le message du site, en hexadécimal comme l'envoie wagmi ; signé, puis accepté par l'API de bout en bout
  const okMsg = await siwe({ kind: "createKey" }, testWallet.address);
  const sig = await rpcCall("personal_sign", [toHex(okMsg), testWallet.address]);
  assert.ok(sig.json.result, JSON.stringify(sig.json));
  assert.equal(await recoverMessageAddress({ message: okMsg, signature: sig.json.result }), testWallet.address);
  const k = await call("/operator/keys", { body: { label: "mode test", address: testWallet.address, message: okMsg, signature: sig.json.result } });
  assert.equal(k.status, 200, JSON.stringify(k.json));
  const refused: Array<[string, string]> = [
    ["nonce déjà servi", okMsg],
    ["ancien format", ["ArcHive — Créer une clé opérateur", `Adresse : ${testWallet.address}`, `Horodatage : ${Date.now()}`].join("\n")],
    ["n'importe quoi", "ArcHive — n'importe quoi"],
    ["autre adresse", await siwe({ kind: "createKey" }, DEAD)],
    ["autre site", await siwe({ kind: "createKey" }, testWallet.address, { domain: "archive-airdrop.example", uri: "https://archive-airdrop.example" })],
    ["nonce inventé", await siwe({ kind: "createKey" }, testWallet.address, { nonce: { nonce: "f".repeat(32), issuedAt: new Date().toISOString() } })],
    ["phrase étrangère", await siwe({ kind: "createKey" }, testWallet.address, { edit: (m) => m.replace(/^ArcHive: .*$/m, "Transfer all my funds") })],
    ["ancienne phrase française", await siwe({ kind: "createKey" }, testWallet.address, { edit: (m) => m.replace(/^ArcHive: .*$/m, "ArcHive : creer une cle operateur (arcop_), qui ne peut rien depenser") })],
  ];
  for (const [what, text] of refused) {
    const r = await rpcCall("personal_sign", [text, testWallet.address]);
    assert.equal(r.json.error?.code, 4001, `${what} : ${JSON.stringify(r.json)}`);
  }
});

test("mode test : autorisations EIP-3009 bornées (destinataire, montant, type, chaîne, durée)", async () => {
  const ok = await signRwa();
  assert.ok(ok.json.result, JSON.stringify(ok.json));
  const td = rwa();
  const again = await rpcCall("eth_signTypedData_v4", [testWallet.address, JSON.stringify(td)]);
  const who = await recoverTypedDataAddress({ ...(td as any), types: { ReceiveWithAuthorization: td.types.ReceiveWithAuthorization }, message: { ...td.message, value: 1_000_000n, validAfter: 0n, validBefore: BigInt(td.message.validBefore) }, signature: again.json.result });
  assert.equal(who, testWallet.address, "ce qui est signé est bien ce qui a été vérifié");
  const refused = [
    signRwa({ value: "2500000" }), // > 2 USDC
    signRwa({ to: testnet.operatorBond }), // une caution bloque 7 jours
    signRwa({ to: DEAD }),
    signRwa({ primaryType: "TransferWithAuthorization" }),
    signRwa({ chainId: 1 }),
    signRwa({ from: DEAD }),
    signRwa({ validBefore: String(Math.floor(Date.now() / 1000) + 3 * 86400) }),
    signRwa({ valueType: "uint128" }),
  ];
  for (const r of await Promise.all(refused)) assert.equal(r.json.error?.code, 4001, JSON.stringify(r.json));
});

test("mode test : paiement x402 d'un appel, vers X402Settler du déploiement du SDK, au plus le plafond par signature, 1 h au plus", async () => {
  // l'autorisation telle que la signe le client x402 du SDK (x402.ts, authorize) : domaine USDC du déploiement, payTo =
  // X402Settler, montant exact de l'appel, validAfter 0, validité ≤ X402_MAX_VALIDITY_SECONDS, nonce = engagement sur la requête
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
    // comme wagmi/viem l'envoient à un wallet EIP-1193 : JSON, entiers en chaînes
    return { td, call: rpcCall("eth_signTypedData_v4", [testWallet.address, JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v))]) };
  };

  const one = x402(1_000_000n, BigInt(X402_MAX_VALIDITY_SECONDS));
  const ok = await one.call;
  assert.match(String(ok.json.result), /^0x[0-9a-f]{130}$/, JSON.stringify(ok.json));
  const who = await recoverTypedDataAddress({
    domain: one.td.domain, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message: one.td.message, signature: ok.json.result,
  });
  assert.equal(who, testWallet.address, "signée pour X402Settler, telle que l'USDC la vérifiera (receiveWithAuthorization)");
  assert.equal(eip3009SignatureProblem(ok.json.result), null, "signature canonique pour l'USDC (v = 27/28, s bas)");
  const line = logs.filter((l) => l.startsWith("mode test {")).map((l) => JSON.parse(l.slice("mode test ".length))).reverse()
    .find((e) => e.method === "eth_signTypedData_v4" && e.ok);
  assert.equal(line?.to, testnet.x402Settler.toLowerCase());
  assert.equal(line?.fn, "ReceiveWithAuthorization (x402)");
  assert.equal(line?.amount, "1");

  // plafond par signature (2 USDC par défaut) : juste au plafond, oui (budget du jour : 10) ; au-delà, refus
  const refused: Array<[string, { call: Promise<{ json: any }> }]> = [
    ["au-delà du plafond par signature", x402(2_000_001n, 600n)],
    ["validité au-delà d'1 h (client x402 du SDK)", x402(1_000_000n, BigInt(X402_MAX_VALIDITY_SECONDS) + 120n)],
    ["montant nul", x402(0n, 600n)],
  ];
  for (const [what, r] of refused) assert.equal((await r.call).json.error?.code, 4001, `${what} : ${JSON.stringify((await r.call).json)}`);

  // les adresses viennent du déploiement du SDK (testnet), jamais écrites dans le mode test
  const src = readFileSync(new URL("../src/testSigner.ts", import.meta.url), "utf8");
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(src), "aucune adresse codée en dur dans testSigner.ts");
  assert.match(src, /testnet\.x402Settler/);
});

test("mode test : transactions décodées, liste blanche, propriété lue on-chain, gaz fixé par le serveur", async () => {
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
    ["fund prime d'un tiers", send(testnet.sealedBounty, encodeFunctionData({ abi: tx, functionName: "fund", args: [2n, 1n, anAuth] }))],
    ["withdrawRemaining prime d'un tiers", send(testnet.sealedBounty, encodeFunctionData({ abi: tx, functionName: "withdrawRemaining", args: [2n] }))],
    ["gaz au-delà du plafond", send(testnet.sealedBounty, REOPEN_7)],
  ];
  for (const [what, p] of refusals) assert.equal((await p).json.error?.code, 4001, `${what} : ${JSON.stringify((await p).json)}`);
  assert.equal(sentRaw.length, 0, "aucune transaction refusée n'a atteint le RPC");

  const accepted: Array<[string, Hex, string]> = [
    ["openSession 1 USDC", openData(1_000_000n), testnet.sessionPay],
    ["topUp de sa session", encodeFunctionData({ abi: tx, functionName: "topUp", args: [1n, 500_000n, anAuth] }), testnet.sessionPay],
    ["fund de sa prime", encodeFunctionData({ abi: tx, functionName: "fund", args: [1n, 500_000n, anAuth] }), testnet.sealedBounty],
    ["withdrawRemaining de sa prime", encodeFunctionData({ abi: tx, functionName: "withdrawRemaining", args: [1n] }), testnet.sealedBounty],
    ["claim (chasseur)", encodeFunctionData({ abi: tx, functionName: "claim", args: [{ bountyId: 2n, payee: DEAD, blockN: 1n, blockHashN: ("0x" + "00".repeat(32)) as Hex, predicateHash: ("0x" + "00".repeat(32)) as Hex, loss: 1n, tier: 0, fingerprint: ("0x" + "00".repeat(32)) as Hex, cPHash: ("0x" + "00".repeat(32)) as Hex, deadline: 1n }, [], "0x"] }), testnet.sealedBounty],
  ];
  for (const [what, data, to] of accepted) {
    const r = await send(to, data);
    assert.match(String(r.json.result), /^0x[0-9a-f]{64}$/, `${what} : ${JSON.stringify(r.json)}`);
    const t = parseTransaction(sentRaw.at(-1)!);
    assert.equal(t.to?.toLowerCase(), to.toLowerCase());
    assert.equal(t.data, data);
    assert.equal(t.gas, 260_000n, `${what} : gaz = estimation × 1,2 + 20 000 (le gaz du client, 10 M, est ignoré)`);
  }
});

test("mode test : budget journalier de 10 USDC (autorisations + gaz), puis refus", async () => {
  const before = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  const spent0 = Number(before.json.budget.spentUsdc);
  assert.ok(spent0 >= 2, "les autorisations et le gaz déjà engagés sont comptés");
  let refusedAt = -1;
  for (let i = 0; i < 6; i++) {
    const r = await signRwa({ value: "2000000" });
    if (r.json.error) { assert.equal(r.json.error.code, 4001); assert.match(r.json.error.message, /budget du jour/); refusedAt = i; break; }
  }
  assert.ok(refusedAt >= 0, "le budget finit par refuser");
  const after = await call("/test-signer/info", { auth: `Bearer ${TOKEN}` });
  assert.ok(Number(after.json.budget.spentUsdc) <= 10);
  const saved = JSON.parse(readFileSync(join(dataDir, "test-signer-budget.json"), "utf8"));
  assert.equal(saved.spent, String(Math.round(Number(after.json.budget.spentUsdc) * 1e6)));
});

test("journal : une ligne par requête du mode test, jamais le jeton ; refus de jeton plafonnés", async () => {
  for (let i = 0; i < 10; i++) await rpcCall("eth_accounts", [], "Bearer faux-jeton-" + i);
  const refusals = logs.filter((l) => l.startsWith("mode test {") && l.includes("jeton absent ou invalide"));
  assert.ok(refusals.length <= 5, `au plus 5 lignes de refus de jeton par minute (vu : ${refusals.length})`);
  const lines = logs.filter((l) => l.startsWith("mode test {"));
  assert.ok(lines.length > 20);
  assert.ok(lines.every((l) => !l.includes(TOKEN)), "le jeton ne doit jamais être journalisé");
  const sendLine = lines.map((l) => JSON.parse(l.slice("mode test ".length))).find((e) => e.fn === "SessionPay.openSession" && e.ok);
  assert.ok(sendLine && sendLine.selector === "0x18cfa0a6" && sendLine.amount === "1" && sendLine.to === testnet.sessionPay.toLowerCase());
});

test("chaque erreur des routes opérateurs porte un code stable, sa phrase française et ses valeurs : le site et l'agent traduisent par le code", () => {
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
