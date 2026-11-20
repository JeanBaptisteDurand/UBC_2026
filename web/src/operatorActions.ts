/** operatorActions.ts — operator actions signed by the wallet, from the site (v3 stack).
 *  - signAction signs an EIP-4361 message ("Sign-In with Ethereum", signin.ts) with a fresh nonce from the API. The
 *    wallet shows the site, the action, the network and the expiry, and flags an impostor site. No transaction, no fee.
 *  - registerMachineEnclave registers through the REAL DCAP verifier. The SDK reads the machine's attestation (/attest)
 *    and checks the quote off-chain: real Intel TDX, no DEBUG, SEPT_VE_DISABLE, an image the product allows, and
 *    REPORTDATA bound to your address. It then calls registerEnclave, and the chain verifies Intel's signature
 *    (≈ 6.9 M gas) and the product's policy. There is no test module and no hand-declared measurement: a simulated
 *    quote is refused before anything is sent. It also returns `admittedBy`, the fingerprint that got the enclave
 *    admitted ("image": stable across restarts; "workload": the machine's full fingerprint), shown after registration
 *    (registeredMsg). Its steps (onStep) and its success message are messages (msg.ts), so they follow the site's
 *    language.
 *  - sendTx sends a transaction the SDK does not wrap (e.g. setAgentId), simulated first, then awaited. */
import { type Address, type Hex } from "viem";
import { arcErrorsAbi, type ArcClient } from "@arcvault/sdk";
import { testnet } from "./deployment";
import { fetchNonce, type Signed } from "./api";
import { dcapGasLabel, verifiedLabel, waitOk } from "./arc";
import { MsgError, msg, type Msg } from "./msg";
import { buildSignIn, type SignedAction } from "./signin";

/** Signs an operator action: a fresh nonce from the API (single use, 5 min), an EIP-4361 message for THIS site (the
 *  page's domain and origin), the wallet's signature. Also returns the signature's expiry (ms). */
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

/** Simulates (refusals decoded with all the network's errors), sends, then waits for the confirmation. */
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
    // /attest unreachable: the machine is offline, or its address is not public (the quote check could not start)
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

/** The success message of a registration: the enclave, its transaction, and the fingerprint that got it admitted. */
export function registeredMsg(r: { tx: Hex; signer: Address; admittedBy?: AdmittedBy }): Msg {
  const done = msg("arc.reg.done", { signer: r.signer, label: verifiedLabel, tx: r.tx });
  return r.admittedBy ? msg("arc.reg.doneWith", { done, admitted: msg(r.admittedBy === "image" ? "arc.admitted.image" : "arc.admitted.workload") }) : done;
}

/** Opens the copilot with a question already asked (from any screen). */
export function askCopilot(text: string) {
  window.dispatchEvent(new CustomEvent("archive:ask", { detail: text }));
}
