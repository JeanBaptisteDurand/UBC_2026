/** mock-api.ts — a test double of the ArcHive API (pairing, pairing rejection, heartbeats). Its refusals have the shape
 *  of the real API's: { error (text), code (stable), params? }. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockOptions {
  /** successive answers of /pair/poll (the last one repeats); 404 = unknown request */
  poll?: (string | 404)[];
  /** /pair/start answers 404 (an API not updated yet) */
  startMissing?: boolean;
  /** /pair/start refuses with this API error (status and body { error, code, params }) */
  startError?: { status: number; body: unknown };
  /** /machines/heartbeat answers 401 */
  rejectKey?: boolean;
  key?: string;
  /** the account that "approves" the code (returned by /pair/poll); null: none */
  operator?: string | null;
}

export interface MockApi {
  url: string;
  heartbeats: any[];
  /** demandes de code (POST /pair/start) */
  starts: number;
  polls: number;
  /** Authorization headers received by POST /pair/reject (the machine refused the pairing) */
  rejects: string[];
  close(): Promise<void>;
}

export const TEST_KEY = "arcop_1a2b3c4d_AbCdEfGhIjKlMnOpQrStUvWxYz012345";
export const TEST_OPERATOR = "0xabc0000000000000000000000000000000000def";
export const TEST_CODE = "HIVE-7K2P-QX9M";

export async function startMockApi(o: MockOptions = {}): Promise<MockApi> {
  const state: MockApi = { url: "", heartbeats: [], starts: 0, polls: 0, rejects: [], close: async () => undefined };
  const key = o.key ?? TEST_KEY;
  const operator = o.operator === undefined ? TEST_OPERATOR : o.operator;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (status: number, j: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(j));
      };
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, chainId: 5042002 });
      if (req.method === "POST" && req.url === "/pair/start") {
        state.starts++;
        if (o.startMissing) return send(404, { error: "Not Found" });
        if (o.startError) return send(o.startError.status, o.startError.body);
        return send(200, { deviceCode: "dev-123", userCode: TEST_CODE, verifyUrl: `http://site.test/#/operator?code=${TEST_CODE}`, expiresIn: 60, interval: 1 });
      }
      if (req.method === "POST" && req.url === "/pair/poll") {
        const seq = o.poll ?? ["approved"];
        const st = seq[Math.min(state.polls, seq.length - 1)]!;
        state.polls++;
        if (st === 404) return send(404, { error: "deviceCode inconnu", code: "device_code_unknown" });
        if (st === "approved") return send(200, { status: "approved", key, machineId: "m-0001", ...(operator ? { operator } : {}) });
        return send(200, { status: st });
      }
      if (req.method === "POST" && req.url === "/pair/reject") {
        state.rejects.push(String(req.headers.authorization ?? ""));
        if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "clé opérateur inconnue ou révoquée", code: "key_unknown_or_revoked" });
        return send(200, { ok: true });
      }
      if (req.method === "POST" && req.url === "/machines/heartbeat") {
        if (o.rejectKey || req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "clé opérateur inconnue ou révoquée", code: "key_unknown_or_revoked" });
        state.heartbeats.push(body);
        return send(200, { ok: true, machineId: "m-0001", operator: operator ?? TEST_OPERATOR, next: { registered: false } });
      }
      send(404, { error: "Not Found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((r) => server.close(() => r()));
  return state;
}

// direct run (manual testing): tsx test/mock-api.ts [approved|expired|consumed|start404]
if (process.argv[1]?.endsWith("mock-api.ts")) {
  const scenario = process.argv[2] ?? "approved";
  const api = await startMockApi(
    scenario === "start404" ? { startMissing: true } : { poll: ["pending", "pending", scenario as string] },
  );
  console.log(api.url);
}
