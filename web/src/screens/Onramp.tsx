import { useState } from "react";
import { type Address } from "viem";
import { readUsdcBalances, type CctpChain, testnet } from "@arcvault/sdk";
import { useAccount } from "wagmi";
import { Card, Btn, Field, Stat, Mono, Badge, usdc } from "../ui";
import { t, tx } from "../i18n";
import { explainError } from "../errors";

// Config par défaut (éditable). Les soldes se lisent sur chaque chaîne ; le pont CCTP passe par le
// TokenMessengerV2 de la chaîne source. Arc = domaine CCTP 26.
// TokenMessengerV2 CCTP v2 testnet (adresse déterministe, code vérifié sur ces 3 chaînes).
const CCTP_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
const DEFAULT_CHAINS: CctpChain[] = [
  { key: "arc", name: "Arc testnet", chainId: 5042002, rpcUrl: "https://rpc.testnet.arc.io", usdc: testnet.usdc, cctpDomain: 26, tokenMessenger: CCTP_TOKEN_MESSENGER },
  { key: "eth-sepolia", name: "Ethereum Sepolia", chainId: 11155111, rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", cctpDomain: 0, tokenMessenger: CCTP_TOKEN_MESSENGER },
  { key: "base-sepolia", name: "Base Sepolia", chainId: 84532, rpcUrl: "https://base-sepolia-rpc.publicnode.com", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", cctpDomain: 6, tokenMessenger: CCTP_TOKEN_MESSENGER },
];

/** Ce qu'a rencontré la lecture d'un solde sur UNE chaîne, en nommant cette chaîne (un 429 d'Ethereum Sepolia n'est pas
 *  « le RPC d'Arc ») ; le message de viem (« HTTP request failed. ») n'est jamais montré tel quel. Le reste : explainError. */
function chainError(e: unknown, chain: string): string {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x?.name === "HttpRequestError") {
      if (x.status === 429) return t("onramp.err.429", { chain });
      return typeof x.status === "number" && x.status > 0 ? t("onramp.err.http", { chain, status: x.status }) : t("onramp.err.down", { chain });
    }
    if (x?.name === "TimeoutError") return t("onramp.err.slow", { chain });
  }
  return explainError(e);
}
/** Une phrase trop longue pour la ligne est coupée avec « … » (le texte entier reste dans l'infobulle). */
const clip = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function Onramp() {
  const { address } = useAccount();
  const [owner, setOwner] = useState("");
  // l'erreur d'une chaîne est gardée telle quelle et mise en mots à l'affichage (elle suit la langue du site)
  const [rows, setRows] = useState<Array<{ chain: CctpChain; balance?: bigint; error?: unknown }>>([]);
  const [loading, setLoading] = useState(false);

  async function scan() {
    const who = (owner || address) as Address;
    if (!who) return;
    setLoading(true); setRows([]);
    // lecture résiliente, chaîne par chaîne
    const out: Array<{ chain: CctpChain; balance?: bigint; error?: unknown }> = [];
    for (const chain of DEFAULT_CHAINS) {
      try { const res = await readUsdcBalances([chain], who); out.push({ chain, balance: res[0]?.balance }); }
      catch (e: any) { out.push({ chain, error: e ?? new Error("?") }); }
      setRows([...out]);
    }
    setLoading(false);
  }

  const total = rows.reduce((s, r) => s + (r.balance ?? 0n), 0n);

  return (
    <div className="space-y-6">
      <Card title={t("onramp.title")} sub={t("onramp.sub")}>
        <div className="flex items-end gap-3">
          <div className="flex-1"><Field label={t("onramp.address")} value={owner} onChange={setOwner} placeholder={address ?? "0x…"} /></div>
          <Btn onClick={scan} disabled={loading}>{loading ? t("onramp.reading") : t("onramp.show")}</Btn>
        </div>
      </Card>

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={t("onramp.total")} value={usdc(total)} tone="good" />
            <Stat label={t("onramp.onArc")} value={usdc(rows.find((r) => r.chain.key === "arc")?.balance)} />
            <Stat label={t("onramp.toMove")} value={usdc(total - (rows.find((r) => r.chain.key === "arc")?.balance ?? 0n))} tone="warn" />
          </div>
          <Card title={t("onramp.byChain")}>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.chain.key} className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-ink/50 p-3">
                  <div><span className="font-medium">{r.chain.name}</span> <Mono>{t("onramp.domain", { n: r.chain.cctpDomain })}</Mono></div>
                  <div className="flex min-w-0 items-center gap-2">
                    {r.error !== undefined
                      ? (() => {
                        const why = chainError(r.error, r.chain.name);
                        return <span className="min-w-0 break-words text-right text-[12px] text-bad" title={why}>{clip(why)}</span>;
                      })()
                      : <span className="font-mono text-sm">{usdc(r.balance)}</span>}
                    {r.chain.key !== "arc" && r.error === undefined && (r.balance ?? 0n) > 0n && (
                      <Badge tone={r.chain.tokenMessenger ? "good" : "muted"}>{r.chain.tokenMessenger ? t("onramp.convert") : t("onramp.needConfig")}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">{tx("onramp.note", { burn: <Mono>depositForBurn</Mono>, mint: <Mono>receiveMessage</Mono>, link: <a href="/bridge.html" className="text-accent underline">/bridge.html</a> })}</p>
          </Card>
        </>
      )}
    </div>
  );
}
