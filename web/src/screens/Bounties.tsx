import { useEffect, useState } from "react";
import type { BountyRow } from "@arcvault/sdk";
import { fetchBounties } from "../api";
import { BOUNTY_PRODUCT } from "../arc";
import { PageHeader, Section, Table, Td, Badge, Btn, Hex, usdc, Empty } from "../ui";
import { fmtUnix, t } from "../i18n";
import { CreditNotice, DEMO_PREDICATE_HASH, HunterPanel } from "./Bounty";

export default function Bounties({ go }: { go: (r: string) => void }) {
  const [rows, setRows] = useState<BountyRow[] | null>(null);
  const [pick, setPick] = useState("");
  const now = BigInt(Math.floor(Date.now() / 1000));
  useEffect(() => {
    fetchBounties().then((b) => {
      setRows(b);
      // on ne pré-sélectionne qu'une prime qu'on peut chasser : ouverte, et de préférence une prime de démonstration
      // (produit Prime scellée, règle DemoVault) dont aucun palier n'est encore payé
      const open = b.filter((x) => !x.paused && x.deadline >= now);
      const demo = (x: BountyRow) => x.productId === BOUNTY_PRODUCT && x.predicateHash?.toLowerCase() === DEMO_PREDICATE_HASH.toLowerCase();
      const best = open.find((x) => demo(x) && x.paidAmount === 0n) ?? open.find((x) => x.paidAmount === 0n) ?? open[0];
      if (best) setPick(best.id.toString());
    }).catch(() => setRows([]));
  }, []);

  return (
    <>
      <PageHeader
        title={t("bounties.title")}
        lead={t("bounties.lead")}
        actions={<Btn kind="ghost" onClick={() => go("publier-prime")}>{t("bounties.post")}</Btn>}
      />
      <CreditNotice />
      <Section title={t("bounties.all")}>
        <Table
          head={[t("bounties.h.bounty"), t("bounties.h.protocol"), t("bounties.h.pool"), t("bounties.h.deadline"), t("bounties.h.status"), ""]}
          empty={rows && rows.length === 0 ? <Empty action={<Btn onClick={() => go("publier-prime")}>{t("bounties.postFirst")}</Btn>}>{t("bounties.empty")}</Empty> : undefined}
        >
          {!rows && <tr><Td className="text-muted">{t("bounties.loading")}</Td></tr>}
          {rows?.map((b) => {
            const expired = b.deadline < now;
            return (
              <tr key={b.id.toString()} className={pick === b.id.toString() ? "bg-accent/5" : "hover:bg-panel/60"}>
                <Td main wrap><span className="whitespace-nowrap font-medium">{t("common.Bounty", { id: b.id.toString() })}</span> <span className="whitespace-nowrap text-[12px] text-muted">{t("common.product", { id: b.productId.toString() })}</span></Td>
                <Td label={t("bounties.h.protocol")}><Hex value={b.protocol} n={4} /></Td>
                <Td label={t("bounties.h.pool")} className="font-mono">{usdc(b.balance)}</Td>
                <Td label={t("bounties.h.deadline")} className="text-muted">{fmtUnix(b.deadline)}</Td>
                <Td label={t("bounties.h.status")}>
                  <span className="flex flex-wrap items-center gap-1">
                    {b.paused ? <Badge tone="warn">{t("common.paused")}</Badge> : expired ? <Badge tone="muted">{t("common.expired")}</Badge> : <Badge tone="good">{t("common.open")}</Badge>}
                    {b.paidAmount > 0n && <Badge tone="muted">{t("bounties.alreadyPaid", { amt: usdc(b.paidAmount) })}</Badge>}
                  </span>
                </Td>
                <Td actions>{!b.paused && !expired
                  ? <Btn kind={pick === b.id.toString() ? "primary" : "ghost"} onClick={() => setPick(b.id.toString())}>{t("bounties.hunt")}</Btn>
                  : <span className="text-[12px] text-muted">{expired ? t("common.closed") : t("common.paused")}</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Section>
      {pick && (
        <Section title={t("bounties.huntTitle", { id: pick })} lead={t("bounties.huntLead")}>
          <HunterPanel initialBountyId={pick} />
        </Section>
      )}
      <Section title={t("bounties.who.title")} lead={t("bounties.who.lead")}>
        <ul className="grid gap-2 text-[13px] text-muted sm:grid-cols-3">
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("bounties.who.hunter")}</span>{t("bounties.who.hunterText")}</li>
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("bounties.who.network")}</span>{t("bounties.who.networkText")}</li>
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("bounties.who.operators")}</span>{t("bounties.who.operatorsText")}</li>
        </ul>
      </Section>
    </>
  );
}
