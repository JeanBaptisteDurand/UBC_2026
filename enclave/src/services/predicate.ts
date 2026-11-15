/**
 * predicate.ts — le langage de prédicats v0 de la Prime scellée (O3).
 *
 * Un prédicat décrit « qu'est-ce qui prouve l'exploit » : chute de solde, profit de l'attaquant,
 * lecture changée, invariant cassé. Son JSON canonique est haché (predicateHash) et épinglé on-chain :
 * l'enclave et le protocole parlent du même prédicat, sans ambiguïté.
 *
 * v2.1 bis (revue adverse du 9/11) — RÈGLES DÉTERMINISTES d'un prédicat (validatePredicate), les mêmes dans le SDK
 * (packages/sdk/src/predicate.ts) :
 *  P1 JSON pur : chaînes, nombres finis, booléens, null, tableaux, objets simples (rien d'autre) ;
 *  P2 bornes de TOUT le prédicat, champs annexes compris (ils entrent dans predicateHash) : imbrication ≤ MAX_DEPTH
 *     niveaux (racine = 1, une clause = 3), ≤ MAX_FIELDS champs (clés d'objets + éléments de tableaux), JSON canonique
 *     ≤ MAX_BYTES octets (UTF-8). Contrôle ITÉRATIF, sans récursion : un prédicat imbriqué sur des milliers de niveaux
 *     est refusé par la règle, jamais par une pile JavaScript épuisée (dont le seuil dépend de l'état du JIT) ;
 *  P3 combine = "AND" | "OR", 1 à 8 clauses ;
 *  P4 forme de chaque clause : type connu ; adresses 0x + 40 hexadécimaux ; min / value entiers décimaux ≥ 0
 *     (78 chiffres au plus) ou entiers sûrs ≥ 0 ; call hexadécimal pair ; op ∈ eq, neq, gt, lt.
 * Un prédicat qui viole une règle lève PredicateError (message FIXE, sans rien du contenu). Côté enclave : une soumission
 * est « non prouvée » ; une réclamation dont le rapport viole une règle est une faute prouvée (aucune enclave honnête ne
 * l'aurait signée). Toute AUTRE exception n'est jamais une faute (bounty.ts : 503, rien de signé).
 * Les prédicats valides gardent EXACTEMENT le même JSON canonique (même predicateHash) qu'avant ces règles.
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

/** Bornes d'un prédicat (règle P2). */
export const PREDICATE_MAX_DEPTH = 8;
export const PREDICATE_MAX_FIELDS = 256;
export const PREDICATE_MAX_BYTES = 16 * 1024;
export const PREDICATE_MAX_CLAUSES = 8;

export type PredicateRule = "json" | "depth" | "fields" | "size" | "combine" | "clauses" | "clause";

/** Un prédicat viole une règle déterministe (P1–P4). Le message est fixe : il ne recopie rien du prédicat. */
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
 * Règles P1 et P2 sans récursion (pile explicite) : JSON pur, imbrication, nombre de champs, puis taille EXACTE du JSON
 * canonique (calculée seulement une fois l'imbrication bornée). Lève PredicateError.
 */
export function checkPredicateBounds(p: unknown): void {
  if (!isPlainObject(p)) throw new PredicateError("prédicat : objet JSON attendu", "json");
  const stack: Array<[unknown, number]> = [[p, 1]];
  let fields = 0;
  let chars = 0; // longueur UTF-16 des clés et des chaînes : minorant de la taille UTF-8 du JSON canonique
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (typeof v === "string") {
      chars += v.length;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new PredicateError("prédicat : nombre non fini (NaN ou infini)", "json");
    } else if (typeof v === "boolean" || v === null) {
      // rien
    } else if (Array.isArray(v)) {
      if (depth > PREDICATE_MAX_DEPTH) throw new PredicateError(`prédicat : imbrication de plus de ${PREDICATE_MAX_DEPTH} niveaux`, "depth");
      fields += v.length;
      if (fields > PREDICATE_MAX_FIELDS) throw new PredicateError(`prédicat : plus de ${PREDICATE_MAX_FIELDS} champs`, "fields");
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) throw new PredicateError("prédicat : tableau à trous (pas du JSON)", "json");
        stack.push([v[i], depth + 1]);
      }
    } else if (isPlainObject(v)) {
      if (depth > PREDICATE_MAX_DEPTH) throw new PredicateError(`prédicat : imbrication de plus de ${PREDICATE_MAX_DEPTH} niveaux`, "depth");
      const keys = Object.keys(v);
      fields += keys.length;
      if (fields > PREDICATE_MAX_FIELDS) throw new PredicateError(`prédicat : plus de ${PREDICATE_MAX_FIELDS} champs`, "fields");
      for (const k of keys) {
        chars += k.length;
        stack.push([v[k], depth + 1]);
      }
    } else {
      throw new PredicateError("prédicat : valeur non JSON (seuls chaînes, nombres finis, booléens, null, tableaux et objets simples)", "json");
    }
    if (chars > PREDICATE_MAX_BYTES) throw new PredicateError(`prédicat : JSON canonique de plus de ${PREDICATE_MAX_BYTES} octets`, "size");
  }
  // imbrication bornée : la sérialisation (récursive) est sûre ; taille exacte en octets UTF-8
  if (new TextEncoder().encode(stableStringify(p as Json)).length > PREDICATE_MAX_BYTES) {
    throw new PredicateError(`prédicat : JSON canonique de plus de ${PREDICATE_MAX_BYTES} octets`, "size");
  }
}

function checkUint(c: Record<string, unknown>, field: string, i: number): void {
  const v = c[field];
  const ok =
    (typeof v === "string" && UINT_DEC.test(v) && BigInt(v) <= UINT256_MAX) ||
    (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
  if (!ok) throw new PredicateError(`clause ${i + 1} : ${field} doit être un entier décimal ≥ 0 (78 chiffres au plus)`);
}

function checkAddress(c: Record<string, unknown>, field: string, i: number): void {
  const v = c[field];
  if (typeof v !== "string" || !ADDRESS.test(v)) throw new PredicateError(`clause ${i + 1} : ${field} doit être une adresse (0x + 40 hexadécimaux)`);
}

function checkCall(c: Record<string, unknown>, i: number): void {
  if (typeof c.call !== "string" || !EVEN_HEX.test(c.call)) throw new PredicateError(`clause ${i + 1} : call doit être de l'hexadécimal pair (0x…)`);
}

function checkClause(c: unknown, i: number): void {
  if (!isPlainObject(c)) throw new PredicateError(`clause ${i + 1} : objet attendu`);
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
      if (c.op !== "eq" && c.op !== "neq" && c.op !== "gt" && c.op !== "lt") throw new PredicateError(`clause ${i + 1} : op doit valoir eq, neq, gt ou lt`);
      checkUint(c, "value", i);
      return;
    case "INVARIANT_BROKEN":
      checkAddress(c, "target", i);
      checkCall(c, i);
      return;
    default:
      throw new PredicateError(`clause ${i + 1} : type inconnu (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)`);
  }
}

/** Les règles P1–P4 ; lève PredicateError (message fixe). */
export function validatePredicate(p: Predicate): void {
  checkPredicateBounds(p);
  const o = p as unknown as Record<string, unknown>;
  if (o.combine !== "AND" && o.combine !== "OR") throw new PredicateError("combine invalide (AND ou OR)", "combine");
  const clauses = o.clauses;
  if (!Array.isArray(clauses) || clauses.length < 1 || clauses.length > PREDICATE_MAX_CLAUSES) {
    throw new PredicateError(`1 à ${PREDICATE_MAX_CLAUSES} clauses`, "clauses");
  }
  clauses.forEach(checkClause);
}

/** JSON canonique (clés triées) — la représentation hachée. */
export function canonicalize(p: Predicate): string {
  validatePredicate(p);
  return stableStringify(p as unknown as Json);
}

export function predicateHash(p: Predicate): Hex {
  return keccak256(toBytes(canonicalize(p)));
}

/** Ce que le rejeu (fork) fournit à l'évaluateur, mesuré avant/après l'exécution du bundle. */
export interface EvalContext {
  erc20Drop(token: Address, holder: Address): bigint; // solde avant − après (>= 0 si chute)
  nativeDrop(holder: Address): bigint;
  attackerProfit(token: Address): bigint; // final − capital, gas compris
  viewValue(target: Address, call: Hex, when: "before" | "after"): bigint;
  invariantHeld(target: Address, call: Hex, when: "before" | "after"): boolean;
}

export interface EvalResult {
  satisfied: boolean;
  loss: bigint; // perte mesurée (USDC/EURC/natif en v0)
}

/** Évalue un prédicat VALIDE (validatePredicate d'abord : après lui, seules les mesures du contexte peuvent lever). */
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

// --- JSON canonique (tri des clés) ---
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Récursif, mais appelé seulement sur un JSON d'imbrication bornée (checkPredicateBounds) ; inchangé depuis la v0. */
function stableStringify(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k] as Json)).join(",") + "}";
}

/**
 * Vrai si une valeur JSON (issue de JSON.parse : sans cycle) imbrique objets et tableaux sur plus de `limit` niveaux ;
 * sans récursion, s'arrête au premier niveau de trop. Sert à refuser un rapport trop imbriqué AVANT toute sérialisation
 * récursive (JSON.stringify).
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
