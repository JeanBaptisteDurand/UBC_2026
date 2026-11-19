/**
 * indexer.ts — l'index des événements des contrats d'ArcHive, tenu par l'API elle-même.
 *
 * Pourquoi : l'API lisait les événements chez l'explorateur d'Arc (Blockscout). Quand il tombe (7/11 : délais
 * dépassés, erreurs 524), le site affichait des zéros et une chaîne de preuves trouée. L'index est maintenant :
 * - complété bloc par bloc par le RPC d'Arc (eth_getLogs par tranches de 5 000 blocs, avec reprise sur refus) ;
 * - enregistré sur disque (DATA_DIR) : un redémarrage ne relit que les blocs manquants ;
 * - jamais partiel : une tranche ratée n'avance pas le curseur, elle sera relue au prochain passage ;
 * - (9/11) refait de zéro si l'ensemble des événements connus change (empreinte de l'ABI : un événement ajouté, comme
 *   ceux de la v2.1, est alors lu aussi dans les blocs déjà parcourus) ou si le bloc de départ change.
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

/** Empreinte des événements décodés (nom, types, champs indexés) : un événement ajouté ou changé la modifie. */
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
  contracts: Record<string, Address>; // nom → adresse
  abi: Abi;
  fromBlock: bigint;
  file: string;
  chunk?: bigint;
  log?: (m: string) => void;
}

// JSON sûr : les bigint deviennent des chaînes, y compris dans les structures et tableaux (ex. la Claim de ClaimAccepted)
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
        // un index d'autres contrats (autre déploiement), d'autres événements ou d'un autre bloc de départ ne sert pas :
        // start over (also for a v1 file, which has no fingerprint)
        if (s.version === 2 && s.chainId === o.chainId && JSON.stringify(s.contracts) === JSON.stringify(fresh.contracts)
          && s.abi === fresh.abi && s.fromBlock === fresh.fromBlock && Array.isArray(s.events)) this.st = s;
      } catch { /* fichier abîmé : on reconstruit */ }
    }
  }

  /** Les événements indexés, du plus récent au plus ancien. */
  events(): Ev[] { return this.st.events; }

  status() {
    return {
      lastBlock: this.st.lastBlock, head: this.head, lagBlocks: this.head ? Math.max(0, this.head - this.st.lastBlock) : null, events: this.st.events.length,
      syncing: !!this.running, lastSyncAt: this.lastSyncAt || null, lastError: this.lastError, fromBlock: this.st.fromBlock,
    };
  }

  /** Complète l'index jusqu'à la tête si la dernière synchronisation date de plus de maxAgeMs (une seule à la fois). */
  sync(maxAgeMs = 10_000): Promise<void> {
    if (this.running) return this.running;
    if (Date.now() - this.lastSyncAt < maxAgeMs) return Promise.resolve();
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    const chunk = this.o.chunk ?? 5_000n;
    let head: bigint;
    try { head = await this.o.pub.getBlockNumber(); } catch (e) { this.lastError = `tête : ${(e as Error).message.slice(0, 120)}`; throw e; }
    this.head = Number(head);
    let from = BigInt(this.st.lastBlock + 1);
    const t0 = Date.now();
    let added = 0, chunks = 0;
    while (from <= head) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n;
      const logs = await this.getLogsWithRetry(from, to); // lève après plusieurs refus : le curseur n'avance pas
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
        } catch { /* événement hors de notre ABI */ }
      }
      if (evs.length) {
        evs.sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
        this.st.events = [...evs, ...this.st.events];
        added += evs.length;
      }
      this.st.lastBlock = Number(to);
      chunks++;
      if (chunks % 20 === 0) this.persist(); // longue reprise : on enregistre en route
      from = to + 1n;
    }
    this.persist();
    this.lastSyncAt = Date.now();
    this.lastError = null;
    if (chunks > 3) this.log(`index : ${chunks} tranches lues en ${Math.round((Date.now() - t0) / 1000)} s, +${added} événements, bloc ${this.st.lastBlock}`);
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
