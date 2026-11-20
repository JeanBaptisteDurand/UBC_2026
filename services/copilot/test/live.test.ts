/** live.test.ts — one REAL read of each copilot list tool against the live API (ARCHIVE_API, default
 *  https://archive.62-171-153-35.sslip.io/api) and Arc's public RPC (reads only: no transaction, no model called). Every
 *  URL contacted is recorded: the explorer must never be among them.
 *  Run: cd services/copilot && LIVE=1 npx tsx --test test/live.test.ts   (without LIVE=1: skipped) */
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { arcTestnet, createArcClient } from "@arcvault/sdk";
import { executeTool, type ToolCtx } from "../src/tools";
import { archiveBase } from "../src/archive-api";
import { OWNER } from "./helpers";

const LIVE = process.env.LIVE === "1";
const skip = LIVE ? false : "LIVE=1 to call the live API";

const contacted: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  contacted.push(typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url));
  return realFetch(input, init);
}) as typeof fetch;

const ctx: ToolCtx = {
  arc: createArcClient({ publicClient: createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 400 }) }) as any }),
  user: OWNER as `0x${string}`,
};

async function tool(name: string, input: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const { result } = await executeTool(name, input, ctx);
  const ms = Date.now() - t0;
  console.log(`  ${name} ${JSON.stringify(input)} → ${ms} ms : ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 220)}…`);
  return { r: result as any, ms };
}

test("outils de liste du copilote contre l'API en ligne", { skip }, async () => {
  const api = archiveBase();
  const e = await tool("enclaves_list");
  assert.ok(e.r.total > 0 && Array.isArray(e.r.enclaves));
  assert.match(e.r.liste.source, /index d'événements de l'API ArcHive/);
  assert.equal(typeof e.r.liste.indexAJourAuBloc, "number");
  const p = await tool("products_list");
  assert.ok(p.r.produits.length > 0);
  const b = await tool("bounty_list");
  assert.ok(b.r.total >= 0 && Array.isArray(b.r.primes));
  const s = await tool("sessions_list", { owner: OWNER });
  assert.ok(s.r.total > 0, "the demo account has sessions");
  const a = await tool("activity_list", { limit: 5 });
  assert.equal(a.r.nombre, 5);
  for (const page of ["ruche", "produits", "vue"]) {
    const n = await tool("ui_navigate", { page });
    assert.ok(n.r.donneesReelles && !n.r.donneesReelles.indisponible, `${page} : ${JSON.stringify(n.r.donneesReelles)}`);
  }
  for (const x of [e, p, s, a]) assert.ok(x.ms < 8_500, "each list fits in the 8 s timeout");
  const hosts = [...new Set(contacted.map((u) => new URL(u).host))];
  console.log("  hosts contacted:", hosts.join(", "));
  assert.ok(contacted.some((u) => u.startsWith(api)), "the index API served the lists");
  assert.ok(contacted.every((u) => !/explorer|blockscout/i.test(u)), "the explorer is never contacted");
});
