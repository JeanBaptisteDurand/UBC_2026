/** i18n.ts — la langue du copilote (anglais ou français) : le champ `lang` de POST /chat (choisi sur le site), sinon la
 *  langue du dernier message de l'utilisateur (détectée), sinon l'en-tête Accept-Language, sinon l'anglais (le hackathon
 *  se juge en anglais). Le copilote répond dans cette langue, refus et messages d'action compris ; sa base de
 *  connaissances et ses outils restent en français (le modèle traduit), mais il cite les pages et les boutons du site sous
 *  leur nom dans la langue choisie (PAGES, BUTTONS : repris de web/src/i18n/{en,fr}.ts le 9/11 ; à tenir alignés). */

export type Lang = "en" | "fr";
export const LANGS: readonly Lang[] = ["en", "fr"];
/** Sans aucun indice : l'anglais. */
export const DEFAULT_LANG: Lang = "en";

/** "en", "fr", "en-US", "FR_fr"… → la langue ; tout le reste → undefined. */
export function parseLang(x: unknown): Lang | undefined {
  if (typeof x !== "string") return undefined;
  const m = /^\s*(en|fr)(?:[-_][a-z0-9]{1,8})*\s*$/i.exec(x);
  return m ? (m[1]!.toLowerCase() as Lang) : undefined;
}

/** Accept-Language (« fr-FR,fr;q=0.9,en;q=0.8 ») → la première de nos langues, par préférence ; sinon undefined. */
export function langFromAcceptLanguage(h: string | null | undefined): Lang | undefined {
  if (!h || h.length > 512) return undefined;
  const items = h.split(",").map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
    return { lang: parseLang(tag), q: q === undefined ? 1 : Number(q), i };
  });
  const best = items.filter((x) => x.lang && Number.isFinite(x.q) && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i)[0];
  return best?.lang;
}

// ---------------------------------------------------------------- détection (mots fréquents propres à chaque langue)

const FR_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "que", "qui", "quoi", "pour", "dans", "avec", "sur", "pas", "ne", "mon", "ma", "mes", "ton", "ta", "tes", "ce", "cette",
  "ces", "comment", "combien", "pourquoi", "quel", "quelle", "quels", "quelles", "bonjour", "bonsoir", "salut", "merci",
  "oui", "non", "veux", "voudrais", "peux", "pouvez", "faire", "fais", "faites", "montre", "montrez", "moi", "au", "aux",
  "ou", "sa", "ses", "leur", "leurs", "etre", "avoir", "aussi", "encore", "autre", "autres", "tout", "tous", "toutes",
  "liste", "lance", "lancer", "ouvre", "ouvrir", "prime", "primes", "cle", "cles", "ruche", "caution", "depuis", "vers",
  "chez", "sans", "tres", "bien", "alors", "donc", "mais", "parce", "quand", "ici", "voici", "voila", "explique",
  "expliquez", "aide", "aidez", "svp", "plait", "en", "y", "devenir", "operateur", "produit", "produits",
  "inscrire", "publier", "portefeuille", "chasser", "jetons", "requete", "solde", "mettre", "lien",
]);
const EN_WORDS = new Set([
  "the", "is", "are", "was", "were", "be", "been", "i", "you", "your", "we", "our", "they", "it", "this", "that", "these",
  "those", "what", "how", "why", "which", "where", "when", "who", "can", "could", "would", "should", "will", "do", "does",
  "did", "my", "show", "to", "of", "and", "in", "for", "with", "please", "hello", "hi", "hey", "thanks", "thank", "want",
  "need", "run", "private", "key", "keys", "bounty", "bounties", "post", "hive", "price", "prices", "product", "products",
  "operator", "become", "register", "at", "an", "if", "not", "yes", "there", "here", "about", "from", "into", "get", "give",
  "tell", "explain", "help", "list", "start", "create", "much", "many", "cost", "costs", "verify", "verified", "real",
  "let", "lets", "now", "go", "open", "take", "balance", "publish", "hunt", "tokens", "request",
]);
// (ni « wallet », ni « session », ni « machine », ni « me », ni « page » : les deux langues les emploient)

/** La langue d'un texte, si elle se voit (sinon undefined) : mots fréquents, accents et élisions françaises, contractions
 *  anglaises. */
export function detectLang(text: string): Lang | undefined {
  const s = text.slice(0, 4_000).toLowerCase();
  const accents = Math.min(3, (s.match(/[éèêàùçôîûëïœ]/g) ?? []).length);
  const elisions = (s.match(/\b(?:l|d|j|c|n|qu|s|m|t)['’][a-zà-ÿ]/g) ?? []).length;
  const contractions = (s.match(/\b[a-z]+['’](?:t|s|m|re|ve|ll|d)\b/g) ?? []).length;
  const words = s.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(Boolean);
  let fr = accents + elisions;
  let en = contractions;
  for (const w of words) {
    if (FR_WORDS.has(w)) fr++;
    else if (EN_WORDS.has(w)) en++;
  }
  if (fr === en) return undefined;
  return fr > en ? "fr" : "en";
}

/** Les derniers messages de l'utilisateur d'un corps de requête BRUT (même invalide), du plus récent au plus ancien. */
export function userTextsOf(body: unknown, max = 5): string[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (let i = raw.length - 1; i >= 0 && out.length < max; i--) {
    const m = raw[i] as { role?: unknown; content?: unknown } | null;
    if (m && typeof m === "object" && m.role === "user" && typeof m.content === "string") out.push(m.content);
  }
  return out;
}

/** La langue de la réponse : `lang` demandé, sinon celle du dernier message de l'utilisateur qui en montre une (les plus
 *  récents d'abord), sinon Accept-Language, sinon l'anglais. */
export function resolveLang(o: { requested?: unknown; userTexts?: readonly string[]; acceptLanguage?: string | null }): Lang {
  const asked = parseLang(o.requested);
  if (asked) return asked;
  for (const t of o.userTexts ?? []) {
    const d = detectLang(t);
    if (d) return d;
  }
  return langFromAcceptLanguage(o.acceptLanguage) ?? DEFAULT_LANG;
}

// ---------------------------------------------------------------- les noms du site

export type PageId =
  | "vue" | "ruche" | "produits" | "primes" | "playground" | "cles" | "publier-prime" | "operateur" | "publier-produit"
  | "portefeuille" | "developpeurs";

/** Les pages du site dans chaque langue (web/src/i18n : nav.*). */
export const PAGES: Record<Lang, Record<PageId, string>> = {
  en: {
    vue: "Overview", ruche: "Hive", produits: "Products", primes: "Bounties", playground: "Private AI", cles: "Keys & sessions",
    "publier-prime": "Post a bounty", operateur: "Operator", "publier-produit": "Publish a product", portefeuille: "Wallet",
    developpeurs: "Developers",
  },
  fr: {
    vue: "Vue d'ensemble", ruche: "Ruche", produits: "Produits", primes: "Primes", playground: "IA privée", cles: "Clés et sessions",
    "publier-prime": "Publier une prime", operateur: "Opérateur", "publier-produit": "Publier un produit", portefeuille: "Portefeuille",
    developpeurs: "Développeurs",
  },
};

/** Les boutons que le copilote cite le plus (web/src/i18n : keys.*, op.*, action.sign, bounties.*, pub.go, wallet.cctp.title). */
export const BUTTONS: Record<Lang, string[]> = {
  en: [
    "Create a key", "Top up", "Change key", "Close", "Create an operator key", "Post the bond", "Approve with my wallet",
    "Register", "Register the enclave", "Debug with the copilot", "Your machines", "Sign with my wallet", "Hunt",
    "Post a bounty", "Publish the product", "Bring USDC over to Arc",
  ],
  fr: [
    "Créer une clé", "Recharger", "Changer de clé", "Clore", "Créer une clé opérateur", "Déposer la caution",
    "Approuver avec mon wallet", "Inscrire", "Inscrire l'enclave", "Déboguer avec le copilote", "Vos machines",
    "Signer avec mon wallet", "Chasser", "Publier une prime", "Publier le produit", "Rapatrier de l'USDC vers Arc",
  ],
};

const pageList = (l: Lang) => (Object.entries(PAGES[l]) as Array<[PageId, string]>).map(([id, name]) => `${name} [${id}]`).join(", ");

/** La phrase anglaise qui explique les marques du filtre de secrets (consigne de langue de la console et du site). */
export const MASKED_NOTE_EN = "Masked values in messages — « [clé masquée] », « [phrase de récupération masquée] », « [valeur masquée par prudence] » — mean a masked key, a masked recovery phrase and a value (hexadecimal or base58) masked as a precaution because the conversation talks about private keys or recovery phrases: say so in English. Be brief and polite.";

/** La consigne de langue, ajoutée à la FIN de l'invite système (elle prime sur ce qui précède). */
export function languageDirective(lang: Lang): string {
  if (lang === "en") {
    return [
      "LANGUAGE (overrides everything above): the user's language is ENGLISH. Write every reply in English only — answers, refusals, warnings, summaries of prepared actions, questions about missing information (aCompleter) and error explanations — even if the user writes in another language.",
      "The instructions above, the knowledge base (docs_search) and the tool results are in French: translate what you use, never paste French sentences.",
      `When you name a page or a button of the site, use these English labels exactly (the identifiers in brackets are for ui_navigate only: never show them). Pages: ${pageList("en")}. Buttons: ${BUTTONS.en.map((b) => `"${b}"`).join(", ")}.`,
      MASKED_NOTE_EN,
    ].join("\n");
  }
  return [
    "LANGUE (prime sur tout ce qui précède) : l'utilisateur parle FRANÇAIS. Rédige toutes tes réponses en français — réponses, refus, avertissements, résumés des actions préparées, questions sur les informations manquantes (aCompleter), explications d'erreurs — même s'il écrit dans une autre langue. Vouvoie l'utilisateur.",
    `Quand tu nommes une page ou un bouton du site, emploie exactement ces libellés (les identifiants entre crochets servent seulement à ui_navigate : ne les montre jamais). Pages : ${pageList("fr")}. Boutons : ${BUTTONS.fr.map((b) => `« ${b} »`).join(", ")}.`,
  ].join("\n");
}

// ---------------------------------------------------------------- les messages du serveur

export interface Messages {
  refused: (m: string) => string;
  originRefused: (origin: string) => string;
  rateMinute: (s: number) => string;
  rateDay: (h: number) => string;
  jsonOnly: string;
  tooLarge: (kib: number, n: number) => string;
  badLength: string;
  badJson: string;
  noKey: string;
  globalCap: string;
  actionReady: string;
  pageShown: string;
  deadline: string;
  /** Budget d'entrée de la requête atteint avant la réponse finale (COPILOT_MAX_INPUT_CHARS, COPILOT_MAX_INPUT_TOKENS). */
  inputBudget: string;
  /** Copilote en enclave appelé sans le jeton du mandataire du site (403 proxy_required). */
  proxyRequired: string;
  /** Relance d'une réponse vide (consigne au modèle). */
  answerNow: string;
  model: { timeout: string; busy: string; outage: string; unavailable: string; refused: string; unreachable: string; error: string };
  chat: {
    notObject: string; messagesArray: string; messageObject: (i: number) => string; role: (i: number, r: string) => string;
    nonText: (i: number) => string; lastNotUser: string; empty: string;
  };
  sealed: { unavailable: string; malformed: string; undecryptable: string };
}

const FR: Messages = {
  refused: (m) => `Requête refusée : ${m}.`,
  originRefused: (o) => `origine refusée : ${o} (ALLOWED_ORIGINS)`,
  rateMinute: (s) => `trop de questions d'affilée : réessayez dans ${s} s`,
  rateDay: (h) => `quota du jour atteint pour votre adresse IP : réessayez dans ${h} h`,
  jsonOnly: "content-type: application/json attendu",
  tooLarge: (kib, n) => `requête trop grande (${kib} Kio au plus) : envoyez les ${n} derniers messages seulement`,
  badLength: "Content-Length invalide",
  badJson: "JSON invalide",
  noKey: "Pas de clé OPENAI_API_KEY configurée.",
  globalCap: "le copilote a atteint son plafond de requêtes du jour : réessayez plus tard",
  actionReady: "J'ai préparé l'action ci-dessous : vérifiez-la, puis signez avec votre wallet. Rien n'est dépensé sans votre signature.",
  pageShown: "Voici la page concernée.",
  deadline: "Je n'ai pas pu terminer dans le délai imparti : réessayez, ou posez une question plus simple.",
  inputBudget: "Cette demande a atteint la limite de lecture d'une requête : je m'arrête ici. Posez une question plus précise, ou en plusieurs fois.",
  proxyRequired: "ce copilote en enclave ne répond qu'au travers du site (son mandataire) : passez par l'adresse du site",
  answerNow: "Réponds maintenant à l'utilisateur, en français, en texte, en deux ou trois phrases.",
  model: {
    timeout: "Le modèle n'a pas répondu à temps : réessayez dans un instant, ou posez une question plus simple.",
    busy: "Le modèle est saturé en ce moment : réessayez dans une minute.",
    outage: "Le fournisseur du modèle a une panne en ce moment : réessayez dans quelques minutes.",
    unavailable: "Le modèle est momentanément indisponible : réessayez plus tard.",
    refused: "Le modèle a refusé la requête : posez une question plus courte, ou rechargez la conversation.",
    unreachable: "Le fournisseur du modèle est injoignable : réessayez dans quelques minutes.",
    error: "Le copilote a rencontré une erreur : réessayez dans un instant.",
  },
  chat: {
    notObject: "objet JSON { messages, user } attendu",
    messagesArray: "messages : tableau non vide attendu",
    messageObject: (i) => `message ${i} : objet { role, content } attendu`,
    role: (i, r) => `message ${i} : rôle « ${r} » refusé (seuls user et assistant sont acceptés)`,
    nonText: (i) => `message ${i} : contenu non textuel refusé (texte seulement)`,
    lastNotUser: "le dernier message doit venir de l'utilisateur",
    empty: "message vide",
  },
  sealed: {
    unavailable: "conversation chiffrée indisponible : ce copilote ne tourne pas dans une enclave",
    malformed: "enveloppe chiffrée invalide (attendu { sealed, enc de 32 octets, ciphertext } en hexadécimal)",
    undecryptable: "conversation indéchiffrable par cette enclave (clé renouvelée ? revérifiez sa clé sur Arc)",
  },
};

const EN: Messages = {
  refused: (m) => `Request refused: ${m}.`,
  originRefused: (o) => `origin refused: ${o} (ALLOWED_ORIGINS)`,
  rateMinute: (s) => `too many questions in a row: try again in ${s} s`,
  rateDay: (h) => `daily quota reached for your IP address: try again in ${h} h`,
  jsonOnly: "content-type: application/json expected",
  tooLarge: (kib, n) => `request too large (${kib} KiB at most): send only the last ${n} messages`,
  badLength: "invalid Content-Length",
  badJson: "invalid JSON",
  noKey: "No OPENAI_API_KEY configured.",
  globalCap: "the copilot has reached its daily request cap: try again later",
  actionReady: "I prepared the action below: check it, then sign with your wallet. Nothing is spent without your signature.",
  pageShown: "Here is the relevant page.",
  deadline: "I couldn't finish in time: try again, or ask a simpler question.",
  inputBudget: "This request reached the per-request reading limit, so I stopped here. Ask a more specific question, or split it into several.",
  proxyRequired: "this enclave copilot only answers through the site (its proxy): use the site's address",
  answerNow: "Answer the user now, in English, in plain text, in two or three sentences.",
  model: {
    timeout: "The model didn't answer in time: try again in a moment, or ask a simpler question.",
    busy: "The model is overloaded right now: try again in a minute.",
    outage: "The model provider has an outage right now: try again in a few minutes.",
    unavailable: "The model is temporarily unavailable: try again later.",
    refused: "The model refused the request: ask a shorter question, or reload the conversation.",
    unreachable: "The model provider can't be reached: try again in a few minutes.",
    error: "The copilot ran into an error: try again in a moment.",
  },
  chat: {
    notObject: "JSON object { messages, user } expected",
    messagesArray: "messages: non-empty array expected",
    messageObject: (i) => `message ${i}: object { role, content } expected`,
    role: (i, r) => `message ${i}: role “${r}” refused (only user and assistant are accepted)`,
    nonText: (i) => `message ${i}: non-text content refused (text only)`,
    lastNotUser: "the last message must come from the user",
    empty: "empty message",
  },
  sealed: {
    unavailable: "encrypted conversation unavailable: this copilot is not running in an enclave",
    malformed: "invalid encrypted envelope (expected { sealed, 32-byte enc, ciphertext } in hexadecimal)",
    undecryptable: "this enclave can't decrypt the conversation (key renewed? verify its key on Arc again)",
  },
};

export const MESSAGES: Record<Lang, Messages> = { en: EN, fr: FR };
export const T = (lang: Lang): Messages => MESSAGES[lang];
