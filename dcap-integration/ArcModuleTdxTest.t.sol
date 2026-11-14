// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {AutomataDcapOnChainAttestationTest} from "./AutomataDcapOnChainAttestationTest.t.sol";
import {V4QuoteVerifier} from "../contracts/verifiers/V4QuoteVerifier.sol";
import {TdxAttestationModule} from "../contracts/arcvault/attestation/TdxAttestationModule.sol";
import {IAttestationModule} from "../contracts/arcvault/interfaces/IAttestationModule.sol";

/// @notice Preuve que NOTRE TdxAttestationModule pilote le VRAI DCAP d'Automata et découpe
///         correctement un VRAI quote TDX (V4) sur la chaîne. Hérite du harnais d'Automata
///         (setUp : PCCS + CRL + contrat d'attestation), ajoute le collatéral TDX, déploie notre
///         module et vérifie le quote à travers lui.
contract ArcModuleTdxTest is AutomataDcapOnChainAttestationTest {
    function testArcModuleParsesRealTdxQuoteViaAutomata() public {
        bytes memory sampleQuote =
            vm.parseBytes(vm.readFile(string.concat(vm.projectRoot(), "/forge-test/assets/quotes/arc_tdx_v4.hex")));

        vm.startPrank(admin);
        // collatéral TDX (identique au test d'Automata testTDXQuoteV4OnChainAttestation)
        enclaveIdDao.grantRoles(admin, enclaveIdDao.ATTESTER_ROLE());
        qeIdDaoUpsert(4, "/forge-test/assets/0625/qe_td.json");
        fmspcTcbDao.grantRoles(admin, fmspcTcbDao.ATTESTER_ROLE());
        fmspcTcbDaoUpsert("/forge-test/assets/0625/tcbinfov3_00806f050000.json");
        tcbEvalDaoUpsert("/forge-test/assets/0625/tdxtcbeval.json");

        V4QuoteVerifier quoteVerifier = new V4QuoteVerifier(P256_VERIFIER, address(pccsRouter));
        attestation.setQuoteVerifier(address(quoteVerifier));
        pccsRouter.setAuthorized(address(quoteVerifier), true);
        vm.stopPrank();

        // NOTRE module, branché sur le vrai contrat d'attestation d'Automata
        TdxAttestationModule module = new TdxAttestationModule(address(attestation));
        IAttestationModule.Measurements memory m = module.verify(sampleQuote, "");

        // le vrai quote passe la vraie vérification DCAP et notre découpe est cohérente
        assertTrue(m.ok, "DCAP a refuse le quote");
        assertEq(m.version, 4, "version");
        assertEq(uint256(m.bodyType), 2, "bodyType TD1.0");
        assertEq(m.reportData.length, 64, "reportData 64o");
        assertEq(m.mrtd.length, 48, "mrtd 48o");
        assertEq(m.rtmr0.length, 48, "rtmr0 48o");
        assertEq(m.rtmr3.length, 48, "rtmr3 48o");
        assertEq(m.mrConfigId.length, 48, "mrConfigId 48o");

        bytes32 workloadId = keccak256(
            abi.encodePacked(m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes)
        );
        emit log_named_uint("tcbStatus", m.tcbStatus);
        emit log_named_bytes32("workloadId (depuis un vrai quote)", workloadId);
        emit log_named_bytes("mrtd", m.mrtd);
    }
}
