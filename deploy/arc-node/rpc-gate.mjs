// rpc-gate.mjs — PASSERELLE PUBLIQUE vers notre nœud d'Arc (10/11/2026), sans dépendance (Node 22).
//
// Pourquoi : les RPC publics d'Arc ne servent eth_getProof qu'au dernier bloc (VERIFIED le 10/11) ; notre nœud
// (--rpc.eth-proof-window) sert les preuves d'état des blocs récents, pour le rejeu de la Prime scellée. Le nœud N'EST PAS
// de confiance : l'enclave vérifie chaque preuve contre le stateRoot de l'en-tête ancré. La passerelle ne protège donc
// que le NŒUD (abus, déni de service), pas l'intégrité : lectures seulement (liste fermée de méthodes), jamais debug /
// trace / txpool / envoi de transactions ; corps, lots, réponses et débit bornés.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8810);
const HOST = process.env.HOST ?? "0.0.0.0";
const UPSTREAM = process.env.UPSTREAM ?? "http://arc-execution:8545";
const MAX_BODY = 128 * 1024; // une preuve se demande en quelques centaines d'octets
const MAX_BATCH = 50;
const MAX_RESPONSE = 16 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const PER_IP = { rate: 30, burst: 60 }; // requêtes JSON-RPC par seconde (un lot compte pour ses éléments)
const GLOBAL = { rate: 200, burst: 400 };

const ALLOWED = new Set([
  "eth_getProof", "eth_getCode", "eth_getBalance", "eth_getStorageAt", "eth_getTransactionCount", "eth_getAccountInfo",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_blockNumber", "eth_chainId",
]);

/** Seau à jetons : `take(n)` vrai si n jetons sont disponibles. */
function bucket({ rate, burst }) {
  let tokens = burst, at = Date.now();
  return {
    take(n) {
      const now = Date.now();
      tokens = Math.min(burst, tokens + ((now - at) / 1000) * rate);
      at = now;
      if (tokens < n) return false;
      tokens -= n;
      return true;
    },
  };
}
const global = bucket(GLOBAL);
const perIp = new Map();
setInterval(() => { if (perIp.size > 10_000) perIp.clear(); }, 60_000).unref();

const json = (rs, status, body) => {
  rs.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  rs.end(JSON.stringify(body));
};
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function upstream(body) {
  const res = await fetch(UPSTREAM, {
    method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error("réponse trop grande"); }
    chunks.push(value);
  }
  return { status: res.status, text: Buffer.concat(chunks, size).toString("utf8") };
}

createServer((rq, rs) => {
  rs.on("error", () => undefined);
  if (rq.method === "GET" && (rq.url === "/health" || rq.url === "/")) {
    upstream(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, { jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] }]))
      .then(({ text }) => {
        const [b, c] = JSON.parse(text);
        json(rs, 200, { ok: true, block: b?.result ? Number(BigInt(b.result)) : null, chainId: c?.result ? Number(BigInt(c.result)) : null, methods: [...ALLOWED] });
      })
      .catch(() => json(rs, 503, { ok: false, error: "nœud indisponible" }));
    return;
  }
  if (rq.method !== "POST") return json(rs, 405, { error: "POST JSON-RPC seulement" });
  const chunks = [];
  let size = 0, tooBig = false;
  rq.on("data", (d) => { size += d.length; if (size > MAX_BODY) tooBig = true; else chunks.push(d); });
  rq.on("end", async () => {
    if (tooBig) return json(rs, 413, rpcErr(null, -32600, "requête trop grande"));
    let q;
    try { q = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(rs, 400, rpcErr(null, -32700, "JSON illisible")); }
    const items = Array.isArray(q) ? q : [q];
    if (items.length === 0 || items.length > MAX_BATCH) return json(rs, 400, rpcErr(null, -32600, `lot de 1 à ${MAX_BATCH} requêtes`));
    for (const it of items) {
      if (!it || typeof it !== "object" || typeof it.method !== "string" || (it.params !== undefined && !Array.isArray(it.params))) {
        return json(rs, 400, rpcErr(it?.id, -32600, "requête JSON-RPC mal formée"));
      }
      if (!ALLOWED.has(it.method)) return json(rs, 200, Array.isArray(q) ? items.map((x) => rpcErr(x?.id, -32601, "méthode non servie par la passerelle (lectures seulement)")) : rpcErr(it.id, -32601, "méthode non servie par la passerelle (lectures seulement)"));
    }
    // Caddy remplace X-Forwarded-For par l'IP réelle de la connexion (aucun proxy de confiance déclaré)
    const ip = String(rq.headers["x-forwarded-for"] ?? rq.socket.remoteAddress ?? "?").split(",")[0].trim();
    let b = perIp.get(ip);
    if (!b) { b = bucket(PER_IP); perIp.set(ip, b); }
    if (!b.take(items.length) || !global.take(items.length)) return json(rs, 429, rpcErr(null, -32005, "trop de requêtes (passerelle)"));
    try {
      const { status, text } = await upstream(JSON.stringify(q));
      rs.writeHead(status === 200 ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
      rs.end(status === 200 ? text : JSON.stringify(rpcErr(null, -32603, "nœud en erreur")));
    } catch {
      json(rs, 502, rpcErr(null, -32603, "nœud indisponible"));
    }
  });
}).listen(PORT, HOST, () => console.log(`passerelle RPC d'Arc : ${HOST}:${PORT} → ${UPSTREAM} (lectures seulement)`));
