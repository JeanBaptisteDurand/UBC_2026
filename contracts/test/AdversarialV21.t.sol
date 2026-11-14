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
// Revue adverse de la v2.1 (9/11) — correctifs de la v2.1 bis, prouvés ici.
//   FAILLE 1 (moyenne, préexistante) : requestHash ERC-8004 prévisible dans l'espace COMMUN du registre de Circle →
//            occupé d'avance par un tiers, verdict sauté pour toujours. Corrigé dans VerdictLog (hash salé).
//   FAILLE 2 (moyenne, régression v2.1) : `catch (bytes memory reason)` recopiait tout le revert → un registre hostile
//            bloquait fermeture, saisie, paiement et réfutation à TOUS les gaz. Corrigé (RevertReason, 132 octets).
//   FAILLE 3 (faible/moyenne) : onlyAttested acceptait une enclave dont l'image ou le produit était retiré, tant que
//            personne n'avait appelé invalidateRetiredWorkload. Corrigé (EnclaveRegistry.attestedOperator).
//   FAILLE 4 (faible) : SealedBounty — deux opérateurs qui équivoquent sur la même empreinte avaient le même requestHash.
//            Corrigé (le requestHash porte l'opérateur).
// Ce fichier compile AUSSI contre les sources de la v2.1 (aucun nouveau symbole n'y est référencé directement : événement
// redéclaré, sélecteurs calculés, appels de bas niveau) : chaque test « F* » y échoue, et passe avec la v2.1 bis.
// Les tests « limit_* » documentent ce qui reste hors de portée (ils passent avant comme après).
//
// v2.1 ter (après les deux revues du 9/11), même discipline : les tests « F5 » et « F6 » compilent contre la v2.1 bis,
// y échouent, et passent avec la v2.1 ter.
//   FAILLE 5 : une session fermée SANS AUCUN règlement (paid == 0) écrivait un « 100 » ERC-8004 : un opérateur ouvrait
//            des sessions depuis un portefeuille à lui et les fermait sans usage (dépôt rendu) pour se fabriquer des
//            100/100 au seul prix du gaz. Corrigé : aucun verdict, ni tenté, et VerdictNotApplicable(sessionId).
//   FAILLE 6 : verdictWritten servait à la fois au 100 de la fermeture et au 0 de la faute : une équivocation prouvée
//            APRÈS la fermeture saisissait la caution sans jamais écrire le 0. Corrigé : drapeau propre au verdict de
//            faute (faultVerdictWritten), un seul par session.
// Depuis la v2.1 ter, la session de V21SessionPayTest est RÉGLÉE dès setUp (10 unités) : les tests du verdict de
// fermeture portent sur une session qui a payé (sinon, plus de verdict à écrire).
// =====================================================================================================================

/// @dev Aides communes : registre ERC-8004 fidèle, registre hostile, préemption d'un hash, hash salé.
abstract contract V21Helpers is Base {
    /// @dev = VerdictLog.RequestHashSalted (v2.1 bis), redéclaré pour compiler aussi contre la v2.1.
    event RequestHashSalted(bytes32 indexed requestHash, bytes32 indexed saltedHash);

    bytes4 internal constant ALREADY_RECORDED = bytes4(keccak256("AlreadyRecorded()"));

    StrictValidationRegistry internal strict;

    /// @dev Le registre de validation de test devient le modèle fidèle de celui de Circle (même adresse : VerdictLog
    ///      garde son immuable `validation`).
    function _installStrictRegistry() internal {
        StrictValidationRegistry model = new StrictValidationRegistry(identity);
        vm.etch(address(validation), address(model).code);
        strict = StrictValidationRegistry(address(validation));
    }

    function _installBombRegistry() internal {
        vm.etch(address(validation), address(new ReturnBombRegistry()).code);
    }

    /// @dev L'opérateur crée son agent ERC-8004, approuve VerdictLog et s'y lie (prérequis documenté de VerdictLog).
    function _linkAgent(uint256 operatorPk, string memory uri) internal returns (uint256 agentId) {
        vm.startPrank(vm.addr(operatorPk));
        agentId = identity.register(uri);
        identity.setApprovalForAll(address(verdict), true);
        bond.setAgentId(agentId);
        vm.stopPrank();
    }

    /// @dev Un inconnu occupe `h` d'avance : son agent (créé sans permission), lui-même validateur, réponse 0.
    function _preempt(bytes32 h) internal returns (address griefer, uint256 griefAgent) {
        griefer = makeAddr("griefer");
        vm.startPrank(griefer);
        griefAgent = identity.register("griefer");
        strict.validationRequest(griefer, griefAgent, "", h);
        strict.validationResponse(h, 0, "", bytes32(0), "tdx-dcap/inference");
        vm.stopPrank();
    }

    /// @dev = VerdictLog.saltedHash(h) dans le bloc courant.
    function _salted(bytes32 h) internal view returns (bytes32) {
        return keccak256(abi.encode(h, blockhash(vm.getBlockNumber() - 1)));
    }

    /// @dev La raison du premier VerdictSkipped(bytes32 indexed, bytes) émis par `emitter`.
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
        // v2.1 ter : la session a servi et payé (10 unités, 10 USDC) ; une session qui n'a rien payé n'a plus de verdict
        // à la fermeture (FAILLE 5)
        SessionPay.Receipt memory r = _receipt(1, keccak256("resp1"));
        sessionPay.settle(r, _sigReceipt(r, signerPk));
    }

    /// @dev Session de `ownerPk` sur l'enclave de l'opérateur, échéance dans un jour.
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

    /// FAILLE 2 (corrigée) : registre ERC-8004 hostile dont le revert coûte ≈ 40 % du gaz reçu à recopier. v2.1 : la
    /// fermeture échouait à TOUS les gaz (dépôt bloqué). v2.1 bis : elle rembourse et trace le verdict sauté (raison
    /// bornée), à chaque gaz essayé.
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

    /// FAILLE 2 : le gaz MINIMAL de la fermeture sous registre hostile est fini et modeste (ce que trouve eth_estimateGas) :
    /// le coût après l'échec du verdict ne dépend plus du revert de l'appelé.
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

    /// FAILLE 2 : la saisie pour équivocation passe aussi sous registre hostile (v2.1 : bloquée à 30 M de gaz).
    function test_F2_returnBombDoesNotBlockEquivocationSlash() public {
        bytes memory call = _equivocationCall(5);
        _installBombRegistry();
        (bool ok,) = address(sessionPay).call{gas: 30_000_000}(call);
        assertTrue(ok, "saisie faite malgre le registre hostile");
        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
    }

    /// FAILLE 2 : la raison de VerdictSkipped est le PRÉFIXE de 132 octets du revert (v2.1 : les 388 octets).
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

    // ---- FAILLE 1 : requestHash occupé d'avance ----

    /// Témoin (passe avant comme après) : sans attaque, le verdict 100 s'écrit sous le requestHash de la session.
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

    /// FAILLE 1 (corrigée) : un inconnu occupe d'avance le requestHash de la session (calculable dès l'ouverture). v2.1 :
    /// VerdictSkipped(« exists »), verdict perdu pour toujours. v2.1 bis : écrit sous le hash salé (RequestHashSalted),
    /// pour l'agent de l'opérateur ; l'entrée de l'attaquant reste sous SON nom de validateur et ne compte pas pour nous.
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

    /// FAILLE 1 + v2 bis : au gaz MINIMAL qui fait réussir la fermeture (ce que choisit eth_estimateGas), sous préemption,
    /// le verdict salé est quand même écrit : la réserve VERDICT_GAS couvre aussi le chemin salé (v2.1 : sauté).
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

    /// FAILLE 1, verdict de FAUTE : l'opérateur occupe d'avance, avec son propre agent, le hash (session, seq) qu'il va
    /// équivoquer. v2.1 : saisie faite, verdict 0 jamais écrit. v2.1 bis : écrit sous le hash salé.
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

    /// FAILLE 1 : un attaquant qui nomme VerdictLog validateur de SON agent sous notre hash n'obtient aucun « 100 » :
    /// VerdictLog ne répond jamais sous un hash qu'il n'a pas demandé ; le verdict va, salé, à l'agent de l'opérateur.
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

    /// LIMITE documentée (inhérente à ERC-8004, passe avant comme après) : le propriétaire d'un agent peut refuser toute
    /// demande pour son agent. L'opérateur qui retire l'approbation de VerdictLog avant de tricher empêche son verdict de
    /// faute dans ERC-8004 ; la saisie et la radiation, elles, ont lieu, et le verdict sauté est tracé avec sa raison.
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

    /// LIMITE documentée : un attaquant qui passe AVANT nous dans le MÊME bloc peut calculer et occuper aussi le hash salé
    /// (tout ce qu'un contrat calcule, un autre contrat du même bloc le calcule). La fermeture passe ; le verdict saute.
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

    // ---- v2.1 ter — FAILLE 5 : un « 100 » pour une session qui n'a rien payé ----

    /// @dev = SessionPay.VerdictNotApplicable (v2.1 ter), redéclaré pour compiler aussi contre la v2.1 bis.
    event VerdictNotApplicable(uint256 indexed sessionId);

    /// @dev SessionPay.getSession(sid).faultVerdictWritten (v2.1 ter : 17e champ, ajouté à la fin), lu en bas niveau pour
    ///      compiler aussi contre la v2.1 bis, où le champ n'existe pas (le test échoue alors ici).
    function _faultVerdictWritten(uint256 sid) internal view returns (bool) {
        (bool ok, bytes memory ret) = address(sessionPay).staticcall(abi.encodeCall(SessionPay.getSession, (sid)));
        assertTrue(ok);
        assertEq(ret.length, 17 * 32, "getSession porte faultVerdictWritten (v2.1 ter)");
        bytes32[17] memory w = abi.decode(ret, (bytes32[17]));
        return w[16] != bytes32(0);
    }

    /// FAILLE 5 (corrigée) : l'opérateur ouvre, depuis un portefeuille à lui, des sessions sur sa propre enclave et les
    /// ferme sans les utiliser. v2.1 bis : dépôt rendu en entier ET un « 100 » ERC-8004 par session, au seul prix du gaz.
    /// v2.1 ter : remboursement intégral, aucune entrée ERC-8004 (VerdictLog n'est même pas appelé), VerdictNotApplicable.
    function test_F5_unpaidSessionsWriteNoVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        uint256 sockPk = 0x50C50C; // un portefeuille de l'opérateur
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

    // ---- v2.1 ter — FAILLE 6 : drapeau partagé entre le « 100 » de la fermeture et le « 0 » de la faute ----

    /// FAILLE 6 (corrigée) : équivocation prouvée APRÈS la fermeture, dont le 100 est déjà écrit. v2.1 bis : la caution
    /// était saisie mais le 0 sautait sans trace (verdictWritten, partagé, déjà vrai). v2.1 ter : le 0 s'écrit, pour
    /// l'agent de l'opérateur, à côté du 100.
    function test_F6_equivocationAfterCloseWritesSlashVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        bytes memory call = _equivocationCall(5); // reçus ancrés pendant la session
        _warpPastClose();
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten, "100 ecrit a la fermeture");

        (bool ok,) = address(sessionPay).call(call); // faute prouvée APRÈS la fermeture
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

    /// FAILLE 6 : un seul verdict de faute par session. Signaler à nouveau la même preuve, puis une autre équivocation de
    /// la même session, ne tente ni n'écrit plus rien (la saisie, recevable, ne prend plus rien).
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
        (bool ok5,) = address(sessionPay).call(eq5); // la même preuve
        (bool ok6,) = address(sessionPay).call(eq6); // une autre équivocation, même session
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

    /// FAILLE 6 : le verdict de faute qui échoue après la fermeture (registre en panne) est tracé, puis retenté par un
    /// nouveau signalement de la même preuve. v2.1 bis : jamais tenté (le drapeau était vrai depuis le 100).
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
        (ok,) = address(sessionPay).call(call); // nouveau signalement : retente le verdict de faute
        assertTrue(ok);
        assertEq(validation.responses(), 2, "le 0, au second signalement");
        assertTrue(_faultVerdictWritten(sessionId));
    }

    /// FAILLE 5, avec une faute : session fermée sans règlement (aucun verdict), puis faute prouvée sur cette session : le
    /// 0 s'écrit (la fermeture sans verdict ne pose aucun drapeau). v2.1 bis : la fermeture écrivait un 100 pour la
    /// session vide, et ce 100 empêchait le 0.
    function test_F5_unpaidClosedSessionStillGetsSlashVerdict() public {
        _installStrictRegistry();
        uint256 agent = _linkAgent(opPk, "operateur");
        sessionId = _openAs(userPk, 5e6, keccak256("open-unpaid")); // les aides visent désormais cette session
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
        blockN = 1001; // littéral : via_ir replie block.number lu après vm.roll dans la même fonction

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

    /// @dev v2.1 bis : requestHash du verdict de faute d'une équivocation de prime (porte l'opérateur).
    function _equivocationHash(bytes32 fp, address op) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(sealedBounty), "equivocation", bountyId, fp, op));
    }

    // ---- FAILLE 2 : return bomb ----

    /// FAILLE 2 (corrigée) : paiement d'une prime (claim → _pay) sous registre hostile. v2.1 : bloqué à 2, 10 et 30 M de gaz.
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

    /// FAILLE 2 : livraison (deliver) d'un paiement réservé, sous registre hostile.
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

    /// FAILLE 2 : saisie pour équivocation de prime, sous registre hostile.
    function test_F2_returnBombDoesNotBlockBountyEquivocationSlash() public {
        bytes memory call = _equivocationCall(keccak256("fp-eqb"), signerPk);
        _installBombRegistry();
        (bool ok,) = address(sealedBounty).call{gas: 30_000_000}(call);
        assertTrue(ok, "saisie faite malgre le registre hostile");
        assertTrue(bond.banned(operator));
    }

    /// FAILLE 2 : réfutation d'une réclamation acceptée, sous registre hostile.
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

    // ---- FAILLE 1 côté prime ----

    /// FAILLE 1 : le requestHash « bounty » est connu dès l'acceptation (ClaimAccepted), avant la livraison : un inconnu
    /// l'occupe entre les deux. v2.1 : verdict 100 sauté. v2.1 bis : écrit sous le hash salé.
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

    /// Le sel ne crée pas de doublon : signaler deux fois la même équivocation n'écrit qu'UN verdict de faute ; le second
    /// appel est refusé par VerdictLog (AlreadyRecorded) et tracé.
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

    // ---- FAILLE 4 : collision entre opérateurs ----

    /// FAILLE 4 (corrigée) : deux opérateurs équivoquent sur la MÊME empreinte. v2.1 : même requestHash, le verdict de
    /// faute du second sautait (« exists »). v2.1 bis : un verdict de faute par opérateur, chacun sous son agent.
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
    /// VerdictLog v2.1 bis : un verdict par requestHash (AlreadyRecorded), hash nul refusé, sel seulement si le hash est
    /// pris, et recordedAs dit sous quel hash le verdict est écrit.
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

    /// FAILLE 3 (corrigée) : l'auteur RETIRE l'image (retireWorkload, effet immédiat). v2.1 : onlyAttested acceptait
    /// encore l'enclave tant que personne n'avait appelé invalidateRetiredWorkload(clé). v2.1 bis : refus immédiat.
    function test_F3_retiredImage_refusedWithoutKillTransaction() public {
        (bool ok,) = _submit(0, "avant");
        assertTrue(ok, "temoin : accepte avant le retrait");
        products.retireWorkload(productId, _workloadId());
        assertFalse(registry.killed(signer), "aucune transaction de kill");
        (bool ok2, bytes memory ret) = _submit(1, "apres retrait de l'image");
        assertFalse(ok2, "refuse des le retrait de l'image");
        assertEq(ret, abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
    }

    /// FAILLE 3 : produit RETIRÉ par son auteur. v2.1 : ses enclaves restaient « attestées » jusqu'à la fin de leur
    /// fenêtre. v2.1 bis : refus immédiat.
    function test_F3_retiredProduct_refused() public {
        products.retire(productId);
        (bool ok, bytes memory ret) = _submit(0, "produit retire");
        assertFalse(ok, "refuse des le retrait du produit");
        assertEq(ret, abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
    }

    /// FAILLE 3 : la lecture EnclaveRegistry.attestedOperator (v2.1 bis), cas par cas.
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

        vm.prank(address(sessionPay)); // un contrat de règlement autorisé qui a prouvé une faute
        bond.slash(operator, address(this), user);
        assertEq(_attestedOperator(signer, productId), address(0), "operateur radie");
    }

    /// Portée voulue (passe avant comme après) : les reçus et réclamations ANCRÉS restent régis par activeOperatorAt (v2,
    /// frein par invalidateRetiredWorkload) ; seul ce qui fait foi MAINTENANT (onlyAttested) suit le retrait sans délai.
    function test_anchoredSettlementSemanticsUnchanged() public {
        products.retireWorkload(productId, _workloadId());
        assertEq(registry.activeOperatorAt(signer, productId, vm.getBlockNumber()), operator);
        registry.invalidateRetiredWorkload(signer);
        assertEq(registry.activeOperatorAt(signer, productId, vm.getBlockNumber()), address(0));
    }
}
