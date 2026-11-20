/** english.ts — every value the MCP tools return, in English.
 *
 *  The tools share their logic with the copilot (services/copilot/src/arc-actions.ts, archive-api.ts, net-guard.ts and
 *  the SDK's receipt checks). AskHive answers in the visitor's language, so the copilot's texts stay French there; this
 *  server translates them on the way out, and nothing in the copilot changes.
 *
 *  How a value is translated (englishValue):
 *   1. a whole value that matches a French text below (TEXTS) becomes its English text. "{}" in the French text
 *      matches any part (an address, a number, a block, a nested text); {0}, {1}… in the English text put those parts
 *      back, each one translated in turn (a nested French label, a duration in days…);
 *   2. a duration of the copilot's ("7 j", "1 j 6 h") is said in days;
 *   3. French phrases inside code, commands and app-compose files (FRAGMENTS) are replaced in place, line by line.
 *  Values that come from the chain or from the machines (addresses, hashes, names, a node's own log lines) match none
 *  of these texts, so they are returned unchanged. */

type Pair = readonly [fr: string, en: string];

/** The copilot's settlement labels (arc-actions.ts, railOf). */
const RAILS: Pair[] = [
  ["SessionPay (session prépayée, reçus cumulatifs)", "SessionPay (prepaid session, cumulative receipts)"],
  ["X402Settler (paiement à l'appel, x402)", "X402Settler (pay per call, x402)"],
  ["SealedBounty (Prime scellée)", "SealedBounty (Sealed Bounty)"],
  ["SealedBountyVerified (Prime scellée au niveau vérifié : puce déclarée par un auditeur, via PolicyEnclaves)", "SealedBountyVerified (Sealed Bounty, verified level: chip declared by an auditor, via PolicyEnclaves)"],
  ["aucun (service gratuit, attesté : ex. le copilote en enclave)", "none (free attested service, e.g. the copilot in an enclave)"],
  ["contrat de règlement inconnu", "unknown settlement contract"],
];

/** Whole values, by tool. */
const TEXTS: Pair[] = [
  ...RAILS,

  // ---- short words and labels (whole values only)
  ["oui", "yes"], ["non", "no"], ["aucun", "none"], ["inconnu", "unknown"], ["vérifié", "verified"], ["ouvert", "open"],
  ["adresse", "address"], ["montant", "amount"], ["signataire de l'enclave", "enclave signer"], ["contrat cible (target)", "target contract (target)"],
  ["écoulée", "elapsed"], ["déjà fermée", "already closed"], ["hors ligne", "offline"],
  ["erreur réseau", "network error"], ["délai de 10 s dépassé", "10 s timeout exceeded"],
  ["dans {}", "in {0}"], ["il y a {}", "{0} ago"],
  ["{} blocs ≈ {}", "{0} blocks ≈ {1}"], ["blocs {} → {}", "blocks {0} → {1}"],
  ["<ton adresse>", "<your address>"], ["0x<ton adresse>", "0x<your address>"], ["<id du produit>", "<product id>"],
  ["<adresse de l'opérateur>", "<operator address>"],
  ["<signature EIP-712 de autorisationEIP3009, faite dans ton wallet>", "<EIP-712 signature of eip3009Authorization, made in your wallet>"],
  ["<ta clé PUBLIQUE X25519 (0x + 64 hex), générée chez toi>", "<your PUBLIC X25519 key (0x + 64 hex), generated on your side>"],
  ["<mesuré sur la VM : keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES)>", "<measured on the VM: keccak256(MRTD ‖ RTMR0..3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES)>"],
  ["<keccak256 du manifeste final>", "<keccak256 of the final manifest>"],
  ["<ipfs://… ou https://… du manifeste>", "<ipfs://… or https://… of the manifest>"],
  ["<workloadId mesuré>", "<measured workloadId>"],
  ["ghcr.io/<toi>/{}@sha256:<digest>", "ghcr.io/<you>/{0}@sha256:<digest>"],

  // ---- lists (archive-api.ts): the list-unavailable message, its list names and reasons, the index freshness note
  ["liste momentanément indisponible ({}) : {}. Réessayez dans un instant ; aucune liste partielle n'est donnée à la place.", "list temporarily unavailable ({0}): {1}. Try again in a moment; no partial list is given instead."],
  ["produits", "products"], ["primes", "bounties"], ["activité", "activity"], ["compteurs du réseau", "network counters"], ["niveaux", "levels"],
  ["l'API ArcHive n'a pas répondu en {} s", "the ArcHive API did not answer in {0} s"],
  ["API ArcHive injoignable ({})", "ArcHive API unreachable ({0})"],
  ["l'API ArcHive a répondu HTTP {}", "the ArcHive API answered HTTP {0}"],
  ["réponse non JSON de l'API ArcHive", "non-JSON response from the ArcHive API"],
  ["réponse inattendue de l'API ArcHive (tableau attendu)", "unexpected ArcHive API response (array expected)"],
  ["réponse illisible de l'API ArcHive ({})", "unreadable ArcHive API response ({0})"],
  ["réponse inattendue de l'API ArcHive", "unexpected ArcHive API response"],
  ["réponse inattendue", "unexpected response"],
  ["réponse trop grande (plus de {} octets)", "response too large (over {0} bytes)"],
  ["{} : adresse attendue", "{0}: address expected"], ["{} : hexadécimal attendu", "{0}: hexadecimal expected"],
  ["{} : entier attendu", "{0}: integer expected"], ["{} : booléen attendu", "{0}: boolean expected"], ["{} : objet attendu", "{0}: object expected"],
  ["prime {}", "bounty {0}"], ["produit {}", "product {0}"], ["événement {}", "event {0}"],
  ["contrat ou nom d'événement manquant", "contract or event name missing"],
  ["index d'événements de l'API ArcHive ({})", "ArcHive API event index ({0})"],
  ["inconnu (état de l'index illisible)", "unknown (index state unreadable)"],
  ["l'index de l'API a {} blocs de retard{} : un événement plus récent que le bloc {} peut manquer", "the API's index is {0} blocks behind{1}: an event newer than block {2} may be missing"],
  [" ({})", " ({0})"],
  ["API ArcHive {}", "ArcHive API {0}"],
  ["{}/products (ProductRegistry.productCount + getProduct, read on-chain by the API)", "{0}/products (ProductRegistry.productCount + getProduct, read on-chain by the API)"],

  // ---- network guards (net-guard.ts) and enclave reads (arc-actions.ts): the copilot's English wording of the repo
  ["délai dépassé ({})", "timed out ({0})"],
  ["URL refusée : hôte vide", "URL refused: empty host"],
  ["hôte refusé (réseau privé) : {}", "host refused (private network): {0}"],
  ["hôte refusé (adresse privée ou réservée) : {}", "host refused (private or reserved address): {0}"],
  ["résolution DNS de {}", "DNS resolution of {0}"],
  ["hôte introuvable : {}", "host not found: {0}"],
  ["hôte refusé : {} pointe vers une adresse privée ou réservée", "host refused: {0} points to a private or reserved address"],
  ["URL invalide : {}", "invalid URL: {0}"],
  ["URL refusée : http(s) seulement", "URL refused: http(s) only"],
  ["URL refusée : pas d'identifiants dans l'URL", "URL refused: no credentials in the URL"],
  ["route d'enclave refusée : {} (/attest ou /pubkeys seulement)", "enclave route refused: {0} (/attest or /pubkeys only)"],
  ["URL d'enclave refusée : ni requête (?…) ni fragment (#…)", "enclave URL refused: no query (?…) and no fragment (#…)"],
  ["URL d'enclave refusée : https seulement", "enclave URL refused: https only"],
  ["URL d'enclave refusée : port 443 seulement", "enclave URL refused: port 443 only"],
  ["URL d'enclave refusée : chemin fixe (la racine{}), pas {}", "enclave URL refused: fixed path (the root{0}), not {1}"],
  ["URL d'enclave refusée : /attest ou /pubkeys seulement", "enclave URL refused: /attest or /pubkeys only"],
  ["URL d'enclave refusée : chemin fixe", "enclave URL refused: fixed path"],
  ["délai dépassé en appelant {}", "timed out calling {0}"],
  ["redirection refusée (HTTP {}) : {}", "redirect refused (HTTP {0}): {1}"],
  ["réponse interrompue : {}", "response interrupted: {0}"],
  ["réponse trop grande (plus de {} Mo)", "response too large (over {0} MB)"],
  ["délai dépassé (15 s) en appelant {}", "timed out (15 s) calling {0}"],
  ["{} de {} a répondu HTTP {} (corps non lu)", "{0} from {1} answered HTTP {2} (body not read)"],
  ["{} de {} : réponse non JSON", "{0} from {1}: response not JSON"],
  ["{} : réponse non JSON", "{0}: response not JSON"],
  ["{} injoignable ({})", "{0} unreachable ({1})"],

  // ---- parameters (arc-actions.ts addr, parseId, parseAmount, hexStr, intStr)
  ["{} invalide : « {} » (attendu 0x suivi de 40 caractères hexadécimaux)", "invalid {0}: \"{1}\" (expected 0x followed by 40 hexadecimal characters)"],
  ["{} invalide : « {} » (entier attendu)", "invalid {0}: \"{1}\" (an integer expected)"],
  ["{} invalide : « {} » (attendu un nombre, ex. 5 ou 0.25)", "invalid {0}: \"{1}\" (a number expected, e.g. 5 or 0.25)"],
  ["{} : {} décimales au plus", "{0}: {1} decimals at most"],
  ["{} : hexadécimal 0x… attendu", "{0}: 0x… hexadecimal expected"],
  ["{} : entier en unités de base attendu (ex. \"1000000\" = 1 USDC)", "{0}: an integer in base units expected (e.g. \"1000000\" = 1 USDC)"],

  // ---- arc_verify_receipt: the SDK's receipt checks (packages/sdk/src/receipts.ts), as its English texts say them
  ["session #{} connue", "session #{0} known"],
  ["session #{} inconnue (SessionMismatch)", "session #{0} unknown (SessionMismatch)"],
  ["session close (Closed)", "session closed (Closed)"],
  ["session ouverte", "session open"],
  ["produit #{}", "product #{0}"],
  ["produit du reçu #{} ≠ produit de la session #{} (SessionMismatch)", "receipt's product #{0} ≠ session's product #{1} (SessionMismatch)"],
  ["enclave {} active au bloc d'ancrage {}", "enclave {0} active at anchor block {1}"],
  ["enclave {} non active pour ce produit au bloc {} (InactiveEnclave)", "enclave {0} not active for this product at block {1} (InactiveEnclave)"],
  ["opérateur {}", "operator {0}"],
  ["opérateur de l'enclave {} ≠ opérateur de la session {} (WrongOperator)", "enclave's operator {0} ≠ session's operator {1} (WrongOperator)"],
  ["signé par l'enclave verrouillée à l'ouverture", "signed by the enclave locked at opening"],
  ["signé par {}, la session est verrouillée sur {} (WrongEnclave)", "signed by {0}, the session is locked to {1} (WrongEnclave)"],
  ["modèle verrouillé à l'ouverture", "model locked at opening"],
  ["modelHash {} ≠ modèle de la session {} (ModelMismatch)", "modelHash {0} ≠ session's model {1} (ModelMismatch)"],
  ["cumul {} > déjà réglé {}", "cumulative {0} > already settled {1}"],
  ["cumul {} ≤ déjà réglé {} (NotIncreasing)", "cumulative {0} ≤ already settled {1} (NotIncreasing)"],

  // ---- the SDK's checks the tools call (predicate.ts, quote.ts, dstack-eventlog.ts)
  ["prédicat : objet JSON attendu", "predicate: a JSON object expected"],
  ["prédicat : nombre non fini (NaN ou infini)", "predicate: a non-finite number (NaN or infinity)"],
  ["prédicat : imbrication de plus de {} niveaux", "predicate: nested deeper than {0} levels"],
  ["prédicat : plus de {} champs", "predicate: more than {0} fields"],
  ["prédicat : tableau à trous (pas du JSON)", "predicate: an array with holes (not JSON)"],
  ["prédicat : valeur non JSON (seuls chaînes, nombres finis, booléens, null, tableaux et objets simples)", "predicate: a non-JSON value (only strings, finite numbers, booleans, null, arrays and plain objects)"],
  ["prédicat : JSON canonique de plus de {} octets", "predicate: canonical JSON over {0} bytes"],
  ["clause {} : {} doit être un entier décimal ≥ 0 (78 chiffres au plus)", "clause {0}: {1} must be a decimal integer ≥ 0 (78 digits at most)"],
  ["clause {} : {} doit être une adresse (0x + 40 hexadécimaux)", "clause {0}: {1} must be an address (0x + 40 hex)"],
  ["clause {} : call doit être de l'hexadécimal pair (0x…)", "clause {0}: call must be even-length hexadecimal (0x…)"],
  ["clause {} : objet attendu", "clause {0}: object expected"],
  ["clause {} : op doit valoir eq, neq, gt ou lt", "clause {0}: op must be eq, neq, gt or lt"],
  ["clause {} : type inconnu (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)", "clause {0}: unknown type (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)"],
  ["combine invalide (AND ou OR)", "invalid combine (AND or OR)"],
  ["1 à {} clauses", "1 to {0} clauses"],
  ["quote non TDX (type de TEE 0x{})", "not a TDX quote (TEE type 0x{0})"],
  ["version de quote {} non prise en charge (4 ou 5)", "quote version {0} not supported (4 or 5)"],
  ["corps de quote de type {} : TD1.0 (2) ou TD1.5 (3) attendu", "quote body of type {0}: TD1.0 (2) or TD1.5 (3) expected"],
  ["nom d'événement V2 à échapper, refusé par le registre : {}", "a V2 event name to escape, refused by the registry: {0}"],
  ["journal RTMR3 absent ou illisible dans /attest", "RTMR3 event log missing or unreadable in /attest"],
  ["le journal RTMR3 ne redonne pas le RTMR3 du quote", "the RTMR3 event log does not give back the quote's RTMR3"],
  ["image non reconnue dans le journal (compose-hash ou os-image-hash manquant ou ambigu)", "image not recognised in the event log (compose-hash or os-image-hash missing or ambiguous)"],
  ["le rejeu du registre diffère du rejeu local : journal non transmis", "the registry's replay differs from the local replay: event log not sent"],
  ["l'empreinte d'image {} n'est pas autorisée par le produit", "the image fingerprint {0} is not allowed by the product"],

  // ---- arc_enclaves, arc_enclave_status (TCB, validity, bond)
  ["oui si tous les avis Intel sont tolérés par le produit", "yes if the product tolerates all the Intel advisories"],
  ["non (politique P2 : on échoue fermé)", "no (policy P2: fail closed)"],
  ["inconnu ({})", "unknown ({0})"],
  ["Aucune enclave inscrite avec le signataire {} (EnclaveRegistry.enclaveOf, lu on-chain). Impossible de vérifier si c'est plutôt un opérateur : {}", "No enclave registered with the signer {0} (EnclaveRegistry.enclaveOf, read on-chain). Cannot check whether it is an operator instead: {1}"],
  ["{} n'est pas une clé d'enclave mais un OPÉRATEUR : voici ses enclaves (relance avec un signataire).", "{0} is not an enclave key but an OPERATOR: here are its enclaves (call again with a signer)."],
  ["Aucune enclave inscrite avec le signataire {} (EnclaveRegistry.enclaveOf). La ruche complète : {}.", "No enclave registered with the signer {0} (EnclaveRegistry.enclaveOf). The whole hive: {1}."],
  ["active : elle peut signer des reçus maintenant", "active: it can sign receipts now"],
  ["{}, en grâce jusqu'au bloc {} : ses reçus ancrés dans sa fenêtre restent réglables", "{0}, in grace until block {1}: its receipts anchored in its window can still be settled"],
  ["fenêtre de validité écoulée", "validity window elapsed"],
  ["retirée ou invalidée", "retired or killed"],
  ["expirée (grâce passée) : l'opérateur doit la réattester", "expired (grace over): the operator must attest it again"],
  ["désactivée (invalidée ou retirée)", "deactivated (killed or retired)"],
  ["{} (indicatif : la règle est en blocs)", "{0} (indicative: the rule is in blocks)"],
  ["{} (indicatif)", "{0} (indicative)"],
  ["{} (chaque clé inscrite réserve la caution minimale de son produit)", "{0} (each registered key reserves its product's minimum bond)"],

  // ---- arc_session_status, arc_sessions
  ["Session #{} inconnue : SessionPay compte {} session(s), numérotées de 1 à {}.", "Session #{0} unknown: SessionPay has {1} session(s), numbered 1 to {2}."],
  ["aucun (= le dépôt)", "none (= the deposit)"],
  ["illimité (prix nul)", "unlimited (zero price)"],
  ["closeSession possible maintenant (propriétaire) : rembourse le reste et écrit le verdict ERC-8004", "closeSession possible now (owner): refunds the remainder and writes the ERC-8004 verdict"],
  ["closeSession par le propriétaire à partir du {} (échéance + {}), ou dès le bloc {} si l'enclave liée ne peut plus rien régler : rembourse le reste", "closeSession by the owner from {0} (expiry + {1}), or from block {2} if the bound enclave can no longer settle anything: refunds the remainder"],
  ["Seul le cumul RÉGLÉ est on-chain ; la consommation pas encore réglée est dans le dernier reçu cumulatif signé par l'enclave. Seuls les reçus de l'enclave verrouillée paient cette session.", "Only the SETTLED total is on-chain; usage not yet settled is in the latest cumulative receipt signed by the enclave. Only receipts from the locked enclave pay this session."],
  ["owner requis : l'adresse 0x… du compte (ou connectez votre wallet).", "owner required: the account's 0x… address (or connect your wallet)."],
  ["Seul le cumul RÉGLÉ est on-chain ; pour le détail d'une session (plafond, reste exact, fermeture) : {}.", "Only the SETTLED total is on-chain; for a session's details (cap, exact remainder, closing): {0}."],

  // ---- arc_activity
  ["les {} derniers événements au plus, du plus récent au plus ancien", "the latest {0} events at most, newest first"],

  // ---- arc_bounty_prepare_create
  ["{}.op : eq, neq, gt ou lt", "{0}.op: eq, neq, gt or lt"],
  ["{} : type inconnu « {} » (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)", "{0}: unknown type \"{1}\" (ERC20_DROP, NATIVE_DROP, ATTACKER_PROFIT, VIEW_CHANGED, INVARIANT_BROKEN)"],
  ["predicate : objet JSON { combine, clauses } attendu", "predicate: a JSON object { combine, clauses } expected"],
  ["Aucun produit « Prime scellée » actif trouvé (règlement SealedBounty).", "No active Sealed Bounty product found (SealedBounty settlement)."],
  ["produit #{} : {}", "product #{0}: {1}"],
  ["{} (createBounty reverterait : BadProduct)", "{0} (createBounty would revert: BadProduct)"],
  ["Le produit #{} n'est réglé par aucune Prime scellée en service ({}) : createBounty reverterait (WrongSettlement). Choisis le produit 2 (niveau ouvert) ou 7 (niveau vérifié) ; le produit 6, neutralisé le 11/11, est remplacé par le 7.", "Product #{0} is settled by no Sealed Bounty in service ({1}): createBounty would revert (WrongSettlement). Choose product 2 (open level) or 7 (verified level); product 6, neutralized on 11 Nov 2026, is replaced by 7."],
  ["productId : un produit de Prime scellée en service (2 = niveau ouvert, 7 = niveau vérifié)", "productId: a Sealed Bounty product in service (2 = open level, 7 = verified level)"],
  ["Le produit #{} n'est pas déterministe : le rejeu d'un exploit doit l'être.", "Product #{0} is not deterministic: replaying an exploit must be."],
  ["vérifié : seules comptent les enclaves dont la puce (PPID lu dans le certificat d'Intel) est déclarée par un auditeur accepté par le produit (Proof of Cloud), vérifié au règlement par PolicyEnclaves", "verified: only enclaves whose chip (PPID read in Intel's certificate) is declared by an auditor the product accepts (Proof of Cloud) count, checked at settlement by PolicyEnclaves"],
  ["{} est autorisé dans OperatorBond : une réclamation prouvée peut être payée", "{0} is authorized in OperatorBond: a proven claim can be paid"],
  ["{} n'est pas encore autorisé dans OperatorBond{}", "{0} is not yet authorized in OperatorBond{1}"],
  [" (applicable à partir du {}, puis applySettlement)", " (applicable from {0}, then applySettlement)"],
  ["Tant que {} n'est pas autorisé dans OperatorBond{}, la prime peut être créée et financée, mais aucune réclamation ne peut être acceptée : choisis une échéance au-delà.", "As long as {0} is not authorized in OperatorBond{1}, the bounty can be created and funded, but no claim can be accepted: choose a deadline after that."],
  [" (possible à partir du {}, puis applySettlement)", " (possible from {0}, then applySettlement)"],
  ["USDC natif (gas, 18 décimales)", "native USDC (gas, 18 decimals)"],
  ["clauseType « {} » : l'assistant guide ERC20_DROP, NATIVE_DROP et ATTACKER_PROFIT ; pour VIEW_CHANGED ou INVARIANT_BROKEN, passe le prédicat complet (predicate).", "clauseType \"{0}\": the helper guides ERC20_DROP, NATIVE_DROP and ATTACKER_PROFIT; for VIEW_CHANGED or INVARIANT_BROKEN, pass the full predicate (predicate)."],
  ["target : l'adresse du contrat dont le solde est surveillé (ex. le coffre du protocole)", "target: the address of the contract whose balance is watched (e.g. the protocol's vault)"],
  ["minDrop : la baisse minimale qui prouve l'exploit (en {})", "minDrop: the minimum drop that proves the exploit (in {0})"],
  ["exploit prouvé si le solde {} de {} baisse d'au moins {} {}", "exploit proven if the {0} balance of {1} drops by at least {2} {3}"],
  ["exploit prouvé si le solde natif de {} baisse d'au moins {}", "exploit proven if the native balance of {0} drops by at least {1}"],
  ["exploit prouvé si l'attaquant gagne au moins {} {}", "exploit proven if the attacker gains at least {0} {1}"],
  ["reward : la récompense du chasseur en USDC (ou tiers : [{ minLoss, amount }] pour plusieurs paliers)", "reward: the hunter's reward in USDC (or tiers: [{ minLoss, amount }] for several tiers)"],
  ["8 paliers au plus", "8 tiers at most"],
  ["chaque palier doit payer plus de 0 USDC", "each tier must pay more than 0 USDC"],
  ["paliers : seuils de perte ET montants strictement croissants (sinon createBounty revert BadTiers)", "tiers: loss thresholds AND amounts strictly increasing (otherwise createBounty reverts with BadTiers)"],
  ["Le financement ({}) ne couvre pas un paiement du plus haut palier ({} frais compris) : la réclamation reverterait (PoolTooSmall). fund() permet d'ajouter des fonds.", "The funding ({0}) does not cover one payment of the highest tier ({1} fees included): the claim would revert (PoolTooSmall). fund() adds funds."],
  ["k doit être un entier de 1 à {} (MAX_SIGS lu on-chain)", "k must be an integer from 1 to {0} (MAX_SIGS read on-chain)"],
  ["deadlineDays : entre 1 et 365 jours", "deadlineDays: between 1 and 365 days"],
  ["{} doit exposer pause() appelable par {} ({}) ; l'appel n'est jamais bloquant.", "{0} must expose pause() callable by {1} ({2}); the call never blocks."],
  ["protocolX25519 : clé PUBLIQUE X25519 de 32 octets attendue (0x + 64 hex) ; ne donne jamais la clé privée", "protocolX25519: a 32-byte PUBLIC X25519 key expected (0x + 64 hex); never give the private key"],
  ["protocolX25519 : ta clé PUBLIQUE X25519 (l'exploit te sera livré chiffré pour elle) ; génère la paire chez toi, voir cleDuProtocole", "protocolX25519: your PUBLIC X25519 key (the exploit will be delivered to you encrypted for it); generate the pair on your side, see protocolKey"],
  ["from : le wallet du protocole (celui qui finance et signe)", "from: the protocol's wallet (the one that funds and signs)"],
  ["solde USDC de {} : {} (financement : {})", "USDC balance of {0}: {1} (funding: {2})"],
  ["{} est bien un contrat", "{0} is a contract"],
  ["{} n'a pas de code : ce n'est pas un contrat", "{0} has no code: it is not a contract"],
  ["{} opérateur(s) distinct(s) ont une enclave active sur le produit #{} (k = {})", "{0} distinct operator(s) have an active enclave on product #{1} (k = {2})"],
  ["Aucune enclave active sur ce produit pour l'instant : la prime peut être créée, mais aucun exploit ne sera prouvé tant qu'un opérateur n'en inscrit pas une.", "No active enclave on this product for now: the bounty can be created, but no exploit will be proven until an operator registers one."],
  ["Publie ce JSON canonique tel quel : le chasseur le joint à son exploit et l'enclave vérifie que son hash est celui épinglé on-chain.", "Publish this canonical JSON as is: the hunter attaches it to their exploit and the enclave checks that its hash is the one pinned on-chain."],
  ["Le chasseur touche 100 % du palier ; en plus, pris sur le pool : la part du réseau (networkBountyBps) et celle des k opérateurs vérificateurs (operatorBountyBps). v2 : acceptClaim vérifie la preuve et réserve le paiement, deliver livre le rapport chiffré et paie ; un palier n'est payé qu'une fois par armement (reopen après correction de la faille).", "The hunter gets 100% of the tier; on top, taken from the pool: the network's share (networkBountyBps) and that of the k verifying operators (operatorBountyBps). v2: acceptClaim checks the proof and reserves the payment, deliver delivers the encrypted report and pays; a tier is paid only once per arming (reopen after the flaw is fixed)."],
  ["{} ({} j, valeur proposée à confirmer)", "{0} ({1} days, proposed value to confirm)"],
  ["L'exploit prouvé t'est livré chiffré pour cette clé ; seule ta clé privée le déchiffre. Elle ne doit jamais quitter ta machine.", "The proven exploit is delivered to you encrypted for this key; only your private key decrypts it. It must never leave your machine."],
  ["Ton wallet signe : SDK arc.createBounty (ci-dessus) ou Mon espace › Mes bounties du site (/space.html?tab=bounties, niveau {}). Le copilote n'envoie rien.", "Your wallet signs: SDK arc.createBounty (above) or the site's My space › Bounties (/space.html?tab=bounties, {0} level). Nothing is sent for you."],
  ["predicate.ts (langage v0)", "predicate.ts (language v0)"],

  // ---- arc_operator_plan
  ["Produits : {}", "Products: {0}"],
  ["Le produit #{} n'est pas actif : choisis parmi la liste.", "Product #{0} is not active: choose from the list."],
  ["inconnues pour l'instant : {}", "unknown for now: {0}"],
  ["Cette adresse est BANNIE (caution saisie après une double signature) : elle ne peut plus déposer de caution.", "This address is BANNED (bond slashed after a double signature): it can no longer deposit a bond."],
  ["Un wallet et de l'USDC sur Arc", "A wallet and USDC on Arc"],
  ["Le gas d'Arc se paie en USDC. Amène ton USDC d'Ethereum Sepolia ou de Base Sepolia par CCTP (page Pont du site, /bridge.html).", "Gas on Arc is paid in USDC. Bring your USDC from Ethereum Sepolia or Base Sepolia over CCTP (the site's Bridge page, /bridge.html)."],
  ["Choisir un produit", "Choose a product"],
  ["Ta part de chaque paiement = bpsOperator du produit ; il faut au moins sa caution minimale (voir produits).", "Your share of each payment = the product's bpsOperator; you need at least its minimum bond (see products)."],
  ["Déposer la caution (OperatorBond)", "Deposit the bond (OperatorBond)"],
  ["bond(montant, autorisation EIP-3009) en une transaction, ou approve puis bondFrom ; tu signes.", "bond(amount, EIP-3009 authorization) in one transaction, or approve then bondFrom; you sign."],
  ["Louer une VM Intel TDX sur Phala Cloud (dstack)", "Rent an Intel TDX VM on Phala Cloud (dstack)"],
  ["Déployer l'app-compose ci-dessous (image épinglée par digest). Commande donnée par enclave/docker-compose.yml [À VÉRIFIER : CLI Phala].", "Deploy the app-compose below with the Phala Cloud CLI (image pinned by digest; templates: enclave/phala/*.yml)."],
  ["Déployer l'app-compose ci-dessous avec le CLI de Phala Cloud (image épinglée par digest ; modèles : enclave/phala/*.yml).", "Deploy the app-compose below with the Phala Cloud CLI (image pinned by digest; templates: enclave/phala/*.yml)."],
  ["Vérifier l'attestation de la VM", "Check the VM's attestation"],
  ["/attest rend un quote qui lie ton adresse d'opérateur, le produit et les clés de l'enclave (REPORTDATA) ; /pubkeys donne ses clés publiques.", "/attest returns a quote that binds your operator address, the product and the enclave's keys (REPORTDATA); /pubkeys gives its public keys."],
  ["Inscrire l'enclave (registerEnclave)", "Register the enclave (registerEnclave)"],
  ["Envoyée par TON adresse d'opérateur. La chaîne vérifie la signature d'Intel sur le quote (DCAP d'Automata : ≈ 6,85 M gas mesurés par inscription, soit ≈ 0,15 à 0,17 USDC de gaz à 21,5–25 gwei ; au niveau vérifié, bindMachine ajoute ≈ 1,7 M gas, ≈ 0,04 USDC), puis : pas de mode DEBUG, SEPT_VE_DISABLE, workloadId autorisé, TCB, REPORTDATA, ancrage de bloc (EIP-2935), quote jamais vu, caution libre ≥ minimum (chaque clé en réserve une).", "Sent by YOUR operator address. The chain checks Intel's signature on the quote (Automata's DCAP: ≈ 6.85 M gas measured per registration, i.e. ≈ 0.15 to 0.17 USDC of gas at 21.5–25 gwei; at the verified level, bindMachine adds ≈ 1.7 M gas, ≈ 0.04 USDC), then: no DEBUG mode, SEPT_VE_DISABLE, allowed workloadId, TCB, REPORTDATA, block anchor (EIP-2935), quote never seen before, free bond ≥ minimum (each key reserves one)."],
  ["Renouveler", "Renew"],
  ["Une inscription vaut {} (VALIDITY_BLOCKS) : réattester avant la fin (le service Registrar peut le faire) ; renouvelée sans trou, la fenêtre est prolongée. Ensuite {} de grâce pour régler les anciens reçus. Une clé est liée à vie à son opérateur et à son produit.", "A registration lasts {0} (VALIDITY_BLOCKS): attest again before it ends (the Registrar service can do it); renewed without a gap, the window is extended. Then {1} of grace to settle the old receipts. A key is bound for life to its operator and its product."],
  ["Encaisser", "Get paid"],
  ["settle() des derniers reçus cumulatifs (sans permission, une transaction par règlement) ; sur les primes, {} % en plus partagés entre les opérateurs vérificateurs.", "settle() the latest cumulative receipts (permissionless, one transaction per settlement); on bounties, {0}% more shared among the verifying operators."],
  ["Sur une fenêtre de {} (WINDOW), tous produits confondus, les paiements pris sur la foi de tes enclaves sont plafonnés à la MOITIÉ de ta caution disponible (sinon revert TooMuchExposure) ; en plus, pour chaque produit, au plafond d'exposition du produit (exposureCap ; sinon ExposureCapExceeded). Une caution de 1 USDC couvre donc au plus 0,5 USDC de paiements sur la fenêtre ; il faut 20 USDC de caution pour atteindre un plafond de 10 USDC.", "Over a window of {0} (WINDOW), all products together, the payments taken on the strength of your enclaves are capped at HALF of your available bond (otherwise revert TooMuchExposure); in addition, for each product, at the product's exposure cap (exposureCap; otherwise ExposureCapExceeded). So a 1 USDC bond covers at most 0.5 USDC of payments over the window; it takes a 20 USDC bond to reach a 10 USDC cap."],
  ["Chaque clé d'enclave inscrite réserve la caution minimale de son produit ; retirer la clé (retire) libère la réserve.", "Each registered enclave key reserves its product's minimum bond; retiring the key (retire) frees the reserve."],
  ["requestUnbond(montant), puis withdraw() après {} (UNBOND_DELAY).", "requestUnbond(amount), then withdraw() after {0} (UNBOND_DELAY)."],
  ["Double signature prouvée (deux reçus différents pour la même session et le même seq, ou deux réclamations différentes pour la même empreinte de prime) = saisie de TOUTE la caution et bannissement.", "A proven double signature (two different receipts for the same session and the same seq, or two different claims for the same bounty fingerprint) = the WHOLE bond slashed and a ban."],
  ["50 % au dénonciateur, 50 % à la victime (à la trésorerie du réseau s'il n'y a pas de victime).", "50% to the whistleblower, 50% to the victim (to the network treasury if there is no victim)."],
  ["OperatorBond.sol (UNBOND_DELAY, WINDOW, consumeExposure, reserve, slash)", "OperatorBond.sol (UNBOND_DELAY, WINDOW, consumeExposure, reserve, slash)"],
  ["EnclaveRegistry.sol (VALIDITY_BLOCKS, GRACE_BLOCKS, politique P1–P12)", "EnclaveRegistry.sol (VALIDITY_BLOCKS, GRACE_BLOCKS, policy P1–P12)"],
  ["phala deploy -c docker-compose.yml -t tdx.small --name archive-produit-{} -e PRODUCT_ID={}", "phala deploy -c docker-compose.yml -t tdx.small --name archive-product-{0} -e PRODUCT_ID={1}"],

  // ---- arc_operator_prepare_bond
  ["Produit #{} inconnu.", "Unknown product #{0}."],
  ["Ta caution disponible ({}) couvre déjà la caution minimale du produit #{} ({}). Prochaine étape : inscrire ton enclave ({}).", "Your available bond ({0}) already covers the minimum bond of product #{1} ({2}). Next step: register your enclave ({3})."],
  ["amount : le montant de la caution en USDC, ou productId pour viser la caution minimale d'un produit", "amount: the bond amount in USDC, or productId to aim at a product's minimum bond"],
  ["amount doit être supérieur à 0", "amount must be greater than 0"],
  ["adresse non bannie", "address not banned"],
  ["adresse BANNIE : bond() reverterait (Banned)", "BANNED address: bond() would revert (Banned)"],
  ["solde USDC : {} (caution à déposer : {} ; garde aussi un peu d'USDC pour le gas)", "USDC balance: {0} (bond to deposit: {1}; keep some USDC for gas too)"],
  ["après dépôt, caution disponible {} pour une caution minimale de {} (produit #{})", "after the deposit, available bond {0} for a minimum bond of {1} (product #{2})"],
  ["operator : l'adresse de l'opérateur (celle qui signera et inscrira l'enclave)", "operator: the operator's address (the one that will sign and register the enclave)"],
  ["bond(amount, auth) sur OperatorBond, avec une autorisation EIP-3009 signée par ton wallet", "bond(amount, auth) on OperatorBond, with an EIP-3009 authorization signed by your wallet"],
  ["1. autoriser OperatorBond à prélever", "1. allow OperatorBond to take the USDC"],
  ["2. déposer", "2. deposit"],
  ["Network › Louer (/network.html?focus=rent, étape caution, wallet connecté), ou sur ta machine : arcvault operator bond --amount {} (ta clé reste chez toi, jamais dans le chat)", "Network › Rent (/network.html?focus=rent, bond step, wallet connected), or on your machine: arcvault operator bond --amount {0} (your key stays with you, never in the chat)"],

  // ---- arc_operator_prepare_register
  [" (revert ProductNotActive)", " (revert ProductNotActive)"],
  ["caution disponible {} pour une caution minimale de {}", "available bond {0} for a minimum bond of {1}"],
  ["caution disponible {} pour une caution minimale de {} (revert OperatorUnderbonded : {} d'abord)", "available bond {0} for a minimum bond of {1} (revert OperatorUnderbonded: {2} first)"],
  ["caution libre {} : une NOUVELLE clé réserve {}", "free bond {0}: a NEW key reserves {1}"],
  ["caution libre {} : une NOUVELLE clé réserve {} (revert OperatorUnderbonded : retire une ancienne clé ou augmente la caution)", "free bond {0}: a NEW key reserves {1} (revert OperatorUnderbonded: retire an old key or increase the bond)"],
  ["opérateur BANNI", "operator BANNED"],
  ["opérateur non banni", "operator not banned"],
  ["operator : ton adresse d'opérateur (le quote la lie, et c'est elle qui envoie la transaction)", "operator: your operator address (the quote binds it, and it sends the transaction)"],
  ["enclaveUrl : l'URL publique de ta VM (elle sert POST /attest)", "enclaveUrl: the public URL of your VM (it serves POST /attest)"],
  ["/attest.signer : adresse 0x… de 40 caractères hexadécimaux attendue", "/attest.signer: a 0x… address of 40 hexadecimal characters expected"],
  ["/attest.x25519 : 32 octets attendus", "/attest.x25519: 32 bytes expected"],
  ["ce quote a DÉJÀ servi (revert QuoteReused) : redemande /attest", "this quote was ALREADY used (revert QuoteReused): ask /attest again"],
  ["quote jamais vu", "quote never seen before"],
  ["Cette clé d'enclave est déjà inscrite (produit #{}) : l'envoi la ré-inscrit (renouvellement).", "This enclave key is already registered (product #{0}): sending registers it again (renewal)."],
  ["quote SIMULÉ (la VM n'a pas Intel TDX ou pas l'agent dstack) : la vérification DCAP d'Intel le refuserait (QuoteInvalid)", "SIMULATED quote (the VM has no Intel TDX or no dstack agent): Intel's DCAP verification would refuse it (QuoteInvalid)"],
  ["enclave en mode DEBUG (revert DebugEnclave)", "enclave in DEBUG mode (revert DebugEnclave)"],
  ["pas de mode DEBUG", "no DEBUG mode"],
  ["empreinte d'image {}, stable d'un redémarrage à l'autre", "image fingerprint {0}, stable from one restart to the next"],
  ["image autorisée par le produit ({})", "image allowed by the product ({0})"],
  ["image NON autorisée par le produit : {} ; l'auteur doit proposeWorkload puis applyWorkload", "image NOT allowed by the product: {0}; the author must proposeWorkload then applyWorkload"],
  ["image NON autorisée par le produit : {} ({}) ; l'auteur doit proposeWorkload puis applyWorkload", "image NOT allowed by the product: {0} ({1}); the author must proposeWorkload then applyWorkload"],
  ["empreinte d'image {}", "image fingerprint {0}"],
  ["SEPT_VE_DISABLE conforme", "SEPT_VE_DISABLE compliant"],
  ["SEPT_VE_DISABLE absent (revert SeptVeNotDisabled)", "SEPT_VE_DISABLE missing (revert SeptVeNotDisabled)"],
  ["quote illisible : {}", "unreadable quote: {0}"],
  ["<quote de POST /attest>", "<quote from POST /attest>"], ["<signer de /attest>", "<signer from /attest>"],
  ["<x25519 de /attest>", "<x25519 from /attest>"], ["<eventLog de /attest>", "<eventLog from /attest>"],
  ["EnclaveRegistry.registerEnclave (politique P1–P12)", "EnclaveRegistry.registerEnclave (policy P1–P12)"],
  ["REPORTDATA lie (chaîne, registre, produit, opérateur, clés)", "REPORTDATA binds (chain, registry, product, operator, keys)"],
  ["(non incluse ici : Mon espace › Mes machines, /space.html?tab=machines, ou arc.registerEnclave la reconstruisent)", "(not included here: My space › Machines, /space.html?tab=machines, or arc.registerEnclave rebuild it)"],
  ["Le hash du bloc d'ancrage doit rester lisible dans l'historique EIP-2935 (8 191 blocs) : au-delà, revert AnchorTooOld ; redemande alors /attest.", "The anchor block's hash must stay readable in the EIP-2935 history (8,191 blocks): beyond that, revert AnchorTooOld; then ask /attest again."],
  ["≈ 6 850 000 mesurés le 19/11, soit ≈ 0,15 à 0,17 USDC à 21,5–25 gwei (estimation du SDK : {} ; vérification de la signature d'Intel par DCAP on-chain)", "≈ 6,850,000 measured on 19 Nov 2026, i.e. ≈ 0.15 to 0.17 USDC at 21.5–25 gwei (the SDK's estimate: {0}; Intel's signature checked by DCAP on-chain)"],
  ["signature d'Intel sur le quote (DCAP d'Automata : collatéral chargé on-chain), quote TDX v4/v5, TCB acceptable, pas de mode DEBUG, SEPT_VE_DISABLE, workloadId autorisé par le produit, REPORTDATA = (chaîne, registre, produit, opérateur = expéditeur, signer, x25519), ancrage EIP-2935, quote jamais vu, caution libre ≥ minimum ; inscription valable VALIDITY_BLOCKS blocs (≈ 24 h), clé liée à vie à cet opérateur et à ce produit.", "Intel's signature on the quote (Automata's DCAP: collateral loaded on-chain), TDX quote v4/v5, acceptable TCB, no DEBUG mode, SEPT_VE_DISABLE, workloadId allowed by the product, REPORTDATA = (chain, registry, product, operator = sender, signer, x25519), EIP-2935 anchor, quote never seen before, free bond ≥ minimum; registration valid for VALIDITY_BLOCKS blocks (≈ 24 h), key bound for life to this operator and this product."],
  ["Mon espace › Mes machines (/space.html?tab=machines, section register : l'URL de l'enclave), ou SDK : await arc.registerEnclave(productId, enclaveUrl) avec TON wallet d'opérateur.", "My space › Machines (/space.html?tab=machines, register section: the enclave's URL), or SDK: await arc.registerEnclave(productId, enclaveUrl) with YOUR operator wallet."],

  // ---- arc_product_scaffold
  ["repris du produit #{} (lu on-chain), à ajuster", "taken from product #{0} (read on-chain), to adjust"],
  ["{} (repris du produit #{} (lu on-chain), à ajuster)", "{0} (taken from product #{1} (read on-chain), to adjust)"],
  ["Donne les trois parts bpsOperator, bpsAuthor et bpsNetwork (points de base, somme = 10 000)", "Give the three shares bpsOperator, bpsAuthor and bpsNetwork (basis points, sum = 10,000)"],
  ["chaque part est un entier de 0 à 10 000 points de base", "each share is an integer from 0 to 10,000 basis points"],
  ["les parts font {} points de base au lieu de 10 000 : propose() reverterait (BadShares)", "the shares add up to {0} basis points instead of 10,000: propose() would revert (BadShares)"],
  ["bpsAuthor : 3 000 au plus (30 %) : propose() reverterait (AuthorShareTooHigh)", "bpsAuthor: 3,000 at most (30%): propose() would revert (AuthorShareTooHigh)"],
  ["bpsNetwork : 500 au moins (5 %) : propose() reverterait (NetworkShareTooLow)", "bpsNetwork: 500 at least (5%): propose() would revert (NetworkShareTooLow)"],
  ["Aucun produit de référence : donne bpsOperator, bpsAuthor et bpsNetwork (somme = 10 000)", "No reference product: give bpsOperator, bpsAuthor and bpsNetwork (sum = 10,000)"],
  ["price : le prix par unité en USDC est requis", "price: the price per unit in USDC is required"],
  ["Prix nul : le service est gratuit (utile pour un service gardé pour soi).", "Zero price: the service is free (useful for a service you keep for yourself)."],
  ["Rail session : SessionPay exige que le modelHash de chaque reçu soit égal à param. Donne modelId (param = keccak256(modelId)).", "Session rail: SessionPay requires each receipt's modelHash to equal param. Give modelId (param = keccak256(modelId))."],
  ["1 jeton (entrée + sortie) ou l'unité que ton service compte dans ses reçus", "1 token (input + output) or the unit your service counts in its receipts"],
  ["1 appel (units du reçu d'appel)", "1 call (the call receipt's units)"],
  ["à chaque paiement : {} % opérateur, {} % auteur (toi), le reste ({} %) au réseau", "on each payment: {0}% operator, {1}% author (you), the rest ({2}%) to the network"],
  ["Empreinte du brouillon (JSON à clés triées) : à recalculer quand l'image et les workloadIds sont figés.", "Fingerprint of the draft (JSON with sorted keys): to compute again once the image and the workloadIds are final."],
  ["v2 : workloadIds peut être vide à la proposition ; une image s'autorise ensuite par proposeWorkload(productId, workloadId) puis applyWorkload après le timelock.", "v2: workloadIds may be empty at proposal; an image is then allowed by proposeWorkload(productId, workloadId), then applyWorkload after the timelock."],
  ["Écrire le service sur le kit d'enclave", "Write the service on the enclave kit"],
  ["Le kit O1 donne /attest, /pubkeys, la signature des reçus et le chiffrement HPKE (fichiers ci-dessus).", "The enclave kit gives /attest, /pubkeys, receipt signing and HPKE encryption (files above)."],
  ["Construire et publier l'image, épinglée par digest", "Build and publish the image, pinned by digest"],
  ["Le digest change les mesures de la VM, donc le workloadId.", "The digest changes the VM's measurements, and so the workloadId."],
  ["Mesurer le workloadId", "Measure the workloadId"],
  ["Lancer l'image sur une VM TDX de test (Phala), lire le quote de POST /attest : workloadId = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ RTMR3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES), le calcul d'EnclaveRegistry.", "Run the image on a test TDX VM (Phala), read the quote from POST /attest: workloadId = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ RTMR3 ‖ MRCONFIGID ‖ XFAM ‖ TDATTRIBUTES), EnclaveRegistry's computation."],
  ["Publier le manifeste", "Publish the manifest"],
  ["L'héberger (manifestURI) et calculer son manifestHash.", "Host it (manifestURI) and compute its manifestHash."],
  ["Ton wallet d'auteur signe ; ProductRegistry rend le productId et ouvre le timelock ({} sur ce réseau, lu on-chain). Aucune transaction n'est envoyée par le copilote.", "Your author wallet signs; ProductRegistry returns the productId and opens the timelock ({0} on this network, read on-chain). No transaction is sent for you."],
  ["Après le timelock, n'importe qui peut l'activer.", "After the timelock, anyone can activate it."],
  ["Des opérateurs inscrivent des enclaves de ton image", "Operators register enclaves of your image"],
  ["Toi compris ({}) : caution, VM, registerEnclave.", "You included ({0}): bond, VM, registerEnclave."],
  ["Chaque règlement te verse bpsAuthor ({} %). Retrait immédiat d'une image fautive : retireWorkload ; nouveau prix : proposeUpdate puis applyUpdate après le timelock.", "Each settlement pays you bpsAuthor ({0}%). Immediate removal of a faulty image: retireWorkload; new price: proposeUpdate, then applyUpdate after the timelock."],
  ["enclave/products/sealed-chat/server.ts (modèle)", "enclave/products/sealed-chat/server.ts (template)"],
  // two source references of the server's copy that the public repository names otherwise
  ["PLAN-BUILD §4.5", "docs/OPERATORS.md"], ["enclave/docker-compose.yml", "enclave/phala/sealed-chat-v21.yml"],
  ["const PARAM = \"{}\"; // = param du produit (keccak256 de « {} »)", "const PARAM = \"{0}\"; // = the product's param (keccak256 of \"{1}\")"],

  // ---- arc_machines_list, arc_machine_diagnostics (ArcHive API)
  ["L'API ArcHive répond 404 sur {} : {}", "The ArcHive API answers 404 on {0}: {1}"],
  ["machine inconnue", "unknown machine"], ["machine inconnue pour cette adresse", "unknown machine for this address"],
  ["paramètre operator attendu (0x + 40 caractères hexadécimaux)", "operator parameter expected (0x + 40 hexadecimal characters)"],
  ["adresse invalide (0x + 40 caractères hexadécimaux)", "invalid address (0x + 40 hexadecimal characters)"],
  ["trop de requêtes ({}) : réessayez dans {} s", "too many requests ({0}): try again in {1} s"],
  ["L'API ArcHive ({}) ne sert pas encore {} (404) : ces routes sont en cours de déploiement.", "The ArcHive API ({0}) does not serve {1} yet (404): these routes are being deployed."],
  ["L'API ArcHive ({}) ne sert pas {} (404).", "The ArcHive API ({0}) does not serve {1} (404)."],
  ["L'API ArcHive ({}) a répondu {} sur {} : {}", "The ArcHive API ({0}) answered {1} on {2}: {3}"],
  ["Réponse non JSON de l'API ArcHive sur {}.", "Non-JSON response from the ArcHive API on {0}."],
  ["API ArcHive injoignable ({}) : {}. Les routes /machines sont en cours de déploiement ; réessaie plus tard.", "ArcHive API unreachable ({0}): {1}. The /machines routes are being deployed; try again later."],
  ["Système non pris en charge : faites tourner le nœud sur une VM Linux x86_64.", "Unsupported system: run the node on a Linux x86_64 VM."],
  ["Node.js absent ou trop ancien : installez Node 22 ou plus récent (ex. nvm install 22), puis relancez le nœud.", "Node.js missing or too old: install Node 22 or newer (e.g. nvm install 22), then restart the node."],
  ["Docker absent ou arrêté : installez Docker Engine (docs.docker.com/engine/install), puis démarrez-le (sudo systemctl enable --now docker).", "Docker missing or stopped: install Docker Engine (docs.docker.com/engine/install), then start it (sudo systemctl enable --now docker)."],
  ["Pas de /dev/tdx_guest : la machine n'est pas une VM Intel TDX ; louez une VM TDX (Phala Cloud, GCP C3, Azure DCesv5) ou lancez `archive-node up --demo` sur testnet.", "No /dev/tdx_guest: the machine is not an Intel TDX VM; rent a TDX VM (Phala Cloud, GCP C3, Azure DCesv5) or run `archive-node up --demo` on testnet."],
  ["Pas d'interface de quote TSM (/sys/kernel/config/tsm/report) : il faut une VM Intel TDX avec un noyau Linux récent (6.7 ou plus), ou passer par dstack (Phala Cloud), ou le mode démo sur testnet.", "No TSM quote interface (/sys/kernel/config/tsm/report): it takes an Intel TDX VM with a recent Linux kernel (6.7 or newer), or dstack (Phala Cloud), or the demo mode on testnet."],
  ["Socket dstack introuvable : en mode dstack, montez /var/run/dstack.sock:/var/run/dstack.sock dans l'app-compose (modèle : enclave/docker-compose.yml) et redéployez.", "dstack socket not found: in dstack mode, mount /var/run/dstack.sock:/var/run/dstack.sock in the app-compose (template: enclave/phala/sealed-chat-v21.yml) and redeploy."],
  ["Socket dstack introuvable : en mode dstack, montez /var/run/dstack.sock:/var/run/dstack.sock dans l'app-compose (modèle : enclave/phala/sealed-chat-v21.yml) et redéployez.", "dstack socket not found: in dstack mode, mount /var/run/dstack.sock:/var/run/dstack.sock in the app-compose (template: enclave/phala/sealed-chat-v21.yml) and redeploy."],
  ["Horloge désynchronisée : synchronisez-la par NTP (sudo timedatectl set-ntp true) ; sinon échéances et ancrage de bloc sont faux.", "Clock out of sync: sync it over NTP (sudo timedatectl set-ntp true); otherwise deadlines and the block anchor are wrong."],
  ["RPC d'Arc injoignable : vérifiez l'accès réseau sortant à https://rpc.testnet.arc.io (pare-feu, DNS, proxy).", "Arc RPC unreachable: check outgoing network access to https://rpc.testnet.arc.io (firewall, DNS, proxy)."],
  ["API ArcHive injoignable depuis la machine : vérifiez l'accès réseau sortant vers {} (pare-feu, DNS).", "ArcHive API unreachable from the machine: check outgoing network access to {0} (firewall, DNS)."],
  ["Port de l'enclave fermé : ouvrez-le (8802 par défaut) dans le pare-feu ou le groupe de sécurité, et publiez-le dans l'app-compose (ports: \"8802:8802\").", "Enclave port closed: open it (8802 by default) in the firewall or the security group, and publish it in the app-compose (ports: \"8802:8802\")."],
  ["Le service d'enclave ne répond pas sur /health : vérifiez que le conteneur tourne (docker ps, docker logs) et redémarrez-le.", "The enclave service does not answer on /health: check that the container is running (docker ps, docker logs) and restart it."],
  ["L'enclave ne renvoie pas de quote (POST /attest) : vérifiez /dev/tdx_guest ou le socket dstack, puis relancez le conteneur ; sans quote, pas d'inscription on-chain.", "The enclave returns no quote (POST /attest): check /dev/tdx_guest or the dstack socket, then restart the container; without a quote, no on-chain registration."],
  ["Caution insuffisante pour le produit : déposez-la sur Network › Louer (/network.html?focus=rent, étape caution) ; {} prépare le dépôt.", "Bond too low for the product: deposit it on Network › Rent (/network.html?focus=rent, bond step); {0} prepares the deposit."],
  ["operator requis : l'adresse 0x… de l'opérateur (ou connecte ton wallet).", "operator required: the operator's 0x… address (or connect your wallet)."],
  ["vérifications en échec : {}", "failing checks: {0}"],
  ["diagnostic en échec", "diagnostics failing"],
  ["enclave pas inscrite on-chain (ou expirée)", "enclave not registered on-chain (or expired)"],
  ["Aucune machine déclarée pour cet opérateur : lance le nœud (archive-node) avec cette adresse d'opérateur.", "No machine declared for this operator: start the node (archive-node) with this operator address."],
  ["Pour le détail et les corrections : machine_diagnostics(machineId).", "For the details and the fixes: arc_machine_diagnostics(machineId)."],
  ["Toutes les machines sont en ligne, diagnostic OK et inscrites.", "All the machines are online, diagnostics OK and registered."],
  ["machineId invalide : « {} » (lettres, chiffres, . _ : - ; 128 caractères au plus).", "invalid machineId: \"{0}\" (letters, digits, . _ : - ; 128 characters at most)."],
  ["attendu en mode démo (quote simulé, accepté seulement sur testnet)", "expected in demo mode (simulated quote, accepted on testnet only)"],
  ["sans effet en mode {} : le quote passe par l'autre voie et l'attestation fonctionne", "no effect in {0} mode: the quote goes the other way and the attestation works"],
  ["Vérification inconnue : lire le détail (« {} ») et le journal ci-dessous.", "Unknown check: read the detail (\"{0}\") and the log below."],
  ["{} Lu on-chain : caution disponible {} pour un minimum de {} (produit #{}), il manque {}.", "{0} Read on-chain: available bond {1} for a minimum of {2} (product #{3}), {4} missing."],
  ["{} Mais lu on-chain : ta caution disponible ({}) couvre déjà le minimum du produit #{} ({}) : le diagnostic date sans doute d'avant ton dépôt, relance-le.", "{0} But read on-chain: your available bond ({1}) already covers the minimum of product #{2} ({3}): the diagnostics probably date from before your deposit, run them again."],
  ["Le nœud n'a envoyé aucun diagnostic (doctor) : relance-le pour qu'il fasse ses vérifications.", "The node has sent no diagnostics (doctor): restart it so that it runs its checks."],
  ["Diagnostic OK ({}/{} vérifications réussies{}).", "Diagnostics OK ({0}/{1} checks passed{2})."],
  [", {} échec(s) normal(aux) en mode {}", ", {0} normal failure(s) in {1} mode"],
  ["{} vérification(s) à corriger : {}.", "{0} check(s) to fix: {1}."],
  ["state : {}", "state: {0}"],
];

/** French phrases inside code, commands and app-compose files (and placeholders inside longer values), replaced in place. */
const FRAGMENTS: Pair[] = [
  ...RAILS,
  ["# app-compose (Phala Cloud dstack) — modèle : enclave/docker-compose.yml du dépôt", "# app-compose (Phala Cloud dstack) — templates: enclave/phala/*.yml in the repository"],
  ["# app-compose (Phala Cloud dstack) — modèles : enclave/phala/*.yml du dépôt", "# app-compose (Phala Cloud dstack) — templates: enclave/phala/*.yml in the repository"],
  ["  produit:", "  product:"],
  ["# l'image du manifeste du produit (son workloadId doit être autorisé)", "# the image of the product's manifest (its workloadId must be allowed)"],
  ["# variable chiffrée : TON adresse d'opérateur (sans elle, /attest refuse tout)", "# encrypted variable: YOUR operator address (without it, /attest refuses everything)"],
  ["# EN CLAIR (mesuré) : l'unité facturée du produit", "# IN PLAIN TEXT (measured): the product's billed unit"],
  ["# agent invité dstack : le vrai quote TDX", "# dstack guest agent: the real TDX quote"],
  ["# variable chiffrée : l'adresse de l'opérateur", "# encrypted variable: the operator's address"],
  ["# TOUJOURS par digest : le workloadId en dépend", "# ALWAYS by digest: the workloadId depends on it"],
  ["# app-compose Phala Cloud (dstack, VM Intel TDX) — ", "# Phala Cloud app-compose (dstack, Intel TDX VM) — "],
  [" [À VÉRIFIER : CLI Phala]", ""],
  ["<id rendu par propose()>", "<id returned by propose()>"],
  ["<registre>/<image>", "<registry>/<image>"],
  ["<bloc récent>", "<recent block>"],
  ["<ta-vm>", "<your-vm>"],
  ["<id du produit>", "<product id>"],
  ["<ton adresse>", "<your address>"],
  ["<toi>", "<you>"],
  ["<ta clé PUBLIQUE X25519 (0x + 64 hex), générée chez toi>", "<your PUBLIC X25519 key (0x + 64 hex), generated on your side>"],
  ["archive-produit-", "archive-product-"],
  [" injoignable", " unreachable"],
  [" — service d'enclave (produit tiers) bâti sur le kit O1 d'ArcHive (dossier enclave/ du dépôt). */", ": an enclave service (a third-party product) built on ArcHive's enclave kit (enclave/ in the repository). */"],
  ["// rendu par propose()", "// returned by propose()"],
  ["// = param du produit", "// = the product's param"],
  ["// null hors VM TDX : quote simulé", "// null outside a TDX VM: simulated quote"],
  ["// 1) lire la session on-chain (SessionPay.getSession) et vérifier la signature de la clé de session sur l'enveloppe", "// 1) read the session on-chain (SessionPay.getSession) and check the session key's signature on the envelope"],
  ["// 1) sans paiement : répondre 402 avec les exigences x402 ; avec l'en-tête X-PAYMENT : vérifier l'autorisation (voir enclave/src/services/x402.ts)", "// 1) without payment: answer 402 with the x402 requirements; with the X-PAYMENT header: check the authorization (see enclave/src/services/x402.ts)"],
  ["// 2) déchiffrer la requête : await kit.open(enc, ciphertext)  (HPKE vers la clé X25519 attestée)", "// 2) decrypt the request: await kit.open(enc, ciphertext)  (HPKE to the attested X25519 key)"],
  ["// 3) faire le travail du service", "// 3) do the service's work"],
  [" (déterministe : même entrée, même sortie, rejouable)", " (deterministic: same input, same output, replayable)"],
  ["// 4) reçu cumulatif signé : await kit.signReceipt(", "// 4) signed cumulative receipt: await kit.signReceipt("],
  ["// 4) reçu d'appel signé (CallReceipt : productId, payer, requestHash, responseHash, units, anchorBlock, nonce), réglé par X402Settler.settle", "// 4) signed call receipt (CallReceipt: productId, payer, requestHash, responseHash, units, anchorBlock, nonce), settled by X402Settler.settle"],
  ["// 5) chiffrer la réponse vers la clé éphémère du client : await kit.seal(clientPub, réponse)", "// 5) encrypt the answer to the client's ephemeral key: await kit.seal(clientPub, answer)"],
  ["{ error: \"à implémenter\" }", "{ error: \"not implemented\" }"],
  ["// sur ta machine ou dans ton navigateur : ton wallet signe l'autorisation EIP-3009, puis envoie la transaction", "// on your machine or in your browser: your wallet signs the EIP-3009 authorization, then sends the transaction"],
  ["// @arcvault/sdk : le niveau vérifié", "// @arcvault/sdk: the verified level"],
  ["// garde kp.privateKey en lieu sûr, chez toi", "// keep kp.privateKey safe, on your side"],
  ["\"reçu vérifié on-chain :\"", "\"receipt verified on-chain:\""],
  ["\"| unités cumulées :\"", "\"| cumulative units:\""],
];

/** The secrets filter's masks (services/copilot/src/secrets.ts), said in English in the final text. */
const MASKS: Pair[] = [
  ["[clé masquée]", "[key masked]"],
  ["[phrase de récupération masquée]", "[recovery phrase masked]"],
  ["[valeur masquée par prudence]", "[value masked as a precaution]"],
];

// ------------------------------------------------------------------------------------------------ matching

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EXACT = new Map<string, string>();
const PATTERNS: Array<{ re: RegExp; en: string; weight: number }> = [];
for (const [fr, en] of TEXTS) {
  if (!fr.includes("{}")) { if (!EXACT.has(fr)) EXACT.set(fr, en); continue; }
  const parts = fr.split("{}");
  PATTERNS.push({ re: new RegExp(`^${parts.map(esc).join("([\\s\\S]*?)")}$`), en, weight: parts.join("").length });
}
// the most specific texts first (the longest fixed part), so that "produit #{} : {}" wins over "produit {}"
PATTERNS.sort((a, b) => b.weight - a.weight);

/** A duration of the copilot's (arc-actions.ts duree: "7 j", "1 j 6 h", "13 h 38 min", "45 s"), in English. */
const DURATION = /^(\d+) j( \d+ h)?$/;

function fill(en: string, caps: string[], depth: number): string {
  return en.replace(/\{(\d+)\}/g, (_m, i: string) => englishValue(caps[Number(i)] ?? "", depth + 1));
}

function fragments(line: string): string {
  let out = line;
  for (const [fr, en] of FRAGMENTS) if (out.includes(fr)) out = out.split(fr).join(en);
  return out;
}

function one(s: string, depth: number): string {
  const exact = EXACT.get(s);
  if (exact !== undefined) return exact;
  const d = DURATION.exec(s);
  if (d) return `${d[1]} ${d[1] === "1" ? "day" : "days"}${d[2] ?? ""}`;
  if (depth < 8 && /[^\x00-\x7F]|[a-z]/i.test(s)) {
    for (const p of PATTERNS) {
      const m = p.re.exec(s);
      if (m) return fill(p.en, m.slice(1), depth);
    }
  }
  // a list the copilot joins with " ; " (a machine's reasons to look at it): each part in English
  if (depth < 8 && s.includes(" ; ")) {
    const parts = s.split(" ; "), en = parts.map((x) => one(x, depth + 1));
    if (en.some((x, i) => x !== parts[i])) return en.join("; ");
  }
  return fragments(s);
}

/** One value in English: the whole value when it is one of the copilot's texts, otherwise line by line. */
export function englishValue(s: string, depth = 0): string {
  if (typeof s !== "string" || s === "") return s;
  if (!s.includes("\n")) return one(s, depth);
  return s.split("\n").map((line) => one(line, depth)).join("\n");
}

/** The final text sent to the agent: the secrets filter's masks in English. */
export function englishOutput(text: string): string {
  let out = text;
  for (const [fr, en] of MASKS) if (out.includes(fr)) out = out.split(fr).join(en);
  return out;
}

/** For the tests: the French texts this module translates (whole values and fragments). */
export const FRENCH_TEXTS: readonly string[] = [...TEXTS.map(([fr]) => fr), ...FRAGMENTS.map(([fr]) => fr)];
