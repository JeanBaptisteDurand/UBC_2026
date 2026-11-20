/** deployment.ts — the ArcHive stack this console reads and writes: v3 on Arc testnet (deployments.v3.testnet.json at
 *  the repository root: 14 contracts deployed on 19 Nov 2026 from block 73075189, products 1 to 5).
 *  - Every address comes from that record, through the SDK's deploymentFromJson: a missing or invalid address throws,
 *    so the console never falls back to another stack (the SDK's built-in `testnet` is the earlier v2.1 stack).
 *  - The operator levels (MachineRegistry, ProofOfCloudAuditor, Ed25519Verifier, PolicyEnclaves, SealedBountyVerified)
 *    come from the record's `levels` block; a record without one gives them under `contracts`, and they are read there.
 *  - Every screen imports `testnet` from here, never from the SDK, and passes it to the SDK's clients. */
import { deploymentFromJson, type Deployment } from "@arcvault/sdk";
import record from "../../deployments.v3.testnet.json";

const LEVEL_CONTRACTS = ["MachineRegistry", "ProofOfCloudAuditor", "Ed25519Verifier", "PolicyEnclaves", "SealedBountyVerified"] as const;

function withLevels(j: any): any {
  if (j?.levels?.MachineRegistry) return j;
  const c = j?.contracts ?? {};
  return { ...j, levels: Object.fromEntries(LEVEL_CONTRACTS.map((k) => [k, c[k]])) };
}

/** The live stack (v3). The name follows the SDK's (`testnet`), so a screen only changes where it imports it from. */
export const testnet: Deployment = deploymentFromJson(withLevels(record));
/** The stack's name, as the console shows it. */
export const STACK_NAME = "v3";
