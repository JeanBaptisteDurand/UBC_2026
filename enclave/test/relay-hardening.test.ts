/**
 * Sealed Bounty v2.1 quater: the STRICT RELAY against a LYING fork RPC (src/services/rpc-relay.ts). The relay
 * verification of the evening of 14 Nov (cases r1-B, r1-E, r1-G; r2 and r3-1a with the real engines:
 * relay-hardening-engines.test.ts). The relay alone, in front of a scripted fork RPC:
 *  1. the header BOUND to its hash ("arc" policy, the default): keccak256(RLP(21 Arc header fields)) = hash, CHECKED on
 *     two consecutive real Arc testnet blocks (71,609,813 and 71,609,814, read on 14 Nov 2026 around 23:40 from
 *     rpc.testnet.arc.io, as hashes and as full transactions); a header with the right hash but changed content → a
 *     "header" violation; a poisoned parentHash → "header" (or "chain" if the forged block's hash is recomputed);
 *  2. the 21 Arc header fields are mandatory: a block without one of them → "shape" (lock);
 *  3. redirects never followed: a passing 502, the other host receives nothing;
 *  4. answers read as a stream, cut beyond the bound: 300 MiB → 502, the read cut, bounded memory;
 *  5. the memory of a replay's answers: the same read returned with another value → "inconsistent" (lock).
 * Each flaw has its CONTROL when possible ("shape" policy = the earlier contract): the bench does reproduce what the
 * check closes.
 */
import { describe, it, expect } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { keccak256, numberToHex, pad, toBytes, type Hex } from "viem";
import {
  MAX_RESPONSE_BYTES, RELAY_ERROR_CODE, RelayViolation, blockHeaderHash, checkBlockShape, startStrictRelay, type HeaderPolicy, type StrictRelay,
} from "../src/services/rpc-relay";

// =====================================================================================================================
// REAL Arc testnet blocks (read only, 14 Nov 2026 around 23:40, rpc.testnet.arc.io: 6 requests in all)
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
/** Arc testnet, block 71,609,813: the parent of ARC_N. */
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
/** The 3 full transactions of ARC_N (eth_getBlockByNumber(…, true)); the rest of the block is identical. */
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

/** The 21 Arc header fields (London → Prague) and their kind: the protocol's order, that of the RLP behind the hash. */
const FIELDS: Array<[string, "b32" | "addr" | "bloom" | "qty" | "bytes" | "nonce8"]> = [
  ["parentHash", "b32"], ["sha3Uncles", "b32"], ["miner", "addr"], ["stateRoot", "b32"], ["transactionsRoot", "b32"],
  ["receiptsRoot", "b32"], ["logsBloom", "bloom"], ["difficulty", "qty"], ["number", "qty"], ["gasLimit", "qty"],
  ["gasUsed", "qty"], ["timestamp", "qty"], ["extraData", "bytes"], ["mixHash", "b32"], ["nonce", "nonce8"],
  ["baseFeePerGas", "qty"], ["withdrawalsRoot", "b32"], ["blobGasUsed", "qty"], ["excessBlobGas", "qty"],
  ["parentBeaconBlockRoot", "b32"], ["requestsHash", "b32"],
];
/** The fields that were OPTIONAL in v2.1 ter (the relay accepted a block without them). */
const WERE_OPTIONAL = ["baseFeePerGas", "difficulty", "mixHash", "nonce", "sha3Uncles", "withdrawalsRoot", "blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot", "requestsHash"];

/** Another value, of the same shape, for a header field. */
function otherValue(field: string, kind: (typeof FIELDS)[number][1], v: string): string {
  switch (kind) {
    case "b32": return h32(`forged ${field}`);
    case "addr": return "0x00000000000000000000000000000000000000ff";
    case "bloom": return `0x${v[2] === "f" ? "e" : "f"}${v.slice(3)}`;
    case "qty": return numberToHex(BigInt(v) + (field === "timestamp" ? 1000n : 1n));
    case "bytes": return `${v}00`;
    case "nonce8": return "0x0000000000000001";
  }
}

// =====================================================================================================================
// Tools: a scripted fork RPC (JSON-RPC answers, HTTP statuses, giant streamed bodies, trickled bodies)
// =====================================================================================================================

type Reply =
  | { result: unknown }
  | { error: { code: number; message: string } }
  | { status: number; headers?: Record<string, string> }
  | { huge: { bytes: number; contentLength?: boolean } }
  | { trickle: { result: unknown; msPerByte: number } };

/** A scripted fork RPC: `answer(method, params)`; logs the requests, counts the bytes of giant body written. */
async function scripted(answer: (method: string, params: any[]) => Reply) {
  const calls: Array<{ method: string; params: any[]; path: string }> = [];
  let written = 0;
  let cutEarly = 0;
  const CHUNK = Buffer.alloc(1 << 20, "0"); // 1 MiB of "0"
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
        // a valid JSON-RPC answer: a code of `bytes` bytes of hexadecimal (eth_getCode), written as a stream with back-pressure
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

/** A request from the "engine" to the relay: the HTTP status and the JSON body (if any). */
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

/** The real Arc chain (N, N − 1), with `lie(n, full, rank of the read)` that can replace a block. */
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
// 1. the header BOUND to its hash
// =====================================================================================================================

describe("1 — the header BOUND to its hash: keccak256(RLP(21 fields)) = hash (\"arc\" policy, the default)", () => {
  it("REAL Arc testnet blocks: the hash recomputes (hashes and full transactions), N.parentHash = hash(N − 1): accepted", () => {
    expect(blockHeaderHash(ARC_N)).toBe(ARC_N.hash);
    expect(blockHeaderHash(ARC_N1)).toBe(ARC_N1.hash);
    expect(blockHeaderHash(ARC_N_FULL)).toBe(ARC_N.hash);
    expect(ARC_N.parentHash).toBe(ARC_N1.hash);
    expect(ARC_N_TXS.map((t) => t.hash)).toEqual(ARC_N.transactions);
    expect(checkBlockShape("eth_getBlockByNumber", ARC_N, false)).toEqual({ number: N, hash: ARC_N.hash, parentHash: ARC_N1.hash, stateRoot: ARC_N.stateRoot });
    expect(checkBlockShape("eth_getBlockByNumber", ARC_N_FULL, true).hash).toBe(ARC_N.hash);
    expect(checkBlockShape("eth_getBlockByHash", ARC_N1, false).number).toBe(N - 1n);
    // upper-case hexadecimal (same value): same hash
    expect(checkBlockShape("m", { ...ARC_N, stateRoot: ARC_N.stateRoot.toUpperCase().replace("0X", "0x") }, false).hash).toBe(ARC_N.hash);
  });

  it("each of the 21 fields changed at the SAME hash (timestamp, base fee, mixHash, miner, parentHash…) → \"header\"; \"shape\" control: accepted (the flaw)", () => {
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
      // the earlier contract saw nothing: same hash, other content, accepted
      expect(checkBlockShape("eth_getBlockByNumber", forged, false, "shape").hash, field).toBe(ARC_N.hash);
    }
  });

  it("proof r3-1a seen from the relay: the RPC lies on ALL the reads of block N (timestamp +1000 s, same hash) → the anchor itself is refused (\"header\"); \"shape\" control: anchor accepted, forged timestamp returned to the engine", async () => {
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
      expect(seen.json.result.timestamp).toBe(forgedN.timestamp); // the engine would have taken the forged timestamp
      expect(lax.violation).toBeUndefined();
      await lax.close();
    } finally {
      await up.close();
    }
  });

  it("proof r1-G (1): the real chain is served (anchor, N as hashes and full, N − 1), then block N read again at the SAME hash with other content → \"header\", lock, nothing more is forwarded", async () => {
    const up = await scripted(arcChain((n, full, k) => (n === N && !full && k >= 2 ? { ...ARC_N, baseFeePerGas: "0x1", mixHash: h32("other randomness"), miner: "0x00000000000000000000000000000000000000ff" } : undefined)));
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
    try {
      expect(await relay.anchor()).toBe(ARC_N.hash); // first read of block N: healthy
      expect((await ask(relay, "eth_getBlockByNumber", [at(N), true])).json.result).toEqual(ARC_N_FULL);
      expect((await ask(relay, "eth_getBlockByNumber", [at(N - 1n), false])).json.result).toEqual(ARC_N1);
      expect(relay.violation).toBeUndefined();
      const lie = await ask(relay, "eth_getBlockByNumber", [at(N), false]); // second read: same hash, other content
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

  it("proof r1-G (2): a poisoned parentHash; N − 1 at the right hash but with a forged parentHash → \"header\"; N − 1 forged AND rehashed → \"chain\"; forged N − 2 never returned; \"shape\" control: forged N − 2 ACCEPTED", async () => {
    // the forged block N − 2 is itself consistent (its hash is that of its content): only the link N − 1 → N − 2 is forged
    const fakeBody = { ...ARC_N1, number: at(N - 2n), parentHash: h32("x"), stateRoot: h32("forged state") };
    const FAKE = blockHeaderHash(fakeBody);
    const fakeN2 = { ...fakeBody, hash: FAKE };
    const poisoned = { ...ARC_N1, parentHash: FAKE }; // original hash, changed content
    const rehashed = { ...poisoned, hash: blockHeaderHash(poisoned) }; // a consistent header, but not the one N designates
    for (const [what, n1, policy, want] of [
      ["parentHash forged at the same hash", poisoned, "arc", "header"],
      ["parentHash forged, hash recomputed", rehashed, "arc", "chain"],
      ["control: the earlier contract", poisoned, "shape", undefined],
    ] as Array<[string, Record<string, unknown>, HeaderPolicy, string | undefined]>) {
      const up = await scripted(arcChain((n) => (n === N - 1n ? n1 : n === N - 2n ? fakeN2 : undefined)));
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true, headerPolicy: policy });
      try {
        await relay.anchor();
        const n2 = await ask(relay, "eth_getBlockByNumber", [at(N - 2n), false]); // BLOCKHASH(N − 2): the relay walks up N, N − 1
        if (want === undefined) {
          expect(n2.json.result?.hash, what).toBe(FAKE); // the old flaw: a forged BLOCKHASH(N − 2), without a lock
          expect(relay.violation, what).toBeUndefined();
        } else {
          expect(n2.json.error?.code, what).toBe(RELAY_ERROR_CODE);
          expect(n2.json, what).not.toHaveProperty("result"); // the forged BLOCKHASH(N − 2) is never returned to the engine
          expect(relay.violation?.kind, what).toBe(want);
        }
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("eth_getBlockByHash: the same check (a block requested by hash with changed content → \"header\"); an honest fork RPC read several times: no violation", async () => {
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
// 2. the 21 Arc header fields are mandatory
// =====================================================================================================================

describe("2 — Arc header fields MANDATORY (missing → invalid answer → lock)", () => {
  it("a real Arc block missing one of the 21 fields (or a field set to null) → \"shape\"; \"shape\" control: the 10 formerly optional fields could be missing", () => {
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
    // a missing hash: always refused
    const { hash: _h, ...noHash } = ARC_N;
    expect(() => checkBlockShape("m", noHash, false)).toThrow(expect.objectContaining({ kind: "shape" }));
  });

  it("proofs r2 / r3-1b seen from the relay: block N WITHOUT baseFeePerGas (then without mixHash) served to the engine after a healthy anchor → a JSON-RPC error, \"shape\" lock", async () => {
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
// 3. redirects never followed
// =====================================================================================================================

describe("3 — redirects of the fork's RPC: NEVER followed (proof r1-B)", () => {
  it("301, 302, 303, 307, 308 to ANOTHER host (or the same one): a passing 502 to the engine, without a lock; the other host receives NOTHING", async () => {
    const other = await scripted(() => ({ result: "0x75bcd15" }));
    try {
      for (const status of [301, 302, 303, 307, 308]) {
        for (const where of ["another host", "same host"]) {
          let selfUrl = "";
          const up = await scripted(() => ({ status, headers: { location: where === "another host" ? `${other.url}/elsewhere` : `${selfUrl}/again` } }));
          selfUrl = up.url;
          const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex });
          try {
            const out = await ask(relay, "eth_getBalance", ["0x0000000000000000000000000000000000007777", at(N)]);
            expect(out.status, `${status} ${where}`).toBe(502);
            expect(relay.violation, `${status} ${where}`).toBeUndefined();
            expect(relay.upstreamFailures, `${status} ${where}`).toBe(1);
            expect(up.calls.length, `${status} ${where}`).toBe(1); // never requested again elsewhere (nor here)
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
// 4. answers read as a stream, cut beyond the bound
// =====================================================================================================================

describe("4 — answers read AS A STREAM, cut beyond the bound (proof r1-E)", () => {
  const A = "0x0000000000000000000000000000000000007777";

  it(`300 MiB (default bound: ${MAX_RESPONSE_BYTES >> 20} MiB): a passing 502, the read CUT (the RPC could not write everything), bounded memory; before: +683 MiB`, async () => {
    const up = await scripted((m) => (m === "eth_getCode" ? { huge: { bytes: 300 << 20 } } : { result: null }));
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex });
    const base = process.memoryUsage().rss;
    let peak = base;
    const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
    try {
      const out = await ask(relay, "eth_getCode", [A, at(N)]);
      clearInterval(t);
      const grew = Math.round((peak - base) / 2 ** 20);
      console.log(`[4] 300 MiB: status ${out.status}; bytes written by the RPC before the cut: ${Math.round(up.written() / 2 ** 20)} MiB; RSS +${grew} MiB at the peak`);
      expect(out.status).toBe(502);
      expect(relay.violation).toBeUndefined();
      expect(relay.upstreamFailures).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(up.cutEarly()).toBe(1);
      expect(up.written()).toBeLessThan(MAX_RESPONSE_BYTES + (24 << 20)); // the bound + the system's buffers
      expect(grew).toBeLessThan(256); // measured on 14 Nov: +93 MiB (before the fix: +683 MiB for the same answer)
    } finally {
      clearInterval(t);
      await relay.close();
      await up.close();
    }
  }, 120_000);

  it("Content-Length beyond the bound: cut from the headers; a reduced bound (1 MiB): 2 MiB → 502, 256 KiB of code → returned intact", async () => {
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
      bytes = 512 << 10; // 256 KiB of code = 512 Ki hexadecimal characters
      const ok = await ask(r2, "eth_getCode", [A, at(N)]);
      expect(ok.status).toBe(200);
      expect(ok.json.result.length).toBe(2 + (512 << 10));
      expect(r2.violation).toBeUndefined();
    } finally {
      await r2.close();
      await up.close();
    }
  }, 60_000);

  it("a trickled body: the relay's timeout cuts the streamed read (502 within the timeout, without a lock)", async () => {
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
// 5. the memory of a replay's answers
// =====================================================================================================================

describe("5 — the memory of a replay's answers: the same read returned with another value → \"inconsistent\" lock (proof r1-G (3))", () => {
  const A = "0x000000000000000000000000000000000000aBcD";
  const word = (n: bigint) => pad(numberToHex(n), { size: 32 });

  it("the same slot read again (same spelling, then another spelling of the same slot and address) with another value → \"inconsistent\", lock; only the first value was returned", async () => {
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

  it("cross-checks: balance, nonce and code of eth_getAccountInfo against eth_getBalance, eth_getTransactionCount and eth_getCode; chainId; a block read again with another list of transactions", async () => {
    const cases: Array<[string, Array<[string, unknown[]]>, (m: string, i: number) => unknown]> = [
      ["balance", [["eth_getAccountInfo", [A, at(N)]], ["eth_getBalance", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x1", code: "0x" } : "0x11")],
      ["nonce", [["eth_getTransactionCount", [A, at(N)]], ["eth_getAccountInfo", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x2", code: "0x" } : "0x1")],
      ["code", [["eth_getCode", [A, at(N)]], ["eth_getAccountInfo", [A, at(N)]]], (m) => (m === "eth_getAccountInfo" ? { balance: "0x10", nonce: "0x1", code: "0x6001" } : "0x")],
      ["chainId", [["eth_chainId", []], ["eth_chainId", []]], (_m, i) => (i === 0 ? "0x4cef52" : "0x1")],
      ["block N read again: another list of transactions", [["eth_getBlockByNumber", [at(N), false]], ["eth_getBlockByNumber", [at(N), false]]],
        (_m, i) => (i === 0 ? ARC_N : { ...ARC_N, transactions: ARC_N.transactions.slice(1) })],
      ["block N − 1 by number then by hash: another list of transactions", [["eth_getBlockByNumber", [at(N - 1n), false]], ["eth_getBlockByHash", [ARC_N1.hash, false]]],
        (_m, i) => (i === 0 ? ARC_N1 : { ...ARC_N1, transactions: [] })],
    ];
    for (const [what, reads, value] of cases) {
      let i = 0;
      const up = await scripted((m, p) => {
        if (m === "eth_getBlockByNumber" && BigInt(p[0]) === N && i === 0 && what.startsWith("block N − 1")) return { result: ARC_N }; // the anchor
        return { result: value(m, i++) };
      });
      const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: ARC_N.hash as Hex, failFast: true });
      try {
        if (what.startsWith("block N − 1")) await relay.anchor();
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

  it("no false positive: honest repeated reads (same values, hexadecimal case included), a new attempt after a passing failure, eth_blockNumber and eth_gasPrice that change → no lock", async () => {
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
      expect((await ask(relay, "eth_getBalance", [A, at(N)])).status).toBe(429); // a passing failure, returned as it is
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
