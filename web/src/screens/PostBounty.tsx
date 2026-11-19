import { useState } from "react";
import { useAccount } from "wagmi";
import { PageHeader, Section } from "../ui";
import { t } from "../i18n";
import { CreditNotice, MyBounties, ProtocolPanel } from "./Bounty";

export default function PostBounty() {
  const { isConnected } = useAccount();
  const [created, setCreated] = useState(0);
  return (
    <>
      <PageHeader title={t("post.title")} lead={t("post.lead")} />
      <CreditNotice />
      <Section>
        <ProtocolPanel onCreated={() => setCreated((n) => n + 1)} />
        <p className="expl mt-2 text-[12px] text-muted">{t("post.demo")}</p>
      </Section>
      {isConnected && (
        <Section title={t("post.mine.title")} lead={t("post.mine.lead")}>
          <MyBounties refreshKey={created} />
        </Section>
      )}
      <Section title={t("post.rule.title")}>
        <ul className="space-y-2 text-[13px] text-muted">
          <li><span className="text-text">{t("post.rule.clauses")}</span>{t("post.rule.clausesText")}</li>
          <li><span className="text-text">{t("post.rule.tiers")}</span>{t("post.rule.tiersText")}</li>
          <li><span className="text-text">{t("post.rule.pay")}</span>{t("post.rule.payText")}</li>
          <li><span className="text-text">{t("post.rule.private")}</span>{t("post.rule.privateText")}</li>
        </ul>
      </Section>
    </>
  );
}
