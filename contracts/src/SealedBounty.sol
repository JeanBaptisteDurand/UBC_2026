// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {UsdcPayer} from "./lib/UsdcPayer.sol";
import {History} from "./lib/History.sol";
import {RevertReason} from "./lib/RevertReason.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {IVerdictLog} from "./interfaces/IVerdictLog.sol";

/// @title SealedBounty (SPEC-TECH §C6) — v2
/// @notice Une prime payée sur la foi d'une PREUVE : une réclamation EIP-712 signée par une (ou k) enclave(s) active(s)
///         du produit « Prime scellée » qui ont rejoué l'exploit dans un fork (hors-chaîne, O3). Le contrat ne fait que
///         vérifier et payer : aucun exploit n'est exécuté on-chain, aucun vrai protocole n'est touché.
///
///         v2 (revue adverse du 7/11) :
///         - UN exploit n'est plus payé plusieurs fois : une prime paie au plus son palier le plus haut par
///           « armement ». Un 2e paiement exige un palier STRICTEMENT supérieur (seule la différence est versée) et
///           une réclamation ancrée APRÈS le dernier paiement ; le protocole réarme (reopen) une fois la faille
///           corrigée. Changer la casse de l'hexadécimal (nouvelle empreinte) ne rapporte donc plus rien ;
///         - l'exploit chiffré (cP) n'est jamais dans une transaction qui peut échouer pour une raison que le
///           protocole contrôle : acceptClaim ne reçoit que son hash et RÉSERVE le paiement ; deliver(cP), appelable
///           par n'importe qui, livre cP et paie (un transfert refusé devient un crédit à retirer, jamais un échec) ;
///         - la mise en pause de la cible est bornée en gaz, sans recopie des données de retour (plus de « return
///           bomb ») ; setPaused n'atteint pas les réclamations ancrées avant la pause ;
///         - une réclamation fausse se RÉFUTE pendant REFUTE_WINDOW : un contre-rejeu signé par des enclaves
///           d'opérateurs DISTINCTS, plus nombreux que ceux de la réclamation, saisit leurs cautions et annule le
///           paiement s'il n'est pas encore livré ;
///         - seul un produit réglé par CE contrat porte des primes ; k ≤ MAX_SIGS ; paliers strictement croissants ;
///         - le verdict ERC-8004 exige son gaz (VERDICT_GAS) AVANT l'appel : envoyés au gaz minimal (eth_estimateGas),
///           un paiement, une saisie ou une réfutation ne réussissent plus en sautant le verdict.
///
///         v2.1 : le requestHash ERC-8004 commence par (block.chainid, address(this)) (plus de collision entre
///         déploiements) ; un verdict qui échoue malgré son gaz laisse VerdictSkipped(requestHash, raison).
///
///         v2.1 bis (revue adverse du 9/11) : la raison de VerdictSkipped est BORNÉE (RevertReason, 132 octets au plus) —
///         `catch (bytes memory reason)` laissait un registre ERC-8004 hostile ou bogué bloquer le paiement d'une prime,
///         la saisie et la réfutation, quel que soit le gaz ; le verdict d'équivocation porte l'OPÉRATEUR saisi (deux
///         opérateurs qui équivoquent sur la même empreinte avaient le même requestHash : le verdict du second sautait).
contract SealedBounty is EIP712, UsdcPayer {
    using ECDSA for bytes32;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 bountyId,address payee,uint64 blockN,bytes32 blockHashN,bytes32 predicateHash,uint256 loss,uint8 tier,bytes32 fingerprint,bytes32 cPHash,uint64 deadline)"
    );
    /// @notice v2 : le verdict d'un contre-rejeu sur une réclamation acceptée (`claimDigest` = son digest EIP-712).
    bytes32 public constant REFUTATION_TYPEHASH =
        keccak256("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)");

    uint256 public constant MAX_SIGS = 5;
    /// @notice v2 : gaz donné à `targetToPause.pause()` (borné ; aucune donnée de retour recopiée).
    uint256 public constant PAUSE_GAS = 100_000;
    /// @dev Sélecteur de pause().
    bytes4 private constant PAUSE_SELECTOR = 0x8456cb59;
    /// @notice v2 : délai pour livrer cP après acceptClaim ; ensuite la réservation retourne au pool.
    uint64 public constant DELIVERY_WINDOW = 1 days;
    /// @notice v2 : délai pour réfuter une réclamation acceptée (inférieur à OperatorBond.UNBOND_DELAY : la caution
    ///         des signataires est encore là).
    uint64 public constant REFUTE_WINDOW = 3 days;
    /// @notice v2 : nombre minimal d'opérateurs distincts derrière une réfutation (et plus que la réclamation).
    uint256 public constant REFUTE_QUORUM = 2;
    /// @notice v2 bis : gaz réservé au verdict ERC-8004 (VerdictLog → registre de validation de Circle : ≈ 238–260 k
    ///         mesurés sur Arc testnet le 7/11). Sans cette réserve, un appel au gaz MINIMAL (eth_estimateGas cherche le
    ///         plus petit gaz qui réussit) faisait échouer le verdict faute de gaz, échec avalé par le try/catch : la
    ///         transaction réussissait SANS verdict (closeSession(13) sur Arc testnet, 7/11). Le try/catch ne couvre
    ///         plus que les vraies pannes du registre. v2.1 bis : VerdictLog.record à froid, fork local d'Arc testnet
    ///         (9/11, vrai registre) : 285 k (287 k avec le sel) ; la réserve tient.
    uint256 public constant VERDICT_GAS = 350_000;

    IProductRegistry public immutable products;
    IEnclaveRegistry public immutable enclaves;
    IOperatorBond public immutable bond;
    IVerdictLog public immutable verdict;
    address public immutable treasury;
    uint16 public immutable networkBountyBps; // part réseau, en plus (ex. 1000 = 10 %)
    uint16 public immutable operatorBountyBps; // part opérateur(s), en plus (ex. 500 = 5 %)

    /// @dev Les 10 premiers champs gardent l'ordre, le type et le sens de la v1 (un lecteur v1 les décode encore) ;
    ///      v2 AJOUTE les 3 derniers.
    struct Bounty {
        address protocol;
        uint256 productId;
        bytes32 predicateHash;
        bytes32 protocolX25519;
        uint256 singleCap; // au-delà (montant du palier), k signatures d'opérateurs différents
        uint8 k;
        address targetToPause; // 0 si aucun
        uint64 deadline;
        uint256 balance; // disponible (hors paiements réservés en attente de livraison)
        bool paused;
        uint256 paidAmount; // v2 : palier le plus haut déjà accordé depuis le dernier armement
        uint64 lastPaidBlock; // v2 : bloc du dernier paiement (ou du réarmement) ; ancrage exigé APRÈS
        uint64 pausedFromBlock; // v2 : la pause n'atteint que les réclamations ancrées à partir de ce bloc
    }

    struct Claim {
        uint256 bountyId;
        address payee;
        uint64 blockN;
        bytes32 blockHashN;
        bytes32 predicateHash;
        uint256 loss;
        uint8 tier;
        bytes32 fingerprint;
        bytes32 cPHash;
        uint64 deadline;
    }

    struct CreateParams {
        uint256 productId;
        bytes32 predicateHash;
        bytes32 protocolX25519;
        uint256[] tierMinLoss;
        uint256[] tierAmount;
        uint256 singleCap;
        uint8 k;
        address targetToPause;
        uint64 deadline;
        uint256 funding;
        Auth auth;
    }

    /// @notice v2 : verdict d'un contre-rejeu. `proven` faux = l'exploit ne se prouve pas (ou cP n'est pas
    ///         l'exploit annoncé) ; sinon `loss`/`tier` mesurés par les enclaves qui réfutent.
    struct Refutation {
        bytes32 claimDigest;
        bool proven;
        uint256 loss;
        uint8 tier;
    }

    /// @notice v2 : paiement accepté (réservé), en attente de la livraison de cP.
    struct Payout {
        address payee;
        uint8 tier;
        uint64 acceptedAt;
        bytes32 cPHash;
        bytes32 claimDigest;
        uint256 amount; // au chasseur
        uint256 netFee; // au réseau
        uint256 opFee; // aux opérateurs signataires
        address[] ops; // opérateurs DISTINCTS signataires
    }

    /// @notice v2 : trace d'une réclamation acceptée, pour une réfutation éventuelle.
    struct ClaimRecord {
        uint64 acceptedAt;
        bool refuted;
        bytes32 opsHash; // keccak256(abi.encode(operateurs signataires))
    }

    uint256 public bountyCount;
    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => uint256[]) public tierMinLoss;
    mapping(uint256 => uint256[]) public tierAmount;
    mapping(uint256 => mapping(bytes32 => bool)) public fingerprintPaid;
    mapping(uint256 => mapping(bytes32 => Payout)) private _pending;
    mapping(bytes32 => ClaimRecord) public claimRecords;
    /// @notice v2 : paiements dont le transfert a été refusé (ex. adresse bloquée) : à retirer (withdrawCredit).
    mapping(address => uint256) public credit;

    bool private transient _entered;

    event BountyCreated(uint256 indexed bountyId, address indexed protocol, uint256 productId, uint256 funding);
    event BountyFunded(uint256 indexed bountyId, uint256 amount);
    event ExploitDelivered(uint256 indexed bountyId, bytes cP);
    event BountyPaid(uint256 indexed bountyId, address indexed payee, uint256 amount, uint8 tier);
    event RemainingWithdrawn(uint256 indexed bountyId, uint256 amount);
    event EquivocationSlashed(uint256 indexed bountyId, address indexed signer, address operator);
    /// @notice v2 : réclamation acceptée, paiement réservé (la réclamation et ses opérateurs servent à la réfuter).
    event ClaimAccepted(uint256 indexed bountyId, bytes32 indexed claimDigest, Claim claim, address[] operators, uint256 amount);
    event BountyReopened(uint256 indexed bountyId, uint64 fromBlock);
    event BountyPauseSet(uint256 indexed bountyId, bool paused, uint64 fromBlock);
    event UndeliveredCancelled(uint256 indexed bountyId, bytes32 indexed fingerprint, uint256 returned);
    event ClaimRefuted(uint256 indexed bountyId, bytes32 indexed claimDigest, address indexed reporter);
    event Credited(address indexed to, uint256 amount);
    /// @notice v2.1 : l'écriture du verdict ERC-8004 a échoué (panne ou refus du registre) ; `reason` = données de revert,
    ///         v2.1 bis : leurs 132 premiers octets au plus (RevertReason.MAX_LENGTH).
    event VerdictSkipped(bytes32 indexed requestHash, bytes reason);

    error BadProduct();
    error BadTiers();
    error NotProtocol();
    error Expired();
    error NotExpired();
    error BountyPausedErr();
    error PoolTooSmall();
    error PredicateMismatch();
    error AnchorMismatch();
    error AlreadyPaid();
    error CipherMismatch();
    error NoValidSigner();
    error NeedMoreEnclaves();
    error BadTierIndex();
    error LossTooLow();
    error NotEquivocation();
    /// @notice v2 : l'échéance signée de la réclamation (TTL de l'enclave) est passée.
    error ClaimExpired();
    /// @notice v2 : le produit n'est pas réglé par ce contrat (Product.settlement).
    error WrongSettlement();
    /// @notice v2 : k nul ou au-delà de MAX_SIGS (une telle prime ne serait jamais réclamable au-dessus de singleCap).
    error BadK();
    /// @notice v2 : ce palier (ou un plus haut) est déjà accordé depuis le dernier armement.
    error TierAlreadyPaid();
    /// @notice v2 : la réclamation est ancrée au plus tard au bloc du dernier paiement (ou du réarmement).
    error AnchorBeforeLastPayout();
    error NothingToDeliver();
    error DeliveryWindowOpen();
    error UnknownClaim();
    error AlreadyRefuted();
    error RefuteWindowOver();
    error BadOps();
    error NotARefutation();
    error NeedMoreRefuters();
    /// @notice v2 : un signataire de la réclamation ne peut pas la réfuter.
    error RefuterIsClaimOperator();
    /// @notice v2 : pas assez de gaz pour donner PAUSE_GAS à la cible (on n'affame pas la pause).
    error NotEnoughGasForPause();
    /// @notice v2 bis : pas assez de gaz pour le verdict ERC-8004 (VERDICT_GAS) : renvoyer avec plus de gaz.
    error InsufficientGasForVerdict();
    error NothingToWithdraw();
    error Reentrancy();

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        address _usdc,
        address _products,
        address _enclaves,
        address _bond,
        address _verdict,
        address _treasury,
        uint16 _networkBountyBps,
        uint16 _operatorBountyBps
    ) EIP712("ArcEnclaveNetwork", "1") UsdcPayer(_usdc) {
        products = IProductRegistry(_products);
        enclaves = IEnclaveRegistry(_enclaves);
        bond = IOperatorBond(_bond);
        verdict = IVerdictLog(_verdict);
        treasury = _treasury;
        networkBountyBps = _networkBountyBps;
        operatorBountyBps = _operatorBountyBps;
    }

    function createBounty(CreateParams calldata q) external returns (uint256 bountyId) {
        if (!products.isActive(q.productId)) revert BadProduct();
        if (products.getProduct(q.productId).settlement != address(this)) revert WrongSettlement();
        uint256 n = q.tierMinLoss.length;
        if (n == 0 || n != q.tierAmount.length || q.tierAmount[0] == 0) revert BadTiers();
        // paliers strictement croissants (seuils ET montants) : le plus haut palier atteint est aussi le mieux payé
        for (uint256 i = 1; i < n; i++) {
            if (q.tierMinLoss[i] <= q.tierMinLoss[i - 1] || q.tierAmount[i] <= q.tierAmount[i - 1]) revert BadTiers();
        }
        if (q.k == 0 || q.k > MAX_SIGS) revert BadK();

        _pullWithAuth(msg.sender, q.funding, q.auth);

        bountyId = ++bountyCount;
        _bounties[bountyId] = Bounty({
            protocol: msg.sender,
            productId: q.productId,
            predicateHash: q.predicateHash,
            protocolX25519: q.protocolX25519,
            singleCap: q.singleCap,
            k: q.k,
            targetToPause: q.targetToPause,
            deadline: q.deadline,
            balance: q.funding,
            paused: false,
            paidAmount: 0,
            lastPaidBlock: 0,
            pausedFromBlock: 0
        });
        tierMinLoss[bountyId] = q.tierMinLoss;
        tierAmount[bountyId] = q.tierAmount;

        emit BountyCreated(bountyId, msg.sender, q.productId, q.funding);
    }

    function fund(uint256 bountyId, uint256 amount, Auth calldata auth) external {
        Bounty storage bnty = _bounties[bountyId];
        if (bnty.protocol == address(0)) revert BadProduct();
        _pullWithAuth(msg.sender, amount, auth);
        bnty.balance += amount;
        emit BountyFunded(bountyId, amount);
    }

    /// @notice Le protocole met sa prime en pause (ou la relance). v2 : la pause n'atteint que les réclamations
    ///         ancrées À PARTIR du bloc de la pause ; une preuve déjà faite sur un bloc antérieur reste payable
    ///         (le protocole ne peut pas « doubler » une réclamation vue dans la mempool).
    function setPaused(uint256 bountyId, bool p) external {
        Bounty storage bnty = _bounties[bountyId];
        if (msg.sender != bnty.protocol) revert NotProtocol();
        if (p && !bnty.paused) bnty.pausedFromBlock = uint64(block.number);
        if (!p) bnty.pausedFromBlock = 0;
        bnty.paused = p;
        emit BountyPauseSet(bountyId, p, bnty.pausedFromBlock);
    }

    /// @notice v2 : le protocole RÉARME sa prime (après correction de la faille) : les paliers redeviennent payables,
    ///         pour des réclamations ancrées après ce bloc seulement.
    function reopen(uint256 bountyId) external {
        Bounty storage bnty = _bounties[bountyId];
        if (msg.sender != bnty.protocol) revert NotProtocol();
        bnty.paidAmount = 0;
        bnty.lastPaidBlock = uint64(block.number);
        emit BountyReopened(bountyId, uint64(block.number));
    }

    /// @notice v2 (recommandé) : vérifie tout et RÉSERVE le paiement ; cP n'est pas dans cette transaction (seul son
    ///         hash, signé par les enclaves). Le paiement part avec deliver(bountyId, fingerprint, cP).
    function acceptClaim(Claim calldata r, bytes[] calldata signatures) external nonReentrant {
        Payout memory po = _accept(r, signatures);
        Payout storage s = _pending[r.bountyId][r.fingerprint];
        s.payee = po.payee;
        s.tier = po.tier;
        s.acceptedAt = po.acceptedAt;
        s.cPHash = po.cPHash;
        s.claimDigest = po.claimDigest;
        s.amount = po.amount;
        s.netFee = po.netFee;
        s.opFee = po.opFee;
        s.ops = po.ops;
    }

    /// @notice v2 : livre cP (vérifié contre le hash réservé) et paie chasseur, réseau et opérateurs. Ouvert à tous :
    ///         ne dépend d'aucun contrat du protocole ; un transfert refusé devient un crédit (withdrawCredit).
    function deliver(uint256 bountyId, bytes32 fingerprint, bytes calldata cP) external nonReentrant {
        Payout storage s = _pending[bountyId][fingerprint];
        if (s.payee == address(0)) revert NothingToDeliver();
        if (keccak256(cP) != s.cPHash) revert CipherMismatch();
        Payout memory po = s;
        delete _pending[bountyId][fingerprint];
        _pay(bountyId, fingerprint, po, cP);
    }

    /// @notice Vérifie tout, paie le chasseur et livre le chiffré au protocole — sinon revert (chemin v1, en une
    ///         transaction). Déconseillé : si la transaction échoue (course avec une autre réclamation, plafond
    ///         d'exposition…), cP reste lisible dans sa calldata. Préférer acceptClaim puis deliver.
    function claim(Claim calldata r, bytes[] calldata signatures, bytes calldata cP) external nonReentrant {
        if (keccak256(cP) != r.cPHash) revert CipherMismatch();
        Payout memory po = _accept(r, signatures);
        _pay(r.bountyId, r.fingerprint, po, cP);
    }

    /// @notice v2 : un paiement réservé et jamais livré retourne au pool après DELIVERY_WINDOW (ouvert à tous).
    function cancelUndelivered(uint256 bountyId, bytes32 fingerprint) external nonReentrant {
        Payout storage s = _pending[bountyId][fingerprint];
        if (s.payee == address(0)) revert NothingToDeliver();
        if (block.timestamp < uint256(s.acceptedAt) + DELIVERY_WINDOW) revert DeliveryWindowOpen();
        uint256 back = s.amount + s.netFee + s.opFee;
        delete _pending[bountyId][fingerprint];
        _bounties[bountyId].balance += back;
        emit UndeliveredCancelled(bountyId, fingerprint, back);
    }

    function withdrawRemaining(uint256 bountyId) external nonReentrant {
        Bounty storage bnty = _bounties[bountyId];
        if (msg.sender != bnty.protocol) revert NotProtocol();
        if (block.timestamp <= bnty.deadline) revert NotExpired();
        uint256 amount = bnty.balance;
        bnty.balance = 0;
        _payOut(bnty.protocol, amount);
        emit RemainingWithdrawn(bountyId, amount);
    }

    /// @notice v2 : retire un paiement dont le transfert avait été refusé.
    function withdrawCredit() external nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credit[msg.sender] = 0;
        _payOut(msg.sender, amount);
    }

    /// @notice Saisie pour ÉQUIVOCATION. Le rejeu est déterministe : mêmes entrées ⇒ même résultat. Donc
    ///         seules deux réclamations aux MÊMES entrées (bountyId, blockN, blockHashN, payee,
    ///         predicateHash, cPHash, fingerprint) mais aux SORTIES différentes (loss ou tier), signées par
    ///         la même enclave du produit, prouvent la triche : saisie de la caution, radiation, victime
    ///         identifiable = le protocole. Une enclave honnête signe légitimement des réclamations
    ///         différentes pour le même exploit (autre bloc N, autre échéance, autre chasseur) : refus
    ///         (NotEquivocation), aucune saisie. L'échéance (deadline) n'est ni une entrée ni une sortie.
    ///         v2 : la clé est liée à vie à son (opérateur, produit) dans l'EnclaveRegistry : la déplacer ne fait
    ///         plus échapper à la saisie.
    function reportEquivocation(Claim calldata a, bytes calldata sigA, Claim calldata b, bytes calldata sigB)
        external
        nonReentrant
    {
        Bounty storage bnty = _bounties[a.bountyId];
        if (bnty.protocol == address(0)) revert BadProduct();
        if (!_sameInputs(a, b)) revert NotEquivocation();
        if (a.loss == b.loss && a.tier == b.tier) revert NotEquivocation();
        bytes32 hb = _claimHash(b);

        address signerA = _hashTypedDataV4(_claimHash(a)).recover(sigA);
        address signerB = _hashTypedDataV4(hb).recover(sigB);
        if (signerA != signerB) revert NotEquivocation();

        IEnclaveRegistry.Enclave memory e = enclaves.enclaveOf(signerA);
        if (e.signer == address(0) || e.productId != bnty.productId) revert NotEquivocation();

        bond.slash(e.operator, msg.sender, bnty.protocol);

        // v2 bis : gaz du verdict exigé avant l'appel ; le try/catch ne couvre qu'une panne du registre.
        // v2.1 bis : le requestHash porte l'opérateur saisi — un verdict de faute PAR opérateur (deux opérateurs qui
        // équivoquent sur la même empreinte n'entrent plus en collision ; un nouveau signalement contre le même
        // opérateur ne réécrit pas : VerdictLog.AlreadyRecorded).
        uint256 agentId = bond.agentIdOf(e.operator);
        bytes32 requestHash = keccak256(
            abi.encode(block.chainid, address(this), "equivocation", a.bountyId, a.fingerprint, e.operator)
        );
        _requireVerdictGas();
        try verdict.record(agentId, requestHash, "", hb, "", 0, "tdx-dcap/slash") {}
        catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded());
        }
        emit EquivocationSlashed(a.bountyId, signerA, e.operator);
    }

    /// @notice v2 : RÉFUTE une réclamation acceptée (fausse preuve, par exemple d'une enclave forgée) dans les
    ///         REFUTE_WINDOW qui suivent son acceptation. La réfutation porte sur le digest de la réclamation et
    ///         donne un autre résultat (non prouvée, ou autre perte / autre palier) ; elle est signée par des enclaves
    ///         actives du produit, d'opérateurs DISTINCTS, qui n'ont pas signé la réclamation, au moins REFUTE_QUORUM
    ///         et STRICTEMENT plus nombreux que les opérateurs de la réclamation. Effets : chaque opérateur signataire
    ///         de la réclamation est saisi (50 % au dénonciateur, 50 % au protocole) ; le paiement, s'il n'est pas
    ///         encore livré, retourne au pool.
    /// @param ops les opérateurs signataires de la réclamation, tels qu'émis par ClaimAccepted
    function refute(Claim calldata r, address[] calldata ops, Refutation calldata f, bytes[] calldata signatures)
        external
        nonReentrant
    {
        bytes32 digest = _hashTypedDataV4(_claimHash(r));
        ClaimRecord storage rec = claimRecords[digest];
        if (rec.acceptedAt == 0) revert UnknownClaim();
        if (rec.refuted) revert AlreadyRefuted();
        if (block.timestamp > uint256(rec.acceptedAt) + REFUTE_WINDOW) revert RefuteWindowOver();
        if (keccak256(abi.encode(ops)) != rec.opsHash) revert BadOps();
        if (f.claimDigest != digest) revert NotARefutation();
        if (f.proven && f.loss == r.loss && f.tier == r.tier) revert NotARefutation();

        Bounty storage bnty = _bounties[r.bountyId];
        uint256 n = _countRefuters(f, bnty.productId, ops, signatures);
        if (n < REFUTE_QUORUM || n <= ops.length) revert NeedMoreRefuters();

        rec.refuted = true;

        // le paiement n'est pas encore parti : il retourne au pool
        Payout storage s = _pending[r.bountyId][r.fingerprint];
        if (s.payee != address(0) && s.claimDigest == digest) {
            bnty.balance += s.amount + s.netFee + s.opFee;
            delete _pending[r.bountyId][r.fingerprint];
        }

        for (uint256 i = 0; i < ops.length; i++) {
            bond.slash(ops[i], msg.sender, bnty.protocol);
        }

        uint256 agentId = bond.agentIdOf(ops[0]);
        bytes32 requestHash = keccak256(abi.encode(block.chainid, address(this), "refuted", r.bountyId, digest));
        _requireVerdictGas(); // v2 bis
        try verdict.record(agentId, requestHash, "", digest, "", 0, "tdx-dcap/refuted") {}
        catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1 bis : jamais tout le revert
        }
        emit ClaimRefuted(r.bountyId, digest, msg.sender);
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _bounties[bountyId];
    }

    /// @notice v2 : le paiement réservé pour (prime, empreinte), en attente de livraison (payee nul si aucun).
    function pendingOf(uint256 bountyId, bytes32 fingerprint) external view returns (Payout memory) {
        return _pending[bountyId][fingerprint];
    }

    /// @notice v2 : digest EIP-712 d'une réclamation (ce que signent les enclaves, et ce que porte une réfutation).
    function claimDigest(Claim calldata r) external view returns (bytes32) {
        return _hashTypedDataV4(_claimHash(r));
    }

    // ---- interne ----

    /// @dev Vérifie la réclamation, applique les règles de paiement v2, prend l'exposition, met la cible en pause, et
    ///      rend le paiement à verser (réservé : déjà retiré du solde de la prime).
    function _accept(Claim calldata r, bytes[] calldata signatures) private returns (Payout memory po) {
        Bounty storage bnty = _bounties[r.bountyId];
        if (bnty.protocol == address(0)) revert BadProduct();
        if (bnty.paused && r.blockN >= bnty.pausedFromBlock) revert BountyPausedErr();
        if (block.timestamp > bnty.deadline) revert Expired();
        // échéance SIGNÉE de la réclamation (TTL de l'enclave) : passée, la réclamation ne vaut plus rien
        if (r.deadline < block.timestamp) revert ClaimExpired();

        // palier atteint
        uint256 tierAmt = _tierPayout(r.bountyId, r.tier, r.loss);

        if (r.predicateHash != bnty.predicateHash) revert PredicateMismatch();

        // ancrage sur un bloc récent (EIP-2935)
        bytes32 h = History.blockHashAt(r.blockN); // revert AnchorTooOld hors fenêtre
        if (h != r.blockHashN) revert AnchorMismatch();

        if (fingerprintPaid[r.bountyId][r.fingerprint]) revert AlreadyPaid();
        // v2 : un exploit ne se paie pas deux fois — ancré après le dernier paiement, palier strictement supérieur
        if (r.blockN <= bnty.lastPaidBlock) revert AnchorBeforeLastPayout();
        if (tierAmt <= bnty.paidAmount) revert TierAlreadyPaid();

        po.amount = tierAmt - bnty.paidAmount; // seule la différence avec le palier déjà accordé
        po.netFee = po.amount * networkBountyBps / 10_000;
        po.opFee = po.amount * operatorBountyBps / 10_000;
        uint256 total = po.amount + po.netFee + po.opFee;
        if (bnty.balance < total) revert PoolTooSmall();

        // signatures d'enclaves actives au bloc N ; au-dessus du plafond d'une seule (montant du PALIER) : k
        // opérateurs distincts
        po.claimDigest = _hashTypedDataV4(_claimHash(r));
        uint256 nOps;
        (po.ops, nOps) = _checkSigners(po.claimDigest, bnty.productId, r.blockN, signatures);
        if (tierAmt > bnty.singleCap && nOps < bnty.k) revert NeedMoreEnclaves();
        address[] memory ops = po.ops;
        assembly ("memory-safe") {
            mstore(ops, nOps) // ne garder que les opérateurs distincts
        }

        // ---- effets avant tout appel externe ----
        fingerprintPaid[r.bountyId][r.fingerprint] = true;
        bnty.balance -= total;
        bnty.paidAmount = tierAmt;
        bnty.lastPaidBlock = uint64(block.number);
        po.payee = r.payee;
        po.tier = r.tier;
        po.acceptedAt = uint64(block.timestamp);
        po.cPHash = r.cPHash;
        claimRecords[po.claimDigest] =
            ClaimRecord({acceptedAt: uint64(block.timestamp), refuted: false, opsHash: keccak256(abi.encode(ops))});

        // exposition répartie sur les opérateurs distincts : montant ÷ nOps chacun, borné par C4
        // (½ caution disponible ET plafond d'exposition du produit, par opérateur, sur 24 h glissantes)
        uint256 cap = products.getProduct(bnty.productId).exposureCap;
        uint256 per = po.amount / nOps;
        for (uint256 i = 0; i < nOps; i++) {
            bond.consumeExposure(ops[i], bnty.productId, per, cap);
        }

        emit ClaimAccepted(r.bountyId, po.claimDigest, r, ops, po.amount);

        // pause de la cible si le protocole a confié ce rôle au contrat (bornée, jamais bloquante)
        _pauseTarget(bnty.targetToPause);
    }

    /// @dev Livre cP (événement) et paie ; un transfert refusé devient un crédit (jamais un échec).
    function _pay(uint256 bountyId, bytes32 fingerprint, Payout memory po, bytes calldata cP) private {
        emit ExploitDelivered(bountyId, cP);
        emit BountyPaid(bountyId, po.payee, po.amount, po.tier);

        uint256 n = po.ops.length;
        uint256 opPer = po.opFee / n;
        _payOrCredit(po.payee, po.amount);
        // le reste de la division de la part opérateurs va au réseau (rien ne reste bloqué)
        _payOrCredit(treasury, po.netFee + (po.opFee - opPer * n));
        for (uint256 i = 0; i < n; i++) {
            _payOrCredit(po.ops[i], opPer);
        }

        // verdict ERC-8004 : une panne du registre ne bloque pas le paiement ; v2 bis : le gaz du verdict est exigé
        // avant l'appel (un appel au gaz minimal ne fait plus sauter le verdict)
        uint256 agentId = bond.agentIdOf(po.ops[0]);
        bytes32 requestHash = keccak256(abi.encode(block.chainid, address(this), "bounty", bountyId, fingerprint));
        _requireVerdictGas();
        try verdict.record(agentId, requestHash, "", po.cPHash, "", 100, "tdx-dcap/sealed-bounty") {}
        catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1 bis : jamais tout le revert
        }
    }

    /// @dev Un transfert refusé (adresse bloquée, USDC en pause) devient un crédit. Un transfert AFFAMÉ (gaz minimal) ne
    ///      le peut pas : après un manque de gaz dans l'appel, il ne reste que 1/64 du gaz, qui ne paie pas l'écriture du
    ///      crédit — c'est toute la transaction qui échoue (vérifié par test_FIXED_v2_minimalGasDeliverPaysAndWritesVerdict).
    function _payOrCredit(address to, uint256 amount) private {
        if (amount == 0) return;
        try usdc.transfer(to, amount) returns (bool ok) {
            if (ok) return;
        } catch {}
        credit[to] += amount;
        emit Credited(to, amount);
    }

    /// @dev Appel de pause() BORNÉ : PAUSE_GAS exactement (on exige de quoi le donner : un chasseur n'affame pas la
    ///      pause), aucune donnée de retour recopiée (pas de « return bomb »), échec ignoré.
    function _pauseTarget(address target) private {
        if (target == address(0)) return;
        if (gasleft() < PAUSE_GAS * 64 / 63 + 10_000) revert NotEnoughGasForPause();
        bytes4 sel = PAUSE_SELECTOR;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, sel)
            pop(call(PAUSE_GAS, target, 0, ptr, 4, 0, 0))
        }
    }

    /// @dev v2 bis : exige le gaz du verdict ERC-8004 avant de l'appeler (voir VERDICT_GAS).
    function _requireVerdictGas() private view {
        if (gasleft() < VERDICT_GAS * 64 / 63 + 20_000) revert InsufficientGasForVerdict();
    }

    function _tierPayout(uint256 bountyId, uint8 tier, uint256 loss) private view returns (uint256) {
        uint256[] storage mins = tierMinLoss[bountyId];
        if (tier >= mins.length) revert BadTierIndex();
        if (loss < mins[tier]) revert LossTooLow();
        return tierAmount[bountyId][tier];
    }

    /// @dev Recouvre chaque signataire, exige une enclave active du produit au bloc N, et compte
    ///      les opérateurs DISTINCTS (deux enclaves du même opérateur comptent une fois). Tous signent la
    ///      même réclamation.
    function _checkSigners(bytes32 digest, uint256 productId, uint64 blockN, bytes[] calldata signatures)
        private
        view
        returns (address[] memory ops, uint256 nOps)
    {
        uint256 n = signatures.length;
        if (n == 0 || n > MAX_SIGS) revert NoValidSigner();
        ops = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            address signer = digest.recover(signatures[i]);
            address op = enclaves.activeOperatorAt(signer, productId, blockN);
            if (op == address(0)) revert NoValidSigner();
            bool seen = false;
            for (uint256 j = 0; j < nOps; j++) {
                if (ops[j] == op) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                ops[nOps] = op;
                nOps++;
            }
        }
    }

    /// @dev Opérateurs DISTINCTS derrière une réfutation : enclaves actives du produit MAINTENANT, aucune d'un
    ///      opérateur signataire de la réclamation.
    function _countRefuters(Refutation calldata f, uint256 productId, address[] calldata claimOps, bytes[] calldata sigs)
        private
        view
        returns (uint256 n)
    {
        if (sigs.length == 0 || sigs.length > 2 * MAX_SIGS) revert NeedMoreRefuters();
        bytes32 d = _hashTypedDataV4(keccak256(abi.encode(REFUTATION_TYPEHASH, f.claimDigest, f.proven, f.loss, f.tier)));
        address[] memory seen = new address[](sigs.length);
        for (uint256 i = 0; i < sigs.length; i++) {
            address op = enclaves.activeOperatorAt(d.recover(sigs[i]), productId, block.number);
            if (op == address(0)) revert NoValidSigner();
            for (uint256 j = 0; j < claimOps.length; j++) {
                if (claimOps[j] == op) revert RefuterIsClaimOperator();
            }
            bool dup = false;
            for (uint256 j = 0; j < n; j++) {
                if (seen[j] == op) {
                    dup = true;
                    break;
                }
            }
            if (!dup) seen[n++] = op;
        }
    }

    /// @dev Les ENTRÉES d'une réclamation : tout ce que le rejeu déterministe prend en compte.
    function _sameInputs(Claim calldata a, Claim calldata b) private pure returns (bool) {
        return a.bountyId == b.bountyId && a.blockN == b.blockN && a.blockHashN == b.blockHashN
            && a.payee == b.payee && a.predicateHash == b.predicateHash && a.cPHash == b.cPHash
            && a.fingerprint == b.fingerprint;
    }

    function _claimHash(Claim calldata r) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                r.bountyId,
                r.payee,
                r.blockN,
                r.blockHashN,
                r.predicateHash,
                r.loss,
                r.tier,
                r.fingerprint,
                r.cPHash,
                r.deadline
            )
        );
    }
}
