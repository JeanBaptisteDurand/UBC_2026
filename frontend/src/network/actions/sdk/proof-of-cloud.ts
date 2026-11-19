/**
 * proof-of-cloud.ts — requests a TOKEN from the Proof of Cloud alliance (NODE ONLY: not exported by index.ts; import
 * "@arcvault/sdk/src/proof-of-cloud"). The flow is that of github.com/proofofcloud/trust-server (get_jwt_token.sh):
 * each trust server returns a nonce, then each adds its partial signature; the last one returns the co-signed JWT
 * (EdDSA, published shared key). The token is issued only if the quote's machine is on the alliance's list and not
 * revoked. It is VERIFIED here (signature, quote) before it is returned; ProofOfCloudAuditor verifies it again on-chain.
 * TLS: the Secret trust server's certificate expired on 2026-09-07; hosts in `insecureHosts` are called without
 * certificate verification. Integrity does not rely on TLS: the final token is verified against the alliance's key
 * (at worst, a man in the middle makes the request fail).
 */
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { Hex } from "viem";
import { PROOF_OF_CLOUD, parseAllianceToken, type AllianceToken } from "./levels";

function postJson(url: string, body: unknown, insecure: boolean, timeoutMs: number): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const rq = httpsRequest(url, {
      method: "POST", headers: { "content-type": "application/json", "content-length": data.length }, rejectUnauthorized: !insecure, timeout: timeoutMs,
    }, (rs) => {
      const chunks: Buffer[] = [];
      let size = 0;
      rs.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 1 << 20) rq.destroy(new Error("réponse trop grande"));
        else chunks.push(c);
      });
      rs.on("end", () => {
        const t = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: rs.statusCode ?? 0, body: JSON.parse(t) }); } catch { resolve({ status: rs.statusCode ?? 0, body: t.slice(0, 300) }); }
      });
    });
    rq.on("timeout", () => rq.destroy(new Error("délai dépassé")));
    rq.on("error", reject);
    rq.end(data);
  });
}

export interface AllianceTokenOptions {
  peers?: readonly string[];
  allianceKey?: Hex;
  insecureHosts?: readonly string[];
  timeoutMs?: number;
  log?: (m: string) => void;
}

/** Demande, vérifie et rend le jeton de l'alliance pour `quote` (hexadécimal). Lève si un serveur refuse (machine hors
 *  liste ou révoquée : HTTP 403) ou ne répond pas : il faut les TROIS signatures. */
export async function requestAllianceToken(quote: Hex, o: AllianceTokenOptions = {}): Promise<AllianceToken> {
  const peers = o.peers ?? PROOF_OF_CLOUD.peers;
  const insecureHosts = o.insecureHosts ?? ["trust-server.scrtlabs.com"];
  const timeoutMs = o.timeoutMs ?? 90_000;
  const log = o.log ?? (() => {});
  const q = quote.replace(/^0x/, "");
  const ts = Math.floor(Date.now() / 1000);
  const insecure = (u: string) => insecureHosts.includes(new URL(u).host);
  const nonces: Record<string, string> = {}, urlOf: Record<string, string> = {};
  for (const u of peers) {
    const r = await postJson(`${u.replace(/\/$/, "")}/get_jwt`, { quote: q, timestamp: ts }, insecure(u), timeoutMs).catch((e) => ({ status: 0, body: String(e) }));
    if (r.status === 200 && r.body?.moniker && r.body?.nonce) {
      nonces[r.body.moniker] = r.body.nonce;
      urlOf[r.body.moniker] = u.replace(/\/$/, "");
    } else log(`alliance : ${u} → ${r.status} ${typeof r.body === "string" ? r.body.slice(0, 120) : JSON.stringify(r.body).slice(0, 120)}`);
  }
  const chosen = Object.keys(nonces).sort();
  if (chosen.length < peers.length) throw new Error(`alliance Proof of Cloud : ${chosen.length}/${peers.length} serveurs ont accepté (machine hors liste, révoquée, ou serveur en panne)`);
  let partial: Record<string, string> = {};
  for (const m of chosen) {
    const r = await postJson(`${urlOf[m]}/get_jwt`, { quote: q, timestamp: ts, nonces, partial_sigs: partial }, insecure(urlOf[m]!), timeoutMs);
    if (r.status !== 200) throw new Error(`alliance Proof of Cloud : signature refusée par ${m} (HTTP ${r.status})`);
    if (typeof r.body?.jwt === "string") {
      const t = parseAllianceToken(r.body.jwt, o.allianceKey ?? PROOF_OF_CLOUD.allianceKey);
      if (t.quoteSha256 !== createHash("sha256").update(Buffer.from(q, "hex")).digest("hex")) throw new Error("alliance Proof of Cloud : jeton d'un autre quote");
      return t;
    }
    partial = { ...partial, ...r.body };
  }
  throw new Error("alliance Proof of Cloud : pas de jeton final");
}
