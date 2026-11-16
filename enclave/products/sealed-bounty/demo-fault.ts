/**
 * sealed-bounty/demo-fault.ts — v2.1 quater : la faute VOLONTAIRE de la démonstration de la réfutation (produit 5).
 *
 * DEMO_FAULT=inflate-loss, écrite EN CLAIR dans le compose (enclave/phala/refute-demo-liar-v21.yml), est mesurée dans le
 * compose-hash, donc dans l'empreinte d'image autorisée on-chain : n'importe qui voit que cette VM ment, et comment. Avec elle,
 * l'enclave signe ses réclamations avec une perte DOUBLÉE (src/services/bounty.ts) ; ses réfutations restent honnêtes.
 * Garde-fous, tous au démarrage (arrêt, rien n'est servi) :
 *  - valeur inconnue → arrêt (jamais de repli silencieux) ; absente ou vide → aucune faute : rien ne change ;
 *  - PRODUCT_ID absent (0) ou interdit (2 = la vraie Prime scellée, DEMO_FAULT_FORBIDDEN_PRODUCTS) → arrêt ;
 *  - OPERATOR_ALLOWLIST=* (quote pour n'importe quel opérateur) ou contenant l'opérateur principal de la pile v2.1 → arrêt :
 *    une enclave menteuse ne peut pas être inscrite sous cet opérateur, dont la caution ne doit jamais être exposée.
 * /pubkeys et /health l'annoncent (demoFaultNotice, app.ts) ; une ligne de journal au démarrage (server.ts).
 */
import { getAddress, type Address } from "viem";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { DEMO_FAULTS, DEMO_FAULT_FORBIDDEN_PRODUCTS, type DemoFault } from "../../src/services/bounty";

export type { DemoFault };

/** Opérateurs qui n'opèrent JAMAIS une enclave fautive : l'opérateur principal de la pile v2.1 (deployments.v21, roles.operator). */
export const PROTECTED_OPERATORS: readonly Address[] = ["0x344f2d2fA5AeAe78871F0B882245069F887c2e1a"];

/** Configuration de la faute de démonstration refusée : message fixe, le service ne démarre pas. */
export class DemoFaultConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoFaultConfigError";
  }
}

/**
 * DEMO_FAULT lue dans l'environnement : la faute à servir, ou undefined (cas normal). Lève DemoFaultConfigError si elle est
 * inconnue, sur un produit interdit ou absent, ou si OPERATOR_ALLOWLIST est « * » ou contient un opérateur protégé.
 */
export function parseDemoFault(env: { DEMO_FAULT?: string; OPERATOR_ALLOWLIST?: string }, productId: bigint): DemoFault | undefined {
  const raw = env.DEMO_FAULT?.trim();
  if (!raw) return undefined;
  if (!(DEMO_FAULTS as readonly string[]).includes(raw)) {
    throw new DemoFaultConfigError(`DEMO_FAULT « ${raw} » inconnue (seule « ${DEMO_FAULTS.join(" », « ")} » existe)`);
  }
  if (productId === 0n) throw new DemoFaultConfigError("DEMO_FAULT exige PRODUCT_ID (le produit de la démonstration)");
  if (DEMO_FAULT_FORBIDDEN_PRODUCTS.includes(productId)) {
    throw new DemoFaultConfigError(`DEMO_FAULT refusée pour le produit ${productId} (la vraie Prime scellée) : une enclave fautive n'y est jamais servie`);
  }
  let allow: Address[] | null;
  try {
    allow = parseOperatorAllowlist(env.OPERATOR_ALLOWLIST);
  } catch {
    throw new DemoFaultConfigError("DEMO_FAULT : OPERATOR_ALLOWLIST invalide");
  }
  if (allow === null) {
    throw new DemoFaultConfigError("DEMO_FAULT refusée avec OPERATOR_ALLOWLIST=* : l'enclave fautive n'atteste que pour l'opérateur de démonstration nommé");
  }
  const bad = allow.find((a) => PROTECTED_OPERATORS.some((p) => p.toLowerCase() === a.toLowerCase()));
  if (bad) {
    throw new DemoFaultConfigError(`DEMO_FAULT refusée : OPERATOR_ALLOWLIST contient l'opérateur principal ${getAddress(bad)} (sa caution ne doit jamais être exposée à une saisie)`);
  }
  return raw as DemoFault;
}

/** Ce que /pubkeys et /health ajoutent (anglais : lu par les juges et le site). */
export const DEMO_FAULT_NOTE: Record<DemoFault, string> = {
  "inflate-loss":
    "DEMONSTRATION enclave, deliberately faulty (refutation demo): it signs bounty claims with a DOUBLED loss; its refutations are honest. Refused for the real Sealed Bounty (product 2).",
};

export function demoFaultNotice(f: DemoFault): { demoFault: DemoFault; demoFaultNote: string } {
  return { demoFault: f, demoFaultNote: DEMO_FAULT_NOTE[f] };
}

/** La ligne de journal du démarrage. */
export function demoFaultStartupLine(f: DemoFault, productId: bigint): string {
  return `⚠️ DEMO_FAULT=${f} : enclave de DÉMONSTRATION volontairement fautive (produit ${productId}) — réclamations signées avec une perte DOUBLÉE, réfutations honnêtes`;
}
