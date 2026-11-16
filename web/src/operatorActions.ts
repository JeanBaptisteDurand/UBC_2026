/** operatorActions.ts — actions d'opérateur signées par le wallet, depuis le site (pile v2).
 *  - signAction : un message EIP-4361 (« Sign-In with Ethereum », signin.ts) avec un nonce neuf de l'API ; le wallet
 *    montre le site, l'action, le réseau et l'échéance, et signale un site imposteur ; aucune transaction, aucun frais.
 *  - registerMachineEnclave : inscription par le VRAI DCAP. Le SDK lit l'attestation de la machine (/attest), contrôle
 *    le quote hors chaîne (vrai Intel TDX, pas de DEBUG, SEPT_VE_DISABLE, image autorisée par le produit, REPORTDATA
 *    lié à votre adresse), puis registerEnclave : la chaîne vérifie la signature d'Intel (≈ 5,7 M gas) et la politique
 *    du produit. Aucun module de test, aucune mesure déclarée à la main : un quote simulé est refusé avant tout envoi.
 *    Rend aussi `admittedBy` : l'empreinte qui a fait admettre l'enclave (« image » : stable d'un redémarrage à
 *    l'autre ; « workload » : empreinte complète de la machine), à montrer après l'inscription (registeredMsg).
 *    Ses étapes (onStep) et son message de réussite sont des messages (msg.ts) : ils suivent la langue du site.
 *  - sendTx : une transaction que le SDK n'enveloppe pas (ex. setAgentId), simulée puis attendue. */
import { type Address, type Hex } from "viem";
import { arcErrorsAbi, testnet, type ArcClient } from "@arcvault/sdk";
import { fetchNonce, type Signed } from "./api";
import { dcapGasLabel, verifiedLabel, waitOk } from "./arc";
import { MsgError, msg, type Msg } from "./msg";
import { buildSignIn, type SignedAction } from "./signin";

/** Signe une action d'opérateur : nonce neuf de l'API (usage unique, 5 min), message EIP-4361 pour CE site
 *  (domaine et origine de la page), signature du wallet. Rend aussi l'échéance de la signature (ms). */
export async function signAction(arc: ArcClient, action: SignedAction): Promise<Signed & { expiresAt: number }> {
  if (!arc.wallet || !arc.account) throw new MsgError(msg("err.connectWallet"));
  const address = arc.account.address;
  const n = await fetchNonce();
  const { message, expiresAt } = buildSignIn({
    domain: window.location.host, uri: window.location.origin, chainId: testnet.chainId,
    address, action, nonce: n.nonce, issuedAt: n.issuedAt,
  });
  const signature = await arc.wallet.signMessage({ account: arc.account, message });
  return { address, message, signature, expiresAt };
}

/** Simule (refus décodés avec toutes les erreurs du réseau), envoie, puis attend la confirmation. */
export async function sendTx(arc: ArcClient, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]): Promise<Hex> {
  if (!arc.wallet || !arc.account) throw new MsgError(msg("err.connectWallet"));
  const fullAbi = [...abi, ...arcErrorsAbi] as any;
  const { request } = await arc.pub.simulateContract({ account: arc.account, address, abi: fullAbi, functionName, args } as any);
  const hash = await arc.wallet.writeContract(request as any);
  await waitOk(arc, hash);
  return hash;
}

export type AdmittedBy = "image" | "workload";

export async function registerMachineEnclave(arc: ArcClient, productId: bigint, enclaveUrl: string, onStep: (m: Msg) => void) {
  if (!arc.wallet || !arc.account) throw new MsgError(msg("err.connectWallet"));
  const url = enclaveUrl.replace(/\/$/, "");
  onStep(msg("arc.reg.step1", { id: productId }));
  let r: { tx: Hex; signer: Address; x25519: Hex; workloadId: Hex; admittedBy: AdmittedBy };
  try {
    r = await arc.registerEnclave(productId, url);
  } catch (e: any) {
    // /attest injoignable : machine hors ligne, ou adresse non publique (le contrôle du quote n'a pas pu commencer)
    const offline = (e?.name === "TypeError" && /fetch|network|load failed/i.test(String(e?.message))) || e?.name === "TimeoutError" || e?.name === "AbortError";
    if (offline) {
      throw new MsgError(msg("arc.reg.offline", { url }));
    }
    throw e;
  }
  onStep(msg("arc.reg.step2", { gas: dcapGasLabel }));
  await waitOk(arc, r.tx, "tx.register");
  return { tx: r.tx, signer: r.signer, workloadId: r.workloadId, admittedBy: r.admittedBy };
}

/** Le message de réussite d'une inscription : l'enclave, sa transaction, et l'empreinte qui l'a fait admettre. */
export function registeredMsg(r: { tx: Hex; signer: Address; admittedBy?: AdmittedBy }): Msg {
  const done = msg("arc.reg.done", { signer: r.signer, label: verifiedLabel, tx: r.tx });
  return r.admittedBy ? msg("arc.reg.doneWith", { done, admitted: msg(r.admittedBy === "image" ? "arc.admitted.image" : "arc.admitted.workload") }) : done;
}

/** Ouvre le copilote avec une question déjà posée (depuis n'importe quel écran). */
export function askCopilot(text: string) {
  window.dispatchEvent(new CustomEvent("archive:ask", { detail: text }));
}
