/** testWallet.ts — TEST MODE (Arc testnet): a "wallet" whose signatures are made by ArcHive's provisioned server
 *  wallet (the API's /test-signer route), to run the flows end to end without a browser extension. Invisible without a
 *  token. To turn it on, open the site once with ?testsigner=<token> (the token is kept in this browser and removed
 *  from the address). The server signs ONLY towards ArcHive's contracts, on Arc testnet. */
import { API_URL } from "./config";
import { t } from "./i18n";

const RPC = "https://rpc.testnet.arc.io";
const KEY = "archive.testSigner";
const WALLET_METHODS = new Set([
  "eth_accounts", "eth_requestAccounts", "eth_chainId", "net_version", "wallet_switchEthereumChain",
  "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
]);

export function testSignerToken(): string | null {
  try {
    const u = new URL(window.location.href);
    const tok = u.searchParams.get("testsigner");
    if (tok) {
      localStorage.setItem(KEY, tok);
      u.searchParams.delete("testsigner");
      window.history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash);
    }
    return localStorage.getItem(KEY);
  } catch { return null; }
}

export function leaveTestMode() {
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
  window.location.reload();
}

/** EIP-1193 provider: signatures → the server wallet (with the token); reads → Arc's public RPC. */
export function makeTestProvider(token: string) {
  const listeners: Record<string, Set<(...a: unknown[]) => void>> = {};
  const call = async (url: string, payload: unknown, auth?: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({ error: { code: -32603, message: t("err.unreadable", { status: r.status }) } }));
    if (j.error) { const e: any = new Error(j.error.message ?? String(j.error)); e.code = j.error.code ?? -32603; throw e; }
    return j.result;
  };
  return {
    isArcHiveTest: true,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "wallet_addEthereumChain" || method === "wallet_requestPermissions") return null;
      if (WALLET_METHODS.has(method)) return call(`${API_URL.replace(/\/$/, "")}/test-signer/rpc`, { method, params: params ?? [] }, token);
      return call(RPC, { jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] });
    },
    on(ev: string, fn: (...a: unknown[]) => void) { (listeners[ev] ??= new Set()).add(fn); },
    removeListener(ev: string, fn: (...a: unknown[]) => void) { listeners[ev]?.delete(fn); },
  };
}

export const TEST_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpolygon points='50,4 93,27 93,73 50,96 7,73 7,27' fill='%23fbbf24'/%3E%3Ctext x='50' y='64' font-size='40' text-anchor='middle' fill='%23070b16' font-family='sans-serif'%3ET%3C/text%3E%3C/svg%3E";
