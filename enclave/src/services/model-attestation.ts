/**
 * model-attestation.ts — l'enclave VÉRIFIE le fournisseur du modèle au lieu de le croire (11/11/2026).
 *
 * Avant : l'enclave transmettait la requête déchiffrée en HTTPS à RedPill, et le README le disait : le fournisseur lit la
 * requête, ArcHive ne vérifie pas son attestation. Maintenant (MODEL_ATTESTATION=aci, variable MESURÉE du compose) :
 *  1. au démarrage, @phala/aci-verifier (Phala, Apache-2.0) établit l'identité de la passerelle de RedPill (« Attested
 *     Confidential Inference ») : quote Intel TDX vérifié jusqu'à la racine d'Intel (dcap-qvl), jeu de clés de la passerelle
 *     lié au quote pour NOTRE nonce, clés non expirées, compose mesuré dans RTMR3 (journal rejoué) ;
 *  2. ArcHive exige EN PLUS l'image système de PRODUCTION de la passerelle (événement RTMR3 « os-image-hash », authentifié
 *     par ce rejeu, dans MODEL_GATEWAY_OS_IMAGES) : une image de développement permet l'accès de l'opérateur ;
 *  3. chaque requête au modèle part sur une connexion TLS ÉPINGLÉE sur la clé attestée de la passerelle, et chaque réponse
 *     doit porter un reçu de la passerelle qui cite un service amont vérifié (`requireVerified`, `requireReceipt`) ;
 *  4. l'identité est revérifiée régulièrement (nonce frais) et avant son expiration ; un échec rend l'appel impossible
 *     (le service répond une erreur, rien n'est inventé).
 * L'état de cette vérification est public (GET /model-attestation) : les clients voient ce que l'enclave a vérifié.
 */
import { createHash } from "node:crypto";
import { connectAci, type AciConnection } from "@phala/aci-verifier/runtime";

/** Image système de production dstack-0.5.12 (VERIFIED le 10/11/2026 : nos VM et la passerelle de RedPill). */
export const DSTACK_PROD_OS_0_5_12 = "8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd";

/**
 * Empreinte d'un événement du journal RTMR de dstack, formule V1 : SHA384(le32(type) ‖ ":" ‖ nom ‖ ":" ‖ charge) —
 * celle qu'émet la passerelle RedPill aujourd'hui (VERIFIED : reproduit les 10 digests du vrai rapport). `DstackEventLog.sol`
 * gère EN PLUS une variante V2 (JSON canonique RFC-8785) non émise ici ; si RedPill y passait, `boundEventPayload`
 * refuserait (échec FERMÉ, jamais de faux positif) — robustesse à ajouter le cas échéant.
 * DURCISSEMENT (revue adverse du 11/11) : le vérificateur de Phala replie le RTMR3 à partir du `digest` de chaque
 * événement (lié au quote), mais il NE REFAIT PAS ce calcul ; on peut donc garder le digest et réécrire le nom et la
 * charge. On lie donc nom+charge au digest — et, en plus, on REFAIT nous-mêmes le repli journal→quote (voir `foldImr3`).
 */
export function dstackEventDigest(eventType: number, event: string, payloadHex: string): string {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(eventType >>> 0, 0);
  return createHash("sha384")
    .update(Buffer.concat([le, Buffer.from(":"), Buffer.from(event), Buffer.from(":"), Buffer.from(payloadHex, "hex")]))
    .digest("hex");
}

/** La charge d'un UNIQUE événement RTMR3 (imr=3) de ce nom, mais SEULEMENT si son empreinte se recalcule (nom+charge
 *  liés au digest). Sinon null : absent, ambigu, ou charge réécrite derrière un digest inchangé. */
export function boundEventPayload(report: unknown, name: string): string | null {
  const ev = (report as any)?.attestation?.evidence?.event_log;
  let log: unknown;
  try {
    log = typeof ev === "string" ? JSON.parse(ev) : ev;
  } catch {
    return null;
  }
  if (!Array.isArray(log)) return null;
  const hits = log.filter((e: any) => e && Number(e.imr) === 3 && e.event === name);
  if (hits.length !== 1) return null; // absent ou ambigu : jamais accepté
  const e: any = hits[0];
  const payload = String(e.event_payload ?? "").toLowerCase();
  const digest = String(e.digest ?? "").toLowerCase();
  const et = Number(e.event_type);
  if (!/^(?:[0-9a-f]{2})*$/.test(payload)) return null; // octets en hexadécimal
  if (!/^[0-9a-f]{96}$/.test(digest) || !Number.isInteger(et)) return null; // digest SHA-384
  if (dstackEventDigest(et, name, payload) !== digest) return null; // charge NON liée au quote → rejet
  return payload;
}

/** RTMR3 (48 octets) lu DANS le quote TDX du rapport : en-tête 48 + corps du rapport (…, rtmr0@376, rtmr1@424,
 *  rtmr2@472, rtmr3@520). Ce quote est celui que le vérificateur a mené jusqu'à la racine d'Intel. */
export function quoteRtmr3Of(report: unknown): string | null {
  const q = (report as any)?.attestation?.evidence?.quote ?? (report as any)?.intel_quote;
  if (typeof q !== "string") return null;
  const b = Buffer.from(q.replace(/^0x/, ""), "hex");
  if (b.length < 568) return null;
  return b.subarray(520, 568).toString("hex");
}

/** DÉFENSE EN PROFONDEUR (revue du 11/11) : on NE CROIT PAS le vérificateur de Phala pour lier le journal au quote —
 *  on REFAIT le repli. RTMR3 part de 48 octets nuls ; à chaque événement imr=3, RTMR3 = SHA384(RTMR3 ‖ digest). Le
 *  résultat doit égaler le RTMR3 du quote. Ainsi, charge → digest (boundEventPayload) → RTMR3 (ici) → quote : la chaîne
 *  entière est vérifiée par NOTRE code, indépendamment du verdict de la librairie. */
export function foldImr3(report: unknown): string | null {
  const ev = (report as any)?.attestation?.evidence?.event_log;
  let log: unknown;
  try {
    log = typeof ev === "string" ? JSON.parse(ev) : ev;
  } catch {
    return null;
  }
  if (!Array.isArray(log)) return null;
  let acc = Buffer.alloc(48);
  for (const e of log as any[]) {
    if (Number(e?.imr) !== 3) continue;
    const d = String(e?.digest ?? "").toLowerCase();
    if (!/^[0-9a-f]{96}$/.test(d)) return null;
    acc = createHash("sha384").update(Buffer.concat([acc, Buffer.from(d, "hex")])).digest();
  }
  return acc.toString("hex");
}

export interface ModelAttestationOptions {
  /** URL de base compatible OpenAI de la passerelle attestée (ex. https://tee.redpill.ai/v1). */
  baseUrl: string;
  /** Empreintes acceptées de l'image système de la passerelle (hexadécimal, sans 0x). */
  osImages: readonly string[];
  /** Empreintes de compose épinglées (facultatif) : si données, le compose mesuré doit en faire partie. */
  composeHashes?: readonly string[];
  /** Revérification périodique (défaut : 30 min). */
  refreshMs?: number;
  log?: (m: string) => void;
  /** Tests : remplace connectAci. */
  connect?: typeof connectAci;
}

export interface ModelAttestationStatus {
  provider: string;
  verified: boolean;
  gatewayOrigin: string;
  composeHash: string;
  osImageHash: string | null;
  workloadKeysetDigest: string;
  tlsSpkiPins: readonly string[];
  sourceProvenance: unknown;
  verifiedAt: number;
  expiresAt: number;
  checks: { id: string; status: string; title: string }[];
  servingPolicy: { requireVerified: true; requireReceipt: true };
  receiptsRecorded: number;
  lastError: string | null;
}

export class ModelAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelAttestationError";
  }
}

/** L'empreinte de l'image système lue dans le journal RTMR3 (événement « os-image-hash », LIÉ à son digest), ou null. */
export function osImageHashOf(report: unknown): string | null {
  const p = boundEventPayload(report, "os-image-hash");
  return p && /^[0-9a-f]{64}$/.test(p) ? p : null;
}

/** Contrôles d'ArcHive en plus de ceux du vérificateur : verdict vérifié, image système de production, et empreinte du
 *  compose LIÉE au journal (et épinglée si `composeHashes` est donné). Rend l'empreinte de l'image système acceptée. */
export function checkGatewayIdentity(
  id: AciConnection["identity"],
  osImages: readonly string[],
  composeHashes?: readonly string[],
): string {
  if (!id.transcript?.verdict?.verified) throw new ModelAttestationError(`passerelle du modèle NON vérifiée : ${id.transcript?.verdict?.line ?? "verdict absent"}`);
  const os = osImageHashOf(id.report);
  if (!os) throw new ModelAttestationError("passerelle du modèle : image système absente du journal RTMR3");
  if (!osImages.map((x) => x.toLowerCase().replace(/^0x/, "")).includes(os)) {
    throw new ModelAttestationError(`passerelle du modèle : image système ${os.slice(0, 12)}… hors de la liste de production`);
  }
  // l'empreinte du compose mesurée doit être LIÉE au journal (même faille que l'image système) et égale à celle que le
  // vérificateur a calculée depuis app_compose ; épinglée en plus si une liste est fournie
  const compose = boundEventPayload(id.report, "compose-hash");
  const idCompose = String(id.composeHash ?? "").toLowerCase().replace(/^0x/, "");
  if (!compose || !idCompose || compose !== idCompose) {
    throw new ModelAttestationError("passerelle du modèle : empreinte du compose non liée au journal RTMR3");
  }
  if (composeHashes && composeHashes.length > 0 && !composeHashes.map((x) => x.toLowerCase().replace(/^0x/, "")).includes(idCompose)) {
    throw new ModelAttestationError(`passerelle du modèle : compose ${idCompose.slice(0, 12)}… hors de la liste épinglée`);
  }
  // DÉFENSE EN PROFONDEUR : le journal RTMR3 se replie-t-il EXACTEMENT sur le RTMR3 du quote ? Si oui, les digests (donc
  // les charges liées ci-dessus) sont ancrés au quote par NOTRE calcul, sans faire confiance au verdict de la librairie.
  const r3 = quoteRtmr3Of(id.report);
  const fold = foldImr3(id.report);
  if (!r3 || !fold || r3 !== fold) {
    throw new ModelAttestationError("passerelle du modèle : le journal RTMR3 ne se replie pas sur le RTMR3 du quote");
  }
  return os;
}

/** Une connexion ATTESTÉE au modèle : `fetch` épinglé, revérifié, et l'état public de la vérification. */
export class AttestedModel {
  private conn!: AciConnection;
  private osImageHash: string | null = null;
  private lastError: string | null = null;
  private healthy = false; // la passerelle ACTUELLE passe-t-elle encore nos contrôles ? sinon, échec fermé
  private timer: ReturnType<typeof setInterval> | undefined;

  private constructor(private o: ModelAttestationOptions) {}

  /** Revérifie l'identité ACTUELLE (sans réseau : inspection du rapport déjà vérifié) ; lève si elle ne passe plus.
   *  Attrape une bascule interne de la librairie vers une passerelle non approuvée que nos contrôles n'ont pas vue. */
  private assertApproved() {
    this.osImageHash = checkGatewayIdentity(this.conn.identity, this.o.osImages, this.o.composeHashes);
  }

  /** Établit et contrôle l'identité de la passerelle ; lève si elle n'est pas vérifiée (l'enclave ne démarre pas). */
  static async open(o: ModelAttestationOptions): Promise<AttestedModel> {
    const m = new AttestedModel(o);
    await m.establish();
    m.timer = setInterval(() => {
      m.refresh().catch((e) => {
        m.lastError = String((e as Error)?.message ?? e).slice(0, 200);
        o.log?.(`attestation du modèle : revérification impossible (${m.lastError})`);
      });
    }, o.refreshMs ?? 30 * 60_000);
    m.timer.unref?.();
    return m;
  }

  private async establish() {
    const connect = this.o.connect ?? connectAci;
    const conn = await connect({ baseURL: this.o.baseUrl, serving: { requireVerified: true, requireReceipt: true } });
    this.conn = conn;
    this.assertApproved(); // lève si la passerelle ne passe pas nos contrôles → l'enclave ne démarre pas
    this.healthy = true;
    this.lastError = null;
    this.o.log?.(`attestation du modèle : passerelle ${conn.identity.origin} VÉRIFIÉE (compose ${conn.identity.composeHash.slice(0, 12)}…, image système de production, TLS épinglé, reçus exigés)`);
  }

  /** Revérifie l'identité (nonce frais). La librairie installe la nouvelle identité AVANT ce contrôle ; si le contrôle
   *  échoue, on marque la passerelle NON saine (échec fermé) et on lève, au lieu de continuer à la servir. */
  async refresh(): Promise<void> {
    await this.conn.refresh();
    try {
      this.assertApproved();
    } catch (e) {
      this.healthy = false;
      this.lastError = String((e as Error)?.message ?? e).slice(0, 200);
      throw e;
    }
    this.healthy = true;
    this.lastError = null;
  }

  /** Le `fetch` à donner au client du modèle : épinglé et à ÉCHEC FERMÉ. Identité expirée → revérification (qui peut
   *  lever) ; passerelle non saine ou non approuvée en ce moment → on ne part pas (rien n'est envoyé à une passerelle
   *  rejetée, y compris après une bascule interne de la librairie). */
  readonly fetch: typeof fetch = async (input: any, init?: any) => {
    if (Date.now() >= this.conn.identity.expiresAt * (this.conn.identity.expiresAt < 1e12 ? 1000 : 1)) await this.refresh();
    if (!this.healthy) throw new ModelAttestationError("passerelle du modèle non vérifiée en ce moment : appel refusé (échec fermé)");
    this.assertApproved(); // avant chaque appel : la passerelle actuelle passe-t-elle encore nos contrôles ?
    try {
      return await this.conn.fetch(input, init);
    } catch (e: any) {
      if (e?.code === "identity_expired") {
        await this.refresh(); // peut lever (échec fermé)
        this.assertApproved();
        return this.conn.fetch(input, init);
      }
      this.lastError = String(e?.code ?? e?.name ?? "erreur").slice(0, 60); // jamais le message (il peut citer la requête)
      throw e;
    }
  };

  get baseURL(): string {
    return this.conn.baseURL;
  }

  status(): ModelAttestationStatus {
    const id = this.conn.identity;
    return {
      provider: "RedPill private AI gateway (Attested Confidential Inference), verified with @phala/aci-verifier",
      verified: this.healthy && !!id.transcript?.verdict?.verified,
      gatewayOrigin: id.origin,
      composeHash: id.composeHash,
      osImageHash: this.osImageHash,
      workloadKeysetDigest: id.workloadKeysetDigest,
      tlsSpkiPins: id.tlsSpkiPins,
      sourceProvenance: (id.report as any)?.attestation?.source_provenance ?? null,
      verifiedAt: id.verifiedAt,
      expiresAt: id.expiresAt,
      checks: ((id.transcript as any)?.lines ?? []).map((l: any) => ({ id: String(l.id), status: String(l.status), title: String(l.title) })),
      servingPolicy: { requireVerified: true, requireReceipt: true },
      receiptsRecorded: this.conn.receipts().length,
      lastError: this.lastError,
    };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.conn.close().catch(() => undefined);
  }
}

/** MODEL_GATEWAY_OS_IMAGES (mesurée) : empreintes acceptées de l'image système de la passerelle ; défaut : dstack-0.5.12. */
export function osImagesFromEnv(v: string | undefined): string[] {
  const list = (v ?? DSTACK_PROD_OS_0_5_12).split(",").map((s) => s.trim().toLowerCase().replace(/^0x/, "")).filter(Boolean);
  if (list.length === 0 || list.some((x) => !/^[0-9a-f]{64}$/.test(x))) throw new Error("MODEL_GATEWAY_OS_IMAGES : empreintes de 32 octets en hexadécimal, séparées par des virgules");
  return list;
}

/** MODEL_GATEWAY_COMPOSE_HASHES (mesurée, FACULTATIVE) : empreintes de compose épinglées ; vide = pas d'épinglage
 *  (le compose reste lié au journal, mais n'importe quel compose authentique passe). */
export function composeHashesFromEnv(v: string | undefined): string[] | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  const list = s.split(",").map((x) => x.trim().toLowerCase().replace(/^0x/, "")).filter(Boolean);
  if (list.length === 0 || list.some((x) => !/^[0-9a-f]{64}$/.test(x))) throw new Error("MODEL_GATEWAY_COMPOSE_HASHES : empreintes de 32 octets en hexadécimal, séparées par des virgules");
  return list;
}

/** Corps de GET /model-attestation. */
export function modelAttestationBody(a: AttestedModel | undefined): unknown {
  return a ? a.status() : { verified: false, reason: "MODEL_ATTESTATION absent : le fournisseur du modèle n'est pas vérifié par cette enclave" };
}
