/** Playground.tsx — private AI in an enclave, with the choice of how to pay:
 *  - "Prepaid session": a deposit, then as many messages as it covers (Chat.tsx, SessionPay);
 *  - "Pay per call (x402)": each message paid by a signature for the price read on Arc (X402Chat.tsx, X402Settler).
 *  Both stay mounted: switching modes loses neither the open session (its key is only in memory) nor the pay-per-call
 *  conversation. The choice is kept in this browser (a convenience, guarded storage). */
import { useEffect, useState } from "react";
import { PageHeader, Btn, usdc } from "../ui";
import { t, useLang } from "../i18n";
import { safeStorage } from "../safeStorage";
import Chat from "./Chat";
import X402Chat from "./X402Chat";

type Mode = "session" | "x402";
const MODE_KEY = "archive.payMode";
const storedMode = (): Mode => (safeStorage.getItem(MODE_KEY) === "x402" ? "x402" : "session");
/** "#/playground?mode=x402" (product 3's link in the Hive) opens the page on pay per call. */
const hashMode = (): Mode | null => {
  const m = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("mode");
  return m === "x402" || m === "session" ? m : null;
};

export default function Playground({ go }: { go: (r: string) => void }) {
  useLang();
  const [mode, setMode] = useState<Mode>(() => hashMode() ?? storedMode());
  // the mode requested by the link becomes the saved choice, like a click on the option
  useEffect(() => { const m = hashMode(); if (m) safeStorage.setItem(MODE_KEY, m); }, []);
  // the price of an x402 call, read on Arc by X402Chat (null until it is read, or if the product cannot be paid)
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
              <span className="expl mt-1 block pl-6 text-[12px] text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
      <div hidden={mode !== "session"}><Chat /></div>
      <div hidden={mode !== "x402"}><X402Chat active={mode === "x402"} onPrice={setPrice} /></div>
    </>
  );
}
