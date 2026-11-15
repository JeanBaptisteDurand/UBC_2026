/**
 * dstack.ts — client de l'agent invité dstack (Phala) pour obtenir un VRAI quote TDX dans la VM.
 * Hors VM (pas de socket dstack), createDstackClient rend null et le kit retombe sur le quote mock.
 * Import dynamique : le kit tourne même sans la lib (dev local).
 */
import { toBytes, type Hex } from "viem";
import type { DstackClient } from "./quote";

function asBytes(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (typeof x === "string") return toBytes((x.startsWith("0x") ? x : `0x${x}`) as Hex);
  if (Array.isArray(x)) return Uint8Array.from(x as number[]);
  return new Uint8Array();
}

/** Rend un client dstack si on est dans une VM TDX avec l'agent invité, sinon null. */
export async function createDstackClient(): Promise<DstackClient | null> {
  try {
    const mod: any = await import("@phala/dstack-sdk");
    const Ctor = mod.DstackClient ?? mod.TappdClient;
    if (!Ctor) return null;
    const client = new Ctor();
    return {
      async getQuote(reportData: Uint8Array) {
        // l'API expose getQuote (dstack) ou tdxQuote (tappd) selon la version
        const call = client.getQuote ?? client.tdxQuote;
        const r = await call.call(client, reportData);
        return { quote: asBytes(r.quote ?? r), eventLog: asBytes(r.event_log ?? r.eventLog ?? "0x") };
      },
    };
  } catch {
    return null;
  }
}
