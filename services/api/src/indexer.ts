/**
 * indexer.ts — the index of ArcHive's contract events, kept by the API itself.
 *
 * Why: the API used to read events from Arc's explorer (Blockscout). When the explorer went down (timeouts, 524
 * errors), the site showed zeros and a proof chain with holes. The index is now:
 * - filled block by block from Arc's RPC (eth_getLogs in chunks of 5,000 blocks, retried on refusal);
 * - saved to disk (DATA_DIR): a restart reads only the missing blocks;
 * - never partial: a failed chunk does not move the cursor, and it is read again on the next pass;
 * - rebuilt from zero if the set of known events changes (ABI fingerprint: an added event, such as the v2.1 ones,
 *   is then also read in the blocks already covered) or if the start block changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeEventLog, type Abi, type Address, type Hex, type PublicClient } from "viem";

export interface Ev {
  contract: string;
  name: string;
  args: Record<string, unknown>;
  block: number;
  logIndex: number;
  tx: string;
}

/** Index file format v2: adds the event-ABI fingerprint and the start block (a v1 file is rebuilt from scratch). */
interface State { version: 2; chainId: number; contracts: Record<string, string>; abi: string; fromBlock: number; lastBlock: number; events: Ev[] }

/** Fingerprint of the decoded events (name, types, indexed fields): an added or changed event changes it. */
export function abiFingerprint(abi: Abi): string {
  const evs = abi
    .filter((x): x is Extract<Abi[number], { type: "event" }> => x.type === "event")
    .map((x) => `${x.name}(${x.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""}`).join(",")})`)
    .sort();
  return createHash("sha256").update(evs.join(";")).digest("hex").slice(0, 16);
}

export interface IndexerOptions {
  pub: PublicClient;
  chainId: number;
  contracts: Record<string, Address>; // name → address
  abi: Abi;
  fromBlock: bigint;
  file: string;
  chunk?: bigint;
  log?: (m: string) => void;
}

// safe JSON: bigints become strings, including inside structs and arrays (e.g. ClaimAccepted's Claim)
const big = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString()
  : Array.isArray(v) ? v.map(big)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, big(x)]))
  : v;

export class EventIndexer {
  private st: State;
  private running: Promise<void> | null = null;
  private lastSyncAt = 0;
  private lastError: string | null = null;
  private head = 0;
  private byAddr: Map<string, string>;
  private log: (m: string) => void;

  constructor(private o: IndexerOptions) {
    this.log = o.log ?? ((m) => console.log(m));
    this.byAddr = new Map(Object.entries(o.contracts).map(([n, a]) => [a.toLowerCase(), n]));
    const fresh: State = {
      version: 2, chainId: o.chainId, contracts: Object.fromEntries(Object.entries(o.contracts).map(([n, a]) => [n, a.toLowerCase()])),
      abi: abiFingerprint(o.abi), fromBlock: Number(o.fromBlock), lastBlock: Number(o.fromBlock) - 1, events: [],
    };
    this.st = fresh;
    if (existsSync(o.file)) {
      try {
        const s = JSON.parse(readFileSync(o.file, "utf8")) as State;
        // an index of other contracts (another deployment), other events or another start block is of no use:
        // start over (also for a v1 file, which has no fingerprint)
        if (s.version === 2 && s.chainId === o.chainId && JSON.stringify(s.contracts) === JSON.stringify(fresh.contracts)
          && s.abi === fresh.abi && s.fromBlock === fresh.fromBlock && Array.isArray(s.events)) this.st = s;
      } catch { /* damaged file: rebuild */ }
    }
  }

  /** The indexed events, most recent first. */
  events(): Ev[] { return this.st.events; }

  status() {
    return {
      lastBlock: this.st.lastBlock, head: this.head, lagBlocks: this.head ? Math.max(0, this.head - this.st.lastBlock) : null, events: this.st.events.length,
      syncing: !!this.running, lastSyncAt: this.lastSyncAt || null, lastError: this.lastError, fromBlock: this.st.fromBlock,
    };
  }

  /** Fills the index up to the head if the last sync is older than maxAgeMs (one at a time). */
  sync(maxAgeMs = 10_000): Promise<void> {
    if (this.running) return this.running;
    if (Date.now() - this.lastSyncAt < maxAgeMs) return Promise.resolve();
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    const chunk = this.o.chunk ?? 5_000n;
    let head: bigint;
    try { head = await this.o.pub.getBlockNumber(); } catch (e) { this.lastError = `head: ${(e as Error).message.slice(0, 120)}`; throw e; }
    this.head = Number(head);
    let from = BigInt(this.st.lastBlock + 1);
    const t0 = Date.now();
    let added = 0, chunks = 0;
    while (from <= head) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n;
      const logs = await this.getLogsWithRetry(from, to); // throws after several refusals: the cursor does not move
      const evs: Ev[] = [];
      for (const l of logs) {
        try {
          const d = decodeEventLog({ abi: this.o.abi, data: l.data as Hex, topics: l.topics as any });
          evs.push({
            contract: this.byAddr.get(String(l.address).toLowerCase()) ?? String(l.address),
            name: String(d.eventName),
            args: Object.fromEntries(Object.entries((d.args ?? {}) as Record<string, unknown>).map(([k, v]) => [k, big(v)])),
            block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: String(l.transactionHash),
          });
        } catch { /* an event outside our ABI */ }
      }
      if (evs.length) {
        evs.sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
        this.st.events = [...evs, ...this.st.events];
        added += evs.length;
      }
      this.st.lastBlock = Number(to);
      chunks++;
      if (chunks % 20 === 0) this.persist(); // long catch-up: save along the way
      from = to + 1n;
    }
    this.persist();
    this.lastSyncAt = Date.now();
    this.lastError = null;
    if (chunks > 3) this.log(`index: ${chunks} chunks read in ${Math.round((Date.now() - t0) / 1000)} s, +${added} events, block ${this.st.lastBlock}`);
  }

  private async getLogsWithRetry(from: bigint, to: bigint) {
    let wait = 500;
    for (let i = 0; ; i++) {
      try {
        return await this.o.pub.getLogs({ address: Object.values(this.o.contracts), fromBlock: from, toBlock: to } as any);
      } catch (e) {
        if (i >= 6) { this.lastError = `getLogs ${from}–${to} : ${(e as Error).message.slice(0, 120)}`; throw e; }
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 8_000);
      }
    }
  }

  private persist() {
    mkdirSync(dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.st));
    renameSync(tmp, this.o.file);
  }
}
