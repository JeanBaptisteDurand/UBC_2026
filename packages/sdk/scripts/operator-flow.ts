/**
 * operator-flow.ts — an end-to-end test of a machine's arrival, against the API alone (no transaction):
 *  machine: /pair/start (code HIVE-XXXX-XXXX) → site: the code is found, the machine's name stays hidden →
 *  person: signs the approval (an EIP-4361 "Sign-In with Ethereum" message: a fresh nonce from GET /auth/nonce, the
 *  site's domain and URI) → the machine's name is revealed to them alone → machine: /pair/poll (the arcop_ key once, with
 *  the approver's full address) → heartbeat → public view (no name, no logs), the machine's key and a signed read
 *  (everything) → an operator key created, listed, revoked → machine removed → dead keys are refused.
 * The messages are the site's (web/src/signin.ts); domain, URI and network are the ones the API announces (GET /auth/nonce).
 * Wallet: throwaway by default (an operator signature costs nothing and sends no transaction);
 *  OPERATOR_KEY_FILE=<a JSON file with privateKey> to sign with a chosen account.
 * Usage: API=http://localhost:8895 npx tsx scripts/operator-flow.ts
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { buildSignIn, type SignedAction } from "../../../web/src/signin";

const API = (process.env.API ?? "http://localhost:8895").replace(/\/$/, "");
const KEY_FILE = process.env.OPERATOR_KEY_FILE;
const acct = privateKeyToAccount(KEY_FILE ? (JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey as Hex) : generatePrivateKey());
/** pairing codes: 8 characters from the alphabet without I, L, O, 0, 1 */
const CODE_RE = /^HIVE-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const HOST = `test-mac-${randomBytes(3).toString("hex")}`;

const post = async (p: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(API + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
};
const get = async (p: string, headers: Record<string, string> = {}) => {
  const r = await fetch(API + p, { headers });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
};
/** a fresh nonce from the API, then the site's EIP-4361 message for this action, signed by the wallet */
const signed = async (action: SignedAction) => {
  const n = await get("/auth/nonce");
  if (n.status === 404) throw new Error(`${API} has no GET /auth/nonce: an API older than the EIP-4361 signatures, to update`);
  if (n.status !== 200) throw new Error(`GET /auth/nonce → ${n.status} ${JSON.stringify(n.j)}`);
  const { message } = buildSignIn({
    domain: n.j.domain, uri: n.j.uri, chainId: n.j.chainId, address: acct.address, action, nonce: n.j.nonce, issuedAt: n.j.issuedAt,
  });
  return { address: acct.address, message, signature: await acct.signMessage({ message }) };
};
let fails = 0;
const ok = (cond: boolean, label: string) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails++; };

console.log(`API ${API} · wallet ${acct.address}${KEY_FILE ? "" : " (jetable)"}\n`);

const s = await post("/pair/start", { hostname: HOST, mode: "demo", version: "0.1.0" });
ok(s.status === 200 && CODE_RE.test(s.j.userCode), `pair/start → ${s.j.userCode}`);
ok((await post("/pair/poll", { deviceCode: s.j.deviceCode })).j.status === "pending", "pair/poll → pending avant approbation");
const look = await get(`/pair/${s.j.userCode}`);
ok(look.status === 200 && look.j.hostnameHidden === true && !JSON.stringify(look.j).includes(HOST), "GET /pair/:code → the code exists; the machine's name stays hidden before the signature");

const bad = await post("/pair/approve", { userCode: s.j.userCode, ...(await signed({ kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) });
ok(bad.status === 400, "approval refused if the signed code does not match");
const approval = { userCode: s.j.userCode, ...(await signed({ kind: "pair", code: s.j.userCode })) };
const ap = await post("/pair/approve", approval);
ok(ap.status === 200 && !!ap.j.machineId && ap.j.hostname === HOST, `signed pair/approve → machine ${ap.j.machineId}, name revealed after the signature ("${ap.j.hostname}")`);
ok((await post("/pair/approve", approval)).status === 409, "the same signature replayed: refused (single-use nonce)");

const p1 = await post("/pair/poll", { deviceCode: s.j.deviceCode });
ok(p1.j.status === "approved" && /^arcop_[0-9a-f]{8}_/.test(p1.j.key) && p1.j.operator === acct.address.toLowerCase(), "pair/poll → arcop_ key handed over, with the approver's full address");
ok((await post("/pair/poll", { deviceCode: s.j.deviceCode })).j.status === "consumed", "the key leaves only once");

const hb = await post("/machines/heartbeat", {
  hostname: HOST, version: "0.1.0", mode: "demo", productId: 1, enclaveUrl: "http://127.0.0.1:8802", status: "running",
  doctor: { ok: false, checks: [{ id: "docker", label: "Docker", ok: true, detail: "ok" }, { id: "tdx_guest", label: "VM Intel TDX", ok: false, detail: "missing (demo mode)" }] },
  logs: ["[enclave] starting", "[enclave] /health ok"],
}, { authorization: `Bearer ${p1.j.key}` });
ok(hb.status === 200 && hb.j.machineId === ap.j.machineId, "authenticated heartbeat, tied to the right machine");
ok((await post("/machines/heartbeat", {}, { authorization: "Bearer arcop_deadbeef_nope" })).status === 401, "heartbeat refused without a valid key");

const list = await get(`/machines?operator=${acct.address}`);
const seen = Array.isArray(list.j) ? list.j.find((m: any) => m.machineId === ap.j.machineId) : undefined;
ok(!!seen && seen.online === true && seen.failing.includes("tdx_guest") && seen.hostnameHidden === true && seen.logs === undefined, "GET /machines → online, failing check visible; name and logs hidden");
const anon = await get(`/machines/${ap.j.machineId}`);
ok(anon.status === 200 && anon.j.logs === undefined && anon.j.doctor === undefined, "GET /machines/:id without a key → public view (no logs, no diagnosis)");
const own = await get(`/machines/${ap.j.machineId}`, { authorization: `Bearer ${p1.j.key}` });
ok(own.j.logs?.length === 2 && own.j.doctor?.checks?.length === 2 && own.j.hostname === HOST, "GET /machines/:id with the machine's key → diagnosis + logs");
const read = await signed({ kind: "read" });
const detail = await post(`/machines/${ap.j.machineId}/detail`, read);
ok(detail.status === 200 && detail.j.logs?.length === 2 && detail.j.doctor?.checks?.length === 2, "signed read (10 min) → diagnosis + logs");
const full = await post("/machines/list", read);
ok(full.status === 200 && Array.isArray(full.j) && full.j.some((m: any) => m.machineId === ap.j.machineId && m.hostname === HOST), "the same read, reused → list with the real names");

const k = await post("/operator/keys", { label: "laptop CLI", ...(await signed({ kind: "createKey" })) });
ok(k.status === 200 && /^arcop_/.test(k.j.key), `operator key created (${k.j.masked})`);
const keys = await get(`/operator/keys?address=${acct.address}`);
ok(Array.isArray(keys.j) && keys.j.some((x: any) => x.keyId === k.j.keyId) && keys.j.every((x: any) => !("hash" in x) && x.restricted === true), "public key list: no hash, labels hidden");
const named = await post("/operator/keys/list", read);
ok(named.status === 200 && Array.isArray(named.j) && named.j.some((x: any) => x.keyId === k.j.keyId && x.label === "laptop CLI"), "signed key list: real labels");
const rv = await post(`/operator/keys/${k.j.keyId}/revoke`, await signed({ kind: "revokeKey", keyId: k.j.keyId }));
ok(rv.status === 200, "key revoked (wallet signature)");
ok((await post("/machines/heartbeat", { hostname: "x" }, { authorization: `Bearer ${k.j.key}` })).status === 401, "the revoked key is refused");

const rm = await post(`/machines/${ap.j.machineId}/remove`, await signed({ kind: "removeMachine", machineId: ap.j.machineId }));
ok(rm.status === 200, "machine removed");
ok((await post("/machines/heartbeat", { hostname: HOST }, { authorization: `Bearer ${p1.j.key}` })).status === 401, "the removed machine's key dies with it");

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
