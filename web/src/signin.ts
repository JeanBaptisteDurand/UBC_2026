/** signin.ts — the messages the wallet signs for ArcHive, in the EIP-4361 format ("Sign-In with Ethereum").
 *  The wallet recognises this format: it shows the site that asks, the action's sentence, the network and the expiry,
 *  and flags an impostor site (a message domain different from the page). The API (services/api/src/operators.ts)
 *  checks every line and consumes the nonce it issued (GET /auth/nonce: single use, 5 minutes).
 *  The sentences are in English (they are read in the wallet), whatever the site's language, and in ASCII: the
 *  EIP-4361 grammar accepts nothing else, and a wallet only checks the domain of a message it can parse. They must stay
 *  identical to STATEMENT in operators.ts (the test services/api/test/security.test.ts checks it). A module without
 *  the browser: the API's test imports it as is. */
import { createSiweMessage } from "viem/siwe";

/** The signed actions: a pairing approval, a key created or revoked, a machine removed, the reserved read. */
export type SignedAction =
  | { kind: "pair"; code: string }
  | { kind: "createKey" }
  | { kind: "revokeKey"; keyId: string }
  | { kind: "removeMachine"; machineId: string }
  | { kind: "read" };

/** An action expires 5 minutes after its signature; the read lasts 10 minutes. */
export const ACTION_TTL_MS = 5 * 60_000;
export const READ_TTL_MS = 10 * 60_000;

export function statementOf(a: SignedAction): string {
  switch (a.kind) {
    case "pair": return `ArcHive: pair the machine showing code ${a.code} with my account`;
    case "createKey": return "ArcHive: create an operator key (arcop_) that cannot spend funds";
    case "revokeKey": return `ArcHive: revoke operator key arcop_${a.keyId}`;
    case "removeMachine": return `ArcHive: remove machine ${a.machineId} from my account (its key is revoked)`;
    case "read": return "ArcHive: read my operator data for 10 minutes (diagnostics, logs, machine and key names)";
  }
}

export interface SignInParams {
  /** the page's domain (window.location.host); the URI is its origin (window.location.origin) */
  domain: string;
  uri: string;
  chainId: number;
  address: string;
  action: SignedAction;
  /** the nonce and its issue time, as GET /auth/nonce returns them */
  nonce: string;
  issuedAt: string | Date;
}

/** The message to sign (11 lines) and its expiry (ms). "Issued At" takes the server's time: no clock skew. */
export function buildSignIn(p: SignInParams): { message: string; expiresAt: number } {
  const issuedAt = new Date(p.issuedAt);
  if (!Number.isFinite(issuedAt.getTime())) throw new Error("heure d'émission du nonce illisible : rechargez la page");
  const expirationTime = new Date(issuedAt.getTime() + (p.action.kind === "read" ? READ_TTL_MS : ACTION_TTL_MS));
  const message = createSiweMessage({
    domain: p.domain, uri: p.uri, address: p.address as `0x${string}`, chainId: p.chainId, version: "1",
    nonce: p.nonce, issuedAt, expirationTime, statement: statementOf(p.action),
  });
  return { message, expiresAt: expirationTime.getTime() };
}
