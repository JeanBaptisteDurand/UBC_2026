/** enclave-site-measure.ts — l'empreinte de la VM du copilote du site AVANT de la lancer (18/11/2026) : ce que l'auteur
 *  du produit 4 devra autoriser sur Arc (ProductRegistry.proposeWorkload → applyWorkload), calculé à partir des fichiers.
 *
 *  Comment dstack et Arc mesurent une VM (VERIFIED le 18/11 sur la VM du copilote v21, sauvegardée le 14/11, note V) :
 *   - compose-hash = sha256 de l'app-compose.json de Phala (le docker-compose dans le champ docker_compose_file, plus le
 *     script de lancement, les noms des variables chiffrées, kms, passerelle…), écrit en JSON COMPACT, clés TRIÉES, UTF-8
 *     sans échappement (json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)) : 0x254c2e42… pour la v21,
 *     égal au compose_hash que Phala affichait ; le compose-hash entre dans RTMR3 (événement « compose-hash ») ;
 *   - empreinte d'IMAGE (ce que le produit autorise, EnclaveRegistry.imageIdOf) = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖
 *     compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES), sans RTMR3 ni identifiant d'instance : stable d'un redémarrage
 *     à l'autre. MRTD et RTMR0-2 dépendent du micrologiciel, de l'image système et de la taille de la VM, pas du compose.
 *  Les mesures de la VM v21 (tdx.small, nœud prod9, dstack-0.5.12 de production) sont relues dans sa transaction
 *  d'inscription (calldata publique de registerEnclave) ; le rejeu redonne son empreinte enregistrée 0x919e9c97…. Une VM
 *  de MÊME taille, sur la même image système et le même micrologiciel, garde ces mesures : son empreinte se PRÉDIT avec le
 *  nouveau compose-hash. La valeur qui fait foi reste celle du quote réel de la nouvelle VM (scripts/register-dcap.ts la
 *  recalcule et la compare au registre avant d'autoriser quoi que ce soit).
 *
 *  Usage (aucun réseau, aucune clé) :
 *    npx tsx src/enclave-site-measure.ts <app-compose v21 sauvegardé> <docker-compose.yml> [--out <app-compose.json>]
 *  → le compose-hash, l'empreinte d'image prédite, et (avec --out) l'app-compose.json exact à déployer
 *    (phala deploy --app-compose <fichier> : le même script de lancement, donc le même compose-hash). */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type Hex } from "viem";
import { dstackImageId } from "@arcvault/sdk";

/** Les mesures de la VM du copilote v21, relues dans sa transaction d'inscription (VERIFIED, Arc testnet). */
export const V21_COPILOT_VM = {
  source: "registerEnclave 0xad8b9780689513b1f68b8aba1a99f1b3156b4038a86aff46cad5ff96e294005e (bloc 71774983, produit 4, VM archive-v21-copilot : tdx.small, prod9, dstack-0.5.12)",
  mrtd: "0x7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173",
  rtmr0: "0x68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96",
  rtmr1: "0x4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec",
  rtmr2: "0x764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d",
  xfam: "0x0702000000000000",
  tdAttributes: "0x0000001000000000",
  osImageHash: "0x8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd",
  composeHash: "0x254c2e42e9bf7dcc8a55924fa9fb4ef346e9bb4837353960ca5547c05a743bb7",
  imageId: "0x919e9c97158daf5f6a214523bebddc54dd1a84fe0be3e2482ca2f22e9483f189",
} as const satisfies Record<string, string>;

/** JSON canonique de dstack : clés triées (à tous les niveaux), compact, caractères non ASCII tels quels. */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(",")}]`;
  if (x && typeof x === "object") {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((x as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(x);
}

/** compose-hash d'un app-compose.json de Phala : sha256 de son JSON canonique (0x + 64 hexadécimaux). */
export function composeHashOf(appCompose: Record<string, unknown>): Hex {
  return `0x${createHash("sha256").update(canonicalJson(appCompose), "utf8").digest("hex")}`;
}

/** L'app-compose d'une nouvelle VM : celui de la v21 (même script de lancement, mêmes options), avec SON docker-compose.
 *  Les noms des variables chiffrées doivent rester ceux du compose (allowed_envs) : vérifié ici. */
export function appComposeFor(template: Record<string, unknown>, dockerCompose: string): Record<string, unknown> {
  if (typeof template.docker_compose_file !== "string" || typeof template.pre_launch_script !== "string") {
    throw new Error("gabarit : app-compose.json de Phala attendu (docker_compose_file et pre_launch_script)");
  }
  const secrets = [...dockerCompose.matchAll(/^\s*-\s*"?([A-Z0-9_]+)=\$\{[A-Z0-9_]+\}"?\s*$/gm)].map((m) => m[1]!);
  const allowed = Array.isArray(template.allowed_envs) ? template.allowed_envs.map(String) : [];
  const missing = secrets.filter((s) => !allowed.includes(s));
  if (missing.length) throw new Error(`variables chiffrées absentes de allowed_envs du gabarit : ${missing.join(", ")}`);
  return { ...template, docker_compose_file: dockerCompose };
}

/** L'empreinte d'image prédite pour un compose-hash, avec les mesures d'une VM de même taille et de même image système. */
export function predictedImageId(composeHash: Hex, vm: { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; xfam: string; tdAttributes: string; osImageHash: string } = V21_COPILOT_VM): Hex {
  return dstackImageId(
    { mrtd: vm.mrtd as Hex, rtmr0: vm.rtmr0 as Hex, rtmr1: vm.rtmr1 as Hex, rtmr2: vm.rtmr2 as Hex, xfam: vm.xfam as Hex, tdAttributes: vm.tdAttributes as Hex },
    composeHash, vm.osImageHash as Hex,
  );
}

/** Le docker-compose contient-il encore l'image à remplacer après le push (jamais déployable tel quel) ? */
export const IMAGE_PLACEHOLDER = "REPLACE_WITH_PUSHED_DIGEST";

async function main(argv: string[]) {
  const [templatePath, composePath] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
  if (!templatePath || !composePath) {
    console.error("usage : npx tsx src/enclave-site-measure.ts <app-compose v21 sauvegardé> <docker-compose.yml> [--out <app-compose.json>]");
    process.exit(2);
  }
  const template = JSON.parse(readFileSync(templatePath, "utf8")) as Record<string, unknown>;
  const dockerCompose = readFileSync(composePath, "utf8");
  // contrôle du gabarit : il redonne bien le compose-hash de la v21 avec SON compose
  const v21 = composeHashOf(template);
  const app = appComposeFor(template, dockerCompose);
  const composeHash = composeHashOf(app);
  const report = {
    template: { file: templatePath, composeHash: v21, isV21Copilot: v21 === V21_COPILOT_VM.composeHash, v21ImageIdReplayed: predictedImageId(v21) === V21_COPILOT_VM.imageId },
    compose: composePath,
    placeholderImage: dockerCompose.includes(IMAGE_PLACEHOLDER),
    composeHash,
    predictedImageId: predictedImageId(composeHash),
    assumes: `même taille (tdx.small), même image système (os-image-hash ${V21_COPILOT_VM.osImageHash}) et même micrologiciel que la VM v21 (${V21_COPILOT_VM.source}), déployée avec CET app-compose (même script de lancement)`,
    ...(out ? { appCompose: out } : {}),
  };
  if (out) writeFileSync(out, canonicalJson(app));
  console.log(JSON.stringify(report, null, 2));
  if (report.placeholderImage) console.error("ATTENTION : l'image du compose est encore le gabarit (pousser l'image, puis écrire son condensat) : rien à autoriser avec ce calcul");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(`mesure : ${(e as Error)?.message ?? e}`); process.exit(1); });
}
