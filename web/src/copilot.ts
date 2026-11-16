/** copilot.ts — le copilote ATTESTÉ, côté site (produit 4 de la v2.1), quand VITE_COPILOT_ENCLAVE_URL,
 *  VITE_COPILOT_PRODUCT_ID et VITE_COPILOT_OPERATOR sont posés (config.ts : ATTESTED_COPILOT) :
 *  - makeAttestedCopilot : le client du SDK (createAttestedCopilotClient). Il lit le RPC d'Arc DIRECTEMENT (le client
 *    public de wagmi, jamais notre API) pour vérifier la clé du copilote (inscrite pour ce produit, active, image encore
 *    autorisée, opérateur non radié, et actif chez l'opérateur attendu), chiffre la conversation vers elle et n'accepte
 *    qu'une réponse scellée pour CETTE requête ;
 *  - registrationTx : la transaction d'inscription de l'enclave (EnclaveRegistered au bloc où sa fenêtre a commencé),
 *    pour le lien du badge vers l'explorateur. Une lecture d'un seul bloc, gardée en mémoire ;
 *  - stripCitations : le texte d'un copilote (attesté ou du serveur) à l'affichage, sans les marques de citation brutes
 *    du modèle (les sources sont dans la ligne « sources »).
 *  Le badge « attested copilot · verified on Arc » ne se tire QUE d'une réponse authentifiée (authenticated === true) :
 *  la bulle (screens/FloatingCopilot.tsx) ne le montre jamais pour un refus en clair ni pour le copilote du serveur. */
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { createAttestedCopilotClient, testnet, type AttestedCopilotClient } from "@arcvault/sdk";
import { ATTESTED_COPILOT } from "./config";

/** Le client du copilote attesté, ou null s'il n'est pas configuré (la bulle parle alors au copilote du serveur). */
export function makeAttestedCopilot(pub: PublicClient | undefined | null): AttestedCopilotClient | null {
  if (!ATTESTED_COPILOT || !pub) return null;
  return createAttestedCopilotClient({
    copilotUrl: ATTESTED_COPILOT.url,
    productId: ATTESTED_COPILOT.productId,
    publicClient: pub as any, // deux copies de viem (site, SDK) : même version, types distincts
    deployment: testnet,
    // obligatoire ici : l'enclave doit être active chez CET opérateur (pas seulement « une image autorisée »)
    expectedOperator: ATTESTED_COPILOT.operator,
  });
}

/** Une suite de marques de citation du modèle (【4:0†source】, 【{"source": …}】…), quelle que soit leur longueur, JSON
 *  et retours à la ligne compris, avec les espaces qui l'entourent. */
const CITATIONS = /[ \t]*(?:【[^】]*】[ \t]*)+/g;

/** Le texte d'un copilote sans les marques de citation brutes du modèle : le serveur ne retire que les courtes (80
 *  caractères au plus, sur une ligne) ; ici, toutes, à l'affichage seulement (le texte gardé et renvoyé au copilote
 *  reste tel qu'il est venu). Ce qui entourait une marque se recolle : rien en bord de ligne, après « ( » ni devant
 *  « . , ) » ; devant « : ; ! ? » », l'espace que le texte y avait mise ; entre deux mots, une espace. */
export function stripCitations(text: string): string {
  if (!text.includes("【")) return text;
  return text.replace(CITATIONS, (m: string, at: number, all: string) => {
    const prev = at > 0 ? all[at - 1]! : "\n";
    const next = all[at + m.length] ?? "\n";
    if (/[\r\n([{]/.test(prev) || /[\r\n.,)\]}…]/.test(next)) return "";
    if (/[:;!?»]/.test(next)) return /[ \t]$/.test(m) ? " " : "";
    return " ";
  });
}

const ENCLAVE_REGISTERED = parseAbiItem(
  "event EnclaveRegistered(address indexed signer, uint256 indexed productId, address indexed operator, bytes32 workloadId, uint64 expiresAt)",
);
const registrations = new Map<string, Promise<Hex | null>>();

/** La transaction qui a inscrit cette enclave : sa fenêtre de validité commence au bloc de son inscription (un
 *  renouvellement sans trou la garde), on lit donc EnclaveRegistered à ce seul bloc. null si introuvable (RPC muet). */
export function registrationTx(pub: PublicClient, signer: Address, fromBlock: bigint): Promise<Hex | null> {
  const key = `${signer.toLowerCase()}:${fromBlock}`;
  let p = registrations.get(key);
  if (!p) {
    p = pub
      .getLogs({ address: testnet.enclaveRegistry, event: ENCLAVE_REGISTERED, args: { signer }, fromBlock, toBlock: fromBlock })
      .then((logs) => (logs[0]?.transactionHash ?? null) as Hex | null)
      .catch(() => {
        registrations.delete(key); // relu à la prochaine demande
        return null;
      });
    registrations.set(key, p);
  }
  return p;
}
