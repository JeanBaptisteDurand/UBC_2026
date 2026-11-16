/**
 * operator-flow.ts — test de bout en bout de l'arrivée d'une machine, contre l'API seule (aucune transaction) :
 *  machine : /pair/start (code HIVE-XXXX-XXXX) → site : le code est trouvé, le nom de la machine reste masqué →
 *  humain : signe l'approbation (message EIP-4361 « Sign-In with Ethereum » : nonce neuf de GET /auth/nonce, domaine et
 *  URI du site) → le nom de la machine lui est révélé, à lui seul → machine : /pair/poll (clé arcop_ une seule fois, avec
 *  l'adresse complète de l'approbateur) → battement de cœur → vue publique (ni nom ni journaux), clé de la machine et
 *  lecture signée (tout) → clé opérateur créée, listée, révoquée → machine retirée → les clés mortes sont refusées.
 * Les messages sont ceux du site (web/src/signin.ts) ; domaine, URI et réseau sont ceux que l'API annonce (GET /auth/nonce).
 * Wallet : jetable par défaut (une signature d'opérateur ne coûte rien et n'envoie aucune transaction) ;
 *  OPERATOR_KEY_FILE=<fichier JSON avec privateKey> pour signer avec un compte choisi.
 * Usage : API=http://localhost:8895 npx tsx scripts/operator-flow.ts
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { buildSignIn, type SignedAction } from "../../../web/src/signin";

const API = (process.env.API ?? "http://localhost:8895").replace(/\/$/, "");
const KEY_FILE = process.env.OPERATOR_KEY_FILE;
const acct = privateKeyToAccount(KEY_FILE ? (JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey as Hex) : generatePrivateKey());
/** les codes d'appairage : 8 signes de l'alphabet sans I, L, O, 0, 1 */
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
/** un nonce neuf de l'API, puis le message EIP-4361 du site pour cette action, signé par le wallet */
const signed = async (action: SignedAction) => {
  const n = await get("/auth/nonce");
  if (n.status === 404) throw new Error(`${API} n'a pas GET /auth/nonce : API antérieure aux signatures EIP-4361, à mettre à jour`);
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
ok(look.status === 200 && look.j.hostnameHidden === true && !JSON.stringify(look.j).includes(HOST), "GET /pair/:code → le code existe ; le nom de la machine reste masqué avant la signature");

const bad = await post("/pair/approve", { userCode: s.j.userCode, ...(await signed({ kind: "pair", code: "HIVE-ZZZZ-ZZZZ" })) });
ok(bad.status === 400, "approbation refusée si le code signé ne correspond pas");
const approval = { userCode: s.j.userCode, ...(await signed({ kind: "pair", code: s.j.userCode })) };
const ap = await post("/pair/approve", approval);
ok(ap.status === 200 && !!ap.j.machineId && ap.j.hostname === HOST, `pair/approve signé → machine ${ap.j.machineId}, nom révélé après la signature (« ${ap.j.hostname} »)`);
ok((await post("/pair/approve", approval)).status === 409, "la même signature rejouée : refusée (nonce à usage unique)");

const p1 = await post("/pair/poll", { deviceCode: s.j.deviceCode });
ok(p1.j.status === "approved" && /^arcop_[0-9a-f]{8}_/.test(p1.j.key) && p1.j.operator === acct.address.toLowerCase(), "pair/poll → clé arcop_ délivrée, avec l'adresse complète de l'approbateur");
ok((await post("/pair/poll", { deviceCode: s.j.deviceCode })).j.status === "consumed", "la clé ne sort qu'une fois");

const hb = await post("/machines/heartbeat", {
  hostname: HOST, version: "0.1.0", mode: "demo", productId: 1, enclaveUrl: "http://127.0.0.1:8802", status: "running",
  doctor: { ok: false, checks: [{ id: "docker", label: "Docker", ok: true, detail: "ok" }, { id: "tdx_guest", label: "VM Intel TDX", ok: false, detail: "absent (mode démo)" }] },
  logs: ["[enclave] démarrage", "[enclave] /health ok"],
}, { authorization: `Bearer ${p1.j.key}` });
ok(hb.status === 200 && hb.j.machineId === ap.j.machineId, "heartbeat authentifié, rattaché à la bonne machine");
ok((await post("/machines/heartbeat", {}, { authorization: "Bearer arcop_deadbeef_nope" })).status === 401, "heartbeat refusé sans clé valide");

const list = await get(`/machines?operator=${acct.address}`);
const seen = Array.isArray(list.j) ? list.j.find((m: any) => m.machineId === ap.j.machineId) : undefined;
ok(!!seen && seen.online === true && seen.failing.includes("tdx_guest") && seen.hostnameHidden === true && seen.logs === undefined, "GET /machines → en ligne, check en échec visible ; nom et journaux masqués");
const anon = await get(`/machines/${ap.j.machineId}`);
ok(anon.status === 200 && anon.j.logs === undefined && anon.j.doctor === undefined, "GET /machines/:id sans clé → vue publique (ni journaux ni diagnostic)");
const own = await get(`/machines/${ap.j.machineId}`, { authorization: `Bearer ${p1.j.key}` });
ok(own.j.logs?.length === 2 && own.j.doctor?.checks?.length === 2 && own.j.hostname === HOST, "GET /machines/:id avec la clé de la machine → diagnostic + journaux");
const read = await signed({ kind: "read" });
const detail = await post(`/machines/${ap.j.machineId}/detail`, read);
ok(detail.status === 200 && detail.j.logs?.length === 2 && detail.j.doctor?.checks?.length === 2, "lecture signée (10 min) → diagnostic + journaux");
const full = await post("/machines/list", read);
ok(full.status === 200 && Array.isArray(full.j) && full.j.some((m: any) => m.machineId === ap.j.machineId && m.hostname === HOST), "la même lecture, resservie → liste avec les vrais noms");

const k = await post("/operator/keys", { label: "CLI portable", ...(await signed({ kind: "createKey" })) });
ok(k.status === 200 && /^arcop_/.test(k.j.key), `clé opérateur créée (${k.j.masked})`);
const keys = await get(`/operator/keys?address=${acct.address}`);
ok(Array.isArray(keys.j) && keys.j.some((x: any) => x.keyId === k.j.keyId) && keys.j.every((x: any) => !("hash" in x) && x.restricted === true), "liste publique des clés : sans empreinte, libellés masqués");
const named = await post("/operator/keys/list", read);
ok(named.status === 200 && Array.isArray(named.j) && named.j.some((x: any) => x.keyId === k.j.keyId && x.label === "CLI portable"), "liste signée des clés : vrais libellés");
const rv = await post(`/operator/keys/${k.j.keyId}/revoke`, await signed({ kind: "revokeKey", keyId: k.j.keyId }));
ok(rv.status === 200, "clé révoquée (signature wallet)");
ok((await post("/machines/heartbeat", { hostname: "x" }, { authorization: `Bearer ${k.j.key}` })).status === 401, "la clé révoquée est refusée");

const rm = await post(`/machines/${ap.j.machineId}/remove`, await signed({ kind: "removeMachine", machineId: ap.j.machineId }));
ok(rm.status === 200, "machine retirée");
ok((await post("/machines/heartbeat", { hostname: HOST }, { authorization: `Bearer ${p1.j.key}` })).status === 401, "la clé de la machine retirée meurt avec elle");

console.log(fails === 0 ? "\nTOUT PASSE" : `\n${fails} ÉCHEC(S)`);
process.exit(fails ? 1 : 0);
