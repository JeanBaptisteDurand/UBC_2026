/** v2.1 : le journal RTMR3 de dstack, sur le VRAI quote de notre enclave Phala (7/11) et son vrai journal. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keccak256, toHex, toBytes, type Hex } from "viem";
import {
  DSTACK_EVENTLOG_FORMAT_V1, dstackImageFromAttest, encodeDstackEventLog, parseDstackEventLog, replayDstackRtmr3,
} from "../src/dstack-eventlog";
import { parseTdxQuote } from "../src/quote";

const VEC = new URL("../../../contracts/test/vectors/", import.meta.url);
const attest = JSON.parse(readFileSync(new URL("phala-dstack-attest.json", VEC), "utf8")) as { quote: Hex; eventLog: Hex };
const events = JSON.parse(readFileSync(new URL("phala-dstack-eventlog.json", VEC), "utf8")) as Array<Record<string, unknown>>;

// valeurs établies par l'agent des contrats (Python + forge, 8/11) et par la pile v2 en ligne
const IMAGE_ID = "0x4e4d0a863c0ebd6b3734254bfa2d54407ba754f5113970dd76ab89941aef5c5b";
const COMPOSE = "0x6d26fa8f8b96b5e3398596ff5822ed2db578d2e7a5fb1b15802d3e5a8be504d3";
const OS_IMAGE = "0xe866e987221db357129ebc3f066b6706ef955889ea95e5510acbdf3d3055186b";

describe("journal RTMR3 de dstack (v2.1)", () => {
  it("le format vaut celui du contrat", () => {
    expect(DSTACK_EVENTLOG_FORMAT_V1).toBe("0x3590d36e37a8a7ef1da039b8ff13a058e67819c9c4ad60be5e116467f0a386b2");
  });

  it("le rejeu des 10 événements redonne le RTMR3 signé par Intel, et l'empreinte d'image attendue", () => {
    const r = dstackImageFromAttest(attest.quote, attest.eventLog);
    expect(r.rtmr3Matches).toBe(true);
    expect(r.imageKnown).toBe(true);
    expect(r.composeHash).toBe(COMPOSE);
    expect(r.osImageHash).toBe(OS_IMAGE);
    expect(r.imageId).toBe(IMAGE_ID);
    expect(r.workloadId.startsWith("0x9b21399b")).toBe(true); // empreinte complète de la v2 (deployments.v2.testnet.json)
    expect((r.eventLog!.length - 2) / 2).toBe(2752); // taille mesurée par forge
  });

  it("même résultat à partir du texte JSON brut", () => {
    const a = dstackImageFromAttest(attest.quote, attest.eventLog);
    const b = dstackImageFromAttest(attest.quote, JSON.stringify(events));
    expect(b.eventLog).toBe(a.eventLog);
    expect(b.imageId).toBe(a.imageId);
  });

  it("l'instance ne compte pas : un autre instance-id change RTMR3 mais pas l'empreinte d'image", () => {
    const evs = parseDstackEventLog(JSON.stringify(events))!;
    const other = evs.map((e) => (e.name === "instance-id" ? { ...e, payload: "0x1111111111111111111111111111111111111111" as Hex } : e));
    const r = replayDstackRtmr3(other);
    expect(r.rtmr3).not.toBe(parseTdxQuote(attest.quote).rtmr3);
    expect(r.composeHash).toBe(COMPOSE);
  });

  it("un compose-hash ajouté APRÈS system-ready n'est jamais lu", () => {
    const evs = parseDstackEventLog(JSON.stringify(events))!;
    const fake = [...evs, { version: 1 as const, name: "compose-hash", payload: keccak256(toBytes("faux")) }];
    const r = replayDstackRtmr3(fake);
    expect(r.imageKnown).toBe(true);
    expect(r.composeHash).toBe(COMPOSE);
  });

  it("un journal altéré ne concorde plus avec le quote : pas d'empreinte d'image", () => {
    const tampered = events.map((e) => (e.event === "compose-hash" ? { ...e, event_payload: "00".repeat(32) } : e));
    const r = dstackImageFromAttest(attest.quote, JSON.stringify(tampered));
    expect(r.rtmr3Matches).toBe(false);
    expect(r.imageId).toBeNull();
  });

  it("journal vide, illisible ou déjà encodé : null", () => {
    expect(parseDstackEventLog("0x")).toBeNull();
    expect(parseDstackEventLog(toHex(toBytes("pas du json")))).toBeNull();
    const enc = encodeDstackEventLog(parseDstackEventLog(JSON.stringify(events))!);
    expect(parseDstackEventLog(enc)).toBeNull();
  });
});
