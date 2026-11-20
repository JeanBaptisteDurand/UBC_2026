// rpc-gate.mjs — PUBLIC GATEWAY to the optional Arc node (deploy/arc-node), no dependency (Node 22).
//
// Why: Arc's public RPCs serve eth_getProof only at the latest block (checked on 15 Nov 2026); the node
// (--rpc.eth-proof-window) serves state proofs for recent blocks, for the Sealed Bounty's replay. The node is NOT
// trusted: the enclave checks every proof against the stateRoot of the anchored header. So the gateway protects only
// the NODE (abuse, denial of service), not integrity: reads only (closed list of methods), never debug / trace /
// txpool / sending transactions; bodies, batches, responses and rate are bounded.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8810);
const HOST = process.env.HOST ?? "0.0.0.0";
const UPSTREAM = process.env.UPSTREAM ?? "http://arc-execution:8545";
const MAX_BODY = 128 * 1024; // a proof request takes a few hundred bytes
const MAX_BATCH = 50;
const MAX_RESPONSE = 16 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const PER_IP = { rate: 30, burst: 60 }; // JSON-RPC requests per second (a batch counts for its items)
const GLOBAL = { rate: 200, burst: 400 };

const ALLOWED = new Set([
  "eth_getProof", "eth_getCode", "eth_getBalance", "eth_getStorageAt", "eth_getTransactionCount", "eth_getAccountInfo",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_blockNumber", "eth_chainId",
]);

/** Token bucket: `take(n)` is true if n tokens are available. */
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
    if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error("response too large"); }
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
      .catch(() => json(rs, 503, { ok: false, error: "node unavailable" }));
    return;
  }
  if (rq.method !== "POST") return json(rs, 405, { error: "JSON-RPC over POST only" });
  const chunks = [];
  let size = 0, tooBig = false;
  rq.on("data", (d) => { size += d.length; if (size > MAX_BODY) tooBig = true; else chunks.push(d); });
  rq.on("end", async () => {
    if (tooBig) return json(rs, 413, rpcErr(null, -32600, "request too large"));
    let q;
    try { q = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(rs, 400, rpcErr(null, -32700, "unreadable JSON")); }
    const items = Array.isArray(q) ? q : [q];
    if (items.length === 0 || items.length > MAX_BATCH) return json(rs, 400, rpcErr(null, -32600, `batch of 1 to ${MAX_BATCH} requests`));
    for (const it of items) {
      if (!it || typeof it !== "object" || typeof it.method !== "string" || (it.params !== undefined && !Array.isArray(it.params))) {
        return json(rs, 400, rpcErr(it?.id, -32600, "malformed JSON-RPC request"));
      }
      if (!ALLOWED.has(it.method)) return json(rs, 200, Array.isArray(q) ? items.map((x) => rpcErr(x?.id, -32601, "method not served by the gateway (reads only)")) : rpcErr(it.id, -32601, "method not served by the gateway (reads only)"));
    }
    // Caddy replaces X-Forwarded-For with the connection's real IP (no trusted proxy declared)
    const ip = String(rq.headers["x-forwarded-for"] ?? rq.socket.remoteAddress ?? "?").split(",")[0].trim();
    let b = perIp.get(ip);
    if (!b) { b = bucket(PER_IP); perIp.set(ip, b); }
    if (!b.take(items.length) || !global.take(items.length)) return json(rs, 429, rpcErr(null, -32005, "too many requests (gateway)"));
    try {
      const { status, text } = await upstream(JSON.stringify(q));
      rs.writeHead(status === 200 ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
      rs.end(status === 200 ? text : JSON.stringify(rpcErr(null, -32603, "node error")));
    } catch {
      json(rs, 502, rpcErr(null, -32603, "node unavailable"));
    }
  });
}).listen(PORT, HOST, () => console.log(`Arc RPC gateway: ${HOST}:${PORT} → ${UPSTREAM} (reads only)`));
