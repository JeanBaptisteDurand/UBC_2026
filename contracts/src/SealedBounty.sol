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

/// @title SealedBounty — v2
/// @notice A bounty paid on a PROOF: an EIP-712 claim signed by one (or k) active enclave(s) of the "Sealed Bounty"
///         product that replayed the exploit on a fork (off chain). The contract only verifies and pays: no exploit
///         runs on chain and no real protocol is touched.
///
///         v2 (after an adversarial review):
///         - an exploit is no longer paid more than once: a bounty pays at most its highest tier per "arming". A
///           second payout requires a STRICTLY higher tier (only the difference is paid) and a claim anchored AFTER
///           the last payout; the protocol re-arms the bounty (reopen) once the flaw is fixed. Changing the case of
///           the hexadecimal (a new fingerprint) therefore earns nothing;
///         - the encrypted exploit (cP) never sits in a transaction that can fail for a reason the protocol
///           controls: acceptClaim takes only its hash and RESERVES the payout; deliver(cP), callable by anyone,
///           delivers cP and pays (a refused transfer becomes a credit to withdraw, never a failure);
///         - pausing the target is gas-bounded and copies no return data (no more "return bomb"); setPaused does
///           not reach claims anchored before the pause;
///         - a false claim can be REFUTED during REFUTE_WINDOW: a counter-replay signed by enclaves of DISTINCT
///           operators, more numerous than those of the claim, slashes their bonds and cancels the payout if it has
///           not been delivered yet;
///         - only a product settled by THIS contract carries bounties; k <= MAX_SIGS; tiers strictly increasing;
///         - the ERC-8004 verdict requires its gas (VERDICT_GAS) BEFORE the call: sent with the minimal gas
///           (eth_estimateGas), a payout, a slash or a refutation can no longer succeed by skipping the verdict.
///
///         v2.1: the ERC-8004 requestHash starts with (block.chainid, address(this)) (no more collisions between
///         deployments); a verdict that fails despite its gas leaves VerdictSkipped(requestHash, reason).
///
///         v2.1b (after a second adversarial review): the VerdictSkipped reason is BOUNDED (RevertReason, at most 132
///         bytes). `catch (bytes memory reason)` let a hostile or buggy ERC-8004 registry block a bounty payout, the
///         slash and the refutation, whatever the gas. The equivocation verdict names the slashed OPERATOR (two
///         operators equivocating on the same fingerprint had the same requestHash, so the second verdict was skipped).
contract SealedBounty is EIP712, UsdcPayer {
    using ECDSA for bytes32;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 bountyId,address payee,uint64 blockN,bytes32 blockHashN,bytes32 predicateHash,uint256 loss,uint8 tier,bytes32 fingerprint,bytes32 cPHash,uint64 deadline)"
    );
    /// @notice v2: the verdict of a counter-replay on an accepted claim (`claimDigest` = its EIP-712 digest).
    bytes32 public constant REFUTATION_TYPEHASH =
        keccak256("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)");

    uint256 public constant MAX_SIGS = 5;
    /// @notice v2: gas given to `targetToPause.pause()` (bounded; no return data is copied).
    uint256 public constant PAUSE_GAS = 100_000;
    /// @dev Selector of pause().
    bytes4 private constant PAUSE_SELECTOR = 0x8456cb59;
    /// @notice v2: time to deliver cP after acceptClaim; after it, the reservation returns to the pool.
    uint64 public constant DELIVERY_WINDOW = 1 days;
    /// @notice v2: time to refute an accepted claim (shorter than OperatorBond.UNBOND_DELAY, so the signers' bonds
    ///         are still there).
    uint64 public constant REFUTE_WINDOW = 3 days;
    /// @notice v2: minimum number of distinct operators behind a refutation (and more than behind the claim).
    uint256 public constant REFUTE_QUORUM = 2;
    /// @notice v2b: gas reserved for the ERC-8004 verdict (VerdictLog, then Circle's validation registry: about
    ///         238-260k measured on Arc testnet). Without this reserve, a call sent with the MINIMAL gas
    ///         (eth_estimateGas looks for the smallest gas that succeeds) made the verdict run out of gas, a failure
    ///         swallowed by the try/catch: the transaction succeeded WITHOUT a verdict (seen with closeSession(13) on
    ///         Arc testnet). The try/catch now covers only real registry failures. v2.1b: a cold VerdictLog.record on
    ///         a local fork of Arc testnet (real registry) costs 285k (287k with the salt); the reserve holds.
    uint256 public constant VERDICT_GAS = 350_000;

    IProductRegistry public immutable products;
    IEnclaveRegistry public immutable enclaves;
    IOperatorBond public immutable bond;
    IVerdictLog public immutable verdict;
    address public immutable treasury;
    uint16 public immutable networkBountyBps; // network share, on top (e.g. 1000 = 10%)
    uint16 public immutable operatorBountyBps; // operator share, on top (e.g. 500 = 5%)

    /// @dev The first 10 fields keep the order, type and meaning of v1 (a v1 reader still decodes them);
    ///      v2 ADDS the last 3.
    struct Bounty {
        address protocol;
        uint256 productId;
        bytes32 predicateHash;
        bytes32 protocolX25519;
        uint256 singleCap; // above it (the tier amount), k signatures from different operators
        uint8 k;
        address targetToPause; // 0 if none
        uint64 deadline;
        uint256 balance; // available (excluding payouts reserved and awaiting delivery)
        bool paused;
        uint256 paidAmount; // v2: highest tier already granted since the last arming
        uint64 lastPaidBlock; // v2: block of the last payout (or of the re-arming); claims must be anchored AFTER it
        uint64 pausedFromBlock; // v2: the pause reaches only claims anchored from this block on
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

    /// @notice v2: the verdict of a counter-replay. `proven` false = the exploit does not prove out (or cP is not the
    ///         announced exploit); otherwise `loss`/`tier` as measured by the refuting enclaves.
    struct Refutation {
        bytes32 claimDigest;
        bool proven;
        uint256 loss;
        uint8 tier;
    }

    /// @notice v2: an accepted (reserved) payout, awaiting the delivery of cP.
    struct Payout {
        address payee;
        uint8 tier;
        uint64 acceptedAt;
        bytes32 cPHash;
        bytes32 claimDigest;
        uint256 amount; // to the hunter
        uint256 netFee; // to the network
        uint256 opFee; // to the signing operators
        address[] ops; // DISTINCT signing operators
    }

    /// @notice v2: record of an accepted claim, for a possible refutation.
    struct ClaimRecord {
        uint64 acceptedAt;
        bool refuted;
        bytes32 opsHash; // keccak256(abi.encode(signing operators))
    }

    uint256 public bountyCount;
    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => uint256[]) public tierMinLoss;
    mapping(uint256 => uint256[]) public tierAmount;
    mapping(uint256 => mapping(bytes32 => bool)) public fingerprintPaid;
    mapping(uint256 => mapping(bytes32 => Payout)) private _pending;
    mapping(bytes32 => ClaimRecord) public claimRecords;
    /// @notice v2: payouts whose transfer was refused (e.g. a blocked address), to withdraw (withdrawCredit).
    mapping(address => uint256) public credit;

    bool private transient _entered;

    event BountyCreated(uint256 indexed bountyId, address indexed protocol, uint256 productId, uint256 funding);
    event BountyFunded(uint256 indexed bountyId, uint256 amount);
    event ExploitDelivered(uint256 indexed bountyId, bytes cP);
    event BountyPaid(uint256 indexed bountyId, address indexed payee, uint256 amount, uint8 tier);
    event RemainingWithdrawn(uint256 indexed bountyId, uint256 amount);
    event EquivocationSlashed(uint256 indexed bountyId, address indexed signer, address operator);
    /// @notice v2: claim accepted, payout reserved (the claim and its operators are what a refutation needs).
    event ClaimAccepted(uint256 indexed bountyId, bytes32 indexed claimDigest, Claim claim, address[] operators, uint256 amount);
    event BountyReopened(uint256 indexed bountyId, uint64 fromBlock);
    event BountyPauseSet(uint256 indexed bountyId, bool paused, uint64 fromBlock);
    event UndeliveredCancelled(uint256 indexed bountyId, bytes32 indexed fingerprint, uint256 returned);
    event ClaimRefuted(uint256 indexed bountyId, bytes32 indexed claimDigest, address indexed reporter);
    event Credited(address indexed to, uint256 amount);
    /// @notice v2.1: writing the ERC-8004 verdict failed (registry failure or refusal); `reason` = the revert data,
    ///         v2.1b: at most its first 132 bytes (RevertReason.MAX_LENGTH).
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
    /// @notice v2: the claim's signed deadline (the enclave's TTL) has passed.
    error ClaimExpired();
    /// @notice v2: the product is not settled by this contract (Product.settlement).
    error WrongSettlement();
    /// @notice v2: k is zero or above MAX_SIGS (such a bounty could never be claimed above singleCap).
    error BadK();
    /// @notice v2: this tier (or a higher one) was already granted since the last arming.
    error TierAlreadyPaid();
    /// @notice v2: the claim is anchored at or before the block of the last payout (or of the re-arming).
    error AnchorBeforeLastPayout();
    error NothingToDeliver();
    error DeliveryWindowOpen();
    error UnknownClaim();
    error AlreadyRefuted();
    error RefuteWindowOver();
    error BadOps();
    error NotARefutation();
    error NeedMoreRefuters();
    /// @notice v2: a signer of the claim cannot refute it.
    error RefuterIsClaimOperator();
    /// @notice v2: not enough gas to give PAUSE_GAS to the target (the pause is never starved).
    error NotEnoughGasForPause();
    /// @notice v2b: not enough gas for the ERC-8004 verdict (VERDICT_GAS): send again with more gas.
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
        // strictly increasing tiers (thresholds AND amounts): the highest tier reached is also the best paid
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

    /// @notice The protocol pauses its bounty (or resumes it). v2: the pause reaches only claims anchored FROM the
    ///         block of the pause on; a proof already made on an earlier block stays payable (the protocol cannot
    ///         front-run a claim seen in the mempool).
    function setPaused(uint256 bountyId, bool p) external {
        Bounty storage bnty = _bounties[bountyId];
        if (msg.sender != bnty.protocol) revert NotProtocol();
        if (p && !bnty.paused) bnty.pausedFromBlock = uint64(block.number);
        if (!p) bnty.pausedFromBlock = 0;
        bnty.paused = p;
        emit BountyPauseSet(bountyId, p, bnty.pausedFromBlock);
    }

    /// @notice v2: the protocol RE-ARMS its bounty (after fixing the flaw): the tiers become payable again, only for
    ///         claims anchored after this block.
    function reopen(uint256 bountyId) external {
        Bounty storage bnty = _bounties[bountyId];
        if (msg.sender != bnty.protocol) revert NotProtocol();
        bnty.paidAmount = 0;
        bnty.lastPaidBlock = uint64(block.number);
        emit BountyReopened(bountyId, uint64(block.number));
    }

    /// @notice v2 (recommended): checks everything and RESERVES the payout; cP is not in this transaction (only its
    ///         hash, signed by the enclaves). The payout goes out with deliver(bountyId, fingerprint, cP).
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

    /// @notice v2: delivers cP (checked against the reserved hash) and pays the hunter, the network and the operators.
    ///         Open to anyone and independent of the protocol's contracts; a refused transfer becomes a credit
    ///         (withdrawCredit).
    function deliver(uint256 bountyId, bytes32 fingerprint, bytes calldata cP) external nonReentrant {
        Payout storage s = _pending[bountyId][fingerprint];
        if (s.payee == address(0)) revert NothingToDeliver();
        if (keccak256(cP) != s.cPHash) revert CipherMismatch();
        Payout memory po = s;
        delete _pending[bountyId][fingerprint];
        _pay(bountyId, fingerprint, po, cP);
    }

    /// @notice Checks everything, pays the hunter and delivers the ciphertext to the protocol, or reverts (the v1 path,
    ///         in one transaction). Not recommended: if the transaction fails (a race with another claim, the exposure
    ///         cap...), cP stays readable in its calldata. Prefer acceptClaim, then deliver.
    function claim(Claim calldata r, bytes[] calldata signatures, bytes calldata cP) external nonReentrant {
        if (keccak256(cP) != r.cPHash) revert CipherMismatch();
        Payout memory po = _accept(r, signatures);
        _pay(r.bountyId, r.fingerprint, po, cP);
    }

    /// @notice v2: a payout reserved and never delivered returns to the pool after DELIVERY_WINDOW (open to anyone).
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

    /// @notice v2: withdraws a payout whose transfer was refused.
    function withdrawCredit() external nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credit[msg.sender] = 0;
        _payOut(msg.sender, amount);
    }

    /// @notice Slash for EQUIVOCATION. The replay is deterministic: same inputs, same result. So only two claims with
    ///         the SAME inputs (bountyId, blockN, blockHashN, payee, predicateHash, cPHash, fingerprint) but DIFFERENT
    ///         outputs (loss or tier), signed by the same enclave of the product, prove cheating: the bond is slashed,
    ///         the operator is banned, and the identifiable victim is the protocol. An honest enclave legitimately
    ///         signs different claims for the same exploit (another block N, another deadline, another hunter): they
    ///         are refused (NotEquivocation) and nothing is slashed. The deadline is neither an input nor an output.
    ///         v2: the key is bound for life to its (operator, product) in the EnclaveRegistry, so moving it no longer
    ///         escapes the slash.
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

        // v2b: the verdict's gas is required before the call; the try/catch covers only a registry failure.
        // v2.1b: the requestHash names the slashed operator, one fault verdict PER operator (two operators equivocating
        // on the same fingerprint no longer collide; a new report against the same operator does not overwrite:
        // VerdictLog.AlreadyRecorded).
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

    /// @notice v2: REFUTES an accepted claim (a false proof, for example from a forged enclave) within the
    ///         REFUTE_WINDOW that follows its acceptance. The refutation is about the claim's digest and gives another
    ///         result (not proven, or another loss / another tier); it is signed by active enclaves of the product,
    ///         from DISTINCT operators that did not sign the claim, at least REFUTE_QUORUM of them and STRICTLY more
    ///         than the claim's operators. Effects: each operator that signed the claim is slashed (50% to the
    ///         reporter, 50% to the protocol); the payout, if not delivered yet, returns to the pool.
    /// @param ops the operators that signed the claim, as emitted by ClaimAccepted
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

        // the payout has not gone out yet: it returns to the pool
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
        _requireVerdictGas(); // v2b
        try verdict.record(agentId, requestHash, "", digest, "", 0, "tdx-dcap/refuted") {}
        catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1b: never the whole revert data
        }
        emit ClaimRefuted(r.bountyId, digest, msg.sender);
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _bounties[bountyId];
    }

    /// @notice v2: the payout reserved for (bounty, fingerprint), awaiting delivery (zero payee if none).
    function pendingOf(uint256 bountyId, bytes32 fingerprint) external view returns (Payout memory) {
        return _pending[bountyId][fingerprint];
    }

    /// @notice v2: EIP-712 digest of a claim (what the enclaves sign, and what a refutation refers to).
    function claimDigest(Claim calldata r) external view returns (bytes32) {
        return _hashTypedDataV4(_claimHash(r));
    }

    // ---- internal ----

    /// @dev Checks the claim, applies the v2 payout rules, takes the exposure, pauses the target, and returns the
    ///      payout to make (reserved: already taken out of the bounty's balance).
    function _accept(Claim calldata r, bytes[] calldata signatures) private returns (Payout memory po) {
        Bounty storage bnty = _bounties[r.bountyId];
        if (bnty.protocol == address(0)) revert BadProduct();
        if (bnty.paused && r.blockN >= bnty.pausedFromBlock) revert BountyPausedErr();
        if (block.timestamp > bnty.deadline) revert Expired();
        // the claim's SIGNED deadline (the enclave's TTL): once passed, the claim is worthless
        if (r.deadline < block.timestamp) revert ClaimExpired();

        // tier reached
        uint256 tierAmt = _tierPayout(r.bountyId, r.tier, r.loss);

        if (r.predicateHash != bnty.predicateHash) revert PredicateMismatch();

        // anchored on a recent block (EIP-2935)
        bytes32 h = History.blockHashAt(r.blockN); // reverts AnchorTooOld outside the window
        if (h != r.blockHashN) revert AnchorMismatch();

        if (fingerprintPaid[r.bountyId][r.fingerprint]) revert AlreadyPaid();
        // v2: an exploit is not paid twice: anchored after the last payout, strictly higher tier
        if (r.blockN <= bnty.lastPaidBlock) revert AnchorBeforeLastPayout();
        if (tierAmt <= bnty.paidAmount) revert TierAlreadyPaid();

        po.amount = tierAmt - bnty.paidAmount; // only the difference with the tier already granted
        po.netFee = po.amount * networkBountyBps / 10_000;
        po.opFee = po.amount * operatorBountyBps / 10_000;
        uint256 total = po.amount + po.netFee + po.opFee;
        if (bnty.balance < total) revert PoolTooSmall();

        // signatures of enclaves active at block N; above the single-enclave cap (compared with the TIER amount),
        // k distinct operators
        po.claimDigest = _hashTypedDataV4(_claimHash(r));
        uint256 nOps;
        (po.ops, nOps) = _checkSigners(po.claimDigest, bnty.productId, r.blockN, signatures);
        if (tierAmt > bnty.singleCap && nOps < bnty.k) revert NeedMoreEnclaves();
        address[] memory ops = po.ops;
        assembly ("memory-safe") {
            mstore(ops, nOps) // keep only the distinct operators
        }

        // ---- effects before any external call ----
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

        // exposure split over the distinct operators: amount / nOps each, bounded by OperatorBond
        // (half of the free bond AND the product's exposure cap, per operator, over a rolling 24 hours)
        uint256 cap = products.getProduct(bnty.productId).exposureCap;
        uint256 per = po.amount / nOps;
        for (uint256 i = 0; i < nOps; i++) {
            bond.consumeExposure(ops[i], bnty.productId, per, cap);
        }

        emit ClaimAccepted(r.bountyId, po.claimDigest, r, ops, po.amount);

        // pause the target if the protocol gave this role to the contract (bounded, never blocking)
        _pauseTarget(bnty.targetToPause);
    }

    /// @dev Delivers cP (event) and pays; a refused transfer becomes a credit (never a failure).
    function _pay(uint256 bountyId, bytes32 fingerprint, Payout memory po, bytes calldata cP) private {
        emit ExploitDelivered(bountyId, cP);
        emit BountyPaid(bountyId, po.payee, po.amount, po.tier);

        uint256 n = po.ops.length;
        uint256 opPer = po.opFee / n;
        _payOrCredit(po.payee, po.amount);
        // the remainder of the operator share's division goes to the network (nothing stays locked)
        _payOrCredit(treasury, po.netFee + (po.opFee - opPer * n));
        for (uint256 i = 0; i < n; i++) {
            _payOrCredit(po.ops[i], opPer);
        }

        // ERC-8004 verdict: a registry failure does not block the payout; v2b: the verdict's gas is required before the
        // call (a call sent with the minimal gas no longer skips the verdict)
        uint256 agentId = bond.agentIdOf(po.ops[0]);
        bytes32 requestHash = keccak256(abi.encode(block.chainid, address(this), "bounty", bountyId, fingerprint));
        _requireVerdictGas();
        try verdict.record(agentId, requestHash, "", po.cPHash, "", 100, "tdx-dcap/sealed-bounty") {}
        catch {
            emit VerdictSkipped(requestHash, RevertReason.bounded()); // v2.1b: never the whole revert data
        }
    }

    /// @dev A refused transfer (blocked address, paused USDC) becomes a credit. A STARVED transfer (minimal gas)
    ///      cannot: after running out of gas in the call, only 1/64 of the gas is left, which does not pay for
    ///      writing the credit, so the whole transaction fails (checked by
    ///      test_FIXED_v2_minimalGasDeliverPaysAndWritesVerdict).
    function _payOrCredit(address to, uint256 amount) private {
        if (amount == 0) return;
        try usdc.transfer(to, amount) returns (bool ok) {
            if (ok) return;
        } catch {}
        credit[to] += amount;
        emit Credited(to, amount);
    }

    /// @dev BOUNDED call to pause(): exactly PAUSE_GAS (enough gas to give it is required, so a hunter cannot starve
    ///      the pause), no return data copied (no "return bomb"), failure ignored.
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

    /// @dev v2b: requires the ERC-8004 verdict's gas before calling it (see VERDICT_GAS).
    function _requireVerdictGas() private view {
        if (gasleft() < VERDICT_GAS * 64 / 63 + 20_000) revert InsufficientGasForVerdict();
    }

    function _tierPayout(uint256 bountyId, uint8 tier, uint256 loss) private view returns (uint256) {
        uint256[] storage mins = tierMinLoss[bountyId];
        if (tier >= mins.length) revert BadTierIndex();
        if (loss < mins[tier]) revert LossTooLow();
        return tierAmount[bountyId][tier];
    }

    /// @dev Recovers each signer, requires an active enclave of the product at block N, and counts the DISTINCT
    ///      operators (two enclaves of the same operator count once). They all sign the same claim.
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

    /// @dev DISTINCT operators behind a refutation: enclaves of the product active NOW, none from an operator that
    ///      signed the claim.
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

    /// @dev The INPUTS of a claim: everything the deterministic replay takes into account.
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
