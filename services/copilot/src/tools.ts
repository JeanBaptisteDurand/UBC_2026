/** tools.ts — les outils du copilote (§5 du plan). Lectures + actions PRÉPARÉES (jamais exécutées :
 *  l'utilisateur signe). Tout chiffre vient d'un outil ; aucune clé privée en conversation.
 *  La logique on-chain des nouveaux outils est dans arc-actions.ts (partagée avec le serveur MCP). */
import { type ArcClient, testnet, normalizeReceipt } from "@arcvault/sdk";
import { formatUnits, type Address, type Hex } from "viem";
import {
  enclaveStatus, sessionStatus, bountyList, prepareBountyCreate, prepareSessionOpen, operatorPlan, prepareBond,
  prepareRegister, productScaffold, inferenceTest, machinesList, machineDiagnostics, productsCached, enclavesCached, railOf,
  parseUsdc, enclavesList, productsList, sessionsList, activityList, isListUnavailable, type ActionCtx,
} from "./arc-actions";
import { apiStats, apiIndexStatus } from "./archive-api";
import { parsePrefixes } from "./net-guard";

// Petite base de connaissances (RAG par mots-clés) : nos faits, cités en source.
/** État RÉEL de la vérification sur le déploiement en ligne (même champ que le site) : jamais de sur-promesse. */
export const VERIFICATION_STATE = testnet.attestation === "dcap"
  ? "Réponse courte : oui, la vérification est réelle. Sur le déploiement en ligne, le registre d'enclaves appelle le TdxAttestationModule, branché sur la pile DCAP d'Automata déployée sur Arc testnet ; la chaîne vérifie la signature d'Intel sur chaque quote (collatéral d'Intel chargé on-chain), puis applique la politique (TCB, DEBUG, image autorisée, liaison REPORTDATA). Une vérification coûte ≈ 5,1 M gas, 0,108 USDC."
  : "Réponse courte : non, pas sur ce déploiement : son registre utilise un MODULE DE TEST qui enregistre les mesures du quote sans vérifier la signature d'Intel. La pile v2 (deployments.v2.testnet.json), elle, vérifie chaque quote par DCAP.";

export const KB: Array<{ source: string; text: string; tags?: string }> = [
  { source: "deploiement#verification", tags: "verification reelle vraie simulee simulation mock module test attestation dcap automata intel signature quote verifie verifiee confiance honnete etat deploiement v1 v2",
    text: VERIFICATION_STATE },
  { source: "README#tdx", text: "Une enclave est refusée si son attestation est en mode DEBUG (bit DEBUG de tdAttributes), si l'image (workloadId) n'est pas autorisée par le produit, si le TCB n'est pas acceptable, ou si l'ancrage de bloc (EIP-2935) ne correspond pas. On échoue fermé." },
  { source: "README#x402", text: "Deux rails de paiement : les sessions prépayées (SessionPay, verrouillées sur une enclave ; un règlement paie une boucle de 100 appels) et le paiement à l'appel x402 (X402Settler, EIP-3009 + preuve d'enclave). Le gas sur Arc est de l'USDC." },
  { source: "README#bounty", text: "La Prime scellée (SealedBounty) paie une preuve d'exploit dans la même transaction, sinon rien. L'exploit est rejoué dans une enclave contre une cible jetable (DemoVault)." },
  { source: "README#verdicts", text: "Chaque verdict vérifié est écrit dans le registre de validation ERC-8004 de Circle (100 = vérifié et payé, 0 = faute saisie)." },
  { source: "README#operator", text: "Devenir opérateur : déposer une caution en USDC (OperatorBond), déployer l'enclave (VM Intel TDX Phala), appeler /attest, puis registerEnclave. La caution est saisie en cas de double signature. Deux niveaux d'opérateur depuis le 10/11 : ouvert (attestation + caution) et vérifié (machine déclarée en datacenter connu) ; voir docs/OPERATORS.md." },
  { source: "docs/OPERATORS.md#niveaux", tags: "niveau niveaux verifie verifiee ouvert proof cloud alliance datacenter puce ppid auditeur verificateur machine politique policy partenaire louer tee.fail battering ram wiretap physique prix peage produit 7",
    text: "Deux niveaux d'opérateur (décision du 10/11/2026). OUVERT : n'importe qui fait tourner une enclave ; un contrat d'Arc vérifie l'attestation d'Intel (DCAP), l'image et la liaison des clés ; l'opérateur dépose une caution en USDC. VÉRIFIÉ : en plus, la PUCE de la machine (son PPID, lu ON-CHAIN dans le certificat PCK d'Intel du quote inscrit : MachineRegistry.bindMachine) est déclarée en datacenter connu par un VÉRIFICATEUR que le produit accepte. Pourquoi : les attaques physiques de 2025 (TEE.fail, Battering RAM, Wiretap) extraient des clés d'attestation avec un accès physique au serveur. Vérificateur de référence : l'alliance Proof of Cloud (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis…), qui inspecte les machines ; son jeton cosigné (EdDSA) est vérifié SUR LA CHAÎNE par ProofOfCloudAuditor (0xcdc4c150344f06d506deb5500332737e8dcc8fab). N'importe qui peut être vérificateur (son adresse est son identité) ; c'est l'AUTEUR du produit qui choisit le niveau minimum et les vérificateurs acceptés (MachineRegistry 0xd671013f556b1272b25e3cc17c889d402f4dc26d, timelock du produit). Prix libre : un opérateur vérifié peut vendre plus cher, le protocole ne prend aucun péage. Les contrats de règlement branchés sur PolicyEnclaves (0x665f4bb3c31d23463f45e4092487f6b498490417) appliquent la politique. Produit 7 « Prime scellée au niveau vérifié » : exige le niveau vérifié (alliance Proof of Cloud) ; sa Prime (0x36a8ddf9fcb1308b9e86425bec9b098e933c7348) peut saisir des cautions et écrire des verdicts à partir du 18/11/2026 23:00 UTC (tout nouveau contrat de règlement attend 8 jours : chaque opérateur peut partir avant). État au 11/11 : toutes les enclaves d'ArcHive sont au niveau vérifié (une seule machine Phala, PPID 62d54040…). Kit : arcvault operator bind-machine / proof-of-cloud / level ; arcvault auditor attest / revoke ; arcvault product policy ; API GET /levels ; le registrar garde le niveau (reliaison après chaque renouvellement, jeton avant expiration). Limites : une révocation par l'alliance n'arrive sur la chaîne qu'à l'expiration de la déclaration (7 jours au plus) ; le quorum de réfutation compte des opérateurs distincts, pas encore des machines distinctes." },
  { source: "enclave/model-attestation#fournisseur", tags: "modele fournisseur redpill passerelle gateway lire lit qui conversation requete question confidentialite confidentiel tinfoil attestation tls epingle recu gpt-oss",
    text: "Le fournisseur du modèle est VÉRIFIÉ (depuis le 11/11/2026), pas cru : avant tout appel, l'enclave (inférence, x402 et ce copilote) vérifie la passerelle de RedPill (Attested Confidential Inference, avec @phala/aci-verifier de Phala) : quote Intel TDX vérifié jusqu'à la racine d'Intel, clés de la passerelle liées au quote pour un nonce frais, compose mesuré dans RTMR3, et (contrôle d'ArcHive) image système de PRODUCTION ; chaque appel part en TLS épinglé sur la clé attestée, et chaque réponse exige un reçu de la passerelle citant un service amont vérifié (gpt-oss-120b, servi dans une enclave GPU). Si la passerelle n'est pas vérifiée, l'enclave ne démarre pas. Donc : la requête n'est lue que par des enclaves attestées (celle d'ArcHive, la passerelle et le service amont), ni par leurs opérateurs ni par nous. Restent de confiance : le code ouvert de la passerelle (compose mesuré, version non épinglée), sa vérification de l'amont, le PCCS de Phala, la garde des clés par le KMS de dstack. État public : GET /model-attestation sur chaque enclave (via le site : /enclave/inference/model-attestation, /enclave/x402/model-attestation, /enclave/copilot/model-attestation)." },
  { source: "enclave/rpc-relay#preuves-etat", tags: "preuve preuves etat state proof getproof rpc noeud node fork rejeu replay mentir menteur stateroot merkle anvil",
    text: "Rejeu de la Prime : l'enclave ne parle à la chaîne qu'au travers d'un RELAIS STRICT (en-têtes de bloc recalculés sur leurs 21 champs et chaînés à l'ancre vérifiée on-chain ; toute réponse douteuse fait échouer le rejeu, rien n'est signé). Le produit 7 PEUT aussi prouver l'ÉTAT (chaque solde, nonce, code, case lu au bloc N = un eth_getProof EIP-1186 vérifié contre le stateRoot de l'en-tête N ancré, aucun RPC de confiance ; code écrit et testé, 23 tests), mais c'est DÉSACTIVÉ aujourd'hui (12/11) : aucun RPC public d'Arc ne sert les preuves en historique et notre nœud d'Arc ne tient pas sur le disque du VPS (290 Go). Ça se rallume avec un disque plus grand ou un RPC d'archives ; le NIVEAU VÉRIFIÉ lui-même est pleinement en service. Le produit 2 (niveau ouvert) lit l'état sans preuve (en-têtes seulement)." },
  { source: "README#pages", text: "Les pages du site (identifiant pour ui_navigate entre crochets ; les nommer avec le libellé de la langue de l'utilisateur, voir la consigne LANGUE) : Vue d'ensemble [vue] (chaîne de preuves, chiffres du réseau, activité), Ruche [ruche] (les enclaves actives, cliquables pour commander leur produit), Produits [produits] (le catalogue), Primes [primes] (primes ouvertes, chasser), IA privée [playground] (conversation chiffrée vers une enclave d'inférence), Clés et sessions [cles] (clés d'accès aek_, clés opérateur arcop_, sessions), Publier une prime [publier-prime], Opérateur [operateur] (caution, brancher une machine, l'inscrire), Publier un produit [publier-produit], Portefeuille [portefeuille] (soldes, caution, rapatrier de l'USDC par CCTP), Développeurs [developpeurs] (API, SDK, CLI, MCP, contrats). Le copilote vit dans une bulle en bas à droite et ouvre ces pages lui-même." },
  { source: "OperatorBond.sol#caution", tags: "caution bond operateur fournisseur slash saisie retrait unbond exposition plafond equivocation double signature banni bannissement denonciateur victime",
    text: "Caution d'opérateur (OperatorBond) : l'opérateur dépose de l'USDC (bond avec une autorisation EIP-3009, ou approve puis bondFrom). Exposition plafonnée : sur une fenêtre de 24 h et par produit, les paiements pris sur la foi de ses enclaves ne peuvent pas dépasser la moitié de sa caution disponible (sinon revert TooMuchExposure). Retrait en deux temps : requestUnbond(montant), puis withdraw() après 7 jours (UNBOND_DELAY). Double signature prouvée (equivocation : deux reçus différents pour la même session et le même seq, ou deux réclamations différentes pour la même empreinte de prime) = saisie de toute la caution et bannissement ; 50 % au dénonciateur, 50 % à la victime (à la trésorerie du réseau s'il n'y a pas de victime). Inscrire une enclave exige une caution disponible au moins égale à la caution minimale du produit." },
  { source: "SessionPay.sol#_split", tags: "commission commissions frais parts part bps bpsoperator bpsauthor bpsnetwork auteur reseau tresorerie partage revenu gagner remuneration",
    text: "Commissions : chaque produit fixe trois parts en points de base, bpsOperator (opérateur), bpsAuthor (auteur du produit) et bpsNetwork (réseau), dont la somme doit faire exactement 10 000 (sinon propose revert BadShares). À chaque règlement (SessionPay ou X402Settler), l'opérateur reçoit montant × bpsOperator / 10 000, l'auteur montant × bpsAuthor / 10 000, et le reste va à la trésorerie du réseau (il absorbe la poussière d'arrondi). Les parts de chaque produit se lisent avec products_list." },
  { source: "SealedBounty.sol#claim", tags: "prime primes bounty chasseur hunter palier paliers tier recompense frais reseau operateurs paiement revert singlecap economie",
    text: "Économie de la Prime scellée : le chasseur reçoit 100 % du montant du palier atteint ; en plus, prélevés sur le pool de la prime, +10 % pour le réseau (networkBountyBps) et +5 % répartis entre les k opérateurs dont les enclaves ont vérifié l'exploit (operatorBountyBps). Paiement v2 en deux temps : acceptClaim vérifie la preuve et RÉSERVE le paiement (le rapport chiffré n'est pas dans cette transaction), puis deliver, ouvert à tous, livre le rapport au protocole et paie (refus : pool insuffisant, prédicat ou ancrage faux, empreinte déjà payée, palier déjà payé depuis le dernier armement). Une réservation non livrée retourne au pool après 24 h ; une réclamation fausse se réfute pendant 3 jours. Au-delà de singleCap, il faut les signatures de k opérateurs distincts (5 au plus)." },
  { source: "SessionPay.sol+X402Settler.sol#rails", tags: "rail rails paiement payer session sessions prepayee x402 appel recu recus cumulatif reglement settle depot remboursement",
    text: "Deux rails de paiement. SessionPay : session prépayée en USDC (dépôt par EIP-3009), VERROUILLÉE à l'ouverture sur une enclave (seuls ses reçus paient), avec le prix, le modèle et l'unité du produit à ce moment, servie contre une clé de session ; l'enclave signe des reçus cumulatifs et un seul règlement (settle, sans permission) paie le delta depuis le précédent, borné par le dépôt et le plafond : une transaction par règlement, jamais une par message ; closeSession rembourse le reste après l'échéance + 1 h. X402Settler : paiement à l'appel (x402 « exact »), une autorisation EIP-3009 dont le nonce lie le paiement au reçu d'appel signé par l'enclave ; encaissement, partage et exposition dans la même transaction." },
  { source: "enclave/services/inference.ts#unites", tags: "unite unites jeton jetons token tokens prix requete cout combien",
    text: "Inférence : unités = ceil((jetons de la question + outWeight × jetons de la réponse) / unitTokens), sur le cumul de la session ; sur le produit d'inférence actuel (unitTokens = outWeight = 1), chaque jeton compte pour 1 unité. Coût d'une requête ≈ (jetons de la question + jetons de la réponse) × prix par unité (pricing_quote). Si le cumul dépasse le dépôt, l'enclave répond 402 insufficient_session_balance avec le solde ; une réponse déjà calculée est gardée jusqu'à la recharge. Avant tout envoi, le client vérifie que la clé de chiffrement de l'enclave est celle inscrite on-chain." },
  { source: "PLAN-BUILD§4.1#cles", tags: "cle cles aek session acces api privee revocation rotation rotatekey fuite volee",
    text: "Clé d'accès = clé de session : générée dans le navigateur (ou le SDK) à l'ouverture de la session, sa clé publique est inscrite on-chain ; la clé privée (format aek_<réseau>_<sessionId>_<secret>) reste chez le développeur, jamais chez nous ni chez l'opérateur. Elle ne peut pas dépenser plus que le solde de sa session. Révocation : closeSession (rembourse le reste) ou rotateKey(nouvelle clé publique)." },
  { source: "EnclaveRegistry.sol#politique", tags: "debug refus refuse refusee politique tcb workload workloadid reportdata ancrage attestation quote echoue ferme inscription",
    text: "Politique d'inscription « on échoue fermé » (EnclaveRegistry) : quote Intel TDX valide (v4/v5) ; TCB à jour (ou SW_HARDENING_NEEDED si tous les avis sont tolérés par le produit) ; bit DEBUG de tdAttributes à 0 — en mode DEBUG, l'hôte peut lire la mémoire de l'enclave, la confidentialité tombe, donc revert DebugEnclave ; workloadId autorisé par le produit ; REPORTDATA liant chaîne, registre, produit, opérateur et clés ; ancrage sur un bloc récent (EIP-2935) ; un quote ne sert qu'une fois ; inscription valable VALIDITY_BLOCKS blocs (≈ 24 h), prolongée par une réattestation sans trou ; une clé est liée à vie à son opérateur et à son produit, et chaque clé réserve la caution minimale du produit." },
  { source: "ProductRegistry.sol#auteur", tags: "produit service auteur publier propose activate timelock manifeste workload image squelette scaffold propre",
    text: "Publier son propre service (auteur) : propose(manifestHash, manifestURI, workloadIds, deterministic, price, bpsOperator, bpsAuthor, bpsNetwork, minBond, exposureCap, settlement, param, advisoryIds) ; les trois parts doivent faire 10 000 ; activation par activate après le timelock ; retrait immédiat d'une image fautive (retireWorkload) ; changement de prix ou de paramètre par proposeUpdate puis applyUpdate après le timelock." },
  { source: "predicate.ts#v0", tags: "predicat predicate clause erc20_drop native_drop attacker_profit view_changed invariant_broken hash prime exploit",
    text: "Langage de prédicats v0 de la Prime scellée : ERC20_DROP (le solde d'un jeton d'un contrat baisse d'au moins min), NATIVE_DROP, ATTACKER_PROFIT (profit de l'attaquant), VIEW_CHANGED (une lecture change), INVARIANT_BROKEN ; 1 à 8 clauses combinées par AND ou OR. Le JSON canonique (clés triées) est haché (predicateHash) et épinglé on-chain : le protocole publie ce JSON, l'enclave vérifie son hash." },
  { source: "site#cles", tags: "cle cles api key aek creer obtenir programme programmatique boucle script mandataire proxy openai python sdk appeler",
    text: "OUI, il existe des clés d'API : page « Clés et sessions » (cles). « Créer une clé » ouvre une session prépayée sur une enclave d'inférence active (dépôt en USDC = plafond de dépense, échéance) et affiche UNE fois la clé aek_<réseau>_<session>_<secret>, née dans le navigateur. Pour appeler l'IA en boucle depuis n'importe quel programme : lancer le mandataire local compatible OpenAI (dossier packages/cli : npm run arcvault -- proxy --key aek_… --enclave <url>) puis garder son client OpenAI avec base_url=http://localhost:8787/v1 ; ou le SDK TypeScript (createInferenceClient). La même page gère recharge, changement de clé, clôture, et les clés opérateur arcop_." },
  { source: "site#developpeurs", tags: "developpeur developpeurs sdk cli mcp api rest documentation adresses contrats integrer integration agent claude serveur",
    text: "Page « Développeurs » (developpeurs) : API de lecture publique en JSON (/stats, /proof, /activity, /enclaves, /products, /bounties, /pricing, /sessions/:adresse) ; SDK TypeScript @arcvault/sdk (createArcClient, createInferenceClient) ; CLI arcvault (session, bounty, operator, product, proxy, verify) ; serveur MCP pour les agents (configuration : command node, args [<dépôt>/deploy/mcp.mjs]) qui expose les outils du copilote en lecture et en actions préparées ; adresses des contrats sur Arc testnet ; routes de l'enclave (/pubkeys, /v1/models, /attest, /v1/chat/completions, /v1/session/:id)." },
  { source: "site#operateur-machine", tags: "machine nue brancher installer archive-node install pair appairer code hive doctor up tunnel demo louer puissance arcop operateur cle agent",
    text: "Louer sa machine (page operateur) : 1) déposer une caution ; 2) sur la machine : curl -fsSL <site>/install.sh | sh, puis archive-node doctor (vérifie TDX, Docker, horloge, réseau), archive-node pair (affiche un code HIVE-XXXX à approuver sur le site en signant avec son wallet — aucune transaction), archive-node up --product 1 --tunnel (seulement sur une VM Intel TDX : une machine sans TDX est refusée, il n'y a pas de mode démo) ; 3) dans « Vos machines », Inscrire (la chaîne vérifie la signature d'Intel sur le quote, par DCAP) ou Déboguer avec le copilote. La machine reçoit une clé opérateur arcop_ : elle rend compte et se diagnostique, mais ne peut ni dépenser ni retirer la caution." },
];

export interface ToolCtx { arc: ArcClient; user?: Address; }

export const TOOL_DEFS = [
  { name: "docs_search", description: "Cherche dans la documentation du réseau et renvoie des passages cités.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "products_list", description: "Liste les produits ACTIFS de la place de marché (prix, parts, règlement, caution minimale), lus par l'API ArcHive. Si la liste est momentanément indisponible, dis-le : ne la reconstitue jamais de mémoire.", input_schema: { type: "object", properties: {} } },
  { name: "products_get", description: "Détail d'un produit.", input_schema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] } },
  { name: "pricing_quote", description: "Estime le coût d'un usage (unités × prix). Inférence : chaque jeton de la question et de la réponse compte 1 unité (une requête en consomme beaucoup). Avec budget (USDC par requête), rend le nombre de jetons qu'il couvre.", input_schema: { type: "object", properties: { productId: { type: "string" }, units: { type: "string" }, budget: { type: "string", description: "budget en USDC par requête, ex. \"0.10\"" } }, required: ["productId", "units"] } },
  { name: "session_prepare_open", description: "Prépare l'ouverture d'une session : choisit un opérateur actif et renvoie les données EIP-3009 à SIGNER (jamais exécuté).", input_schema: { type: "object", properties: { productId: { type: "string" }, operator: { type: "string" }, deposit: { type: "string", description: "dépôt en USDC, ex. \"1\"" }, user: { type: "string" } }, required: ["productId", "deposit"] } },
  { name: "snippet_generate", description: "Code d'exemple SDK pour appeler l'inférence en boucle (clé masquée).", input_schema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] } },
  { name: "receipt_verify", description: "Vérifie un reçu comme SessionPay.settle : signataire = enclave verrouillée de la session, active au bloc d'ancrage chez son opérateur, modèle verrouillé, cumul croissant ; et ce que le règlement verserait.", input_schema: { type: "object", properties: { receipt: { type: "object" }, signature: { type: "string" } }, required: ["receipt", "signature"] } },
  { name: "enclaves_list", description: "Liste les enclaves de la ruche (hive) d'après l'index de l'API ArcHive : signataire, opérateur, produit, état (active ou expirée), TCB, fenêtre de validité ; dit jusqu'à quel bloc l'index est complet. Si la liste est momentanément indisponible, dis-le.", input_schema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = seulement les enclaves actives" } } } },
  { name: "sessions_list", description: "Liste les sessions SessionPay (clés d'accès aek_) ouvertes par un compte, d'après l'index de l'API ArcHive : produit, dépôt, déjà réglé, reste, fermée, échéance. Défaut : le wallet connecté. Lecture seule.", input_schema: { type: "object", properties: { owner: { type: "string", description: "adresse 0x… du compte (défaut : wallet connecté)" } } } },
  { name: "activity_list", description: "L'activité on-chain récente des contrats du réseau (inscriptions d'enclaves, sessions, règlements, primes, verdicts), du plus récent au plus ancien, d'après l'index de l'API ArcHive.", input_schema: { type: "object", properties: { limit: { type: "number", description: "nombre d'événements (1 à 50, défaut 10)" } } } },
  { name: "enclaves_status", description: "État d'UNE enclave par son signataire (adresse de sa clé) : opérateur, produit, TCB, expiration, active ou non, et caution de l'opérateur (totale, disponible, exposition 24 h sur ce produit). Lecture on-chain.", input_schema: { type: "object", properties: { signer: { type: "string", description: "adresse 0x… du signataire de l'enclave" } }, required: ["signer"] } },
  { name: "session_status", description: "État d'une session SessionPay par son id : propriétaire, produit, opérateur, dépôt, déjà payé, reste, échéance, fermée. Lecture on-chain.", input_schema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] } },
  { name: "bounty_list", description: "Liste les primes scellées (id, protocole, produit, solde en USDC, échéance, pause, ouverte ou non). Avec bountyId : détail d'une prime et de ses paliers. Lecture on-chain.", input_schema: { type: "object", properties: { onlyOpen: { type: "boolean", description: "true = seulement les primes ouvertes" }, bountyId: { type: "string" } } } },
  { name: "bounty_prepare_create", description: "PRÉPARE la création d'une prime scellée (jamais envoyée). Assistant de prédicat : « le solde USDC du contrat X baisse d'au moins T » donne une clause ERC20_DROP. Renvoie le prédicat et son hash, les paliers et les frais lus on-chain, les paramètres de createBounty et l'autorisation EIP-3009 que le protocole SIGNE. S'il manque des informations, il les liste (aCompleter).", input_schema: { type: "object", properties: {
    target: { type: "string", description: "contrat surveillé (ex. le coffre du protocole)" },
    minDrop: { type: "string", description: "baisse minimale qui prouve l'exploit, en USDC (ex. \"1\")" },
    reward: { type: "string", description: "récompense du chasseur en USDC (un seul palier)" },
    tiers: { type: "array", description: "plusieurs paliers [{ minLoss, amount }] en USDC", items: { type: "object", properties: { minLoss: { type: "string" }, amount: { type: "string" } } } },
    funding: { type: "string", description: "financement initial en USDC (défaut : un paiement du plus haut palier, frais compris)" },
    clauseType: { type: "string", enum: ["ERC20_DROP", "NATIVE_DROP", "ATTACKER_PROFIT"] },
    token: { type: "string", description: "jeton surveillé (défaut : l'USDC d'Arc)" },
    predicate: { type: "object", description: "prédicat complet { combine, clauses } (usage avancé)" },
    deadlineDays: { type: "number" }, k: { type: "number" }, singleCap: { type: "string" },
    targetToPause: { type: "string", description: "contrat à mettre en pause automatiquement (optionnel)" },
    protocolX25519: { type: "string", description: "clé PUBLIQUE X25519 du protocole (jamais la privée)" },
    productId: { type: "string" }, from: { type: "string", description: "wallet du protocole (défaut : wallet connecté)" },
  } } },
  { name: "operator_plan", description: "Plan pas à pas pour devenir opérateur (fournisseur d'enclave) : VM Intel TDX sur Phala, app-compose, /attest, caution, registerEnclave, renouvellement ; règles de la caution (exposition, retrait, saisie) avec les chiffres lus on-chain.", input_schema: { type: "object", properties: { operator: { type: "string", description: "adresse de l'opérateur (défaut : wallet connecté)" }, productId: { type: "string" } } } },
  { name: "operator_prepare_bond", description: "PRÉPARE le dépôt de caution d'un opérateur (jamais envoyé) : autorisation EIP-3009 à signer pour bond(), ou approve + bondFrom encodés ; vérifie le solde, le bannissement et la caution minimale du produit.", input_schema: { type: "object", properties: { amount: { type: "string", description: "montant en USDC (défaut : ce qui manque pour la caution minimale du produit)" }, productId: { type: "string" }, operator: { type: "string" } } } },
  { name: "operator_prepare_register", description: "PRÉPARE l'inscription d'une enclave (jamais envoyée) : bloc d'ancrage, lecture du /attest de la VM si son URL est donnée, paramètres de registerEnclave que l'opérateur signe ; vérifie caution, produit et quote.", input_schema: { type: "object", properties: { productId: { type: "string" }, enclaveUrl: { type: "string", description: "URL publique de la VM (sert /attest)" }, operator: { type: "string" } }, required: ["productId"] } },
  { name: "product_scaffold", description: "Squelette d'un produit tiers (faire tourner son propre service) : conteneur + kit d'enclave, app-compose, manifeste, paramètres de propose(), puis timelock et activate. Appelle-le TOUT DE SUITE, même sans aucun paramètre : nom provisoire, prix et parts repris d'un produit existant (lus on-chain), à ajuster ensuite. Les parts bpsOperator + bpsAuthor + bpsNetwork doivent faire 10 000.", input_schema: { type: "object", properties: {
    name: { type: "string" }, description: { type: "string" }, rail: { type: "string", enum: ["session", "x402"] },
    deterministic: { type: "boolean" }, price: { type: "string", description: "prix par unité en USDC" },
    bpsOperator: { type: "number" }, bpsAuthor: { type: "number" }, bpsNetwork: { type: "number" },
    minBond: { type: "string" }, exposureCap: { type: "string" }, modelId: { type: "string" }, image: { type: "string" },
  } } },
  { name: "inference_test", description: "Prépare un appel d'inférence de TEST sans jamais toucher la clé de session : vérifie l'enclave (et la session) on-chain et renvoie le code que l'utilisateur lance dans son navigateur ou sur sa machine (SDK, mandataire local).", input_schema: { type: "object", properties: { productId: { type: "string" }, sessionId: { type: "string" }, enclaveUrl: { type: "string" }, prompt: { type: "string" } } } },
  { name: "machines_list", description: "Liste les machines (nœuds) d'un opérateur d'après l'API ArcHive : mode (tdx, dstack), en ligne ou non, dernier signal, produit, URL et signataire de l'enclave, diagnostic OK, inscrite. Lecture seule.", input_schema: { type: "object", properties: { operator: { type: "string", description: "adresse 0x… de l'opérateur (défaut : wallet connecté)" } } } },
  { name: "machine_diagnostics", description: "Diagnostic d'UNE machine d'opérateur (API ArcHive) : vérifications en échec avec la correction concrète à faire, échecs normaux selon le mode, journal récent, attestation, inscription on-chain. Lecture seule.", input_schema: { type: "object", properties: { machineId: { type: "string" } }, required: ["machineId"] } },
  { name: "ui_navigate", description: "Pilote l'interface du site : ouvre une page pour MONTRER à l'utilisateur. Appelle-le dès que l'utilisateur veut voir, montrer, aller sur, ou utiliser quelque chose. Pages : vue (vue d'ensemble : chaîne de preuves, chiffres du réseau, activité), ruche (les enclaves actives, cliquer pour commander), produits (catalogue), primes (primes ouvertes, chasser), playground (IA privée : conversation chiffrée), cles (clés d'accès aek_, clés opérateur arcop_, sessions), publier-prime (protocole : créer une prime), operateur (louer sa machine : caution, brancher une machine, l'inscrire), publier-produit (auteur : publier son service), portefeuille (soldes, caution, rapatrier de l'USDC par CCTP), developpeurs (API, SDK, CLI, MCP, contrats).", input_schema: { type: "object", properties: { page: { type: "string", enum: ["vue", "ruche", "produits", "primes", "playground", "cles", "publier-prime", "operateur", "publier-produit", "portefeuille", "developpeurs"] }, reason: { type: "string" } }, required: ["page"] } },
] as const;

// libellés « à points » pour l'affichage
export const DISPLAY: Record<string, string> = {
  docs_search: "docs.search", products_list: "products.list", products_get: "products.get",
  pricing_quote: "pricing.quote", session_prepare_open: "session.prepare_open",
  snippet_generate: "snippet.generate", receipt_verify: "receipt.verify",
  enclaves_list: "enclaves.list", ui_navigate: "ui.navigate", sessions_list: "sessions.list", activity_list: "activity.list",
  enclaves_status: "enclaves.status", session_status: "session.status",
  bounty_list: "bounty.list", bounty_prepare_create: "bounty.prepare_create",
  operator_plan: "operator.plan", operator_prepare_bond: "operator.prepare_bond",
  operator_prepare_register: "operator.prepare_register", product_scaffold: "product.scaffold",
  inference_test: "inference.test", machines_list: "machines.list", machine_diagnostics: "machine.diagnostics",
};

// Sur le serveur public, /attest et /pubkeys ne sont lus qu'en https, port 443, chemin fixe, sur des hôtes publics
// (net-guard.ts) ; COPILOT_ALLOW_PRIVATE_URLS=1 (développement local seulement) permet le réseau privé, http et tout port.
const ALLOW_PRIVATE_URLS = process.env.COPILOT_ALLOW_PRIVATE_URLS === "1";
const ENCLAVE_PREFIXES = parsePrefixes(process.env.ENCLAVE_PATH_PREFIXES);
const actx = (ctx: ToolCtx): ActionCtx => ({
  user: ctx.user, allowPrivateUrls: ALLOW_PRIVATE_URLS, enclavePathPrefixes: ENCLAVE_PREFIXES, enclaveUrl: process.env.ENCLAVE_URL, includeCalldata: false,
  apiBase: process.env.ARCHIVE_API, // API ArcHive (listes de son index, machines des opérateurs) ; défaut : l'API publique
});

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["pour", "dans", "avec", "comment", "quoi", "quel", "quelle", "quels", "quelles", "pourquoi", "faire", "faut", "veux", "peux", "sont", "cette", "plus", "moins", "what", "does", "with", "the", "and"]);

export async function executeTool(name: string, input: any, ctx: ToolCtx): Promise<{ result: unknown; citations?: string[] }> {
  switch (name) {
    case "docs_search": {
      // score = nombre de mots de la question présents (sans accents, pluriel retiré), meilleurs passages d'abord
      const words = norm(String(input.query ?? "")).split(/[^a-z0-9_]+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/(es|s|x)$/, ""));
      const hits = KB.map((k) => ({ k, score: words.filter((w) => norm(`${k.text} ${k.tags ?? ""}`).includes(w)).length }))
        .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.k);
      const list = hits.length ? hits : KB.slice(0, 2);
      return { result: list.map(({ source, text }) => ({ source, text })), citations: list.map((h) => h.source) };
    }
    case "products_list":
      // seuls les produits ACTIFS : un produit retiré ne doit jamais être proposé
      return { result: await productsList(ctx.arc, {}, actx(ctx)), citations: ["API ArcHive /products"] };
    case "products_get": {
      const p = await ctx.arc.getProduct(BigInt(input.productId));
      return { result: serializeProductFull(ctx.arc, p) };
    }
    case "pricing_quote": {
      const p = await ctx.arc.getProduct(BigInt(input.productId));
      const units = BigInt(input.units ?? "1");
      const total = p.price * units;
      const out: Record<string, unknown> = {
        pricePerUnit: formatUnits(p.price, 6) + " USDC", units: units.toString(), total: formatUnits(total, 6) + " USDC",
        unite: p.settlement.toLowerCase() === ctx.arc.d.sessionPay.toLowerCase()
          ? "chaque jeton, de la question comme de la réponse, compte 1 unité : une requête coûte (jetons de la question + jetons de la réponse) × prix par unité, et compte bien plus que 2 jetons"
          : `unités comptées dans les reçus du rail ${railOf(ctx.arc, p.settlement)}`,
      };
      if (input.budget !== undefined && input.budget !== null && String(input.budget).trim() !== "") {
        const b = parseUsdc(input.budget, "budget");
        out.budgetParRequete = formatUnits(b, 6) + " USDC";
        out.unitesMaxParRequete = p.price > 0n ? (b / p.price).toString() : "illimité (prix nul)";
        out.exempleDeDepot = { depot: formatUnits(b * 10n, 6) + " USDC", couvre: "10 requêtes au plafond de ce budget (le dépôt sert toute la boucle de requêtes)" };
      }
      return { result: out };
    }
    case "session_prepare_open": {
      return { result: await prepareSessionOpen(ctx.arc, input, actx(ctx)), citations: ["SessionPay.sol+X402Settler.sol#rails", "PLAN-BUILD§4.1#cles"] };
    }
    case "snippet_generate": {
      return { result: { language: "typescript", code:
`import { createArcClient, createInferenceClient } from "@arcvault/sdk";
const arc = createArcClient({ publicClient, walletClient });
// v2 : la session est verrouillée sur l'enclave de enclaveUrl, dont les clés sont d'abord vérifiées on-chain
const { sessionId, sessionKey } = await arc.openSession({ productId: ${input.productId}n, enclaveUrl, deposit: 5_000_000n });
const ai = createInferenceClient({ enclaveUrl, sessionId, sessionKey, publicClient }); // revérifie les clés avant d'envoyer
for (const q of questions) {
  const { text, receipt, verified } = await ai.chat.completions.create({ messages: [{ role: "user", content: q }] });
  // reçu vérifié on-chain ; un seul règlement paiera toute la boucle
}` } };
    }
    case "receipt_verify": {
      // v2 : mêmes contrôles que SessionPay.settle (enclave verrouillée, active au bloc d'ancrage, modèle, cumul)
      const v = await ctx.arc.verifyReceipt(normalizeReceipt(input.receipt), input.signature as Hex);
      return { result: {
        signer: v.signer, operateurActifAuBlocDAncrage: v.activeOperatorAtAnchor, reglable: v.settleable,
        verseraitMaintenant: formatUnits(v.payableNow, 6) + " USDC", controles: v.checks.map((c) => ({ ok: c.ok, quoi: c.fr })),
      }, citations: ["SessionPay.sol+X402Settler.sol#rails"] };
    }
    case "enclaves_list":
      return { result: await enclavesList(ctx.arc, input ?? {}, actx(ctx)), citations: ["API ArcHive /enclaves", "EnclaveRegistry.sol#politique"] };
    case "sessions_list":
      return { result: await sessionsList(ctx.arc, input ?? {}, actx(ctx)), citations: ["API ArcHive /sessions/:adresse", "SessionPay.sol+X402Settler.sol#rails"] };
    case "activity_list":
      return { result: await activityList(ctx.arc, input ?? {}, actx(ctx)), citations: ["API ArcHive /activity"] };
    case "enclaves_status":
      return { result: await enclaveStatus(ctx.arc, input.signer), citations: ["EnclaveRegistry.sol#politique", "OperatorBond.sol#caution"] };
    case "session_status":
      return { result: await sessionStatus(ctx.arc, input.sessionId), citations: ["SessionPay.sol+X402Settler.sol#rails"] };
    case "bounty_list":
      return { result: await bountyList(ctx.arc, input ?? {}, actx(ctx)), citations: ["API ArcHive /bounties", "SealedBounty.sol#claim"] };
    case "bounty_prepare_create":
      return { result: await prepareBountyCreate(ctx.arc, input ?? {}, actx(ctx)), citations: ["SealedBounty.sol#claim", "predicate.ts#v0"] };
    case "operator_plan":
      return { result: await operatorPlan(ctx.arc, input ?? {}, actx(ctx)), citations: ["README#operator", "OperatorBond.sol#caution", "EnclaveRegistry.sol#politique"] };
    case "operator_prepare_bond":
      return { result: await prepareBond(ctx.arc, input ?? {}, actx(ctx)), citations: ["OperatorBond.sol#caution"] };
    case "operator_prepare_register":
      return { result: await prepareRegister(ctx.arc, input ?? {}, actx(ctx)), citations: ["EnclaveRegistry.sol#politique", "OperatorBond.sol#caution"] };
    case "product_scaffold":
      return { result: await productScaffold(ctx.arc, input ?? {}), citations: ["ProductRegistry.sol#auteur", "SessionPay.sol#_split"] };
    case "inference_test":
      return { result: await inferenceTest(ctx.arc, input ?? {}, actx(ctx)), citations: ["PLAN-BUILD§4.1#cles", "enclave/services/inference.ts#unites"] };
    case "machines_list":
      return { result: await machinesList(input ?? {}, actx(ctx)), citations: ["API ArcHive /machines"] };
    case "machine_diagnostics":
      return { result: await machineDiagnostics(ctx.arc, input ?? {}, actx(ctx)), citations: ["API ArcHive /machines/:id", "EnclaveRegistry.sol#politique"] };
    case "ui_navigate": {
      // L'action réelle (changer de page) est faite par le navigateur, via le champ `navigate` de la réponse.
      // On renvoie ce que la page MONTRE, avec les vraies données : le modèle décrit le réel, il n'invente rien.
      // anciens noms acceptés (compatibilité) → pages de la console
      const OLD: Record<string, string> = { home: "produits", hive: "ruche", use: "playground", rent: "operateur", onramp: "portefeuille", profile: "portefeuille" };
      const page = OLD[String(input.page ?? "vue")] ?? String(input.page ?? "vue");
      const PAGES: Record<string, string> = {
        vue: "Vue d'ensemble : la chaîne de preuves de l'enclave en service (image épinglée, mesure Intel TDX, inscription vérifiée par Arc, réponse signée, paiement USDC, verdict ERC-8004), les chiffres du réseau et l'activité on-chain.",
        ruche: "La ruche : chaque alvéole est une enclave Intel TDX inscrite on-chain ; les actives sont cliquables pour ouvrir une session et commander leur produit en USDC.",
        produits: "Produits : le catalogue (nom, mode de paiement, prix par unité, parts opérateur/auteur/réseau, caution minimale, enclaves en service).",
        primes: "Primes : les primes ouvertes (pool, échéance, état) et le panneau du chasseur (exploit chiffré vers l'enclave, payé dans le bloc si prouvé).",
        playground: "IA privée : une conversation chiffrée avec un modèle en enclave, préremplie sur une enclave active ; chaque réponse a un reçu signé vérifié on-chain.",
        cles: "Clés et sessions : créer une clé d'accès aek_ (une session prépayée), la recharger, la changer, la clore ; et les clés opérateur arcop_ pour piloter ses machines en programme.",
        "publier-prime": "Publier une prime : côté protocole, déposer un pool d'USDC et une règle de perte ; on ne paie que si une faille est prouvée.",
        operateur: "Louer sa machine : 1) déposer une caution, 2) brancher une machine (installer archive-node, l'appairer par code, la lancer), 3) l'inscrire sur Arc ; tableau « Vos machines » avec diagnostic et bouton de débogage.",
        "publier-produit": "Publier un produit : le parcours de l'auteur en 7 étapes et le formulaire (prix, caution minimale, image autorisée, mode de paiement).",
        portefeuille: "Portefeuille : l'adresse (= le compte), l'USDC sur Arc, la caution d'opérateur, et l'USDC sur d'autres chaînes à rapatrier par CCTP.",
        developpeurs: "Développeurs : l'API de lecture, le SDK, la CLI arcvault, le mandataire OpenAI, le serveur MCP, les adresses des contrats et les routes de l'enclave.",
      };
      let donnees: unknown = null;
      try {
        // listes lues dans l'index de l'API ArcHive (cache de 15 s, délai de 8 s), jamais chez l'explorateur
        if (page === "ruche") {
          const es = await enclavesCached(ctx.arc, actx(ctx));
          const act = es.filter((e) => e.active);
          donnees = { inscrites: es.length, actives: act.length, enclavesActives: act.map((e) => ({ produit: e.productId.toString(), signataire: e.signer, operateur: e.operator })) };
        } else if (page === "produits") {
          donnees = (await productsCached(ctx.arc, actx(ctx))).map(serializeProduct);
        } else if (page === "vue") {
          donnees = await networkCounters(actx(ctx));
        }
      } catch (e) {
        // la page s'ouvre quand même ; le modèle dit pourquoi il n'a pas les chiffres (jamais une liste inventée)
        donnees = { indisponible: isListUnavailable(e) ? e.message : `lecture impossible : ${String((e as Error)?.message ?? e).slice(0, 160)}` };
      }
      return { result: { navigated: page, cettePageMontre: PAGES[page] ?? "", donneesReelles: donnees } };
    }
    default: return { result: { error: `outil inconnu: ${name}` } };
  }
}

function serializeProduct(p: any) {
  return { id: p.id.toString(), state: p.state, deterministic: p.deterministic, pricePerUnit: formatUnits(p.price, 6) + " USDC", settlement: p.settlement, minBond: formatUnits(p.minBond, 6) + " USDC" };
}

/** Les chiffres de la vue d'ensemble (/stats de l'API), avec le bloc où ils ont été comptés ; un avertissement s'ils
 *  sont nettement plus anciens que l'index (l'API garde son dernier bon calcul quand un rafraîchissement échoue). */
async function networkCounters(cx: ActionCtx): Promise<Record<string, unknown>> {
  const s = await apiStats({ base: cx.apiBase });
  const idx = await apiIndexStatus({ base: cx.apiBase });
  const at = /^\d+$/.test(String(s.head ?? "")) ? Number(s.head) : null;
  const lag = at !== null && idx?.head ? idx.head - at : null;
  const u = (x: unknown) => (/^\d+$/.test(String(x ?? "")) ? `${formatUnits(BigInt(String(x)), 6)} USDC` : null);
  const n = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);
  return {
    enclaves: n(s.enclaves), enclavesActives: n(s.enclavesActive), produits: n(s.products), produitsActifs: n(s.productsActive),
    sessions: n(s.sessions), reglements: n(s.settlements), usdcRegles: u(s.settledUsdc), usdcRembourses: u(s.refundedUsdc),
    appelsX402: n(s.x402Calls), verdicts: n(s.verdicts), primes: n(s.bounties), poolDesPrimes: u(s.bountyPool),
    primesPayees: n(s.bountiesPaid), usdcPayesAuxChasseurs: u(s.bountyPaidUsdc), comptesAuBloc: at,
    ...(lag !== null && lag > 600
      ? { avertissement: `chiffres calculés au bloc ${at}, ${lag} blocs avant la tête de l'index de l'API : l'activité plus récente n'y est pas comptée` }
      : {}),
  };
}

/** Produit complet pour products.list / products.get : avec les parts et le nom du rail de paiement. */
function serializeProductFull(arc: ArcClient, p: any) {
  return {
    ...serializeProduct(p),
    rail: railOf(arc, p.settlement),
    parts: { bpsOperator: Number(p.bpsOperator), bpsAuthor: Number(p.bpsAuthor), bpsNetwork: Number(p.bpsNetwork) },
    exposureCap: formatUnits(p.exposureCap, 6) + " USDC",
    author: p.author,
  };
}
