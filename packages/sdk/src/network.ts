/** network.ts — réseau Arc, adresses déployées, domaines EIP-712. */
import { defineChain, type Address, type TypedDataDomain } from "viem";

export const ARC_TESTNET_ID = 5042002 as const;
export const ARC_MAINNET_ID = 5042 as const;

/** Multicall3 (adresse canonique), présent sur Arc testnet (VERIFIED le 7/11) : viem y groupe les lectures. */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.testnet.arc.io" } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export interface Deployment {
  /** "v2" : pile v2 (registre branché sur le vrai module DCAP, sessions liées à une enclave, prime en deux temps) ;
   *  "v1" : première pile (module d'attestation de test), gardée pour l'historique. */
  version: "v1" | "v2";
  chainId: number;
  deployBlock: bigint; // borne basse pour lire les events (getLogs)
  blockscoutUrl?: string; // indexeur d'events (le RPC public plafonne getLogs) — la « hive » lit ici
  usdc: Address;
  erc8004Validation: Address;
  /** Registre d'identité ERC-8004 (propriété des agentId ; OperatorBond.setAgentId exige d'en être propriétaire). */
  erc8004Identity: Address;
  history: Address;
  /** Module d'attestation du registre : v2 = TdxAttestationModule (DCAP d'Automata) ; v1 = MockAttestationModule. */
  attestationModule: Address;
  /** v2 : le vérificateur DCAP d'Automata appelé par le module (AutomataDcapAttestationFee). */
  dcapAttestation?: Address;
  productRegistry: Address;
  operatorBond: Address;
  enclaveRegistry: Address;
  verdictLog: Address;
  sessionPay: Address;
  sealedBounty: Address;
  x402Settler: Address;
  demoVault: Address;
  /** Fonds du réseau (part des paiements et des saisies sans victime). */
  treasury?: Address;
  /** Produits de référence du déploiement (lus on-chain le 7/11) : l'inférence privée (SessionPay) et la Prime scellée
   *  (SealedBounty) ; v2.1 : l'inférence payée à l'appel (X402Settler), si elle existe. Absents : à choisir dans
   *  listProducts(). */
  products?: { inference: bigint; bounty: bigint; x402?: bigint };
  /** Comment le module d'attestation vérifie un quote : "dcap" = signature d'Intel vérifiée on-chain (Automata DCAP),
   *  "dev" = module de test qui enregistre des mesures déclarées sans vérifier la signature (à ne jamais présenter comme vérifié). */
  attestation: "dcap" | "dev";
  /** 10/11 : les DEUX NIVEAUX d'opérateur (levels.ts) : MachineRegistry (liaison enclave → puce, déclarations, politiques
   *  des produits), ProofOfCloudAuditor (jeton de l'alliance Proof of Cloud vérifié on-chain), Ed25519Verifier,
   *  PolicyEnclaves (le registre vu à travers la politique du produit) et la Prime au niveau vérifié. */
  levels?: {
    machineRegistry: Address;
    proofOfCloudAuditor: Address;
    ed25519Verifier: Address;
    policyEnclaves: Address;
    sealedBountyVerified: Address;
  };
}

/** Pile v2.1 sur Arc testnet (deployments.v21.testnet.json, déployée le 9/11, bloc 71481927) : comme la v2 (registre
 *  branché sur le VRAI module DCAP, REQUIRE_SEPT_VE, timelock 0 sur testnet), plus l'empreinte d'IMAGE par rejeu
 *  on-chain du journal RTMR3 de dstack (stable d'un redémarrage à l'autre), des verdicts ERC-8004 liés au contrat et
 *  salés, et l'inférence payée à l'appel (x402, produit 3). Le copilote attesté est le produit 4 (sans règlement). */
export const testnet: Deployment = {
  version: "v2",
  chainId: ARC_TESTNET_ID,
  deployBlock: 71481927n,
  blockscoutUrl: "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  history: "0x0000F90827F1C53a10cb7A02335B175320002935",
  attestationModule: "0x26C1803dE523aC896Ba7F1787f1401ec792951ca",
  dcapAttestation: "0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9",
  productRegistry: "0x582a3076cf6A1347907565B57Ce9f548D33805A4",
  operatorBond: "0xe584F7590e4677372eE6259b967672c747eB6850",
  enclaveRegistry: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d",
  verdictLog: "0x2B4AB39B461Ae2bA9ADfb6bC630D34553BAb9779",
  sessionPay: "0x8Bf8A8356f53006E9aB359AA6382f783923058a6",
  sealedBounty: "0x182871d34438aB37a7FD4d8689f3e0812E447A9b",
  x402Settler: "0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634",
  demoVault: "0x250C64fcbb61Ca4B9278330ae3711DCcADD1AB09",
  treasury: "0x5724d89D610c3017b8DC161c025248341556f6Ab",
  products: { inference: 1n, bounty: 2n, x402: 3n },
  attestation: "dcap",
  // 11/11/2026 : pile des niveaux REDÉPLOYÉE après la revue de sécurité (PckChip corrigé) ; l'ancienne est abandonnée
  // (voir deployments.v21.testnet.json → levels.superseded). La Prime vérifiée est le PRODUIT 7 (le 6 est neutralisé) ;
  // elle saisit et écrit ses verdicts à partir du 18/11 23:00 UTC.
  levels: {
    machineRegistry: "0xd671013f556b1272b25e3cc17c889d402f4dc26d",
    proofOfCloudAuditor: "0xcdc4c150344f06d506deb5500332737e8dcc8fab",
    ed25519Verifier: "0x031579dd04398249feb67852632da4a648d4b5cf",
    policyEnclaves: "0x665f4bb3c31d23463f45e4092487f6b498490417",
    sealedBountyVerified: "0x36a8ddf9fcb1308b9e86425bec9b098e933c7348",
  },
};

/** Pile v2 sur Arc testnet (deployments.v2.testnet.json, déployée le 7/11, bloc 71206317 ; remplacée par la v2.1 le 9/11,
 *  gardée pour l'historique : sessions, primes et verdicts passés) : le registre d'enclaves
 *  est branché sur le VRAI module DCAP (chaque quote est vérifié contre la signature d'Intel, ≈ 5,7 M gas par
 *  inscription), REQUIRE_SEPT_VE actif, timelock des produits à 0 (testnet). */
export const testnetV2: Deployment = {
  version: "v2",
  chainId: ARC_TESTNET_ID,
  deployBlock: 71206317n,
  blockscoutUrl: "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  history: "0x0000F90827F1C53a10cb7A02335B175320002935",
  attestationModule: "0x26C1803dE523aC896Ba7F1787f1401ec792951ca",
  dcapAttestation: "0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9",
  productRegistry: "0x7795d037C8727D2F2a3D03F22b206EdCA7EdE810",
  operatorBond: "0x0CFD3400736257BB1689C87C42800C2F71e3449D",
  enclaveRegistry: "0x54AeCc6500a1CfB33FD5BFB3008ed7A600Ae7d38",
  verdictLog: "0xE0d333a32128Bc1A830888AE6cd69bF437C7698A",
  sessionPay: "0x50158CDF4e7A020b198984a1D54CeDE878693193",
  sealedBounty: "0xaC8949a108e8288aBe0DdC5b5A4120De4636E4BF",
  x402Settler: "0xBeFdA057670e5efdB6aAfc2b91AcE75673594dFC",
  demoVault: "0xD4f4d2Bb6bf662e738cB8917b9Ade152c245F8a1",
  treasury: "0x5724d89D610c3017b8DC161c025248341556f6Ab",
  products: { inference: 1n, bounty: 2n },
  attestation: "dcap",
};

/** Pile v1 sur Arc testnet (deployments.testnet.json, 3/11), gardée pour l'historique (sessions et primes passées) :
 *  son registre utilise un module d'attestation de TEST (mesures déclarées, signature d'Intel non vérifiée). Les ABI
 *  du SDK sont celles de la v2 : pour la v1, seules les lectures communes aux deux piles sont sûres. */
export const testnetV1: Deployment = {
  version: "v1",
  chainId: ARC_TESTNET_ID,
  deployBlock: 70523000n,
  blockscoutUrl: "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  history: "0x0000F90827F1C53a10cb7A02335B175320002935",
  attestationModule: "0x408035F0E84D1e84BA0582d07968d96128524158",
  productRegistry: "0x0C1634bE7ba6b9615990BADD53De650A90EBb547",
  operatorBond: "0xb1a198E58dC5706969f80Dd40Cf111e36871de95",
  enclaveRegistry: "0x741788700D44dA802D579ECD2Aec27878711aeAA",
  verdictLog: "0x5BfBd5A4c504732fC4EBA27792D8808E1b7A1A68",
  sessionPay: "0xED501a02a14048118F2ecC21f25D6993707641c7",
  sealedBounty: "0xAF5055e8559b96f9CE1a09A310a7c7C8dE143310",
  x402Settler: "0x1FFf7a34d7a3F8562fD3400f05CCbf7BD575E7B9",
  demoVault: "0xf217A8d61f90B47401216223dab69cfe3cCc1b27",
  products: { inference: 6n, bounty: 7n },
  attestation: "dev",
};

/**
 * Un fichier de déploiement (deployments.*.testnet.json : { chainId, deployBlock, external: { USDC, … }, contracts:
 * { EnclaveRegistry, … }, treasury, products: { "1": { settlement: "SessionPay" }, … } }) → Deployment. Sert à brancher un
 * service sur la pile choisie (ex. DEPLOYMENTS=deployments.v21.testnet.json) sans adresse codée en dur. Une adresse de
 * contrat manquante ou invalide lève une erreur (jamais de repli silencieux sur une autre pile).
 */
export function deploymentFromJson(j: any): Deployment {
  if (!j || typeof j !== "object" || !j.contracts || !j.external) throw new Error("fichier de déploiement illisible (contracts, external attendus)");
  const addr = (v: unknown, name: string): Address => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`fichier de déploiement : ${name} absent ou invalide`);
    return v as Address;
  };
  const opt = (v: unknown): Address | undefined => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);
  const chainId = Number(j.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("fichier de déploiement : chainId invalide");
  const C = j.contracts, X = j.external;
  // produits de référence : d'après le contrat de règlement déclaré pour chacun
  const bySettlement = (name: string): bigint | undefined => {
    for (const [id, p] of Object.entries((j.products ?? {}) as Record<string, any>)) {
      if (/^[0-9]+$/.test(id) && String(p?.settlement ?? "").startsWith(name)) return BigInt(id);
    }
    return undefined;
  };
  const inference = bySettlement("SessionPay"), bounty = bySettlement("SealedBounty"), x402 = bySettlement("X402Settler");
  const dcap = opt(X.AutomataDcapAttestationFee);
  const treasury = opt(j.treasury);
  return {
    version: "v2",
    chainId,
    deployBlock: BigInt(j.deployBlock ?? 0),
    ...(chainId === ARC_TESTNET_ID ? { blockscoutUrl: "https://explorer.testnet.arc.io" } : {}),
    usdc: addr(X.USDC, "external.USDC"),
    erc8004Validation: addr(X.ERC8004_Validation, "external.ERC8004_Validation"),
    erc8004Identity: addr(X.ERC8004_Identity, "external.ERC8004_Identity"),
    history: addr(X.EIP2935_History, "external.EIP2935_History"),
    attestationModule: addr(C.TdxAttestationModule ?? C.MockAttestationModule, "contracts.TdxAttestationModule"),
    ...(dcap ? { dcapAttestation: dcap } : {}),
    productRegistry: addr(C.ProductRegistry, "contracts.ProductRegistry"),
    operatorBond: addr(C.OperatorBond, "contracts.OperatorBond"),
    enclaveRegistry: addr(C.EnclaveRegistry, "contracts.EnclaveRegistry"),
    verdictLog: addr(C.VerdictLog, "contracts.VerdictLog"),
    sessionPay: addr(C.SessionPay, "contracts.SessionPay"),
    sealedBounty: addr(C.SealedBounty, "contracts.SealedBounty"),
    x402Settler: addr(C.X402Settler, "contracts.X402Settler"),
    demoVault: opt(C.DemoVault) ?? ("0x0000000000000000000000000000000000000000" as Address),
    ...(treasury ? { treasury } : {}),
    ...(inference !== undefined && bounty !== undefined ? { products: { inference, bounty, ...(x402 !== undefined ? { x402 } : {}) } } : {}),
    attestation: C.TdxAttestationModule ? "dcap" : "dev",
    ...(j.levels && opt(j.levels.MachineRegistry)
      ? {
          levels: {
            machineRegistry: addr(j.levels.MachineRegistry, "levels.MachineRegistry"),
            proofOfCloudAuditor: addr(j.levels.ProofOfCloudAuditor, "levels.ProofOfCloudAuditor"),
            ed25519Verifier: addr(j.levels.Ed25519Verifier, "levels.Ed25519Verifier"),
            policyEnclaves: addr(j.levels.PolicyEnclaves, "levels.PolicyEnclaves"),
            sealedBountyVerified: addr(j.levels.SealedBountyVerified, "levels.SealedBountyVerified"),
          },
        }
      : {}),
  };
}

export const DOMAIN_NAME = "ArcEnclaveNetwork";
export const DOMAIN_VERSION = "1";

/** Domaine EIP-712 des contrats du réseau (SessionPay, SealedBounty, X402Settler). */
export function networkDomain(verifyingContract: Address, chainId: number = ARC_TESTNET_ID): TypedDataDomain {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract };
}

/** Domaine EIP-712 de l'USDC d'Arc (EIP-3009), name "USDC" version "2" (VERIFIED). */
export function usdcDomain(usdc: Address, chainId: number = ARC_TESTNET_ID): TypedDataDomain {
  return { name: "USDC", version: "2", chainId, verifyingContract: usdc };
}

// ---- constantes de la pile v2 (lues dans les contrats ; vérifiées par lecture on-chain le 7/11) ----

/** SessionPay.MIN_SESSION / MAX_SESSION : l'échéance d'une session est dans [maintenant + 10 min, maintenant + 30 j]. */
export const SESSION_MIN_SECONDS = 600;
export const SESSION_MAX_SECONDS = 30 * 86_400;
/** Marge prise par le SDK sur ces bornes (le bloc qui inclut la transaction vient après la lecture de l'horloge). */
export const SESSION_EXPIRY_MARGIN_SECONDS = 120;
/** SessionPay.SETTLE_GRACE : délai après l'échéance pour un dernier règlement, avant la fermeture par le propriétaire. */
export const SETTLE_GRACE_SECONDS = 3600;
/** L'enclave d'inférence v2 ne sert plus une session à moins de 60 s de son échéance (réponse 410). */
export const ENCLAVE_EXPIRY_MARGIN_SECONDS = 60;
/** SealedBounty.MAX_SIGS : au plus 5 signatures (donc k ≤ 5). */
export const BOUNTY_MAX_SIGS = 5;
/** Gaz d'une inscription par le vrai DCAP (vérification du quote + politique), mesuré sur Arc testnet : ≈ 5,7 M. */
export const DCAP_REGISTER_GAS_ESTIMATE = 5_700_000n;
