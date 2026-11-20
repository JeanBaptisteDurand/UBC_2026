/** sdk-messages.en.ts — English for the French messages that reach the site from elsewhere: the SDK (the French
 *  texts packages/sdk keeps for this console, and those of its earlier versions), the enclaves (refusal reasons)
 *  and, as a fallback, the ArcHive API
 *  (services/api: its errors carry a stable code, translated first by api-errors.ts; these rules serve an API
 *  without codes, during a deployment). Used in English only: in French the original text is shown. Each rule
 *  matches a whole message; a rule can translate the inner part again (`en`). A message no rule knows is shown as
 *  it came. */

type Rule = [RegExp, string | ((m: RegExpExecArray) => string)];

const ADDR = "(0x[0-9a-fA-F]+)";

/** what the API rate-limits (« trop de requêtes (…) ») */
const LIMITED: Record<string, string> = {
  "attente d'appairage": "pairing polls", battements: "heartbeats", "battements de cette clé": "heartbeats for this key",
  "demandes de code": "code requests", "demandes de nonce": "nonce requests", "lectures de clés": "key reads",
  "lectures signées": "signed reads", "recherches de code": "code lookups", "refus d'appairage": "pairing refusals",
  signatures: "signatures", "signatures de ce compte": "signatures for this account",
  "lectures signées de ce compte": "signed reads for this account",
  "nouvelles lectures signées de ce compte": "new signed reads for this account", "signatures invalides": "invalid signatures",
};

/** what is wrong in a malformed signed message (« message signé mal formé : … ») */
const MALFORMED: Rule[] = [
  [/^le format EIP-4361 \(« Sign-In with Ethereum »\) du site est attendu, en (\d+) lignes ; rechargez la page et signez à nouveau$/, "the site's EIP-4361 (Sign-In with Ethereum) format is expected, in $1 lines; reload the page and sign again"],
  [/^1re ligne « <site> wants you to sign in with your Ethereum account: » attendue$/, "first line “<site> wants you to sign in with your Ethereum account:” expected"],
  [/^une ligne vide est attendue avant et après la phrase de l'action$/, "a blank line is expected before and after the action's statement"],
  [/^ligne « (URI: \S+|Version: 1) » attendue$/, "line “$1” expected"],
  [/^ligne « Nonce: <nonce de GET \/auth\/nonce> » attendue$/, "line “Nonce: <nonce from GET /auth/nonce>” expected"],
  [/^ligne « (Issued At|Expiration Time): <date RFC 3339> » attendue \(par exemple (\S+)\)$/, "line “$1: <RFC 3339 date>” expected (for example $2)"],
  [/^« Expiration Time » doit suivre « Issued At » de (\d+) minutes au plus$/, "“Expiration Time” must come at most $1 minutes after “Issued At”"],
];
const malformedEn = (detail: string): string => {
  for (const [re, out] of MALFORMED) {
    const m = re.exec(detail);
    if (m) return typeof out === "string" ? detail.replace(re, out) : out(m);
  }
  return detail;
};

const RULES: Rule[] = [
  // ---- SDK: enclave key checks (enclave-keys.ts)
  [/^(.+)\/pubkeys injoignable : (.*)$/s, "$1/pubkeys unreachable: $2"],
  [/^\/pubkeys ne donne pas d'adresse de signataire valide$/, "/pubkeys doesn't give a valid signer address"],
  [/^\/pubkeys ne donne pas de clé X25519 de 32 octets$/, "/pubkeys doesn't give a 32-byte X25519 key"],
  [/^session #(\d+) inconnue de SessionPay$/, "session #$1 is unknown to SessionPay"],
  [/^la session #(\d+) est du produit #(\d+), pas du produit #(\d+)$/, "session #$1 is for product #$2, not product #$3"],
  [new RegExp(`^le signataire ${ADDR} annoncé par /pubkeys n'est inscrit dans aucune enclave d'Arc$`), "the signer $1 announced by /pubkeys isn't registered as any enclave on Arc"],
  [new RegExp(`^l'enclave ${ADDR} est inscrite pour le produit #(\\d+), pas pour le produit #(\\d+)$`), "enclave $1 is registered for product #$2, not product #$3"],
  [new RegExp(`^/pubkeys annonce la clé X25519 ${ADDR}, la chaîne a inscrit ${ADDR} pour ${ADDR}$`), "/pubkeys announces X25519 key $1, the chain registered $2 for $3"],
  [new RegExp(`^l'enclave ${ADDR} n'est pas active pour le produit #(\\d+) au bloc (\\d+) \\(expirée, retirée ou invalidée\\)$`), "enclave $1 isn't active for product #$2 at block $3 (expired, retired or invalidated)"],
  [new RegExp(`^la session est verrouillée sur l'enclave ${ADDR}, (\\S+) sert ${ADDR}$`), "the session is locked to enclave $1; $2 serves $3"],
  [new RegExp(`^l'enclave ${ADDR} est active pour l'opérateur ${ADDR}, la session attend ${ADDR}$`), "enclave $1 is active for operator $2; the session expects $3"],
  [/^clés d'enclave non vérifiées on-chain \(verifyEnclaveKeys d'abord\)$/, "enclave keys not verified on-chain (call verifyEnclaveKeys first)"],
  // ---- SDK: attested copilot (copilot.ts), what must hold NOW at the same block (EnclaveRegistry.attestedOperator)
  [/^le produit #(\d+) n'est pas actif au bloc (\d+)$/, "product #$1 isn't active at block $2"],
  [new RegExp(`^l'image de l'enclave ${ADDR} \\((0x[0-9a-fA-F]+)\\) n'est plus autorisée par le produit #(\\d+)$`), "the image of enclave $1 ($2) is no longer allowed by product #$3"],
  [new RegExp(`^l'opérateur ${ADDR} de l'enclave ${ADDR} est radié$`), "operator $1 of enclave $2 is struck off"],

  // ---- SDK: client.ts checks before sending
  [/^walletClient\/account requis pour cette action$/, "a connected wallet is required for this action"],
  [/^\/attest : HTTP (\d+) (.*)$/s, (m) => `/attest: HTTP ${m[1]} ${m[2] === "réponse incomplète" ? "incomplete response" : m[2]}`],
  [/^quote simulé : cette machine n'a pas Intel TDX ; le registre \(vérification DCAP d'Intel\) le refuserait$/, "simulated quote: this machine has no Intel TDX; the registry (Intel's DCAP verification) would refuse it"],
  [/^enclave en mode DEBUG : le registre la refuserait \(DebugEnclave\)$/, "enclave in DEBUG mode: the registry would refuse it (DebugEnclave)"],
  [/^SEPT_VE_DISABLE absent du quote : le registre le refuserait \(SeptVeNotDisabled\)$/, "SEPT_VE_DISABLE missing from the quote: the registry would refuse it (SeptVeNotDisabled)"],
  [/^image non autorisée pour le produit #(\d+) : (.*?) \(l'auteur du produit doit la proposer puis l'appliquer : proposeWorkload → applyWorkload\)$/s,
    (m) => `image not allowed for product #${m[1]}: ${m[2]!.split(" ; ").map(toEnglish).join("; ")} (the product's author must propose then apply it: proposeWorkload → applyWorkload)`],
  [new RegExp(`^empreinte d'image ${ADDR} \\(stable d'un redémarrage à l'autre\\)$`), "image fingerprint $1 (stable across restarts)"],
  [/^journal RTMR3 absent ou illisible dans \/attest$/, "RTMR3 event log missing or unreadable in /attest"],
  [/^le journal RTMR3 ne redonne pas le RTMR3 du quote$/, "the RTMR3 event log doesn't reproduce the quote's RTMR3"],
  [/^image non reconnue dans le journal \(compose-hash ou os-image-hash manquant ou ambigu\)$/, "image not recognized in the event log (compose-hash or os-image-hash missing or ambiguous)"],
  [/^le rejeu du registre diffère du rejeu local : journal non transmis$/, "the registry's replay differs from the local one: event log not sent"],
  [new RegExp(`^l'empreinte d'image ${ADDR} n'est pas autorisée par le produit$`), "image fingerprint $1 isn't allowed by the product"],
  [/^REPORTDATA ne lie pas \(chaîne, registre, produit, opérateur, clés\) : l'enclave sert un autre produit ou un autre registre \(ReportDataMismatch\)$/, "REPORTDATA doesn't bind (chain, registry, product, operator, keys): the enclave serves another product or another registry (ReportDataMismatch)"],
  [/^échéance de session : entre (\d+) min et (\d+) jours \(SessionPay v2 refuse sinon : BadExpiry\)$/, "session expiry: between $1 min and $2 days (SessionPay v2 refuses otherwise: BadExpiry)"],
  [new RegExp(`^(\\S+) sert l'enclave ${ADDR}, pas ${ADDR}$`), "$1 serves enclave $2, not $3"],
  [new RegExp(`^l'enclave ${ADDR} n'est pas active pour le produit #(\\d+) \\(InactiveEnclave\\)$`), "enclave $1 isn't active for product #$2 (InactiveEnclave)"],
  [new RegExp(`^l'opérateur ${ADDR} a (\\d+) enclaves actives sur le produit #(\\d+) : donnez enclaveUrl \\(ou enclave\\) pour choisir celle qui servira la session$`), "operator $1 has $2 active enclaves on product #$3: pass enclaveUrl (or enclave) to pick the one that will serve the session"],
  [new RegExp(`^l'opérateur ${ADDR} n'a aucune enclave active sur le produit #(\\d+)$`), "operator $1 has no active enclave on product #$2"],
  [/^v2 : une session est verrouillée sur une enclave : donnez enclaveUrl \(clés vérifiées on-chain\) ou enclave \(signataire\)$/, "v2: a session is locked to one enclave: pass enclaveUrl (keys verified on-chain) or enclave (signer)"],
  [new RegExp(`^l'enclave ${ADDR} est active pour l'opérateur ${ADDR}, pas pour ${ADDR} \\(WrongOperator\\)$`), "enclave $1 is active for operator $2, not $3 (WrongOperator)"],
  [/^session #(\d+) inconnue$/, "session #$1 unknown"],
  [/^paliers : listes non vides et de même taille, premier montant > 0 \(BadTiers\)$/, "tiers: non-empty lists of the same length, first amount > 0 (BadTiers)"],
  [/^paliers : seuils ET montants strictement croissants \(BadTiers\)$/, "tiers: thresholds AND amounts strictly increasing (BadTiers)"],
  [/^k : entre 1 et (\d+) \(BadK\)$/, "k: between 1 and $1 (BadK)"],
  [/^prime #(\d+) inexistante$/, "bounty #$1 doesn't exist"],
  [/^payee requis \(ou un compte\)$/, "payee required (or an account)"],
  [new RegExp(`^acceptClaim annulée on-chain \\(${ADDR}\\) : rien n'est réservé, cP n'a pas été publié$`), "acceptClaim was reverted on-chain ($1): nothing is reserved, cP wasn't published"],

  // ---- SDK: the hunter's checks (bounty.ts) and the enclave's refusal reasons
  [/^réclamation refusée avant envoi : (.*)$/s, (m) => `claim refused before sending: ${toEnglish(m[1]!)}`],
  [new RegExp(`^signée par ${ADDR}, pas par l'enclave vérifiée ${ADDR}$`), "signed by $1, not by the verified enclave $2"],
  [/^prime #(\d+) au lieu de #(\d+)$/, "bounty #$1 instead of #$2"],
  [new RegExp(`^bénéficiaire ${ADDR} au lieu de ${ADDR}$`), "payee $1 instead of $2"],
  [/^predicateHash différent de celui de l'exploit$/, "predicateHash differs from the exploit's"],
  [/^empreinte différente de celle de l'exploit$/, "fingerprint differs from the exploit's"],
  [/^le cP renvoyé n'est pas celui chiffré ici$/, "the cP sent back isn't the one encrypted here"],
  [/^bloc N (\d+) au lieu de (\d+)$/, "block N $1 instead of $2"],
  [/^échéance (\d+) au lieu de (\d+)$/, "deadline $1 instead of $2"],
  [/^(\S+)\/bounty\/submit : réponse non JSON \(HTTP (\d+)\) : (.*)$/s, "$1/bounty/submit: non-JSON response (HTTP $2): $3"],
  [/^(\S+)\/bounty\/submit : HTTP (\d+) (.*)$/s, "$1/bounty/submit: HTTP $2 $3"],
  [/^non prouvé par l'enclave : (.*)$/s, (m) => `not proven by the enclave: ${toEnglish(m[1]!)}`],
  [/^cE indéchiffrable par cette enclave \(mauvaise clé X25519 \?\)$/, "the enclave couldn't decrypt the submission (wrong X25519 key?)"],
  [/^bundle illisible : (.*)$/s, "unreadable bundle: $1"],
  [/^predicateHash ne correspond pas à la prime$/, "predicateHash doesn't match the bounty"],
  [/^cP non reproductible$/, "cP couldn't be reproduced"],
  [/^bloc N (\d+) refusé : il doit être dans (.*)$/s, (m) => `block N ${m[1]} refused: it must be in ${m[2]!.replace(/tête/g, "head")}`],
  [/^échéance (\d+) refusée : elle doit être dans (.*)$/s, (m) => `deadline ${m[1]} refused: it must be in ${m[2]!.replace(/maintenant/g, "now")}`],
  [/^prédicat non satisfait$/, "loss rule not met"],
  [/^perte sous le plus bas palier$/, "loss below the lowest tier"],
  [/^une autre réclamation a déjà été signée par cette enclave pour cette empreinte \(une enclave ne signe jamais deux réclamations différentes pour la même empreinte\)$/, "another claim was already signed by this enclave for this fingerprint (an enclave never signs two different claims for the same fingerprint)"],
  [/^réclamation déjà signée par cette enclave pour cette empreinte avec bloc N (\d+) et échéance (\d+) : redemander avec ces valeurs \(une enclave ne signe jamais deux réclamations différentes pour la même empreinte\)$/, "claim already signed by this enclave for this fingerprint with block N $1 and deadline $2: ask again with these values (an enclave never signs two different claims for the same fingerprint)"],

  // ---- SDK: inference client (inference.ts)
  [/^session #(\d+) close$/, "session #$1 closed"],
  [new RegExp(`^la clé de session fournie \\(${ADDR}\\) n'est pas celle de la session #(\\d+) \\(${ADDR}\\) : clé tournée ou erronée$`), "the session key given ($1) isn't the key of session #$2 ($3): key changed or wrong"],
  [/^aucune réponse en attente$/, "no answer waiting"],
  [/^une réponse déjà calculée attend \(seq (\d+)\) : rechargez la session puis rejouez la même requête \(retryPending\)$/, "an answer is already computed and waiting (seq $1): top up the session, then replay the same request (retryPending)"],
  [/^session #(\d+) plus servie : (.*)$/s, (m) => `session #${m[1]} is no longer served: ${m[2] === "close ou échue" ? "closed or expired" : toEnglish(m[2]!)}`],
  [/^inférence refusée par l'enclave \(403\) : (.*)$/s, "inference refused by the enclave (403): $1"],
  [/^inférence : (\d+) (.*)$/s, "inference: $1 $2"],
  [/^réponse refusée : (.*)$/s, (m) => `answer refused: ${toEnglish(m[1]!)}`],
  [new RegExp(`^reçu signé par ${ADDR}, pas par l'enclave vérifiée ${ADDR}$`), "receipt signed by $1, not by the verified enclave $2"],
  [/^reçu de la session #(\d+) seq (\d+), requête #(\d+) seq (\d+)$/, "receipt for session #$1 seq $2, request #$3 seq $4"],
  [/^le reçu ne porte pas le hash de l'invite envoyée$/, "the receipt doesn't carry the hash of the prompt sent"],
  [/^le texte reçu n'est pas celui que l'enclave a signé$/, "the text received isn't the one the enclave signed"],
  [/^le reçu ne porte pas les paramètres envoyés$/, "the receipt doesn't carry the parameters sent"],
  [/^clé aek invalide$/, "invalid aek key"],
  [/^heure d'émission du nonce illisible : rechargez la page$/, "unreadable nonce issue time: reload the page"],

  // ---- copilot server (services/copilot): refusals and fallback replies, until it answers in the chosen `lang`
  [/^Requête refusée : (.*)\.$/s, (m) => `Request refused: ${toEnglish(m[1]!)}.`],
  [/^trop de questions d'affilée : réessayez dans (\d+) s$/, "too many questions in a row: try again in $1 s"],
  [/^quota du jour atteint pour votre adresse IP : réessayez dans (\d+) h$/, "daily quota reached for your IP address: try again in $1 h"],
  [/^le copilote a atteint son plafond de requêtes du jour : réessayez plus tard$/, "the copilot reached its daily request cap: try again later"],
  [/^requête trop grande \((\d+) Kio au plus\) : envoyez les (\d+) derniers messages seulement$/, "request too large ($1 KiB at most): send only the last $2 messages"],
  [/^origine refusée : (.*) \(ALLOWED_ORIGINS\)$/s, "origin refused: $1 (ALLOWED_ORIGINS)"],
  [/^content-type: application\/json attendu$/, "content-type: application/json expected"],
  [/^Content-Length invalide$/, "invalid Content-Length"],
  [/^JSON invalide$/, "invalid JSON"],
  [/^le dernier message doit venir de l'utilisateur$/, "the last message must come from the user"],
  [/^message vide$/, "empty message"],
  [/^Pas de clé OPENAI_API_KEY configurée\.$/, "No OPENAI_API_KEY configured."],
  [/^Erreur du modèle : délai dépassé$/, "Model error: timed out"],
  [/^Erreur du modèle : (.*)$/s, "Model error: $1"],
  [/^Je n'ai pas pu terminer dans le délai imparti : réessayez, ou posez une question plus simple\.$/, "I couldn't finish in time: try again, or ask a simpler question."],
  [/^J'ai préparé l'action ci-dessous : vérifiez-la, puis signez avec votre wallet\. Rien n'est dépensé sans votre signature\.$/, "I prepared the action below: check it, then sign with your wallet. Nothing is spent without your signature."],
  [/^Voici la page concernée\.$/, "Here is the page."],

  // ---- ArcHive API (services/api)
  [/^code inconnu ou expiré : relancez « archive-node pair » sur la machine$/, "unknown or expired code: run “archive-node pair” again on the machine"],
  [/^trop de requêtes \((.*)\) : réessayez dans (\d+) s$/, (m) => `too many requests (${LIMITED[m[1]!] ?? m[1]}): try again in ${m[2]} s`],
  [/^trop de codes faux essayés : réessayez dans (\d+) s$/, "too many wrong codes tried: try again in $1 s"],
  [/^limite de (\d+) machines par opérateur atteinte : retirez-en une sur la page Opérateur$/, "limit of $1 machines per operator reached: remove one on the Operator page"],
  [/^limite de (\d+) clés actives par opérateur atteinte : révoquez-en une$/, "limit of $1 active keys per operator reached: revoke one"],
  [/^le réseau n'accepte plus de nouvelle machine pour l'instant( : réessayez plus tard)?$/, "the network isn't accepting new machines right now: try again later"],
  [/^le réseau n'accepte plus de nouvelle clé pour l'instant : réessayez plus tard$/, "the network isn't accepting new keys right now: try again later"],
  [/^trop d'appairages en cours : réessayez dans quelques minutes$/, "too many pairings in progress: try again in a few minutes"],
  [/^déjà (\d+) appairages en cours depuis cette adresse : terminez-en un ou attendez son expiration \(15 min\)$/, "already $1 pairings in progress from this address: finish one or wait for it to expire (15 min)"],
  [/^trop de lectures signées en cours : réessayez dans une minute$/, "too many signed reads in progress: try again in a minute"],
  [/^trop de signatures en attente : réessayez dans une minute$/, "too many signatures pending: try again in a minute"],
  [/^aucun code libre : réessayez$/, "no free code: try again"],
  [/^signature expirée : signez à nouveau$/, "signature expired: sign again"],
  [/^nonce inconnu ou échu : signez à nouveau \(le site demande un nonce neuf à chaque signature\)$/, "unknown or expired nonce: sign again (the site asks for a fresh nonce for every signature)"],
  [/^signature déjà utilisée \(son nonce a servi\) : signez à nouveau$/, "signature already used (its nonce was spent): sign again"],
  [/^nonce expiré \(il sert dans les (\d+) minutes qui suivent son émission\) : signez à nouveau$/, "nonce expired (it's valid for $1 minutes after it's issued): sign again"],
  [/^signature invalide$/, "invalid signature"],
  [/^message signé pour un autre site \(« (.*) »\) : ArcHive n'accepte que (\S+)\. Ne signez de message ArcHive que sur ce site\.$/s, "message signed for another site (“$1”): ArcHive only accepts $2. Only sign ArcHive messages on this site."],
  [/^l'adresse du message ne correspond pas à celle du wallet \(attendue en entier, avec sa casse EIP-55\)$/, "the message's address doesn't match the wallet's (expected in full, with its EIP-55 casing)"],
  [/^message signé pour un autre réseau : ligne « Chain ID: (\d+) » \(Arc testnet\) attendue$/, "message signed for another network: line “Chain ID: $1” (Arc testnet) expected"],
  [/^message signé inattendu : cette action demande la phrase « (.*) »$/s, "unexpected signed message: this action requires the statement “$1”"],
  [/^message signé mal formé : (.*)$/s, (m) => `malformed signed message: ${malformedEn(m[1]!)}`],
  [/^« Issued At » incohérent avec l'émission du nonce : reprenez l'heure renvoyée par GET \/auth\/nonce$/, "“Issued At” doesn't match the nonce's issue time: use the time returned by GET /auth/nonce"],
  [/^machine inconnue pour cette adresse$/, "unknown machine for this address"],
  [/^clé inconnue pour cette adresse$/, "unknown key for this address"],
  [/^corps de requête trop volumineux \((\d+) Kio au plus\)$/, "request body too large ($1 KiB at most)"],
];

/** The English for a French message from the SDK, the API or an enclave; null if no rule knows it. */
export function englishOf(msg: string): string | null {
  const s = msg.trim();
  for (const [re, out] of RULES) {
    const m = re.exec(s);
    if (!m) continue;
    return typeof out === "string" ? s.replace(re, out) : out(m);
  }
  return null;
}

/** The English for a known message, or the message as it came. */
export function toEnglish(msg: string): string {
  return englishOf(msg) ?? msg;
}
