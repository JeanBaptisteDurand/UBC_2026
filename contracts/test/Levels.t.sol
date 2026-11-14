// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {console2} from "forge-std/console2.sol";
import {Base} from "./Base.t.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";
import {IEnclaveRegistry} from "../src/interfaces/IEnclaveRegistry.sol";
import {PckChip} from "../src/levels/PckChip.sol";
import {MachineRegistry} from "../src/levels/MachineRegistry.sol";
import {PolicyEnclaves} from "../src/levels/PolicyEnclaves.sol";
import {ProofOfCloudAuditor} from "../src/levels/ProofOfCloudAuditor.sol";

/// @dev Ed25519Verifier se compile à part (sans via_ir) : déployé depuis son artefact, appelé par cette interface.
interface IEd {
    function weierstrass(uint256 x, uint256 y) external view returns (uint256 wx, uint256 wy);
    function verify(string calldata m, uint256 r, uint256 s, uint256[5] calldata extKpub) external view returns (bool);
}

contract PckChipHarness {
    function chip(bytes calldata q) external pure returns (bytes16 ppid, bytes6 fmspc) {
        return PckChip.chipOf(q);
    }
}

/// @notice Les deux niveaux d'opérateur (10/11/2026) sur des données RÉELLES : le quote d'inscription de notre enclave
///         d'inférence (Phala prod9, TDX v4, certificat « Intel SGX PCK Platform CA ») et le jeton de l'alliance Proof of
///         Cloud obtenu le 10/11 pour ce quote (cosigné par Secret, Nillion et iExec ; test/vectors/proof-of-cloud-token.json).
contract LevelsTest is Base {
    using stdJson for string;

    bytes6 internal constant REAL_FMSPC = 0x20a06f000000;

    MachineRegistry internal machines;
    PolicyEnclaves internal view_;
    ProofOfCloudAuditor internal poc;
    PckChipHarness internal harness;
    IEd internal ed;

    bytes internal realQuote;
    bytes16 internal ppid;
    string internal tokHeader;
    string internal tokPayload;
    bytes internal tokSig;
    uint256 internal tokTs;
    bytes32 internal key;
    uint256 internal kx;
    uint256 internal ky;

    address internal auditorA = makeAddr("auditorA");
    address internal auditorB = makeAddr("auditorB");

    function setUp() public override {
        super.setUp();
        string memory j = vm.readFile("test/vectors/proof-of-cloud-token.json");
        realQuote = j.readBytes(".quote");
        ppid = bytes16(j.readBytes(".machineId"));
        tokHeader = j.readString(".header");
        tokPayload = j.readString(".payload");
        tokSig = j.readBytes(".signature");
        tokTs = j.readUint(".timestamp");
        key = j.readBytes32(".allianceKey");
        kx = j.readUint(".keyX");
        ky = j.readUint(".keyY");

        machines = new MachineRegistry(address(registry), address(products));
        view_ = new PolicyEnclaves(address(registry), address(machines));
        ed = IEd(vm.deployCode("Ed25519Verifier.sol:Ed25519Verifier"));
        poc = new ProofOfCloudAuditor(address(machines), address(ed), key, kx, ky);
        harness = new PckChipHarness();
    }

    // ------------------------------------------------------------------ aides

    function _product() internal returns (uint256 id) {
        id = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 1e6, 10e6, 0);
    }

    /// @dev Inscrit `signerPk` avec un quote donné ; le module simulé rend les mesures (FMSPC au choix).
    function _registerWith(uint256 productId, uint256 operatorPk, uint256 signerPk, bytes memory quote, bytes6 fmspc)
        internal
        returns (address signer)
    {
        address op = vm.addr(operatorPk);
        signer = vm.addr(signerPk);
        bytes32 x25519 = keccak256(abi.encodePacked("x25519", signerPk, quote));
        uint256 r = vm.getBlockNumber() - 1;
        IAttestationModule.Measurements memory m = _measurements(productId, op, signer, x25519, r, false);
        m.fmspc = fmspc;
        module.setMeasurements(quote, m);
        vm.prank(op);
        registry.registerEnclave(productId, quote, r, signer, x25519, "");
    }

    function _setPolicy(uint256 productId, uint8 level, address[] memory auditors) internal {
        machines.proposePolicy(productId, level, auditors);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK);
        machines.applyPolicy(productId);
    }

    function _one(address a) internal pure returns (address[] memory l) {
        l = new address[](1);
        l[0] = a;
    }

    function _mutate(bytes memory b, uint256 at, uint8 v) internal pure returns (bytes memory c) {
        c = bytes.concat(b);
        c[at] = bytes1(v);
    }

    // ------------------------------------------------------------------ 1. la puce lue dans le certificat d'Intel

    function test_chip_realQuote_ppidAndFmspc() public view {
        uint256 g = gasleft();
        (bytes16 p, bytes6 f) = harness.chip(realQuote);
        console2.log("gaz : lecture de la puce dans le quote", g - gasleft());
        assertEq(p, ppid, "PPID du certificat PCK = machine_id de Proof of Cloud");
        assertEq(f, REAL_FMSPC, "FMSPC = celui qu'Automata a lu (20a06f000000)");
    }

    function test_chip_rejectsOtherFormats() public {
        // version 3 (SGX), type de TEE SGX, certification autre que 6 puis 5, quote tronqué
        vm.expectRevert(PckChip.QuoteUnsupported.selector);
        harness.chip(_mutate(realQuote, 0, 3));
        vm.expectRevert(PckChip.QuoteUnsupported.selector);
        harness.chip(_mutate(realQuote, 4, 0x00));
        uint256 auth = 48 + 584 + 4;
        vm.expectRevert(PckChip.QuoteUnsupported.selector);
        harness.chip(_mutate(realQuote, auth + 128, 5));
        bytes memory cut = new bytes(700);
        for (uint256 i = 0; i < 700; i++) cut[i] = realQuote[i];
        vm.expectRevert(PckChip.QuoteFormat.selector);
        harness.chip(cut);
        // taille de certification incohérente (le même contrôle qu'Automata)
        vm.expectRevert(PckChip.QuoteFormat.selector);
        harness.chip(_mutate(realQuote, auth + 130, uint8(realQuote[auth + 130]) ^ 1));
    }

    function test_chip_rejectsMissingPem() public {
        // « -----BEGIN » cassé : plus de certificat lisible
        bytes memory q = bytes.concat(realQuote);
        bytes memory pat = bytes("-----BEGIN CERTIFICATE-----");
        for (uint256 i = 0; i + pat.length <= q.length; i++) {
            bool hit = true;
            for (uint256 k = 0; k < pat.length && hit; k++) {
                if (q[i + k] != pat[k]) hit = false;
            }
            if (hit) {
                q[i + 5] = "X";
                break;
            }
        }
        vm.expectRevert(PckChip.PckFormat.selector);
        harness.chip(q);
    }

    /// @notice DURCISSEMENT (11/11) : un faux PPID ne peut plus être injecté. Le corps Base64 du certificat n'est
    ///         signé par personne, et Base64.decode de solady ne rejette pas les octets hors alphabet (il lit la
    ///         mémoire) ; avant ce correctif, un opérateur pouvait faire lire au contrat le PPID d'une machine de
    ///         datacenter connu (une puce whitelistée par l'alliance) et faire passer une machine ordinaire pour
    ///         « vérifiée ». Vecteurs issus de la revue de sécurité adverse (test/vectors/pck-forged-quotes.json).
    function test_chip_rejectsForgedPpid() public {
        string memory j = vm.readFile("test/vectors/pck-forged-quotes.json");
        // le VRAI quote décode toujours vers le VRAI PPID après durcissement (non-régression)
        (bytes16 p,) = harness.chip(j.readBytes(".genuine"));
        assertEq(p, bytes16(j.readBytes(".genuinePpid")), "le vrai certificat decode toujours vers le vrai PPID");
        // chaque forgerie est refusée : Base64 non canonique, octets ajoutés après le certificat, ou deux OID PPID
        string[3] memory keys = [".forged_validTrailer", ".forged_memByte_0x8c", ".forged_memByte_0x90"];
        for (uint256 i = 0; i < keys.length; i++) {
            bytes memory forged = j.readBytes(keys[i]);
            vm.expectRevert(PckChip.PckFormat.selector);
            harness.chip(forged);
        }
    }

    // ------------------------------------------------------------------ 2. liaison enclave → machine

    function test_bind_realQuote() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        vm.expectEmit(true, true, false, true, address(machines));
        emit MachineRegistry.MachineBound(s, ppid, keccak256(realQuote));
        uint256 g = gasleft();
        bytes16 got = machines.bindMachine(s, realQuote);
        console2.log("gaz : bindMachine (quote reel)", g - gasleft());
        assertEq(got, ppid);
        (bytes16 p, bool current,) = machines.machineOf(s);
        assertEq(p, ppid);
        assertTrue(current);
    }

    function test_bind_refusals() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        _bondOperator(op2Pk, 100e6);
        // clé inconnue
        vm.expectRevert(MachineRegistry.NotActiveEnclave.selector);
        machines.bindMachine(makeAddr("inconnue"), realQuote);
        // un autre quote que celui de l'inscription
        address s = _registerWith(id, opPk, signerPk, abi.encodePacked("synthetique"), bytes6(uint48(0x112233445566)));
        vm.expectRevert(MachineRegistry.NotRegisteredQuote.selector);
        machines.bindMachine(s, realQuote);
        // le bon quote, mais Automata aurait lu un autre FMSPC : refus
        address s2 = _registerWith(id, op2Pk, signer2Pk, realQuote, bytes6(uint48(0x112233445566)));
        vm.expectRevert(MachineRegistry.FmspcMismatch.selector);
        machines.bindMachine(s2, realQuote);
    }

    function test_bind_staleAfterRenewalAndRetire() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        machines.bindMachine(s, realQuote);
        vm.prank(auditorA);
        machines.attestMachine(ppid, uint64(block.timestamp + 30 days), "dc", "rapport");
        assertTrue(machines.isVerified(s, auditorA));
        // renouvellement avec un autre quote (peut-être une autre machine) : la liaison n'est plus à jour
        vm.roll(block.number + 10);
        _registerWith(id, opPk, signerPk, abi.encodePacked("renouvellement"), REAL_FMSPC);
        (, bool current,) = machines.machineOf(s);
        assertFalse(current);
        assertFalse(machines.isVerified(s, auditorA));
    }

    // ------------------------------------------------------------------ 3. déclarations des vérificateurs

    function test_audit_lifecycle() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        machines.bindMachine(s, realQuote);
        assertFalse(machines.isVerified(s, auditorA));
        vm.prank(auditorA);
        machines.attestMachine(ppid, uint64(block.timestamp + 1 days), "OVH Roubaix", "https://exemple/rapport");
        assertTrue(machines.isVerified(s, auditorA));
        assertFalse(machines.isVerified(s, auditorB), unicode"chaque vérificateur ne parle qu'en son nom");
        vm.prank(auditorA);
        machines.revokeMachine(ppid, "retrait");
        assertFalse(machines.isVerified(s, auditorA));
        vm.prank(auditorA);
        machines.attestMachine(ppid, uint64(block.timestamp + 1 days), "OVH Roubaix", "nouvelle visite");
        assertTrue(machines.isVerified(s, auditorA));
        vm.warp(block.timestamp + 1 days + 1);
        assertFalse(machines.isVerified(s, auditorA), unicode"expirée");
        vm.expectRevert(MachineRegistry.BadAudit.selector);
        machines.attestMachine(ppid, uint64(block.timestamp), "", "");
        vm.expectRevert(MachineRegistry.BadAudit.selector);
        machines.attestMachine(bytes16(0), uint64(block.timestamp + 1), "", "");
    }

    // ------------------------------------------------------------------ 4. politique des produits

    function test_policy_authorTimelockAndValidation() public {
        uint256 id = _product();
        vm.prank(auditorA);
        vm.expectRevert(MachineRegistry.NotAuthor.selector);
        machines.proposePolicy(id, 1, _one(auditorA));
        vm.expectRevert(MachineRegistry.BadPolicy.selector);
        machines.proposePolicy(id, 2, _one(auditorA));
        vm.expectRevert(MachineRegistry.BadPolicy.selector);
        machines.proposePolicy(id, 1, new address[](0));
        address[] memory dup = new address[](2);
        dup[0] = auditorA;
        dup[1] = auditorA;
        vm.expectRevert(MachineRegistry.BadPolicy.selector);
        machines.proposePolicy(id, 1, dup);
        vm.expectRevert(MachineRegistry.BadPolicy.selector);
        machines.proposePolicy(id, 1, _one(address(0)));
        vm.expectRevert(MachineRegistry.NoPendingPolicy.selector);
        machines.applyPolicy(id);

        machines.proposePolicy(id, 1, _one(auditorA));
        vm.expectRevert(MachineRegistry.TooEarly.selector);
        machines.applyPolicy(id);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK);
        machines.applyPolicy(id);
        (uint8 lvl, address[] memory a) = machines.policyOf(id);
        assertEq(lvl, 1);
        assertEq(a.length, 1);
        assertEq(a[0], auditorA);
    }

    function test_policy_meetsAndLevel() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        assertTrue(machines.meetsPolicy(id, s), unicode"niveau ouvert par défaut");
        assertEq(machines.levelOf(id, s), 0);
        address[] memory two = new address[](2);
        two[0] = auditorA;
        two[1] = auditorB;
        _setPolicy(id, 1, two);
        assertFalse(machines.meetsPolicy(id, s), unicode"pas encore liée ni déclarée");
        machines.bindMachine(s, realQuote);
        assertFalse(machines.meetsPolicy(id, s), unicode"liée mais non déclarée");
        vm.prank(makeAddr("autre-verificateur"));
        machines.attestMachine(ppid, uint64(block.timestamp + 1 days), "", "");
        assertFalse(machines.meetsPolicy(id, s), unicode"déclarée par un vérificateur que le produit n'accepte pas");
        vm.prank(auditorB);
        machines.attestMachine(ppid, uint64(block.timestamp + 1 days), "dc", "");
        assertTrue(machines.meetsPolicy(id, s));
        assertEq(machines.levelOf(id, s), 1);
        assertEq(machines.verifiedBy(id, s), auditorB);
    }

    // ------------------------------------------------------------------ 5. l'adaptateur des contrats de règlement

    function test_policyEnclaves_appliesPolicyOnlyForVerifiedProducts() public {
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        uint256 n = block.number;
        assertEq(view_.activeOperatorAt(s, id, n), operator, "produit ouvert : comme le registre");
        assertEq(view_.attestedOperator(s, id), registry.attestedOperator(s, id));
        _setPolicy(id, 1, _one(auditorA));
        assertEq(view_.activeOperatorAt(s, id, n), address(0), unicode"produit vérifié, machine non déclarée");
        assertFalse(view_.isActiveAt(s, id, n));
        assertEq(view_.attestedOperator(s, id), address(0));
        machines.bindMachine(s, realQuote);
        vm.prank(auditorA);
        machines.attestMachine(ppid, uint64(block.timestamp + 1 days), "dc", "");
        assertEq(view_.activeOperatorAt(s, id, n), operator);
        assertTrue(view_.isActiveAt(s, id, n));
        assertEq(view_.attestedOperator(s, id), operator);
        // lectures relayées telles quelles ; écritures refusées
        assertEq(view_.enclaveOf(s).quoteHash, keccak256(realQuote));
        assertEq(view_.settleableUntilBlock(s), registry.settleableUntilBlock(s));
        assertEq(address(view_.bond()), address(registry.bond()));
        vm.expectRevert(PolicyEnclaves.UseBaseRegistry.selector);
        view_.retire(s);
    }

    // ------------------------------------------------------------------ Ed25519 (RFC 8032) : vrais et faux

    function test_ed25519_vectors() public view {
        string memory j = vm.readFile("test/vectors/ed25519-vectors.json");
        uint256 count;
        for (uint256 i = 0; i < 64; i++) {
            string memory b = string.concat(".vectors[", vm.toString(i), "]");
            if (!vm.keyExistsJson(j, b)) break;
            uint256[5] memory ext;
            (ext[0], ext[1]) = ed.weierstrass(j.readUint(string.concat(b, ".x")), j.readUint(string.concat(b, ".y")));
            ext[4] = uint256(j.readBytes32(string.concat(b, ".key")));
            bytes memory m = j.readBytes(string.concat(b, ".msg"));
            uint256 r = uint256(j.readBytes32(string.concat(b, ".r")));
            uint256 s_ = uint256(j.readBytes32(string.concat(b, ".s")));
            assertTrue(ed.verify(string(m), r, s_, ext), j.readString(string.concat(b, ".name")));
            // message, R, S ou clé modifiés : refusé
            if (m.length > 0) {
                bytes memory m2 = bytes.concat(m);
                m2[m.length / 2] = bytes1(uint8(m2[m.length / 2]) ^ 0x01);
                assertFalse(ed.verify(string(m2), r, s_, ext));
            } else {
                assertFalse(ed.verify("x", r, s_, ext));
            }
            assertFalse(ed.verify(string(m), r ^ 1, s_, ext));
            assertFalse(ed.verify(string(m), r, s_ ^ (1 << 8), ext));
            uint256[5] memory other = ext;
            other[4] = ext[4] ^ 1;
            assertFalse(ed.verify(string(m), r, s_, other));
            count++;
        }
        assertEq(count, 17);
    }

    function test_ed25519_rejectsMalleableS() public view {
        // s + L (même signature « décalée » de l'ordre du groupe) : refusée (s doit être < L)
        string memory j = vm.readFile("test/vectors/ed25519-vectors.json");
        uint256[5] memory ext;
        (ext[0], ext[1]) = ed.weierstrass(j.readUint(".vectors[1].x"), j.readUint(".vectors[1].y"));
        ext[4] = uint256(j.readBytes32(".vectors[1].key"));
        bytes memory m = j.readBytes(".vectors[1].msg");
        uint256 r = uint256(j.readBytes32(".vectors[1].r"));
        uint256 sLE = uint256(j.readBytes32(".vectors[1].s"));
        uint256 L = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed;
        uint256 sBE = _swap(sLE);
        assertTrue(ed.verify(string(m), r, sLE, ext));
        assertFalse(ed.verify(string(m), r, _swap(sBE + L), ext));
        assertFalse(ed.verify(string(m), r, 0, ext));
    }

    function _swap(uint256 v) internal pure returns (uint256 x) {
        for (uint256 i = 0; i < 32; i++) {
            x = (x << 8) | (v & 0xff);
            v >>= 8;
        }
    }

    // ------------------------------------------------------------------ 6. le vérificateur Proof of Cloud, sur la chaîne

    function test_poc_constructorChecksTheKey() public {
        vm.expectRevert(ProofOfCloudAuditor.BadKey.selector);
        new ProofOfCloudAuditor(address(machines), address(ed), key, kx + 1, ky); // hors de la courbe
        vm.expectRevert(ProofOfCloudAuditor.BadKey.selector);
        new ProofOfCloudAuditor(address(machines), address(ed), bytes32(uint256(key) ^ 1), kx, ky); // autre clé
        vm.expectRevert(ProofOfCloudAuditor.BadKey.selector);
        new ProofOfCloudAuditor(address(machines), address(ed), key, kx, ky + 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed);
    }

    function test_poc_realToken_declaresTheMachine() public {
        vm.warp(tokTs + 60);
        uint256 g = gasleft();
        (bytes16 p, uint64 exp) = poc.submit(tokHeader, tokPayload, tokSig);
        console2.log("gaz : jeton Proof of Cloud verifie sur la chaine (EdDSA)", g - gasleft());
        assertEq(p, ppid, "machine_id du jeton = PPID du certificat Intel");
        assertEq(exp, uint64(tokTs + 7 days));
        (uint64 e, bool revoked) = machines.auditOf(address(poc), ppid);
        assertEq(e, exp);
        assertFalse(revoked);
        assertEq(poc.lastTimestamp(ppid), uint64(tokTs));

        // de bout en bout : produit au niveau vérifié, vérificateur = l'alliance
        uint256 id = _product();
        _bondOperator(opPk, 100e6);
        address s = _registerWith(id, opPk, signerPk, realQuote, REAL_FMSPC);
        _setPolicy(id, 1, _one(address(poc)));
        assertFalse(machines.meetsPolicy(id, s));
        machines.bindMachine(s, realQuote);
        assertTrue(machines.meetsPolicy(id, s));
        assertEq(view_.activeOperatorAt(s, id, block.number), operator);
    }

    function test_poc_rejectsForgeriesAndStaleTokens() public {
        vm.warp(tokTs + 60);
        // contenu modifié d'un caractère : la signature ne tient plus
        bytes memory pl = bytes(tokPayload);
        pl[10] = pl[10] == bytes1("A") ? bytes1("B") : bytes1("A");
        vm.expectRevert(ProofOfCloudAuditor.BadSignature.selector);
        poc.submit(tokHeader, string(pl), tokSig);
        // signature modifiée
        bytes memory sg = bytes.concat(tokSig);
        sg[3] = bytes1(uint8(sg[3]) ^ 1);
        vm.expectRevert(ProofOfCloudAuditor.BadSignature.selector);
        poc.submit(tokHeader, tokPayload, sg);
        bytes memory sg2 = bytes.concat(tokSig);
        sg2[40] = bytes1(uint8(sg2[40]) ^ 1);
        vm.expectRevert(ProofOfCloudAuditor.BadSignature.selector);
        poc.submit(tokHeader, tokPayload, sg2);
        // signature trop courte
        bytes memory short_ = new bytes(63);
        vm.expectRevert(ProofOfCloudAuditor.BadToken.selector);
        poc.submit(tokHeader, tokPayload, short_);
        // en-tête changé (la signature couvre en-tête ET contenu)
        vm.expectRevert(ProofOfCloudAuditor.BadSignature.selector);
        poc.submit(string.concat(tokHeader, "x"), tokPayload, tokSig);
        // une clé d'alliance différente ne valide pas ce jeton
        uint256 snap = vm.snapshotState();
        poc.submit(tokHeader, tokPayload, tokSig); // le vrai passe
        vm.expectRevert(ProofOfCloudAuditor.StaleToken.selector);
        poc.submit(tokHeader, tokPayload, tokSig); // rejeu
        vm.revertToState(snap);
        vm.warp(tokTs + 1 days + 1);
        vm.expectRevert(ProofOfCloudAuditor.StaleToken.selector);
        poc.submit(tokHeader, tokPayload, tokSig); // trop vieux
        vm.warp(tokTs - 10 minutes);
        vm.expectRevert(ProofOfCloudAuditor.StaleToken.selector);
        poc.submit(tokHeader, tokPayload, tokSig); // dans le futur
    }
}
