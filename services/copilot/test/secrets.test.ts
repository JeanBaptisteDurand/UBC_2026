/** secrets.test.ts — le filtre de secrets (audit du 7/11, n° 10, et restes relevés par le vérificateur le 8/11) : cas
 *  positifs (masqués) et négatifs (laissés tels quels : hashes de transaction, bytes32 publics, prose, code, vrais
 *  résultats d'outils).
 *  Lancer : cd services/copilot && npx tsx --test test/secrets.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { english, french, spanish, italian, portuguese, czech, japanese, korean, simplifiedChinese, traditionalChinese } from "viem/accounts";
import { scrubSecrets, scrubUserMessage, scrubConversation, conversationAlert, mentionsSecret, redactLiterals, MASK_KEY, MASK_PHRASE, MASK_CAUTION } from "../src/secrets";
import { KB, VERIFICATION_STATE } from "../src/tools";
import { fixture } from "./helpers";

const HEX = "ab".repeat(32); // 64 caractères hexadécimaux
const KEY = `0x${HEX}`;
const ADDR = "0x1234567890123456789012345678901234567890";
const fold = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

test("clés d'accès aek_ et clés opérateur arcop_ : masquées", () => {
  for (const s of ["ma clé aek_arctest_14_AbCdEfGh12345678", "arcop_82de3821_AbCdEfGh1234567890xyz", "ARCOP_KEY=arcop_82de3821_secretsecret"]) {
    const out = scrubSecrets(s);
    assert.ok(out.includes(MASK_KEY), s);
    assert.ok(!/aek_arctest_14_AbCd|arcop_82de3821/.test(out), out);
  }
});

test("clé privée PEM : masquée", () => {
  const pem = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVJk5oVDwQ8rUKTA7oAoGCCqGSM49\n-----END EC PRIVATE KEY-----";
  const out = scrubSecrets(`voici : ${pem} merci`);
  assert.equal(out, `voici : ${MASK_KEY} merci`);
});

test("0x + 64 hexadécimaux PRÈS d'un mot qui désigne un secret : masqué", () => {
  for (const s of [
    `voici ma clé : ${KEY}`,
    `mon wallet ${KEY}`,
    `clé privée ${KEY}`,
    `ma clé privée est ${KEY}`,
    `PRIVATE_KEY=${KEY}`,
    `export ARC_PK=${KEY}`,
    `{"privateKey":"${KEY}"}`,
    `secret: ${KEY}`,
    `seed ${HEX}`, // sans 0x
    `my private key is ${KEY}, thanks`,
    `Ma clé :\n${KEY}`, // libellé sur la ligne d'avant
    `{"keys":["${KEY}"]}`, // premier élément d'un tableau libellé
    `${KEY} (clé privée du déployeur)`, // libellé après la valeur
    `{"journal":"PRIVATE_KEY=\\n${KEY}"}`, // saut de ligne échappé dans un JSON
    `{\n  "wallet": "${KEY}"\n}`, // JSON indenté
  ]) {
    const out = scrubSecrets(s);
    assert.ok(!out.includes(HEX), `non masqué : ${s}`);
    assert.ok(out.includes(MASK_KEY), s);
  }
});

test("hashes de transaction, bytes32 publics et valeurs sans libellé : jamais masqués", () => {
  for (const s of [
    KEY, // sans libellé
    `tx ${KEY}`,
    `hash de transaction : ${KEY}`,
    `"quoteHash":"${KEY}"`,
    `workloadId ${KEY}`,
    `la clé publique X25519 ${KEY}`,
    `public key ${KEY}`,
    `mon wallet a envoyé la transaction ${KEY}`, // le mot le plus proche décide
    `{"nonce":"${KEY}","wallet":"${ADDR}"}`, // le champ SUIVANT d'un JSON ne compte pas
    `"cPHash":"${KEY}","secret":"x"`,
    `{"wallet":"${ADDR}","param":"${KEY}"}`, // champ neutre après un champ « wallet »
    `{\n  "wallet": "${ADDR}",\n  "param": "${KEY}"\n}`, // idem, JSON indenté
    `image ghcr.io/x/y@sha256:${HEX}`,
    `{"secretHash":"${KEY}"}`, // le hash d'un secret est public
  ]) assert.equal(scrubSecrets(s), s, s);
});

test("phrase de récupération BIP-39 (12 à 24 mots d'une même liste) : masquée", () => {
  const cases = [
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", // vecteur de test BIP-39
    english.slice(100, 115).join(" "), // 15 mots
    english.slice(300, 324).join(" "), // 24 mots
    `seed: ${english.slice(500, 512).join(" ")}`,
    english.slice(700, 712).map((w, i) => `${i + 1}. ${w}`).join(" "), // numérotée
    english.slice(800, 812).join("\n"), // une par ligne
    JSON.stringify(english.slice(900, 912)), // tableau JSON
    JSON.stringify({ mnemonic: english.slice(1000, 1012).join("\n") }), // sauts de ligne échappés
    english.slice(1100, 1112).join(" ").toUpperCase(),
    french.slice(200, 212).join(" "), // liste française
    french.slice(300, 312).map(fold).join(" "), // française sans accents
  ];
  for (const s of cases) {
    const out = scrubSecrets(`Ma phrase : ${s} — merci`);
    assert.ok(out.includes(MASK_PHRASE), `non masquée : ${s.slice(0, 60)}`);
    const words = s.match(/[\p{L}]+/gu)!.filter((w) => w.length > 3);
    assert.ok(words.filter((w) => out.includes(w)).length <= 1, `mots restés visibles : ${out.slice(0, 120)}`);
  }
});

test("moins de 12 mots, mots de deux listes mêlées, prose : laissés", () => {
  const eleven = english.slice(0, 11).join(" ");
  assert.equal(scrubSecrets(eleven), eleven);
  const fr = new Set(french.map(fold)), en = new Set(english.map(fold));
  const enOnly = english.filter((w) => !fr.has(fold(w))).slice(0, 6);
  const frOnly = french.filter((w) => !en.has(fold(w))).slice(0, 6);
  const mixed = enOnly.flatMap((w, i) => [w, frOnly[i]!]).join(" "); // 12 mots, 6 de chaque liste : pas une phrase BIP-39
  assert.equal(scrubSecrets(mixed), mixed);
  for (const s of [
    "the cable car will arrive at the airport around noon and we can all take a taxi to the hotel after lunch",
    "Pour devenir opérateur, déposez une caution en USDC, louez une VM Intel TDX, puis inscrivez votre enclave sur Arc.",
    "Seed phrase, clé privée, mot de passe : ne les donnez jamais au copilote.",
  ]) assert.equal(scrubSecrets(s), s, s);
});

test("vrais textes : base de connaissances, événements on-chain, listes de l'API", () => {
  for (const k of KB) assert.equal(scrubSecrets(k.text), k.text, k.source);
  assert.equal(scrubSecrets(VERIFICATION_STATE), VERIFICATION_STATE);
  for (const f of ["activity.json", "enclaves.json", "bounties.json", "products.json"]) {
    const j = fixture(f);
    for (const s of [JSON.stringify(j), JSON.stringify(j, null, 2)]) assert.equal(scrubSecrets(s), s, f);
  }
  // données EIP-3009 préparées par un outil : le nonce (bytes32) reste lisible
  const typed = { domain: { name: "USDC", chainId: 5042002 }, message: { from: ADDR, to: ADDR, value: "1000000", validAfter: "0", validBefore: "1794240000", nonce: KEY } };
  for (const s of [JSON.stringify(typed), JSON.stringify(typed, null, 2)]) assert.equal(scrubSecrets(s), s);
});

test("idempotent, et un secret dans un résultat d'outil JSON reste un JSON valide", () => {
  const s = JSON.stringify({ logs: [`PRIVATE_KEY=${KEY}`, `tx ${KEY}`], mnemonic: english.slice(10, 22).join(" ") });
  const once = scrubSecrets(s);
  assert.equal(scrubSecrets(once), once);
  const j = JSON.parse(once);
  assert.equal(j.logs[0], `PRIVATE_KEY=${MASK_KEY}`);
  assert.equal(j.logs[1], `tx ${KEY}`);
  assert.equal(j.mnemonic, MASK_PHRASE);
});

// ---------------------------------------------------------------- restes relevés par le vérificateur le 8/11

const W12 = english.slice(100, 112); // arrive arrow art artefact artist artwork ask aspect assault asset assist assume
const assertPhraseMasked = (s: string, label: string, scrub: (x: string) => string = scrubSecrets) => {
  const out = scrub(s);
  assert.ok(out.includes(MASK_PHRASE), `non masquée (${label}) : ${out.slice(0, 160)}`);
  const visible = W12.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(out));
  assert.ok(visible.length === 0, `mots restés visibles (${label}) : ${visible.join(", ")}`);
};

test("phrase numérotée avec deux-points, « Mot n°1 : », « Word #1: », colonnes alignées : masquée", () => {
  const cases: Array<[string, string]> = [
    ["« 1: »", W12.map((w, i) => `${i + 1}: ${w}`).join(" ")],
    ["« 1 : » une par ligne", W12.map((w, i) => `${i + 1} : ${w}`).join("\n")],
    ["« Mot n°1 : »", W12.map((w, i) => `Mot n°${i + 1} : ${w}`).join("\n")],
    ["« mot 1 - »", W12.map((w, i) => `mot ${i + 1} - ${w}`).join(", ")],
    ["« Word #1: »", W12.map((w, i) => `Word #${i + 1}: ${w}`).join("\n")],
    ["« (1) » et « [1] »", W12.map((w, i) => (i % 2 ? `(${i + 1}) ${w}` : `[${i + 1}] ${w}`)).join(" ")],
    ["colonnes alignées « 01. mot      02. mot »", W12.map((w, i) => `${String(i + 1).padStart(2, "0")}. ${w.padEnd(12)}`).join("  ")],
    ["trois colonnes, dans l'ordre des lignes", [0, 1, 2, 3].map((r) => [r, r + 4, r + 8].map((k) => `${String(k + 1).padStart(2)}. ${W12[k]!.padEnd(10)}`).join("   ")).join("\n")],
    ["tableau JSON à clés numérotées", JSON.stringify(Object.fromEntries(W12.map((w, i) => [String(i + 1), w])))],
    ["tirets", W12.join("-")],
  ];
  for (const [label, s] of cases) {
    assertPhraseMasked(`Voici : ${s}`, label);
    assertPhraseMasked(JSON.stringify({ note: s }), `${label}, dans un JSON`); // résultat d'outil (journal de machine)
  }
});

test("phrase avec UNE faute de frappe (en trop, oubliée, changée, inversée, au-delà des 4 premières lettres) : masquée", () => {
  const edits: Array<[string, (w: string) => string]> = [
    ["lettre en trop", (w) => `${w}x`],
    ["lettre oubliée", (w) => w.slice(0, -1)],
    ["lettre changée", (w) => `${w.slice(0, 1)}${w[1] === "z" ? "y" : "z"}${w.slice(2)}`],
    ["lettres inversées", (w) => `${w[1]}${w[0]}${w.slice(2)}`],
    ["fin du mot fausse (4 premières lettres justes)", (w) => `${w.slice(0, 4)}qq`],
  ];
  // le cas exact du vérificateur : « askx » en 7e position (deux suites de 6 et 5 mots auparavant)
  const askx = W12.map((w, i) => (i === 6 ? `${w}x` : w)).join(" ");
  assert.equal(scrubSecrets(askx), MASK_PHRASE);
  // (un mot de 3 lettres privé d'une lettre n'en a plus que 2 : jamais pris pour une faute, sinon « to », « of », « at »
  // relieraient de la prose)
  for (const [label, edit] of edits) {
    for (const at of [0, 5, 11]) { // en tête, au milieu, en fin
      const words = W12.map((w, i) => (i === at ? edit(w) : w));
      const out = scrubSecrets(`ma phrase : ${words.join(" ")} merci`);
      assert.ok(out.includes(MASK_PHRASE), `non masquée (${label}, mot ${at + 1}) : ${out}`);
      assert.ok(!words.some((w) => out.includes(` ${w} `) || out.endsWith(w)), `un mot est resté visible (${label}, mot ${at + 1}) : ${out}`);
      assert.match(out, /merci$/, "le mot qui suit la phrase reste lisible");
    }
  }
  // 24 mots, une faute par tranche de 12
  const w24 = english.slice(300, 324).map((w, i) => (i === 5 || i === 17 ? `${w}x` : w));
  const out = scrubSecrets(w24.join(" "));
  assert.equal(out, MASK_PHRASE);
});

test("les dix listes BIP-39 (anglais, français, espagnol, italien, portugais, tchèque, japonais, coréen, chinois) : masquées", () => {
  const cases: Array<[string, string]> = [
    ["espagnol", spanish.slice(50, 62).join(" ")],
    ["italien", italian.slice(70, 82).join(" ")],
    ["portugais", portuguese.slice(70, 82).join(" ")],
    ["tchèque", czech.slice(70, 82).join(" ")],
    ["japonais (espace idéographique)", japanese.slice(70, 82).join("\u3000")],
    ["coréen", korean.slice(70, 82).join(" ")],
    ["chinois simplifié, un caractère par mot", simplifiedChinese.slice(300, 312).join(" ")],
    ["chinois traditionnel", traditionalChinese.slice(400, 412).join(" ")],
    ["espagnol sans accents, une faute", spanish.slice(50, 62).map((w, i) => (i === 3 ? `${fold(w)}s` : fold(w))).join(" ")],
  ];
  for (const [label, s] of cases) {
    const out = scrubSecrets(`phrase : ${s}`);
    assert.equal(out, `phrase : ${MASK_PHRASE}`, label);
  }
});

test("pas de faux positif : prose en d'autres langues, code, journaux clé-valeur, fautes trop nombreuses", () => {
  for (const s of [
    "El operador deposita una garantía en USDC, alquila una máquina virtual y registra su enclave en la red de Arc para cobrar cada respuesta firmada.",
    "L'operatore deposita una cauzione in USDC, noleggia una macchina virtuale e registra la sua enclave sulla rete di Arc per incassare ogni risposta firmata.",
    "O operador deposita uma caução em USDC, aluga uma máquina virtual e registra o seu enclave na rede da Arc para receber cada resposta assinada.",
    "Operátor složí zálohu v USDC, pronajme si virtuální stroj a zaregistruje svou enklávu v síti Arc, aby dostal zaplaceno za každou podepsanou odpověď.",
    "const win = probe.slice(Math.max(0, start - 64), start).split(\"\\n\").slice(-2).join(\"\\n\"); return win.split(FIELD_SEP).pop();",
    JSON.stringify({ able: "about", above: "absent", absorb: "abstract", absurd: "abuse", access: "accident", account: "accuse" }),
    "level=info able=about above=absent absorb=abstract absurd=abuse access=accident account=accuse",
    W12.map((w, i) => (i % 2 ? `${w}x` : w)).join(" "), // une faute sur deux : pas une phrase
    W12.map((w, i) => (i % 3 === 2 ? `${w}x` : w)).join(" "), // une faute sur trois
  ]) assert.equal(scrubSecrets(s), s, s.slice(0, 80));
});

test("clés de fournisseur (sk-…, sk-proj-…, rpk_…, Bearer, variables d'environnement) : masquées", () => {
  for (const [s, leak] of [
    ["Erreur : 401 Invalid API key provided: sk-proj-THIS-IS-THE-SERVER-PROVIDER-KEY-1234567890abcdef", "PROVIDER-KEY"],
    ["OPENAI_API_KEY=sk-abc123DEF456ghi789JKL012mno345", "abc123DEF456"],
    ["clé RedPill : rpk_9fA3kLm2Qx7Zt5Wv1Ns8", "9fA3kLm2Qx7Z"],
    ["sk-ant-api03-AbCdEf1234567890GhIjKl", "AbCdEf123456"],
    ["authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc123def456", "eyJhbGciOiJIUzI1NiJ9"],
    ["REDPILL_API_KEY: Zx81kQ0pLm4NcV7bT2rY", "Zx81kQ0pLm4NcV7bT2rY"],
    ['{"API_KEY": "Zx81kQ0pLm4NcV7bT2rY"}', "Zx81kQ0pLm4NcV7bT2rY"],
    ["export GITHUB_TOKEN=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4", "A1b2C3d4E5f6"],
  ] as const) {
    const out = scrubSecrets(s);
    assert.ok(!out.includes(leak) && out.includes(MASK_KEY), `${s} → ${out}`);
  }
  for (const s of [
    "pip install sk-learn-extras-for-the-pipeline", // pas de chiffre : un mot composé
    "Bearer bonds are not the same as bearer tokens.",
    "UNIT_TOKENS=1",
    "REDPILL_API_KEY=${REDPILL_API_KEY}   # variable chiffrée",
    "const TOKEN = randomBytes(36).toString(\"base64url\");",
    "const API_KEY = process.env.OPENAI_API_KEY;",
  ]) assert.equal(scrubSecrets(s), s, s);
});

test("message de l'UTILISATEUR qui parle de clé privée : toute valeur de 64 hex masquée, même si un mot public est plus proche", () => {
  const H = "9c4f1e2d" + "ab".repeat(28);
  // les cas du vérificateur : le mot public (« publique », « hash », « tx ») est plus proche que « clé privée », ou le
  // libellé est loin, ou absent ; le filtre général (résultats d'outils) garde la règle du mot le plus proche
  const nearestPublic = [
    `Voici ma clé privée (pas l'adresse publique) : 0x${H}`,
    `J'ai collé ma clé privée au lieu du hash de transaction : 0x${H}`,
    `here is my private key, not the tx hash: 0x${H}`,
  ];
  for (const s of nearestPublic) assert.ok(scrubSecrets(s).includes(H), s);
  for (const s of [
    ...nearestPublic,
    `Voici ma clé que j'ai exportée hier soir depuis MetaMask sur mon ordinateur portable : 0x${H}`,
    `mon export MetaMask : 0x${H}`,
    `ma seed en hexadécimal : ${H}`,
    `PRIVATE_KEY du déployeur (c'est le hash ?) ${H}`,
  ]) {
    const out = scrubUserMessage(s);
    assert.ok(!out.includes(H.slice(8, 40)), `fuite : ${out}`);
    assert.ok(out.includes(MASK_CAUTION) || out.includes(MASK_KEY), out);
    assert.equal(scrubUserMessage(out), out, "idempotent");
  }
  // clé coupée en deux lignes, ou en groupes
  for (const s of [`clé privée :\n0x${H.slice(0, 32)}\n${H.slice(32)}`, `private key: ${H.match(/.{16}/g)!.join(" ")}`]) {
    const out = scrubUserMessage(s);
    assert.ok(!out.includes(H.slice(32, 48)) && !out.includes(H.slice(0, 16)), `fuite : ${out}`);
  }
  // sans mention d'un secret : un hash de transaction reste lisible ; avec mention : une adresse (40 hex) aussi
  for (const s of [`vérifie la transaction 0x${H}`, `0x${H}`, `statut du reçu ${H} ?`]) assert.equal(scrubUserMessage(s), s);
  const addr = "0x5724d89D610c3017b8DC161c025248341556f6Ab";
  const s = `Je ne donnerai pas ma clé privée : quel est le solde de ${addr} ?`;
  assert.equal(scrubUserMessage(s), s);
  assert.ok(mentionsSecret("my seed phrase") && mentionsSecret("ma phrase de récupération") && mentionsSecret("const privateKey = …") && mentionsSecret("clés privées"));
  assert.ok(!mentionsSecret("la clé publique X25519") && !mentionsSecret("vérifie ma transaction"));
});

test("message de l'UTILISATEUR qui parle de sa phrase de récupération : reconnue dès 8 mots, deux fautes tolérées sur 12", () => {
  const eight = english.slice(500, 508).join(" ");
  assert.equal(scrubSecrets(`ma phrase de récupération commence par ${eight}`).includes(eight), true, "hors alerte : moins de 12 mots");
  assert.ok(!scrubUserMessage(`ma phrase de récupération commence par ${eight}`).includes(eight));
  const twoTypos = W12.map((w, i) => (i === 3 || i === 8 ? `${w}x` : w)).join(" ");
  const out = scrubUserMessage(`my seed phrase is ${twoTypos}`);
  assert.equal(out, `my seed phrase is ${MASK_PHRASE}`);
  for (const s of [
    "Ma phrase de récupération est-elle en sécurité si je la garde dans un coffre à la maison ?",
    "What is a seed phrase and why should I never paste it into a chat or a website form?",
  ]) assert.equal(scrubUserMessage(s), s);
});

test("secrets du serveur retirés quel que soit leur format (redactLiterals)", () => {
  const k = "zZ-unusual-provider-format-0001";
  assert.equal(redactLiterals(`a ${k} b ${k}`, [k]), `a ${MASK_KEY} b ${MASK_KEY}`);
  assert.equal(redactLiterals("rien", [k, "", "court"]), "rien");
});

// ---------------------------------------------------------------- restes relevés par le vérificateur le 9/11 (mode alerte)

const K64 = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const grouped = (x: string, n: number, sep = " ") => x.match(new RegExp(`.{1,${n}}`, "g"))!.join(sep);
/** Aucune suite de 12 chiffres de la clé ne reste (les marques contiennent des lettres a-f, jamais 12 de suite). */
const keyGone = (out: string) => {
  const d = out.replace(/[^0-9a-f]/gi, "").toLowerCase();
  for (let i = 0; i + 12 <= K64.length; i += 6) if (d.includes(K64.slice(i, i + 12))) return false;
  return true;
};
const SOL = "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw8rhQZ7Agpvy7oUbtc9vwyfWtwT8n5WnA3XW8pXFGp6uqF"; // 88 car., base58
const WIF_C = "L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ"; // 52 car., compressée
const WIF_U = "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ"; // 51 car., non compressée
const BYTES = `[${Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256).join(",")}]`;

test("9/11 : mode alerte — clé hex en paires, en groupes de 2 à 8 (0x ou non), sur plusieurs lignes : masquée", () => {
  for (const s of [
    `my private key is ${grouped(K64, 2)}`, `ma clé privée : ${grouped(K64, 4)}`, `private key 0x${grouped(K64, 4)}`,
    `private key ${grouped(K64, 3)}`, `private key ${grouped(K64, 6)}`, `seed phrase : ${grouped(K64, 2, ":")}`, `clé privée :\n${grouped(K64, 8, "\n")}`,
    `private key ${grouped(K64, 2, ", ")}`,
  ]) {
    const out = scrubUserMessage(s);
    assert.ok(keyGone(out) && out.includes(MASK_CAUTION), `fuite : ${out}`);
    assert.equal(scrubUserMessage(out), out, "idempotent");
  }
  // 9/11 au soir : « seed » seul ne met plus en alerte ; la clé en groupes désignée par « seed » est masquée hors alerte
  const seedOnly = scrubUserMessage(`seed : ${grouped(K64, 2, ":")}`);
  assert.ok(keyGone(seedOnly) && seedOnly.includes(MASK_KEY), `fuite : ${seedOnly}`);
  // le libellé n'est jamais avalé (« privée » finit par une lettre hexadécimale), ni un mot qui suit
  assert.equal(scrubUserMessage(`ma clé privée : ${grouped(K64, 4)}`), `ma clé privée : ${MASK_CAUTION}`);
  assert.equal(scrubUserMessage(`private key ${grouped(K64, 2)} please`), `private key ${MASK_CAUTION} please`);
  // une table de nombres, des mots hexadécimaux (« de ce »), deux adresses : laissés, même en alerte
  for (const s of [
    `seed stats: ${Array.from({ length: 40 }, (_, i) => 10 + i).join(" ")}`, "ma clé privée : de ce que je sais, elle a été changée",
    "private key? no: 0x5724d89D610c3017b8DC161c025248341556f6Ab and 0x344f2d2fA5AeAe78871F0B882245069F887c2e1a",
  ]) assert.equal(scrubUserMessage(s), s, s);
  // hors alerte (aucune mention) : des groupes courts restent lisibles, comme avant
  assert.equal(scrubSecrets(`checksum ${grouped(K64, 4)}`), `checksum ${grouped(K64, 4)}`);
});

test("9/11 : mode alerte — clés base58 (Solana 87–88 car., WIF 51–52 car. commençant par 5, K ou L) et tableau d'octets : masqués", () => {
  for (const [s, v] of [
    [`my solana private key: ${SOL}`, SOL], [`private key (WIF): ${WIF_C}`, WIF_C], [`clé privée bitcoin ${WIF_U}`, WIF_U],
    [`my phantom wallet private key export: ${SOL.slice(0, 87)}`, SOL.slice(0, 87)], [`solana keypair (private key) ${BYTES}`, BYTES.slice(1, 40)],
  ] as const) {
    const out = scrubUserMessage(s);
    assert.ok(!out.includes(v) && out.includes(MASK_CAUTION), out);
  }
  // 9/11 au soir : « export » ne met plus en alerte ; la clé base58 désignée par « phantom wallet » est masquée hors alerte
  const exported = scrubUserMessage(`my phantom wallet export: ${SOL.slice(0, 87)}`);
  assert.ok(!exported.includes(SOL.slice(0, 87)) && exported.includes(MASK_KEY), exported);
  // hors alerte, rien ne change (une signature de transaction Solana a aussi 87–88 caractères)
  for (const s of [`signature ${SOL}`, `wif ${WIF_C}`, `bytes ${BYTES}`]) assert.equal(scrubSecrets(s), s);
});

test("9/11 : phrase collée par « + » ou « . » (même sans mention) ; caractères invisibles dans les mots : masquée", () => {
  const W = english.slice(100, 112);
  // (9/11 au soir : « seed » seul ne met plus en alerte ; « seed phrase » si)
  for (const s of [W.join("+"), W.join("."), `ma seed phrase : ${W.slice(0, 8).join(".")}`, W.map((w) => `${w.slice(0, 2)}​${w.slice(2)}`).join(" "), W.map((w) => `${w.slice(0, 1)}­${w.slice(1)}`).join(" ")]) {
    const out = scrubUserMessage(s);
    assert.ok(out.includes(MASK_PHRASE) && !out.includes(W[5]!.slice(1)), out);
  }
  // clés de traduction, chaînes de propriétés, adresses web : laissées, avec ou sans alerte
  for (const s of [
    `const STEP_KEYS = ["hunt.step.key", "hunt.step.replay", "hunt.step.accepted", "hunt.step.paid"] as const;`,
    "this.state.value.length", "ma clé privée : voir https://docs.example.com/wallet/export.html", "a+b+c",
    `hors alerte, 8 mots collés : ${W.slice(0, 8).join(".")}`,
  ]) assert.equal(scrubUserMessage(s), s, s);
});

test("9/11 : CONVERSATION en mode alerte (scrubConversation) — un message de l'utilisateur qui parle de secret met toute la conversation en alerte", () => {
  const W = english.slice(100, 124);
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string) => ({ role: "assistant", content });
  // phrase de 12 mots coupée 4 + 4 + 4 entre trois messages, chacun seul sur sa ligne
  const parts = parseParts([u("je vais vous donner ma phrase de récupération en trois fois"), u(W.slice(0, 4).join(" ")), a("ok"), u(`- ${W.slice(4, 8).join(" ")}`), u(`suite :\n${W.slice(8, 12).join(" ")}.`)]);
  assert.ok(parts.alert);
  assert.deepEqual(parts.messages.map((m) => m.content), [
    "je vais vous donner ma phrase de récupération en trois fois", MASK_PHRASE, "ok", `- ${MASK_PHRASE}`, `suite :\n${MASK_PHRASE}.`,
  ]);
  // 24 mots coupés 12 + 12
  const two = parseParts([u(`my seed words, first half:\n${W.slice(0, 12).join(" ")}`), u(`second half:\n${W.slice(12, 24).join(" ")}`)]);
  assert.ok(two.messages.every((m) => m.content.includes(MASK_PHRASE) && !m.content.includes(W[3]!) && !m.content.includes(W[15]!)));
  // la réponse du modèle passe aussi par le filtre sévère, mais ne déclenche jamais l'alerte
  assert.equal(conversationAlert([a("Never paste your private key or seed phrase here."), u(`hash 0x${K64}`)]), false);
  const al = scrubConversation([u("is my private key safe?"), a(`your tx 0x${K64}`), u("and this one?")]);
  assert.ok(al.alert && al.messages[1]!.content === `your tx ${MASK_CAUTION}`);
  // idempotent
  const again = scrubConversation(parts.messages);
  assert.deepEqual(again.messages, parts.messages);
});

test("9/11 : CONVERSATION en mode alerte — pas de faux positif sur une vraie conversation (anglais et français, questions courtes)", () => {
  const en = [
    "I think I lost my seed phrase, what can I do?", "Can you help?", "What about this?", "Any other way?", "you have any other idea?",
    "Then what?", "Where is the bounty page?", "How much does a private session cost per request?", "Show me the hive.",
    "Can you check my balance on Arc?", "What is a seed phrase and why should I never paste it into a chat or a website form?",
    "My wallet is 0x5724d89D610c3017b8DC161c025248341556f6Ab", "ok thanks", "Is my private key stored anywhere?",
  ];
  const fr = [
    "J'ai peur d'avoir exposé ma clé privée.", "Que dois-je faire ?", "Comment créer un nouveau wallet ?", "Et pour la caution d'opérateur ?",
    "Montre-moi la ruche.", "Combien coûte une session privée ?", "Ma phrase de récupération est-elle en sécurité si je la garde dans un coffre ?",
  ];
  for (const conv of [en, fr, [...fr, ...en]]) {
    const msgs = conv.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));
    const out = scrubConversation(msgs);
    assert.ok(out.alert);
    assert.deepEqual(out.messages, msgs);
  }
});

/** scrubConversation de messages { role, content }. */
function parseParts(messages: Array<{ role: string; content: string }>) {
  return scrubConversation(messages);
}

// ---------------------------------------------------------------- preuve secrets-new du vérificateur (9/11 au soir)

const TXH = "0x9f2c4e1b7a3d58c6e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7";
const XPRV = "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
const ZPRV = "zprvAWgYBBk7JR8Gj6uAb6N9JvjCU9kwtKoz7EugoYvNqqnVTXwPj8vPjDZTJXGn7FJqLgaA9CHZtnYDYWW2CmEGSPBHn3T5XxR4tmyS9KSsnuz";
const XPUB = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

test("9/11 au soir : mode NORMAL — un hachage de transaction reste lisible, réponses du modèle comprises (« key registration », « Transaction of wallet 0x…: », « enclave key »)", () => {
  for (const s of [
    `the transaction for your key registration: ${TXH}`,
    `Transaction of wallet 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B: ${TXH}`,
    `Latest transaction of the wallet 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B: ${TXH}`, // mot coupé par la fenêtre
    `enclave key: ${TXH}`,
    `Your enclave's key: ${TXH}`,
    `La clé de l'enclave : ${TXH}`,
    `key of the enclave: ${TXH}`,
    `Clé enregistrée. Transaction d'inscription de la clé : ${TXH}`,
    `Here is your wallet's last transaction: ${TXH}`,
    `Transaction ${TXH} from wallet 0x5724d89D610c3017b8DC161c025248341556f6Ab`,
    `{"enclaveKey":"${TXH}"}`,
  ]) {
    assert.equal(scrubSecrets(s), s, s);
    assert.equal(scrubUserMessage(s), s, s); // sans mention précise : pas d'alerte
  }
});

test("9/11 au soir : mode NORMAL — un mot ambigu (clé, key, wallet, MetaMask…) désigne encore un secret quand rien de public ne l'entoure", () => {
  const H = "9c4f1e2d" + "ab".repeat(28);
  for (const s of [
    `voici ma clé : 0x${H}`, `mon wallet 0x${H}`, `my key: 0x${H}`, `Here is my key.\n0x${H}`, `{"keys":["0x${H}"]}`,
    `mon export MetaMask : 0x${H}`, `exported from my metamask: ${H}`, `wallet key: 0x${H}`,
    `Voici ma clé que j'ai exportée hier soir depuis MetaMask sur mon ordinateur portable : 0x${H}`,
    `the tx hash is below. My key: 0x${H}`, // le mot public est dans une autre phrase
  ]) {
    const out = scrubSecrets(s);
    assert.ok(!out.includes(H.slice(8, 40)) && out.includes(MASK_KEY), `fuite : ${out}`);
  }
  // clé hexadécimale en groupes et clé base58 désignées par un mot secret, hors alerte ; laissées sans libellé secret
  for (const s of [`my metamask key: ${grouped(K64, 4)}`, `seed : ${grouped(K64, 2, ":")}`, `secret: ${grouped(K64, 8, "\n")}`]) {
    const out = scrubSecrets(s);
    assert.ok(keyGone(out) && out.includes(MASK_KEY), `fuite : ${out}`);
  }
  for (const [s, v] of [[`phantom export: ${SOL}`, SOL], [`my wallet: ${WIF_C}`, WIF_C]] as const) {
    const out = scrubSecrets(s);
    assert.ok(!out.includes(v) && out.includes(MASK_KEY), out);
  }
  for (const s of [`checksum ${grouped(K64, 4)}`, `signature ${SOL}`, `my wallet's last signature: ${SOL}`, `tx ${grouped(K64, 4)}`]) assert.equal(scrubSecrets(s), s, s);
});

test("9/11 au soir : clés étendues BIP-32 privées (xprv, zprv, tprv…) masquées dans tous les modes ; xpub lisible", () => {
  const TPRV = `tprv${XPRV.slice(4)}`;
  for (const k of [XPRV, ZPRV, TPRV, `yprv${XPRV.slice(4)}`, `Zprv${XPRV.slice(4)}`]) {
    for (const s of [k, `my wallet master private key is ${k}`, `{"backup":"${k}"}`, `electrum: ${k} ok`]) {
      for (const out of [scrubSecrets(s), scrubUserMessage(s)]) {
        assert.ok(!out.includes(k.slice(0, 30)) && out.includes(MASK_KEY), out);
      }
    }
  }
  assert.ok(mentionsSecret(`backup: ${XPRV}`) && mentionsSecret("my zprv") && mentionsSecret("is a tprv safe to share?"));
  for (const s of [XPUB, `my xpub ${XPUB}`]) {
    assert.equal(scrubSecrets(s), s);
    assert.equal(mentionsSecret(s), false);
  }
});

test("9/11 au soir : l'ALERTE ne se déclenche que sur des formulations précises (pas sur « export », « seed », « secret key » seuls)", () => {
  for (const s of [
    "how do I export my wallet history to CSV?", "I want to seed the liquidity pool", "can the ledger export my transactions?",
    "what is a secret key in RSA?", "export my metamask transactions", "the signing key of the enclave", "seed round of the project",
    "clé secrète AES", "mots secrets du jeu", "a passphrase for my wifi",
  ]) {
    assert.equal(mentionsSecret(s), false, s);
    const conv = scrubConversation([{ role: "user", content: s }, { role: "assistant", content: "sure" }, { role: "user", content: `what happened in tx ${TXH}?` }]);
    assert.equal(conv.alert, false, s);
    assert.ok(conv.messages[2]!.content.includes(TXH), s);
  }
  for (const s of [
    "my private key", "ma clé privée", "clefs privées", "privateKey", "PRIVATE_KEY", "my seed phrase", "seedphrase", "recovery phrase",
    "Secret Recovery Phrase", "ma phrase de récupération", "phrase secrète de récupération", "phrase mnémonique", "my mnemonic",
    "backup phrase", "recovery words", "mots de récupération", "my xprv", "zprv please",
  ]) assert.ok(mentionsSecret(s), s);
});

test("9/11 au soir : ALERTE — clé coupée 32 + 32 entre deux messages (la 1re moitié dès le 1er message) ; adresse et petits nombres lisibles", () => {
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string) => ({ role: "assistant", content });
  // les deux moitiés, dans une même conversation
  const two = scrubConversation([u(`my private key starts with ${K64.slice(0, 32)}`), a("ok"), u(`and ends with ${K64.slice(32)}`)]);
  assert.ok(two.alert);
  assert.deepEqual(two.messages.map((m) => m.content), [`my private key starts with ${MASK_CAUTION}`, "ok", `and ends with ${MASK_CAUTION}`]);
  // la 1re requête ne porte que la 1re moitié : déjà masquée
  assert.equal(scrubConversation([u(`my private key starts with 0x${K64.slice(0, 32)}`)]).messages[0]!.content, `my private key starts with ${MASK_CAUTION}`);
  // en 4 morceaux de 16, en groupes, dans un seul message
  const four = scrubUserMessage(`private key, part 1: ${K64.slice(0, 16)} part 2: ${grouped(K64.slice(16, 32), 4)} then ${K64.slice(32, 48)} and ${K64.slice(48)}`);
  assert.ok(keyGone(four) && !four.includes(K64.slice(48)), four);
  // restent lisibles en alerte : une adresse, un sélecteur, un petit nombre, une table de chiffres
  for (const s of [
    "private key? not shared. Balance of 0x5724d89D610c3017b8DC161c025248341556f6Ab ?", "my private key: no. selector 0xa9059cbb",
    "private key lost at block 71389302, nonce 12", "clé privée : 1234 5678 9012 3456 7890",
  ]) assert.equal(scrubUserMessage(s), s, s);
  // idempotent
  assert.deepEqual(scrubConversation(two.messages).messages, two.messages);
});
