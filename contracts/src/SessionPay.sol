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

/// @title SessionPay — v2
/// @notice Prepaid USDC sessions, served against a session key and paid on the LAST cumulative receipt signed by
///         the enclave: one transaction per settlement, never one per message.
///         v2: the unit price is LOCKED when the session opens (a change to the product's price affects only
///         sessions opened afterwards); a session's ERC-8004 verdict carries its sessionId; `verdictWritten`
///         becomes true only if the write really happened; the product's exposure cap applies on top of the bond
///         rule.
///
///         v2b (after an adversarial review):
///         - a session opens only on a product settled by THIS contract (or the paid attempts of the Sealed Bounty,
///           `attemptsFor`), at a non-zero price, with a bonded operator;
///         - the session is BOUND to ONE enclave, chosen at opening and active for this product with this operator:
///           only its receipts pay (two enclaves no longer each count from paidUnits);
///         - the model (param) and the billed unit (unitTokens, outWeight) are locked at opening, like the price: a
///           change of model no longer makes the receipts of open sessions unpayable;
///         - the deadline is bounded: at least MIN_SESSION, at most MAX_SESSION (no more "already expired" session
///           closed in the block of its service); an early close is allowed only if the bound enclave can no longer
///           settle anything;
///         - the ERC-8004 verdict requires its gas (VERDICT_GAS) BEFORE the call: sent with the minimal gas
///           (eth_estimateGas), a close or a slash no longer succeeds by skipping the verdict
///           (InsufficientGasForVerdict).
///
///         v2.1: the ERC-8004 requestHash starts with (block.chainid, address(this)): a redeployment on the same
///         chain, or the same stack on another chain, no longer collides with a verdict already written (Circle's
///         registry answered "exists" and the verdict was skipped without a trace); and a verdict that fails despite
///         its gas leaves a trace on chain: VerdictSkipped(requestHash, reason).
///
///         v2.1b (after a second adversarial review): the VerdictSkipped reason is BOUNDED (RevertReason, at most 132
///         bytes). `catch (bytes memory reason)` copied the whole revert data, so a hostile or buggy ERC-8004 registry
///         blocked the close (the refund) and the slash, whatever the gas sent, which the v2 `catch {}` avoided. A
///         requestHash taken in advance by a third party in the registry's shared space no longer skips the verdict:
///         VerdictLog writes it again under a salted hash (VerdictLog.RequestHashSalted).
///
///         v2.1c (after the same reviews):
///         - a session closed WITHOUT ANY settlement (paid == 0: no service paid) no longer writes a "100". An
///           operator could open sessions from a wallet of their own and close them unused: the deposit came back in
///           full, and each session earned an ERC-8004 100/100 for the price of gas alone. Now no verdict is written
///           or attempted (so no VERDICT_GAS reserve), and VerdictNotApplicable(sessionId) says so; the refund is
///           unchanged;
///         - the FAULT verdict has its own flag, faultVerdictWritten. With verdictWritten alone, an equivocation
///           proven AFTER a close that had written its 100 slashed the bond without ever writing the 0. One fault
///           verdict per session; a new report retries it as long as it is not written.
contract SessionPay is EIP712, UsdcPayer {
    using ECDSA for bytes32;

    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(uint256 productId,uint256 sessionId,uint64 seq,bytes32 modelHash,bytes32 paramsHash,bytes32 requestHash,bytes32 responseHash,uint64 tokensIn,uint64 tokensOut,uint128 cumulativeUnits,uint64 anchorBlock)"
    );

    uint64 public constant SETTLE_GRACE = 1 hours; // time after the deadline for a last settlement
    /// @notice v2: minimum length of a session (deadline at least now + 10 min).
    uint64 public constant MIN_SESSION = 10 minutes;
    /// @notice v2: maximum length of a session (deadline at most now + 30 days).
    uint64 public constant MAX_SESSION = 30 days;
    /// @notice v2b: gas reserved for the ERC-8004 verdict (VerdictLog, then Circle's validation registry: about
    ///         238-260k measured on Arc testnet). Without this reserve, a call sent with the MINIMAL gas
    ///         (eth_estimateGas looks for the smallest gas that succeeds) made the verdict run out of gas, a failure
    ///         swallowed by the try/catch: the transaction succeeded WITHOUT a verdict (seen with closeSession(13) on
    ///         Arc testnet). The try/catch now covers only real registry failures. v2.1b: VerdictLog.record measured
    ///         cold on a local fork of Arc testnet (Circle's real registry): 235k for the deployed v2 VerdictLog; 285k
    ///         for v2.1b (recordedAs, new agent, new validator); 287k when the hash is taken (salt): the reserve holds.
    uint256 public constant VERDICT_GAS = 350_000;

    IProductRegistry public immutable products;
    IEnclaveRegistry public immutable enclaves;
    IOperatorBond public immutable bond;
    IVerdictLog public immutable verdict;
    address public immutable treasury;
    /// @notice v2: the Sealed Bounty whose ATTEMPTS SessionPay bills (sessions on a product it settles, at a non-zero
    ///         price: one attempt = one unit). address(0) = none.
    address public immutable attemptsFor;

    struct Session {
        address owner;
        uint256 productId;
        address operator;
        address sessionKey;
        uint256 deposit;
        uint256 cap; // spending cap (0 = equal to the deposit)
        uint128 paidUnits; // cumulative units already settled
        uint256 paid; // USDC already paid
        uint64 expiresAt;
        bool closed;
        // true only if an ERC-8004 entry was really written for this session (the 100 of the close,
        // or the 0 of a proven fault)
        bool verdictWritten;
        uint256 price; // v2: unit price (USDC, 6 decimals) LOCKED at opening
        // v2b: ADDED at the end (a reader of the first 12 fields still decodes them)
        address enclave; // the ONLY enclave whose receipts pay for this session
        uint32 unitTokens; // billed unit, locked at opening (Product.unitTokens)
        uint32 outWeight; // weight of an output token, locked at opening (Product.outWeight)
        bytes32 param; // model (Product.param) locked at opening: the receipts must carry it
        // v2.1c: ADDED at the end (a reader of the first 16 fields still decodes them)
        bool faultVerdictWritten; // true only if the FAULT verdict (0) was really written; one per session
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
        /// @dev v2: key of the enclave that will serve the session (the client reads it from the enclave's /pubkeys).
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
    /// @notice v2.1: writing the ERC-8004 verdict failed (registry failure or refusal); `reason` = the revert data,
    ///         v2.1b: at most its first 132 bytes (RevertReason.MAX_LENGTH).
    event VerdictSkipped(bytes32 indexed requestHash, bytes reason);
    /// @notice v2.1c: session closed without any settlement (paid == 0): no service was paid, so the close neither
    ///         writes nor attempts a verdict (no "100"). Emitted just before SessionClosed, in the same transaction;
    ///         SessionClosed is unchanged. A fault verdict (reportEquivocation) does not depend on it.
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
    /// @notice v2: the product is not settled by this contract (nor are its attempts, through `attemptsFor`).
    error WrongSettlement();
    /// @notice v2: a product priced at 0 cannot be opened as a session (free inference).
    error ZeroPrice();
    /// @notice v2: deadline outside [now + MIN_SESSION, now + MAX_SESSION].
    error BadExpiry();
    /// @notice v2: the operator lacks the product's minimum bond, or is banned.
    error OperatorUnderbonded();
    /// @notice v2: the receipt is signed by another enclave than the session's.
    error WrongEnclave();
    /// @notice v2b: not enough gas for the ERC-8004 verdict (VERDICT_GAS): send again with more gas.
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
        // v2: a product settled by this contract (or the attempts of the Sealed Bounty), never priced at 0
        if (p.settlement != address(this) && (attemptsFor == address(0) || p.settlement != attemptsFor)) {
            revert WrongSettlement();
        }
        if (p.price == 0) revert ZeroPrice();
        // v2: bounded deadline (neither already expired, nor more than 30 days away)
        if (uint256(q.expiresAt) < block.timestamp + MIN_SESSION || uint256(q.expiresAt) > block.timestamp + MAX_SESSION)
        {
            revert BadExpiry();
        }
        // v2: the chosen enclave is active for this product, with the announced operator, bonded and not banned
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
            price: p.price, // locked: a later rise or cut does not affect this session
            enclave: q.enclave,
            unitTokens: p.unitTokens,
            outWeight: p.outWeight,
            param: p.param, // locked: a change of model affects only sessions opened afterwards
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

    /// @notice Pays the delta since the last settlement, on the strength of the last cumulative receipt.
    ///         Permissionless: the authority is the enclave's signature.
    function settle(Receipt calldata r, bytes calldata signature) external {
        Session storage s = _sessions[r.sessionId];
        if (s.owner == address(0)) revert SessionMismatch();
        if (s.closed) revert Closed();
        if (r.productId != s.productId) revert SessionMismatch();

        address signer = _recover(r, signature);
        // enclave active for this product at the anchor block (validity window, grace included), and the
        // operator responsible for that window is the session's
        address op = enclaves.activeOperatorAt(signer, s.productId, r.anchorBlock);
        if (op == address(0)) revert InactiveEnclave();
        if (op != s.operator) revert WrongOperator();
        // v2: only the enclave bound to the session is paid (a 2nd enclave would count again from paidUnits)
        if (signer != s.enclave) revert WrongEnclave();

        // v2: the model LOCKED at opening (not the product's current param)
        if (r.modelHash != s.param) revert ModelMismatch();
        if (r.cumulativeUnits <= s.paidUnits) revert NotIncreasing();
        IProductRegistry.Product memory p = products.getProduct(s.productId);

        // amount due = cumulativeUnits × price LOCKED at opening - already paid, bounded by the deposit (and
        // the cap). Never negative: fixed price, strictly increasing total, non-decreasing cap.
        uint256 owed = uint256(r.cumulativeUnits) * s.price;
        uint256 ceiling = s.cap == 0 ? s.deposit : (s.cap < s.deposit ? s.cap : s.deposit);
        if (owed > ceiling) owed = ceiling;
        uint256 delta = owed - s.paid;

        // effects before transfers
        s.paid = owed;
        s.paidUnits = r.cumulativeUnits;

        if (delta > 0) {
            // exposure taken on the word of one enclave (bounded by OperatorBond: half the bond, the product's cap)
            bond.consumeExposure(s.operator, s.productId, delta, p.exposureCap);
            _split(p, s.operator, delta);
        }
        emit Settled(r.sessionId, r.cumulativeUnits, delta);
    }

    /// @notice Closes after the deadline (+ grace) on the owner's side; refunds the rest and writes the "100" verdict.
    ///         v2: also earlier if the bound enclave can no longer settle anything (window + grace over, or
    ///         invalidated without grace): no receipt of the operator becomes unpayable because of this close.
    ///         v2.1c: a session that paid nothing (paid == 0) has nothing to attest: full refund, no verdict,
    ///         VerdictNotApplicable(sessionId).
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
            // v2.1c: no receipt settled, no service paid: no "100" (otherwise empty sessions, opened and closed by the
            // operator itself, minted 100/100 verdicts for it for the price of gas alone)
            emit VerdictNotApplicable(sessionId);
        } else if (!s.verdictWritten && !bond.banned(s.operator)) {
            // "verified and paid" (100), never for a banned operator: a proven fault prevails, even if its verdict
            // could not be written (it is retried by a new report, see reportEquivocation)
            if (_writeVerdict(sessionId, s, 100, "tdx-dcap/inference")) s.verdictWritten = true;
        }
        emit SessionClosed(sessionId, refund);
    }

    /// @notice Two receipts with the SAME (sessionId, seq) but different responses, signed by the same enclave: the
    ///         operator's bond is slashed, and the enclave and the operator are banned. The fault verdict is marked as
    ///         written only if it was; otherwise, reporting the same proof again retries it (slashing an operator
    ///         already banned takes nothing more).
    ///         v2.1c: its flag (faultVerdictWritten) is separate from the 100's flag: a fault proven AFTER the close
    ///         still writes its 0. One fault verdict per session, whatever the number of proofs.
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

        // fault verdict; the flag is set only if the write succeeded. v2b: gas required BEFORE the call (a call
        // sent with the minimal gas no longer skips the verdict); the try/catch covers only a registry failure.
        // v2.1c: a flag OF ITS OWN for the fault verdict (a 100 already written at the close no longer blocks it).
        if (!s.faultVerdictWritten) {
            uint256 agentId = bond.agentIdOf(s.operator);
            bytes32 requestHash = keccak256(abi.encode(block.chainid, address(this), "equivocation", a.sessionId, a.seq));
            _requireVerdictGas();
            try verdict.record(agentId, requestHash, "", a.responseHash, "", 0, "tdx-dcap/slash") {
                s.faultVerdictWritten = true;
                s.verdictWritten = true; // an ERC-8004 entry exists for this session (meaning unchanged for readers)
            } catch {
                emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1b: never the whole revert data
            }
        }
        emit EquivocationSlashed(a.sessionId, signerA, s.operator);
    }

    function getSession(uint256 sessionId) external view returns (Session memory) {
        return _sessions[sessionId];
    }

    // ---- internal ----

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
        uint256 toNetwork = amount - toOperator - toAuthor; // the rest goes to the network (avoids dust)
        _payOut(operator, toOperator);
        _payOut(p.author, toAuthor);
        _payOut(treasury, toNetwork);
    }

    /// @dev v2b: requires the ERC-8004 verdict's gas before calling it (see VERDICT_GAS).
    function _requireVerdictGas() private view {
        if (gasleft() < VERDICT_GAS * 64 / 63 + 20_000) revert InsufficientGasForVerdict();
    }

    /// @dev Writes a session's verdict; returns true if the ERC-8004 write succeeded (a registry failure does not block
    ///      the close, it leaves VerdictSkipped). v2b: the verdict's gas is required before the call
    ///      (InsufficientGasForVerdict). v2.1: requestHash = keccak256(abi.encode(block.chainid, address(this),
    ///      "session", sessionId, productId, owner)): one entry per session, per contract and per chain. v2.1b: the
    ///      reason is bounded (RevertReason): a giant revert no longer blocks the close.
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
