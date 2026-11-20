/** copilot.ts — the ATTESTED copilot on the site side (product 4 of v2.1). It is on when VITE_COPILOT_ENCLAVE_URL,
 *  VITE_COPILOT_PRODUCT_ID and VITE_COPILOT_OPERATOR are set (config.ts: ATTESTED_COPILOT).
 *  - makeAttestedCopilot builds the SDK client (createAttestedCopilotClient). It reads Arc's RPC DIRECTLY, through
 *    wagmi's public client and never the ArcHive API, to verify the copilot's key: registered for this product,
 *    active, image still allowed, operator not struck off, and active under the expected operator. It then encrypts
 *    the conversation to that key, and accepts only a reply sealed for THIS request.
 *  - registrationTx finds the enclave's registration transaction (EnclaveRegistered, at the block where its window
 *    began) for the badge's explorer link. It reads a single block and keeps the answer in memory.
 *  - stripCitations removes the model's raw citation marks from a copilot's text at display time, attested or not.
 *    The sources have their own line.
 *  The "attested copilot · verified on Arc" badge comes ONLY from an authenticated reply (authenticated === true). The
 *  bubble (screens/FloatingCopilot.tsx) never shows it for a clear-text refusal or for the server's copilot. */
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { createAttestedCopilotClient, testnet, type AttestedCopilotClient } from "@arcvault/sdk";
import { ATTESTED_COPILOT } from "./config";

/** The attested copilot's client, or null if it is not configured (the bubble then talks to the server's copilot). */
export function makeAttestedCopilot(pub: PublicClient | undefined | null): AttestedCopilotClient | null {
  if (!ATTESTED_COPILOT || !pub) return null;
  return createAttestedCopilotClient({
    copilotUrl: ATTESTED_COPILOT.url,
    productId: ATTESTED_COPILOT.productId,
    publicClient: pub as any, // two copies of viem (site, SDK): same version, distinct types
    deployment: testnet,
    // required here: the enclave must be active under THIS operator (not just "an allowed image")
    expectedOperator: ATTESTED_COPILOT.operator,
  });
}

/** A run of the model's citation marks (【4:0†source】, 【{"source": …}】…), whatever their length, JSON and line breaks
 *  included, with the spaces around it. */
const CITATIONS = /[ \t]*(?:【[^】]*】[ \t]*)+/g;

/** A copilot's text without the model's raw citation marks: the server removes only the short ones (80 characters at
 *  most, on one line); here, all of them, at display time only (the text kept and sent back to the copilot stays as it
 *  came). What surrounded a mark is joined back: nothing at a line edge, after "(" or before ". , )"; before ": ; ! ? »",
 *  the space the text had there; between two words, one space. */
export function stripCitations(text: string): string {
  if (!text.includes("【")) return text;
  return text.replace(CITATIONS, (m: string, at: number, all: string) => {
    const prev = at > 0 ? all[at - 1]! : "\n";
    const next = all[at + m.length] ?? "\n";
    if (/[\r\n([{]/.test(prev) || /[\r\n.,)\]}…]/.test(next)) return "";
    if (/[:;!?»]/.test(next)) return /[ \t]$/.test(m) ? " " : "";
    return " ";
  });
}

const ENCLAVE_REGISTERED = parseAbiItem(
  "event EnclaveRegistered(address indexed signer, uint256 indexed productId, address indexed operator, bytes32 workloadId, uint64 expiresAt)",
);
const registrations = new Map<string, Promise<Hex | null>>();

/** The transaction that registered this enclave: its validity window starts at its registration block (a renewal
 *  without a gap keeps it), so EnclaveRegistered is read at that single block. null if not found (silent RPC). */
export function registrationTx(pub: PublicClient, signer: Address, fromBlock: bigint): Promise<Hex | null> {
  const key = `${signer.toLowerCase()}:${fromBlock}`;
  let p = registrations.get(key);
  if (!p) {
    p = pub
      .getLogs({ address: testnet.enclaveRegistry, event: ENCLAVE_REGISTERED, args: { signer }, fromBlock, toBlock: fromBlock })
      .then((logs) => (logs[0]?.transactionHash ?? null) as Hex | null)
      .catch(() => {
        registrations.delete(key); // read again on the next request
        return null;
      });
    registrations.set(key, p);
  }
  return p;
}
