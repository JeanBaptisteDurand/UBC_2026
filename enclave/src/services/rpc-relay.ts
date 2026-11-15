/**
 * rpc-relay.ts — RELAIS JSON-RPC STRICT entre le moteur de rejeu (anvil / arc-anvil) et le RPC du fork (FORK_RPC_URL).
 *
 * Pourquoi (revue adverse du 9/11, preuve verif-failclosed/e1-blockhash-null) : le moteur prend certaines réponses
 * INVALIDES du RPC du fork pour des valeurs, sans erreur — `null` pour un bloc récent (réponse normale d'un nœud qui n'a pas
 * encore ce bloc) devient BLOCKHASH = keccak256(""), « 0x » ou un nombre JSON pour une case de stockage deviennent 0 ou 5.
 * Le rejeu rendait alors des mesures fausses, et l'enclave les signait (réclamation fausse, réfutation d'une réclamation
 * vraie). Le moteur ne parle donc plus au RPC du fork : il parle à ce relais (127.0.0.1, port éphémère, un relais par rejeu
 * et par contrôle de démarrage), qui transmet chaque requête et VÉRIFIE la forme de chaque résultat avant de le rendre :
 *  - méthodes permises : celles qu'emploient anvil 1.5.1 et arc-anvil v0.8.0-4 pour forker (relevé du 9/11) ; toute autre
 *    méthode est refusée ;
 *  - état lu AU BLOC N SEULEMENT (étiquette de bloc = N en hexadécimal) : jamais « latest », jamais un autre bloc ;
 *  - eth_getStorageAt : exactement 32 octets ; quantités (solde, nonce, numéro de bloc, chainId, prix du gas) en
 *    hexadécimal canonique ; eth_getCode : hexadécimal pair (« 0x » permis : compte sans code) ; eth_getAccountInfo :
 *    { balance, nonce, code } de ces formes ;
 *  - blocs ≤ N : jamais null ; numéro = celui demandé ; hash et champs d'en-tête au bon format ; hash du bloc N = l'ancre
 *    (hash vérifié en quorum ou on-chain) ; hash d'un bloc n < N rattaché à l'ancre par la chaîne des parentHash
 *    (n+1 … N) ;
 *  - reçus et transactions demandés par hash (transactions du fork seulement) : null exigé.
 * Toute réponse INVALIDE (forme, bloc null, chaîne, enveloppe JSON-RPC fausse : version, id, result ET error), toute
 * méthode ou tout paramètre non prévus et tout dépassement du BUDGET de requêtes du rejeu est une VIOLATION : le moteur
 * reçoit une erreur JSON-RPC, et la violation est MÉMORISÉE (verrou) : le rejeu qui l'a subie échoue fermé
 * (ReplayUnavailableError, HTTP 503, rien n'est signé), même si le moteur a réessayé et obtenu ensuite une bonne réponse.
 * Un rejeu n'est signé que si aucune réponse invalide n'a été vue.
 * Un échec PASSAGER du RPC du fork (erreur JSON-RPC, statut HTTP ≠ 200, réseau, délai, corps illisible) n'est pas une
 * valeur : il est rendu au moteur TEL QUEL (l'erreur JSON-RPC telle quelle, le même statut HTTP ; 502 pour le réseau ou un
 * corps illisible), comme si le moteur parlait au RPC du fork : soit le moteur échoue (le rejeu échoue fermé), soit il
 * réessaie (limite de débit, 429, 503 : vérifié, il retrouve la bonne valeur), et la réponse réessayée est contrôlée comme
 * les autres. Chaque essai compte dans le budget.
 *
 * v2.1 quater (vérification adverse du 9/11 au soir, preuves verif-relay r1-B, r1-E, r1-G, r2, r3-1a) — RPC MENTEUR :
 *  - EN-TÊTE LIÉ À SON HASH (politique « arc », DÉFAUT) : les 21 champs d'en-tête d'Arc (Londres → Prague) sont EXIGÉS et
 *    keccak256(RLP(en-tête)) doit redonner `hash` (VÉRIFIÉ le 9/11 sur des blocs réels d'Arc testnet et sur anvil 1.5.1).
 *    Avec l'ancre (hash du bloc N vérifié en quorum ou on-chain) et la chaîne des parentHash, chaque en-tête servi au moteur
 *    est celui de la vraie chaîne : horodatage, base fee, PREVRANDAO (mixHash), mineur, gasLimit, excessBlobGas du bloc N,
 *    et BLOCKHASH(N − k). Un en-tête au bon hash mais au contenu changé : violation « header » ;
 *  - redirections JAMAIS suivies (le corps JSON-RPC ne part jamais vers un autre hôte) : échec passager (502) ;
 *  - réponses lues EN FLUX, coupées au-delà de MAX_RESPONSE_BYTES (aucune réponse géante gardée en mémoire) : échec
 *    passager (502) ;
 *  - MÉMOIRE DES RÉPONSES du rejeu : l'état au bloc N et les blocs ≤ N sont immuables ; une même lecture (même clé canonique :
 *    adresse en minuscules, case en entier ; solde, nonce et code recoupés entre eth_getAccountInfo et les lectures
 *    séparées ; un bloc par numéro ou par hash) qui revient avec une autre valeur : violation « inconsistent ».
 *    eth_blockNumber et eth_gasPrice (qui changent avec le temps) n'y sont pas soumis.
 * Limite (à dire) : SANS l'option stateProofs, le relais lie les en-têtes à l'ancre, pas l'ÉTAT servi au bloc N ; un RPC
 * qui ment sur l'état avec des réponses bien formées et constantes n'est alors pas détecté. La liste des transactions d'un
 * bloc n'est pas recalculée contre transactionsRoot (le moteur ne les exécute pas).
 *
 * 10/11/2026 — PREUVES D'ÉTAT (option stateProofs) : chaque lecture d'état au bloc N (solde, nonce, code, case de
 * stockage, eth_getAccountInfo) est demandée en eth_getProof (EIP-1186) au RPC des preuves et VÉRIFIÉE contre le stateRoot
 * de l'en-tête N (lui-même lié à l'ancre) : le relais rend au moteur les valeurs PROUVÉES, le code seulement s'il redonne le
 * hash de code prouvé. Une preuve fausse : violation « state_proof » (rien n'est signé) ; une preuve indisponible (nœud
 * hors fenêtre, panne) : échec passager, donc rejeu en échec fermé. Aucun RPC n'est plus de confiance pour l'état.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { keccak256, toRlp, type Hex } from "viem";
import { StateProofError, checkCode, checkProofResult, slotKey, type ProvedAccount } from "./state-proof.js";

/** Budget par défaut : requêtes au RPC du fork pour UN rejeu (relais compris). Au-delà : violation, échec fermé (503). */
export const DEFAULT_MAX_FORK_REQUESTS = 2_000;
/** Délai d'une requête au RPC du fork. */
export const RELAY_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 1 << 20; // les requêtes du moteur sont petites
/** v2.1 quater : taille maximale d'une réponse du RPC du fork, en octets, LUE EN FLUX (au-delà : lecture coupée, connexion
 *  fermée, échec passager 502). Un bloc d'Arc avec ses transactions complètes tient très en deçà. */
export const MAX_RESPONSE_BYTES = 64 << 20;
/** Code JSON-RPC rendu au moteur pour une réponse refusée (erreur interne : le moteur ne la réessaie pas comme une limite). */
export const RELAY_ERROR_CODE = -32603;

export type RelayViolationKind =
  | "budget" // plus de requêtes que le budget du rejeu
  | "method" // méthode non prévue
  | "params" // paramètres inattendus (autre bloc que N, étiquette non numérique, bloc au-delà de N…)
  | "shape" // résultat de forme inattendue
  | "null_block" // null pour un bloc ≤ N
  | "chain" // hash de bloc qui n'est pas celui de l'ancre, ou qui ne s'y rattache pas par les parentHash
  | "envelope" // enveloppe JSON-RPC du RPC du fork invalide : version, id d'une autre requête, result ET error
  | "header" // v2.1 quater : en-tête dont le contenu ne redonne pas le hash (keccak256(RLP(en-tête)) ≠ hash)
  | "inconsistent" // v2.1 quater : la même lecture (état au bloc N, bloc ≤ N, chainId) rendue avec deux valeurs différentes
  | "state_proof" // 10/11 : preuve d'état (eth_getProof) qui ne se vérifie pas contre le stateRoot de l'en-tête N ancré
  | "internal"; // exception inattendue dans le relais (échec fermé)

/** Une réponse du RPC du fork refusée par le relais (mémorisée). Message FIXE (jamais de valeur ni de paramètre recopiés). */
export class RelayViolation extends Error {
  constructor(readonly kind: RelayViolationKind, readonly method: string, message: string) {
    super(message);
    this.name = "RelayViolation";
  }
}

/**
 * Un échec PASSAGER du RPC du fork (pas une valeur, pas mémorisé) : erreur JSON-RPC (`rpcError`, rendue telle quelle au
 * moteur) ou échec HTTP / réseau / délai / corps illisible (`http` : statut rendu au moteur, 502 pour le réseau).
 */
export class UpstreamFailure extends Error {
  constructor(readonly method: string, readonly failure: { http: number } | { rpcError: { code: number; message: string } }) {
    super("http" in failure ? `RPC du fork : échec HTTP ou réseau (${failure.http})` : "RPC du fork : erreur JSON-RPC");
    this.name = "UpstreamFailure";
  }
}

// ---------- formes ----------

const QTY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const EVEN_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const BLOOM = /^0x[0-9a-fA-F]{512}$/;
const NONCE8 = /^0x[0-9a-fA-F]{16}$/;
const SLOT = /^0x[0-9a-fA-F]{1,64}$/;

const isQty = (v: unknown): v is string => typeof v === "string" && QTY.test(v);
const isB32 = (v: unknown): v is string => typeof v === "string" && B32.test(v);
const isAddr = (v: unknown): v is string => typeof v === "string" && ADDR.test(v);
const isEvenHex = (v: unknown): v is string => typeof v === "string" && EVEN_HEX.test(v);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/**
 * v2.1 quater : contrat d'en-tête des blocs rendus par le RPC du fork.
 *  - "arc" (DÉFAUT, l'image) : les 21 champs d'en-tête d'Arc (HEADER_FIELDS) sont EXIGÉS et LIÉS au hash :
 *    keccak256(RLP(en-tête)) = hash, sinon violation « header » ;
 *  - "shape" (TESTS SEULEMENT, ou chaîne d'un autre format) : la forme seule (v2.1 ter) : 12 champs exigés, les autres
 *    contrôlés s'ils sont là, contenu NON lié au hash (un RPC menteur peut alors changer l'horodatage du bloc N sans
 *    changer son hash : preuve r3-1a).
 */
export type HeaderPolicy = "arc" | "shape";

type FieldKind = "b32" | "addr" | "bloom" | "qty" | "bytes" | "nonce8";
/** Les 21 champs d'en-tête d'Arc, dans l'ordre du protocole (Londres → Prague) : celui de l'RLP du hash du bloc (relevé du
 *  9/11 : le RPC d'Arc testnet les rend toujours ; anvil 1.5.1 aussi). */
const HEADER_FIELDS: ReadonlyArray<readonly [string, FieldKind]> = [
  ["parentHash", "b32"], ["sha3Uncles", "b32"], ["miner", "addr"], ["stateRoot", "b32"], ["transactionsRoot", "b32"],
  ["receiptsRoot", "b32"], ["logsBloom", "bloom"], ["difficulty", "qty"], ["number", "qty"], ["gasLimit", "qty"],
  ["gasUsed", "qty"], ["timestamp", "qty"], ["extraData", "bytes"], ["mixHash", "b32"], ["nonce", "nonce8"],
  ["baseFeePerGas", "qty"], ["withdrawalsRoot", "b32"], ["blobGasUsed", "qty"], ["excessBlobGas", "qty"],
  ["parentBeaconBlockRoot", "b32"], ["requestsHash", "b32"],
];
const KIND_OK: Record<FieldKind, (v: unknown) => boolean> = {
  b32: isB32,
  addr: isAddr,
  bloom: (v) => typeof v === "string" && BLOOM.test(v),
  qty: isQty,
  bytes: isEvenHex,
  nonce8: (v) => typeof v === "string" && NONCE8.test(v),
};
/** Forme de chaque champ connu d'un bloc : les 21 champs d'en-tête, le hash, et les champs hors en-tête (non liés au hash ;
 *  le moteur ne s'en sert pas pour exécuter). Tout champ connu PRÉSENT est contrôlé, quelle que soit la politique. */
const BLOCK_FIELDS: Record<string, (v: unknown) => boolean> = {
  ...Object.fromEntries(HEADER_FIELDS.map(([k, kind]) => [k, KIND_OK[kind]])),
  hash: isB32,
  totalDifficulty: isQty,
  size: isQty,
  uncles: (v) => Array.isArray(v) && v.every(isB32),
  withdrawals: (v) => Array.isArray(v) && v.every(isPlainObject),
};
/** Champs EXIGÉS selon la politique (« shape » : ceux de la v2.1 ter ; « arc » : les 21 champs d'en-tête et le hash). */
const REQUIRED: Record<HeaderPolicy, readonly string[]> = {
  arc: [...HEADER_FIELDS.map(([k]) => k), "hash"],
  shape: ["number", "hash", "parentHash", "timestamp", "gasLimit", "gasUsed", "miner", "stateRoot", "transactionsRoot", "receiptsRoot", "logsBloom", "extraData"],
};

/** Une quantité JSON-RPC en entier RLP : octets big-endian minimaux, zéro = chaîne vide. */
function rlpQuantity(q: string): Hex {
  const h = BigInt(q).toString(16);
  return h === "0" ? "0x" : (`0x${h.length % 2 ? "0" : ""}${h}` as Hex);
}

/**
 * v2.1 quater : keccak256(RLP(en-tête)) : les 21 champs d'en-tête d'Arc dans l'ordre du protocole (HEADER_FIELDS), les
 * quantités en entiers minimaux, les autres champs en octets bruts. C'est le hash du bloc (VÉRIFIÉ le 9/11 sur des blocs
 * réels d'Arc testnet et sur anvil 1.5.1). Le bloc doit avoir la forme de la politique « arc » (checkBlockShape).
 */
export function blockHeaderHash(b: Record<string, unknown>): Hex {
  return keccak256(toRlp(HEADER_FIELDS.map(([k, kind]) => (kind === "qty" ? rlpQuantity(b[k] as string) : (b[k] as Hex)))));
}

/**
 * Contrôle un bloc rendu par le RPC du fork (`full` : transactions complètes ou hashes) selon la politique d'en-tête
 * (défaut « arc » : 21 champs exigés, en-tête lié au hash). Lève RelayViolation (« null_block », « shape », « header »).
 */
export function checkBlockShape(method: string, b: unknown, full: boolean, policy: HeaderPolicy = "arc"): { number: bigint; hash: string; parentHash: string; stateRoot: string } {
  if (b === null) throw new RelayViolation("null_block", method, "bloc absent (null) au lieu d'un bloc ≤ N : rien n'est signé");
  if (!isPlainObject(b)) throw new RelayViolation("shape", method, "bloc : objet attendu");
  for (const k of REQUIRED[policy]) {
    if (b[k] === undefined) throw new RelayViolation("shape", method, `bloc : champ ${k} absent`);
  }
  for (const [k, ok] of Object.entries(BLOCK_FIELDS)) {
    if (b[k] !== undefined && !ok(b[k])) throw new RelayViolation("shape", method, `bloc : champ ${k} mal formé`);
  }
  const txs = b.transactions;
  if (!Array.isArray(txs)) throw new RelayViolation("shape", method, "bloc : transactions (tableau) attendu");
  for (const t of txs) {
    const ok = full ? isPlainObject(t) && isB32(t.hash) : isB32(t);
    if (!ok) throw new RelayViolation("shape", method, `bloc : transactions ${full ? "complètes (objets avec hash)" : "(hashes de 32 octets)"} attendues`);
  }
  const hash = (b.hash as string).toLowerCase();
  // v2.1 quater : le CONTENU de l'en-tête est lié à son hash (et, par l'ancre et les parentHash, à la vraie chaîne)
  if (policy === "arc" && blockHeaderHash(b) !== hash) {
    throw new RelayViolation("header", method, "bloc : l'en-tête ne redonne pas son hash (keccak256(RLP(en-tête)) ≠ hash) : rien n'est signé");
  }
  return { number: BigInt(b.number as string), hash, parentHash: (b.parentHash as string).toLowerCase(), stateRoot: (b.stateRoot as string).toLowerCase() };
}

/** v2.1 quater : forme canonique d'une valeur JSON (hexadécimal en minuscules, clés triées) et son empreinte. */
function canonical(v: unknown): unknown {
  if (typeof v === "string") return v.toLowerCase();
  if (Array.isArray(v)) return v.map(canonical);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const fingerprint = (v: unknown): string => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");

/**
 * v2.1 quater : lit le corps d'une réponse HTTP EN FLUX, au plus `maxBytes` octets ; au-delà (ou si Content-Length l'annonce),
 * la lecture est coupée (le corps est annulé, la connexion fermée) et rend undefined. Décodage UTF-8 comme Response.text().
 * Les erreurs de lecture (délai du signal, connexion coupée) remontent telles quelles.
 */
export async function readBodyBounded(res: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks, size));
}

// ---------- le relais ----------

export interface StrictRelayOptions {
  /** RPC du fork (FORK_RPC_URL). */
  upstream: string;
  /** Bloc N du rejeu : tout l'état est lu à ce bloc ; aucun bloc au-delà. */
  blockN: bigint;
  /** Hash attendu du bloc N (ancre). Absent : épinglé à la première lecture du bloc N. */
  anchorHash?: Hex;
  /** Budget de requêtes au RPC du fork (défaut DEFAULT_MAX_FORK_REQUESTS). */
  maxRequests?: number;
  /** Délai d'une requête au RPC du fork (défaut RELAY_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Après la première violation, refuser toute requête sans la transmettre (rejeu : vrai ; contrôle de démarrage : faux,
   *  ses points sont indépendants). */
  failFast?: boolean;
  /** TESTS SEULEMENT : false = relais transparent (aucun contrôle de forme ni de chaîne, budget compris), pour montrer ce
   *  que le relais empêche (le contrôle de démarrage doit alors refuser le moteur). */
  checks?: boolean;
  /** v2.1 quater : contrat d'en-tête des blocs (défaut « arc » : 21 champs exigés, en-tête lié au hash ; « shape » : tests à
   *  blocs synthétiques seulement). */
  headerPolicy?: HeaderPolicy;
  /** v2.1 quater : taille maximale d'une réponse du RPC du fork, en octets (défaut MAX_RESPONSE_BYTES). */
  maxResponseBytes?: number;
  /** 10/11 : PREUVES D'ÉTAT. Présent : chaque lecture d'état au bloc N est prouvée (eth_getProof vérifié contre le stateRoot
   *  de l'en-tête N ancré) ; `upstream` = RPC des preuves (défaut : le RPC du fork). Exige la politique d'en-tête « arc ». */
  stateProofs?: { upstream?: string };
  /** 11/11 : chainId attendu du rejeu. Présent : le relais EXIGE que `eth_chainId` du RPC du fork vaille exactement
   *  cette valeur (sinon violation « chain », rien n'est signé) ; sans ça, un RPC menteur fixerait CHAINID du rejeu. */
  expectedChainId?: number;
}

export interface StrictRelay {
  /** URL à donner au moteur (--fork-url). */
  readonly url: string;
  /** Requêtes faites au RPC du fork (budget). */
  readonly requests: number;
  /** Première violation (verrou), ou undefined. */
  readonly violation: RelayViolation | undefined;
  /** Toutes les violations (bornées). */
  readonly violations: readonly RelayViolation[];
  /** Échecs passagers du RPC du fork rendus au moteur (non mémorisés comme violation). */
  readonly upstreamFailures: number;
  /** Le hash du bloc N rendu par le RPC du fork, contrôlé (forme, ancre) ; lève RelayViolation ou UpstreamFailure. */
  anchor(): Promise<string>;
  /** Un appel du relais lui-même (mêmes contrôles que pour le moteur) ; lève RelayViolation ou UpstreamFailure. */
  call(method: string, params: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

const MAX_KEPT_VIOLATIONS = 32;

/** Réponse d'un élément au moteur : une enveloppe JSON-RPC, ou un statut HTTP à rendre tel quel (échec passager). */
type Answer = { rpc: unknown } | { http: number };

class Relay implements StrictRelay {
  url = "";
  requests = 0;
  violations: RelayViolation[] = [];
  upstreamFailures = 0;
  private server: Server | undefined;
  private seq = 0;
  private readonly max: number;
  private readonly checks: boolean;
  private readonly policy: HeaderPolicy;
  private readonly maxResponseBytes: number;
  /** Hashes de blocs rattachés à l'ancre (minuscules), de `lowest` à N sans trou. */
  private hashes = new Map<bigint, string>();
  private lowest: bigint;
  /** En-têtes déjà lus et contrôlés (par le moteur ou par le relais). */
  private headers = new Map<bigint, Promise<{ hash: string; parentHash: string; stateRoot: string }>>();
  /** 10/11 : comptes, cases et codes PROUVÉS au bloc N (clé : adresse en minuscules ; adresse:case sur 32 octets). */
  private provedAccounts = new Map<string, Promise<ProvedAccount>>();
  private provedSlots = new Map<string, Promise<bigint>>();
  private provedCodes = new Map<string, Promise<Hex>>();
  private rootN: Promise<Hex> | undefined;
  /** v2.1 quater : empreinte de la première réponse valide de chaque lecture (clé canonique) ; bornée par le budget. */
  private memo = new Map<string, string>();

  constructor(private o: StrictRelayOptions) {
    this.max = o.maxRequests ?? DEFAULT_MAX_FORK_REQUESTS;
    this.checks = o.checks !== false;
    this.policy = o.headerPolicy ?? "arc";
    this.maxResponseBytes = o.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.lowest = o.blockN;
    if (o.anchorHash !== undefined) this.hashes.set(o.blockN, o.anchorHash.toLowerCase());
    // une preuve d'état ne vaut que contre un stateRoot LIÉ au hash du bloc : politique « arc » exigée
    if (o.stateProofs && this.policy !== "arc") throw new Error("relais strict : les preuves d'état exigent la politique d'en-tête « arc »");
    // sans ancre, un RPC menteur fabriquerait l'en-tête N ET des preuves cohérentes avec lui : l'ancre est exigée
    if (o.stateProofs && o.anchorHash === undefined) throw new Error("relais strict : les preuves d'état exigent l'ancre (hash du bloc N vérifié)");
  }

  get violation(): RelayViolation | undefined {
    return this.violations[0];
  }

  private violate(v: RelayViolation): RelayViolation {
    if (this.violations.length < MAX_KEPT_VIOLATIONS) this.violations.push(v);
    return v;
  }

  async listen(): Promise<void> {
    this.server = createServer((rq, rs) => {
      if (rq.method !== "POST") {
        rs.writeHead(405);
        rs.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let tooBig = false;
      rq.on("data", (d: Buffer) => {
        size += d.length;
        if (size > MAX_REQUEST_BYTES) tooBig = true;
        else chunks.push(d);
      });
      rs.on("error", () => undefined); // moteur arrêté pendant une requête : rien à lui répondre
      rq.on("end", () => {
        void this.respond(tooBig ? undefined : Buffer.concat(chunks).toString("utf8")).then(
          (out) => {
            if (rs.destroyed || rs.writableEnded) return;
            if ("http" in out) {
              // échec passager du RPC du fork : le même statut, comme si le moteur lui parlait (il réessaie ou échoue)
              rs.writeHead(out.http, { "content-type": "text/plain" });
              rs.end("relais strict : échec passager du RPC du fork");
            } else {
              rs.writeHead(200, { "content-type": "application/json" });
              rs.end(out.json);
            }
          },
          () => {
            this.violate(new RelayViolation("internal", "?", "exception inattendue dans le relais"));
            if (rs.destroyed || rs.writableEnded) return;
            rs.writeHead(500);
            rs.end();
          },
        );
      });
      rq.on("error", () => rs.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    const s = this.server;
    if (!s) return Promise.resolve();
    return new Promise<void>((r) => {
      s.closeAllConnections?.();
      s.close(() => r());
    });
  }

  /** Une requête (ou un lot) du moteur → la réponse (JSON, ou statut HTTP d'un échec passager à rendre tel quel). */
  private async respond(body: string | undefined): Promise<{ json: string } | { http: number }> {
    let j: unknown;
    try {
      if (body === undefined) throw new SyntaxError("trop gros");
      j = JSON.parse(body);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      this.violate(new RelayViolation("params", "?", "requête du moteur illisible"));
      return { json: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "relais strict : requête illisible" } }) };
    }
    const answers = Array.isArray(j) ? await Promise.all(j.map((q) => this.one(q))) : [await this.one(j)];
    const failed = answers.find((a): a is { http: number } => "http" in a);
    if (failed) return failed; // un lot : comme le RPC du fork, un seul statut pour toute la réponse
    const rpc = answers.map((a) => (a as { rpc: unknown }).rpc);
    return { json: JSON.stringify(Array.isArray(j) ? rpc : rpc[0]) };
  }

  private async one(q: unknown): Promise<Answer> {
    const id = isPlainObject(q) && (typeof q.id === "number" || typeof q.id === "string") ? q.id : null;
    const method = isPlainObject(q) && typeof q.method === "string" ? q.method : "?";
    const refused = (kind: string) => ({ rpc: { jsonrpc: "2.0", id, error: { code: RELAY_ERROR_CODE, message: `relais strict : ${kind}` } } });
    try {
      if (!isPlainObject(q) || method === "?" || (q.params !== undefined && !Array.isArray(q.params))) {
        throw this.violate(new RelayViolation("params", method, "requête JSON-RPC du moteur mal formée"));
      }
      if (this.o.failFast && this.violation) return refused(`rejeu déjà en échec (${this.violation.kind})`); // plus rien n'est transmis
      return { rpc: { jsonrpc: "2.0", id, result: await this.call(method, (q.params as unknown[] | undefined) ?? []) } };
    } catch (e) {
      if (e instanceof UpstreamFailure) {
        this.upstreamFailures++;
        return "http" in e.failure ? { http: e.failure.http } : { rpc: { jsonrpc: "2.0", id, error: e.failure.rpcError } };
      }
      const v = e instanceof RelayViolation ? e : this.violate(new RelayViolation("internal", method, "exception inattendue dans le relais"));
      return refused(`réponse refusée (${v.kind})`);
    }
  }

  /**
   * Une requête au RPC du fork. Échec passager (HTTP ≠ 200, redirection, réseau, délai, corps illisible ou trop gros, erreur
   * JSON-RPC) : UpstreamFailure (rendu tel quel au moteur, non mémorisé). Enveloppe invalide (version, id, result ET error) :
   * violation mémorisée.
   */
  private async upstream(method: string, params: unknown[], url: string = this.o.upstream): Promise<unknown> {
    if (this.checks && this.requests >= this.max) {
      throw this.violate(new RelayViolation("budget", method, `plus de ${this.max} requêtes au RPC du fork pour ce rejeu : rien n'est signé`));
    }
    this.requests++;
    const id = ++this.seq;
    let text: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        // v2.1 quater : une redirection n'est JAMAIS suivie (fetch lève) : le corps ne part jamais vers un autre hôte
        redirect: "error",
        signal: AbortSignal.timeout(this.o.timeoutMs ?? RELAY_TIMEOUT_MS),
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new UpstreamFailure(method, { http: res.status >= 400 && res.status <= 599 ? res.status : 502 });
      }
      // v2.1 quater : lue en flux, coupée au-delà de la borne (jamais une réponse géante en mémoire)
      text = await readBodyBounded(res, this.maxResponseBytes);
    } catch (e) {
      if (e instanceof UpstreamFailure) throw e;
      throw new UpstreamFailure(method, { http: 502 }); // réseau, redirection, connexion coupée, délai
    }
    if (text === undefined) throw new UpstreamFailure(method, { http: 502 }); // au-delà de la borne : lecture coupée
    let j: unknown;
    try {
      j = JSON.parse(text);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      throw new UpstreamFailure(method, { http: 502 }); // corps tronqué ou illisible : ce n'est pas une valeur
    }
    const rpcError = (x: Record<string, unknown>) => {
      const err = x.error;
      return isPlainObject(err) && typeof err.code === "number" && typeof err.message === "string"
        ? { code: err.code, message: err.message.slice(0, 200) } : { code: RELAY_ERROR_CODE, message: "erreur du RPC du fork" };
    };
    if (!this.checks) {
      if (isPlainObject(j) && j.error !== undefined) throw new UpstreamFailure(method, { rpcError: rpcError(j) });
      return isPlainObject(j) ? j.result : undefined;
    }
    if (!isPlainObject(j) || j.jsonrpc !== "2.0" || j.id !== id || ("result" in j) === ("error" in j)) {
      throw this.violate(new RelayViolation("envelope", method, "réponse du RPC du fork : enveloppe JSON-RPC invalide (version, id, result/error)"));
    }
    if ("error" in j) throw new UpstreamFailure(method, { rpcError: rpcError(j) });
    return j.result;
  }

  /** Étiquette de bloc d'une lecture d'état : N en hexadécimal, rien d'autre. */
  private atN(method: string, tag: unknown): void {
    if (!isQty(tag) || BigInt(tag) !== this.o.blockN) {
      throw this.violate(new RelayViolation("params", method, "lecture d'état à un autre bloc que N (ou étiquette non numérique)"));
    }
  }

  private arity(method: string, params: unknown[], n: number): void {
    if (params.length !== n) throw this.violate(new RelayViolation("params", method, `${n} paramètre(s) attendu(s)`));
  }

  private shape(method: string, ok: boolean, what: string): void {
    if (!ok) throw this.violate(new RelayViolation("shape", method, `résultat mal formé : ${what} attendu`));
  }

  /** v2.1 quater : la même lecture (clé canonique) rend la même valeur dans tout le rejeu (état au bloc N, blocs ≤ N et
   *  chainId sont immuables) ; sinon violation « inconsistent ». Seule l'empreinte de la valeur est gardée. */
  private same(method: string, key: string, value: unknown): void {
    const f = fingerprint(value);
    const prev = this.memo.get(key);
    if (prev === undefined) this.memo.set(key, f);
    else if (prev !== f) {
      throw this.violate(new RelayViolation("inconsistent", method, "le RPC du fork a rendu deux valeurs différentes pour la même lecture : rien n'est signé"));
    }
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    if (!this.checks) return this.upstream(method, params);
    switch (method) {
      case "eth_chainId":
      case "eth_gasPrice": {
        this.arity(method, params, 0);
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "une quantité hexadécimale canonique");
        if (method === "eth_chainId") {
          this.same(method, "chainId", r); // eth_gasPrice change avec le temps : pas de mémoire
          if (this.o.expectedChainId !== undefined && BigInt(r as string) !== BigInt(this.o.expectedChainId)) {
            throw this.violate(new RelayViolation("chain", method, "le RPC du fork annonce un autre chainId que celui attendu : rien n'est signé"));
          }
        }
        return r;
      }
      case "eth_blockNumber": {
        this.arity(method, params, 0);
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "une quantité hexadécimale canonique");
        if (BigInt(r as string) < this.o.blockN) throw this.violate(new RelayViolation("shape", method, "tête du RPC du fork avant le bloc N"));
        return r;
      }
      case "eth_getBlockByNumber": {
        this.arity(method, params, 2);
        const [tag, full] = params;
        if (!isQty(tag) || typeof full !== "boolean") throw this.violate(new RelayViolation("params", method, "numéro de bloc (hexadécimal) et booléen attendus"));
        const n = BigInt(tag);
        if (n > this.o.blockN) throw this.violate(new RelayViolation("params", method, "bloc au-delà de N demandé"));
        const r = await this.upstream(method, params);
        const b = this.block(method, r, full);
        if (b.number !== n) throw this.violate(new RelayViolation("shape", method, "bloc rendu : numéro différent de celui demandé"));
        await this.onChain(method, b);
        this.same(method, `block:${b.number}:${full}`, r);
        return r;
      }
      case "eth_getBlockByHash": {
        this.arity(method, params, 2);
        const [hash, full] = params;
        if (!isB32(hash) || typeof full !== "boolean") throw this.violate(new RelayViolation("params", method, "hash de bloc et booléen attendus"));
        const r = await this.upstream(method, params);
        const b = this.block(method, r, full);
        if (b.hash !== hash.toLowerCase()) throw this.violate(new RelayViolation("shape", method, "bloc rendu : hash différent de celui demandé"));
        if (b.number > this.o.blockN) throw this.violate(new RelayViolation("params", method, "bloc au-delà de N"));
        await this.onChain(method, b);
        this.same(method, `block:${b.number}:${full}`, r); // même clé que par numéro : les deux lectures sont recoupées
        return r;
      }
      case "eth_getStorageAt": {
        this.arity(method, params, 3);
        if (!isAddr(params[0]) || typeof params[1] !== "string" || !SLOT.test(params[1])) {
          throw this.violate(new RelayViolation("params", method, "adresse et case (≤ 32 octets) attendues"));
        }
        this.atN(method, params[2]);
        if (this.o.stateProofs) {
          // 10/11 : la valeur rendue au moteur est celle que PROUVE l'arbre au bloc N (pas celle qu'annonce un RPC)
          const v = await this.provedSlot(method, params[0], params[1]);
          const r = `0x${v.toString(16).padStart(64, "0")}`;
          this.same(method, `storage:${params[0].toLowerCase()}:${BigInt(params[1]).toString(16)}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isB32(r), "32 octets hexadécimaux");
        this.same(method, `storage:${params[0].toLowerCase()}:${BigInt(params[1]).toString(16)}`, r);
        return r;
      }
      case "eth_getBalance":
      case "eth_getTransactionCount": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "adresse attendue"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const a = await this.provedAccount(method, params[0]);
          const r = `0x${(method === "eth_getBalance" ? a.balance : a.nonce).toString(16)}`;
          this.same(method, `${method === "eth_getBalance" ? "balance" : "nonce"}:${params[0].toLowerCase()}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "une quantité hexadécimale canonique");
        this.same(method, `${method === "eth_getBalance" ? "balance" : "nonce"}:${params[0].toLowerCase()}`, r);
        return r;
      }
      case "eth_getCode": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "adresse attendue"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const r = await this.provedCode(method, params[0]);
          this.same(method, `code:${params[0].toLowerCase()}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isEvenHex(r), "de l'hexadécimal pair");
        this.same(method, `code:${params[0].toLowerCase()}`, r);
        return r;
      }
      case "eth_getAccountInfo": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "adresse attendue"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const a0 = params[0].toLowerCase();
          const acct = await this.provedAccount(method, params[0]);
          const proved = { balance: `0x${acct.balance.toString(16)}`, nonce: `0x${acct.nonce.toString(16)}`, code: await this.provedCode(method, params[0]) };
          this.same(method, `balance:${a0}`, proved.balance);
          this.same(method, `nonce:${a0}`, proved.nonce);
          this.same(method, `code:${a0}`, proved.code);
          return proved;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isPlainObject(r) && isQty(r.balance) && isQty(r.nonce) && isEvenHex(r.code), "{ balance, nonce, code }");
        // recoupé avec eth_getBalance, eth_getTransactionCount et eth_getCode du même compte
        const a = params[0].toLowerCase();
        const info = r as { balance: string; nonce: string; code: string };
        this.same(method, `balance:${a}`, info.balance);
        this.same(method, `nonce:${a}`, info.nonce);
        this.same(method, `code:${a}`, info.code);
        return r;
      }
      case "eth_getTransactionReceipt":
      case "eth_getTransactionByHash": {
        // le moteur ne demande que les transactions du fork, inconnues du RPC du fork : null exigé
        this.arity(method, params, 1);
        if (!isB32(params[0])) throw this.violate(new RelayViolation("params", method, "hash de transaction attendu"));
        const r = await this.upstream(method, params);
        this.shape(method, r === null, "null (transaction du fork inconnue du RPC du fork)");
        return r;
      }
      default:
        throw this.violate(new RelayViolation("method", method, "méthode non prévue par le relais strict"));
    }
  }

  private block(method: string, r: unknown, full: boolean) {
    try {
      return checkBlockShape(method, r, full, this.policy);
    } catch (e) {
      if (e instanceof RelayViolation) throw this.violate(e);
      throw e;
    }
  }

  /** En-tête du bloc h lu par le relais lui-même (forme, en-tête lié au hash, numéro), mémorisé. */
  private header(h: bigint): Promise<{ hash: string; parentHash: string; stateRoot: string }> {
    let p = this.headers.get(h);
    if (!p) {
      p = (async () => {
        const method = "eth_getBlockByNumber";
        const r = await this.upstream(method, [`0x${h.toString(16)}`, false]);
        const b = this.block(method, r, false);
        if (b.number !== h) throw this.violate(new RelayViolation("shape", method, "bloc rendu : numéro différent de celui demandé"));
        this.same(method, `block:${h}:false`, r); // recoupé avec les lectures du même bloc par le moteur
        return { hash: b.hash, parentHash: b.parentHash, stateRoot: b.stateRoot };
      })();
      this.headers.set(h, p);
      p.catch(() => this.headers.delete(h));
    }
    return p;
  }

  /** Hash du bloc n rattaché à l'ancre (n ≤ N) : descend de proche en proche par les parentHash. */
  private async anchored(method: string, n: bigint): Promise<string> {
    const N = this.o.blockN;
    if (!this.hashes.has(N)) {
      const h = await this.header(N); // pas d'ancre : la première lecture du bloc N l'épingle
      if (!this.hashes.has(N)) this.hashes.set(N, h.hash);
    }
    while (this.lowest > n) {
      const h = this.lowest;
      const hdr = await this.header(h);
      const want = this.hashes.get(h)!;
      if (hdr.hash !== want) throw this.violate(new RelayViolation("chain", method, "bloc qui ne se rattache pas au bloc N de la réclamation"));
      this.hashes.set(h - 1n, hdr.parentHash);
      if (this.lowest > h - 1n) this.lowest = h - 1n;
    }
    return this.hashes.get(n)!;
  }

  /** Le bloc rendu est-il sur la chaîne de l'ancre ? (bloc N : l'ancre ; bloc n < N : chaîne des parentHash). */
  private async onChain(method: string, b: { number: bigint; hash: string; parentHash: string; stateRoot: string }): Promise<void> {
    if (b.number === this.o.blockN && !this.hashes.has(b.number)) this.hashes.set(b.number, b.hash); // épinglé (sans ancre)
    const want = await this.anchored(method, b.number);
    if (b.hash !== want) throw this.violate(new RelayViolation("chain", method, "hash de bloc différent de celui de la chaîne ancrée au bloc N"));
    if (!this.headers.has(b.number)) this.headers.set(b.number, Promise.resolve({ hash: b.hash, parentHash: b.parentHash, stateRoot: b.stateRoot }));
  }

  // ---------- 10/11 : preuves d'état ----------

  /** stateRoot de l'en-tête N, après contrôle que l'en-tête N est celui de l'ancre (en-tête lié à son hash : politique « arc »). */
  private stateRootN(): Promise<Hex> {
    if (!this.rootN) {
      this.rootN = (async () => {
        await this.anchor();
        return (await this.header(this.o.blockN)).stateRoot as Hex;
      })();
      this.rootN.catch(() => { this.rootN = undefined; });
    }
    return this.rootN;
  }

  /** eth_getProof(adresse, cases, N) au RPC des preuves, VÉRIFIÉ contre le stateRoot de N ; une preuve fausse est une violation. */
  private async prove(method: string, address: string, slots: string[]) {
    const root = await this.stateRootN();
    const r = await this.upstream("eth_getProof", [address, slots.map(slotKey), `0x${this.o.blockN.toString(16)}`], this.o.stateProofs?.upstream ?? this.o.upstream);
    try {
      return checkProofResult(root, address as Hex, slots, r);
    } catch (e) {
      if (e instanceof StateProofError) throw this.violate(new RelayViolation("state_proof", method, `${e.message} : rien n'est signé`));
      throw e;
    }
  }

  private cached<T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>): Promise<T> {
    let p = m.get(k);
    if (!p) {
      p = f();
      m.set(k, p);
      p.catch(() => m.delete(k)); // un échec passager peut être réessayé par le moteur
    }
    return p;
  }

  private provedAccount(method: string, address: string): Promise<ProvedAccount> {
    const a = address.toLowerCase();
    return this.cached(this.provedAccounts, a, async () => (await this.prove(method, a, [])).account);
  }

  private provedSlot(method: string, address: string, slot: string): Promise<bigint> {
    const a = address.toLowerCase();
    const k = slotKey(slot);
    return this.cached(this.provedSlots, `${a}:${k}`, async () => {
      const r = await this.prove(method, a, [k]);
      // même racine, même clé : c'est forcément le même compte (une clé n'a qu'une feuille sous une racine) ; on le garde
      this.provedAccounts.set(a, this.provedAccounts.get(a) ?? Promise.resolve(r.account));
      return r.storage.get(k)!;
    });
  }

  /** Code du compte : rendu par le RPC des preuves, accepté seulement s'il redonne le hash de code PROUVÉ. */
  private provedCode(method: string, address: string): Promise<Hex> {
    const a = address.toLowerCase();
    return this.cached(this.provedCodes, a, async () => {
      const acct = await this.provedAccount(method, a);
      const code = await this.upstream("eth_getCode", [a, `0x${this.o.blockN.toString(16)}`], this.o.stateProofs?.upstream ?? this.o.upstream);
      try {
        return checkCode(acct, code);
      } catch (e) {
        if (e instanceof StateProofError) throw this.violate(new RelayViolation("state_proof", method, `${e.message} : rien n'est signé`));
        throw e;
      }
    });
  }

  async anchor(): Promise<string> {
    const h = await this.header(this.o.blockN);
    if (!this.hashes.has(this.o.blockN)) this.hashes.set(this.o.blockN, h.hash);
    if (h.hash !== this.hashes.get(this.o.blockN)) {
      throw this.violate(new RelayViolation("chain", "eth_getBlockByNumber", "le RPC du fork ne sert pas le bloc N de la réclamation (hash différent)"));
    }
    return h.hash;
  }
}

/** Lance un relais strict (127.0.0.1, port éphémère) devant `o.upstream`. */
export async function startStrictRelay(o: StrictRelayOptions): Promise<StrictRelay> {
  const r = new Relay(o);
  await r.listen();
  return r;
}
