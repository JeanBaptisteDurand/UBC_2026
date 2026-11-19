import { useEffect, useState } from "react";
import { fetchBounties, bountyKey, type Bounty } from "../api";
import { PageHeader, Section, Table, Td, Badge, Btn, Hex, usdc, Empty } from "../ui";
import { fmtUnix, t } from "../i18n";
import { BountyLevelBadge, CreditNotice, DEMO_PREDICATE_HASH, HunterPanel } from "./Bounty";

/** Bounties at BOTH levels (open: SealedBounty; verified: SealedBountyVerified, product 7), read from
 *  /bounties?level=all. A bounty is identified by its level AND its number ("verified:2"): numbers exist at both levels.
 *  What was paid comes from BountyPaid events (paidOut), never from the paidAmount field (a refuted claim leaves it at
 *  0.5 USDC without anything paid). */
export default function Bounties({ go }: { go: (r: string) => void }) {
  const [rows, setRows] = useState<Bounty[] | null>(null);
  const [pick, setPick] = useState("");
  const now = BigInt(Math.floor(Date.now() / 1000));
  useEffect(() => {
    fetchBounties().then((b) => {
      setRows(b);
      // only a bounty that can be hunted is preselected: open, and preferably a demo bounty (DemoVault rule) with no tier
      // reserved or paid yet
      const open = b.filter((x) => !x.paused && x.deadline >= now);
      const demo = (x: Bounty) => x.predicateHash?.toLowerCase() === DEMO_PREDICATE_HASH.toLowerCase();
      const fresh = (x: Bounty) => x.paidAmount === 0n && !(x.paidOut && x.paidOut > 0n);
      const best = open.find((x) => demo(x) && fresh(x)) ?? open.find(fresh) ?? open[0];
      if (best) setPick(bountyKey(best));
    }).catch(() => setRows([]));
  }, []);
  const picked = rows?.find((b) => bountyKey(b) === pick) ?? null;
  /** pick a bounty to hunt: its panel is below the list, so the page scrolls down to it (far away on a phone) */
  const hunt = (b: Bounty) => {
    setPick(bountyKey(b));
    setTimeout(() => document.getElementById("hunt")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

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
          {/* the list keeps its space while loading (so the page does not jump on a phone when one line turns into four
              cards) */}
          {!rows && <tr><Td className="h-[60vh] !align-top text-muted sm:h-56">{t("bounties.loading")}</Td></tr>}
          {rows?.map((b) => {
            const key = bountyKey(b);
            const expired = b.deadline < now;
            const paid = b.paidOut !== null && b.paidOut > 0n;
            // refuted: a claim accepted then refuted on Arc, and nothing paid (the liar's bond is seized)
            const refuted = b.claimsRefuted > 0 && !paid;
            return (
              <tr key={key} className={pick === key ? "bg-accent/5" : "hover:bg-panel/60"}>
                <Td main wrap>
                  <span className="whitespace-nowrap font-medium">{t("common.Bounty", { id: b.id.toString() })}</span>{" "}
                  <span className="whitespace-nowrap text-[12px] text-muted">{t("common.product", { id: b.productId.toString() })}</span>{" "}
                  <BountyLevelBadge level={b.level} />
                </Td>
                <Td label={t("bounties.h.protocol")}><Hex value={b.protocol} n={4} /></Td>
                <Td label={t("bounties.h.pool")} className="font-mono">{usdc(b.balance)}</Td>
                <Td label={t("bounties.h.deadline")} wrap className="text-muted">{fmtUnix(b.deadline)}</Td>
                <Td label={t("bounties.h.status")}>
                  <span className="flex flex-wrap items-center gap-1">
                    {b.paused ? <Badge tone="warn">{t("common.paused")}</Badge> : expired ? <Badge tone="muted">{t("common.expired")}</Badge> : <Badge tone="good">{t("common.open")}</Badge>}
                    {paid && <Badge tone="muted">{t("bounties.alreadyPaid", { amt: usdc(b.paidOut!) })}</Badge>}
                    {refuted && <span title={t("bounties.refutedTitle")}><Badge tone="bad">{t("bounties.refuted")}</Badge></span>}
                  </span>
                </Td>
                {/* nothing to do on an expired or paused bounty: its state is already shown (no lone "closed" line) */}
                <Td actions>{!b.paused && !expired
                  ? <Btn kind={pick === key ? "primary" : "ghost"} onClick={() => hunt(b)}>{t("bounties.hunt")}</Btn>
                  : null}</Td>
              </tr>
            );
          })}
        </Table>
      </Section>
      {picked && (
        <div id="hunt" className="scroll-mt-20">
          <Section title={t(picked.level === "verified" ? "bounties.huntTitleVerified" : "bounties.huntTitle", { id: picked.id.toString() })} lead={t("bounties.huntLead")}>
            <HunterPanel initialBountyId={picked.id.toString()} level={picked.level} />
          </Section>
        </div>
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
