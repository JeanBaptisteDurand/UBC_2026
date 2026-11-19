// URLs configurables au build (VITE_*). Par défaut : local en dev, remplacé pour le déploiement.
import { isAddress, type Address } from "viem";

const env = (import.meta as any).env ?? {};
export const API_URL: string = env.VITE_API_URL ?? "http://localhost:8809"; // lecture d'état (évite de marteler le RPC)
export const COPILOT_URL: string = env.VITE_COPILOT_URL ?? "http://localhost:8808"; // copilote EN CLAIR du serveur
export const ENCLAVE_URL: string = env.VITE_ENCLAVE_URL ?? "http://localhost:8802"; // inférence (O2)
export const O3_URL: string = env.VITE_O3_URL ?? "http://localhost:8803"; // Prime scellée (O3)
/** 19/11 : l'enclave de la Prime au niveau vérifié (produit 7), servie à côté de celle du niveau ouvert (/enclave/bounty-verified) */
export const O3V_URL: string = env.VITE_O3V_URL ?? O3_URL.replace(/\/enclave\/bounty\/?$/, "/enclave/bounty-verified");
/** Inférence payée à l'appel (x402, produit 3 de la v2.1) : facultative (vide = à saisir sur la page). */
export const X402_URL: string = String(env.VITE_X402_URL ?? "").trim();

/** Le copilote ATTESTÉ (produit 4 de la v2.1) : facultatif. Les trois variables ensemble, sinon la bulle parle au copilote
 *  du serveur, comme avant (VITE_COPILOT_URL). L'opérateur attendu est obligatoire : l'enclave doit être active chez LUI. */
export interface AttestedCopilotConfig { url: string; productId: bigint; operator: Address }

function attestedCopilot(): AttestedCopilotConfig | null {
  const url = String(env.VITE_COPILOT_ENCLAVE_URL ?? "").trim();
  const pid = String(env.VITE_COPILOT_PRODUCT_ID ?? "").trim();
  const op = String(env.VITE_COPILOT_OPERATOR ?? "").trim();
  if (!url && !pid && !op) return null;
  // une configuration incomplète ou invalide n'est jamais « à moitié attestée » : la bulle reste sur le serveur
  if (!/^https?:\/\/\S+$/.test(url) || !/^[0-9]{1,10}$/.test(pid) || !isAddress(op, { strict: false })) {
    console.warn("VITE_COPILOT_ENCLAVE_URL / VITE_COPILOT_PRODUCT_ID / VITE_COPILOT_OPERATOR incomplets ou invalides : copilote du serveur seulement");
    return null;
  }
  return { url: url.replace(/\/+$/, ""), productId: BigInt(pid), operator: op as Address };
}
export const ATTESTED_COPILOT: AttestedCopilotConfig | null = attestedCopilot();

/** 19/11 : le copilote attesté du produit 4 tourne depuis le 19/11 dans l'enclave du copilote du SITE (surface « site »,
 *  /enclave/copilot-site, à côté de /enclave/copilot) : le panneau de la Ruche y confronte sa clé à Arc (lecture de
 *  /pubkeys seulement). Vide : pas de contrôle. */
export const COPILOT_SITE_URL: string = String(env.VITE_COPILOT_SITE_ENCLAVE_URL
  ?? String(env.VITE_COPILOT_ENCLAVE_URL ?? "").trim().replace(/\/enclave\/copilot\/?$/, "/enclave/copilot-site")).trim();
