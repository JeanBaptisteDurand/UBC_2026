/** Niveaux d'opérateur (10/11/2026) : le VRAI jeton de l'alliance Proof of Cloud (contracts/test/vectors) se lit et se
 *  vérifie ; trafiqué, il est refusé ; le fichier de déploiement v2.1 porte les adresses des niveaux. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROOF_OF_CLOUD, deploymentFromJson, parseAllianceToken, testnet } from "../src";

const V = JSON.parse(readFileSync(new URL("../../../contracts/test/vectors/proof-of-cloud-token.json", import.meta.url), "utf8"));
const sigB64 = Buffer.from(V.signature.slice(2), "hex").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const JWT = `${V.header}.${V.payload}.${sigB64}`;

describe("Proof of Cloud alliance token", () => {
  it("the real token verifies and names our machine", () => {
    const t = parseAllianceToken(JWT);
    expect(t.machineId).toBe(V.machineId.slice(2));
    expect(t.timestamp).toBe(V.timestamp);
    expect(t.quoteSha256).toBe(V.quoteHashSha256.slice(2));
    expect(t.signature).toBe(V.signature);
    expect(PROOF_OF_CLOUD.allianceKey).toBe(V.allianceKey);
  });
  it("tampered (content, signature, another key): refused", () => {
    const p = V.payload as string;
    const forged = `${V.header}.${p.slice(0, 20)}${p[20] === "A" ? "B" : "A"}${p.slice(21)}.${sigB64}`;
    expect(() => parseAllianceToken(forged)).toThrow(/signature invalide/);
    const badSig = `${V.header}.${V.payload}.${sigB64.slice(0, 10)}${sigB64[10] === "A" ? "B" : "A"}${sigB64.slice(11)}`;
    expect(() => parseAllianceToken(badSig)).toThrow();
    expect(() => parseAllianceToken(JWT, `0x${"11".repeat(32)}`)).toThrow();
    expect(() => parseAllianceToken("a.b")).toThrow(/trois parties/);
  });
});

describe("levels addresses", () => {
  it("the v2.1 deployment file and the SDK's testnet stack give the same ones", () => {
    const d = deploymentFromJson(JSON.parse(readFileSync(new URL("../../../deployments.v21.testnet.json", import.meta.url), "utf8")));
    expect(d.levels).toBeDefined();
    for (const k of ["machineRegistry", "proofOfCloudAuditor", "ed25519Verifier", "policyEnclaves", "sealedBountyVerified"] as const) {
      expect(d.levels![k].toLowerCase()).toBe(testnet.levels![k].toLowerCase());
    }
  });
});
