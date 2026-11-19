// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerdictLog} from "./interfaces/IVerdictLog.sol";
import {IValidationRegistry} from "./interfaces/IERC8004.sol";

/// @title VerdictLog — v2
/// @notice Écrit chaque verdict vérifié dans le registre de validation ERC-8004 de Circle.
///         Le même contrat demande et répond : il est le validateur, et il n'écrit 100 (vérifié et payé)
///         qu'après que le contrat de règlement appelant a vérifié l'attestation et la signature
///         (cas « oracle TEE » prévu par l'ERC). 0 = faute saisie.
///
///         v2 (revue adverse du 7/11) : `owner` est un paramètre (multisig sur mainnet, jamais la clé de
///         déploiement) ; le DÉPLOYEUR câble les appelants UNE fois pendant le déploiement (initialize), puis n'a
///         plus aucun pouvoir ; tout nouvel appelant, proposé par le propriétaire, attend CALLER_DELAY (8 jours) :
///         une clé seule ne peut plus écrire de faux « 100 » ou « 0 » dans ERC-8004. Le retrait reste immédiat.
///
///         Prérequis hors de ce contrat (script/CLI) : l'opérateur enregistre son identité sur le
///         registre d'identité (il en est propriétaire) puis `setApprovalForAll(VerdictLog, true)` pour
///         que VerdictLog puisse faire la demande de validation en son nom. L'approbation suffit (VERIFIED : code de
///         référence ValidationRegistryUpgradeable 2.0.0 — propriétaire, isApprovedForAll ou getApproved —, et fork
///         d'Arc testnet du 9/11 : VerdictLog v2 écrit pour l'agent 897812 de l'opérateur).
///
///         v2.1 bis (revue adverse du 9/11) — le registre de Circle n'a qu'UN espace de requestHash pour tout le monde
///         (« exists » quel que soit l'agent), et nos requestHash se calculent d'avance (session connue dès l'ouverture,
///         prime dès l'acceptation…). Un tiers, avec un agent créé librement, pouvait donc occuper celui d'un futur
///         verdict : le verdict sautait pour toujours. Désormais, si la demande sous `requestHash` échoue, VerdictLog la
///         refait sous un hash SALÉ par le hash du bloc précédent (saltedHash), inconnu avant ce bloc : impossible à
///         occuper d'avance. RequestHashSalted(requestHash, salé) le dit ; Recorded porte le hash RÉELLEMENT écrit (les
///         indexeurs lisent Recorded, ils ne recalculent pas le hash). Un verdict ne s'écrit qu'UNE fois par requestHash
///         (recordedAs ; sinon AlreadyRecorded, comme le « exists » du registre), salé ou non.
///         Limites (hors de portée de ce contrat) : un attaquant qui passe AVANT nous dans le MÊME bloc peut encore
///         calculer et occuper le hash salé ; et ERC-8004 laisse le propriétaire d'un agent refuser toute demande pour
///         son agent (approbation retirée, agent cédé, setAgentId(0)) : un verdict de FAUTE (0) n'est donc jamais garanti
///         dans ERC-8004. La faute, elle, est établie par nos contrats (OperatorBond.banned, EquivocationSlashed,
///         ClaimRefuted) et le verdict sauté reste tracé (VerdictSkipped).
contract VerdictLog is IVerdictLog {
    uint64 public constant CALLER_DELAY = 8 days;

    IValidationRegistry public immutable validation;
    address public immutable owner;
    address public immutable deployer;
    bool public initialized;

    mapping(address => bool) public isCaller; // C5, C6 (et chemins de saisie)
    mapping(address => uint64) public callerApplyAt;
    /// @notice v2.1 bis : pour chaque requestHash reçu d'un appelant, le requestHash RÉELLEMENT écrit dans ERC-8004 (le
    ///         même, ou le hash salé s'il était pris) ; zéro tant que rien n'est écrit. Un verdict ne s'écrit qu'une fois.
    mapping(bytes32 requestHash => bytes32 written) public recordedAs;

    /// @notice `requestHash` = le hash RÉELLEMENT écrit dans le registre de validation (v2.1 bis : salé s'il le fallait).
    event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag);
    event CallerProposed(address indexed caller, uint64 applyAt);
    event CallerAuthorized(address indexed caller);
    event CallerRemoved(address indexed caller);
    /// @notice v2.1 bis : `requestHash` était pris (ou refusé) dans le registre ; le verdict est écrit sous `saltedHash`.
    event RequestHashSalted(bytes32 indexed requestHash, bytes32 indexed saltedHash);

    error NotOwner();
    error NotDeployer();
    error NotCaller();
    error BadParams();
    error AlreadyInitialized();
    error NoPendingCaller();
    error TooEarly();
    /// @notice v2.1 bis : un verdict est déjà écrit pour ce requestHash (voir recordedAs).
    error AlreadyRecorded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _validation, address _owner) {
        if (_validation == address(0) || _owner == address(0)) revert BadParams();
        validation = IValidationRegistry(_validation);
        owner = _owner;
        deployer = msg.sender;
    }

    /// @notice Câblage initial, UNE seule fois, par le déployeur pendant le déploiement : les contrats de règlement.
    function initialize(address[] calldata callers) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i = 0; i < callers.length; i++) {
            if (callers[i] == address(0)) revert BadParams();
            isCaller[callers[i]] = true;
            emit CallerAuthorized(callers[i]);
        }
    }

    /// @notice Propose un nouvel appelant ; autorisé seulement après CALLER_DELAY.
    function proposeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert BadParams();
        uint64 applyAt = uint64(block.timestamp) + CALLER_DELAY;
        callerApplyAt[caller] = applyAt;
        emit CallerProposed(caller, applyAt);
    }

    /// @notice Autorise un appelant proposé, une fois le délai écoulé (n'importe qui peut l'appeler).
    function applyCaller(address caller) external {
        uint64 applyAt = callerApplyAt[caller];
        if (applyAt == 0) revert NoPendingCaller();
        if (block.timestamp < applyAt) revert TooEarly();
        delete callerApplyAt[caller];
        isCaller[caller] = true;
        emit CallerAuthorized(caller);
    }

    /// @notice Retrait IMMÉDIAT d'un appelant (frein d'urgence).
    function removeCaller(address caller) external onlyOwner {
        isCaller[caller] = false;
        delete callerApplyAt[caller];
        emit CallerRemoved(caller);
    }

    /// @inheritdoc IVerdictLog
    function record(
        uint256 agentId,
        bytes32 requestHash,
        string calldata requestURI,
        bytes32 responseHash,
        string calldata responseURI,
        uint8 response,
        string calldata tag
    ) external override {
        if (!isCaller[msg.sender]) revert NotCaller();
        if (requestHash == bytes32(0)) revert BadParams();
        if (recordedAs[requestHash] != bytes32(0)) revert AlreadyRecorded();
        // VerdictLog est le validateur nommé : il demande, puis répond, dans la même transaction.
        bytes32 h = requestHash;
        try validation.validationRequest(address(this), agentId, requestURI, h) {}
        catch {
            // v2.1 bis : hash pris (occupé d'avance dans l'espace commun du registre) ou demande refusée : nouvelle
            // demande sous le hash salé, inconnu avant ce bloc. Si elle échoue aussi (agent qui n'approuve plus
            // VerdictLog, registre en panne), son revert remonte à l'appelant (VerdictSkipped). Rien n'est recopié ici.
            h = saltedHash(requestHash);
            validation.validationRequest(address(this), agentId, requestURI, h);
            emit RequestHashSalted(requestHash, h);
        }
        validation.validationResponse(h, response, responseURI, responseHash, tag);
        recordedAs[requestHash] = h;
        emit Recorded(agentId, h, response, tag);
    }

    /// @notice v2.1 bis : le hash sous lequel `record` écrit, DANS CE BLOC, un verdict dont `requestHash` est pris :
    ///         keccak256(abi.encode(requestHash, blockhash(block.number - 1))).
    function saltedHash(bytes32 requestHash) public view returns (bytes32) {
        return keccak256(abi.encode(requestHash, blockhash(block.number - 1)));
    }
}
