/**
 * quote.ts — obtaining a TDX quote.
 *
 * In a real Intel TDX VM (Phala dstack), the kit calls the guest agent's `GetQuote` on the local socket with its 64
 * bytes of REPORTDATA. Outside TDX (a developer's machine) there is NO real quote: the kit returns a MOCK quote,
 * clearly marked, which WILL NOT PASS the on-chain DCAP verification. The mock only exercises the server and the
 * local wiring; real quotes come from the dstack guest agent (dstack.ts).
 */
import { type Hex, toBytes, toHex, keccak256, concat } from "viem";

export interface QuoteResult {
  quote: Hex;
  eventLog: Hex;
  mock: boolean;
}

export interface DstackClient {
  getQuote(reportData: Uint8Array): Promise<{ quote: Uint8Array; eventLog: Uint8Array }>;
}

/** The real path: delegates to the dstack guest agent. */
export async function getQuoteReal(client: DstackClient, reportData: Hex): Promise<QuoteResult> {
  const r = await client.getQuote(toBytes(reportData));
  return { quote: toHex(r.quote), eventLog: toHex(r.eventLog), mock: false };
}

/**
 * A fake local quote: a deterministic blob that EMBEDS the REPORTDATA at the offset expected in a TD10 body, so that
 * local tools can read it back. It has no cryptographic validity.
 */
export function getQuoteMock(reportData: Hex): QuoteResult {
  const rd = toBytes(reportData);
  if (rd.length !== 64) throw new Error("reportData must be 64 bytes");
  // marker + REPORTDATA + padding, all hashed for length; NO proof value
  const marker = toBytes("0x4d4f434b2d54445800000000"); // "MOCK-TDX"
  const body = concat([toHex(marker), reportData]);
  return { quote: concat([body, keccak256(body)]), eventLog: "0x", mock: true };
}
