import { useEffect, useState } from "react";
import { testnet, type ProductView, type EnclaveView, type ProductState } from "@arcvault/sdk";
import { fetchProducts, fetchEnclaves } from "../api";
import { PageHeader, Table, Td, Badge, Btn, Hex, usdc, Empty } from "../ui";
import { t, tx, type StaticKey } from "../i18n";
import { explainError } from "../errors";

/** Nom lisible d'un produit, déduit de son rail de règlement (le registre ne stocke qu'un manifeste). */
export function productName(p: ProductView): { name: string; rail: string; route: string } {
  const s = p.settlement.toLowerCase();
  if (s === testnet.sealedBounty.toLowerCase()) return { name: t("prod.name.bounty"), rail: "SealedBounty", route: "primes" };
  if (s === testnet.x402Settler.toLowerCase()) return { name: t("prod.name.x402"), rail: "x402", route: "playground" };
  // sans contrat de règlement : service gratuit (le copilote attesté, produit 4)
  if (s === "0x0000000000000000000000000000000000000000") return { name: t("prod.name.copilot"), rail: t("prod.rail.free"), route: "vue" };
  if (s === testnet.sessionPay.toLowerCase()) return { name: t("prod.name.inference"), rail: t("prod.rail.session"), route: "playground" };
  return { name: t("prod.name.other"), rail: s.slice(0, 10) + "…", route: "produits" };
}

const STATE_LABEL: Record<ProductState, StaticKey> = { None: "state.None", Proposed: "state.Proposed", Active: "state.Active", Retired: "state.Retired" };
/** L'état d'un produit (Active, Proposed…) dans la langue du site. */
export const stateLabel = (s: ProductState): string => t(STATE_LABEL[s] ?? "state.None");

export default function Products({ go }: { go: (r: string) => void }) {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [encs, setEncs] = useState<EnclaveView[]>([]);
  // l'erreur est gardée telle quelle et mise en mots à l'affichage (elle suit la langue du site)
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    fetchProducts().then(setProducts).catch((e) => setErr(e ?? new Error("?")));
    fetchEnclaves().then(setEncs).catch(() => {});
  }, []);
  const activeFor = (id: bigint) => encs.filter((e) => e.active && e.productId === id).length;
  const retired = products?.filter((p) => p.state === "Retired").length ?? 0;

  return (
    <>
      <PageHeader
        title={t("prod.title")}
        lead={t("prod.lead")}
        actions={<Btn kind="ghost" onClick={() => go("publier-produit")}>{t("prod.publish")}</Btn>}
      />
      {err !== null && <p className="mb-4 text-[13px] text-bad">{t("prod.readError", { err: explainError(err) })}</p>}
      <Table
        head={[t("prod.h.product"), t("prod.h.price"), t("prod.h.split"), t("prod.h.minBond"), t("prod.h.live"), ""]}
        empty={products && products.length === 0 ? <Empty>{t("prod.empty")}</Empty> : undefined}
      >
        {!products && <tr><Td className="text-muted">{t("prod.loading")}</Td></tr>}
        {products?.filter((p) => p.state !== "Retired").map((p) => {
          const n = productName(p);
          const live = activeFor(p.id);
          return (
            <tr key={p.id.toString()} className="hover:bg-panel/60">
              <Td main wrap>
                <div className="flex flex-wrap items-center gap-1.5 font-medium">{n.name} <Badge tone="muted">{n.rail}</Badge>{p.deterministic && <Badge tone="accent">{t("common.deterministic")}</Badge>}</div>
                <div className="text-[12px] text-muted">{tx("prod.author", { id: p.id.toString(), author: <Hex value={p.author} n={4} /> })}</div>
              </Td>
              <Td label={t("prod.h.price")} wrap className="font-mono">
                <span className="whitespace-nowrap">{p.price === 0n ? t("prod.poolPaid") : usdc(p.price)}</span>
                {p.price > 0n && p.settlement.toLowerCase() === testnet.sessionPay.toLowerCase() && (
                  <span className="block text-[12px] text-muted">{t("prod.unit", { tokens: p.unitTokens, weight: p.outWeight })}</span>
                )}
              </Td>
              <Td label={t("prod.h.split")} className="font-mono">{t("prod.split", { op: p.bpsOperator / 100, author: p.bpsAuthor / 100, net: p.bpsNetwork / 100 })}</Td>
              <Td label={t("prod.h.minBond")} className="font-mono">{usdc(p.minBond)}</Td>
              <Td label={t("prod.h.live")}>{p.state !== "Active"
                ? <Badge tone="warn">{p.state === "Proposed" ? t("prod.pending") : stateLabel(p.state)}</Badge>
                : live > 0 ? <Badge tone="good">{t("prod.enclaves", { n: live })}</Badge> : <span className="text-muted">{t("prod.noEnclave")}</span>}</Td>
              <Td actions>{p.state === "Active" && live > 0
                ? <Btn kind="primary" onClick={() => go(n.route)}>{t("prod.use")}</Btn>
                : <span className="text-[12px] text-muted" title={t("prod.unavailableTitle")}>{t("prod.unavailable")}</span>}</Td>
            </tr>
          );
        })}
      </Table>
      {retired > 0 && <p className="mt-3 text-[12px] text-muted">{t("prod.retired", { n: retired })}</p>}
      <p className="mt-3 text-[12px] text-muted">{t("prod.testnetNote")}</p>
    </>
  );
}
