/**
 * dstack.ts — client of the dstack guest agent (Phala), to obtain a REAL TDX quote inside the VM.
 * Outside a VM (no dstack socket), createDstackClient returns null and the kit falls back to the mock quote.
 * Dynamic import: the kit runs even without the library (local development).
 */
import { toBytes, type Hex } from "viem";
import type { DstackClient } from "./quote";

function asBytes(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (typeof x === "string") return toBytes((x.startsWith("0x") ? x : `0x${x}`) as Hex);
  if (Array.isArray(x)) return Uint8Array.from(x as number[]);
  return new Uint8Array();
}

/** Returns a dstack client inside a TDX VM with the guest agent, otherwise null. */
export async function createDstackClient(): Promise<DstackClient | null> {
  try {
    const mod: any = await import("@phala/dstack-sdk");
    const Ctor = mod.DstackClient ?? mod.TappdClient;
    if (!Ctor) return null;
    const client = new Ctor();
    return {
      async getQuote(reportData: Uint8Array) {
        // the API exposes getQuote (dstack) or tdxQuote (tappd), depending on the version
        const call = client.getQuote ?? client.tdxQuote;
        const r = await call.call(client, reportData);
        return { quote: asBytes(r.quote ?? r), eventLog: asBytes(r.event_log ?? r.eventLog ?? "0x") };
      },
    };
  } catch {
    return null;
  }
}
