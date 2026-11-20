/**
 * sealed-bounty/demo-fault.ts — v2.1 quater: the DELIBERATE fault of the refutation demo (product 5).
 *
 * DEMO_FAULT=inflate-loss, written IN CLEAR in the compose file (enclave/phala/refute-demo-liar-v21.yml), is measured
 * in the compose hash, and so in the image fingerprint allowed on-chain: anyone can see that this VM lies, and how.
 * With it, the enclave signs its claims with a DOUBLED loss (src/services/bounty.ts); its refutations stay honest.
 * Safeguards, all at start-up (stop, nothing is served):
 *  - an unknown value → stop (never a silent fallback); absent or empty → no fault: nothing changes;
 *  - PRODUCT_ID absent (0) or forbidden (2 = the real Sealed Bounty, DEMO_FAULT_FORBIDDEN_PRODUCTS) → stop;
 *  - OPERATOR_ALLOWLIST=* (a quote for any operator) or one that contains the main operator of the v2.1 stack → stop:
 *    a lying enclave cannot be registered under that operator, whose bond must never be exposed.
 * /pubkeys and /health announce it (demoFaultNotice, app.ts); one log line at start-up (server.ts).
 */
import { getAddress, type Address } from "viem";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { DEMO_FAULTS, DEMO_FAULT_FORBIDDEN_PRODUCTS, type DemoFault } from "../../src/services/bounty";

export type { DemoFault };

/** Operators that NEVER run a faulty enclave: the main operator of the v2.1 stack (deployments.v21, roles.operator). */
export const PROTECTED_OPERATORS: readonly Address[] = ["0x344f2d2fA5AeAe78871F0B882245069F887c2e1a"];

/** A refused demo-fault configuration: a fixed message, and the service does not start. */
export class DemoFaultConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoFaultConfigError";
  }
}

/**
 * DEMO_FAULT read from the environment: the fault to serve, or undefined (the normal case). Throws DemoFaultConfigError
 * if it is unknown, on a forbidden or absent product, or if OPERATOR_ALLOWLIST is "*" or contains a protected operator.
 */
export function parseDemoFault(env: { DEMO_FAULT?: string; OPERATOR_ALLOWLIST?: string }, productId: bigint): DemoFault | undefined {
  const raw = env.DEMO_FAULT?.trim();
  if (!raw) return undefined;
  if (!(DEMO_FAULTS as readonly string[]).includes(raw)) {
    throw new DemoFaultConfigError(`DEMO_FAULT "${raw}" unknown (only "${DEMO_FAULTS.join('", "')}" exists)`);
  }
  if (productId === 0n) throw new DemoFaultConfigError("DEMO_FAULT requires PRODUCT_ID (the demo's product)");
  if (DEMO_FAULT_FORBIDDEN_PRODUCTS.includes(productId)) {
    throw new DemoFaultConfigError(`DEMO_FAULT refused for product ${productId} (the real Sealed Bounty): a faulty enclave is never served there`);
  }
  let allow: Address[] | null;
  try {
    allow = parseOperatorAllowlist(env.OPERATOR_ALLOWLIST);
  } catch {
    throw new DemoFaultConfigError("DEMO_FAULT: invalid OPERATOR_ALLOWLIST");
  }
  if (allow === null) {
    throw new DemoFaultConfigError("DEMO_FAULT refused with OPERATOR_ALLOWLIST=*: the faulty enclave attests only for the named demo operator");
  }
  const bad = allow.find((a) => PROTECTED_OPERATORS.some((p) => p.toLowerCase() === a.toLowerCase()));
  if (bad) {
    throw new DemoFaultConfigError(`DEMO_FAULT refused: OPERATOR_ALLOWLIST contains the main operator ${getAddress(bad)} (its bond must never be exposed to slashing)`);
  }
  return raw as DemoFault;
}

/** What /pubkeys and /health add (in English: judges and the site read it). */
export const DEMO_FAULT_NOTE: Record<DemoFault, string> = {
  "inflate-loss":
    "DEMONSTRATION enclave, deliberately faulty (refutation demo): it signs bounty claims with a DOUBLED loss; its refutations are honest. Refused for the real Sealed Bounty (product 2).",
};

export function demoFaultNotice(f: DemoFault): { demoFault: DemoFault; demoFaultNote: string } {
  return { demoFault: f, demoFaultNote: DEMO_FAULT_NOTE[f] };
}

/** The start-up log line. */
export function demoFaultStartupLine(f: DemoFault, productId: bigint): string {
  return `⚠️ DEMO_FAULT=${f}: deliberately faulty DEMO enclave (product ${productId}): claims signed with a DOUBLED loss, honest refutations`;
}
