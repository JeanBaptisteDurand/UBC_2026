// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Base} from "./Base.t.sol";
import {StrictValidationRegistry, ReturnBombRegistry, LongReasonRegistry} from "./mocks/MockERC8004Strict.sol";

import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";
import {AttestedBatchVerifier} from "../src/demo/AttestedBatchVerifier.sol";
import {AttestedSignersLib} from "../src/attested/AttestedSigners.sol";

// =====================================================================================================================
// Adversarial review of v2.1: each fix is proven here. The v2.1 stack deployed on Arc testnet includes both rounds of fixes.
//   FINDING 1 (medium, pre-existing): a predictable ERC-8004 requestHash in the SHARED space of Circle's registry →
//            taken in advance by a third party, verdict skipped forever. Fixed in VerdictLog (salted hash).
//   FINDING 2 (medium, v2.1 regression): `catch (bytes memory reason)` copied the whole revert → a hostile registry
//            blocked closing, slashing, payment and refutation at ALL gas levels. Fixed (RevertReason, 132 bytes).
//   FINDING 3 (low/medium): onlyAttested accepted an enclave whose image or product had been retired, as long as
//            nobody had called invalidateRetiredWorkload. Fixed (EnclaveRegistry.attestedOperator).
//   FINDING 4 (low): SealedBounty: two operators equivocating on the same fingerprint had the same requestHash.
//            Fixed (the requestHash includes the operator).
// This file ALSO compiles against the pre-fix v2.1 sources (no new symbol is referenced directly: event
// redeclared, selectors computed, low-level calls): every "F*" test fails there, and passes with the first round of fixes.
// The "limit_*" tests document what remains out of reach (they pass before and after).
//
// Second round of fixes (after both reviews), same discipline: tests "F5" and "F6" compile against the first round,
// fail there, and pass with the second round.
//   FINDING 5: a session closed WITHOUT ANY settlement (paid == 0) wrote an ERC-8004 "100": an operator opened
//            sessions from a wallet of its own and closed them unused (deposit refunded) to manufacture
//            100/100 scores for the price of gas alone. Fixed: no verdict, not even attempted, and VerdictNotApplicable(sessionId).
//   FINDING 6: verdictWritten served both the closing "100" and the fault "0": an equivocation proven
//            AFTER the close seized the bond without ever writing the 0. Fixed: a flag of its own for the fault
//            verdict (faultVerdictWritten), one per session.
// Since the second round, the session of V21SessionPayTest is SETTLED in setUp (10 units): the tests of the closing
// verdict concern a session that paid (otherwise there is no verdict to write).
// =====================================================================================================================

/// @dev Shared helpers: a faithful ERC-8004 registry, a hostile registry, preemption of a hash, the salted hash.
abstract contract V21Helpers is Base {
    /// @dev = VerdictLog.RequestHashSalted (first round of fixes), redeclared so the file also compiles against pre-fix v2.1.
    event RequestHashSalted(bytes32 indexed requestHash, bytes32 indexed saltedHash);

    bytes4 internal constant ALREADY_RECORDED = bytes4(keccak256("AlreadyRecorded()"));

    StrictValidationRegistry internal strict;

    /// @dev The test validation registry becomes the faithful model of Circle's (same address: VerdictLog
    ///      keeps its immutable `validation`).
    function _installStrictRegistry() internal {
        StrictValidationRegistry model = new StrictValidationRegistry(identity);
        vm.etch(address(validation), address(model).code);
        strict = StrictValidationRegistry(address(validation));
    }

    function _installBombRegistry() internal {
        vm.etch(address(validation), address(new ReturnBombRegistry()).code);
    }

    /// @dev The operator creates its ERC-8004 agent, approves VerdictLog and links to it (a documented prerequisite of VerdictLog).
    function _linkAgent(uint256 operatorPk, string memory uri) internal returns (uint256 agentId) {
        vm.startPrank(vm.addr(operatorPk));
        agentId = identity.register(uri);
        identity.setApprovalForAll(address(verdict), true);
        bond.setAgentId(agentId);
        vm.stopPrank();
    }

    /// @dev A stranger takes `h` in advance: its agent (created without permission), itself the validator, response 0.
    function _preempt(bytes32 h) internal returns (address griefer, uint256 griefAgent) {
        griefer = makeAddr("griefer");
        vm.startPrank(griefer);
        griefAgent = identity.register("griefer");
        strict.validationRequest(griefer, griefAgent, "", h);
        strict.validationResponse(h, 0, "", bytes32(0), "tdx-dcap/inference");
        vm.stopPrank();
    }

    /// @dev = VerdictLog.saltedHash(h) in the current block.
    function _salted(bytes32 h) internal view returns (bytes32) {
        return keccak256(abi.encode(h, blockhash(vm.getBlockNumber() - 1)));
    }

    /// @dev The reason of the first VerdictSkipped(bytes32 indexed, bytes) emitted by `emitter`.
    function _skippedReason(Vm.Log[] memory logs, address emitter)
        internal
        pure
        returns (bool found, bytes memory reason)
    {
        bytes32 topic = keccak256("VerdictSkipped(bytes32,bytes)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                return (true, abi.decode(logs[i].data, (bytes)));
            }
        }
    }

    function _longMessage() internal pure returns (string memory) {
        bytes memory m = new bytes(300); // = LongReasonRegistry
        for (uint256 i = 0; i < 300; i++) {
            m[i] = bytes1(uint8(0x41 + (i % 26)));
        }
        return string(m);
    }
}

// ------------------------------------------------------------------------------------------------------------ SessionPay

contract V21SessionPayTest is V21Helpers {
    bytes32 constant MODEL = keccak256("Qwen2.5-1.5B-Instruct-Q4_K_M");

    uint256 productId;
    address signer;
    uint256 sessionId;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(sessionPay), false, MODEL, 1e6, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
        sessionId = _openAs(userPk, 1000e6, keccak256("open"));
        // second round: the session served and paid (10 units, 10 USDC); a session that paid nothing no longer has a verdict
        // at closing (FINDING 5)
        SessionPay.Receipt memory r = _receipt(1, keccak256("resp1"));
        sessionPay.settle(r, _sigReceipt(r, signerPk));
    }

    /// @dev Session of `ownerPk` on the operator's enclave, deadline in one day.
    function _openAs(uint256 ownerPk, uint256 deposit, bytes32 nonce) internal returns (uint256 sid) {
        UsdcPayer.Auth memory auth = _usdcAuth(ownerPk, address(sessionPay), deposit, nonce);
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: productId,
            operator: operator,
            sessionKey: makeAddr("sessionKey"),
            expiresAt: uint64(vm.getBlockTimestamp() + 1 days),
            deposit: deposit,
            cap: 0,
            auth: auth,
            enclave: signer
        });
        vm.prank(vm.addr(ownerPk));
        sid = sessionPay.openSession(q);
    }

    function _receipt(uint64 seq, bytes32 responseHash) internal view returns (SessionPay.Receipt memory r) {
        r = SessionPay.Receipt({
            productId: productId,
            sessionId: sessionId,
            seq: seq,
            modelHash: MODEL,
            paramsHash: keccak256("params"),
            requestHash: keccak256(abi.encodePacked("req", seq)),
            responseHash: responseHash,
            tokensIn: 10,
            tokensOut: 20,
            cumulativeUnits: 10,
            anchorBlock: uint64(vm.getBlockNumber())
        });
    }

    function _sigReceipt(SessionPay.Receipt memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sessionPay.RECEIPT_TYPEHASH(),
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
        return _sign(pk, _typed(address(sessionPay), structHash));
    }

    function _equivocationCall(uint64 seq) internal view returns (bytes memory) {
        SessionPay.Receipt memory a = _receipt(seq, keccak256("respA"));
        SessionPay.Receipt memory b = _receipt(seq, keccak256("respB"));
        return abi.encodeCall(SessionPay.reportEquivocation, (a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk)));
    }

    function _warpPastClose() internal {
        vm.warp(uint256(sessionPay.getSession(sessionId).expiresAt) + sessionPay.SETTLE_GRACE());
    }

    function _sessionHash() internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user));
    }

    function _equivocationHash(uint64 seq) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(sessionPay), "equivocation", sessionId, seq));
    }

    // ---- FAILLE 2 : return bomb ----

    /// FINDING 2 (fixed): a hostile ERC-8004 registry whose revert costs ≈ 40 % of the gas received to copy. Before the fix:
    /// closing failed at ALL gas levels (deposit stuck). Fixed: it refunds and records the skipped verdict (bounded
    /// reason), at every gas level tried.
    function test_F2_returnBombDoesNotBlockCloseSession() public {
        _installBombRegistry();
        _warpPastClose();
        uint256[4] memory g = [uint256(1_000_000), 3_000_000, 10_000_000, 30_000_000];
        for (uint256 i = 0; i < g.length; i++) {
            uint256 snap = vm.snapshotState();
            uint256 before = usdc.balanceOf(user);
            vm.recordLogs();
            vm.prank(user);
            (bool ok,) = address(sessionPay).call{gas: g[i]}(abi.encodeCall(SessionPay.closeSession, (sessionId)));
            assertTrue(ok, "fermeture faite malgre le registre hostile");
            assertEq(usdc.balanceOf(user) - before, 1000e6 - 10e6, "rembourse (depot - 10 unites reglees)");
            assertTrue(sessionPay.getSession(sessionId).closed);
            assertFalse(sessionPay.getSession(sessionId).verdictWritten);
            (bool found, bytes memory reason) = _skippedReason(vm.getRecordedLogs(), address(sessionPay));
            assertTrue(found, "verdict saute, trace");
            assertLe(reason.length, 132, "raison bornee");
            vm.revertToState(snap);
        }
    }

    /// FINDING 2: the MINIMUM gas of a close under a hostile registry is finite and modest (what eth_estimateGas finds):
    /// the cost after the failed verdict no longer depends on the callee's revert.
    function test_F2_returnBomb_minimalCloseGasIsBounded() public {
        _installBombRegistry();
        _warpPastClose();
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));
        uint256 g = _minGasToSucceed(user, address(sessionPay), call, 21_000, 30_000_000);
        vm.prank(user);
        (bool ok,) = address(sessionPay).call{gas: g}(call);
        assertTrue(ok, "reussit au gaz minimal trouve");
        assertLt(g, 1_000_000, "gaz minimal borne");
        emit log_named_uint("closeSession sous registre hostile, gaz minimal", g);
    }

    /// FINDING 2: slashing for equivocation also goes through under a hostile registry (before the fix: blocked at 30 M gas).
    function test_F2_returnBombDoesNotBlockEquivocationSlash() public {
        bytes memory call = _equivocationCall(5);
        _installBombRegistry();
        (bool ok,) = address(sessionPay).call{gas: 30_000_000}(call);
        assertTrue(ok, "saisie faite malgre le registre hostile");
        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
    }

    /// FINDING 2: the VerdictSkipped reason is the 132-byte PREFIX of the revert (before the fix: all 388 bytes).
    function test_F2_skippedReasonTruncatedTo132Bytes() public {
        vm.etch(address(validation), address(new LongReasonRegistry()).code);
        _warpPastClose();
        vm.recordLogs();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        (bool found, bytes memory reason) = _skippedReason(vm.getRecordedLogs(), address(sessionPay));
        assertTrue(found);
        bytes memory full = abi.encodeWithSignature("Error(string)", _longMessage());
        assertEq(full.length, 388);
        assertEq(reason.length, 132, "tronquee a 132 octets");
        for (uint256 i = 0; i < 132; i++) {
            assertEq(reason[i], full[i]);
        }
    }

    // ---- FINDING 1: requestHash taken in advance ----

    /// Control (passes before and after): with no attack, the 100 verdict is written under the session's requestHash.
    function test_control_sessionVerdictUnderBaseHash() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(_sessionHash());
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(r, 100);
        assertTrue(has);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
    }

    /// FINDING 1 (fixed): a stranger takes the session's requestHash in advance (computable from the opening). Before the fix:
    /// VerdictSkipped("exists"), verdict lost forever. Fixed: written under the salted hash (RequestHashSalted),
    /// for the operator's agent; the attacker's entry stays under ITS own validator name and does not count for us.
    function test_F1_preemptedSessionVerdictWrittenUnderSaltedHash() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes32 h = _sessionHash();
        (address griefer,) = _preempt(h);
        _warpPastClose();
        bytes32 salted = _salted(h);

        vm.expectEmit(true, true, false, false, address(verdict));
        emit RequestHashSalted(h, salted);
        vm.prank(user);
        sessionPay.closeSession(sessionId);

        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "verdict ecrit");
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(salted);
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(r, 100);
        assertTrue(has);
        (v,,,) = strict.statusOf(h);
        assertEq(v, griefer, "l'entree occupee reste celle de l'attaquant, sous son nom");
        bytes32[] memory mine = strict.getAgentValidations(agent);
        assertEq(mine.length, 1);
        assertEq(mine[0], salted, "l'agent de l'operateur ne porte que notre verdict");
    }

    /// FINDING 1 (with the v2 gas reserve): at the MINIMUM gas that makes the close succeed (what eth_estimateGas picks), under preemption,
    /// the salted verdict is still written: the VERDICT_GAS reserve also covers the salted path (before the fix: skipped).
    function test_F1_minimalGas_saltedVerdictStillWritten() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes32 h = _sessionHash();
        _preempt(h);
        _warpPastClose();
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));
        uint256 g = _minGasToSucceed(user, address(sessionPay), call, 21_000, 3_000_000);
        bytes32 salted = _salted(h);
        vm.prank(user);
        (bool ok,) = address(sessionPay).call{gas: g}(call);
        assertTrue(ok);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "verdict sale ecrit au gaz minimal");
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(salted);
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(r, 100);
        assertTrue(has);
        emit log_named_uint("closeSession sous preemption (sel), gaz minimal", g);
    }

    /// FINDING 1, FAULT verdict: the operator takes in advance, with its own agent, the hash (session, seq) on which it is about
    /// to equivocate. Before the fix: slashing done, verdict 0 never written. Fixed: written under the salted hash.
    function test_F1_preemptedSlashVerdictWrittenUnderSaltedHash() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes32 h = _equivocationHash(5);
        vm.prank(operator);
        strict.validationRequest(operator, agent, "", h);
        bytes32 salted = _salted(h);

        (bool ok,) = address(sessionPay).call(_equivocationCall(5));
        assertTrue(ok);
        assertTrue(bond.banned(operator), "saisie faite");
        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "verdict de faute ecrit");
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(salted);
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(r, 0);
        assertTrue(has);
    }

    /// FINDING 1: an attacker who names VerdictLog as validator of ITS agent under our hash gets no "100":
    /// VerdictLog never answers under a hash it did not request; the verdict goes, salted, to the operator's agent.
    function test_F1_preemptionNamingVerdictLog_noReputationTheft() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes32 h = _sessionHash();
        address griefer = makeAddr("griefer-2");
        vm.startPrank(griefer);
        uint256 ga = identity.register("griefer-2");
        strict.validationRequest(address(verdict), ga, "", h);
        vm.stopPrank();
        _warpPastClose();
        bytes32 salted = _salted(h);

        vm.prank(user);
        sessionPay.closeSession(sessionId);

        (address v, uint256 a,, bool has) = strict.statusOf(h);
        assertEq(v, address(verdict));
        assertEq(a, ga);
        assertFalse(has, "aucune reponse pour l'agent de l'attaquant");
        uint8 r;
        (, a, r, has) = strict.statusOf(salted);
        assertEq(a, agent);
        assertEq(r, 100);
        assertTrue(has);
    }

    /// Documented LIMIT (inherent to ERC-8004, passes before and after): the owner of an agent can refuse any
    /// request for its agent. An operator who withdraws VerdictLog's approval before cheating prevents its fault verdict
    /// in ERC-8004; the slashing and the ban still happen, and the skipped verdict is recorded with its reason.
    function test_limit_operatorRevokesApproval_slashedButVerdictSkipped() public {
        _installStrictRegistry();
        _linkAgent(opPk, "operateur");
        vm.prank(operator);
        identity.setApprovalForAll(address(verdict), false);
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit SessionPay.VerdictSkipped(_equivocationHash(6), abi.encodeWithSignature("Error(string)", "Not authorized"));
        (bool ok,) = address(sessionPay).call(_equivocationCall(6));
        assertTrue(ok);
        assertTrue(bond.banned(operator), "la faute est etablie par nos contrats");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);
    }

    /// Documented LIMIT: an attacker who goes BEFORE us in the SAME block can also compute and take the salted hash
    /// (whatever one contract computes, another contract in the same block can compute). The close goes through; the verdict is skipped.
    function test_limit_sameBlockFrontRunOfSaltedHash() public {
        _installStrictRegistry();
        _linkAgent(opPk, "operateur");
        _warpPastClose();
        bytes32 h = _sessionHash();
        _preempt(h);
        address g2 = makeAddr("griefer-meme-bloc");
        vm.startPrank(g2);
        uint256 ga2 = identity.register("griefer-meme-bloc");
        strict.validationRequest(g2, ga2, "", _salted(h));
        vm.stopPrank();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertTrue(sessionPay.getSession(sessionId).closed, "la fermeture passe");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten, "limite residuelle : verdict saute");
    }

    // ---- second round, FINDING 5: a "100" for a session that paid nothing ----

    /// @dev = SessionPay.VerdictNotApplicable (second round), redeclared so the file also compiles against the first round.
    event VerdictNotApplicable(uint256 indexed sessionId);

    /// @dev SessionPay.getSession(sid).faultVerdictWritten (second round: 17th field, added at the end), read at low level so
    ///      the file also compiles against the first round, where the field does not exist (the test then fails here).
    function _faultVerdictWritten(uint256 sid) internal view returns (bool) {
        (bool ok, bytes memory ret) = address(sessionPay).staticcall(abi.encodeCall(SessionPay.getSession, (sid)));
        assertTrue(ok);
        assertEq(ret.length, 17 * 32, "getSession porte faultVerdictWritten (v2.1 ter)");
        bytes32[17] memory w = abi.decode(ret, (bytes32[17]));
        return w[16] != bytes32(0);
    }

    /// FINDING 5 (fixed): the operator opens, from a wallet of its own, sessions on its own enclave and
    /// closes them without using them. First round: deposit fully refunded AND an ERC-8004 "100" per session, for the price of gas alone.
    /// Second round: full refund, no ERC-8004 entry (VerdictLog is not even called), VerdictNotApplicable.
    function test_F5_unpaidSessionsWriteNoVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        uint256 sockPk = 0x50C50C; // a wallet of the operator
        address sock = vm.addr(sockPk);
        usdc.mint(sock, 3e6);
        uint256[] memory sids = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            sids[i] = _openAs(sockPk, 1e6, keccak256(abi.encode("sock", i)));
        }
        _warpPastClose();

        vm.recordLogs();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sock);
            sessionPay.closeSession(sids[i]);
            assertTrue(sessionPay.getSession(sids[i]).closed);
            assertFalse(sessionPay.getSession(sids[i]).verdictWritten, "aucun 100 pour une session qui n'a rien paye");
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 notApplicable;
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].emitter != address(verdict), "VerdictLog jamais appele");
            if (
                logs[i].emitter == address(sessionPay) && logs[i].topics.length > 0
                    && logs[i].topics[0] == VerdictNotApplicable.selector
            ) {
                assertEq(uint256(logs[i].topics[1]), sids[notApplicable], "VerdictNotApplicable(sessionId)");
                notApplicable++;
            }
        }
        assertEq(notApplicable, 3, "une trace par session fermee sans reglement");
        (bool skipped,) = _skippedReason(logs, address(sessionPay));
        assertFalse(skipped, "aucun verdict tente");
        assertEq(usdc.balanceOf(sock), 3e6, "depots rendus en entier");
        assertEq(strict.getAgentValidations(agent).length, 0, "aucun 100 fabrique");
    }

    // ---- second round, FINDING 6: a flag shared between the closing "100" and the fault "0" ----

    /// FINDING 6 (fixed): equivocation proven AFTER the close, whose 100 is already written. First round: the bond
    /// was seized but the 0 was skipped without a trace (verdictWritten, shared, already true). Second round: the 0 is written, for
    /// the operator's agent, next to the 100.
    function test_F6_equivocationAfterCloseWritesSlashVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes memory call = _equivocationCall(5); // receipts anchored during the session
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "100 ecrit a la fermeture");

        (bool ok,) = address(sessionPay).call(call); // fault proven AFTER the close
        assertTrue(ok);
        assertTrue(bond.banned(operator), "saisie faite");
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(_equivocationHash(5));
        assertEq(v, address(verdict), "verdict de faute ecrit");
        assertEq(a, agent);
        assertEq(r, 0);
        assertTrue(has);
        assertEq(strict.getAgentValidations(agent).length, 2, "le 100 de la fermeture et le 0 de la faute");
        assertTrue(_faultVerdictWritten(sessionId));
    }

    /// FINDING 6: a single fault verdict per session. Reporting the same proof again, then another equivocation of
    /// the same session, attempts and writes nothing more (the slashing, still admissible, takes nothing more).
    function test_F6_oneSlashVerdictPerSession() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes memory eq5 = _equivocationCall(5);
        bytes memory eq6 = _equivocationCall(6);
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        (bool ok,) = address(sessionPay).call(eq5);
        assertTrue(ok);
        assertEq(strict.getAgentValidations(agent).length, 2, "le 100 et un 0");

        vm.recordLogs();
        (bool ok5,) = address(sessionPay).call(eq5); // the same proof
        (bool ok6,) = address(sessionPay).call(eq6); // another equivocation, same session
        assertTrue(ok5 && ok6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].emitter != address(verdict), "aucune nouvelle ecriture");
        }
        (bool skipped,) = _skippedReason(logs, address(sessionPay));
        assertFalse(skipped, "aucune nouvelle tentative");
        assertEq(strict.getAgentValidations(agent).length, 2, "toujours un seul verdict de faute");
        (address v,,,) = strict.statusOf(_equivocationHash(6));
        assertEq(v, address(0));
    }

    /// FINDING 6: a fault verdict that fails after the close (registry down) is recorded, then retried by a
    /// new report of the same proof. First round: never attempted (the flag had been true since the 100).
    function test_F6_failedSlashVerdictAfterCloseIsRetried() public {
        bytes memory call = _equivocationCall(5);
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertEq(validation.responses(), 1, "le 100");

        validation.setShouldRevert(true);
        vm.recordLogs();
        (bool ok,) = address(sessionPay).call(call);
        assertTrue(ok);
        assertTrue(bond.banned(operator));
        (bool found, bytes memory reason) = _skippedReason(vm.getRecordedLogs(), address(sessionPay));
        assertTrue(found, "verdict de faute tente, et trace");
        assertEq(reason, abi.encodeWithSignature("Error(string)", "validation down"));
        assertFalse(_faultVerdictWritten(sessionId));

        validation.setShouldRevert(false);
        (ok,) = address(sessionPay).call(call); // new report: retries the fault verdict
        assertTrue(ok);
        assertEq(validation.responses(), 2, "le 0, au second signalement");
        assertTrue(_faultVerdictWritten(sessionId));
    }

    /// FINDING 5, with a fault: a session closed without settlement (no verdict), then a fault proven on that session: the
    /// 0 is written (a close without a verdict sets no flag). First round: the close wrote a 100 for the
    /// empty session, and that 100 prevented the 0.
    function test_F5_unpaidClosedSessionStillGetsSlashVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        sessionId = _openAs(userPk, 5e6, keccak256("open-unpaid")); // the helpers now target this session
        bytes memory call = _equivocationCall(7);
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertFalse(sessionPay.getSession(sessionId).verdictWritten, "pas de 100 : rien n'a ete paye");

        (bool ok,) = address(sessionPay).call(call);
        assertTrue(ok);
        (address v, uint256 a, uint8 r, bool has) = strict.statusOf(_equivocationHash(7));
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(r, 0);
        assertTrue(has);
        assertEq(strict.getAgentValidations(agent).length, 1, "le seul verdict est celui de la faute");
        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "une entree ERC-8004 existe pour cette session");
    }
}

// ---------------------------------------------------------------------------------------------------------- SealedBounty

contract V21SealedBountyTest is V21Helpers {
    bytes32 constant PREDICATE = keccak256("predicate-v0");

    uint256 productId;
    uint256 bountyId;
    uint64 blockN;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        _bondOperator(op2Pk, 1000e6);
        productId = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 0, 100e6, 100_000e6);
        _registerEnclave(productId, opPk, signerPk, "s1");
        _registerEnclave(productId, op2Pk, signer2Pk, "s2");
        vm.roll(1002);
        blockN = 1001; // literal: via_ir folds a block.number read after vm.roll in the same function

        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 1e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = 100e6;
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: productId,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 200e6,
            k: 2,
            targetToPause: address(0),
            deadline: uint64(vm.getBlockTimestamp() + 1 days),
            funding: 100_000e6,
            auth: _usdcAuth(protocolPk, address(sealedBounty), 100_000e6, keccak256("fund-v21"))
        });
        vm.prank(protocol);
        bountyId = sealedBounty.createBounty(q);
    }

    function _claimAt(bytes32 fingerprint, uint256 loss, bytes32 cPHash)
        internal
        view
        returns (SealedBounty.Claim memory r)
    {
        r = SealedBounty.Claim({
            bountyId: bountyId,
            payee: hunter,
            blockN: blockN,
            blockHashN: keccak256(abi.encodePacked(bytes32(uint256(blockN)))), // = MockHistory
            predicateHash: PREDICATE,
            loss: loss,
            tier: 0,
            fingerprint: fingerprint,
            cPHash: cPHash,
            deadline: uint64(vm.getBlockTimestamp() + 1 hours)
        });
    }

    function _sigClaim(SealedBounty.Claim memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sealedBounty.CLAIM_TYPEHASH(),
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
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    function _sigRefutation(SealedBounty.Refutation memory f, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(sealedBounty.REFUTATION_TYPEHASH(), f.claimDigest, f.proven, f.loss, f.tier));
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    function _one(bytes memory sig) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](1);
        sigs[0] = sig;
    }

    function _equivocationCall(bytes32 fp, uint256 pk) internal view returns (bytes memory) {
        SealedBounty.Claim memory a = _claimAt(fp, 5e6, keccak256("c"));
        SealedBounty.Claim memory b = _claimAt(fp, 50e6, keccak256("c"));
        return abi.encodeCall(SealedBounty.reportEquivocation, (a, _sigClaim(a, pk), b, _sigClaim(b, pk)));
    }

    /// @dev First round of fixes: requestHash of the fault verdict for a bounty equivocation (includes the operator).
    function _equivocationHash(bytes32 fp, address op) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(sealedBounty), "equivocation", bountyId, fp, op));
    }

    // ---- FAILLE 2 : return bomb ----

    /// FINDING 2 (fixed): paying a bounty (claim → _pay) under a hostile registry. Before the fix: blocked at 2, 10 and 30 M gas.
    function test_F2_returnBombDoesNotBlockBountyPayment() public {
        bytes memory cP = bytes("sealed-to-protocol");
        SealedBounty.Claim memory r = _claimAt(keccak256("fp-bomb"), 5e6, keccak256(cP));
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));
        _installBombRegistry();
        uint256 before = usdc.balanceOf(hunter);
        (bool ok,) = address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.claim, (r, sigs, cP)));
        assertTrue(ok, "prime payee malgre le registre hostile");
        assertEq(usdc.balanceOf(hunter) - before, 100e6);
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-bomb")));
    }

    /// FINDING 2: delivery (deliver) of a reserved payment, under a hostile registry.
    function test_F2_returnBombDoesNotBlockDeliver() public {
        bytes memory cP = bytes("sealed-2");
        bytes32 fp = keccak256("fp-bomb-2");
        SealedBounty.Claim memory r = _claimAt(fp, 5e6, keccak256(cP));
        sealedBounty.acceptClaim(r, _one(_sigClaim(r, signerPk)));
        _installBombRegistry();
        uint256 before = usdc.balanceOf(hunter);
        (bool ok,) =
            address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.deliver, (bountyId, fp, cP)));
        assertTrue(ok, "livre et paye malgre le registre hostile");
        assertEq(usdc.balanceOf(hunter) - before, 100e6);
    }

    /// FINDING 2: slashing for a bounty equivocation, under a hostile registry.
    function test_F2_returnBombDoesNotBlockBountyEquivocationSlash() public {
        bytes memory call = _equivocationCall(keccak256("fp-eqb"), signerPk);
        _installBombRegistry();
        (bool ok,) = address(sealedBounty).call{gas: 30_000_000}(call);
        assertTrue(ok, "saisie faite malgre le registre hostile");
        assertTrue(bond.banned(operator));
    }

    /// FINDING 2: refutation of an accepted claim, under a hostile registry.
    function test_F2_returnBombDoesNotBlockRefute() public {
        uint256 op3Pk = 0xC0C;
        usdc.mint(vm.addr(op3Pk), 1_000_000e6);
        _bondOperator(op3Pk, 1000e6);
        _registerEnclave(productId, op3Pk, 0x5454, "s3");
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claimAt(keccak256("fp-ref"), 5e6, keccak256(cP));
        sealedBounty.claim(r, _one(_sigClaim(r, signerPk)), cP);
        SealedBounty.Refutation memory f =
            SealedBounty.Refutation({claimDigest: sealedBounty.claimDigest(r), proven: false, loss: 0, tier: 0});
        address[] memory ops = new address[](1);
        ops[0] = operator;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sigRefutation(f, signer2Pk);
        sigs[1] = _sigRefutation(f, 0x5454);
        _installBombRegistry();
        (bool ok,) =
            address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.refute, (r, ops, f, sigs)));
        assertTrue(ok, "refutation faite malgre le registre hostile");
        assertTrue(bond.banned(operator));
    }

    // ---- FINDING 1, bounty side ----

    /// FINDING 1: the "bounty" requestHash is known from the acceptance (ClaimAccepted), before delivery: a stranger
    /// takes it in between. Before the fix: 100 verdict skipped. Fixed: written under the salted hash.
    function test_F1_preemptedBountyVerdictWrittenUnderSaltedHash() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "op1");
        bytes memory cP = bytes("sealed-3");
        bytes32 fp = keccak256("fp-pre");
        SealedBounty.Claim memory r = _claimAt(fp, 5e6, keccak256(cP));
        sealedBounty.acceptClaim(r, _one(_sigClaim(r, signerPk)));
        bytes32 h = keccak256(abi.encode(block.chainid, address(sealedBounty), "bounty", bountyId, fp));
        _preempt(h);
        bytes32 salted = _salted(h);

        vm.expectEmit(true, true, false, false, address(verdict));
        emit RequestHashSalted(h, salted);
        sealedBounty.deliver(bountyId, fp, cP);

        (address v, uint256 a, uint8 resp, bool has) = strict.statusOf(salted);
        assertEq(v, address(verdict));
        assertEq(a, agent);
        assertEq(resp, 100);
        assertTrue(has);
    }

    /// The salt creates no duplicate: reporting the same equivocation twice writes only ONE fault verdict; the second
    /// call is refused by VerdictLog (AlreadyRecorded) and recorded.
    function test_F1_noDuplicateSlashVerdictOnRepeatedReport() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "op1");
        bytes32 fp = keccak256("fp-dup");
        bytes memory call = _equivocationCall(fp, signerPk);
        (bool ok,) = address(sealedBounty).call(call);
        assertTrue(ok);
        vm.expectEmit(true, false, false, true, address(sealedBounty));
        emit SealedBounty.VerdictSkipped(_equivocationHash(fp, operator), abi.encodeWithSelector(ALREADY_RECORDED));
        (ok,) = address(sealedBounty).call(call);
        assertTrue(ok);
        assertEq(strict.getAgentValidations(agent).length, 1, "un seul verdict de faute");
    }

    // ---- FINDING 4: collision between operators ----

    /// FINDING 4 (fixed): two operators equivocate on the SAME fingerprint. Before the fix: same requestHash, the fault
    /// verdict of the second was skipped ("exists"). Fixed: one fault verdict per operator, each under its own agent.
    function test_F4_twoOperatorsSameFingerprint_bothSlashVerdictsWritten() public {
        _installStrictRegistry();
        uint256 agent1 = _linkAgent(opPk, "op1");
        uint256 agent2 = _linkAgent(op2Pk, "op2");
        bytes32 fp = keccak256("meme-exploit");
        (bool ok1,) = address(sealedBounty).call(_equivocationCall(fp, signerPk));
        (bool ok2,) = address(sealedBounty).call(_equivocationCall(fp, signer2Pk));
        assertTrue(ok1 && ok2);
        assertTrue(bond.banned(operator) && bond.banned(operator2), "deux saisies");

        (address v1, uint256 a1, uint8 r1, bool h1) = strict.statusOf(_equivocationHash(fp, operator));
        assertEq(v1, address(verdict));
        assertEq(a1, agent1);
        assertEq(r1, 0);
        assertTrue(h1);
        (address v2, uint256 a2, uint8 r2, bool h2) = strict.statusOf(_equivocationHash(fp, operator2));
        assertEq(v2, address(verdict));
        assertEq(a2, agent2, "le second operateur a son verdict de faute");
        assertEq(r2, 0);
        assertTrue(h2);
    }
}

// ------------------------------------------------------------------------------------------------------------ VerdictLog

contract V21VerdictLogTest is V21Helpers {
    /// VerdictLog after the fix: one verdict per requestHash (AlreadyRecorded), zero hash refused, salt only when the hash is
    /// taken, and recordedAs tells under which hash the verdict is written.
    function test_writeOnce_saltOnlyWhenTaken() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "op1");
        bytes32 h = keccak256("verdict-1");
        vm.prank(address(sessionPay));
        verdict.record(agent, h, "", bytes32(0), "", 100, "tdx-dcap/inference");
        (bool ok, bytes memory ret) = address(verdict).staticcall(abi.encodeWithSignature("recordedAs(bytes32)", h));
        assertTrue(ok, "recordedAs (v2.1 bis)");
        assertEq(abi.decode(ret, (bytes32)), h, "pas de sel sans attaque");

        vm.prank(address(sessionPay));
        vm.expectRevert(ALREADY_RECORDED);
        verdict.record(agent, h, "", bytes32(0), "", 100, "tdx-dcap/inference");

        vm.prank(address(sessionPay));
        vm.expectRevert(VerdictLog.BadParams.selector);
        verdict.record(agent, bytes32(0), "", bytes32(0), "", 100, "tdx-dcap/inference");

        bytes32 h2 = keccak256("verdict-2");
        _preempt(h2);
        vm.prank(address(sessionPay));
        verdict.record(agent, h2, "", bytes32(0), "", 100, "tdx-dcap/inference");
        (ok, ret) = address(verdict).staticcall(abi.encodeWithSignature("recordedAs(bytes32)", h2));
        assertTrue(ok);
        assertEq(abi.decode(ret, (bytes32)), _salted(h2), "ecrit sous le hash sale");
        (ok, ret) = address(verdict).staticcall(abi.encodeWithSignature("saltedHash(bytes32)", h2));
        assertTrue(ok);
        assertEq(abi.decode(ret, (bytes32)), _salted(h2));
    }
}

// ------------------------------------------------------------------------------------------------------- onlyAttested

contract V21AttestedTest is V21Helpers {
    uint256 productId;
    address signer;
    AttestedBatchVerifier verifier;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(sessionPay), false, bytes32("model"), 1e6, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "att");
        verifier = new AttestedBatchVerifier(registry, productId);
    }

    function _submit(uint64 seq, bytes32 salt) internal returns (bool ok, bytes memory ret) {
        bytes32[] memory items = new bytes32[](1);
        items[0] = salt;
        uint64 dl = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _sign(signerPk, verifier.batchDigest(seq, keccak256(abi.encodePacked(items)), dl));
        (ok, ret) = address(verifier).call(abi.encodeCall(AttestedBatchVerifier.submitBatch, (seq, dl, items, sig)));
    }

    function _attestedOperator(address s, uint256 pid) internal view returns (address) {
        (bool ok, bytes memory ret) =
            address(registry).staticcall(abi.encodeWithSignature("attestedOperator(address,uint256)", s, pid));
        assertTrue(ok, "EnclaveRegistry.attestedOperator (v2.1 bis)");
        return abi.decode(ret, (address));
    }

    /// FINDING 3 (fixed): the author RETIRES the image (retireWorkload, immediate effect). Before the fix: onlyAttested still accepted
    /// the enclave as long as nobody had called invalidateRetiredWorkload(key). Fixed: refused at once.
    function test_F3_retiredImage_refusedWithoutKillTransaction() public {
        (bool ok,) = _submit(0, "avant");
        assertTrue(ok, "temoin : accepte avant le retrait");
        products.retireWorkload(productId, _workloadId());
        assertFalse(registry.killed(signer), "aucune transaction de kill");
        (bool ok2, bytes memory ret) = _submit(1, "apres retrait de l'image");
        assertFalse(ok2, "refuse des le retrait de l'image");
        assertEq(ret, abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
    }

    /// FINDING 3: product RETIRED by its author. Before the fix: its enclaves stayed "attested" until the end of their
    /// window. Fixed: refused at once.
    function test_F3_retiredProduct_refused() public {
        products.retire(productId);
        (bool ok, bytes memory ret) = _submit(0, "produit retire");
        assertFalse(ok, "refuse des le retrait du produit");
        assertEq(ret, abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
    }

    /// FINDING 3: the EnclaveRegistry.attestedOperator read (first round of fixes), case by case.
    function test_F3_attestedOperatorView() public {
        assertEq(_attestedOperator(signer, productId), operator);
        assertEq(_attestedOperator(signer, productId + 1), address(0), "autre produit");
        assertEq(_attestedOperator(user, productId), address(0), "cle hors enclave");

        uint256 snap = vm.snapshotState();
        products.retireWorkload(productId, _workloadId());
        assertEq(_attestedOperator(signer, productId), address(0), "image retiree");
        vm.revertToState(snap);

        snap = vm.snapshotState();
        products.retire(productId);
        assertEq(_attestedOperator(signer, productId), address(0), "produit retire");
        vm.revertToState(snap);

        vm.prank(address(sessionPay)); // an authorized settlement contract that proved a fault
        bond.slash(operator, address(this), user);
        assertEq(_attestedOperator(signer, productId), address(0), "operateur radie");
    }

    /// Intended scope (passes before and after): ANCHORED receipts and claims stay governed by activeOperatorAt (v2,
    /// curbed by invalidateRetiredWorkload); only what counts NOW (onlyAttested) follows the retirement without delay.
    function test_anchoredSettlementSemanticsUnchanged() public {
        products.retireWorkload(productId, _workloadId());
        assertEq(registry.activeOperatorAt(signer, productId, vm.getBlockNumber()), operator);
        registry.invalidateRetiredWorkload(signer);
        assertEq(registry.activeOperatorAt(signer, productId, vm.getBlockNumber()), address(0));
    }
}
