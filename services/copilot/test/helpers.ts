/** helpers.ts — test tools: a fake LOCAL ArcHive API (127.0.0.1, free port) that serves the fixtures (real answers
 *  of the public API, public on-chain data), with a delay, a status or a raw body to choose. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { testnet, type ArcClient } from "@arcvault/sdk";

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): any => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

export const OWNER = "0x5724d89D610c3017b8DC161c025248341556f6Ab";

export interface Route { status?: number; body?: unknown; raw?: string; delayMs?: number }
export interface FakeApi {
  base: string;
  /** Requests received (path + query), in order. */
  urls: string[];
  hits: (path: string) => number;
  set: (path: string, r: Route) => void;
  close: () => Promise<void>;
}

export function defaultRoutes(): Record<string, Route> {
  return {
    "/enclaves": { body: fixture("enclaves.json") },
    "/bounties": { body: fixture("bounties.json") },
    "/products": { body: fixture("products.json") },
    "/activity": { body: fixture("activity.json") },
    "/index": { body: { lastBlock: 71389302, head: 71389302, lagBlocks: 0, events: 47, syncing: false, lastSyncAt: 1794151895611, lastError: null } },
    [`/sessions/${OWNER.toLowerCase()}`]: { body: [
      { id: "4", productId: "1", deposit: "1000000", paid: "54900", closed: true, enclave: "0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6", operator: "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a", price: "100", expiresAt: "1794149870", paidUnits: "549", verdictWritten: true },
      { id: "5", productId: "1", deposit: "2000000", paid: "0", closed: false, enclave: "0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6", operator: "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a", price: "100", expiresAt: "4102444800", paidUnits: "0", verdictWritten: false },
    ] },
    "/stats": { body: { enclaves: 5, enclavesActive: 2, products: 2, productsActive: 2, sessions: 4, settlements: 2, settledUsdc: "153900", refundedUsdc: "945100", x402Calls: 0, verdicts: 3, bounties: 2, bountyPool: "850000", bountiesPaid: 2, bountyPaidUsdc: "1000000", head: "71256237" } },
  };
}

export async function startFakeApi(routes: Record<string, Route> = defaultRoutes()): Promise<FakeApi> {
  const table = new Map(Object.entries(routes));
  const urls: string[] = [];
  const count = new Map<string, number>();
  const srv = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://fake");
    urls.push(u.pathname + u.search);
    count.set(u.pathname, (count.get(u.pathname) ?? 0) + 1);
    const r = table.get(u.pathname);
    const send = () => {
      if (!r) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"route inconnue"}'); return; }
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(r.raw ?? JSON.stringify(r.body));
    };
    if (r?.delayMs) setTimeout(send, r.delayMs); else send();
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    urls,
    hits: (p) => count.get(p) ?? 0,
    set: (p, r) => { table.set(p, r); },
    close: () => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); }),
  };
}

/** A fake Arc client: any SDK list (hence the Blockscout explorer) fails the test; the one-off on-chain reads return
 *  fixed values. */
export function fakeArc(): ArcClient {
  const forbidden = () => { throw new Error("SDK list called: the explorer must never be a source again"); };
  return {
    d: testnet,
    listEnclaves: forbidden, listBounties: forbidden, listProducts: forbidden, listMySessions: forbidden,
    pub: {
      getBlock: async () => ({ number: 71_389_302n, timestamp: 1_794_152_000n }),
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "networkBountyBps": return 1_000;
          case "operatorBountyBps": return 500;
          case "enclaveOf": return { signer: "0x0000000000000000000000000000000000000000" };
          case "UNBOND_DELAY": return 604_800n;
          case "WINDOW": return 86_400n;
          case "VALIDITY_BLOCKS": case "GRACE_BLOCKS": return 1_000n;
          case "BLOCK_TIME_MS": return 500n;
          default: throw new Error(`unexpected read: ${functionName}`);
        }
      },
    },
  } as unknown as ArcClient;
}
