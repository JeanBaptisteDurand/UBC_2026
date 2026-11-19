/** signin.ts — les messages que le wallet signe pour ArcHive, au format EIP-4361 (« Sign-In with Ethereum »).
 *  Le wallet reconnaît ce format : il montre le site qui demande, la phrase de l'action, le réseau et l'échéance, et
 *  signale un site imposteur (domaine du message différent de la page). L'API (services/api/src/operators.ts) vérifie
 *  chaque ligne et consomme le nonce qu'elle a émis (GET /auth/nonce : usage unique, 5 minutes).
 *  Les phrases sont en anglais (on les lit dans son wallet), quelle que soit la langue du site, et en
 *  ASCII : la grammaire d'EIP-4361 n'accepte rien d'autre, et un wallet ne contrôle le domaine que d'un message qu'il sait
 *  lire. Elles doivent rester identiques à STATEMENT dans operators.ts (le test services/api/test/security.test.ts le
 *  vérifie). Module sans navigateur : le test de l'API l'importe tel quel. */
import { createSiweMessage } from "viem/siwe";

/** Les actions signées : une approbation d'appairage, une clé créée ou révoquée, une machine retirée, la lecture réservée. */
export type SignedAction =
  | { kind: "pair"; code: string }
  | { kind: "createKey" }
  | { kind: "revokeKey"; keyId: string }
  | { kind: "removeMachine"; machineId: string }
  | { kind: "read" };

/** Une action expire 5 minutes après sa signature ; la lecture sert 10 minutes. */
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
  /** domaine de la page (window.location.host) ; l'URI est son origine (window.location.origin) */
  domain: string;
  uri: string;
  chainId: number;
  address: string;
  action: SignedAction;
  /** le nonce et son heure d'émission, tels que GET /auth/nonce les rend */
  nonce: string;
  issuedAt: string | Date;
}

/** Le message à signer (11 lignes) et son échéance (ms). « Issued At » reprend l'heure du serveur : pas d'écart d'horloge. */
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
