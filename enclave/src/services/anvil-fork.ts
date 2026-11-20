/**
 * anvil-fork.ts — the REAL replay of the Sealed Bounty: a fork of Arc at block N (anvil), the exploit run from the
 * hunter's address, then the predicate measured before and after on the fork's real state.
 *
 * Why a USDC emulator: on Arc, the USDC ERC-20 (0x3600…) mirrors the native balance, and its transfers go through a
 * system precompile (0x1800…) that plain anvil lacks; without it, every USDC transfer fails in the fork. With plain
 * anvil, the replay therefore replaces the code of 0x3600 IN THE FORK with ArcUsdcShim (contracts/src/fork), which keeps
 * Arc's semantics (balance = native / 1e12 + ERC-20 transfers, real allowances read at block N).
 *
 * Determinism (k enclaves must find the same loss and the same fingerprint): the same block N, gas at zero price,
 * timestamps pinned to block N's (+1 s per transaction), no balance injected beyond the declared capital.
 *
 * Format of an exploit transaction (bundle.txs[i]): abi.encode(address to, uint256 value, bytes data), sent from
 * bundle.payee (impersonated in the fork only). bundle.attackCode, if present, is deployed first from the same address
 * (contract address = getContractAddress(payee, nonce at block N)).
 *
 * v2.1 bis (adversarial review of 9 Nov): THE REPLAY FAILS CLOSED. A replay returns either MEASUREMENTS (deterministic:
 * the same state at block N, the same exploit) or a typed exception, never an invented value:
 *  - ReplayRuleError: a deterministic replay rule is broken (validateBundle: number, size and format of the
 *    transactions, attack code, capital); fixed message;
 *  - ReplayUnavailableError: everything else (the fork's RPC in error, even for ONE read; a timeout; anvil stopped; an
 *    unreadable answer; a full queue; a fork RPC that does not serve the claim's block N, with a different hash).
 *    Nothing is signed (neither a claim nor a refutation: HTTP 503).
 *  Only a DETERMINISTIC EVM revert (JSON-RPC error code 3 "execution reverted", EIP-1474) of a VIEW_CHANGED /
 *  INVARIANT_BROKEN clause read stays a value, under the v0 rule: view = 0, invariant not held. An exceptional EVM halt
 *  (OutOfGas, InvalidFEOpcode…) comes back from anvil with the SAME code -32603 as an outage of the fork's RPC ("failed
 *  to get storage …"): they cannot be told apart, so they fail closed (checked on anvil 1.5.1, on 9 Nov).
 *  Balance reads (ERC-20, native) fail closed on any error, revert included (unchanged).
 *
 * v2.1 ter (adversarial verification of 9 Nov, proofs verif-failclosed e1, matrices, e7), the STRICT RELAY
 * (rpc-relay.ts): the engine no longer talks to the fork's RPC but to a local relay that checks the shape of each
 * answer (a block ≤ N that is never null and is tied to the anchor, 32-byte storage, canonical quantities…), refuses
 * any other method and counts the replay's requests (BUDGET, default DEFAULT_MAX_FORK_REQUESTS). The relay remembers
 * the slightest INVALID answer: the replay fails closed (ReplayUnavailableError "relay" or "budget"), even if the
 * engine then retried successfully. A PASSING failure of the fork's RPC (JSON-RPC error, HTTP 429/503, network) goes
 * back to the engine as it is; the engine fails (closed, as before) or retries (and the retried answer is checked).
 * The hash of block N as the engine loaded it is compared with the anchor. The start-up check (selfTest) also checks
 * that a block returned as null and a malformed storage answer surface as errors, and that healthy reads pass (a
 * positive check).
 *
 * v2.1 quater (relay verification, evening of 9 Nov: proofs r3-1a, r2, r1-B, r1-E, r1-G), a LYING RPC: the relay BINDS
 * the content of each header to its hash ("arc" policy, the default: 21 Arc header fields required, keccak256(RLP) =
 * hash). With the anchor, the timestamp, the base fee, PREVRANDAO, the miner of block N and BLOCKHASH(N − k) are those
 * of the real chain (before, a block N with the right hash but a shifted timestamp got a false claim signed). The relay
 * no longer follows redirects, reads answers as bounded streams, and refuses one read returned with two values. At
 * start-up, the engine check requires block N of the fork's RPC to pass this contract (otherwise the header format
 * has changed: the enclave refuses to start, rather than serve replays that all end in 503).
 */
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import {
  BaseError, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256, numberToHex, pad, parseAbi, toBytes,
  type Address, type Hex,
} from "viem";
import type { EvalContext, Clause } from "./predicate";
import { ReplayRuleError, ReplayUnavailableError, type ExploitBundle, type ForkRunner } from "./bounty";
import { ARC_USDC_SHIM_RUNTIME } from "../fork/arc-usdc-shim";
import {
  DEFAULT_MAX_FORK_REQUESTS, MAX_RESPONSE_BYTES, RELAY_TIMEOUT_MS, RelayViolation, UpstreamFailure, readBodyBounded, startStrictRelay,
  type HeaderPolicy, type StrictRelay,
} from "./rpc-relay";

export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
/** The implementation of Arc testnet's USDC (if the trace succeeds and shows no DELEGATECALL). */
const ARC_USDC_IMPL_TESTNET: Address = "0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6";
const IMPL_SLOT = keccak256(toBytes("archive.fork.usdc.impl"));
export const MAX_TXS = 10;
export const MAX_TX_BYTES = 64 * 1024;
export const MAX_CODE_BYTES = 48 * 1024;
export const MAX_CAPITAL = 10n ** 15n;
export { DEFAULT_MAX_FORK_REQUESTS };
const TX_GAS = 15_000_000n;
/** The hunter's gas advance in an arc-anvil fork (USDC, 6 decimals; it exists only in the fork): the node reserves
 *  gas × maxFee per transaction (15 M × 100 gwei = 1.5 USDC); 20 USDC cover the 11 possible transactions. */
const GAS_ALLOWANCE_USDC6 = 20_000_000n;
const MAX_FEE_WEI = 100_000_000_000n; // 100 gwei: a cap (Arc's base fee ≈ 20 gwei); the price paid stays the base fee
/** The maximum number of pending replays (a global queue shared by /bounty/submit and /v1/refute); beyond: 503, nothing signed. */
export const DEFAULT_MAX_QUEUED = 8;
/** Sentinel account and slots of the start-up engine check (selfTest); never read by a replay. */
export const SELFTEST_ACCOUNT: Address = "0x5e1f7e5700000000000000000000000000005e1f";
export const SELFTEST_SLOT: Hex = keccak256(toBytes("archive.fork.selftest"));
const SELFTEST_SLOT_CALL: Hex = keccak256(toBytes("archive.fork.selftest.call"));
const SELFTEST_SLOT_TX: Hex = keccak256(toBytes("archive.fork.selftest.tx"));
/** v2.1 ter: the slot for which the (simulated) fork RPC returns a MALFORMED answer ("0x" instead of 32 bytes). */
const SELFTEST_SLOT_MALFORMED: Hex = keccak256(toBytes("archive.fork.selftest.malformed"));
/** v2.1 ter: the age (below N) of the block that the (simulated) fork RPC returns as null during the start-up check. */
const SELFTEST_NULL_AGE = 2n;
/** Code of the sentinel account: without data, returns SLOAD(SLOT_CALL); with data, SSTORE(1, SLOAD(SLOT_TX)). */
const SELFTEST_CODE = `0x3615602b577f${SELFTEST_SLOT_TX.slice(2)}54600155005b7f${SELFTEST_SLOT_CALL.slice(2)}5460005260206000f3` as Hex;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const EXPLOIT_TX_PARAMS = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
] as const;

/** Encodes an exploit transaction in the format the replay expects. */
export function encodeExploitTx(tx: { to: Address; value?: bigint; data: Hex }): Hex {
  return encodeAbiParameters(EXPLOIT_TX_PARAMS, [tx.to, tx.value ?? 0n, tx.data]);
}

/** The fingerprint of an exploit: its content (attack code + transactions), independent of block N and of the hunter. */
export function exploitFingerprint(bundle: Pick<ExploitBundle, "txs" | "attackCode">): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32[]" }],
    [keccak256(bundle.attackCode ?? "0x"), bundle.txs.map((t) => keccak256(t))],
  ));
}

/** Init code (eth_call without a recipient) that returns BLOCKHASH(n) on 32 bytes. */
function blockhashCallData(n: bigint): Hex {
  return `0x67${n.toString(16).padStart(16, "0")}4060005260206000f3` as Hex;
}

export interface AnvilForkOptions {
  /** The Arc RPC to fork (read only). */
  forkUrl: string;
  /** The anvil binary (default: "anvil" in the PATH). */
  anvilBin?: string;
  usdc?: Address;
  /** The maximum duration of a replay (default 120 s). Beyond it: ReplayUnavailableError, nothing is signed. */
  timeoutMs?: number;
  /** "arc": the arc-anvil binary of Arc Foundry (circlefin/arc-foundry), --network arc: Arc's precompiles (native USDC,
   *  blocklist, EIP-7708 logs) run FOR REAL, with no emulation; gas is paid at Arc's base fee (not adjustable), from a
   *  gas advance given to the hunter and taken back from the profit. "anvil": plain anvil + ArcUsdcShim (emulation of
   *  Arc's USDC), gas at zero price. Default: "arc" if the binary is named arc-anvil. */
  engine?: "arc" | "anvil";
  /** The maximum number of pending replays (default DEFAULT_MAX_QUEUED). */
  maxQueued?: number;
  /** v2.1 ter: requests to the fork's RPC per replay, relay included (default DEFAULT_MAX_FORK_REQUESTS); beyond: it
   *  fails CLOSED (ReplayUnavailableError "budget", 503), never "not proven" (the number of reads depends on the engine
   *  and its cache: it is not a deterministic rule). */
  maxForkRequests?: number;
  /** v2.1 quater: the strict relay's header contract (default "arc": 21 Arc header fields required, the header bound to
   *  its hash). "shape": TESTS ONLY (a scripted fork RPC with synthetic blocks): the content of the headers is no
   *  longer bound to the anchor (proof r3-1a). */
  headerPolicy?: HeaderPolicy;
  /** 10 Nov: the RPC for STATE PROOFS (eth_getProof at block N; our Arc node or any other, not trusted). When present,
   *  each state read of the replay is proven against the stateRoot of the anchored header N (strict relay, option
   *  stateProofs); a false proof makes the replay fail (nothing is signed), and so does an unavailable proof (fail closed). */
  stateProofsUrl?: string;
  /** Log (default: console). Never any content of the exploit (neither the transactions nor their number). */
  log?: (msg: string) => void;
}

/** One replay at a time: each replay starts its own anvil (memory, RPC), so the replays wait in a queue. */
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;

/** v2.1 ter: a violation of the strict relay → ReplayUnavailableError (fixed message; the violation as the cause). */
export function relayFailure(v: RelayViolation, phase: "anchor" | "replay" = "replay"): ReplayUnavailableError {
  if (v.kind === "budget") {
    return new ReplayUnavailableError("budget", "replay: the read budget of the fork's RPC is exceeded: nothing is signed", { cause: v });
  }
  if (phase === "anchor" && (v.kind === "chain" || v.kind === "null_block" || v.kind === "shape" || v.kind === "header")) {
    return new ReplayUnavailableError("anchor", "the fork's RPC does not serve the claim's block N (different or missing hash): nothing is signed", { cause: v });
  }
  return new ReplayUnavailableError("relay", "an answer of the fork's RPC was refused by the strict relay: nothing is signed", { cause: v });
}

/** The calls to the engine, guarded by the relay: a violation (even one the engine absorbed) makes the call fail. */
function guarded(rpc: Rpc, relay: StrictRelay): Rpc {
  return async (method, params) => {
    let out: unknown;
    try {
      out = await rpc(method, params);
    } catch (e) {
      if (relay.violation) throw relayFailure(relay.violation);
      throw e;
    }
    if (relay.violation) throw relayFailure(relay.violation);
    return out;
  };
}

export class AnvilForkRunner implements ForkRunner {
  private usdc: Address;
  private bin: string;
  private log: (msg: string) => void;
  constructor(private o: AnvilForkOptions) {
    this.usdc = (o.usdc ?? ARC_USDC).toLowerCase() as Address;
    this.bin = o.anvilBin ?? "anvil";
    this.log = o.log ?? ((m) => console.log(m));
    this.engine = o.engine ?? (/arc-anvil$/.test(this.bin) ? "arc" : "anvil");
  }
  readonly engine: "arc" | "anvil";

  /** v2.1: the deterministic replay rules on a bundle (without replaying anything); throws ReplayRuleError if refused. */
  validate(bundle: ExploitBundle): void {
    validateBundle(bundle);
  }

  run(input: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    if (queued >= (this.o.maxQueued ?? DEFAULT_MAX_QUEUED)) {
      return Promise.reject(new ReplayUnavailableError("busy", "replay queue full: try again later (nothing is signed)"));
    }
    queued++;
    const job = queue.then(() => this.runOnce(input)).finally(() => {
      queued--;
    });
    queue = job.catch(() => undefined);
    return job;
  }

  private async runOnce(input: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    validateBundle(input.bundle); // ReplayRuleError: a deterministic rule
    try {
      return await this.replay(input);
    } catch (e) {
      if (e instanceof ReplayRuleError || e instanceof ReplayUnavailableError) throw e;
      // everything else is an outage: never a measurement, never a signature. v2.1 ter: an outage of the engine or of its
      // transport is a replay failure ("rpc", slowed down); any other exception (environment, unexpected): 503 without
      // caching anything ("internal")
      this.log(`replay at block ${input.blockN}: failed (${describeFailure(e)}); nothing is signed`);
      throw new ReplayUnavailableError(isTransportFailure(e) ? "rpc" : "internal", "replay failed (the fork's RPC or the engine is in error): nothing is signed", { cause: e });
    }
  }

  private async replay({ blockN, bundle, expectedBlockHash }: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    // v2.1 ter: the engine talks only to the strict relay (one per replay: its budget, its anchor, its violation lock)
    const relay = await startStrictRelay({
      upstream: this.o.forkUrl, blockN, anchorHash: expectedBlockHash, maxRequests: this.o.maxForkRequests, timeoutMs: RELAY_TIMEOUT_MS, failFast: true,
      headerPolicy: this.o.headerPolicy,
      ...(this.o.stateProofsUrl ? { stateProofs: { upstream: this.o.stateProofsUrl } } : {}),
      ...(this.engine === "arc" ? { expectedChainId: 5042002 } : {}), // 11 Nov: the replay's CHAINID is pinned (Arc), not a lying RPC's
    });
    let fork: Awaited<ReturnType<AnvilForkRunner["spawnFork"]>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 0. does the fork's RPC serve the claim's chain? The hash of block N read by the relay (shape checked) is compared
      //    with the anchor (verified by the quorum for a claim, and by EIP-2935 on-chain for an accepted claim)
      if (expectedBlockHash !== undefined) {
        try {
          await relay.anchor();
        } catch (e) {
          if (e instanceof RelayViolation) throw relayFailure(e, "anchor");
          if (e instanceof UpstreamFailure) throw new ReplayUnavailableError("rpc", "the fork's RPC is in error (block N): nothing is signed", { cause: e });
          throw e;
        }
      }
      const arc = this.engine === "arc";
      fork = await this.spawnFork(relay.url, blockN);
      const { alive, stop, stderr } = fork;
      const rpc = guarded(fork.rpc, relay);
      const timeoutMs = this.o.timeoutMs ?? 120_000;
      const deadline = Date.now() + timeoutMs;
      timer = setTimeout(stop, timeoutMs + 5_000);
      await waitReady(rpc, alive, stderr, () => {
        if (relay.violation) throw relayFailure(relay.violation);
      });
      const head = BigInt(await rpc("eth_blockNumber", []) as string);
      if (head !== blockN) throw new ReplayUnavailableError("rpc", "fork at the wrong block: nothing is signed");
      const blockAtN = (await rpc("eth_getBlockByNumber", [numberToHex(blockN), false])) as any;
      if (!blockAtN || typeof blockAtN.timestamp !== "string" || typeof blockAtN.hash !== "string") {
        throw new ReplayUnavailableError("rpc", "block N unreadable in the fork: nothing is signed");
      }
      // v2.1 ter: block N as the ENGINE loaded it (time, base fee…) is indeed the anchor's
      if (expectedBlockHash !== undefined && blockAtN.hash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
        throw new ReplayUnavailableError("anchor", "the engine did not load the claim's block N (different hash): nothing is signed");
      }
      const tsN = BigInt(blockAtN.timestamp);

      // 1. Arc's USDC: native with arc-anvil (real precompiles); emulated in the fork only, with plain anvil
      if (!arc) {
        const impl = await this.usdcImplementation(rpc);
        await rpc("anvil_setCode", [this.usdc, ARC_USDC_SHIM_RUNTIME]);
        await rpc("anvil_setStorageAt", [this.usdc, IMPL_SLOT, pad(impl, { size: 32 })]);
      }

      // 2. the declared capital becomes the hunter's native balance; with arc-anvil, plus a fixed gas advance (Arc's base
      //    fee cannot be changed), taken back from the profit afterwards: the measured profit is net of gas, as on the real chain
      const payee = bundle.payee.toLowerCase() as Address;
      const allowance = arc ? GAS_ALLOWANCE_USDC6 : 0n;
      await rpc("anvil_setBalance", [payee, numberToHex((bundle.capital + allowance) * 10n ** 12n)]);

      // 3. measurements before
      const reads = plannedReads(bundle.predicate.clauses, payee, this.usdc);
      const before = await this.measure(rpc, reads);

      // 4. the exploit: the attack code if any, then the transactions, from the hunter, with pinned timestamps
      let t = tsN;
      const send = async (tx: { to?: Address; value: bigint; data: Hex }) => {
        if (Date.now() > deadline) throw new ReplayUnavailableError("timeout", "replay too long: nothing is signed");
        t += 1n;
        await rpc("evm_setNextBlockTimestamp", [numberToHex(t)]);
        const hash = await rpc("eth_sendTransaction", [{
          from: payee, ...(tx.to ? { to: tx.to } : {}), value: numberToHex(tx.value), data: tx.data, gas: numberToHex(TX_GAS),
          // arc-anvil: EIP-1559 without a tip → price paid = Arc's base fee, deterministic from one enclave to the next
          ...(arc ? { type: "0x2", maxFeePerGas: numberToHex(MAX_FEE_WEI), maxPriorityFeePerGas: "0x0" } : { gasPrice: "0x0", type: "0x0" }),
        }]) as Hex;
        // anvil answers before mining: wait for the receipt (otherwise the "after" measurement would depend on chance); an
        // outage of the fork's RPC during the transaction leaves it unmined: fail closed
        for (let i = 0; i < 200; i++) {
          const r = await rpc("eth_getTransactionReceipt", [hash]) as any;
          if (r) return r.status === "0x1";
          await new Promise((res) => setTimeout(res, 50));
        }
        throw new ReplayUnavailableError("rpc", "replay transaction never mined: nothing is signed");
      };
      if (bundle.attackCode && bundle.attackCode !== "0x") await send({ value: 0n, data: bundle.attackCode });
      for (const raw of bundle.txs) {
        const [to, value, data] = decodeAbiParameters(EXPLOIT_TX_PARAMS, raw);
        await send({ to, value, data });
      }

      // 5. measurements after
      const after = await this.measure(rpc, reads);
      // a replay that went past its deadline, or whose anvil was stopped, is worth nothing (even if complete): fail closed
      if (Date.now() > deadline) throw new ReplayUnavailableError("timeout", "replay too long: nothing is signed");
      if (!alive()) throw new ReplayUnavailableError("process", "anvil stopped during the replay: nothing is signed");
      // v2.1 ter: one single invalid answer of the fork's RPC during the whole replay (even absorbed by the engine): nothing is signed
      if (relay.violation) throw relayFailure(relay.violation);
      this.log(`replay at block ${blockN} (${arc ? "arc-anvil, Arc's native precompiles" : "anvil + USDC emulation"}): done`);
      return { ctx: buildContext(before, after, bundle.capital + allowance, payee, this.usdc), fingerprint: exploitFingerprint(bundle) };
    } finally {
      if (timer) clearTimeout(timer);
      fork?.stop();
      await relay.close();
    }
  }

  /**
   * v2.1 bis: the ENGINE CHECK, to run at start-up (the image's binary, arc-anvil, has not been tested outside it).
   * Chain: engine → strict relay → fault proxy → the fork's RPC. The proxy REFUSES three storage reads of a sentinel
   * account; the engine must:
   *  1. return an ERROR for a direct read (eth_getStorageAt);
   *  2. return an ERROR, not a revert (code 3), for an eth_call whose execution reads the refused slot;
   *  3. NEVER mine a transaction whose execution reads the refused slot (the replay waits for it, then fails closed).
   * v2.1 ter: the proxy also returns INVALID answers that the engine used to take for values (proofs e1, matrices); the
   * relay must refuse them and the engine must return ERRORS:
   *  4. a storage slot returned as "0x" (not 32 bytes): direct read;
   *  5. a recent block returned as null: BLOCKHASH of that block (eth_call);
   *  6. a POSITIVE check: BLOCKHASH(N − 1) and the balance of block N's miner, read by the engine, are those of the
   *     fork's RPC (the relay lets healthy answers through; otherwise every replay would fail).
   * A refused read returned as a value, a revert or a mined transaction = the engine swallows the fork RPC's failures:
   * any replay could be wrong without anything saying so → throws (the service refuses to start). If a read does not
   * reach the proxy (the engine's cache), the point is "inconclusive" (logged), except the direct reads, which are
   * required. Also returns the JSON-RPC code of a revert (expected: 3). Tests: `simulateSwallow` (the proxy returns a
   * well-formed false value for slots 1–3), `simulateLaxRelay` (a transparent relay: points 4 and 5 must fail).
   */
  async selfTest(o: { simulateSwallow?: boolean; simulateLaxRelay?: boolean } = {}): Promise<{ blockN: bigint; revertCode: number | undefined; checks: string[] }> {
    const head = BigInt((await jsonRpc(this.o.forkUrl, RELAY_TIMEOUT_MS)("eth_blockNumber", [])) as string);
    const blockN = head > 2n ? head - 2n : head;
    const nullBlock = blockN > SELFTEST_NULL_AGE ? blockN - SELFTEST_NULL_AGE : undefined;
    const refused = [SELFTEST_SLOT, SELFTEST_SLOT_CALL, SELFTEST_SLOT_TX].map((x) => BigInt(x));
    const malformed = BigInt(SELFTEST_SLOT_MALFORMED);
    const seen = new Set<string>();
    const proxy = await faultProxy(this.o.forkUrl, (q) => {
      if (q?.method === "eth_getStorageAt" && String(q.params?.[0]).toLowerCase() === SELFTEST_ACCOUNT.toLowerCase() && typeof q.params?.[1] === "string") {
        const slot = BigInt(q.params[1]);
        if (refused.includes(slot)) {
          seen.add(`slot:${slot}`);
          return o.simulateSwallow
            ? { result: pad("0x2a", { size: 32 }) }
            : { error: { code: -32000, message: "missing trie node (engine check)" } };
        }
        if (slot === malformed) {
          seen.add("malformed");
          return { result: "0x" };
        }
      }
      if (nullBlock !== undefined && q?.method === "eth_getBlockByNumber" && typeof q.params?.[0] === "string" && BigInt(q.params[0]) === nullBlock) {
        seen.add("null");
        return { result: null };
      }
      return undefined;
    });
    const relay = await startStrictRelay({
      upstream: proxy.url, blockN, maxRequests: this.o.maxForkRequests, timeoutMs: RELAY_TIMEOUT_MS, failFast: false, checks: !o.simulateLaxRelay,
      headerPolicy: this.o.headerPolicy,
    });
    let fork: Awaited<ReturnType<AnvilForkRunner["spawnFork"]>> | undefined;
    const swallowed = (what: string) =>
      new Error(`engine check: ${what}; the engine swallows the fork RPC's failures, so any replay could be wrong: refusing to start`);
    const kinds = () => new Set(relay.violations.map((v) => v.kind));
    const checks: string[] = [];
    try {
      // v2.1 quater: does block N of the fork's RPC pass the relay's header contract ("arc" policy: 21 Arc header
      // fields, keccak256(RLP(header)) = hash)? Otherwise the header format has changed (a new field?): every replay
      // would fail closed (503); say so at once, with the reason, and refuse to start
      if (!o.simulateLaxRelay) {
        try {
          await relay.call("eth_getBlockByNumber", [numberToHex(blockN), false]);
        } catch (e) {
          if (!(e instanceof RelayViolation)) throw e;
          const why = e.kind === "header" || e.kind === "shape" ? ": unexpected header format (a new field?)" : "";
          throw new Error(`engine check: block N of the fork's RPC is refused by the strict relay (${e.kind}${why}): every replay would fail closed: refusing to start`, { cause: e });
        }
      }
      fork = await this.spawnFork(relay.url, blockN);
      const { rpc, alive } = fork;
      await waitReady(rpc, alive, () => "");
      // 1. direct read (required)
      let ok1 = false;
      try {
        await rpc("eth_getStorageAt", [SELFTEST_ACCOUNT, SELFTEST_SLOT, "latest"]);
      } catch (e) {
        ok1 = !isEvmRevert(e);
      }
      if (!seen.has(`slot:${BigInt(SELFTEST_SLOT)}`)) throw new Error("engine check: the sentinel read did not reach the fork's RPC (unexpected cache): refusing to start");
      if (!ok1) throw swallowed("a read REFUSED by the fork's RPC is returned as a value");
      checks.push("direct read: error");

      // 4. and 5. (v2.1 ter): invalid answers of the fork's RPC; all the swallowed cases are reported together
      const bad: string[] = [];
      let ok4 = false;
      try {
        await rpc("eth_getStorageAt", [SELFTEST_ACCOUNT, SELFTEST_SLOT_MALFORMED, "latest"]);
      } catch (e) {
        ok4 = !isEvmRevert(e);
      }
      if (!seen.has("malformed")) throw new Error("engine check: the \"malformed\" read did not reach the fork's RPC (unexpected cache): refusing to start");
      if (!ok4) bad.push("a MALFORMED storage slot (\"0x\") is returned as a value");
      else if (!o.simulateLaxRelay && !kinds().has("shape")) throw new Error("engine check: the strict relay did not refuse a malformed storage slot: refusing to start");
      let nullChecked = false;
      if (nullBlock !== undefined) {
        let ok5 = false;
        try {
          await rpc("eth_call", [{ data: blockhashCallData(nullBlock) }, "latest"]);
        } catch (e) {
          ok5 = !isEvmRevert(e);
        }
        if (seen.has("null")) {
          nullChecked = true;
          if (!ok5) bad.push("a block returned as NULL by the fork's RPC gives a BLOCKHASH (keccak256(\"\") or zero) instead of an error");
          else if (!o.simulateLaxRelay && !kinds().has("null_block")) throw new Error("engine check: the strict relay did not refuse a block returned as null: refusing to start");
        }
      }
      if (bad.length > 0) throw swallowed(bad.join(" ; "));
      checks.push("malformed storage: error (relay)");
      checks.push(nullChecked ? "null block: error (relay)" : "null block: inconclusive (read not forwarded)");

      // 6. POSITIVE check: healthy reads pass the relay and give the fork RPC's values
      if (blockN > 0n) {
        const prev = await relay.call("eth_getBlockByNumber", [numberToHex(blockN - 1n), false]) as { hash: string };
        const word = await rpc("eth_call", [{ data: blockhashCallData(blockN - 1n) }, "latest"]);
        if (typeof word !== "string" || word.toLowerCase() !== prev.hash.toLowerCase()) {
          throw new Error("engine check: BLOCKHASH(N − 1) read by the engine is not the fork RPC's: refusing to start");
        }
      }
      const atN = await relay.call("eth_getBlockByNumber", [numberToHex(blockN), false]) as { miner: Address };
      const [viaEngine, direct] = [await rpc("eth_getBalance", [atN.miner, "latest"]), await relay.call("eth_getBalance", [atN.miner, numberToHex(blockN)])];
      if (typeof viaEngine !== "string" || typeof direct !== "string" || BigInt(viaEngine) !== BigInt(direct)) {
        throw new Error("engine check: a balance read by the engine is not the fork RPC's: refusing to start");
      }
      checks.push("positive check: BLOCKHASH and balance identical to the fork's RPC");

      // 2. and 3.: the sentinel account's code reads a refused slot (view: SLOT_CALL; transaction: SLOT_TX)
      await rpc("anvil_setCode", [SELFTEST_ACCOUNT, SELFTEST_CODE]);
      let ok2: boolean;
      try {
        await rpc("eth_call", [{ to: SELFTEST_ACCOUNT, data: "0x" }, "latest"]);
        ok2 = false;
      } catch (e) {
        ok2 = !isEvmRevert(e);
      }
      if (seen.has(`slot:${BigInt(SELFTEST_SLOT_CALL)}`)) {
        if (!ok2) throw swallowed("an eth_call with a REFUSED read returns a value or a revert");
        checks.push("execution (eth_call): error");
      } else checks.push("execution (eth_call): inconclusive (read not forwarded)");

      const arc = this.engine === "arc";
      const sender = "0x000000000000000000000000000000000005e1f7" as Address;
      await rpc("anvil_setBalance", [sender, numberToHex(GAS_ALLOWANCE_USDC6 * 10n ** 12n)]);
      const hash = await rpc("eth_sendTransaction", [{
        from: sender, to: SELFTEST_ACCOUNT, value: "0x0", data: "0x01", gas: numberToHex(TX_GAS),
        ...(arc ? { type: "0x2", maxFeePerGas: numberToHex(MAX_FEE_WEI), maxPriorityFeePerGas: "0x0" } : { gasPrice: "0x0", type: "0x0" }),
      }]);
      let mined = false;
      for (let i = 0; i < 40 && !mined; i++) {
        mined = !!(await rpc("eth_getTransactionReceipt", [hash]));
        if (!mined) await new Promise((r) => setTimeout(r, 50));
      }
      if (seen.has(`slot:${BigInt(SELFTEST_SLOT_TX)}`)) {
        if (mined) throw swallowed("a transaction with a REFUSED read is mined anyway");
        checks.push("transaction: never mined");
      } else checks.push("transaction: inconclusive (read not forwarded)");

      let revertCode: number | undefined;
      try {
        await rpc("eth_call", [{ data: "0x60006000fd" }, "latest"]); // a creation whose init code does REVERT(0, 0)
      } catch (e) {
        revertCode = e instanceof RpcCallError ? e.code : undefined;
      }
      return { blockN, revertCode, checks };
    } finally {
      fork?.stop();
      await relay.close();
      await proxy.close();
    }
  }

  /** Starts a forked anvil (the same options as the replay). `forkUrl`: the strict relay. */
  private async spawnFork(forkUrl: string, blockN: bigint): Promise<{ rpc: Rpc; alive: () => boolean; stop: () => void; stderr: () => string }> {
    const port = await freePort();
    const arc = this.engine === "arc";
    const proc = spawn(this.bin, [
      ...(arc ? ["--network", "arc"] : ["--base-fee", "0", "--gas-price", "0"]),
      "--fork-url", forkUrl, "--fork-block-number", blockN.toString(), "--port", String(port), "--host", "127.0.0.1",
      "--auto-impersonate", "--no-storage-caching",
      "--retries", "8", "--fork-retry-backoff", "800", "--timeout", "45000", "--silent",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr = (stderr + String(d)).slice(-2000); });
    let spawnFailed = false;
    proc.on("error", () => { spawnFailed = true; }); // missing binary: waitReady fails closed (without crashing the process)
    return {
      rpc: jsonRpc(`http://127.0.0.1:${port}`),
      alive: () => !spawnFailed && proc.exitCode === null && proc.signalCode === null,
      stop: () => { proc.kill("SIGKILL"); },
      stderr: () => stderr,
    };
  }

  /** The implementation behind the USDC proxy, read by trace (callTracer); a successful trace without DELEGATECALL: the
   *  known testnet address. A trace in ERROR fails closed (before: a silent fallback, which could differ from one
   *  enclave to another). "anvil" engine only. */
  private async usdcImplementation(rpc: Rpc): Promise<Address> {
    const tr = await rpc("debug_traceCall", [
      { to: this.usdc, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [this.usdc] }) },
      "latest", { tracer: "callTracer" },
    ]) as any;
    const call = (tr?.calls ?? []).find((c: any) => String(c.type).toUpperCase() === "DELEGATECALL");
    if (call?.to) return call.to as Address;
    return ARC_USDC_IMPL_TESTNET;
  }

  /**
   * The predicate's reads. A transport, fork RPC, node or timeout error is NEVER a value: it throws
   * (ReplayUnavailableError, above). Only an EVM revert (code 3) of a view or invariant read gives the value of the v0
   * rule (view = 0, invariant not held), and only if the relay saw no violation (guarded).
   */
  private async measure(rpc: Rpc, reads: Read[]): Promise<Map<string, bigint | boolean>> {
    const out = new Map<string, bigint | boolean>();
    for (const r of reads) {
      if (r.kind === "erc20") {
        const v = await rpc("eth_call", [{ to: r.token, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [r.holder] }) }, "latest"]);
        out.set(r.key, quantity(v, "solde ERC-20"));
      } else if (r.kind === "native") {
        out.set(r.key, quantity(await rpc("eth_getBalance", [r.holder, "latest"]), "solde natif"));
      } else {
        let v: unknown;
        try {
          v = await rpc("eth_call", [{ to: r.target, data: r.call }, "latest"]);
        } catch (e) {
          if (!isEvmRevert(e)) throw e; // outage, exceptional halt, timeout, relay violation: fail closed
          out.set(r.key, r.kind === "view" ? 0n : false); // a DETERMINISTIC revert: v0 rule (view zero, invariant not held)
          continue;
        }
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new ReplayUnavailableError("rpc", "unreadable eth_call answer: nothing is signed");
        const word = v.length >= 66 ? BigInt(v.slice(0, 66)) : 0n;
        out.set(r.key, r.kind === "view" ? word : word !== 0n);
      }
    }
    return out;
  }
}

/** A JSON-RPC quantity (0x…); any other answer (including "0x" for an account without code) fails closed, as before. */
function quantity(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new ReplayUnavailableError("rpc", `${what} unreadable: nothing is signed`);
  return BigInt(v);
}

// ---------- reads planned from the predicate ----------

type Read =
  | { kind: "erc20"; key: string; token: Address; holder: Address }
  | { kind: "native"; key: string; holder: Address }
  | { kind: "view" | "invariant"; key: string; target: Address; call: Hex };

const kErc20 = (token: string, holder: string) => `erc20:${token.toLowerCase()}:${holder.toLowerCase()}`;
const kNative = (holder: string) => `native:${holder.toLowerCase()}`;
const kCall = (kind: string, target: string, call: string) => `${kind}:${target.toLowerCase()}:${call.toLowerCase()}`;

function plannedReads(clauses: Clause[], payee: Address, usdc: Address): Read[] {
  const m = new Map<string, Read>();
  // the hunter's USDC balance is always measured (the profit shown in the log, and for ATTACKER_PROFIT)
  m.set(kErc20(usdc, payee), { kind: "erc20", key: kErc20(usdc, payee), token: usdc, holder: payee });
  for (const c of clauses) {
    if (c.type === "ERC20_DROP") m.set(kErc20(c.token, c.holder), { kind: "erc20", key: kErc20(c.token, c.holder), token: c.token, holder: c.holder });
    else if (c.type === "NATIVE_DROP") m.set(kNative(c.holder), { kind: "native", key: kNative(c.holder), holder: c.holder });
    else if (c.type === "ATTACKER_PROFIT") {
      const tok = c.token.toLowerCase() === usdc ? usdc : c.token;
      m.set(kErc20(tok, payee), { kind: "erc20", key: kErc20(tok, payee), token: tok as Address, holder: payee });
    } else if (c.type === "VIEW_CHANGED") m.set(kCall("view", c.target, c.call), { kind: "view", key: kCall("view", c.target, c.call), target: c.target, call: c.call });
    else if (c.type === "INVARIANT_BROKEN") m.set(kCall("invariant", c.target, c.call), { kind: "invariant", key: kCall("invariant", c.target, c.call), target: c.target, call: c.call });
  }
  return [...m.values()];
}

function buildContext(before: Map<string, bigint | boolean>, after: Map<string, bigint | boolean>, capital: bigint, payee: Address, usdc: Address): EvalContext {
  const big = (m: Map<string, bigint | boolean>, k: string) => (typeof m.get(k) === "bigint" ? (m.get(k) as bigint) : 0n);
  return {
    erc20Drop: (token, holder) => big(before, kErc20(token, holder)) - big(after, kErc20(token, holder)),
    nativeDrop: (holder) => big(before, kNative(holder)) - big(after, kNative(holder)),
    // USDC: final balance − declared capital (the capital is the only injected balance); another token: final − initial
    attackerProfit: (token) => token.toLowerCase() === usdc
      ? big(after, kErc20(usdc, payee)) - capital
      : big(after, kErc20(token, payee)) - big(before, kErc20(token, payee)),
    viewValue: (target, call, when) => big(when === "before" ? before : after, kCall("view", target, call)),
    invariantHeld: (target, call, when) => (when === "before" ? before : after).get(kCall("invariant", target, call)) === true,
  };
}

/**
 * The DETERMINISTIC replay rules (unchanged since v2; fixed messages since v2.1 bis: never the content of the exploit,
 * nor a viem message): 1 to MAX_TXS transactions, each one hexadecimal of at most MAX_TX_BYTES bytes in the format
 * abi.encode(address, uint256, bytes); an attack code of at most MAX_CODE_BYTES bytes; a capital in [0, 10^15].
 */
function validateBundle(b: ExploitBundle) {
  if (!Array.isArray(b.txs) || b.txs.length === 0) throw new ReplayRuleError("txs_empty", "empty exploit: at least one transaction");
  if (b.txs.length > MAX_TXS) throw new ReplayRuleError("txs_count", `at most ${MAX_TXS} transactions`);
  for (const t of b.txs) {
    if (typeof t !== "string" || !/^0x[0-9a-fA-F]*$/.test(t) || (t.length - 2) / 2 > MAX_TX_BYTES) {
      throw new ReplayRuleError("tx_size", `transaction malformed or larger than ${MAX_TX_BYTES} bytes`);
    }
    try {
      decodeAbiParameters(EXPLOIT_TX_PARAMS, t);
    } catch (e) {
      // only viem's decoding errors (deterministic: the same bytes, the same verdict) are the rule; any other exception
      // (stack, memory) is not one and propagates (503, nothing signed)
      if (!(e instanceof BaseError)) throw e;
      throw new ReplayRuleError("tx_format", "transaction that is not abi.encode(address to, uint256 value, bytes data)");
    }
  }
  if (b.attackCode && (b.attackCode.length - 2) / 2 > MAX_CODE_BYTES) throw new ReplayRuleError("code_size", `attack code larger than ${MAX_CODE_BYTES} bytes`);
  if (typeof b.capital !== "bigint" || b.capital < 0n || b.capital > MAX_CAPITAL) throw new ReplayRuleError("capital", "capital out of bounds [0, 10^15]");
}

// ---------- plomberie ----------

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** A JSON-RPC error (the node answered with an error) or a transport error (HTTP, unreadable JSON). */
export class RpcCallError extends Error {
  constructor(readonly method: string, readonly code: number | undefined, readonly rpcMessage: string) {
    super(`${method}: JSON-RPC error${code === undefined ? "" : ` ${code}`}`);
    this.name = "RpcCallError";
  }
}

/** A DETERMINISTIC EVM revert: code 3 "execution reverted" (EIP-1474). Nothing else (neither -32603 nor -32000). */
export function isEvmRevert(e: unknown): boolean {
  return e instanceof RpcCallError && e.code === 3 && /^execution reverted/.test(e.rpcMessage);
}

function jsonRpc(url: string, timeoutMs?: number): Rpc {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      redirect: "error", // v2.1 quater: never followed (the read of the fork RPC's head at the start-up check, local engine)
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) throw new RpcCallError(method, undefined, `HTTP ${res.status}`);
    let j: { result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      j = (await res.json()) as typeof j;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e; // v2.1 ter: a cut body (TypeError) or the environment: propagates as is
      throw new RpcCallError(method, undefined, "non-JSON answer");
    }
    if (j.error) throw new RpcCallError(method, typeof j.error.code === "number" ? j.error.code : undefined, String(j.error.message ?? ""));
    return j.result;
  };
}

/** v2.1 ter: an outage of the engine or of its transport (a JSON-RPC or HTTP error of the engine, a failed or cut fetch, a timeout). */
function isTransportFailure(e: unknown): boolean {
  if (e instanceof RpcCallError) return true;
  if (e instanceof TypeError && (e.message === "fetch failed" || e.message === "terminated")) return true;
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

/** For the log: the method and the code of an error, never its message (which can copy bytes of the exploit). */
function describeFailure(e: unknown): string {
  if (e instanceof RpcCallError) return `${e.method}${e.code === undefined ? "" : `, code ${e.code}`}`;
  return e instanceof Error ? e.name : "error";
}

/** Waits for the engine to answer; `check` (v2.1 ter) throws if the relay already saw a violation (immediate fail closed). */
async function waitReady(rpc: Rpc, alive: () => boolean, err: () => string, check: () => void = () => {}) {
  const t0 = Date.now();
  for (;;) {
    check();
    if (!alive()) {
      throw new ReplayUnavailableError("process", `anvil stopped at start-up: nothing is signed`, { cause: new Error(err().slice(-300)) });
    }
    try {
      await rpc("eth_chainId", []);
      return;
    } catch (e) {
      if (e instanceof ReplayUnavailableError) throw e; // a relay violation (guarded rpc): no point waiting
      /* not ready yet */
    }
    if (Date.now() - t0 > 30_000) throw new ReplayUnavailableError("process", "anvil did not start within 30 s: nothing is signed");
    await new Promise((r) => setTimeout(r, 250));
  }
}

type Fault = { error: { code: number; message: string } } | { result: unknown };

/**
 * A local JSON-RPC proxy in front of `target` (start-up check): it relays everything, except the requests for which
 * `fault(q)` returns a failure (a JSON-RPC error, or a forged result: a false value, a malformed answer, null). Batches included.
 */
async function faultProxy(target: string, fault: (q: any) => Fault | undefined) {
  const one = async (q: any): Promise<unknown> => {
    const f = fault(q);
    if (f) return "error" in f ? { jsonrpc: "2.0", id: q.id, error: f.error } : { jsonrpc: "2.0", id: q.id, result: f.result };
    // v2.1 quater: like the strict relay: no redirect followed, the answer read as a bounded stream (otherwise: 502)
    const r = await fetch(target, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q), redirect: "error", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    const text = await readBodyBounded(r, MAX_RESPONSE_BYTES);
    if (text === undefined) throw new Error("the fork RPC's answer is too large");
    return JSON.parse(text);
  };
  const server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => { body += d; });
    rq.on("end", async () => {
      try {
        const j = JSON.parse(body);
        const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify(out));
      } catch {
        rs.writeHead(502);
        rs.end();
      }
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("port"))));
    });
  });
}
