// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {IIdentityRegistry} from "./interfaces/IERC8004.sol";
import {UsdcPayer} from "./lib/UsdcPayer.sol";

/// @title OperatorBond (SPEC-TECH §C4) — v2
/// @notice La caution en USDC d'un opérateur. Ce qu'elle garantit, exactement :
///         - elle BORNE LE DÉBIT : sur la foi des enclaves d'un opérateur, les contrats de règlement autorisés
///           (C5/C6) ne libèrent jamais plus de la moitié de sa caution disponible sur TOUTE période de 24 h, tous
///           produits confondus, ni plus que le plafond `exposureCap` de chaque produit (trois seaux de 12 h : une
///           exposition compte entre 24 h et 36 h) ;
///         - elle est SAISIE en entier sur une faute PROUVÉE on-chain : équivocation (SessionPay, SealedBounty) ou
///           réclamation de prime réfutée par un contre-rejeu d'enclaves d'autres opérateurs (SealedBounty.refute) ;
///         - elle reste bloquée UNBOND_DELAY après la dernière exposition (le temps de prouver une faute).
///         Ce qu'elle NE fait PAS : un reçu d'inférence gonflé par une enclave forgée n'est pas prouvable ; la
///         caution en limite le débit, elle ne le rembourse pas.
///
///         v2 (revue adverse du 7/11) :
///         - plus de clé toute-puissante. Le DÉPLOYEUR câble une seule fois, pendant le déploiement (initialize),
///           le registre d'enclaves et les contrats de règlement — avant toute caution, donc sans rien à prendre —
///           puis n'a plus aucun pouvoir. Le propriétaire (multisig 2-sur-3, passé au constructeur) ne peut ajouter
///           un contrat de règlement qu'après SETTLEMENT_DELAY = UNBOND_DELAY + 1 jour (chaque opérateur a le temps
///           de partir) ; il peut en RETIRER un immédiatement (frein d'urgence) ;
///         - exposition sur 24 h GLISSANTES et règle « ½ caution » GLOBALE par opérateur (v1 : fenêtre fixe et par
///           produit → toute la caution passait en une seconde, et N produits = N × ½ caution) ;
///         - la caution minimale d'un produit est RÉSERVÉE par clé d'enclave inscrite (une caution de 100 USDC ne
///           couvre plus dix enclaves) ; seule la caution libre se retire ;
///         - `setAgentId` exige d'être propriétaire (ou approuvé) de l'agent ERC-8004.
contract OperatorBond is IOperatorBond, UsdcPayer {
    uint64 public constant UNBOND_DELAY = 7 days;
    /// @notice Fenêtre de la règle « ½ caution » et du plafond produit : 24 h glissantes.
    uint64 public constant WINDOW = 24 hours;
    /// @notice Taille d'un seau. Trois seaux : toute exposition compte entre 24 h et 36 h ; sur TOUTE période de
    ///         24 h, jamais plus de ½ caution (ni plus que le plafond produit).
    uint64 public constant BUCKET = 12 hours;
    /// @notice Délai avant qu'un NOUVEAU contrat de règlement soit autorisé (après le câblage initial).
    uint64 public constant SETTLEMENT_DELAY = UNBOND_DELAY + 1 days;

    address public immutable owner; // multisig : ajout à délai, retrait immédiat d'un contrat de règlement
    address public immutable deployer; // câble une seule fois pendant le déploiement, puis plus rien
    address public immutable treasury; // fonds du réseau (part de saisie sans victime)
    IIdentityRegistry public immutable identity; // registre d'identité ERC-8004 (propriété des agentId)

    /// @notice EnclaveRegistry autorisé à réserver / libérer la caution des clés d'enclave (fixé à l'initialisation).
    address public registry;
    bool public initialized;

    /// @dev Trois seaux de 12 h dans UN emplacement : `epoch` = index du seau courant (timestamp / BUCKET).
    struct Ring {
        uint64 epoch;
        uint64 a0; // seau courant
        uint64 a1; // seau précédent
        uint64 a2; // seau d'avant
    }

    mapping(address => uint256) private _bond;
    mapping(address => uint256) private _pendingUnbond;
    mapping(address => uint64) public unbondableAt;
    /// @notice Dernière exposition prise sur la foi des enclaves de l'opérateur (aucun retrait avant + UNBOND_DELAY).
    mapping(address => uint64) public lastExposureAt;
    mapping(address => Ring) private _opExposure; // global, par opérateur (règle « ½ caution »)
    mapping(address => mapping(uint256 => Ring)) private _exposure; // par (opérateur, produit) (plafond produit)
    mapping(address => uint256) private _agentId;
    /// @notice L'opérateur qui s'est lié à cet agent ERC-8004 (0 si aucun).
    mapping(uint256 => address) public operatorOfAgent;
    mapping(address => bool) public banned;
    mapping(address => bool) public isSettlement;
    /// @notice Contrat de règlement proposé → instant à partir duquel applySettlement l'autorise.
    mapping(address => uint64) public settlementApplyAt;

    mapping(address => uint256) public override reservedFor; // clé d'enclave → caution réservée
    mapping(address => address) public reservedBy; // clé d'enclave → opérateur
    mapping(address => uint256) public reservedTotal; // opérateur → total réservé

    event SettlementProposed(address indexed settlement, uint64 applyAt);
    event SettlementAuthorized(address indexed settlement);
    event SettlementRemoved(address indexed settlement);
    event AgentIdSet(address indexed operator, uint256 agentId);

    error NotOwner();
    error NotDeployer();
    error NotSettlement();
    error NotRegistry();
    error Banned();
    error TooMuchExposure();
    /// @notice v2 : le plafond d'exposition du produit (par opérateur, 24 h glissantes) serait dépassé.
    error ExposureCapExceeded();
    error UnbondLocked();
    error NothingToWithdraw();
    error InsufficientBond();
    error BadParams();
    error AlreadyInitialized();
    error NoPendingSettlement();
    error TooEarly();
    /// @notice v2 : l'appelant n'est ni propriétaire ni approuvé de cet agent dans le registre d'identité ERC-8004.
    error NotAgentOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (!isSettlement[msg.sender]) revert NotSettlement();
        _;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry || registry == address(0)) revert NotRegistry();
        _;
    }

    /// @param _owner    gouvernance (multisig 2-sur-3 sur Arc mainnet ; jamais la clé de déploiement)
    /// @param _identity registre d'identité ERC-8004 (propriété des agentId)
    constructor(address _usdc, address _treasury, address _owner, address _identity) UsdcPayer(_usdc) {
        if (_treasury == address(0) || _owner == address(0) || _identity == address(0)) revert BadParams();
        owner = _owner;
        deployer = msg.sender;
        treasury = _treasury;
        identity = IIdentityRegistry(_identity);
    }

    // ---- câblage (une fois, au déploiement), puis autorisations à délai ----

    /// @notice Câblage initial, UNE seule fois, par le déployeur et pendant le déploiement (aucune caution n'est
    ///         encore déposée : il n'y a rien à prendre) : le registre d'enclaves et les contrats de règlement.
    function initialize(address _registry, address[] calldata settlements) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        if (_registry == address(0)) revert BadParams();
        initialized = true;
        registry = _registry;
        for (uint256 i = 0; i < settlements.length; i++) {
            if (settlements[i] == address(0)) revert BadParams();
            isSettlement[settlements[i]] = true;
            emit SettlementAuthorized(settlements[i]);
        }
    }

    /// @notice Propose un nouveau contrat de règlement ; il ne pourra saisir ou consommer une caution qu'après
    ///         SETTLEMENT_DELAY (8 jours), plus long que UNBOND_DELAY : chaque opérateur peut partir avant.
    function proposeSettlement(address settlement) external onlyOwner {
        if (settlement == address(0)) revert BadParams();
        uint64 applyAt = uint64(block.timestamp) + SETTLEMENT_DELAY;
        settlementApplyAt[settlement] = applyAt;
        emit SettlementProposed(settlement, applyAt);
    }

    /// @notice Autorise un contrat de règlement proposé, une fois le délai écoulé (n'importe qui peut l'appeler).
    function applySettlement(address settlement) external {
        uint64 applyAt = settlementApplyAt[settlement];
        if (applyAt == 0) revert NoPendingSettlement();
        if (block.timestamp < applyAt) revert TooEarly();
        delete settlementApplyAt[settlement];
        isSettlement[settlement] = true;
        emit SettlementAuthorized(settlement);
    }

    /// @notice Retrait IMMÉDIAT d'un contrat de règlement (frein d'urgence : il ne fait que retirer un pouvoir).
    function removeSettlement(address settlement) external onlyOwner {
        isSettlement[settlement] = false;
        delete settlementApplyAt[settlement];
        emit SettlementRemoved(settlement);
    }

    // ---- caution ----

    function bond(uint256 amount, Auth calldata auth) external {
        if (banned[msg.sender]) revert Banned();
        _pullWithAuth(msg.sender, amount, auth);
        _bond[msg.sender] += amount;
        emit Bonded(msg.sender, amount);
    }

    function bondFrom(uint256 amount) external {
        if (banned[msg.sender]) revert Banned();
        _pullWithAllowance(msg.sender, amount);
        _bond[msg.sender] += amount;
        emit Bonded(msg.sender, amount);
    }

    /// @notice Demande de retrait : seulement la caution LIBRE (ni en demande, ni réservée pour une enclave).
    function requestUnbond(uint256 amount) external {
        if (amount > freeBond(msg.sender)) revert InsufficientBond();
        _pendingUnbond[msg.sender] += amount;
        unbondableAt[msg.sender] = uint64(block.timestamp) + UNBOND_DELAY;
        emit UnbondRequested(msg.sender, amount, unbondableAt[msg.sender]);
    }

    /// @notice Retrait UNBOND_DELAY après la demande ET UNBOND_DELAY après la dernière exposition : une faute
    ///         prouvée dans ce délai (équivocation, réclamation réfutée) trouve toujours la caution.
    function withdraw() external {
        uint256 amount = _pendingUnbond[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        if (block.timestamp < withdrawableAt(msg.sender)) revert UnbondLocked();
        _pendingUnbond[msg.sender] = 0;
        _bond[msg.sender] -= amount;
        _payOut(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Lie l'opérateur à SON agent ERC-8004 : il doit en être propriétaire, ou approuvé par le
    ///         propriétaire, dans le registre d'identité. 0 = aucun agent.
    function setAgentId(uint256 agentId) external {
        if (agentId != 0) {
            address agentOwner = identity.ownerOf(agentId);
            if (agentOwner != msg.sender && !identity.isApprovedForAll(agentOwner, msg.sender)) revert NotAgentOwner();
            address previous = operatorOfAgent[agentId];
            if (previous != address(0) && previous != msg.sender) _agentId[previous] = 0; // l'agent change de main
            operatorOfAgent[agentId] = msg.sender;
        }
        uint256 old = _agentId[msg.sender];
        if (old != 0 && old != agentId && operatorOfAgent[old] == msg.sender) operatorOfAgent[old] = address(0);
        _agentId[msg.sender] = agentId;
        emit AgentIdSet(msg.sender, agentId);
    }

    // ---- réservation de la caution minimale par clé d'enclave (appelé par l'EnclaveRegistry) ----

    /// @inheritdoc IOperatorBond
    function reserve(address operator, address signer, uint256 amount) external override onlyRegistry {
        if (banned[operator]) revert Banned();
        if (reservedFor[signer] != 0 || amount == 0) return; // déjà réservée (renouvellement) ou rien à réserver
        if (freeBond(operator) < amount) revert InsufficientBond();
        reservedFor[signer] = amount;
        reservedBy[signer] = operator;
        reservedTotal[operator] += amount;
        emit BondReserved(operator, signer, amount);
    }

    /// @inheritdoc IOperatorBond
    function release(address signer) external override onlyRegistry {
        uint256 amount = reservedFor[signer];
        if (amount == 0) return;
        address operator = reservedBy[signer];
        uint256 total = reservedTotal[operator];
        reservedTotal[operator] = total > amount ? total - amount : 0;
        delete reservedFor[signer];
        delete reservedBy[signer];
        emit BondReleased(operator, signer, amount);
    }

    // ---- exposition (appelé par C5/C6) ----

    /// @inheritdoc IOperatorBond
    function consumeExposure(address operator, uint256 productId, uint256 amount, uint256 cap)
        external
        override
        onlySettlement
    {
        if (banned[operator]) revert Banned();
        if (amount > type(uint64).max) revert TooMuchExposure();
        uint64 e = uint64(block.timestamp / BUCKET);

        // jamais plus de la moitié de la caution disponible sur 24 h glissantes, tous produits confondus
        Ring memory g = _roll(_opExposure[operator], e);
        if (_sum(g) + amount > availableBond(operator) / 2) revert TooMuchExposure();

        // ni plus que le plafond du produit pour ce couple (opérateur, produit), sur la même fenêtre glissante
        Ring memory p = _roll(_exposure[operator][productId], e);
        if (cap != 0 && _sum(p) + amount > cap) revert ExposureCapExceeded();

        g.a0 += uint64(amount);
        p.a0 += uint64(amount);
        _opExposure[operator] = g;
        _exposure[operator][productId] = p;
        lastExposureAt[operator] = uint64(block.timestamp);
        emit ExposureConsumed(operator, productId, amount);
    }

    // ---- saisie (appelé par un contrat de règlement qui a prouvé une faute) ----

    /// @notice Saisit TOUTE la caution de `operator`, bannit, et répartit :
    ///         50 % au dénonciateur, 50 % à la victime si identifiable, sinon au fonds du réseau.
    function slash(address operator, address reporter, address victim) external onlySettlement {
        uint256 seized = _bond[operator];
        _bond[operator] = 0;
        _pendingUnbond[operator] = 0;
        banned[operator] = true;

        uint256 toReporter = seized / 2;
        uint256 rest = seized - toReporter;
        _payOut(reporter, toReporter);
        _payOut(victim != address(0) ? victim : treasury, rest);

        emit Slashed(operator, reporter, victim, seized);
    }

    // ---- lectures ----

    function bondOf(address operator) external view override returns (uint256) {
        return _bond[operator];
    }

    function availableBond(address operator) public view override returns (uint256) {
        return _bond[operator] - _pendingUnbond[operator];
    }

    function freeBond(address operator) public view override returns (uint256) {
        uint256 avail = availableBond(operator);
        uint256 reserved = reservedTotal[operator];
        return avail > reserved ? avail - reserved : 0;
    }

    function exposureOf(address operator, uint256 productId) external view override returns (uint256) {
        return _sum(_roll(_exposure[operator][productId], uint64(block.timestamp / BUCKET)));
    }

    function totalExposureOf(address operator) external view override returns (uint256) {
        return _sum(_roll(_opExposure[operator], uint64(block.timestamp / BUCKET)));
    }

    /// @notice Date à partir de laquelle la demande de retrait en cours peut être retirée.
    function withdrawableAt(address operator) public view returns (uint64) {
        uint64 a = unbondableAt[operator];
        uint64 last = lastExposureAt[operator];
        uint64 b = last == 0 ? 0 : last + UNBOND_DELAY;
        return a > b ? a : b;
    }

    function agentIdOf(address operator) external view override returns (uint256) {
        return _agentId[operator];
    }

    // ---- interne ----

    /// @dev Fait avancer les seaux jusqu'au seau `e` (une exposition de plus de 36 h tombe).
    function _roll(Ring memory r, uint64 e) private pure returns (Ring memory) {
        if (e == r.epoch) return r;
        if (e == r.epoch + 1) return Ring({epoch: e, a0: 0, a1: r.a0, a2: r.a1});
        if (e == r.epoch + 2) return Ring({epoch: e, a0: 0, a1: 0, a2: r.a0});
        return Ring({epoch: e, a0: 0, a1: 0, a2: 0});
    }

    function _sum(Ring memory r) private pure returns (uint256) {
        return uint256(r.a0) + r.a1 + r.a2;
    }
}
