/** Playground.tsx — l'IA privée en enclave, avec le choix de la façon de payer :
 *  - « Session prépayée » : un dépôt, puis autant de messages qu'il en couvre (Chat.tsx, SessionPay) ;
 *  - « Paiement à l'appel (x402) » : chaque message payé par une signature du prix lu sur Arc (X402Chat.tsx, X402Settler).
 *  Les deux restent montés : changer de mode ne fait perdre ni la session ouverte (sa clé n'est qu'en mémoire) ni la
 *  conversation payée à l'appel. Le choix est gardé dans ce navigateur (commodité, stockage protégé). */
import { useState } from "react";
import { PageHeader, Btn, usdc } from "../ui";
import { t, useLang } from "../i18n";
import { safeStorage } from "../safeStorage";
import Chat from "./Chat";
import X402Chat from "./X402Chat";

type Mode = "session" | "x402";
const MODE_KEY = "archive.payMode";
const storedMode = (): Mode => (safeStorage.getItem(MODE_KEY) === "x402" ? "x402" : "session");

export default function Playground({ go }: { go: (r: string) => void }) {
  useLang();
  const [mode, setMode] = useState<Mode>(storedMode);
  // le prix d'un appel x402, lu sur Arc par X402Chat (null tant qu'il n'est pas lu, ou si le produit n'est pas payable)
  const [price, setPrice] = useState<bigint | null>(null);
  function choose(m: Mode) {
    setMode(m);
    safeStorage.setItem(MODE_KEY, m);
  }
  const options: Array<[Mode, string, string]> = [
    ["session", t("play.mode.session"), t("play.mode.sessionHint")],
    ["x402", price !== null ? t("play.mode.x402Price", { price: usdc(price) }) : t("play.mode.x402"), t("play.mode.x402Hint")],
  ];
  return (
    <>
      <PageHeader
        title={t("play.title")}
        lead={t("play.lead")}
        actions={<Btn kind="ghost" onClick={() => go("cles")}>{t("play.keys")}</Btn>}
      />
      <div role="group" aria-label={t("play.mode.label")} className="mb-6 grid gap-2 sm:grid-cols-2">
        {options.map(([m, label, hint]) => {
          const on = mode === m;
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => choose(m)}
              className={`rounded-xl border px-4 py-3 text-left transition ${on ? "border-accent bg-accent/10" : "border-edge hover:border-muted/60"}`}>
              <span className="flex items-center gap-2 text-[14px] font-medium">
                <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? "border-accent" : "border-muted/60"}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                {label}
              </span>
              <span className="mt-1 block pl-6 text-[12px] text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
      <div hidden={mode !== "session"}><Chat /></div>
      <div hidden={mode !== "x402"}><X402Chat active={mode === "x402"} onPrice={setPrice} /></div>
    </>
  );
}
