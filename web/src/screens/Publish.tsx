import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { type Hex } from "viem";
import { productRegistryAbi, testnet } from "@arcvault/sdk";
import { useArc } from "../useArc";
import { waitOk } from "../arc";
import { PageHeader, Section, NeedWallet, Card, Field, Btn, Status } from "../ui";
import { fail, msg, type Msg } from "../msg";
import { fmtUnix, t, type StaticKey } from "../i18n";
import { ProposeCard } from "./Operator";

/** Le parcours de l'auteur : [titre, détail] de chaque étape. */
const STEPS: Array<[StaticKey, StaticKey]> = [
  ["pub.s1", "pub.s1d"], ["pub.s2", "pub.s2d"], ["pub.s3", "pub.s3d"], ["pub.s4", "pub.s4d"],
  ["pub.s5", "pub.s5d"], ["pub.s6", "pub.s6d"], ["pub.s7", "pub.s7d"],
];

/** v2 : une nouvelle image s'autorise en deux temps (proposeWorkload, puis applyWorkload après le délai du registre). */
function WorkloadCard() {
  const arc = useArc();
  const [productId, setProductId] = useState("");
  const [workloadId, setWorkloadId] = useState("");
  const [state, setState] = useState<{ allowed: boolean; applyAt: bigint } | null>(null);
  const [out, setOut] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const pid = productId.trim();
  const wid = workloadId.trim();
  const valid = /^\d+$/.test(pid) && /^0x[0-9a-fA-F]{64}$/.test(wid);
  const pub = arc?.pub;

  async function read(): Promise<{ allowed: boolean; applyAt: bigint } | null> {
    if (!pub || !valid) return null;
    const [allowed, applyAt] = await Promise.all([
      pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "isWorkloadAllowed", args: [BigInt(pid), wid as Hex] }),
      pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "workloadApplyAt", args: [BigInt(pid), wid as Hex] }),
    ]);
    const s = { allowed: allowed as boolean, applyAt: BigInt(applyAt as bigint) };
    setState(s);
    return s;
  }
  useEffect(() => {
    setState(null);
    if (!valid) return;
    const timer = setTimeout(() => { read().catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [pub, pid, wid]);

  async function propose() {
    if (!arc) return;
    setBusy(true);
    try {
      setOut(msg("wl.proposing"));
      const hash = await arc.proposeWorkload(BigInt(pid), wid as Hex);
      setOut(msg("wl.proposeSent"));
      await waitOk(arc, hash, "tx.proposeWorkload");
      const s = await read();
      const now = BigInt(Math.floor(Date.now() / 1000));
      setOut(s && s.applyAt > now ? msg("wl.proposedLater", { when: () => fmtUnix(s.applyAt), tx: hash }) : msg("wl.proposedNow", { tx: hash }));
    } catch (e) { setOut(fail(e)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!arc) return;
    setBusy(true);
    try {
      setOut(msg("wl.applying"));
      const hash = await arc.applyWorkload(BigInt(pid), wid as Hex);
      setOut(msg("wl.applySent"));
      await waitOk(arc, hash, "tx.applyWorkload");
      await read();
      setOut(msg("wl.applied", { id: pid, tx: hash }));
    } catch (e) { setOut(fail(e)); } finally { setBusy(false); }
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const pendingUntil = state && !state.allowed && state.applyAt > 0n ? state.applyAt : null;
  const ready = pendingUntil !== null && pendingUntil <= now;
  return (
    <Card title={t("wl.title")} sub={t("wl.sub")}>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label={t("field.productId")} value={productId} onChange={setProductId} placeholder="1" />
        <Field label={t("wl.f.image")} value={workloadId} onChange={setWorkloadId} placeholder="0x…" />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {!valid ? t("wl.enter")
          : !state ? t("prod.loading")
          : state.allowed ? t("wl.allowed", { id: pid })
          : pendingUntil !== null ? (ready ? t("wl.readyNow") : t("wl.readyOn", { when: fmtUnix(pendingUntil) }))
          : t("wl.notProposed")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={propose} disabled={!arc?.wallet || !valid || busy || !!state?.allowed}>{t("wl.propose")}</Btn>
        <Btn kind="ghost" onClick={apply} disabled={!arc?.wallet || !valid || busy || !ready}>{t("wl.apply")}</Btn>
      </div>
      <Status msg={out} />
    </Card>
  );
}

export default function Publish() {
  const { isConnected } = useAccount();
  return (
    <>
      <PageHeader title={t("pub.title")} lead={t("pub.lead")} />
      <Section title={t("pub.path")}>
        <ol className="grid gap-2 sm:grid-cols-2">
          {STEPS.map(([title, detail], i) => (
            <li key={title} className="flex gap-3 rounded-lg border border-edge px-3 py-2.5">
              <span className="hex grid h-7 w-7 shrink-0 place-items-center bg-edge font-mono text-[12px] text-muted">{i + 1}</span>
              <span className="text-[13px]"><span className="block text-text">{t(title)}</span><span className="text-muted">{t(detail)}</span></span>
            </li>
          ))}
        </ol>
      </Section>
      <Section>{isConnected ? <ProposeCard /> : <NeedWallet what={t("pub.need")} />}</Section>
      {isConnected && <Section><WorkloadCard /></Section>}
    </>
  );
}
