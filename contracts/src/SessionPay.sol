// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {UsdcPayer} from "./lib/UsdcPayer.sol";
import {RevertReason} from "./lib/RevertReason.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {IVerdictLog} from "./interfaces/IVerdictLog.sol";

/// @title SessionPay (SPEC-TECH §C5) — v2
/// @notice Sessions prépayées en USDC, servies contre une clé de session, payées sur le DERNIER reçu
///         cumulatif signé par l'enclave : une transaction par règlement, jamais par message.
///         v2 : le prix unitaire est VERROUILLÉ à l'ouverture (un changement de prix du produit ne touche
///         que les sessions ouvertes après) ; le verdict ERC-8004 d'une session porte son sessionId ;
///         `verdictWritten` ne passe à vrai que si l'écriture a réellement eu lieu ; le plafond
///         d'exposition du produit s'applique en plus de la règle de la caution.
///
///         v2 bis (revue adverse du 7/11) :
///         - une session ne s'ouvre que sur un produit réglé par CE contrat (ou les tentatives payantes de la
///           Prime scellée, `attemptsFor`), à prix non nul, chez un opérateur cautionné ;
///         - la session est LIÉE à UNE enclave, choisie à l'ouverture et active pour ce produit chez cet
///           opérateur : seuls ses reçus paient (deux enclaves ne comptent plus chacune depuis paidUnits) ;
///         - le modèle (param) et l'unité facturée (unitTokens, outWeight) sont verrouillés à l'ouverture, comme
///           le prix : un changement de modèle ne rend plus impayables les reçus des sessions ouvertes ;
///         - l'échéance est bornée : au moins MIN_SESSION, au plus MAX_SESSION (plus de session « déjà échue »
///           fermée dans le bloc de son service) ; la fermeture anticipée n'est permise que si l'enclave liée ne
///           peut plus rien régler ;
///         - le verdict ERC-8004 exige son gaz (VERDICT_GAS) AVANT l'appel : envoyée au gaz minimal (eth_estimateGas),
///           une fermeture ou une saisie ne réussit plus en sautant le verdict (InsufficientGasForVerdict).
///
///         v2.1 : le requestHash ERC-8004 commence par (block.chainid, address(this)) : un redéploiement sur la même
///         chaîne, ou la même pile sur une autre chaîne, n'entre plus en collision avec un verdict déjà écrit (le registre
///         de Circle répondait « exists » et le verdict sautait sans trace) ; et un verdict qui échoue malgré son gaz
///         laisse une trace on-chain : VerdictSkipped(requestHash, raison).
///
///         v2.1 bis (revue adverse du 9/11) : la raison de VerdictSkipped est BORNÉE (RevertReason, 132 octets au plus).
///         `catch (bytes memory reason)` recopiait tout le revert : un registre ERC-8004 hostile ou bogué bloquait alors
///         la fermeture (le remboursement) et la saisie, quel que soit le gaz envoyé — ce que `catch {}` de la v2 évitait.
///         Un requestHash occupé d'avance par un tiers dans l'espace commun du registre ne fait plus sauter le verdict :
///         VerdictLog le réécrit sous un hash salé (VerdictLog.RequestHashSalted).
///
///         v2.1 ter (après les revues du 9/11) :
///         - une session fermée SANS AUCUN règlement (paid == 0 : aucun service payé) n'écrit plus de « 100 ». Un opérateur
///           pouvait ouvrir des sessions depuis un portefeuille à lui et les fermer sans usage : dépôt rendu en entier,
///           un 100/100 ERC-8004 par session pour le seul prix du gaz. Désormais aucun verdict n'est écrit ni tenté (donc
///           aucune réserve VERDICT_GAS), et VerdictNotApplicable(sessionId) le dit ; le remboursement est inchangé ;
///         - le verdict de FAUTE a son propre drapeau, faultVerdictWritten. Avec le seul verdictWritten, une équivocation
///           prouvée APRÈS une fermeture qui avait écrit son 100 saisissait la caution sans jamais écrire le 0. Un seul
///           verdict de faute par session ; un nouveau signalement le retente tant qu'il n'est pas écrit.
contract SessionPay is EIP712, UsdcPayer {
    using ECDSA for bytes32;

    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(uint256 productId,uint256 sessionId,uint64 seq,bytes32 modelHash,bytes32 paramsHash,bytes32 requestHash,bytes32 responseHash,uint64 tokensIn,uint64 tokensOut,uint128 cumulativeUnits,uint64 anchorBlock)"
    );

    uint64 public constant SETTLE_GRACE = 1 hours; // délai après l'échéance pour un dernier règlement
    /// @notice v2 : durée minimale d'une session (échéance au moins à maintenant + 10 min).
    uint64 public constant MIN_SESSION = 10 minutes;
    /// @notice v2 : durée maximale d'une session (échéance au plus à maintenant + 30 jours).
    uint64 public constant MAX_SESSION = 30 days;
    /// @notice v2 bis : gaz réservé au verdict ERC-8004 (VerdictLog → registre de validation de Circle : ≈ 238–260 k
    ///         mesurés sur Arc testnet le 7/11). Sans cette réserve, un appel au gaz MINIMAL (eth_estimateGas cherche le
    ///         plus petit gaz qui réussit) faisait échouer le verdict faute de gaz, échec avalé par le try/catch : la
    ///         transaction réussissait SANS verdict (closeSession(13) sur Arc testnet, 7/11). Le try/catch ne couvre
    ///         plus que les vraies pannes du registre. v2.1 bis : VerdictLog.record mesuré à froid sur un fork local d'Arc
    ///         testnet (9/11, vrai registre de Circle) : 235 k pour le VerdictLog v2 déployé ; 285 k pour la v2.1 bis
    ///         (recordedAs, nouvel agent, nouveau validateur) ; 287 k quand le hash est occupé (sel) : la réserve tient.
    uint256 public constant VERDICT_GAS = 350_000;

    IProductRegistry public immutable products;
    IEnclaveRegistry public immutable enclaves;
    IOperatorBond public immutable bond;
    IVerdictLog public immutable verdict;
    address public immutable treasury;
    /// @notice v2 : la Prime scellée dont SessionPay facture les TENTATIVES (sessions sur un produit réglé par
    ///         elle, à prix non nul : une tentative = une unité). address(0) = aucune.
    address public immutable attemptsFor;

    struct Session {
        address owner;
        uint256 productId;
        address operator;
        address sessionKey;
        uint256 deposit;
        uint256 cap; // plafond de dépense (0 = égal au dépôt)
        uint128 paidUnits; // unités cumulées déjà réglées
        uint256 paid; // USDC déjà versé
        uint64 expiresAt;
        bool closed;
        // vrai seulement si une entrée ERC-8004 a réellement été écrite pour cette session (le 100 de la fermeture,
        // ou le 0 d'une faute prouvée)
        bool verdictWritten;
        uint256 price; // v2 : prix unitaire (USDC, 6 décimales) VERROUILLÉ à l'ouverture
        // v2 bis — AJOUTÉS à la fin (un lecteur des 12 premiers champs les décode encore)
        address enclave; // la SEULE enclave dont les reçus paient cette session
        uint32 unitTokens; // unité facturée, verrouillée à l'ouverture (Product.unitTokens)
        uint32 outWeight; // poids d'un jeton de sortie, verrouillé à l'ouverture (Product.outWeight)
        bytes32 param; // modèle (Product.param) verrouillé à l'ouverture : les reçus doivent le porter
        // v2.1 ter — AJOUTÉ à la fin (un lecteur des 16 premiers champs les décode encore)
        bool faultVerdictWritten; // vrai seulement si le verdict de FAUTE (0) a réellement été écrit ; un par session
    }

    struct Receipt {
        uint256 productId;
        uint256 sessionId;
        uint64 seq;
        bytes32 modelHash;
        bytes32 paramsHash;
        bytes32 requestHash;
        bytes32 responseHash;
        uint64 tokensIn;
        uint64 tokensOut;
        uint128 cumulativeUnits;
        uint64 anchorBlock;
    }

    struct OpenParams {
        uint256 productId;
        address operator;
        address sessionKey;
        uint64 expiresAt;
        uint256 deposit;
        uint256 cap;
        Auth auth;
        /// @dev v2 : la clé de l'enclave qui servira la session (lue sur /pubkeys de l'enclave par le client).
        address enclave;
    }

    uint256 public sessionCount;
    mapping(uint256 => Session) private _sessions;

    event SessionOpened(uint256 indexed sessionId, address indexed owner, uint256 indexed productId, uint256 deposit);
    event SessionToppedUp(uint256 indexed sessionId, uint256 amount);
    event SessionKeyRotated(uint256 indexed sessionId, address newKey);
    event Settled(uint256 indexed sessionId, uint128 cumulativeUnits, uint256 paidDelta);
    event SessionClosed(uint256 indexed sessionId, uint256 refund);
    event EquivocationSlashed(uint256 indexed sessionId, address indexed signer, address operator);
    /// @notice v2.1 : l'écriture du verdict ERC-8004 a échoué (panne ou refus du registre) ; `reason` = données de revert,
    ///         v2.1 bis : leurs 132 premiers octets au plus (RevertReason.MAX_LENGTH).
    event VerdictSkipped(bytes32 indexed requestHash, bytes reason);
    /// @notice v2.1 ter : session fermée sans aucun règlement (paid == 0) : aucun service payé, donc la fermeture n'écrit ni
    ///         ne tente aucun verdict (pas de « 100 »). Émis juste avant SessionClosed, dans la même transaction ;
    ///         SessionClosed est inchangé. Un verdict de faute (reportEquivocation) n'en dépend pas.
    event VerdictNotApplicable(uint256 indexed sessionId);

    error BadProduct();
    error NotOwner();
    error Closed();
    error SessionMismatch();
    error InactiveEnclave();
    error WrongOperator();
    error ModelMismatch();
    error NotIncreasing();
    error NotExpired();
    error NotEquivocation();
    /// @notice v2 : le produit n'est pas réglé par ce contrat (ni ses tentatives par `attemptsFor`).
    error WrongSettlement();
    /// @notice v2 : un produit au prix 0 ne s'ouvre pas en session (inférence gratuite).
    error ZeroPrice();
    /// @notice v2 : échéance hors de [maintenant + MIN_SESSION, maintenant + MAX_SESSION].
    error BadExpiry();
    /// @notice v2 : l'opérateur n'a pas la caution minimale du produit, ou il est radié.
    error OperatorUnderbonded();
    /// @notice v2 : le reçu est signé par une autre enclave que celle de la session.
    error WrongEnclave();
    /// @notice v2 bis : pas assez de gaz pour le verdict ERC-8004 (VERDICT_GAS) : renvoyer avec plus de gaz.
    error InsufficientGasForVerdict();

    constructor(
        address _usdc,
        address _products,
        address _enclaves,
        address _bond,
        address _verdict,
        address _treasury,
        address _attemptsFor
    ) EIP712("ArcEnclaveNetwork", "1") UsdcPayer(_usdc) {
        products = IProductRegistry(_products);
        enclaves = IEnclaveRegistry(_enclaves);
        bond = IOperatorBond(_bond);
        verdict = IVerdictLog(_verdict);
        treasury = _treasury;
        attemptsFor = _attemptsFor;
    }

    function openSession(OpenParams calldata q) external returns (uint256 sessionId) {
        IProductRegistry.Product memory p = products.getProduct(q.productId);
        if (p.state != IProductRegistry.State.Active) revert BadProduct();
        // v2 : un produit réglé par ce contrat (ou les tentatives de la Prime scellée), jamais au prix 0
        if (p.settlement != address(this) && (attemptsFor == address(0) || p.settlement != attemptsFor)) {
            revert WrongSettlement();
        }
        if (p.price == 0) revert ZeroPrice();
        // v2 : échéance bornée (ni déjà échue, ni au-delà de 30 jours)
        if (uint256(q.expiresAt) < block.timestamp + MIN_SESSION || uint256(q.expiresAt) > block.timestamp + MAX_SESSION)
        {
            revert BadExpiry();
        }
        // v2 : l'enclave choisie est active pour ce produit, chez l'opérateur annoncé, cautionné et non radié
        address op = enclaves.activeOperatorAt(q.enclave, q.productId, block.number);
        if (op == address(0)) revert InactiveEnclave();
        if (op != q.operator) revert WrongOperator();
        if (bond.banned(op) || bond.availableBond(op) < p.minBond) revert OperatorUnderbonded();

        _pullWithAuth(msg.sender, q.deposit, q.auth);

        sessionId = ++sessionCount;
        _sessions[sessionId] = Session({
            owner: msg.sender,
            productId: q.productId,
            operator: q.operator,
            sessionKey: q.sessionKey,
            deposit: q.deposit,
            cap: q.cap,
            paidUnits: 0,
            paid: 0,
            expiresAt: q.expiresAt,
            closed: false,
            verdictWritten: false,
            price: p.price, // verrouillé : une hausse ou une baisse ultérieure ne touche pas cette session
            enclave: q.enclave,
            unitTokens: p.unitTokens,
            outWeight: p.outWeight,
            param: p.param, // verrouillé : un changement de modèle ne touche que les sessions ouvertes après
            faultVerdictWritten: false
        });
        emit SessionOpened(sessionId, msg.sender, q.productId, q.deposit);
    }

    function topUp(uint256 sessionId, uint256 amount, Auth calldata auth) external {
        Session storage s = _sessions[sessionId];
        if (s.owner == address(0)) revert SessionMismatch();
        if (s.closed) revert Closed();
        _pullWithAuth(msg.sender, amount, auth);
        s.deposit += amount;
        emit SessionToppedUp(sessionId, amount);
    }

    function rotateKey(uint256 sessionId, address newKey) external {
        Session storage s = _sessions[sessionId];
        if (msg.sender != s.owner) revert NotOwner();
        if (s.closed) revert Closed();
        s.sessionKey = newKey;
        emit SessionKeyRotated(sessionId, newKey);
    }

    /// @notice Paie le delta depuis le dernier règlement, sur la foi du dernier reçu cumulatif.
    ///         Permissionless : l'autorité est la signature de l'enclave.
    function settle(Receipt calldata r, bytes calldata signature) external {
        Session storage s = _sessions[r.sessionId];
        if (s.owner == address(0)) revert SessionMismatch();
        if (s.closed) revert Closed();
        if (r.productId != s.productId) revert SessionMismatch();

        address signer = _recover(r, signature);
        // enclave active pour ce produit au bloc d'ancrage (fenêtre de validité, grâce comprise), et
        // l'opérateur responsable de cette fenêtre est celui de la session
        address op = enclaves.activeOperatorAt(signer, s.productId, r.anchorBlock);
        if (op == address(0)) revert InactiveEnclave();
        if (op != s.operator) revert WrongOperator();
        // v2 : seule l'enclave liée à la session est payée (une 2e enclave recompterait depuis paidUnits)
        if (signer != s.enclave) revert WrongEnclave();

        // v2 : le modèle VERROUILLÉ à l'ouverture (et non le param courant du produit)
        if (r.modelHash != s.param) revert ModelMismatch();
        if (r.cumulativeUnits <= s.paidUnits) revert NotIncreasing();
        IProductRegistry.Product memory p = products.getProduct(s.productId);

        // montant dû = cumulativeUnits × prix VERROUILLÉ à l'ouverture − déjà payé, borné par le dépôt (et
        // le plafond). Jamais négatif : prix fixe, cumul strictement croissant, plafond non décroissant.
        uint256 owed = uint256(r.cumulativeUnits) * s.price;
        uint256 ceiling = s.cap == 0 ? s.deposit : (s.cap < s.deposit ? s.cap : s.deposit);
        if (owed > ceiling) owed = ceiling;
        uint256 delta = owed - s.paid;

        // effets avant transferts
        s.paid = owed;
        s.paidUnits = r.cumulativeUnits;

        if (delta > 0) {
            // exposition prise sur la foi d'une seule enclave (bornée par C4 : ½ caution, plafond du produit)
            bond.consumeExposure(s.operator, s.productId, delta, p.exposureCap);
            _split(p, s.operator, delta);
        }
        emit Settled(r.sessionId, r.cumulativeUnits, delta);
    }

    /// @notice Ferme après l'échéance (+ grâce) côté propriétaire ; rembourse le reste, écrit le verdict « 100 ».
    ///         v2 : aussi plus tôt si l'enclave liée ne peut plus rien régler (fenêtre + grâce écoulées, ou
    ///         invalidée sans grâce) : aucun reçu de l'opérateur ne devient impayable par cette fermeture.
    ///         v2.1 ter : une session qui n'a rien payé (paid == 0) n'a rien à attester : remboursement intégral, aucun
    ///         verdict, VerdictNotApplicable(sessionId).
    function closeSession(uint256 sessionId) external {
        Session storage s = _sessions[sessionId];
        if (msg.sender != s.owner) revert NotOwner();
        if (s.closed) revert Closed();
        if (
            block.timestamp < uint256(s.expiresAt) + SETTLE_GRACE
                && block.number <= enclaves.settleableUntilBlock(s.enclave)
        ) revert NotExpired();

        s.closed = true;
        uint256 refund = s.deposit - s.paid;
        _payOut(s.owner, refund);

        if (s.paid == 0) {
            // v2.1 ter : aucun reçu réglé, aucun service payé : pas de « 100 » (sinon des sessions vides, ouvertes et
            // fermées par l'opérateur lui-même, lui fabriquaient des 100/100 pour le seul prix du gaz)
            emit VerdictNotApplicable(sessionId);
        } else if (!s.verdictWritten && !bond.banned(s.operator)) {
            // « vérifié et payé » (100), jamais pour un opérateur radié : une faute prouvée prime, même si son
            // verdict n'a pas pu être écrit (il se retente par un nouveau signalement, cf. reportEquivocation)
            if (_writeVerdict(sessionId, s, 100, "tdx-dcap/inference")) s.verdictWritten = true;
        }
        emit SessionClosed(sessionId, refund);
    }

    /// @notice Deux reçus de MÊME (sessionId, seq) à réponses différentes, signés par la même enclave :
    ///         saisie de la caution de l'opérateur, enclave et opérateur radiés. Le verdict de faute n'est
    ///         marqué écrit que s'il l'a été ; sinon, signaler à nouveau la même preuve le retente (la saisie
    ///         d'un opérateur déjà radié ne prend plus rien).
    ///         v2.1 ter : son drapeau (faultVerdictWritten) est distinct de celui du 100 : une faute prouvée APRÈS la
    ///         fermeture écrit encore son 0. Un seul verdict de faute par session, quel que soit le nombre de preuves.
    function reportEquivocation(Receipt calldata a, bytes calldata sigA, Receipt calldata b, bytes calldata sigB)
        external
    {
        Session storage s = _sessions[a.sessionId];
        if (s.owner == address(0)) revert SessionMismatch();
        if (a.sessionId != b.sessionId || a.seq != b.seq) revert NotEquivocation();
        if (a.responseHash == b.responseHash) revert NotEquivocation();

        address signerA = _recover(a, sigA);
        address signerB = _recover(b, sigB);
        if (signerA != signerB) revert NotEquivocation();

        IEnclaveRegistry.Enclave memory e = enclaves.enclaveOf(signerA);
        if (e.signer == address(0) || e.productId != s.productId || e.operator != s.operator) {
            revert NotEquivocation();
        }

        bond.slash(s.operator, msg.sender, s.owner);

        // verdict de faute ; le drapeau ne se pose que si l'écriture a réussi. v2 bis : gaz exigé AVANT l'appel (un
        // appel au gaz minimal ne fait plus sauter le verdict) ; le try/catch ne couvre qu'une panne du registre.
        // v2.1 ter : drapeau PROPRE au verdict de faute (le 100 déjà écrit à la fermeture ne le bloque plus).
        if (!s.faultVerdictWritten) {
            uint256 agentId = bond.agentIdOf(s.operator);
            bytes32 requestHash = keccak256(abi.encode(block.chainid, address(this), "equivocation", a.sessionId, a.seq));
            _requireVerdictGas();
            try verdict.record(agentId, requestHash, "", a.responseHash, "", 0, "tdx-dcap/slash") {
                s.faultVerdictWritten = true;
                s.verdictWritten = true; // une entrée ERC-8004 existe pour cette session (sens inchangé pour les lecteurs)
            } catch {
                emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1 bis : jamais tout le revert
            }
        }
        emit EquivocationSlashed(a.sessionId, signerA, s.operator);
    }

    function getSession(uint256 sessionId) external view returns (Session memory) {
        return _sessions[sessionId];
    }

    // ---- interne ----

    function _recover(Receipt calldata r, bytes calldata signature) private view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIPT_TYPEHASH,
                r.productId,
                r.sessionId,
                r.seq,
                r.modelHash,
                r.paramsHash,
                r.requestHash,
                r.responseHash,
                r.tokensIn,
                r.tokensOut,
                r.cumulativeUnits,
                r.anchorBlock
            )
        );
        return _hashTypedDataV4(structHash).recover(signature);
    }

    function _split(IProductRegistry.Product memory p, address operator, uint256 amount) private {
        uint256 toOperator = amount * p.bpsOperator / 10_000;
        uint256 toAuthor = amount * p.bpsAuthor / 10_000;
        uint256 toNetwork = amount - toOperator - toAuthor; // le reste au réseau (évite la poussière)
        _payOut(operator, toOperator);
        _payOut(p.author, toAuthor);
        _payOut(treasury, toNetwork);
    }

    /// @dev v2 bis : exige le gaz du verdict ERC-8004 avant de l'appeler (voir VERDICT_GAS).
    function _requireVerdictGas() private view {
        if (gasleft() < VERDICT_GAS * 64 / 63 + 20_000) revert InsufficientGasForVerdict();
    }

    /// @dev Écrit le verdict d'une session ; rend vrai si l'écriture ERC-8004 a réussi (une panne du registre ne bloque
    ///      pas la fermeture, elle laisse VerdictSkipped). v2 bis : le gaz du verdict est exigé avant l'appel
    ///      (InsufficientGasForVerdict). v2.1 : requestHash = keccak256(abi.encode(block.chainid, address(this),
    ///      "session", sessionId, productId, owner)) : une entrée par session, par contrat et par chaîne. v2.1 bis : la
    ///      raison est bornée (RevertReason) : un revert géant ne bloque plus la fermeture.
    function _writeVerdict(uint256 sessionId, Session storage s, uint8 response, string memory tag)
        private
        returns (bool written)
    {
        uint256 agentId = bond.agentIdOf(s.operator);
        bytes32 requestHash =
            keccak256(abi.encode(block.chainid, address(this), "session", sessionId, s.productId, s.owner));
        _requireVerdictGas();
        try verdict.record(agentId, requestHash, "", keccak256(abi.encode(s.paidUnits, s.paid)), "", response, tag) {
            written = true;
        } catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded());
        }
    }
}
