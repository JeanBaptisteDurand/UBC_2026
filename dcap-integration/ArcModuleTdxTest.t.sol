// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {AutomataDcapOnChainAttestationTest} from "./AutomataDcapOnChainAttestationTest.t.sol";
import {V4QuoteVerifier} from "../contracts/verifiers/V4QuoteVerifier.sol";
import {TdxAttestationModule} from "../contracts/archive/attestation/TdxAttestationModule.sol";
import {IAttestationModule} from "../contracts/archive/interfaces/IAttestationModule.sol";

/// @notice Proves that ArcHive's TdxAttestationModule drives Automata's DCAP verifier and correctly
///         parses a real TDX V4 quote on-chain. Inherits Automata's test harness (setUp: PCCS + CRL +
///         attestation contract), adds the TDX collateral, deploys the module and verifies the quote
///         through it.
contract ArcModuleTdxTest is AutomataDcapOnChainAttestationTest {
    function testArcModuleParsesRealTdxQuoteViaAutomata() public {
        bytes memory sampleQuote =
            vm.parseBytes(vm.readFile(string.concat(vm.projectRoot(), "/forge-test/assets/quotes/arc_tdx_v4.hex")));

        vm.startPrank(admin);
        // TDX collateral (identical to Automata's testTDXQuoteV4OnChainAttestation)
        enclaveIdDao.grantRoles(admin, enclaveIdDao.ATTESTER_ROLE());
        qeIdDaoUpsert(4, "/forge-test/assets/0625/qe_td.json");
        fmspcTcbDao.grantRoles(admin, fmspcTcbDao.ATTESTER_ROLE());
        fmspcTcbDaoUpsert("/forge-test/assets/0625/tcbinfov3_00806f050000.json");
        tcbEvalDaoUpsert("/forge-test/assets/0625/tdxtcbeval.json");

        V4QuoteVerifier quoteVerifier = new V4QuoteVerifier(P256_VERIFIER, address(pccsRouter));
        attestation.setQuoteVerifier(address(quoteVerifier));
        pccsRouter.setAuthorized(address(quoteVerifier), true);
        vm.stopPrank();

        // ArcHive's module, wired to Automata's attestation contract
        TdxAttestationModule module = new TdxAttestationModule(address(attestation));
        IAttestationModule.Measurements memory m = module.verify(sampleQuote, "");

        // the real quote passes DCAP verification and the module's parsing is consistent
        assertTrue(m.ok, "DCAP rejected the quote");
        assertEq(m.version, 4, "version");
        assertEq(uint256(m.bodyType), 2, "bodyType TD1.0");
        assertEq(m.reportData.length, 64, "reportData 64 bytes");
        assertEq(m.mrtd.length, 48, "mrtd 48 bytes");
        assertEq(m.rtmr0.length, 48, "rtmr0 48 bytes");
        assertEq(m.rtmr3.length, 48, "rtmr3 48 bytes");
        assertEq(m.mrConfigId.length, 48, "mrConfigId 48 bytes");

        bytes32 workloadId = keccak256(
            abi.encodePacked(m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes)
        );
        emit log_named_uint("tcbStatus", m.tcbStatus);
        emit log_named_bytes32("workloadId (from a real quote)", workloadId);
        emit log_named_bytes("mrtd", m.mrtd);
    }
}
