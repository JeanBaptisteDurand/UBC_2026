/**
 * Prime scellée v2.1 quater — RELAIS STRICT contre un RPC du fork MENTEUR (src/services/rpc-relay.ts). Vérification du relais
 * du 9/11 au soir (scratchpad verif-relay : preuves r1-B, r1-E, r1-G ; r2 et r3-1a avec les moteurs réels :
 * relay-hardening-engines.test.ts). Le relais seul, devant un RPC du fork scripté :
 *  1. en-tête LIÉ à son hash (politique « arc », défaut) : keccak256(RLP(21 champs d'en-tête d'Arc)) = hash, VÉRIFIÉ sur deux
 *     blocs réels consécutifs d'Arc testnet (71 609 813 et 71 609 814, lus le 9/11/2026 vers 23 h 40 sur rpc.testnet.arc.io,
 *     en hashes et en transactions complètes) ; un en-tête au bon hash mais au contenu changé → violation « header » ;
 *     parentHash empoisonné → « header » (ou « chain » si le hash du bloc forgé est recalculé) ;
 *  2. les 21 champs d'en-tête d'Arc sont obligatoires : un bloc sans l'un d'eux → « shape » (verrou) ;
 *  3. redirections jamais suivies : 502 passager, l'autre hôte ne reçoit rien ;
 *  4. réponses lues en flux, coupées au-delà de la borne : 300 Mio → 502, lecture coupée, mémoire bornée ;
 *  5. mémoire des réponses d'un rejeu : la même lecture rendue avec une autre valeur → « inconsistent » (verrou).
 * Chaque faille a son TÉMOIN quand c'est possible (politique « shape » = l'ancien contrat) : le banc reproduit bien ce que le
 * contrôle ferme.
 */
import { describe, it, expect } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { keccak256, numberToHex, pad, toBytes, type Hex } from "viem";
import {
  MAX_RESPONSE_BYTES, RELAY_ERROR_CODE, RelayViolation, blockHeaderHash, checkBlockShape, startStrictRelay, type HeaderPolicy, type StrictRelay,
} from "../src/services/rpc-relay";

// =====================================================================================================================
// Blocs RÉELS d'Arc testnet (lecture seule, 9/11/2026 vers 23 h 40, rpc.testnet.arc.io : 6 requêtes en tout)
// =====================================================================================================================

/** Arc testnet, bloc 71 609 814 (0x444add6), transactions en hashes. */
const ARC_N: Record<string, any> = {
  "hash": "0xedf152d32616abef793da8b4a92c63fe9f14c679e6024f15bd00bee34307b6e2",
  "parentHash": "0x36b7911235caa73bd18284568871cfae89d9d856db22ab0675bb652aa13c495b",
  "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  "miner": "0xa693cc18aa09d33dd388013b7a02e5ff863b8760",
  "stateRoot": "0xd9517b738981bd3a1dd1b0486a20b91710f8b7d2d9eb03df289ed21e08680af1",
  "transactionsRoot": "0x5f658bbe938e4661a250fc6752512dfa8b1d4b7b90c7a07be759c2b58b98a772",
  "receiptsRoot": "0x05939a86cecace94bd7cc99c1ef2e57d47d022e948dfc9d8c2e29a0ab3136fa9",
  "logsBloom": "0x00000000000000000000100008000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000001000000000008000010004100000020000000000000000000000000000000000000002000000000000000000001000000000000000010000000400000000240000000100000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000008000000000000000000000000000000000000000000400000000000000200000000000000000000000000000000000000000000000000",
  "difficulty": "0x0",
  "number": "0x444add6",
  "gasLimit": "0x1c9c380",
  "gasUsed": "0x23dbd",
  "timestamp": "0x6af24bca",
  "extraData": "0x00000004a817c800",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "nonce": "0x0000000000000000",
  "baseFeePerGas": "0x4a817c800",
  "withdrawalsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  "blobGasUsed": "0x0",
  "excessBlobGas": "0x0",
  "parentBeaconBlockRoot": "0x36b7911235caa73bd18284568871cfae89d9d856db22ab0675bb652aa13c495b",
  "requestsHash": "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size": "0x490",
  "uncles": [],
  "transactions": [
    "0xf020d4b62ca5f07adc19d8e40dbc04ecd3bc39f42d90147e8b1d21fe01fe44f2",
    "0x9dbf3d4df79a869e3f9ec95e283fba0162d317d16a1aa586ee4e884f4fcfc9d4",
    "0x46cc0fceaecb96c308a989bd641dd7cb9fa8313c838a3792cbfe216d1e281362"
  ],
  "withdrawals": []
};
/** Arc testnet, bloc 71 609 813 : le parent de ARC_N. */
const ARC_N1: Record<string, any> = {
  "hash": "0x36b7911235caa73bd18284568871cfae89d9d856db22ab0675bb652aa13c495b",
  "parentHash": "0xd6cc4a0c30379888fe065b14b096cdb7ecb898ee07dd11e9ea2b9a174a0fbca8",
  "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  "miner": "0xa693cc18aa09d33dd388013b7a02e5ff863b8760",
  "stateRoot": "0x0eba28a9331c70ceef8be99f62d4808b28d48c2550a4e811a5dbf983a8957c9e",
  "transactionsRoot": "0xe60613892d1f9b83828ffa2925ab5aca52407d7a0d4d79bd1daa70ea66bbeff8",
  "receiptsRoot": "0x273fdf08ace2211906fd689d80e55d8055871bc044d39967ceb5aadee9b2e258",
  "logsBloom": "0x00000020000040000000000000000000000000000000000000000000000100000000000000000200000000040000000000000080000000000000000000000000000004000000000000000008000000000500000000400000000000000000000001000000000000002000000000004000000000000000040000000010000000400000000820000000000000000000000040000000000040080000000000000000000000000000000000000000000000040000000000000000004000000000000001080003000000400008000000000000000000000000000000000012000000600000000000000000000000000000400000000040000000000000000000000000",
  "difficulty": "0x0",
  "number": "0x444add5",
  "gasLimit": "0x1c9c380",
  "gasUsed": "0x3be96",
  "timestamp": "0x6af24bca",
  "extraData": "0x00000004a817c800",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "nonce": "0x0000000000000000",
  "baseFeePerGas": "0x4a817c800",
  "withdrawalsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  "blobGasUsed": "0x0",
  "excessBlobGas": "0x0",
  "parentBeaconBlockRoot": "0xd6cc4a0c30379888fe065b14b096cdb7ecb898ee07dd11e9ea2b9a174a0fbca8",
  "requestsHash": "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size": "0x6c8",
  "uncles": [],
  "transactions": [
    "0xf93b2ce0291b4a982b1aceffc0d1ebeba01f41dbadf958f45b040a3afb91e621",
    "0xc8d69491e8756afb5e064749eafd057ddc948712ccd26550388a2418848d7825",
    "0x00273b582ad0158c1cea8933b8a350120643d0979211c2e63ab94ac761f84d89",
    "0x46392a8e0572d1821ad00730e2fcbc854fb9e793b138c81870f6540b99e67b7e"
  ],
  "withdrawals": []
};
/** Les 3 transactions complètes de ARC_N (eth_getBlockByNumber(…, true)) ; le reste du bloc est identique. */
const ARC_N_TXS: any[] = [
  {
    "type": "0x0",
    "chainId": "0x4cef52",
    "nonce": "0x491",
    "gasPrice": "0x8799bec00",
    "gas": "0x72e4",
    "to": "0xa3d9fbd0edb10327ecb73d2c72622e505df468a2",
    "value": "0xde0b6b3a7640000",
    "input": "0x775c300c62635f6238337a73676e300b0080218021802180218021802180218021",
    "r": "0x5f801419dbc885a266fab6b27aef891fc7eb062848fba58098e526fcd8fe42af",
    "s": "0x7f02d735ffbf73c2bce336a5c8d51279b7add9ebf2c29812f00a02006e510f19",
    "v": "0x99dec7",
    "hash": "0xf020d4b62ca5f07adc19d8e40dbc04ecd3bc39f42d90147e8b1d21fe01fe44f2",
    "blockHash": "0xedf152d32616abef793da8b4a92c63fe9f14c679e6024f15bd00bee34307b6e2",
    "blockNumber": "0x444add6",
    "transactionIndex": "0x0",
    "from": "0x8a90a9544868dcb8947adf9d2515b8d28c5649d1",
    "blockTimestamp": "0x6af24bca"
  },
  {
    "type": "0x0",
    "chainId": "0x4cef52",
    "nonce": "0x1f52",
    "gasPrice": "0x79126a500",
    "gas": "0x186a0",
    "to": "0x3600000000000000000000000000000000000000",
    "value": "0x0",
    "input": "0xa9059cbb000000000000000000000000cc936c1e39e5ac82b6f16045edcbac8b1f8ffd8c0000000000000000000000000000000000000000000000000000000000014cbc",
    "r": "0x42ef21774d44d03b670e2a3bf32ca2e45336a9b5110667738d8ef37709986e0d",
    "s": "0x2dd07d30e8c5a0ce9068986e404f25d13afb61660d453f6fb275cea5a78a0752",
    "v": "0x99dec8",
    "hash": "0x9dbf3d4df79a869e3f9ec95e283fba0162d317d16a1aa586ee4e884f4fcfc9d4",
    "blockHash": "0xedf152d32616abef793da8b4a92c63fe9f14c679e6024f15bd00bee34307b6e2",
    "blockNumber": "0x444add6",
    "transactionIndex": "0x1",
    "from": "0x4e4c10e0e6752f9a7119698c39080544dba6937b",
    "blockTimestamp": "0x6af24bca"
  },
  {
    "type": "0x0",
    "chainId": "0x4cef52",
    "nonce": "0x32cd",
    "gasPrice": "0x5d21dba00",
    "gas": "0x493e0",
    "to": "0x2f4490e7c6f3dac23ffee6e71bfcb5d1ccd7d4ec",
    "value": "0x0",
    "input": "0x9d9892cd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000127c3e2",
    "r": "0x3df2c2bd3a304c82982715eb38c1785fb501f997dcc1d644ca9a2448f4da98c9",
    "s": "0x4b7b56f5f9310748c7aca9d379a5f22cf24a3087c4a940a1ab75b0112447bf46",
    "v": "0x99dec8",
    "hash": "0x46cc0fceaecb96c308a989bd641dd7cb9fa8313c838a3792cbfe216d1e281362",
    "blockHash": "0xedf152d32616abef793da8b4a92c63fe9f14c679e6024f15bd00bee34307b6e2",
    "blockNumber": "0x444add6",
    "transactionIndex": "0x2",
    "from": "0x715780bcc4cb386c7385f2d8f1d9f1e0964b9f5f",
    "blockTimestamp": "0x6af24bca"
  }
];
const ARC_N_FULL = { ...ARC_N, transactions: ARC_N_TXS };
const N = BigInt(ARC_N.number);
const h32 = (s: string) => keccak256(toBytes(s));

/** Les 21 champs d'en-tête d'Arc (Londres → Prague) et leur nature : l'ordre du protocole, celui de l'RLP du hash. */
const FIELDS: Array<[string, "b32" | "addr" | "bloom" | "qty" | "bytes" | "nonce8"]> = [
  ["parentHash", "b32"], ["sha3Uncles", "b32"], ["miner", "addr"], ["stateRoot", "b32"], ["transactionsRoot", "b32"],
  ["receiptsRoot", "b32"], ["logsBloom", "bloom"], ["difficulty", "qty"], ["number", "qty"], ["gasLimit", "qty"],
  ["gasUsed", "qty"], ["timestamp", "qty"], ["extraData", "bytes"], ["mixHash", "b32"], ["nonce", "nonce8"],
  ["baseFeePerGas", "qty"], ["withdrawalsRoot", "b32"], ["blobGasUsed", "qty"], ["excessBlobGas", "qty"],
  ["parentBeaconBlockRoot", "b32"], ["requestsHash", "b32"],
];
/** Les champs qui étaient FACULTATIFS en v2.1 ter (le relais acceptait un bloc sans eux). */
const WERE_OPTIONAL = ["baseFeePerGas", "difficulty", "mixHash", "nonce", "sha3Uncles", "withdrawalsRoot", "blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot", "requestsHash"];

/** Une autre valeur, de la même forme, pour un champ d'en-tête. */
function otherValue(field: string, kind: (typeof FIELDS)[number][1], v: string): string {
  switch (kind) {
    case "b32": return h32(`faux ${field}`);
    case "addr": return "0x00000000000000000000000000000000000000ff";
    case "bloom": return `0x${v[2] === "f" ? "e" : "f"}${v.slice(3)}`;
    case "qty": return numberToHex(BigInt(v) + (field === "timestamp" ? 1000n : 1n));
    case "bytes": return `${v}00`;
    case "nonce8": return "0x0000000000000001";
  }
}

// =====================================================================================================================
// Outils : un RPC du fork scripté (réponses JSON-RPC, statuts HTTP, corps géants en flux, corps au compte-gouttes)
// =====================================================================================================================

type Reply =
  | { result: unknown }
  | { error: { code: number; message: string } }
  | { status: number; headers?: Record<string, string> }
  | { huge: { bytes: number; contentLength?: boolean } }
  | { trickle: { result: unknown; msPerByte: number } };

/** RPC du fork scripté : `answer(method, params)` ; journalise les requêtes, compte les octets de corps géant écrits. */
async function scripted(answer: (method: string, params: any[]) => Reply) {
  const calls: Array<{ method: string; params: any[]; path: string }> = [];
  let written = 0;
  let cutEarly = 0;
  const CHUNK = Buffer.alloc(1 << 20, "0"); // 1 Mio de « 0 »
  const server: Server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", () => {
      const q = JSON.parse(body);
      calls.push({ method: q.method, params: q.params ?? [], path: rq.url ?? "" });
      const a = answer(q.method, q.params ?? []);
      if ("status" in a) {
        rs.writeHead(a.status, { "content-type": "text/plain", ...(a.headers ?? {}) });
        rs.end("x");
        return;
      }
      if ("huge" in a) {
        // une réponse JSON-RPC valide : un code de `bytes` octets d'hexadécimal (eth_getCode), écrite en flux avec contre-pression
        const head = `{"jsonrpc":"2.0","id":${q.id},"result":"0x`;
        rs.writeHead(200, { "content-type": "application/json", ...(a.huge.contentLength ? { "content-length": String(head.length + a.huge.bytes + 2) } : {}) });
        rs.write(head);
        let left = a.huge.bytes;
        rs.on("close", () => {
          if (left > 0) cutEarly++;
        });
        const pump = () => {
          while (left > 0) {
            if (rs.destroyed) return;
            const n = Math.min(left, CHUNK.length);
            left -= n;
            written += n;
            if (!rs.write(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n))) {
              rs.once("drain", pump);
              return;
            }
          }
          rs.end('"}');
        };
        pump();
        return;
      }
      if ("trickle" in a) {
        const full = JSON.stringify({ jsonrpc: "2.0", id: q.id, result: a.trickle.result });
        rs.writeHead(200, { "content-type": "application/json" });
        let k = 0;
        const t = setInterval(() => {
          if (rs.destroyed || k >= full.length) {
            clearInterval(t);
            if (!rs.destroyed) rs.end();
            return;
          }
          rs.write(full[k++]!);
        }, a.trickle.msPerByte);
        return;
      }
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, ...a }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    written: () => written,
    cutEarly: () => cutEarly,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Une requête du « moteur » au relais : statut HTTP et corps JSON (s'il y en a un). */
async function ask(relay: StrictRelay, method: string, params: unknown[], id = 1): Promise<{ status: number; json: any }> {
  const res = await fetch(relay.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

/** La vraie chaîne d'Arc (N, N − 1), avec `lie(n, full, rang de la lecture)` qui peut remplacer un bloc. */
function arcChain(lie: (n: bigint, full: boolean, k: number) => unknown = () => undefined) {
  const reads = new Map<string, number>();
  return (method: string, params: any[]): Reply => {
    if (method !== "eth_getBlockByNumber") return { error: { code: -32601, message: "method not found" } };
    const n = BigInt(params[0]);
    const full = params[1] === true;
    const k = (reads.get(`${n}:${full}`) ?? 0) + 1;
    reads.set(`${n}:${full}`, k);
    const forged = lie(n, full, k);
    if (forged !== undefined) return { result: forged };
    if (n === N) return { result: full ? ARC_N_FULL : ARC_N };
    if (n === N - 1n && !full) return { result: ARC_N1 };
    return { result: null };
  };
}

const at = (n: bigint) => numberToHex(n);

// =====================================================================================================================
// 1. en-tête LIÉ à son hash
// =====================================================================================================================

describe("1 — en-tête LIÉ à son hash : keccak256(RLP(21 champs)) = hash (politique « arc », défaut)", () => {
  it("blocs RÉELS d'Arc testnet : le hash se recalcule (hashes et transactions complètes), N.parentHash = hash(N − 1) : acceptés", () => {
    expect(blockHeaderHash(ARC_N)).toBe(ARC_N.hash);
    expect(blockHeaderHash(ARC_N1)).toBe(ARC_N1.hash);
    expect(blockHeaderHash(ARC_N_FULL)).toBe(ARC_N.hash);
    expect(ARC_N.parentHash).toBe(ARC_N1.hash);
    expect(ARC_N_TXS.map((t) => t.hash)).toEqual(ARC_N.transactions);
    expect(checkBlockShape("eth_getBlockByNumber", ARC_N, false)).toEqual({ number: N, hash: ARC_N.hash, parentHash: ARC_N1.hash, stateRoot: ARC_N.stateRoot });
    expect(checkBlockShape("eth_getBlockByNumber", ARC_N_FULL, true).hash).toBe(ARC_N.hash);
    expect(checkBlockShape("eth_getBlockByHash", ARC_N1, false).number).toBe(N - 1n);
    // hexadécimal en majuscules (même valeur) : même hash
    expect(checkBlockShape("m", { ...ARC_N, stateRoot: ARC_N.stateRoot.toUpperCase().replace("0X", "0x") }, false).hash).toBe(ARC_N.hash);
  });

  it("chacun des 21 champs changé au MÊME hash (horodatage, base fee, mixHash, mineur, parentHash…) → « header » ; témoin « shape » : accepté (la faille)", () => {
    for (const [field, kind] of FIELDS) {
      const forged = { ...ARC_N, [field]: otherValue(field, kind, ARC_N[field]) };
      let err: unknown;
      try {
        checkBlockShape("eth_getBlockByNumber", forged, false);
      } catch (e) {
        err = e;
      }
      expect(err, field).toBeInstanceOf(RelayViolation);
      expect((err as RelayViolation).kind, field).toBe("header");
      expect((err as RelayViolation).message, field).not.toContain(String(forged[field]).slice(2, 12)); // message fixe
      // l'ancien contrat ne voyait rien : même hash, autre contenu, accepté
      expect(checkBlockShape("eth_getBlockByNumber", forged, false, "shape").hash, field).toBe(ARC_N.hash);
    }
  });

  it("preuve r3-1a vue du relais : le RPC ment sur TOUTES les lectures du bloc N (horodatage +1000 s, même hash) → l'ancre elle-même est refusée (« header ») ; témoin « shape » : ancre acceptée, horodatage forgé rendu au moteur", async () => {
    const forgedN = { ...ARC_N, timestamp: numberToHex(BigInt(ARC_N.timestamp) + 1000n) };
    const up = await scripted(arcChain((n) => (n === N ? forgedN : undefined)));
    try {
      const strict = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
      await expect(strict.anchor()).rejects.toMatchObject({ kind: "header" });
      expect(strict.violation?.kind).toBe("header");
      expect((await ask(strict, "eth_getBlockByNumber", [at(N), false])).json.error.code).toBe(RELAY_ERROR_CODE);
      await strict.close();

      const lax = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true, headerPolicy: "shape" });
      expect(await lax.anchor()).toBe(ARC_N.hash);
      const seen = await ask(lax, "eth_getBlockByNumber", [at(N), false]);
      expect(seen.json.result.timestamp).toBe(forgedN.timestamp); // le moteur aurait pris l'horodatage forgé
      expect(lax.violation).toBeUndefined();
      await lax.close();
    } finally {
      await up.close();
    }
  });

  it("preuve r1-G (1) : la vraie chaîne est servie (ancre, N en hashes et complet, N − 1), puis le bloc N relu au MÊME hash avec un autre contenu → « header », verrou, plus rien n'est transmis", async () => {
    const up = await scripted(arcChain((n, full, k) => (n === N && !full && k >= 2 ? { ...ARC_N, baseFeePerGas: "0x1", mixHash: h32("autre aléa"), miner: "0x00000000000000000000000000000000000000ff" } : undefined)));
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
    try {
      expect(await relay.anchor()).toBe(ARC_N.hash); // 1re lecture du bloc N : saine
      expect((await ask(relay, "eth_getBlockByNumber", [at(N), true])).json.result).toEqual(ARC_N_FULL);
      expect((await ask(relay, "eth_getBlockByNumber", [at(N - 1n), false])).json.result).toEqual(ARC_N1);
      expect(relay.violation).toBeUndefined();
      const lie = await ask(relay, "eth_getBlockByNumber", [at(N), false]); // 2e lecture : même hash, autre contenu
      expect(lie.json.error.code).toBe(RELAY_ERROR_CODE);
      expect(lie.json).not.toHaveProperty("result");
      expect(relay.violation?.kind).toBe("header");
      const before = up.calls.length;
      expect((await ask(relay, "eth_getBlockByNumber", [at(N - 1n), false])).json.error).toBeDefined(); // failFast
      expect(up.calls.length).toBe(before);
    } finally {
      await relay.close();
      await up.close();
    }
  });

  it("preuve r1-G (2) : parentHash empoisonné — N − 1 au bon hash mais au parentHash forgé → « header » ; N − 1 forgé ET re-hashé → « chain » ; N − 2 forgé jamais rendu ; témoin « shape » : N − 2 forgé ACCEPTÉ", async () => {
    // le faux bloc N − 2 est lui-même cohérent (son hash est celui de son contenu) : seul le lien N − 1 → N − 2 est forgé
    const fakeBody = { ...ARC_N1, number: at(N - 2n), parentHash: h32("x"), stateRoot: h32("faux état") };
    const FAKE = blockHeaderHash(fakeBody);
    const fakeN2 = { ...fakeBody, hash: FAKE };
    const poisoned = { ...ARC_N1, parentHash: FAKE }; // hash d'origine, contenu changé
    const rehashed = { ...poisoned, hash: blockHeaderHash(poisoned) }; // en-tête cohérent, mais pas celui que N désigne
    for (const [what, n1, policy, want] of [
      ["parentHash forgé au même hash", poisoned, "arc", "header"],
      ["parentHash forgé, hash recalculé", rehashed, "arc", "chain"],
      ["témoin : ancien contrat", poisoned, "shape", undefined],
    ] as Array<[string, Record<string, unknown>, HeaderPolicy, string | undefined]>) {
      const up = await scripted(arcChain((n) => (n === N - 1n ? n1 : n === N - 2n ? fakeN2 : undefined)));
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true, headerPolicy: policy });
      try {
        await relay.anchor();
        const n2 = await ask(relay, "eth_getBlockByNumber", [at(N - 2n), false]); // BLOCKHASH(N − 2) : le relais remonte N, N − 1
        if (want === undefined) {
          expect(n2.json.result?.hash, what).toBe(FAKE); // l'ancienne faille : BLOCKHASH(N − 2) forgé, sans verrou
          expect(relay.violation, what).toBeUndefined();
        } else {
          expect(n2.json.error?.code, what).toBe(RELAY_ERROR_CODE);
          expect(n2.json, what).not.toHaveProperty("result"); // BLOCKHASH(N − 2) forgé jamais rendu au moteur
          expect(relay.violation?.kind, what).toBe(want);
        }
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("eth_getBlockByHash : même contrôle (un bloc demandé par hash au contenu changé → « header ») ; un RPC du fork honnête relu plusieurs fois : aucune violation", async () => {
    const up = await scripted((m, p) => {
      if (m === "eth_getBlockByHash") return { result: p[0] === ARC_N1.hash ? { ...ARC_N1, gasUsed: "0x1" } : null };
      return arcChain()(m, p);
    });
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await ask(relay, "eth_getBlockByNumber", [at(N), false])).json.result).toEqual(ARC_N);
        expect((await ask(relay, "eth_getBlockByNumber", [at(N - 1n), false])).json.result).toEqual(ARC_N1);
      }
      expect(relay.violation).toBeUndefined();
      expect((await ask(relay, "eth_getBlockByHash", [ARC_N1.hash, false])).json.error?.code).toBe(RELAY_ERROR_CODE);
      expect(relay.violation?.kind).toBe("header");
    } finally {
      await relay.close();
      await up.close();
    }
  });
});

// =====================================================================================================================
// 2. les 21 champs d'en-tête d'Arc sont obligatoires
// =====================================================================================================================

describe("2 — champs d'en-tête d'Arc OBLIGATOIRES (absents → réponse invalide → verrou)", () => {
  it("bloc réel d'Arc privé de l'un des 21 champs (ou champ à null) → « shape » ; témoin « shape » : les 10 champs autrefois facultatifs pouvaient manquer", () => {
    for (const [field] of FIELDS) {
      const { [field]: _gone, ...without } = ARC_N;
      for (const b of [without, { ...ARC_N, [field]: null }]) {
        let err: unknown;
        try {
          checkBlockShape("eth_getBlockByNumber", b, false);
        } catch (e) {
          err = e;
        }
        expect((err as RelayViolation)?.kind, field).toBe("shape");
        expect((err as RelayViolation).message, field).toContain(field);
      }
      if (WERE_OPTIONAL.includes(field)) expect(checkBlockShape("eth_getBlockByNumber", without, false, "shape").hash, field).toBe(ARC_N.hash);
    }
    // hash absent : toujours refusé
    const { hash: _h, ...noHash } = ARC_N;
    expect(() => checkBlockShape("m", noHash, false)).toThrow(expect.objectContaining({ kind: "shape" }));
  });

  it("preuves r2 / r3-1b vues du relais : bloc N SANS baseFeePerGas (puis sans mixHash) servi au moteur après une ancre saine → erreur JSON-RPC, verrou « shape »", async () => {
    for (const field of ["baseFeePerGas", "mixHash", "excessBlobGas", "parentBeaconBlockRoot"]) {
      const { [field]: _gone, ...without } = ARC_N;
      const up = await scripted(arcChain((n, full, k) => (n === N && !full && k >= 2 ? without : undefined)));
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
      try {
        await relay.anchor();
        const out = await ask(relay, "eth_getBlockByNumber", [at(N), false]);
        expect(out.json.error?.code, field).toBe(RELAY_ERROR_CODE);
        expect(relay.violation?.kind, field).toBe("shape");
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });
});

// =====================================================================================================================
// 3. redirections jamais suivies
// =====================================================================================================================

describe("3 — redirections du RPC du fork : JAMAIS suivies (preuve r1-B)", () => {
  it("301, 302, 303, 307, 308 vers un AUTRE hôte (ou le même) : 502 passager au moteur, sans verrou ; l'autre hôte ne reçoit RIEN", async () => {
    const other = await scripted(() => ({ result: "0x75bcd15" }));
    try {
      for (const status of [301, 302, 303, 307, 308]) {
        for (const where of ["autre hôte", "même hôte"]) {
          let selfUrl = "";
          const up = await scripted(() => ({ status, headers: { location: where === "autre hôte" ? `${other.url}/vol` : `${selfUrl}/encore` } }));
          selfUrl = up.url;
          const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex });
          try {
            const out = await ask(relay, "eth_getBalance", ["0x0000000000000000000000000000000000007777", at(N)]);
            expect(out.status, `${status} ${where}`).toBe(502);
            expect(relay.violation, `${status} ${where}`).toBeUndefined();
            expect(relay.upstreamFailures, `${status} ${where}`).toBe(1);
            expect(up.calls.length, `${status} ${where}`).toBe(1); // jamais redemandé ailleurs (ni ici)
          } finally {
            await relay.close();
            await up.close();
          }
        }
      }
      expect(other.calls).toEqual([]);
    } finally {
      await other.close();
    }
  });
});

// =====================================================================================================================
// 4. réponses lues en flux, coupées au-delà de la borne
// =====================================================================================================================

describe("4 — réponses lues EN FLUX, coupées au-delà de la borne (preuve r1-E)", () => {
  const A = "0x0000000000000000000000000000000000007777";

  it(`300 Mio (borne par défaut : ${MAX_RESPONSE_BYTES >> 20} Mio) : 502 passager, lecture COUPÉE (le RPC n'a pas pu tout écrire), mémoire bornée — avant : +683 Mio`, async () => {
    const up = await scripted((m) => (m === "eth_getCode" ? { huge: { bytes: 300 << 20 } } : { result: null }));
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex });
    const base = process.memoryUsage().rss;
    let peak = base;
    const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
    try {
      const out = await ask(relay, "eth_getCode", [A, at(N)]);
      clearInterval(t);
      const grew = Math.round((peak - base) / 2 ** 20);
      console.log(`[4] 300 Mio : statut ${out.status} ; octets écrits par le RPC avant la coupure : ${Math.round(up.written() / 2 ** 20)} Mio ; RSS +${grew} Mio au pic`);
      expect(out.status).toBe(502);
      expect(relay.violation).toBeUndefined();
      expect(relay.upstreamFailures).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(up.cutEarly()).toBe(1);
      expect(up.written()).toBeLessThan(MAX_RESPONSE_BYTES + (24 << 20)); // la borne + les tampons du système
      expect(grew).toBeLessThan(256); // mesuré le 9/11 : +93 Mio (avant le correctif : +683 Mio pour la même réponse)
    } finally {
      clearInterval(t);
      await relay.close();
      await up.close();
    }
  }, 120_000);

  it("Content-Length au-delà de la borne : coupé dès les en-têtes ; borne réduite (1 Mio) : 2 Mio → 502, 256 Kio de code → rendu intact", async () => {
    const big = await scripted(() => ({ huge: { bytes: 300 << 20, contentLength: true } }));
    const r1 = await startStrictRelay({ upstream: big.url, blockN: N });
    try {
      const out = await ask(r1, "eth_getCode", [A, at(N)]);
      expect(out.status).toBe(502);
      await new Promise((r) => setTimeout(r, 50));
      expect(big.cutEarly()).toBe(1);
      expect(big.written()).toBeLessThan(32 << 20);
    } finally {
      await r1.close();
      await big.close();
    }
    let bytes = 2 << 20;
    const up = await scripted(() => ({ huge: { bytes } }));
    const r2 = await startStrictRelay({ upstream: up.url, blockN: N, maxResponseBytes: 1 << 20 });
    try {
      expect((await ask(r2, "eth_getCode", [A, at(N)])).status).toBe(502);
      expect(r2.violation).toBeUndefined();
      bytes = 512 << 10; // 256 Kio de code = 512 Ki caractères hexadécimaux
      const ok = await ask(r2, "eth_getCode", [A, at(N)]);
      expect(ok.status).toBe(200);
      expect(ok.json.result.length).toBe(2 + (512 << 10));
      expect(r2.violation).toBeUndefined();
    } finally {
      await r2.close();
      await up.close();
    }
  }, 60_000);

  it("corps au compte-gouttes : le délai du relais coupe la lecture en flux (502 dans le délai, sans verrou)", async () => {
    const up = await scripted(() => ({ trickle: { result: "0x75bcd15", msPerByte: 100 } }));
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, timeoutMs: 1_000 });
    try {
      const t0 = Date.now();
      const out = await ask(relay, "eth_getBalance", [A, at(N)]);
      expect(out.status).toBe(502);
      expect(Date.now() - t0).toBeLessThan(2_500);
      expect(relay.violation).toBeUndefined();
    } finally {
      await relay.close();
      await up.close();
    }
  });
});

// =====================================================================================================================
// 5. mémoire des réponses d'un rejeu
// =====================================================================================================================

describe("5 — mémoire des réponses d'un rejeu : la même lecture rendue avec une autre valeur → verrou « inconsistent » (preuve r1-G (3))", () => {
  const A = "0x000000000000000000000000000000000000aBcD";
  const word = (n: bigint) => pad(numberToHex(n), { size: 32 });

  it("même case relue (même écriture, puis autre écriture de la même case et de l'adresse) avec une autre valeur → « inconsistent », verrou ; la 1re valeur seule a été rendue", async () => {
    for (const second of [[A, "0x1"], [A, "0x01"], [A.toLowerCase(), "0x0000000000000000000000000000000000000000000000000000000000000001"]] as const) {
      let k = 0n;
      const up = await scripted((m) => (m === "eth_getStorageAt" ? { result: word(++k) } : { result: null }));
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, failFast: true });
      try {
        const a = await ask(relay, "eth_getStorageAt", [A, "0x1", at(N)]);
        expect(a.json.result).toBe(word(1n));
        const b = await ask(relay, "eth_getStorageAt", [second[0], second[1], at(N)]);
        expect(b.json.error?.code, second.join(" ")).toBe(RELAY_ERROR_CODE);
        expect(b.json, second.join(" ")).not.toHaveProperty("result");
        expect(relay.violation?.kind, second.join(" ")).toBe("inconsistent");
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("recoupements : solde, nonce et code d'eth_getAccountInfo contre eth_getBalance, eth_getTransactionCount et eth_getCode ; chainId ; un bloc relu avec une autre liste de transactions", async () => {
    const cases: Array<[string, Array<[string, unknown[]]>, (m: string, i: number) => unknown]> = [
      ["solde", [["eth_getAccountInfo", [A, at(N)]], ["eth_getBalance", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x1", code: "0x" } : "0x11")],
      ["nonce", [["eth_getTransactionCount", [A, at(N)]], ["eth_getAccountInfo", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x2", code: "0x" } : "0x1")],
      ["code", [["eth_getCode", [A, at(N)]], ["eth_getAccountInfo", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x1", code: "0x6001" } : "0x")],
      ["chainId", [["eth_chainId", []], ["eth_chainId", []]], (_m, i) => (i === 0 ? "0x4cef52" : "0x1")],
      ["bloc N relu : autre liste de transactions", [["eth_getBlockByNumber", [at(N), false]], ["eth_getBlockByNumber", [at(N), false]]],
        (_m, i) => (i === 0 ? ARC_N : { ...ARC_N, transactions: ARC_N.transactions.slice(1) })],
      ["bloc N − 1 par numéro puis par hash : autre liste de transactions", [["eth_getBlockByNumber", [at(N - 1n), false]], ["eth_getBlockByHash", [ARC_N1.hash, false]]],
        (_m, i) => (i === 0 ? ARC_N1 : { ...ARC_N1, transactions: [] })],
    ];
    for (const [what, reads, value] of cases) {
      let i = 0;
      const up = await scripted((m, p) => {
        if (m === "eth_getBlockByNumber" && BigInt(p[0]) === N && i === 0 && what.startsWith("bloc N − 1")) return { result: ARC_N }; // l'ancre
        return { result: value(m, i++) };
      });
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
      try {
        if (what.startsWith("bloc N − 1")) await relay.anchor();
        const first = await ask(relay, reads[0]![0], reads[0]![1]);
        expect(first.json.result, what).toBeDefined();
        expect(relay.violation, what).toBeUndefined();
        const second = await ask(relay, reads[1]![0], reads[1]![1]);
        expect(second.json.error?.code, what).toBe(RELAY_ERROR_CODE);
        expect(relay.violation?.kind, what).toBe("inconsistent");
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("pas de faux positif : lectures honnêtes répétées (mêmes valeurs, casse de l'hexadécimal comprise), nouvel essai après un échec passager, eth_blockNumber et eth_gasPrice qui changent → aucun verrou", async () => {
    let n = 0;
    let failed = false;
    const up = await scripted((m) => {
      n++;
      if (m === "eth_blockNumber") return { result: numberToHex(N + BigInt(n)) };
      if (m === "eth_gasPrice") return { result: numberToHex(1_000_000_000n + BigInt(n)) };
      if (m === "eth_getStorageAt") return { result: n % 2 ? word(0xabn) : word(0xabn).toUpperCase().replace("0X", "0x") };
      if (m === "eth_getBalance") {
        if (!failed) {
          failed = true;
          return { status: 429 };
        }
        return { result: "0x75bcd15" };
      }
      if (m === "eth_getAccountInfo") return { result: { balance: "0x75bcd15", nonce: "0x1", code: "0x6001" } };
      if (m === "eth_getCode") return { result: "0x6001" };
      return { result: null };
    });
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, failFast: true });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await ask(relay, "eth_blockNumber", [])).json.result).toBeDefined();
        expect((await ask(relay, "eth_gasPrice", [])).json.result).toBeDefined();
        expect((await ask(relay, "eth_getStorageAt", [A, "0x5", at(N)])).json.result).toBeDefined();
      }
      expect((await ask(relay, "eth_getBalance", [A, at(N)])).status).toBe(429); // échec passager, rendu tel quel
      expect((await ask(relay, "eth_getBalance", [A, at(N)])).json.result).toBe("0x75bcd15");
      expect((await ask(relay, "eth_getAccountInfo", [A, at(N)])).json.result).toEqual({ balance: "0x75bcd15", nonce: "0x1", code: "0x6001" });
      expect((await ask(relay, "eth_getCode", [A, at(N)])).json.result).toBe("0x6001");
      expect(relay.violation).toBeUndefined();
    } finally {
      await relay.close();
      await up.close();
    }
  });
});
