/**
 * quote.ts — obtenir un quote TDX.
 *
 * Dans une vraie VM Intel TDX (Phala dstack), on appelle l'agent invité `GetQuote` sur le socket
 * local avec nos 64 octets de REPORTDATA. Hors TDX (ta machine), il n'existe PAS de vrai quote :
 * on renvoie un quote MOCK, clairement marqué, qui NE PASSERA PAS la vérification DCAP on-chain.
 * Le mock sert seulement à exercer le serveur et le câblage local ; les vrais quotes viennent du spike S1.
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

/** Vrai chemin : délègue à l'agent invité dstack (branché au spike S1). */
export async function getQuoteReal(client: DstackClient, reportData: Hex): Promise<QuoteResult> {
  const r = await client.getQuote(toBytes(reportData));
  return { quote: toHex(r.quote), eventLog: toHex(r.eventLog), mock: false };
}

/**
 * Faux quote local : un blob déterministe qui EMBARQUE le REPORTDATA à l'offset attendu d'un corps
 * TD10, pour que les outils locaux puissent le relire. Il n'a aucune validité cryptographique.
 */
export function getQuoteMock(reportData: Hex): QuoteResult {
  const rd = toBytes(reportData);
  if (rd.length !== 64) throw new Error("reportData doit faire 64 octets");
  // marqueur + REPORTDATA + bourrage, le tout haché pour la longueur ; AUCUNE valeur de preuve
  const marker = toBytes("0x4d4f434b2d54445800000000"); // "MOCK-TDX"
  const body = concat([toHex(marker), reportData]);
  return { quote: concat([body, keccak256(body)]), eventLog: "0x", mock: true };
}
