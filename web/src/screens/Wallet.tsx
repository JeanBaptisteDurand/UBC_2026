import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { testnet } from "@arcvault/sdk";
import { useArc } from "../useArc";
import { PageHeader, Section, Stat, Badge, Hex, NeedWallet, Btn, usdc } from "../ui";
import { t } from "../i18n";

export default function Wallet({ go }: { go: (r: string) => void }) {
  const arc = useArc();
  const { address, isConnected, chain } = useAccount();
  const [bal, setBal] = useState<bigint>();
  const [bond, setBond] = useState<bigint>();
  const [avail, setAvail] = useState<bigint>();
  useEffect(() => {
    if (!arc || !address) return;
    arc.usdcBalance(address).then(setBal).catch(() => {});
    arc.bondOf(address).then(setBond).catch(() => {});
    arc.freeBond(address).then(setAvail).catch(() => {}); // v2 : la part non réservée par les enclaves inscrites
  }, [arc, address]);
  const onArc = chain?.id === testnet.chainId;

  return (
    <>
      <PageHeader
        title={t("wallet.title")}
        lead={t("wallet.lead")}
        actions={<Btn kind="ghost" onClick={() => go("cles")}>{t("wallet.keys")}</Btn>}
      />
      {!isConnected ? <NeedWallet what={t("wallet.need")} /> : (
        <Section title={t("wallet.account")}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Hex value={address} n={8} />
            <Badge tone={onArc ? "good" : "warn"}>{onArc ? t("wallet.onArc") : t("wallet.otherNet", { id: chain?.id ?? t("common.unknown") })}</Badge>
            {(bond ?? 0n) > 0n && <Badge tone="accent">{t("wallet.operator")}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("wallet.usdc")} value={usdc(bal)} />
            <Stat label={t("wallet.bond")} value={usdc(bond)} tone={(bond ?? 0n) > 0n ? "good" : undefined} />
            <Stat label={t("wallet.free")} value={usdc(avail)} />
          </div>
        </Section>
      )}
      <Section title={t("wallet.cctp.title")} lead={t("wallet.cctp.lead")}>
        <a href="/bridge.html" className="tap inline-flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-[13px] font-medium text-text transition hover:border-muted/60">{t("wallet.cctp.link")}</a>
      </Section>
    </>
  );
}
