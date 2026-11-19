// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "./interfaces/IAttestationModule.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {History} from "./lib/History.sol";
import {DstackEventLog} from "./lib/DstackEventLog.sol";

/// @title EnclaveRegistry (SPEC-TECH §C2) — v2
/// @notice Inscrit une enclave seulement si son attestation passe Intel (C1 via le module) ET notre
///         politique « on échoue fermé » (P1–P12). Dit à tout moment si une clé d'enclave était active
///         pour un produit à un bloc donné (isActiveAt, activeOperatorAt), ce qui sert aux contrats de
///         règlement (C5/C6).
///
///         v2 — la validité se compte en BLOCS (la durée d'un bloc dépend de la chaîne) :
///         - une inscription ouvre une fenêtre [fromBlock, untilBlock] de VALIDITY_BLOCKS blocs (P10) ;
///         - un reçu n'est valable que s'il est ancré DANS une fenêtre ; la grâce (GRACE_BLOCKS) permet
///           seulement de le régler après la fin de la fenêtre, jamais d'ancrer des blocs plus récents ;
///         - le renouvellement par le même opérateur, pour le même produit et sans trou, PROLONGE la fenêtre
///           en cours : les reçus et réclamations ancrés avant le renouvellement restent réglables ;
///         - sinon (trou, autre produit, autre opérateur) l'ancienne fenêtre est gardée comme « précédente »
///           pendant sa grâce : l'historique est borné à deux fenêtres (en cours + précédente) ;
///         - un autre opérateur ne peut pas s'approprier une enclave encore valide ou en grâce.
///
///         v2 bis (revue adverse du 7/11) :
///         - une clé d'enclave est liée À VIE à son premier couple (opérateur, produit) : la réinscrire ailleurs,
///           ou la reprendre après la grâce, est refusé (SignerBoundElsewhere). Une preuve d'équivocation reste
///           donc recevable contre le bon opérateur (les clés honnêtes sont éphémères : rien n'est perdu) ;
///         - une image retirée du produit invalide ses enclaves SANS grâce (invalidate ou
///           invalidateRetiredWorkload) : le frein d'urgence freine ;
///         - la caution minimale du produit est RÉSERVÉE pour chaque clé inscrite (OperatorBond.reserve), et
///           libérée au retrait ou à l'invalidation.
///
///         v2.1 — empreinte d'IMAGE (dstack/Phala) : chez dstack, RTMR3 contient des événements propres à l'INSTANCE
///         (instance-id, app-id) ; l'empreinte complète (workloadId, qui inclut RTMR3) changeait donc à chaque
///         redémarrage de la VM. Avec un journal RTMR3 au format DstackEventLog.FORMAT_V1, le registre REJOUE RTMR3
///         (SHA-384 en EVM), exige qu'il redonne celui du quote, lit compose-hash et os-image-hash, et accepte
///         l'empreinte d'image keccak256(mrtd ‖ rtmr0 ‖ rtmr1 ‖ rtmr2 ‖ compose-hash ‖ os-image-hash ‖ xfam ‖
///         tdAttributes) si le produit l'autorise. L'empreinte complète reste acceptée (compatibilité v2) : sans
///         journal, avec un journal d'un autre format (ignoré, comme en v2), ou si l'image n'est pas autorisée.
///         L'identifiant retenu (image ou complet) est celui que stocke Enclave.workloadId : le retirer du produit
///         invalide l'enclave sans grâce (invalidateRetiredWorkload).
///
///         v2.1 bis (revue adverse du 9/11) : attestedOperator(signer, productId) dit si une clé FAIT FOI MAINTENANT
///         (primitive onlyAttested) : en plus d'activeOperatorAt, opérateur non radié, produit actif et image encore
///         autorisée — un retrait d'image ou de produit coupe tout de suite, sans attendre invalidateRetiredWorkload.
///         Les reçus et réclamations ancrés restent régis par activeOperatorAt (inchangé).
contract EnclaveRegistry is IEnclaveRegistry {
    IAttestationModule public immutable module;
    IProductRegistry public immutable products;
    IOperatorBond public immutable bond;

    /// @notice Validité d'une attestation, en blocs ; réattestation ensuite (P10).
    uint64 public immutable VALIDITY_BLOCKS;
    /// @notice Délai, en blocs après la fin d'une fenêtre, pour régler un reçu ancré DANS cette fenêtre.
    uint64 public immutable GRACE_BLOCKS;
    /// @notice Durée de bloc estimée (ms) au déploiement. Ne sert qu'à l'horodatage INDICATIF `expiresAt`
    ///         (affichage, planification des renouvellements) : la règle, elle, est en blocs.
    uint64 public immutable BLOCK_TIME_MS;

    /// @dev Préimage du domaine de REPORTDATA[0:32] (P6). L'enclave (O1) calcule le même.
    string private constant RD_TAG = "ARC-ENCLAVE-v1";

    mapping(address signer => Enclave) private _enclaves;
    mapping(address signer => Window) private _previous; // fenêtre précédente, gardée pour sa grâce
    mapping(bytes32 quoteHash => bool) public quoteSeen; // P9 : un quote ne sert qu'une fois
    /// @notice v2 : la clé est liée à vie à son premier opérateur et à son premier produit.
    mapping(address signer => address) public boundOperator;
    mapping(address signer => uint256) public boundProduct;
    /// @notice v2 : clé invalidée sans grâce (image retirée) ; plus rien ne se règle, plus de réinscription.
    mapping(address signer => bool) public killed;

    /// @dev option P4 : exiger SEPT_VE_DISABLE (bit 28 de tdAttributes). Paramètre du constructeur
    ///      (le script mainnet l'exige par défaut, le script testnet non).
    bool public immutable requireSeptVeDisable;

    error NotOperator();
    error OperatorUnderbonded();
    error ProductNotActive();
    error QuoteReused();
    error QuoteInvalid();
    error NotTdx();
    error TcbNotAllowed();
    error DebugEnclave();
    error SeptVeNotDisabled();
    error WorkloadNotAllowed();
    error ReportDataMismatch();
    error AnchorHashMismatch();
    error UnknownEnclave();
    error QuoteMismatch();
    error StillValid();
    /// @notice La clé d'enclave est tenue par un AUTRE opérateur, encore valide ou en grâce, jusqu'au bloc
    ///         `freeFromBlock` − 1. Seul cet opérateur peut la renouveler ou la retirer.
    error EnclaveHeldByOtherOperator(address operator, uint256 freeFromBlock);
    /// @notice Paramètres de déploiement invalides (validité ou durée de bloc nulle).
    error BadParams();
    /// @notice v2 : la clé est déjà liée (à vie) à un autre opérateur ou à un autre produit.
    error SignerBoundElsewhere();
    /// @notice v2 : la clé a été invalidée sans grâce (image retirée) ; elle ne se réinscrit plus.
    error EnclaveKilled();
    /// @notice v2.1 : le journal RTMR3 fourni ne redonne pas le RTMR3 du quote.
    error Rtmr3Mismatch();

    /// @param _validityBlocks validité d'une attestation en blocs (Arc : 170 000 ≈ 24 h à ≈ 508 ms/bloc)
    /// @param _graceBlocks    délai de règlement après la fin d'une fenêtre, en blocs (0 = aucun délai)
    /// @param _blockTimeMs    durée de bloc estimée en ms, pour `expiresAt` seulement (Arc : ≈ 508)
    constructor(
        address _module,
        address _products,
        address _bond,
        bool _requireSeptVeDisable,
        uint64 _validityBlocks,
        uint64 _graceBlocks,
        uint64 _blockTimeMs
    ) {
        if (_validityBlocks == 0 || _blockTimeMs == 0) revert BadParams();
        module = IAttestationModule(_module);
        products = IProductRegistry(_products);
        bond = IOperatorBond(_bond);
        requireSeptVeDisable = _requireSeptVeDisable;
        VALIDITY_BLOCKS = _validityBlocks;
        GRACE_BLOCKS = _graceBlocks;
        BLOCK_TIME_MS = _blockTimeMs;
    }

    /// @inheritdoc IEnclaveRegistry
    function registerEnclave(
        uint256 productId,
        bytes calldata quote,
        uint256 anchorR,
        address signer,
        bytes32 x25519,
        bytes calldata eventLog
    ) external override {
        // P8 : l'opérateur est l'appelant (par construction) et il a au moins la caution minimale du produit
        address operator = msg.sender;

        IProductRegistry.Product memory p = products.getProduct(productId);
        if (p.state != IProductRegistry.State.Active) revert ProductNotActive();
        if (bond.availableBond(operator) < p.minBond) revert OperatorUnderbonded();
        // v2 : une NOUVELLE clé réserve la caution minimale du produit sur la caution libre de l'opérateur
        if (bond.reservedFor(signer) == 0 && bond.freeBond(operator) < p.minBond) revert OperatorUnderbonded();
        if (killed[signer]) revert EnclaveKilled();

        // pas d'appropriation : une clé tenue par un AUTRE opérateur, encore valide ou en grâce, est refusée
        // (sinon ses reçus en attente deviendraient impayables et le tiers encaisserait sur la VM d'autrui).
        // Le renouvellement par le même opérateur reste permis.
        _checkNotHeldByOther(signer, operator);

        // v2 : liaison À VIE (opérateur, produit) — ni déplacement vers un autre produit, ni reprise après la grâce
        address bound = boundOperator[signer];
        if (bound != address(0) && (bound != operator || boundProduct[signer] != productId)) {
            revert SignerBoundElsewhere();
        }

        // P9 : quote jamais vu
        bytes32 quoteHash = keccak256(quote);
        if (quoteSeen[quoteHash]) revert QuoteReused();

        // C1 (via le module) + découpe du corps
        IAttestationModule.Measurements memory m = module.verify(quote, eventLog);

        // P1 : succès, version 4/5, corps TD10/TD15
        if (!m.ok || (m.version != 4 && m.version != 5)) revert QuoteInvalid();
        if (m.bodyType != 2 && m.bodyType != 3) revert NotTdx();

        // P2 : TCB OK, ou SW_HARDENING_NEEDED si tous les avis sont dans la liste blanche du produit
        if (!_tcbAllowed(productId, m)) revert TcbNotAllowed();

        // P3 : bit DEBUG de tdAttributes à 0 (bit de poids faible du 1er octet, LE)
        //      (vu sur le vrai quote de nos VM Phala : tdAttributes = 0x10000000, DEBUG = 0)
        if (uint8(m.tdAttributes[0]) & 0x01 != 0) revert DebugEnclave();

        // P4 (option) : bit 28 SEPT_VE_DISABLE = bit 4 du 4e octet (LE)
        if (requireSeptVeDisable && (uint8(m.tdAttributes[3]) & 0x10 == 0)) revert SeptVeNotDisabled();

        // P5 : image autorisée pour ce produit (C3). v2.1 : avec un journal RTMR3 au format FORMAT_V1, l'empreinte
        //      d'IMAGE (stable d'un redémarrage à l'autre) ; sinon, ou si elle n'est pas autorisée, l'empreinte complète.
        bytes32 workloadId = _admittedWorkload(productId, signer, m, eventLog);

        // P6 : REPORTDATA[0:32] lie chaîne, registre, produit, opérateur, clés
        bytes32 rd0 = _w(m.reportData, 0);
        bytes32 expected = keccak256(
            abi.encode(RD_TAG, block.chainid, address(this), productId, operator, signer, x25519)
        );
        if (rd0 != expected) revert ReportDataMismatch();

        // P7 : REPORTDATA[32:64] == hash du bloc d'ancrage R, R dans la fenêtre EIP-2935
        bytes32 rd1 = _w(m.reportData, 32);
        bytes32 anchorHash = History.blockHashAt(anchorR); // revert AnchorTooOld hors fenêtre
        if (rd1 != anchorHash) revert AnchorHashMismatch();

        // fenêtre de validité (prolongée si renouvellement sans trou, sinon l'ancienne est archivée)
        (uint64 fromBlock, uint64 untilBlock) = _nextWindow(signer, productId, operator);

        // inscription
        uint64 nowTs = uint64(block.timestamp);
        uint64 expiresAt = nowTs + uint64(uint256(VALIDITY_BLOCKS) * BLOCK_TIME_MS / 1000);
        _enclaves[signer] = Enclave({
            signer: signer,
            x25519: x25519,
            productId: productId,
            operator: operator,
            workloadId: workloadId,
            fmspc: m.fmspc,
            tcbStatus: m.tcbStatus,
            quoteHash: quoteHash,
            anchorBlock: uint64(anchorR),
            registeredAt: nowTs,
            expiresAt: expiresAt,
            active: true,
            fromBlock: fromBlock,
            untilBlock: untilBlock
        });
        quoteSeen[quoteHash] = true;
        if (bound == address(0)) {
            boundOperator[signer] = operator;
            boundProduct[signer] = productId;
        }
        bond.reserve(operator, signer, p.minBond); // sans effet au renouvellement (déjà réservée)

        emit EnclaveRegistered(signer, productId, operator, workloadId, expiresAt);
    }

    /// @inheritdoc IEnclaveRegistry
    function invalidate(address signer, bytes calldata quote) external override {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0)) revert UnknownEnclave();
        if (keccak256(quote) != e.quoteHash) revert QuoteMismatch();

        // v2 : image retirée du produit → invalidation SANS grâce
        if (!products.isWorkloadAllowed(e.productId, e.workloadId)) {
            _kill(signer, e);
            return;
        }

        // revérification avec le collatéral ACTUEL (rechargé par le Registrar)
        IAttestationModule.Measurements memory m = module.verify(quote, "");
        bool stillGood = m.ok && (m.version == 4 || m.version == 5) && (m.bodyType == 2 || m.bodyType == 3)
            && _tcbAllowed(e.productId, m) && (uint8(m.tdAttributes[0]) & 0x01 == 0);

        if (stillGood) revert StillValid();

        _deactivate(e);
        bond.release(signer);
        emit EnclaveInvalidated(signer, "collateral-or-policy");
    }

    /// @inheritdoc IEnclaveRegistry
    function invalidateRetiredWorkload(address signer) external override {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0)) revert UnknownEnclave();
        if (products.isWorkloadAllowed(e.productId, e.workloadId)) revert StillValid();
        _kill(signer, e);
    }

    /// @inheritdoc IEnclaveRegistry
    function retire(address signer) external override {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0)) revert UnknownEnclave();
        if (msg.sender != e.operator) revert NotOperator();
        _deactivate(e);
        bond.release(signer);
        emit EnclaveRetired(signer);
    }

    /// @inheritdoc IEnclaveRegistry
    function isActiveAt(address signer, uint256 productId, uint256 blockNumber)
        external
        view
        override
        returns (bool)
    {
        return activeOperatorAt(signer, productId, blockNumber) != address(0);
    }

    /// @inheritdoc IEnclaveRegistry
    function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber)
        public
        view
        override
        returns (address)
    {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0) || killed[signer]) return address(0);
        if (_covers(e.productId, e.fromBlock, e.untilBlock, productId, blockNumber)) return e.operator;
        Window storage w = _previous[signer];
        if (_covers(w.productId, w.fromBlock, w.untilBlock, productId, blockNumber)) return w.operator;
        return address(0);
    }

    /// @inheritdoc IEnclaveRegistry
    function attestedOperator(address signer, uint256 productId) external view override returns (address operator) {
        // le bloc courant n'est jamais couvert par la fenêtre « précédente » (coupée avant la réinscription) : l'image en
        // vigueur est celle de l'inscription en cours
        operator = activeOperatorAt(signer, productId, block.number);
        if (
            operator == address(0) || bond.banned(operator) || !products.isActive(productId)
                || !products.isWorkloadAllowed(productId, _enclaves[signer].workloadId)
        ) return address(0);
    }

    /// @inheritdoc IEnclaveRegistry
    function enclaveOf(address signer) external view override returns (Enclave memory) {
        return _enclaves[signer];
    }

    /// @inheritdoc IEnclaveRegistry
    function windowsOf(address signer)
        external
        view
        override
        returns (Window memory current, Window memory previous)
    {
        Enclave storage e = _enclaves[signer];
        if (e.signer != address(0)) {
            current = Window({
                productId: e.productId,
                operator: e.operator,
                fromBlock: e.fromBlock,
                untilBlock: e.untilBlock
            });
        }
        previous = _previous[signer];
    }

    /// @inheritdoc IEnclaveRegistry
    function settleableUntilBlock(address signer) external view override returns (uint256) {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0) || killed[signer]) return 0;
        uint256 last = e.untilBlock;
        Window storage w = _previous[signer];
        if (w.operator != address(0) && w.untilBlock > last) last = w.untilBlock;
        return last + GRACE_BLOCKS;
    }

    /// @notice v2.1 : l'empreinte d'IMAGE d'une VM dstack, celle qu'un auteur autorise pour son produit
    ///         (ProductRegistry : workloadIds de la proposition, ou proposeWorkload). Calculable avant tout lancement, à
    ///         partir des mesures publiées de l'image dstack et du hash du docker-compose. mrtd et rtmr* : 48 octets.
    function imageIdOf(
        bytes calldata mrtd,
        bytes calldata rtmr0,
        bytes calldata rtmr1,
        bytes calldata rtmr2,
        bytes32 composeHash,
        bytes32 osImageHash,
        bytes8 xfam,
        bytes8 tdAttributes
    ) external pure returns (bytes32) {
        return DstackEventLog.imageId(mrtd, rtmr0, rtmr1, rtmr2, composeHash, osImageHash, xfam, tdAttributes);
    }

    /// @notice v2.1 : rejoue un journal RTMR3 (format DstackEventLog.FORMAT_V1) comme le fait registerEnclave :
    ///         RTMR3 obtenu (48 octets, à comparer à celui du quote), et l'image lue avant « system-ready ».
    ///         Pour les outils hors chaîne (vérifier un journal avant de payer l'inscription).
    function replayEventLog(bytes calldata eventLog)
        external
        pure
        returns (bytes memory rtmr3, bool imageKnown, bytes32 composeHash, bytes32 osImageHash)
    {
        DstackEventLog.Replay memory r = DstackEventLog.replay(eventLog);
        return (abi.encodePacked(r.rtmr3Hi, r.rtmr3Lo), r.imageKnown, r.composeHash, r.osImageHash);
    }

    // ---- interne ----

    /// @dev v2.1 — P5. L'identifiant sous lequel l'enclave est admise : l'empreinte d'IMAGE si un journal RTMR3 au
    ///      format FORMAT_V1 est fourni, redonne le RTMR3 du quote (sinon Rtmr3Mismatch), décrit l'image sans ambiguïté
    ///      et que le produit l'autorise ; sinon l'empreinte complète (v2), qui doit alors être autorisée.
    function _admittedWorkload(
        uint256 productId,
        address signer,
        IAttestationModule.Measurements memory m,
        bytes calldata eventLog
    ) private returns (bytes32 full) {
        full = _workloadId(m);
        if (DstackEventLog.isFormatV1(eventLog)) {
            DstackEventLog.Replay memory r = DstackEventLog.replay(eventLog);
            if (m.rtmr3.length != 48 || _w(m.rtmr3, 0) != r.rtmr3Hi || bytes16(_w(m.rtmr3, 32)) != r.rtmr3Lo) {
                revert Rtmr3Mismatch();
            }
            if (r.imageKnown) {
                bytes32 img = DstackEventLog.imageId(
                    m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, r.composeHash, r.osImageHash, m.xfam, m.tdAttributes
                );
                emit EnclaveImage(signer, productId, img, r.composeHash, r.osImageHash);
                if (products.isWorkloadAllowed(productId, img)) return img;
            }
        }
        if (!products.isWorkloadAllowed(productId, full)) revert WorkloadNotAllowed();
    }

    /// @dev Invalidation SANS grâce (image retirée) : plus aucun reçu ni réclamation de cette clé ne se règle,
    ///      même ancré avant ; la clé ne se réinscrit plus ; sa caution réservée est libérée.
    function _kill(address signer, Enclave storage e) private {
        killed[signer] = true;
        _deactivate(e);
        bond.release(signer);
        emit EnclaveInvalidated(signer, "workload-retired");
    }

    /// @dev Refuse si `signer` est tenue par un autre opérateur dont la fenêtre est en cours ou en grâce.
    function _checkNotHeldByOther(address signer, address operator) private view {
        Enclave storage cur = _enclaves[signer];
        if (cur.signer == address(0) || cur.operator == operator) return;
        uint256 heldUntil = uint256(cur.untilBlock) + GRACE_BLOCKS;
        if (block.number <= heldUntil) revert EnclaveHeldByOtherOperator(cur.operator, heldUntil + 1);
    }

    /// @dev Calcule la fenêtre de la nouvelle inscription et archive l'ancienne si elle n'est pas prolongée.
    ///      Prolongée = même opérateur, même produit, et pas de trou (inscription au plus tard au bloc qui
    ///      suit la fin de la fenêtre en cours). Sinon la fenêtre en cours devient la précédente, coupée au
    ///      bloc d'avant : ses reçus restent réglables pendant sa grâce. L'historique garde 2 fenêtres ; la
    ///      plus ancienne n'est évincée que par une 3e inscription non prolongée (un autre opérateur ne le
    ///      peut qu'après la grâce de la fenêtre en cours, cf. _checkNotHeldByOther).
    function _nextWindow(address signer, uint256 productId, address operator)
        private
        returns (uint64 fromBlock, uint64 untilBlock)
    {
        uint64 nowBlock = uint64(block.number);
        fromBlock = nowBlock;
        untilBlock = nowBlock + VALIDITY_BLOCKS - 1;

        Enclave storage cur = _enclaves[signer];
        if (cur.signer == address(0)) return (fromBlock, untilBlock);

        if (cur.operator == operator && cur.productId == productId && nowBlock <= uint256(cur.untilBlock) + 1) {
            fromBlock = cur.fromBlock; // renouvellement sans trou : rien de ce qui était valide ne se perd
        } else {
            uint64 prevUntil = cur.untilBlock < nowBlock ? cur.untilBlock : nowBlock - 1;
            _previous[signer] = Window({
                productId: cur.productId,
                operator: cur.operator,
                fromBlock: cur.fromBlock,
                untilBlock: prevUntil
            });
        }
    }

    /// @dev Retrait ou invalidation au bloc D : les reçus ancrés à partir de D sont refusés ; ceux ancrés
    ///      avant restent réglables pendant la grâce, comptée depuis D − 1.
    function _deactivate(Enclave storage e) private {
        if (!e.active) return;
        e.active = false;
        uint64 last = uint64(block.number) - 1;
        if (e.untilBlock > last) e.untilBlock = last;
    }

    /// @dev Vrai si la fenêtre (wPid, from, until) couvre (pid, n) et que sa grâce court encore.
    function _covers(uint256 wPid, uint64 from, uint64 until, uint256 pid, uint256 n) private view returns (bool) {
        return wPid == pid && n >= from && n <= until && block.number <= uint256(until) + GRACE_BLOCKS;
    }

    function _tcbAllowed(uint256 productId, IAttestationModule.Measurements memory m)
        private
        view
        returns (bool)
    {
        if (m.tcbStatus == 0) return true; // OK
        if (m.tcbStatus == 1) {
            // SW_HARDENING_NEEDED : tous les avis doivent être dans la liste blanche du produit
            for (uint256 i = 0; i < m.advisories.length; i++) {
                if (!products.isAdvisoryAllowed(productId, m.advisories[i])) return false;
            }
            return true;
        }
        return false; // OUT_OF_DATE, CONFIG_NEEDED, REVOKED, UNRECOGNIZED, etc.
    }

    function _workloadId(IAttestationModule.Measurements memory m) private pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes
            )
        );
    }

    function _w(bytes memory d, uint256 o) private pure returns (bytes32 x) {
        assembly ("memory-safe") {
            x := mload(add(add(d, 0x20), o))
        }
    }
}
