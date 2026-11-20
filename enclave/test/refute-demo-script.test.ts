/**
 * scripts/refute-demo.ts — what can be checked with no chain and no secret: importing it runs nothing; the demo's two
 * compose files (enclave/phala/refute-demo-*-v21.yml) are checked (one pinned image, product 5, the v2.1 addresses,
 * DEMO_FAULT measured for the lying enclave only, operators in encrypted variables); the public manifest states the
 * deliberate fault and the refutation rule, and includes the compose files.
 * The script's on-chain path (bounty, lying claim, refutation, seizure): bounty-demo-fault-chain.test.ts.
 * The script's own error messages are matched as it prints them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { type Address } from "viem";
import { COMPOSE_FILES, DEMO_PRODUCT, MAIN_OPERATOR, buildManifest, checkComposes, parseCompose } from "../scripts/refute-demo";

const D = JSON.parse(readFileSync(new URL("../../docs/history/deployments.v21.testnet.json", import.meta.url), "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const text = (f: string) => readFileSync(new URL(`../phala/${f}`, import.meta.url), "utf8");
/** The repository's compose files are pinned to the image of the demo actually played (product 2's image). */
const DIGEST = /@sha256:([0-9a-f]{64})/.exec(text(COMPOSE_FILES.liar))![1]!;
const pinned = (t: string) => t.replaceAll("__BOUNTY_IMAGE__", DIGEST);
const stack = { sealedBounty: K.SealedBounty!, registry: K.EnclaveRegistry!, chainId: Number(D.chainId) };
const load = (liar = pinned(text(COMPOSE_FILES.liar)), honest = pinned(text(COMPOSE_FILES.honest))) => ({
  liar: parseCompose(COMPOSE_FILES.liar, liar),
  honest: parseCompose(COMPOSE_FILES.honest, honest),
});

describe("refute-demo.ts — the demo's compose files and manifest", () => {
  it("the repository's compose files: pinned to the image played on 15 Nov 2026 (product 2's); an unpinned template is refused", () => {
    const p2 = parseCompose("sealed-bounty-v21.yml", text("sealed-bounty-v21.yml")).services["sealed-bounty"]!;
    expect(checkComposes(load(text(COMPOSE_FILES.liar), text(COMPOSE_FILES.honest)), stack)).toBe(p2.image);
    const tpl = (t: string) => t.replaceAll(DIGEST, "__BOUNTY_IMAGE__");
    expect(() => checkComposes(load(tpl(text(COMPOSE_FILES.liar)), tpl(text(COMPOSE_FILES.honest))), stack)).toThrow(/__BOUNTY_IMAGE__/);
  });

  it("once the image is pinned: one image, product 5, DEMO_FAULT measured for the lying enclave only", () => {
    const c = load();
    expect(checkComposes(c, stack)).toBe(`ghcr.io/jeanbaptistedurand/archive-sealed-bounty@sha256:${DIGEST}`);
    const liar = c.liar.services["sealed-bounty-liar"]!;
    expect(liar.measured).toMatchObject({ DEMO_FAULT: "inflate-loss", PRODUCT_ID: DEMO_PRODUCT.toString(), SEALEDBOUNTY: K.SealedBounty, REGISTRY: K.EnclaveRegistry });
    expect(liar.secretRefs).toEqual({ OPERATOR_ALLOWLIST: "OPERATOR_ALLOWLIST" });
    const b = c.honest.services["sealed-bounty-b"]!, cc = c.honest.services["sealed-bounty-c"]!;
    expect(b.measured.DEMO_FAULT).toBeUndefined();
    expect(cc.measured.DEMO_FAULT).toBeUndefined();
    expect(b.secretRefs).toEqual({ OPERATOR_ALLOWLIST: "OPERATOR_ALLOWLIST_B" });
    expect(cc.secretRefs).toEqual({ OPERATOR_ALLOWLIST: "OPERATOR_ALLOWLIST_C" });
    expect(cc.measured.PORT).toBe("8813");
    expect(cc.ports).toEqual(["8813:8813"]);
    expect(b.ports).toEqual(["8803:8803"]);
    // the rest as in product 2's compose (same RPCs, same registry, same SealedBounty)
    const p2 = parseCompose("sealed-bounty-v21.yml", text("sealed-bounty-v21.yml")).services["sealed-bounty"]!.measured;
    for (const k of ["RPC_URL", "FORK_RPC_URL", "CHAIN_ID", "REGISTRY", "SEALEDBOUNTY"]) expect([liar.measured[k], b.measured[k], cc.measured[k]]).toEqual([p2[k], p2[k], p2[k]]);
  });

  it("refused: fault missing or encrypted on the liar, a fault on an honest one, two images, another product, another SealedBounty", () => {
    const liar = pinned(text(COMPOSE_FILES.liar)), honest = pinned(text(COMPOSE_FILES.honest));
    expect(() => checkComposes(load(liar.replace("      - DEMO_FAULT=inflate-loss\n", ""), honest), stack)).toThrow(/DEMO_FAULT=inflate-loss must be measured/);
    expect(() => checkComposes(load(liar.replace("      - DEMO_FAULT=inflate-loss", "      - DEMO_FAULT=${DEMO_FAULT}"), honest), stack)).toThrow(/DEMO_FAULT/);
    expect(() => checkComposes(load(liar, honest.replace("      - PORT=8813\n", "      - PORT=8813\n      - DEMO_FAULT=inflate-loss\n")), stack)).toThrow(/honest enclave/);
    expect(() => checkComposes(load(liar.replace(DIGEST, "cd".repeat(32)), honest), stack)).toThrow(/one single image/);
    expect(() => checkComposes(load(liar.replace("PRODUCT_ID=5", "PRODUCT_ID=2"), honest), stack)).toThrow(/PRODUCT_ID=2/);
    expect(() => checkComposes(load(liar, honest.replace("${OPERATOR_ALLOWLIST_C}", "${OPERATOR_ALLOWLIST_B}")), stack)).toThrow(/OPERATOR_ALLOWLIST_C/);
    expect(() => checkComposes(load(), { ...stack, sealedBounty: "0x0000000000000000000000000000000000000001" })).toThrow(/SEALEDBOUNTY/);
  });

  it("the manifest: a demo, a deliberate and measured fault, the refutation rule, the compose files, never the main operator", () => {
    const ops = { A: "0x00000000000000000000000000000000000000a1", B: "0x00000000000000000000000000000000000000b2", C: "0x00000000000000000000000000000000000000c3" } as Record<"A" | "B" | "C", Address>;
    const m = buildManifest({
      composes: load(), operators: ops,
      contracts: { SealedBounty: K.SealedBounty!, EnclaveRegistry: K.EnclaveRegistry!, OperatorBond: K.OperatorBond!, VerdictLog: K.VerdictLog!, TdxAttestationModule: K.TdxAttestationModule! },
      external: { USDC: X.USDC!, AutomataDcapAttestationFee: X.AutomataDcapAttestationFee!, ERC8004_Validation: X.ERC8004_Validation! },
    }) as any;
    expect(m.product).toBe("ArcHive - Sealed Bounty - refutation demo (one image deliberately lies)");
    expect(m.demonstration).toBe(true);
    expect(m.deliberateFault.variable).toMatch(/DEMO_FAULT=inflate-loss \(measured/);
    expect(m.refutationRule).toMatch(/REFUTE_QUORUM \(2\) DISTINCT operators/);
    expect(m.composes.map((x: any) => [x.service, x.measuredEnv.DEMO_FAULT ?? null])).toEqual([
      ["sealed-bounty-liar", "inflate-loss"], ["sealed-bounty-b", null], ["sealed-bounty-c", null],
    ]);
    expect(m.operators.A.address).toBe(ops.A);
    expect(JSON.stringify(m)).toContain(MAIN_OPERATOR); // named… to say that it does not take part
    expect(m.operators.neverUsed).toMatch(/takes no part/);
    expect(Object.values(ops)).not.toContain(MAIN_OPERATOR);
  });
});
