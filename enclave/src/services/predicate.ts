/**
 * predicate.ts — the v0 predicate language of the Sealed Bounty (O3).
 *
 * A predicate describes "what proves the exploit": a balance drop, the attacker's profit, a changed read, a broken
 * invariant. Its canonical JSON is hashed (predicateHash) and pinned on-chain: the enclave and the protocol speak of
 * the same predicate, without ambiguity.
 *
 * v2.1 bis (adversarial review of 14 Nov): the DETERMINISTIC RULES of a predicate (validatePredicate), the same as in the
 * SDK (packages/sdk/src/predicate.ts):
 *  P1 pure JSON: strings, finite numbers, booleans, null, arrays, plain objects (nothing else);
 *  P2 bounds on the WHOLE predicate, extra fields included (they enter predicateHash): nesting ≤ MAX_DEPTH levels
 *     (root = 1, a clause = 3), ≤ MAX_FIELDS fields (object keys + array elements), canonical JSON ≤ MAX_BYTES bytes
 *     (UTF-8). The check is ITERATIVE, without recursion: a predicate nested thousands of levels deep is refused by the
 *     rule, never by an exhausted JavaScript stack (whose threshold depends on the state of the JIT);
 *  P3 combine = "AND" | "OR", 1 to 8 clauses;
 *  P4 the shape of each clause: a known type; addresses 0x + 40 hexadecimal digits; min / value as decimal integers
 *     ≥ 0 (78 digits at most) or safe integers ≥ 0; call as even-length hexadecimal; op ∈ eq, neq, gt, lt.
 * A predicate that breaks a rule throws PredicateError (a FIXED message, with nothing from the content). In the enclave,
 * such a submission is "not proven"; a claim whose report breaks a rule is a proven fault (no honest enclave would have
 * signed it). Any OTHER exception is never a fault (bounty.ts: 503, nothing signed).
 * Valid predicates keep EXACTLY the same canonical JSON (the same predicateHash) as before these rules.
 */
import { type Address, type Hex, keccak256, toBytes } from "viem";

export type Clause =
  | { type: "ERC20_DROP"; token: Address; holder: Address; min: string }
  | { type: "NATIVE_DROP"; holder: Address; min: string }
  | { type: "ATTACKER_PROFIT"; token: Address; min: string }
  | { type: "VIEW_CHANGED"; target: Address; call: Hex; op: "eq" | "neq" | "gt" | "lt"; value: string }
  | { type: "INVARIANT_BROKEN"; target: Address; call: Hex };

export interface Predicate {
  combine: "AND" | "OR";
  clauses: Clause[]; // 1..8
}

/** Bounds of a predicate (rule P2). */
export const PREDICATE_MAX_DEPTH = 8;
export const PREDICATE_MAX_FIELDS = 256;
export const PREDICATE_MAX_BYTES = 16 * 1024;
export const PREDICATE_MAX_CLAUSES = 8;

export type PredicateRule = "json" | "depth" | "fields" | "size" | "combine" | "clauses" | "clause";

/** A predicate breaks a deterministic rule (P1–P4). The message is fixed: it copies nothing from the predicate. */
export class PredicateError extends Error {
  constructor(message: string, readonly rule: PredicateRule = "clause") {
    super(message);
    this.name = "PredicateError";
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT_DEC = /^[0-9]{1,78}$/;
const EVEN_HEX = /^0x([0-9a-fA-F]{2})*$/;
const UINT256_MAX = (1n << 256n) - 1n;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Rules P1 and P2 without recursion (an explicit stack): pure JSON, nesting, number of fields, then the EXACT size of
 * the canonical JSON (computed only once the nesting is bounded). Throws PredicateError.
 */
export function checkPredicateBounds(p: unknown): void {
  if (!isPlainObject(p)) throw new PredicateError("predicate: JSON object expected", "json");
  const stack: Array<[unknown, number]> = [[p, 1]];
  let fields = 0;
  let chars = 0; // UTF-16 length of the keys and strings: a lower bound of the canonical JSON's UTF-8 size
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (typeof v === "string") {
      chars += v.length;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new PredicateError("predicate: non-finite number (NaN or infinity)", "json");
    } else if (typeof v === "boolean" || v === null) {
      // nothing
    } else if (Array.isArray(v)) {
      if (depth > PREDICATE_MAX_DEPTH) throw new PredicateError(`predicate: nesting deeper than ${PREDICATE_MAX_DEPTH} levels`, "depth");
      fields += v.length;
      if (fields > PREDICATE_MAX_FIELDS) throw new PredicateError(`predicate: more than ${PREDICATE_MAX_FIELDS} fields`, "fields");
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) throw new PredicateError("predicate: sparse array (not JSON)", "json");
        stack.push([v[i], depth + 1]);
      }
    } else if (isPlainObject(v)) {
      if (depth > PREDICATE_MAX_DEPTH) throw new PredicateError(`predicate: nesting deeper than ${PREDICATE_MAX_DEPTH} levels`, "depth");
      const keys = Object.keys(v);
      fields += keys.length;
      if (fields > PREDICATE_MAX_FIELDS) throw new PredicateError(`predicate: more than ${PREDICATE_MAX_FIELDS} fields`, "fields");
      for (const k of keys) {
        chars += k.length;
        stack.push([v[k], depth + 1]);
      }
    } else {
      throw new PredicateError("predicate: non-JSON value (only strings, finite numbers, booleans, null, arrays and plain objects)", "json");
    }
    if (chars > PREDICATE_MAX_BYTES) throw new PredicateError(`predicate: canonical JSON larger than ${PREDICATE_MAX_BYTES} bytes`, "size");
  }
  // bounded nesting: the (recursive) serialization is safe; the exact size in UTF-8 bytes
  if (new TextEncoder().encode(stableStringify(p as Json)).length > PREDICATE_MAX_BYTES) {
    throw new PredicateError(`predicate: canonical JSON larger than ${PREDICATE_MAX_BYTES} bytes`, "size");
  }
}

function checkUint(c: Record<string, unknown>, field: string, i: number): void {
  const v = c[field];
  const ok =
    (typeof v === "string" && UINT_DEC.test(v) && BigInt(v) <= UINT256_MAX) ||
    (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
  if (!ok) throw new PredicateError(`clause ${i + 1}: ${field} must be a decimal integer ≥ 0 (78 digits at most)`);
}

function checkAddress(c: Record<string, unknown>, field: string, i: number): void {
  const v = c[field];
  if (typeof v !== "string" || !ADDRESS.test(v)) throw new PredicateError(`clause ${i + 1}: ${field} must be an address (0x + 40 hexadecimal digits)`);
}

function checkCall(c: Record<string, unknown>, i: number): void {
  if (typeof c.call !== "string" || !EVEN_HEX.test(c.call)) throw new PredicateError(`clause ${i + 1}: call must be even-length hexadecimal (0x…)`);
}

function checkClause(c: unknown, i: number): void {
  if (!isPlainObject(c)) throw new PredicateError(`clause ${i + 1}: object expected`);
  switch (c.type) {
    case "ERC20_DROP":
      checkAddress(c, "token", i);
      checkAddress(c, "holder", i);
      checkUint(c, "min", i);
      return;
    case "NATIVE_DROP":
      checkAddress(c, "holder", i);
      checkUint(c, "min", i);
      return;
    case "ATTACKER_PROFIT":
      checkAddress(c, "token", i);
      checkUint(c, "min", i);
      return;
    case "VIEW_CHANGED":
      checkAddress(c, "target", i);
      checkCall(c, i);
      if (c.op !== "eq" && c.op !== "neq" && c.op !== "gt" && c.op !== "lt") throw new PredicateError(`clause ${i + 1}: op must be eq, neq, gt or lt`);
      checkUint(c, "value", i);
      return;
    case "INVARIANT_BROKEN":
      checkAddress(c, "target", i);
      checkCall(c, i);
      return;
    default:
      throw new PredicateError(`clause ${i + 1}: unknown type (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)`);
  }
}

/** Rules P1–P4; throws PredicateError (fixed message). */
export function validatePredicate(p: Predicate): void {
  checkPredicateBounds(p);
  const o = p as unknown as Record<string, unknown>;
  if (o.combine !== "AND" && o.combine !== "OR") throw new PredicateError("invalid combine (AND or OR)", "combine");
  const clauses = o.clauses;
  if (!Array.isArray(clauses) || clauses.length < 1 || clauses.length > PREDICATE_MAX_CLAUSES) {
    throw new PredicateError(`1 to ${PREDICATE_MAX_CLAUSES} clauses`, "clauses");
  }
  clauses.forEach(checkClause);
}

/** Canonical JSON (sorted keys): the hashed representation. */
export function canonicalize(p: Predicate): string {
  validatePredicate(p);
  return stableStringify(p as unknown as Json);
}

export function predicateHash(p: Predicate): Hex {
  return keccak256(toBytes(canonicalize(p)));
}

/** What the replay (fork) gives the evaluator, measured before and after running the bundle. */
export interface EvalContext {
  erc20Drop(token: Address, holder: Address): bigint; // balance before − after (>= 0 on a drop)
  nativeDrop(holder: Address): bigint;
  attackerProfit(token: Address): bigint; // final − capital, gas compris
  viewValue(target: Address, call: Hex, when: "before" | "after"): bigint;
  invariantHeld(target: Address, call: Hex, when: "before" | "after"): boolean;
}

export interface EvalResult {
  satisfied: boolean;
  loss: bigint; // measured loss (USDC/EURC/native in v0)
}

/** Evaluates a VALID predicate (validatePredicate first: after it, only the context's measurements can throw). */
export function evaluate(p: Predicate, ctx: EvalContext): EvalResult {
  validatePredicate(p);
  let loss = 0n;
  const results = p.clauses.map((c) => {
    const [ok, l] = evalClause(c, ctx);
    if (l > loss) loss = l;
    return ok;
  });
  const satisfied = p.combine === "AND" ? results.every(Boolean) : results.some(Boolean);
  return { satisfied, loss: satisfied ? loss : 0n };
}

function evalClause(c: Clause, ctx: EvalContext): [boolean, bigint] {
  switch (c.type) {
    case "ERC20_DROP": {
      const d = ctx.erc20Drop(c.token, c.holder);
      return [d >= BigInt(c.min), d > 0n ? d : 0n];
    }
    case "NATIVE_DROP": {
      const d = ctx.nativeDrop(c.holder);
      return [d >= BigInt(c.min), d > 0n ? d : 0n];
    }
    case "ATTACKER_PROFIT": {
      const pfit = ctx.attackerProfit(c.token);
      return [pfit >= BigInt(c.min), pfit > 0n ? pfit : 0n];
    }
    case "VIEW_CHANGED": {
      const after = ctx.viewValue(c.target, c.call, "after");
      const v = BigInt(c.value);
      const ok =
        c.op === "eq" ? after === v : c.op === "neq" ? after !== v : c.op === "gt" ? after > v : after < v;
      return [ok, 0n];
    }
    case "INVARIANT_BROKEN": {
      const before = ctx.invariantHeld(c.target, c.call, "before");
      const after = ctx.invariantHeld(c.target, c.call, "after");
      return [before && !after, 0n];
    }
  }
}

// --- canonical JSON (sorted keys) ---
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Recursive, but called only on JSON of bounded nesting (checkPredicateBounds); unchanged since v0. */
function stableStringify(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k] as Json)).join(",") + "}";
}

/**
 * True if a JSON value (from JSON.parse: without cycles) nests objects and arrays more than `limit` levels deep;
 * without recursion, it stops at the first level too many. It refuses a report that is too nested BEFORE any recursive
 * serialization (JSON.stringify).
 */
export function jsonDepthExceeds(v: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[v, 1]];
  while (stack.length > 0) {
    const [x, d] = stack.pop()!;
    if (x === null || typeof x !== "object") continue;
    if (d > limit) return true;
    if (Array.isArray(x)) for (const y of x) stack.push([y, d + 1]);
    else for (const k of Object.keys(x)) stack.push([(x as Record<string, unknown>)[k], d + 1]);
  }
  return false;
}
