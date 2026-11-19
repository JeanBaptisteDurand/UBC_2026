/** Levels.tsx — the TWO operator levels on the site: the card that explains both paths (with the arcvault kit's
 *  commands) and the live state, and an enclave's level badge. The data comes from GET /levels (the API reads
 *  MachineRegistry, ProofOfCloudAuditor and the bond on Arc). */
import { useEffect, useState } from "react";
import { ShieldCheck, Server } from "lucide-react";
import { fetchLevels, type LevelsView } from "../api";
import { Badge, Card } from "../ui";
import { fmtUnix, t } from "../i18n";
import { CopyLine } from "./Operator";

export function useLevels(): LevelsView | null {
  const [v, setV] = useState<LevelsView | null>(null);
  useEffect(() => {
    let on = true;
    fetchLevels().then((x) => on && setV(x)).catch(() => on && setV(null));
    return () => { on = false; };
  }, []);
  return v;
}

/** An enclave's level badge (nothing if the API has no levels). */
export function LevelBadge({ levels, signer }: { levels: LevelsView | null; signer: string }) {
  const e = levels?.enclaves?.find((x) => x.signer.toLowerCase() === signer.toLowerCase());
  if (!e) return null;
  if (e.level === "verified") return <Badge tone="good">{t("lvl.badge.verified")}</Badge>;
  if (e.ppid && !e.bindingCurrent) return <Badge tone="warn">{t("lvl.badge.stale")}</Badge>;
  return <Badge tone="muted">{t("lvl.badge.open")}</Badge>;
}

export function LevelsCard() {
  const v = useLevels();
  const verified = v?.enclaves?.filter((e) => e.level === "verified") ?? [];
  const machines = new Set(verified.map((e) => e.ppid));
  return (
    <Card title={t("lvl.title")} sub={t("lvl.lead")}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-edge p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Server size={16} aria-hidden /> {t("lvl.open.title")}</div>
          <p className="mt-2 text-[13px] text-muted">{t("lvl.open.body")}</p>
          <div className="mt-3 text-[12px] text-muted">{t("lvl.steps.open")}</div>
          <div className="mt-1.5 space-y-1.5">
            <CopyLine cmd="arcvault operator init --uri https://example.org/agent.json" />
            <CopyLine cmd="arcvault operator bond --amount 10" />
            <CopyLine cmd="arcvault operator register --vm <url> --product <id>" />
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-good/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} aria-hidden /> {t("lvl.verified.title")}</div>
          <p className="mt-2 text-[13px] text-muted">{t("lvl.verified.body")}</p>
          <p className="expl mt-2 text-[12px] text-muted">{t("lvl.verified.why")}</p>
          <div className="mt-3 text-[12px] text-muted">{t("lvl.steps.verified")}</div>
          <div className="mt-1.5 space-y-1.5">
            <CopyLine cmd="arcvault operator bind-machine --signer <enclave key>" />
            <CopyLine cmd="arcvault operator proof-of-cloud --signer <enclave key>" />
            <CopyLine cmd="arcvault operator level --signer <enclave key> --product <id>" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-muted">{t("lvl.price")}</p>
      {v?.enabled && (
        <div className="mt-3 rounded-xl border border-edge bg-ink/60 p-3 text-[13px]">
          <div className="text-[12px] text-muted">{t("lvl.live")}</div>
          <div className="mt-1">{t("lvl.live.machines", { n: verified.length, m: machines.size })}</div>
          {v.verifiedBounty?.slashFrom ? (
            <div className="mt-1 text-muted">{t("lvl.live.bounty", { date: fmtUnix(BigInt(v.verifiedBounty.slashFrom)) })}</div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
