// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";
import {IProductRegistry} from "../interfaces/IProductRegistry.sol";
import {PckChip} from "./PckChip.sol";

interface ITimelocked {
    function timelock() external view returns (uint64);
}

/// @title MachineRegistry — les DEUX NIVEAUX d'opérateur d'ArcHive (10/11/2026)
/// @notice - Niveau « ouvert » (0) : n'importe qui fait tourner une enclave ; le contrat d'Arc vérifie son attestation Intel
///           et l'opérateur dépose une caution (EnclaveRegistry + OperatorBond, inchangés).
///         - Niveau « vérifié » (1) : en plus, la MACHINE (sa puce, identifiée par le certificat PCK d'Intel : PPID) est
///           déclarée en datacenter connu par un VÉRIFICATEUR que le produit accepte. Raison : les attaques physiques de
///           2025 (TEE.fail, Battering RAM, Wiretap) extraient des clés d'attestation avec un accès physique au serveur.
///         Le protocole n'impose aucun vérificateur et ne prend aucun péage : chacun peut déclarer des machines (son
///         adresse est son identité de vérificateur) ; l'AUTEUR de chaque produit choisit le niveau minimum et les
///         vérificateurs qu'il accepte, derrière le timelock du ProductRegistry. Un opérateur vérifié fixe son prix.
///         Trois briques :
///          1. bindMachine : lie une clé d'enclave à la puce qui l'héberge, à partir du quote que l'EnclaveRegistry a
///             VÉRIFIÉ à l'inscription (keccak256(quote) = Enclave.quoteHash) ; PPID lu par PckChip, FMSPC recoupé avec
///             celui qu'a extrait Automata. Un renouvellement change le quote : il faut relier (sinon, niveau ouvert) ;
///          2. attestMachine / revokeMachine : les déclarations des vérificateurs (par exemple ProofOfCloudAuditor, qui
///             vérifie on-chain la signature de l'alliance Proof of Cloud) ;
///          3. proposePolicy / applyPolicy : la politique de chaque produit ; meetsPolicy la lit (PolicyEnclaves s'en
///             sert pour les contrats de règlement).
contract MachineRegistry {
    uint8 public constant LEVEL_OPEN = 0;
    uint8 public constant LEVEL_VERIFIED = 1;
    /// @notice Vérificateurs acceptés par un produit, au plus.
    uint256 public constant MAX_AUDITORS = 8;

    IEnclaveRegistry public immutable registry;
    IProductRegistry public immutable products;

    struct Binding {
        bytes16 ppid; // puce de la machine (certificat PCK d'Intel)
        bytes32 quoteHash; // quote de l'inscription liée (celui de la fenêtre en cours tant qu'il n'est pas renouvelé)
        uint64 boundAt;
    }

    struct Audit {
        uint64 expiresAt; // horodatage ; au-delà, la déclaration ne vaut plus
        bool revoked;
    }

    struct Policy {
        uint8 minLevel;
        address[] auditors;
    }

    struct Pending {
        uint8 minLevel;
        address[] auditors;
        uint64 applyAt;
        bool exists;
    }

    mapping(address signer => Binding) private _binding;
    /// @notice Déclaration d'un vérificateur sur une puce.
    mapping(address auditor => mapping(bytes16 ppid => Audit)) public auditOf;
    mapping(uint256 productId => Policy) private _policy;
    mapping(uint256 productId => Pending) private _pending;

    event MachineBound(address indexed signer, bytes16 indexed ppid, bytes32 quoteHash);
    event MachineAttested(address indexed auditor, bytes16 indexed ppid, uint64 expiresAt, string site, string evidence);
    event MachineRevoked(address indexed auditor, bytes16 indexed ppid, string reason);
    event PolicyProposed(uint256 indexed productId, uint8 minLevel, address[] auditors, uint64 applyAt);
    event PolicyApplied(uint256 indexed productId, uint8 minLevel, address[] auditors);

    error NotActiveEnclave();
    error NotRegisteredQuote();
    error FmspcMismatch();
    error BadAudit();
    error NotAuthor();
    error BadPolicy();
    error NoPendingPolicy();
    error TooEarly();

    constructor(address _registry, address _products) {
        registry = IEnclaveRegistry(_registry);
        products = IProductRegistry(_products);
    }

    // ---------------------------------------------------------------- 1. liaison enclave → machine

    /// @notice Lie la clé d'enclave `signer` à la puce qui l'héberge. Ouvert à tous (rien à gagner à le faire pour
    ///         autrui) : `quote` doit être exactement le quote que l'EnclaveRegistry a vérifié pour l'inscription en cours.
    function bindMachine(address signer, bytes calldata quote) external returns (bytes16 ppid) {
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(signer);
        if (e.signer == address(0) || !e.active) revert NotActiveEnclave();
        bytes32 qh = keccak256(quote);
        if (qh != e.quoteHash) revert NotRegisteredQuote();
        bytes6 fmspc;
        (ppid, fmspc) = PckChip.chipOf(quote);
        // la même plate-forme que celle qu'a lue Automata dans ce même certificat
        if (fmspc != e.fmspc) revert FmspcMismatch();
        _binding[signer] = Binding({ppid: ppid, quoteHash: qh, boundAt: uint64(block.timestamp)});
        emit MachineBound(signer, ppid, qh);
    }

    /// @notice La puce liée à `signer` ; `current` faux si l'enclave n'est plus active ou a été réinscrite depuis
    ///         (autre quote, peut-être une autre machine) : il faut alors relier.
    function machineOf(address signer) public view returns (bytes16 ppid, bool current, uint64 boundAt) {
        Binding memory b = _binding[signer];
        if (b.ppid == bytes16(0)) return (bytes16(0), false, 0);
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(signer);
        return (b.ppid, e.active && e.quoteHash == b.quoteHash, b.boundAt);
    }

    // ---------------------------------------------------------------- 2. déclarations des vérificateurs

    /// @notice L'appelant (le vérificateur) déclare la puce `ppid` en datacenter connu jusqu'à `expiresAt`. `site` et
    ///         `evidence` (lieu, preuve : URL, hash d'un rapport…) ne vivent que dans l'événement.
    function attestMachine(bytes16 ppid, uint64 expiresAt, string calldata site, string calldata evidence) external {
        if (ppid == bytes16(0) || expiresAt <= block.timestamp) revert BadAudit();
        auditOf[msg.sender][ppid] = Audit({expiresAt: expiresAt, revoked: false});
        emit MachineAttested(msg.sender, ppid, expiresAt, site, evidence);
    }

    /// @notice L'appelant retire sa déclaration sur `ppid`, tout de suite.
    function revokeMachine(bytes16 ppid, string calldata reason) external {
        auditOf[msg.sender][ppid].revoked = true;
        emit MachineRevoked(msg.sender, ppid, reason);
    }

    /// @notice `signer` est-il, en ce moment, sur une machine déclarée par `auditor` (liaison à jour, déclaration en
    ///         cours, non retirée) ?
    function isVerified(address signer, address auditor) public view returns (bool) {
        (bytes16 ppid, bool current,) = machineOf(signer);
        if (!current) return false;
        Audit memory a = auditOf[auditor][ppid];
        return !a.revoked && a.expiresAt > block.timestamp;
    }

    // ---------------------------------------------------------------- 3. politique des produits

    /// @notice L'AUTEUR du produit propose sa politique : niveau minimum et vérificateurs acceptés (niveau 1 : au moins
    ///         un). Appliquée après le timelock du ProductRegistry (les opérateurs et les acheteurs la voient venir).
    function proposePolicy(uint256 productId, uint8 minLevel, address[] calldata auditors) external {
        if (products.getProduct(productId).author != msg.sender) revert NotAuthor();
        if (minLevel > LEVEL_VERIFIED || auditors.length > MAX_AUDITORS) revert BadPolicy();
        if (minLevel == LEVEL_VERIFIED && auditors.length == 0) revert BadPolicy();
        for (uint256 i = 0; i < auditors.length; i++) {
            if (auditors[i] == address(0)) revert BadPolicy();
            for (uint256 k = 0; k < i; k++) {
                if (auditors[k] == auditors[i]) revert BadPolicy();
            }
        }
        uint64 applyAt = uint64(block.timestamp) + ITimelocked(address(products)).timelock();
        Pending storage p = _pending[productId];
        p.minLevel = minLevel;
        p.auditors = auditors;
        p.applyAt = applyAt;
        p.exists = true;
        emit PolicyProposed(productId, minLevel, auditors, applyAt);
    }

    /// @notice Applique la politique proposée, une fois le timelock écoulé (n'importe qui).
    function applyPolicy(uint256 productId) external {
        Pending storage p = _pending[productId];
        if (!p.exists) revert NoPendingPolicy();
        if (block.timestamp < p.applyAt) revert TooEarly();
        Policy storage q = _policy[productId];
        q.minLevel = p.minLevel;
        delete q.auditors;
        for (uint256 i = 0; i < p.auditors.length; i++) {
            q.auditors.push(p.auditors[i]);
        }
        delete _pending[productId];
        emit PolicyApplied(productId, q.minLevel, q.auditors);
    }

    function policyOf(uint256 productId) external view returns (uint8 minLevel, address[] memory auditors) {
        Policy storage q = _policy[productId];
        return (q.minLevel, q.auditors);
    }

    function pendingPolicyOf(uint256 productId)
        external
        view
        returns (bool exists, uint8 minLevel, address[] memory auditors, uint64 applyAt)
    {
        Pending storage p = _pending[productId];
        return (p.exists, p.minLevel, p.auditors, p.applyAt);
    }

    /// @notice Le premier vérificateur accepté par le produit qui vérifie `signer` en ce moment, ou zéro.
    function verifiedBy(uint256 productId, address signer) public view returns (address) {
        address[] storage list = _policy[productId].auditors;
        if (list.length == 0) return address(0);
        (bytes16 ppid, bool current,) = machineOf(signer); // une seule lecture du registre, quel que soit le nombre de vérificateurs
        if (!current) return address(0);
        for (uint256 i = 0; i < list.length; i++) {
            Audit memory a = auditOf[list[i]][ppid];
            if (!a.revoked && a.expiresAt > block.timestamp) return list[i];
        }
        return address(0);
    }

    /// @notice Niveau de `signer` au regard du produit : 1 si un vérificateur accepté par le produit le vérifie.
    function levelOf(uint256 productId, address signer) external view returns (uint8) {
        return verifiedBy(productId, signer) != address(0) ? LEVEL_VERIFIED : LEVEL_OPEN;
    }

    /// @notice `signer` remplit-il la politique du produit ? (niveau ouvert : toujours ; niveau vérifié : un vérificateur
    ///         accepté le vérifie en ce moment). L'activité de l'enclave elle-même reste le travail du registre.
    function meetsPolicy(uint256 productId, address signer) public view returns (bool) {
        if (_policy[productId].minLevel == LEVEL_OPEN) return true;
        return verifiedBy(productId, signer) != address(0);
    }
}
