/** secrets.ts — Sealed Bounty secrets on the user's disk (hardened after an adversarial review):
 *  - one X25519 key PER BOUNTY (file mode 0600 in a 0700 folder, named after its public key): revealing it for a
 *    refutation (--reveal-key) opens only the reports of THAT bounty;
 *  - an exploit's random r (with the public cP, it decrypts the exploit): read from a 0600 file or from standard input,
 *    never as an argument (shell history, process list). */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { toBytes, toHex, type Hex } from "viem";
import { deterministicOpen, deterministicSeal, generateX25519 } from "@arcvault/sdk";
import { CliError } from "./cli";

export const KEY_KIND = "arcvault-protocol-x25519";
/** v2.1 : la clé UNIQUE partagée par toutes les primes d'un protocole (lue encore, jamais plus créée). */
export const LEGACY_PROTOCOL_KEY = join(homedir(), ".arcvault", "protocol-x25519.json");
/** v2.1 bis : une clé par prime, ici. */
export const BOUNTY_KEY_DIR = join(homedir(), ".arcvault", "bounty-keys");

export interface ProtocolKey {
  publicKey: Hex;
  privateKey: Uint8Array;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const isBytes32 = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

/** Fichier d'une clé de prime, nommé par sa clé publique (on le retrouve à partir de Bounty.protocolX25519). */
export function bountyKeyPath(publicKey: Hex, dir = BOUNTY_KEY_DIR): string {
  return join(dir, `x25519-${publicKey.slice(2).toLowerCase()}.json`);
}

/** Un fichier de secret ne doit être lisible que par son propriétaire (aucun droit pour le groupe ni les autres). */
export function assertOwnerOnly(path: string, what: string): void {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new CliError(`${what} introuvable ou illisible : ${path}`);
  }
  if (process.platform !== "win32" && (mode & 0o077) !== 0) {
    throw new CliError(`${what} : ${path} est lisible par d'autres (mode ${(mode & 0o777).toString(8)}) ; chmod 600 ${path}`);
  }
}

export function loadProtocolKey(path: string): ProtocolKey {
  assertOwnerOnly(path, "clé du protocole");
  let j: any;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`clé du protocole illisible (JSON attendu) : ${path}`);
  }
  if (j?.kind !== KEY_KIND || !isBytes32(j?.publicKey) || !isBytes32(j?.privateKey)) {
    throw new CliError(`${path} n'est pas une clé de protocole arcvault (champs kind/publicKey/privateKey)`);
  }
  const privateKey = toBytes(j.privateKey as Hex);
  // cohérence : un scellé vers la clé publique doit s'ouvrir avec la clé privée
  const probe = deterministicSeal(toBytes(j.publicKey as Hex), utf8("arcvault-probe"), new Uint8Array(32).fill(7));
  try {
    if (new TextDecoder().decode(deterministicOpen(privateKey, probe)) !== "arcvault-probe") throw new Error();
  } catch {
    throw new CliError(`${path} : clé publique et clé privée incohérentes`);
  }
  return { publicKey: (j.publicKey as Hex).toLowerCase() as Hex, privateKey };
}

/**
 * Une clé X25519 NEUVE pour une prime : fichier 0600 (dossier 0700), jamais écrasé. Chemin par défaut : nommé par la clé
 * publique dans BOUNTY_KEY_DIR ; un chemin explicite qui existe déjà est refusé (une clé ne sert qu'une prime).
 */
export function createBountyKey(o: { path?: string; dir?: string; sealedBounty: string; chainId: number }): { path: string; key: ProtocolKey } {
  const k = generateX25519();
  const path = o.path ?? bountyKeyPath(k.publicKey, o.dir);
  if (existsSync(path)) {
    throw new CliError(`${path} existe déjà : une clé X25519 par prime (elle ouvre tous les rapports chiffrés vers elle) ; choisissez un nouveau fichier`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = {
    kind: KEY_KIND,
    publicKey: k.publicKey,
    privateKey: toHex(k.privateKey),
    createdAt: new Date().toISOString(),
    sealedBounty: o.sealedBounty,
    chainId: o.chainId,
    bountyId: null as string | null,
    note: "Clé privée X25519 d'UNE prime : seule à pouvoir déchiffrer ses rapports d'exploit (cP). Ne jamais la partager ; " +
      "--reveal-key (réfutation) l'envoie chiffrée aux seules enclaves vérifiées, et n'ouvre alors que les rapports de cette prime.",
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { path, key: { publicKey: k.publicKey.toLowerCase() as Hex, privateKey: k.privateKey } };
}

/** Inscrit le numéro de la prime dans son fichier de clé (réécriture atomique, 0600). */
export function recordBountyId(path: string, bountyId: bigint): void {
  const j = JSON.parse(readFileSync(path, "utf8"));
  j.bountyId = bountyId.toString();
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(j, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
}

/**
 * La clé locale d'une prime, à partir de sa clé publique on-chain (Bounty.protocolX25519) : le fichier donné, sinon celui
 * de BOUNTY_KEY_DIR, sinon l'ancienne clé partagée (LEGACY_PROTOCOL_KEY) si c'est elle. `shared` : vrai pour l'ancienne clé.
 */
export function findBountyKey(publicKey: Hex, o: { path?: string; dir?: string; legacyPath?: string } = {}): { path: string; key: ProtocolKey; shared: boolean } {
  const want = publicKey.toLowerCase();
  if (o.path) {
    const key = loadProtocolKey(o.path);
    if (key.publicKey !== want) throw new CliError(`la clé ${o.path} (${key.publicKey}) n'est pas celle de la prime (${publicKey})`);
    return { path: o.path, key, shared: false };
  }
  const own = bountyKeyPath(publicKey, o.dir);
  if (existsSync(own)) {
    const key = loadProtocolKey(own);
    if (key.publicKey !== want) throw new CliError(`${own} ne contient pas la clé ${publicKey}`);
    return { path: own, key, shared: false };
  }
  const legacy = o.legacyPath ?? LEGACY_PROTOCOL_KEY;
  if (existsSync(legacy)) {
    const key = loadProtocolKey(legacy);
    if (key.publicKey === want) return { path: legacy, key, shared: true };
  }
  throw new CliError(`aucune clé locale pour la clé publique ${publicKey} (cherchée : ${own}, ${legacy}) ; donnez le fichier avec --protocol-key / --key`);
}

/** Le message de --reveal-key : EXACTEMENT ce que la clé révélée ouvre (les primes dont Bounty.protocolX25519 est elle). */
export function revealKeyWarning(a: { publicKey: Hex; bountyId: bigint; sharing?: bigint[] }): string {
  const head = `la clé privée X25519 ${a.publicKey} part chiffrée vers chaque enclave VÉRIFIÉE (qui l'efface après usage) ; ` +
    "elle ouvre TOUT rapport chiffré vers cette clé publique";
  if (!a.sharing) return `${head} : ceux de la prime #${a.bountyId} et ceux de toute autre prime créée avec la même clé (liste des primes illisible)`;
  const others = [...new Set(a.sharing.map(String))].filter((x) => x !== a.bountyId.toString()).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  if (!others.length) return `${head} : ceux de la prime #${a.bountyId} seulement (aucune autre prime n'utilise cette clé)`;
  return `${head} : ceux de la prime #${a.bountyId} ET ceux des primes ${others.map((x) => `#${x}`).join(", ")}, qui utilisent la même clé`;
}

// ---------- l'aléa r ----------

/** r : 0x + 64 hexadécimaux, ou un JSON { "r": "0x…" } ; tout le reste est refusé (sans recopier le contenu). */
export function parseR(text: string, from: string): Hex {
  const t = text.trim();
  let v: unknown = t;
  if (t.startsWith("{")) {
    try {
      v = JSON.parse(t)?.r;
    } catch {
      v = undefined;
    }
  }
  if (!isBytes32(v)) throw new CliError(`${from} : r attendu (0x + 64 caractères hexadécimaux, ou JSON { "r": "0x…" })`);
  return (v as string).toLowerCase() as Hex;
}

/** Lit r dans un fichier 0600, ou sur l'entrée standard (« - ») redirigée (jamais saisi au clavier : il s'afficherait). */
export async function readR(source: string, stdin: NodeJS.ReadStream = process.stdin): Promise<Hex> {
  if (source === "-") {
    if (stdin.isTTY) throw new CliError("--r-file - : redirigez r sur l'entrée standard (ex. < r.hex) ; la saisie au clavier s'afficherait");
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
    return parseR(Buffer.concat(chunks).toString("utf8"), "entrée standard");
  }
  assertOwnerOnly(source, "fichier de r");
  return parseR(readFileSync(source, "utf8"), source);
}

/** Écrit r dans un fichier NEUF en 0600 (bounty submit --save-r) : de quoi réfuter plus tard sans le passer en argument. */
export function saveR(path: string, r: Uint8Array): void {
  if (existsSync(path)) throw new CliError(`${path} existe déjà : choisissez un nouveau fichier pour r`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${toHex(r)}\n`, { mode: 0o600, flag: "wx" });
}
