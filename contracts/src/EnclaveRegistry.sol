// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "./interfaces/IAttestationModule.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {History} from "./lib/History.sol";
import {DstackEventLog} from "./lib/DstackEventLog.sol";

/// @title EnclaveRegistry — v2
/// @notice Registers an enclave only if its attestation passes Intel's signature check (through the attestation
///         module) AND our fail-closed policy. Tells at any time whether an enclave key was active for a product at
///         a given block (isActiveAt, activeOperatorAt), which the settlement contracts rely on.
///
///         v2: validity is counted in BLOCKS (the block time depends on the chain):
///         - a registration opens a window [fromBlock, untilBlock] of VALIDITY_BLOCKS blocks;
///         - a receipt is valid only if it is anchored INSIDE a window; the grace period (GRACE_BLOCKS) only lets it
///           be settled after the window ends, never anchor more recent blocks;
///         - a renewal by the same operator, for the same product and with no gap, EXTENDS the current window:
///           receipts and claims anchored before the renewal stay settleable;
///         - otherwise (a gap, another product, another operator) the old window is kept as the "previous" one
///           during its grace period: the history is bounded to two windows (current + previous);
///         - another operator cannot take over an enclave that is still valid or in its grace period.
///
///         v2b (after an adversarial review):
///         - an enclave key is bound FOR LIFE to its first (operator, product) pair: registering it elsewhere, or
///           taking it back after the grace period, is refused (SignerBoundElsewhere). A proof of equivocation
///           therefore still reaches the right operator (honest keys are ephemeral, so nothing is lost);
///         - an image retired from the product invalidates its enclaves WITHOUT grace (invalidate or
///           invalidateRetiredWorkload), so the emergency brake really stops them;
///         - the product's minimum bond is RESERVED for each registered key (OperatorBond.reserve), and released on
///           retirement or invalidation.
///
///         v2.1: IMAGE fingerprint (dstack/Phala). Under dstack, RTMR3 holds events specific to the INSTANCE
///         (instance-id, app-id), so the full fingerprint (workloadId, which includes RTMR3) changed at every reboot
///         of the VM. With an RTMR3 event log in the DstackEventLog.FORMAT_V1 format, the registry REPLAYS RTMR3
///         (SHA-384 in the EVM), requires it to match the quote's, reads compose-hash and os-image-hash, and accepts
///         the image fingerprint keccak256(mrtd ‖ rtmr0 ‖ rtmr1 ‖ rtmr2 ‖ compose-hash ‖ os-image-hash ‖ xfam ‖
///         tdAttributes) if the product allows it. The full fingerprint is still accepted (v2 compatibility): with
///         no event log, with an event log in another format (ignored, as in v2), or if the image is not allowed.
///         The identifier kept (image or full) is the one stored in Enclave.workloadId: retiring it from the product
///         invalidates the enclave without grace (invalidateRetiredWorkload).
///
///         v2.1b (after a second adversarial review): attestedOperator(signer, productId) tells whether a key is
///         TRUSTED NOW (the onlyAttested primitive): on top of activeOperatorAt, the operator is not banned, the
///         product is active and the image is still allowed, so retiring an image or a product cuts off at once,
///         without waiting for invalidateRetiredWorkload. Anchored receipts and claims are still governed by
///         activeOperatorAt (unchanged).
contract EnclaveRegistry is IEnclaveRegistry {
    IAttestationModule public immutable module;
    IProductRegistry public immutable products;
    IOperatorBond public immutable bond;

    /// @notice Validity of an attestation, in blocks; the enclave attests again afterwards.
    uint64 public immutable VALIDITY_BLOCKS;
    /// @notice Time, in blocks after a window ends, to settle a receipt anchored INSIDE that window.
    uint64 public immutable GRACE_BLOCKS;
    /// @notice Estimated block time (ms) at deployment. Used only for the INDICATIVE `expiresAt` timestamp (display,
    ///         renewal planning): the rule itself is in blocks.
    uint64 public immutable BLOCK_TIME_MS;

    /// @dev Domain tag of the REPORTDATA[0:32] preimage; the enclave builds the same preimage.
    string private constant RD_TAG = "ARC-ENCLAVE-v1";

    mapping(address signer => Enclave) private _enclaves;
    mapping(address signer => Window) private _previous; // previous window, kept for its grace period
    mapping(bytes32 quoteHash => bool) public quoteSeen; // a quote is used only once
    /// @notice v2: the key is bound for life to its first operator and its first product.
    mapping(address signer => address) public boundOperator;
    mapping(address signer => uint256) public boundProduct;
    /// @notice v2: key invalidated without grace (image retired); nothing settles any more, no re-registration.
    mapping(address signer => bool) public killed;

    /// @dev Optional check: require SEPT_VE_DISABLE (bit 28 of tdAttributes). A constructor parameter
    ///      (the mainnet script requires it by default, the testnet script does not).
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
    /// @notice The enclave key is held by ANOTHER operator, still valid or in its grace period, until block
    ///         `freeFromBlock` - 1. Only that operator can renew or retire it.
    error EnclaveHeldByOtherOperator(address operator, uint256 freeFromBlock);
    /// @notice Invalid deployment parameters (zero validity or block time).
    error BadParams();
    /// @notice v2: the key is already bound (for life) to another operator or another product.
    error SignerBoundElsewhere();
    /// @notice v2: the key was invalidated without grace (image retired); it can no longer be registered.
    error EnclaveKilled();
    /// @notice v2.1: the given RTMR3 event log does not reproduce the quote's RTMR3.
    error Rtmr3Mismatch();

    /// @param _validityBlocks validity of an attestation in blocks (Arc: 170,000 ≈ 24 h at ≈ 508 ms per block)
    /// @param _graceBlocks    settlement time after a window ends, in blocks (0 = none)
    /// @param _blockTimeMs    estimated block time in ms, for `expiresAt` only (Arc: ≈ 508)
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
        // the operator is the caller (by construction) and holds at least the product's minimum bond
        address operator = msg.sender;

        IProductRegistry.Product memory p = products.getProduct(productId);
        if (p.state != IProductRegistry.State.Active) revert ProductNotActive();
        if (bond.availableBond(operator) < p.minBond) revert OperatorUnderbonded();
        // v2: a NEW key reserves the product's minimum bond out of the operator's free bond
        if (bond.reservedFor(signer) == 0 && bond.freeBond(operator) < p.minBond) revert OperatorUnderbonded();
        if (killed[signer]) revert EnclaveKilled();

        // no takeover: a key held by ANOTHER operator, still valid or in its grace period, is refused
        // (otherwise its pending receipts would become unpayable and the third party would earn on someone else's VM).
        // A renewal by the same operator is still allowed.
        _checkNotHeldByOther(signer, operator);

        // v2: binding FOR LIFE (operator, product): no move to another product, no takeover after the grace period
        address bound = boundOperator[signer];
        if (bound != address(0) && (bound != operator || boundProduct[signer] != productId)) {
            revert SignerBoundElsewhere();
        }

        // a quote never seen before
        bytes32 quoteHash = keccak256(quote);
        if (quoteSeen[quoteHash]) revert QuoteReused();

        // Intel's signature check (through the module) + parsing of the body
        IAttestationModule.Measurements memory m = module.verify(quote, eventLog);

        // success, version 4/5, TD10/TD15 body
        if (!m.ok || (m.version != 4 && m.version != 5)) revert QuoteInvalid();
        if (m.bodyType != 2 && m.bodyType != 3) revert NotTdx();

        // TCB OK, or SW_HARDENING_NEEDED if every advisory is on the product's allowlist
        if (!_tcbAllowed(productId, m)) revert TcbNotAllowed();

        // DEBUG bit of tdAttributes at 0 (least significant bit of the 1st byte, LE)
        // (seen on the real quote of our Phala VMs: tdAttributes = 0x10000000, DEBUG = 0)
        if (uint8(m.tdAttributes[0]) & 0x01 != 0) revert DebugEnclave();

        // (optional) bit 28 SEPT_VE_DISABLE = bit 4 of the 4th byte (LE)
        if (requireSeptVeDisable && (uint8(m.tdAttributes[3]) & 0x10 == 0)) revert SeptVeNotDisabled();

        // image allowed for this product (ProductRegistry). v2.1: with an RTMR3 event log in the FORMAT_V1 format, the
        // IMAGE fingerprint (stable across reboots); otherwise, or if it is not allowed, the full fingerprint.
        bytes32 workloadId = _admittedWorkload(productId, signer, m, eventLog);

        // REPORTDATA[0:32] binds the chain, the registry, the product, the operator and the keys
        bytes32 rd0 = _w(m.reportData, 0);
        bytes32 expected = keccak256(
            abi.encode(RD_TAG, block.chainid, address(this), productId, operator, signer, x25519)
        );
        if (rd0 != expected) revert ReportDataMismatch();

        // REPORTDATA[32:64] == hash of the anchor block R, with R inside the EIP-2935 window
        bytes32 rd1 = _w(m.reportData, 32);
        bytes32 anchorHash = History.blockHashAt(anchorR); // reverts AnchorTooOld outside the window
        if (rd1 != anchorHash) revert AnchorHashMismatch();

        // validity window (extended on a renewal with no gap, otherwise the old one is archived)
        (uint64 fromBlock, uint64 untilBlock) = _nextWindow(signer, productId, operator);

        // registration
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
        bond.reserve(operator, signer, p.minBond); // no effect on a renewal (already reserved)

        emit EnclaveRegistered(signer, productId, operator, workloadId, expiresAt);
    }

    /// @inheritdoc IEnclaveRegistry
    function invalidate(address signer, bytes calldata quote) external override {
        Enclave storage e = _enclaves[signer];
        if (e.signer == address(0)) revert UnknownEnclave();
        if (keccak256(quote) != e.quoteHash) revert QuoteMismatch();

        // v2: image retired from the product -> invalidation WITHOUT grace
        if (!products.isWorkloadAllowed(e.productId, e.workloadId)) {
            _kill(signer, e);
            return;
        }

        // check again against the CURRENT collateral (reloaded by the Registrar)
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
        // the current block is never covered by the "previous" window (cut before the re-registration): the image in
        // force is the one of the current registration
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

    /// @notice v2.1: the IMAGE fingerprint of a dstack VM, the one an author allows for their product
    ///         (ProductRegistry: the proposal's workloadIds, or proposeWorkload). Computable before any launch, from
    ///         the published measurements of the dstack image and the docker-compose hash. mrtd and rtmr*: 48 bytes.
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

    /// @notice v2.1: replays an RTMR3 event log (DstackEventLog.FORMAT_V1 format) as registerEnclave does: the RTMR3
    ///         obtained (48 bytes, to compare with the quote's), and the image read before "system-ready".
    ///         For off-chain tools (check an event log before paying for the registration).
    function replayEventLog(bytes calldata eventLog)
        external
        pure
        returns (bytes memory rtmr3, bool imageKnown, bytes32 composeHash, bytes32 osImageHash)
    {
        DstackEventLog.Replay memory r = DstackEventLog.replay(eventLog);
        return (abi.encodePacked(r.rtmr3Hi, r.rtmr3Lo), r.imageKnown, r.composeHash, r.osImageHash);
    }

    // ---- internal ----

    /// @dev v2.1. The identifier under which the enclave is admitted: the IMAGE fingerprint if an RTMR3 event log in
    ///      the FORMAT_V1 format is given, reproduces the quote's RTMR3 (otherwise Rtmr3Mismatch), describes the image
    ///      unambiguously and the product allows it; otherwise the full fingerprint (v2), which must then be allowed.
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

    /// @dev Invalidation WITHOUT grace (image retired): no receipt or claim of this key settles any more, even one
    ///      anchored before; the key can no longer be registered; its reserved bond is released.
    function _kill(address signer, Enclave storage e) private {
        killed[signer] = true;
        _deactivate(e);
        bond.release(signer);
        emit EnclaveInvalidated(signer, "workload-retired");
    }

    /// @dev Reverts if `signer` is held by another operator whose window is current or in its grace period.
    function _checkNotHeldByOther(address signer, address operator) private view {
        Enclave storage cur = _enclaves[signer];
        if (cur.signer == address(0) || cur.operator == operator) return;
        uint256 heldUntil = uint256(cur.untilBlock) + GRACE_BLOCKS;
        if (block.number <= heldUntil) revert EnclaveHeldByOtherOperator(cur.operator, heldUntil + 1);
    }

    /// @dev Computes the window of the new registration and archives the old one if it is not extended.
    ///      Extended = same operator, same product, and no gap (registration at the latest at the block that follows
    ///      the end of the current window). Otherwise the current window becomes the previous one, cut at the block
    ///      before: its receipts stay settleable during its grace period. The history keeps 2 windows; the oldest is
    ///      evicted only by a 3rd registration that is not an extension (another operator can do this only after the
    ///      grace period of the current window, see _checkNotHeldByOther).
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
            fromBlock = cur.fromBlock; // renewal with no gap: nothing that was valid is lost
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

    /// @dev Retirement or invalidation at block D: receipts anchored from D on are refused; those anchored before
    ///      stay settleable during the grace period, counted from D - 1.
    function _deactivate(Enclave storage e) private {
        if (!e.active) return;
        e.active = false;
        uint64 last = uint64(block.number) - 1;
        if (e.untilBlock > last) e.untilBlock = last;
    }

    /// @dev True if the window (wPid, from, until) covers (pid, n) and its grace period is still running.
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
            // SW_HARDENING_NEEDED: every advisory must be on the product's allowlist
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
