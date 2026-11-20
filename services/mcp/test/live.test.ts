/** live.test.ts — one REAL read call of each MCP list tool against the live API (ARCHIVE_API, default
 *  https://archive.62-171-153-35.sslip.io/api) and Arc's public RPC (reads only, no transaction). Every URL contacted
 *  is recorded: the explorer must never be one of them. Not part of `npm test`.
 *  Run: cd services/mcp && LIVE=1 npx tsx --test test/live.test.ts   (without LIVE=1: skipped) */
import test from "node:test";
import assert from "node:assert/strict";
import { callTool, createMcpContext } from "../src/tools";

const LIVE = process.env.LIVE === "1";
const skip = LIVE ? false : "LIVE=1 to call the live API";
const OWNER = "0x5724d89D610c3017b8DC161c025248341556f6Ab";

const contacted: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  contacted.push(typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url));
  return realFetch(input, init);
}) as typeof fetch;

test("the MCP server's list tools against the live API", { skip }, async () => {
  const { arc, actx } = createMcpContext();
  for (const [name, args] of [["arc_products", {}], ["arc_enclaves", {}], ["arc_bounties", {}], ["arc_sessions", { owner: OWNER }], ["arc_activity", { limit: 5 }]] as const) {
    const t0 = Date.now();
    const out = await callTool(arc, actx, name, args);
    const text = out.content[0]!.text;
    console.log(`  ${name} → ${Date.now() - t0} ms : ${text.replace(/\s+/g, " ").slice(0, 200)}…`);
    assert.ok(!out.isError, `${name} : ${text}`);
    const j = JSON.parse(text);
    if (name !== "arc_products") assert.match(j.liste.source, /index d'événements de l'API ArcHive/);
  }
  console.log("  hosts contacted:", [...new Set(contacted.map((u) => new URL(u).host))].join(", "));
  assert.ok(contacted.every((u) => !/explorer|blockscout/i.test(u)), "the explorer is never contacted");
});
