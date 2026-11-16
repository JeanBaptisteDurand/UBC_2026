/**
 * scripts/refute-demo.ts — ce qui se vérifie sans chaîne ni secret : l'importer ne lance rien ; les deux composes de la
 * démonstration (enclave/phala/refute-demo-*-v21.yml) sont contrôlés (image épinglée et unique, produit 5, adresses de la v2.1,
 * DEMO_FAULT mesurée pour l'enclave menteuse SEULEMENT, opérateurs en variables chiffrées) ; le manifeste public dit la faute
 * volontaire, la règle de réfutation et reprend les composes.
 * Le chemin on-chain du script (prime, réclamation menteuse, réfutation, saisie) : bounty-demo-fault-chain.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { type Address } from "viem";
import { COMPOSE_FILES, DEMO_PRODUCT, MAIN_OPERATOR, buildManifest, checkComposes, parseCompose } from "../scripts/refute-demo";

const D = JSON.parse(readFileSync(new URL("../../deployments.v21.testnet.json", import.meta.url), "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const text = (f: string) => readFileSync(new URL(`../phala/${f}`, import.meta.url), "utf8");
/** 10/11 : les composes du dépôt sont ÉPINGLÉS sur l'image de la démonstration réellement jouée (celle du produit 2). */
const DIGEST = /@sha256:([0-9a-f]{64})/.exec(text(COMPOSE_FILES.liar))![1]!;
const pinned = (t: string) => t.replaceAll("__BOUNTY_IMAGE__", DIGEST);
const stack = { sealedBounty: K.SealedBounty!, registry: K.EnclaveRegistry!, chainId: Number(D.chainId) };
const load = (liar = pinned(text(COMPOSE_FILES.liar)), honest = pinned(text(COMPOSE_FILES.honest))) => ({
  liar: parseCompose(COMPOSE_FILES.liar, liar),
  honest: parseCompose(COMPOSE_FILES.honest, honest),
});

describe("refute-demo.ts — composes et manifeste de la démonstration", () => {
  it("les composes du dépôt : épinglés sur l'image jouée le 10/11 (celle du produit 2) ; un gabarit non épinglé est refusé", () => {
    const p2 = parseCompose("sealed-bounty-v21.yml", text("sealed-bounty-v21.yml")).services["sealed-bounty"]!;
    expect(checkComposes(load(text(COMPOSE_FILES.liar), text(COMPOSE_FILES.honest)), stack)).toBe(p2.image);
    const tpl = (t: string) => t.replaceAll(DIGEST, "__BOUNTY_IMAGE__");
    expect(() => checkComposes(load(tpl(text(COMPOSE_FILES.liar)), tpl(text(COMPOSE_FILES.honest))), stack)).toThrow(/__BOUNTY_IMAGE__/);
  });

  it("une fois l'image épinglée : une seule image, produit 5, DEMO_FAULT mesurée pour l'enclave menteuse seulement", () => {
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
    // le reste comme le compose du produit 2 (mêmes RPC, même registre, même SealedBounty)
    const p2 = parseCompose("sealed-bounty-v21.yml", text("sealed-bounty-v21.yml")).services["sealed-bounty"]!.measured;
    for (const k of ["RPC_URL", "FORK_RPC_URL", "CHAIN_ID", "REGISTRY", "SEALEDBOUNTY"]) expect([liar.measured[k], b.measured[k], cc.measured[k]]).toEqual([p2[k], p2[k], p2[k]]);
  });

  it("refus : faute absente ou chiffrée chez la menteuse, faute chez une honnête, deux images, autre produit, autre SealedBounty", () => {
    const liar = pinned(text(COMPOSE_FILES.liar)), honest = pinned(text(COMPOSE_FILES.honest));
    expect(() => checkComposes(load(liar.replace("      - DEMO_FAULT=inflate-loss\n", ""), honest), stack)).toThrow(/DEMO_FAULT=inflate-loss doit être mesurée/);
    expect(() => checkComposes(load(liar.replace("      - DEMO_FAULT=inflate-loss", "      - DEMO_FAULT=${DEMO_FAULT}"), honest), stack)).toThrow(/DEMO_FAULT/);
    expect(() => checkComposes(load(liar, honest.replace("      - PORT=8813\n", "      - PORT=8813\n      - DEMO_FAULT=inflate-loss\n")), stack)).toThrow(/honnête/);
    expect(() => checkComposes(load(liar.replace(DIGEST, "cd".repeat(32)), honest), stack)).toThrow(/une seule image/);
    expect(() => checkComposes(load(liar.replace("PRODUCT_ID=5", "PRODUCT_ID=2"), honest), stack)).toThrow(/PRODUCT_ID=2/);
    expect(() => checkComposes(load(liar, honest.replace("${OPERATOR_ALLOWLIST_C}", "${OPERATOR_ALLOWLIST_B}")), stack)).toThrow(/OPERATOR_ALLOWLIST_C/);
    expect(() => checkComposes(load(), { ...stack, sealedBounty: "0x0000000000000000000000000000000000000001" })).toThrow(/SEALEDBOUNTY/);
  });

  it("le manifeste : démonstration, faute volontaire et mesurée, règle de réfutation, composes, jamais l'opérateur principal", () => {
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
    expect(JSON.stringify(m)).toContain(MAIN_OPERATOR); // nommé… pour dire qu'il ne participe pas
    expect(m.operators.neverUsed).toMatch(/takes no part/);
    expect(Object.values(ops)).not.toContain(MAIN_OPERATOR);
  });
});
