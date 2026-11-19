import { testnet } from "@arcvault/sdk";
import { API_URL, ATTESTED_COPILOT, ENCLAVE_URL, X402_URL } from "../config";
import { DCAP, INFERENCE_PRODUCT, X402_PRODUCT } from "../arc";
import { PageHeader, Section, Table, Td, Hex } from "../ui";
import { getLang, t, tx, type StaticKey } from "../i18n";

const ENDPOINTS: Array<[string, StaticKey]> = [
  ["/stats", "dev.ep.stats"],
  ["/proof", "dev.ep.proof"],
  ["/activity?limit=25", "dev.ep.activity"],
  ["/enclaves", "dev.ep.enclaves"],
  ["/products", "dev.ep.products"],
  ["/bounties", "dev.ep.bounties"],
  [`/pricing?productId=${INFERENCE_PRODUCT}&units=1000`, "dev.ep.pricing"],
  ["/sessions/0x…", "dev.ep.sessions"],
];

const CONTRACTS: Array<[string, string, StaticKey]> = [
  ["EnclaveRegistry", testnet.enclaveRegistry, DCAP ? "dev.c.registry.dcap" : "dev.c.registry.dev"],
  ["TdxAttestationModule", testnet.attestationModule, DCAP ? "dev.c.module.dcap" : "dev.c.module.dev"],
  ["ProductRegistry", testnet.productRegistry, "dev.c.products"],
  ["OperatorBond", testnet.operatorBond, "dev.c.bond"],
  ["SessionPay", testnet.sessionPay, "dev.c.sessionPay"],
  ["X402Settler", testnet.x402Settler, "dev.c.x402"],
  ["SealedBounty", testnet.sealedBounty, "dev.c.bounty"],
  ["VerdictLog", testnet.verdictLog, "dev.c.verdict"],
  ["DemoVault", testnet.demoVault, "dev.c.vault"],
];

const ROUTES: Array<[string, string, StaticKey]> = [
  ["GET", "/pubkeys", "dev.r.pubkeys"],
  ["GET", "/v1/models", "dev.r.models"],
  ["POST", "/attest", "dev.r.attest"],
  ["POST", "/v1/chat/completions", "dev.r.chat"],
  ["GET", "/v1/session/:id", "dev.r.session"],
];

// adresse publique de l'opérateur de démo (a des sessions), pour l'exemple de lecture
const DEMO_OWNER = "0x5724d89D610c3017b8DC161c025248341556f6Ab";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-edge bg-panel p-3 font-mono text-[12px] leading-relaxed">{children}</pre>;
}

export default function Developers() {
  const api = API_URL.replace(/\/$/, "");
  return (
    <>
      <PageHeader title={t("dev.title")} lead={t("dev.lead")} />
      <Section title={t("dev.api.title")} lead={tx("dev.api.lead", { base: <span className="font-mono text-text">{api}</span> })}>
        <Table stack="sm" head={[t("dev.api.h.endpoint"), t("dev.api.h.returns")]}>
          {ENDPOINTS.map(([p, d]) => (
            <tr key={p}><Td main><a className="font-mono text-accent hover:underline" href={`${api}${p.replace("0x…", DEMO_OWNER)}`} target="_blank" rel="noreferrer">GET {p}</a></Td><Td label={t("dev.api.h.returns")} wrap className="text-muted">{t(d)}</Td></tr>
          ))}
        </Table>
      </Section>
      {/* grid-cols-1 (et min-w-0 des sections) : sur téléphone, le code défile dans son cadre au lieu d'élargir la page */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t("dev.sdk.title")} lead={t("dev.sdk.lead")}>
          <Code>{`import { createArcClient, createInferenceClient } from "@arcvault/sdk";

const arc = createArcClient({ publicClient, walletClient });
// ${t("dev.sdk.c1")}
// ${t("dev.sdk.c2")}
const { sessionId, sessionKey } = await arc.openSession({
  productId: ${INFERENCE_PRODUCT}n, enclaveUrl, deposit: 2_000_000n, // 2 USDC
});
const ai = createInferenceClient({ enclaveUrl, sessionId, sessionKey, publicClient });

for (const q of questions) {
  const { text, receipt, verified } = await ai.chat.completions.create({
    messages: [{ role: "user", content: q }],
  });
}`}</Code>
        </Section>
        <Section title={t("dev.cli.title")} lead={t("dev.cli.lead")}>
          <Code>{`arcvault products | enclaves | bounties
arcvault session open|status|topup|close|rotate
arcvault bounty list|status|create|submit|reports
arcvault operator init|bond|register|renew|settle|status
arcvault product list|propose|activate
arcvault proxy --key aek_… --enclave <url>   # ${t("dev.cli.proxy")}
arcvault verify <${t("dev.cli.receipt")}>${" ".repeat(Math.max(1, 27 - t("dev.cli.receipt").length))}# ${t("dev.cli.verify")}`}</Code>
        </Section>
      </div>
      {/* les deux rails de la pile v2.1 : l'inférence payée à l'appel (produit 3) et le copilote attesté (produit 4) ;
          les adresses sont celles de ce déploiement quand elles sont configurées (VITE_X402_URL, VITE_COPILOT_*) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t("dev.x402.title")} lead={t("dev.x402.lead")}>
          <Code>{`import { createX402Client, X402PaidCallError, testnet } from "@arcvault/sdk";

const ai = createX402Client({
  enclaveUrl: "${X402_URL || "https://…/enclave/x402"}",
  productId: ${X402_PRODUCT}n,
  walletClient, publicClient, deployment: testnet,
  maxAmount: 10_000n, // ${t("dev.x402.c1")}
});
const { pricePerCall } = await ai.product(); // ${t("dev.x402.c2")}
try {
  const { text, amount, signer } = await ai.chat.completions.create({
    messages: [{ role: "user", content: "${t("chat.defaultPrompt")}" }],
  });
} catch (e) {
  // ${t("dev.x402.c3")}
  if (e instanceof X402PaidCallError && e.code !== "enclave_changed") await ai.resume(e.pending);
}`}</Code>
        </Section>
        <Section title={t("dev.cop.title")} lead={t("dev.cop.lead")}>
          <Code>{`import { createPublicClient, http } from "viem";
import { arcTestnet, createAttestedCopilotClient, testnet } from "@arcvault/sdk";

// ${t("dev.cop.c1")}
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const copilot = createAttestedCopilotClient({
  copilotUrl: "${ATTESTED_COPILOT?.url ?? "https://…/enclave/copilot"}",
  productId: ${ATTESTED_COPILOT?.productId ?? 4n}n,
  publicClient, deployment: testnet,
  expectedOperator: "${ATTESTED_COPILOT?.operator ?? "0x…"}", // ${t("dev.cop.c2")}
});
const r = await copilot.chat({ messages: [{ role: "user", content: "${t("copilot.s2")}" }], lang: "${getLang()}" });
if (r.authenticated) {
  // ${t("dev.cop.c3")}
  console.log(r.reply.text, r.enclave.signer, r.enclave.operator);
} else {
  // ${t("dev.cop.c4")}
  console.log(r.status, r.reply.code, r.reply.text);
}`}</Code>
        </Section>
      </div>
      <Section title={t("dev.mcp.title")} lead={t("dev.mcp.lead")}>
        <Code>{`{
  "mcpServers": {
    "archive": {
      "command": "node",
      "args": ["<${t("dev.mcp.repo")}>/deploy/mcp.mjs"],
      "env": { "ARCHIVE_API": "${api}" }
    }
  }
}`}</Code>
      </Section>
      <Section title={t("dev.contracts.title")} lead={t("dev.contracts.lead")}>
        <Table stack="sm" head={[t("dev.contracts.h.contract"), t("dev.contracts.h.address"), t("dev.contracts.h.role")]}>
          {CONTRACTS.map(([n, a, r]) => <tr key={n}><Td main className="font-medium">{n}</Td><Td label={t("dev.contracts.h.address")}><Hex value={a} n={6} /></Td><Td label={t("dev.contracts.h.role")} wrap className="text-muted">{t(r)}</Td></tr>)}
        </Table>
      </Section>
      <Section title={t("dev.enclave.title")} lead={t("dev.enclave.lead")}>
        <Table stack="sm" head={[t("dev.enclave.h.route"), t("dev.contracts.h.role")]}>
          {ROUTES.map(([m, r, d]) => (
            <tr key={r}>
              <Td main>{m === "GET" && !r.includes(":")
                ? <a className="font-mono text-accent hover:underline" href={`${ENCLAVE_URL.replace(/\/$/, "")}${r}`} target="_blank" rel="noreferrer">GET {r}</a>
                : <span className="font-mono">{m} {r}</span>}</Td>
              <Td label={t("dev.contracts.h.role")} wrap className="text-muted">{t(d)}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
