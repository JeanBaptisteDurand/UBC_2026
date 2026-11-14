// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {DemoVault} from "../src/demo/DemoVault.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";

/// @notice Cible de pause PIÉGÉE (« return bomb ») : `pause()` rend autant d'octets que son gaz le permet.
///         SealedBounty recopie ces octets en mémoire après l'appel, avec le seul 1/64 de gaz qui lui reste.
contract ReturnBombTarget {
    function pause() external view {
        // w mots de 32 o dont l'expansion mémoire (3w + w²/512) tient dans le gaz reçu
        uint256 w = _sqrt(gasleft() * 512) * 9 / 10;
        assembly {
            return(0, mul(w, 32))
        }
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}

/// @title Revue ADVERSE de la pile v2 (7/11/2026) — failles CORRIGÉES (v2 bis)
/// @notice Chaque ancien `test_BUG_v2_*` (qui échouait tant que la faille existait) est devenu un `test_FIXED_v2_*`
///         qui rejoue le MÊME scénario d'attaque et prouve qu'il ne passe plus. Paramètres mainnet de
///         F-economie-mainnet-2026-11-07 §0.2 / §0.3 : inférence à 200 unités de base par unité, Prime scellée au
///         prix 0, caution minimale 100 USDC, pool de démo 60 USDC (palier 5 USDC, singleCap 50, k = 2).
contract AdversarialV2Test is Base {
    bytes32 constant MODEL = keccak256("Qwen2.5-1.5B-Instruct-Q4_K_M");
    bytes32 constant PREDICATE = keccak256("predicate-v0");
    uint256 constant PRICE = 200; // F §0.2 : 0,0002 USDC par unité de 1 000 jetons-équivalent-entrée

    uint256 internal chatId; // produit d'inférence, réglé par SessionPay
    address internal signer; // enclave d'inférence d'`operator`, inscrite au bloc 1000 (fenêtre [1000, 5999])
    address internal sessionKey = makeAddr("sessionKey");

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        chatId = _proposeAndActivate(address(sessionPay), false, MODEL, PRICE, 100e6, 0);
        (signer,) = _registerEnclave(chatId, opPk, signerPk, "chat-a");
    }

    // ------------------------------------------------------------------ aides

    /// @dev Paramètres d'ouverture (l'autorisation EIP-3009 est signée ici, AVANT tout vm.expectRevert).
    function _params(address enclave, uint256 pid, address op, uint64 expiresAt, uint256 deposit, bytes32 nonce)
        internal
        view
        returns (SessionPay.OpenParams memory q)
    {
        UsdcPayer.Auth memory auth = _usdcAuth(userPk, address(sessionPay), deposit, nonce);
        q = SessionPay.OpenParams({
            productId: pid,
            operator: op,
            sessionKey: sessionKey,
            expiresAt: expiresAt,
            deposit: deposit,
            cap: 0,
            auth: auth,
            enclave: enclave
        });
    }

    /// @dev Session liée à l'enclave `signer` d'`operator`.
    function _open(uint256 pid, address op, uint64 expiresAt, uint256 deposit, bytes32 nonce)
        internal
        returns (uint256 id)
    {
        SessionPay.OpenParams memory q = _params(signer, pid, op, expiresAt, deposit, nonce);
        vm.prank(user);
        id = sessionPay.openSession(q);
    }

    function _rcpt(uint256 pid, uint256 sid, uint64 seq, bytes32 resp, uint128 cum, uint64 anchor)
        internal
        pure
        returns (SessionPay.Receipt memory r)
    {
        r = SessionPay.Receipt({
            productId: pid,
            sessionId: sid,
            seq: seq,
            modelHash: MODEL,
            paramsHash: keccak256("{}"),
            requestHash: keccak256(abi.encodePacked("req", seq)),
            responseHash: resp,
            tokensIn: 40_000,
            tokensOut: 2_000,
            cumulativeUnits: cum,
            anchorBlock: anchor
        });
    }

    function _sigRcpt(SessionPay.Receipt memory r, uint256 pk) internal view returns (bytes memory) {
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

    /// @dev Produit « Prime scellée » tel que prévu au lancement mainnet (F §0.2) : prix 0, déterministe.
    function _bountyProduct(uint256 minBond) internal returns (uint256 pid) {
        pid = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 0, minBond, 0);
    }

    /// @dev Prime à palier unique (perte ≥ 10 USDC → `tierAmount`), singleCap 50 USDC, k = 2 (F §0.3, démo).
    function _createBounty(uint256 pid, uint256 tierAmount, uint256 funding, address target, bytes32 nonce)
        internal
        returns (uint256 id)
    {
        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 10e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = tierAmount;
        UsdcPayer.Auth memory auth = _usdcAuth(protocolPk, address(sealedBounty), funding, nonce);
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: pid,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 50e6,
            k: 2,
            targetToPause: target,
            deadline: uint64(vm.getBlockTimestamp() + 3 days),
            funding: funding,
            auth: auth
        });
        vm.prank(protocol);
        id = sealedBounty.createBounty(q);
    }

    function _claim(uint256 bid, uint64 n, bytes32 fp, bytes32 cPHash) internal view returns (SealedBounty.Claim memory r) {
        r = SealedBounty.Claim({
            bountyId: bid,
            payee: hunter,
            blockN: n,
            blockHashN: keccak256(abi.encodePacked(bytes32(uint256(n)))), // = MockHistory
            predicateHash: PREDICATE,
            loss: 20e6,
            tier: 0,
            fingerprint: fp,
            cPHash: cPHash,
            deadline: uint64(vm.getBlockTimestamp() + 10 minutes)
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

    function _one(bytes memory sig) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](1);
        sigs[0] = sig;
    }

    function _x25519Of(bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("x25519", salt));
    }

    /// @dev (Ré)inscription d'une clé d'enclave existante avec un nouveau quote (ancre `r`).
    function _reRegister(uint256 pid, uint256 opPk_, uint256 signerPk_, bytes32 salt, bytes memory quote, uint256 r)
        internal
    {
        address op = vm.addr(opPk_);
        address s = vm.addr(signerPk_);
        module.setMeasurements(quote, _measurements(pid, op, s, _x25519Of(salt), r, false));
        vm.prank(op);
        registry.registerEnclave(pid, quote, r, s, _x25519Of(salt), "");
    }

    function _sigRefutation(SealedBounty.Refutation memory f, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(sealedBounty.REFUTATION_TYPEHASH(), f.claimDigest, f.proven, f.loss, f.tier));
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    // ============================================================ SessionPay / enclave d'inférence

    /// CRITIQUE (corrigée) — SessionPay n'ouvre plus de session sur un produit qui n'est pas le sien ni au prix 0 : la
    /// Prime scellée de F §0.2 (réglée par SealedBounty, prix 0) et un produit « gratuit » proposé par n'importe qui
    /// sont refusés ; une session désigne une enclave active du produit chez son opérateur (côté enclave, voir
    /// enclave/test/adversarial-v2.test.ts : refus 403 d'une session d'un autre produit ou d'un autre opérateur).
    function test_FIXED_v2_noFreeInferenceThroughForeignOrFreeProduct() public {
        uint64 exp = uint64(vm.getBlockTimestamp() + 1 days);
        uint256 bountyProduct = _bountyProduct(100e6);
        SessionPay.OpenParams memory q = _params(signer, bountyProduct, operator, exp, 1, keccak256("foreign"));
        vm.prank(user);
        vm.expectRevert(SessionPay.ZeroPrice.selector); // produit de la Prime scellée au prix 0
        sessionPay.openSession(q);

        uint256 free = _proposeAndActivate(address(sessionPay), false, MODEL, 0, 100e6, 0); // « gratuit », sans permission
        q = _params(signer, free, operator, exp, 1, keccak256("free"));
        vm.prank(user);
        vm.expectRevert(SessionPay.ZeroPrice.selector);
        sessionPay.openSession(q);

        uint256 viaX402 = _proposeAndActivate(address(x402), false, MODEL, PRICE, 100e6, 0);
        q = _params(signer, viaX402, operator, exp, 1, keccak256("x402"));
        vm.prank(user);
        vm.expectRevert(SessionPay.WrongSettlement.selector);
        sessionPay.openSession(q);

        // le bon produit, mais un « opérateur » quelconque (variante de la revue) : refusé, aucun reçu impayable
        q = _params(signer, chatId, makeAddr("adresse-quelconque"), exp, 10e6, keccak256("stranger"));
        vm.prank(user);
        vm.expectRevert(SessionPay.WrongOperator.selector);
        sessionPay.openSession(q);
    }

    /// HAUTE (corrigée) — plus de session ouverte « déjà échue » : l'échéance est d'au moins 10 min ; la propriétaire ne
    /// peut plus fermer avant l'échéance + 1 h (sauf enclave disparue) ; l'opérateur règle avant.
    function test_FIXED_v2_sessionCannotBeClosedBeforeOperatorCanSettle() public {
        uint64 past = uint64(vm.getBlockTimestamp() - 2 hours);
        SessionPay.OpenParams memory q = _params(signer, chatId, operator, past, 10e6, keccak256("past"));
        vm.prank(user);
        vm.expectRevert(SessionPay.BadExpiry.selector);
        sessionPay.openSession(q);

        uint256 sid = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 10 minutes), 10e6, keccak256("short"));
        SessionPay.Receipt memory r = _rcpt(chatId, sid, 1, keccak256("resp"), 48_000, uint64(vm.getBlockNumber()));
        bytes memory sig = _sigRcpt(r, signerPk);
        vm.prank(user);
        vm.expectRevert(SessionPay.NotExpired.selector); // même bloc que le service : refusé
        sessionPay.closeSession(sid);

        uint256 opBefore = usdc.balanceOf(operator);
        sessionPay.settle(r, sig);
        assertEq(usdc.balanceOf(operator) - opBefore, 48_000 * PRICE * 8000 / 10_000, "le service est paye (80 %)");
    }

    /// HAUTE (corrigée) — une session est liée à UNE enclave : le reçu d'une 2e enclave du même opérateur est refusé
    /// (WrongEnclave) et l'enclave B refuse de servir une session liée à A (côté enclave). Plus de service gratuit :
    /// chaque session se règle en entier sur les reçus de SA enclave.
    function test_FIXED_v2_sessionBoundToOneEnclave() public {
        (address signerB,) = _registerEnclave(chatId, opPk, signer2Pk, "chat-b"); // 2e enclave d'`operator`
        uint256 sidA = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 1 days), 10e6, keccak256("two-a"));
        SessionPay.OpenParams memory qb =
            _params(signerB, chatId, operator, uint64(vm.getBlockTimestamp() + 1 days), 10e6, keccak256("two-b"));
        vm.prank(user);
        uint256 sidB = sessionPay.openSession(qb);

        uint64 anchor = uint64(vm.getBlockNumber());
        SessionPay.Receipt memory a = _rcpt(chatId, sidA, 1, keccak256("respA"), 1000, anchor); // enclave A
        SessionPay.Receipt memory bOnA = _rcpt(chatId, sidA, 1, keccak256("respB"), 1000, anchor); // B sur la session A
        SessionPay.Receipt memory b = _rcpt(chatId, sidB, 1, keccak256("respB"), 1000, anchor); // B sur SA session
        bytes memory sigA = _sigRcpt(a, signerPk);
        bytes memory sigBOnA = _sigRcpt(bOnA, signer2Pk);
        bytes memory sigB = _sigRcpt(b, signer2Pk);

        vm.expectRevert(SessionPay.WrongEnclave.selector);
        sessionPay.settle(bOnA, sigBOnA);
        sessionPay.settle(a, sigA);
        sessionPay.settle(b, sigB);
        assertEq(sessionPay.getSession(sidA).paid + sessionPay.getSession(sidB).paid, 2000 * PRICE, "2 000 servies, 2 000 payees");
    }

    /// MOYENNE (corrigée) — le modèle est verrouillé à l'ouverture : un reçu émis avant le changement de modèle reste
    /// réglable.
    function test_FIXED_v2_paramUpdateKeepsOpenSessionsSettleable() public {
        uint256 sid = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 30 days), 10e6, keccak256("param"));
        SessionPay.Receipt memory r = _rcpt(chatId, sid, 1, keccak256("resp"), 1000, uint64(vm.getBlockNumber()));
        bytes memory sig = _sigRcpt(r, signerPk); // émis AVANT le changement de modèle

        products.proposeUpdate(chatId, keccak256("manifest-v2"), PRICE, keccak256("Qwen3-8B"));
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(chatId);

        (bool ok,) = address(sessionPay).call(abi.encodeCall(SessionPay.settle, (r, sig)));
        assertTrue(ok, "recu emis avant le changement de modele : reglable");
        assertEq(sessionPay.getSession(sid).param, MODEL);
    }

    /// MOYENNE (corrigée) — une image ajoutée passe par le timelock, et une session ouverte reste liée à SON enclave :
    /// une image « 1 jeton = 1 unité » ne refacture jamais une session ouverte avant.
    function test_FIXED_v2_addWorkloadTimelockedAndSessionUnitLocked() public {
        uint256 sid = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 30 days), 10e6, keccak256("unit"));
        assertEq(sessionPay.getSession(sid).unitTokens, 1); // unité verrouillée (produit de test : 0 → 1)

        uint256 newSignerPk = 0x7171;
        address newSigner = vm.addr(newSignerPk);
        bytes32 x = _x25519Of("unit-1");
        IAttestationModule.Measurements memory m = _measurements(chatId, operator, newSigner, x, 999, false);
        m.rtmr3 = _b48("rtmr3 UNIT_TOKENS=1"); // autre compose : autre unité
        bytes32 w2 = keccak256(
            abi.encodePacked(m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes)
        );
        products.proposeWorkload(chatId, w2); // plus d'effet immédiat
        bytes memory q = abi.encodePacked("quote-unit-1");
        module.setMeasurements(q, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(chatId, q, 999, newSigner, x, ""); // même bloc : refusé

        // même après le timelock, l'enclave de la nouvelle image ne règle pas la session ouverte avant
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyWorkload(chatId, w2);
        vm.roll(1001);
        bytes memory q2 = abi.encodePacked("quote-unit-2");
        IAttestationModule.Measurements memory m2 = _measurements(chatId, operator, newSigner, x, 1000, false);
        m2.rtmr3 = _b48("rtmr3 UNIT_TOKENS=1");
        module.setMeasurements(q2, m2);
        vm.prank(operator);
        registry.registerEnclave(chatId, q2, 1000, newSigner, x, "");

        SessionPay.Receipt memory r = _rcpt(chatId, sid, 1, keccak256("resp"), 48_000, uint64(vm.getBlockNumber()));
        bytes memory sigNew = _sigRcpt(r, newSignerPk);
        vm.expectRevert(SessionPay.WrongEnclave.selector);
        sessionPay.settle(r, sigNew);

        SessionPay.Receipt memory fair = _rcpt(chatId, sid, 1, keccak256("resp"), 48, uint64(vm.getBlockNumber()));
        sessionPay.settle(fair, _sigRcpt(fair, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 48 * PRICE, "0,0096 USDC au prix verrouille, pas 9,6");
    }

    /// MOYENNE (corrigée) — une clé est liée à vie à son (opérateur, produit) : la déplacer est refusé, la preuve
    /// d'équivocation reste recevable et saisit la caution.
    function test_FIXED_v2_equivocationCannotBeEvadedByMovingKey() public {
        uint256 sid = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 1 days), 10e6, keccak256("eq"));
        uint64 anchor = uint64(vm.getBlockNumber());
        SessionPay.Receipt memory a = _rcpt(chatId, sid, 1, keccak256("respA"), 10, anchor);
        SessionPay.Receipt memory b = _rcpt(chatId, sid, 1, keccak256("respB"), 10, anchor);
        bytes memory sigA = _sigRcpt(a, signerPk);
        bytes memory sigB = _sigRcpt(b, signerPk);

        uint256 other = _proposeAndActivate(address(sessionPay), false, keccak256("other-model"), 1, 100e6, 0);
        bytes memory quote = abi.encodePacked("quote-move");
        module.setMeasurements(quote, _measurements(other, operator, signer, _x25519Of("chat-a"), 999, false));
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.SignerBoundElsewhere.selector);
        registry.registerEnclave(other, quote, 999, signer, _x25519Of("chat-a"), "");

        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator), "l'operateur fautif perd sa caution");
        assertEq(bond.bondOf(operator), 0);
    }

    // ============================================================ Caution (OperatorBond)

    /// MOYENNE (corrigée) — « ½ caution par 24 h » est GLISSANTE et GLOBALE : ½ caution juste avant une limite de
    /// fenêtre, puis ½ juste après, est refusé ; répartir sur un autre produit aussi.
    function test_FIXED_v2_exposureWindowSlidesAndIsGlobal() public {
        _bondWithSelfAsSettlement(); // ce contrat de test joue un contrat de règlement
        _bondOperator(opPk, 1000e6);
        uint256 t0 = vm.getBlockTimestamp();
        bond.consumeExposure(operator, chatId, 1, 0); // ouvre la fenêtre à t0
        vm.warp(t0 + 24 hours - 1);
        bond.consumeExposure(operator, chatId, 500e6 - 1, 0); // ½ caution atteinte
        vm.warp(t0 + 24 hours); // UNE seconde plus tard
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, chatId, 500e6, 0);
        vm.expectRevert(OperatorBond.TooMuchExposure.selector); // un autre produit ne rouvre pas de budget
        bond.consumeExposure(operator, chatId + 1, 500e6, 0);
    }

    /// HAUTE (corrigée) — une fausse réclamation (enclave forgée, une seule signature) est payée, mais elle se RÉFUTE :
    /// deux enclaves d'opérateurs distincts rejouent l'exploit, ne le prouvent pas, et signent la réfutation ; la
    /// caution du tricheur est saisie (50 % au dénonciateur, 50 % au protocole). Sans réfutation, la caution reste
    /// bloquée 7 jours après l'exposition (la fenêtre de réfutation, 3 jours, tient dedans).
    function test_FIXED_v2_forgedClaimRefutedAndCheaterSlashed() public {
        uint256 op3Pk = 0xC0C;
        address op3 = vm.addr(op3Pk);
        usdc.mint(op3, 100e6);
        _bondOperator(op3Pk, 100e6); // caution minimale mainnet (F §0.2)
        uint256 pid = _bountyProduct(100e6);
        _registerEnclave(pid, op3Pk, 0x6363, "forged"); // la clé est au tricheur
        _registerEnclave(pid, opPk, 0x6161, "honest-1"); // deux enclaves honnêtes d'opérateurs distincts
        _bondOperator(op2Pk, 1000e6);
        _registerEnclave(pid, op2Pk, 0x6262, "honest-2");
        uint256 bid = _createBounty(pid, 50e6, 100e6, address(0), keccak256("pilot")); // palier 50 = ½ caution
        vm.roll(1002);

        bytes memory cP = bytes("aucun exploit");
        SealedBounty.Claim memory r = _claim(bid, 1001, keccak256("faux"), keccak256(cP));
        uint256 hunterBefore = usdc.balanceOf(hunter);
        sealedBounty.claim(r, _one(_sigClaim(r, 0x6363)), cP);
        assertEq(usdc.balanceOf(hunter) - hunterBefore, 50e6, "fausse reclamation payee (le contrat ne peut le savoir)");

        // le tricheur veut partir : sa caution est réservée à son enclave, puis bloquée 7 jours après l'exposition
        vm.prank(op3);
        vm.expectRevert(OperatorBond.InsufficientBond.selector);
        bond.requestUnbond(100e6);
        vm.prank(op3);
        registry.retire(vm.addr(0x6363));
        vm.prank(op3);
        bond.requestUnbond(100e6);
        vm.warp(vm.getBlockTimestamp() + 3 days);
        vm.prank(op3);
        vm.expectRevert(OperatorBond.UnbondLocked.selector);
        bond.withdraw();

        // le protocole déchiffre cP (rien), fait rejouer par deux enclaves d'autres opérateurs, qui réfutent
        bytes32 digest = sealedBounty.claimDigest(r);
        SealedBounty.Refutation memory f = SealedBounty.Refutation({claimDigest: digest, proven: false, loss: 0, tier: 0});
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sigRefutation(f, 0x6161);
        sigs[1] = _sigRefutation(f, 0x6262);
        address[] memory ops = new address[](1);
        ops[0] = op3;
        uint256 protocolBefore = usdc.balanceOf(protocol);
        vm.prank(protocol);
        sealedBounty.refute(r, ops, f, sigs);

        assertTrue(bond.banned(op3));
        assertEq(bond.bondOf(op3), 0);
        assertEq(usdc.balanceOf(protocol) - protocolBefore, 100e6, "le protocole recupere 100 (denonciateur + victime)");
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 before = usdc.balanceOf(op3);
        vm.prank(op3);
        vm.expectRevert(OperatorBond.NothingToWithdraw.selector);
        bond.withdraw();
        assertEq(usdc.balanceOf(op3) - before, 0, "50 USDC voles, 100 USDC de caution perdus");
    }

    /// HAUTE (corrigée) — la clé de déploiement ne saisit plus rien : câblage une seule fois, puis tout nouveau contrat
    /// de règlement attend 8 jours ; l'opérateur honnête retire sa caution avant.
    function test_FIXED_v2_deployKeyCannotSeizeBonds() public {
        assertEq(bond.owner(), address(this), "proprietaire = ce contrat (multisig en production)");
        address thief = makeAddr("thief");
        address[] memory evil = new address[](1);
        evil[0] = thief;
        vm.expectRevert(OperatorBond.AlreadyInitialized.selector);
        bond.initialize(address(registry), evil);

        bond.proposeSettlement(thief);
        vm.prank(thief);
        vm.expectRevert(OperatorBond.NotSettlement.selector);
        bond.slash(operator, thief, thief); // pas dans le même bloc

        vm.prank(operator);
        registry.retire(signer); // libère la réservation de son enclave
        vm.prank(operator);
        bond.requestUnbond(1000e6);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(operator);
        bond.withdraw();

        vm.warp(vm.getBlockTimestamp() + 1 days);
        bond.applySettlement(thief);
        vm.prank(thief);
        bond.slash(operator, thief, thief);
        assertEq(usdc.balanceOf(operator), 1_000_000e6, "la caution de l'operateur honnete est rentree chez lui");
        assertEq(usdc.balanceOf(thief), 0, "rien a saisir");
    }

    /// PLAUSIBLE (corrigée) — `setAgentId` exige d'être propriétaire (ou approuvé) de l'agent ERC-8004 : un opérateur
    /// fautif ne fait plus inscrire sa saisie sous l'agentId d'un concurrent.
    function test_FIXED_v2_slashVerdictNotWrittenUnderBorrowedAgentId() public {
        vm.prank(operator);
        uint256 agent = identity.register("ipfs://operateur-honnete");
        vm.prank(operator);
        bond.setAgentId(agent);
        _bondOperator(op2Pk, 100e6);
        vm.prank(operator2);
        vm.expectRevert(OperatorBond.NotAgentOwner.selector);
        bond.setAgentId(agent); // aucun emprunt

        _registerEnclave(chatId, op2Pk, 0x5353, "chat-op2");
        SessionPay.OpenParams memory q =
            _params(vm.addr(0x5353), chatId, operator2, uint64(vm.getBlockTimestamp() + 1 days), 10e6, keccak256("agent"));
        vm.prank(user);
        uint256 sid = sessionPay.openSession(q);
        uint64 anchor = uint64(vm.getBlockNumber());
        SessionPay.Receipt memory a = _rcpt(chatId, sid, 1, keccak256("respA"), 10, anchor);
        SessionPay.Receipt memory b = _rcpt(chatId, sid, 1, keccak256("respB"), 10, anchor);
        bytes memory sigA = _sigRcpt(a, 0x5353);
        bytes memory sigB = _sigRcpt(b, 0x5353);

        vm.expectEmit(true, true, false, true, address(verdict));
        // v2.1 : requestHash lié à la chaîne et au contrat (mis à jour avec le changement voulu)
        emit VerdictLog.Recorded(
            0,
            keccak256(abi.encode(block.chainid, address(sessionPay), "equivocation", sid, uint64(1))),
            0,
            "tdx-dcap/slash"
        );
        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.agentIdOf(operator2) != bond.agentIdOf(operator), "saisie d'operator2 hors de l'agent honnete");
    }

    // ============================================================ Registre

    /// HAUTE (corrigée) — retirer une image fautive arrête ses enclaves : invalidate (avec quote) ou
    /// invalidateRetiredWorkload (sans), sans grâce ; un reçu ancré après le retrait — ou même avant — ne se règle plus.
    function test_FIXED_v2_retiredWorkloadStopsItsEnclaves() public {
        uint256 sid = _open(chatId, operator, uint64(vm.getBlockTimestamp() + 1 days), 10e6, keccak256("retired"));
        products.retireWorkload(chatId, _workloadId()); // l'auteur (ce contrat) retire l'image fautive
        assertFalse(products.isWorkloadAllowed(chatId, _workloadId()));

        bytes memory quote = abi.encodePacked("quote", bytes32("chat-a")); // quote d'inscription (Base)
        registry.invalidate(signer, quote); // plus de StillValid : l'image n'est plus autorisée
        assertTrue(registry.killed(signer));

        vm.roll(1500); // 500 blocs après le retrait de l'image
        SessionPay.Receipt memory r = _rcpt(chatId, sid, 1, keccak256("resp"), 1000, 1499);
        bytes memory sig = _sigRcpt(r, signerPk);
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(r, sig);
        assertFalse(registry.isActiveAt(signer, chatId, 1499), "enclave d'une image retiree : inactive");
        assertFalse(registry.isActiveAt(signer, chatId, 1000), "sans grace, meme pour un bloc anterieur");

        vm.prank(user); // la session se ferme sans attendre l'échéance : plus rien n'est réglable
        sessionPay.closeSession(sid);
    }

    // ============================================================ Prime scellée

    /// HAUTE (corrigée) — un même exploit n'est plus payé deux fois : changer la casse (autre empreinte) ne rapporte
    /// rien. Ancré au même bloc : AnchorBeforeLastPayout ; ancré après : TierAlreadyPaid (côté enclave, l'empreinte
    /// est aussi canonique : keccak256 des OCTETS des transactions).
    function test_FIXED_v2_sameExploitNotPaidTwice() public {
        uint256 pid = _bountyProduct(100e6);
        _registerEnclave(pid, opPk, 0x6161, "bounty-a");
        uint256 bid = _createBounty(pid, 5e6, 60e6, address(0), keccak256("demo-pool"));
        vm.roll(1002);

        bytes32 fp1 = keccak256(bytes('["0xa9059cbb"]'));
        bytes32 fp2 = keccak256(bytes('["0xA9059CBB"]')); // mêmes octets de transaction
        bytes memory cP1 = bytes("cP-1");
        bytes memory cP2 = bytes("cP-2");
        SealedBounty.Claim memory r1 = _claim(bid, 1001, fp1, keccak256(cP1));
        SealedBounty.Claim memory r2 = _claim(bid, 1001, fp2, keccak256(cP2));
        bytes[] memory s1 = _one(_sigClaim(r1, 0x6161));
        bytes[] memory s2 = _one(_sigClaim(r2, 0x6161));

        sealedBounty.claim(r1, s1, cP1);
        (bool paidAgain,) = address(sealedBounty).call(abi.encodeCall(SealedBounty.claim, (r2, s2, cP2)));
        assertFalse(paidAgain, "le meme exploit (meme transaction, autre casse) n'est pas paye une 2e fois");

        vm.roll(1010); // rejoué plus tard, ancré après le paiement : même palier, refusé
        SealedBounty.Claim memory r3 = _claim(bid, 1009, keccak256("fp-3"), keccak256(cP2));
        bytes[] memory s3 = _one(_sigClaim(r3, 0x6161));
        vm.expectRevert(SealedBounty.TierAlreadyPaid.selector);
        sealedBounty.claim(r3, s3, cP2);
        assertEq(sealedBounty.getBounty(bid).balance, 60e6 - 5.75e6, "un seul paiement sur le pool de demo");
    }

    /// HAUTE (corrigée) — une cible de pause piégée (« return bomb ») ne bloque plus la réclamation : la pause reçoit un
    /// gaz borné et ses données de retour ne sont pas recopiées. Et cP n'a plus à être dans la transaction qui peut
    /// échouer : acceptClaim (hash seul) puis deliver.
    function test_FIXED_v2_trappedPauseTargetCannotBlockClaim() public {
        uint256 pid = _bountyProduct(100e6);
        _registerEnclave(pid, opPk, 0x6161, "bounty-a");
        ReturnBombTarget trap = new ReturnBombTarget();
        DemoVault honest = new DemoVault(address(usdc));
        uint256 trapped = _createBounty(pid, 5e6, 60e6, address(trap), keccak256("trap"));
        uint256 control = _createBounty(pid, 5e6, 60e6, address(honest), keccak256("control"));
        uint256 trapped2 = _createBounty(pid, 5e6, 60e6, address(trap), keccak256("trap-2"));
        vm.roll(1002);

        bytes memory cP = bytes("exploit chiffre vers le protocole");
        SealedBounty.Claim memory rc = _claim(control, 1001, keccak256("fp-c"), keccak256(cP));
        SealedBounty.Claim memory rt = _claim(trapped, 1001, keccak256("fp-t"), keccak256(cP));
        SealedBounty.Claim memory rt2 = _claim(trapped2, 1001, keccak256("fp-t2"), keccak256(cP));
        bytes[] memory sc = _one(_sigClaim(rc, 0x6161));
        bytes[] memory st = _one(_sigClaim(rt, 0x6161));
        bytes[] memory st2 = _one(_sigClaim(rt2, 0x6161));

        (bool okControl,) =
            address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.claim, (rc, sc, cP)));
        assertTrue(okControl, "controle : une cible honnete, 30 M de gaz : payee");
        assertTrue(honest.paused());

        (bool okTrapped,) =
            address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.claim, (rt, st, cP)));
        assertTrue(okTrapped, "cible de pause piegee : la reclamation passe quand meme");

        // en deux temps : la réservation ne porte que le hash de cP ; la livraison ne touche pas la cible
        (bool okAccept,) =
            address(sealedBounty).call{gas: 30_000_000}(abi.encodeCall(SealedBounty.acceptClaim, (rt2, st2)));
        assertTrue(okAccept, "reservation sans cP, malgre la cible piegee");
        uint256 hunterBefore = usdc.balanceOf(hunter);
        sealedBounty.deliver(trapped2, keccak256("fp-t2"), cP);
        assertEq(usdc.balanceOf(hunter) - hunterBefore, 5e6);
    }
}
