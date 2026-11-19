/** CopilotActions.tsx — "prepare → sign": the copilot prepares an action (it never spends), the site shows it with its
 *  checks and a button, and the user's own wallet signs it. A failed check (balance, bond, inactive product, quote
 *  refused…) blocks the signature, whatever the action: the transaction would be refused.
 *  Field names come from the copilot's JSON protocol (aCompleter = fields still to fill in, produit = product). */
import { useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { encodeAek, maskAek } from "@arcvault/sdk";
import { useArc } from "../useArc";
import { registerMachineEnclave, registeredMsg } from "../operatorActions";
import { waitOk } from "../arc";
import { ENCLAVE_URL } from "../config";
import { Btn, Status, short } from "../ui";
import { fail, failWith, msg, type Msg } from "../msg";
import { t } from "../i18n";

export interface CopilotAction { tool: string; input: any; result: any }

/** An address prepared by the copilot, or undefined if it is a template ("<signer of the chosen enclave>"). */
const addr = (x: unknown): Address | undefined => (typeof x === "string" && isAddress(x, { strict: false }) ? (x as Address) : undefined);

/** The checks the copilot made while preparing the action (`verifications: [{ ok, quoi }]`), as it writes them. */
function checksOf(a: CopilotAction): Array<{ ok: boolean; what: string }> {
  const v = a.result?.verifications;
  return Array.isArray(v) ? v.filter((x) => x && typeof x.quoi === "string").map((x) => ({ ok: x.ok === true, what: String(x.quoi) })) : [];
}
const warningsOf = (a: CopilotAction): string[] =>
  (Array.isArray(a.result?.avertissements) ? a.result.avertissements : []).filter((x: unknown): x is string => typeof x === "string" && !!x.trim());

function describe(a: CopilotAction): { title: string; lines: string[]; ready: boolean; why?: string; info?: string } {
  const r = a.result ?? {};
  const todo = (fallback: string) => (Array.isArray(r.aCompleter) && r.aCompleter.length ? r.aCompleter.join(", ") : fallback);
  switch (a.tool) {
    case "session_prepare_open": {
      const p = r.openSessionParams ?? {};
      // the session is locked to ONE enclave (its signer), served at the site's inference address
      const ok = !!addr(p.operator) && !!addr(p.enclave);
      return {
        title: t("action.session.title"),
        lines: [t("action.l.product", { id: String(p.productId ?? "?") }), t("action.l.enclave", { e: short(p.enclave) }), t("action.l.operator", { o: short(p.operator) }), t("action.l.deposit", { d: String(r.depot ?? "") })],
        ready: ok, why: ok ? undefined : t("action.session.none"),
      };
    }
    case "operator_prepare_bond": {
      if (r.rienANSigner) return { title: t("action.bond.title"), lines: [], ready: false, info: String(r.message ?? "") };
      const amt = r.voieA_uneTransaction?.args?.amount;
      return {
        title: t("action.bond.title"),
        lines: [t("action.l.amount", { a: String(r.montant ?? "") }), r.apres ? t("action.l.after", { a: String(r.apres.disponible) }) : ""].filter(Boolean),
        ready: !!amt, why: amt ? undefined : todo(t("action.bond.missing")),
      };
    }
    case "operator_prepare_register": {
      const url = a.input?.enclaveUrl;
      return {
        title: t("action.register.title"),
        lines: [t("action.l.product", { id: String(r.produit?.id ?? "?") }), url ? t("action.l.enclave", { e: String(url) }) : ""].filter(Boolean),
        ready: !!url && !!r.produit?.id, why: url ? todo(t("action.incomplete")) : t("action.register.missing"),
      };
    }
    case "bounty_prepare_create": {
      const p = r.createBountyParams;
      return {
        title: t("action.bounty.title"), ready: !!p && r.pret !== false,
        lines: p ? [t("action.l.product", { id: String(p.productId) }), t("action.l.funding", { f: String(r.economie?.financement ?? "") }), t("action.l.deadline", { d: String(r.economie?.echeance ?? "") })] : [],
        why: todo(p ? t("action.incomplete") : t("action.bounty.missing")),
      };
    }
  }
  return { title: a.tool, lines: [], ready: false, why: t("action.unknown") };
}

export function ActionCard({ a }: { a: CopilotAction }) {
  const arc = useArc();
  const [note, setNote] = useState<Msg | null>(null);
  const [aek, setAek] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false); // signed and confirmed: it is not signed again by mistake
  const d = describe(a);
  const checks = checksOf(a);
  const warnings = warningsOf(a);
  const failed = checks.filter((c) => !c.ok).length;

  async function run() {
    if (busy || done || failed > 0) return;
    if (!arc?.wallet || !arc.account) { setNote(failWith(msg("action.needWallet"))); return; }
    const r = a.result;
    setBusy(true);
    try {
      setNote(msg("common.signInWallet"));
      if (a.tool === "session_prepare_open") {
        const p = r.openSessionParams;
        const secs = Math.max(3600, Number(p.expiresAt) - Math.floor(Date.now() / 1000));
        // the key of the enclave served at the site's inference address is verified on Arc; it must be the prepared enclave
        const o = await arc.openSession({
          productId: BigInt(p.productId), deposit: BigInt(p.deposit), expiresInSeconds: secs,
          enclaveUrl: ENCLAVE_URL, enclave: addr(p.enclave), operator: addr(p.operator),
        });
        setAek(encodeAek("arctest", o.sessionId, o.sessionKey.privateKey));
        setNote(msg("order.sent", { id: o.sessionId }));
        await waitOk(arc, o.tx, "tx.openSession");
        setNote(msg("keys.sessionOpen", { id: o.sessionId, enclave: short(o.enclave), tx: o.tx }));
      } else if (a.tool === "operator_prepare_bond") {
        const hash = await arc.bond(BigInt(r.voieA_uneTransaction.args.amount), "auth");
        setNote(msg("op.bond.sent"));
        await waitOk(arc, hash, "tx.bond");
        setNote(msg("op.bond.done", { tx: hash }));
      } else if (a.tool === "operator_prepare_register") {
        const o = await registerMachineEnclave(arc, BigInt(r.produit.id), String(a.input.enclaveUrl), setNote);
        setNote(registeredMsg(o));
      } else if (a.tool === "bounty_prepare_create") {
        const p = r.createBountyParams;
        const o = await arc.createBounty({
          productId: BigInt(p.productId), predicateHash: p.predicateHash as Hex, protocolX25519: p.protocolX25519 as Hex,
          tierMinLoss: p.tierMinLoss.map((x: string) => BigInt(x)), tierAmount: p.tierAmount.map((x: string) => BigInt(x)),
          singleCap: BigInt(p.singleCap), k: Number(p.k), targetToPause: p.targetToPause as Address, deadline: BigInt(p.deadline), funding: BigInt(p.funding),
        });
        setNote(msg("action.bountySent", { id: o.bountyId }));
        await waitOk(arc, o.tx, "tx.createBounty");
        setNote(msg("action.bountyDone", { id: o.bountyId, tx: o.tx }));
      }
      setDone(true);
    } catch (e: any) { setNote(fail(e)); } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-left">
      <div className="text-[12px] font-medium text-accent">{t("action.prepared", { title: d.title })}</div>
      {d.lines.length > 0 && <ul className="mt-1 space-y-0.5 text-[12px] text-muted">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {checks.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-medium text-muted">{t("action.checks")}</div>
          <ul className="mt-0.5 space-y-0.5 text-[12px]">
            {checks.map((c, i) => (
              <li key={i} className="flex gap-1.5 break-words">
                <span className={c.ok ? "text-good" : "text-bad"}>{c.ok ? "✓" : "✗"}</span>
                <span className={`min-w-0 ${c.ok ? "text-muted" : "text-bad"}`}>{c.what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-medium text-muted">{t("action.warnings")}</div>
          <ul className="mt-0.5 space-y-0.5 text-[12px] text-warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {d.info
        ? <p className="mt-1 text-[12px] text-muted">{d.info}</p>
        : d.ready
          ? (
            <div className="mt-2">
              <Btn onClick={run} disabled={busy || done || failed > 0}>{t("action.sign")}</Btn>
              {failed > 0 && <p className="mt-1 text-[12px] text-bad">{t("action.checksFailed")}</p>}
            </div>
          )
          : <p className="mt-1 text-[12px] text-warn">{t("action.toComplete", { why: d.why ?? "" })}</p>}
      {aek && (
        <div className="mt-2 rounded border border-good/40 bg-good/5 p-2 text-[11px]">
          <span className="font-mono">{maskAek(aek)}</span>
          <button className="ml-2 text-accent hover:underline" onClick={() => navigator.clipboard?.writeText(aek)}>{t("common.copyFullKey")}</button>
          <div className="mt-1 text-muted">{t("action.keyOnce")}</div>
        </div>
      )}
      <Status msg={note} />
    </div>
  );
}
