// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Sha384} from "./Sha384.sol";

/// @title DstackEventLog — on-chain replay of the RTMR3 register of a dstack (Phala) VM, and IMAGE fingerprint (v2.1)
/// @notice Under dstack, RTMR3 receives only "runtime events" (event_type 0x08000001), extended by the system at
///         boot and then, possibly, by the application. Some are specific to the VM INSTANCE (instance-id, app-id):
///         RTMR3 changes at every reboot, and so does a fingerprint that includes it. This module replays the event
///         log, checks (on the caller's side) that it reproduces the RTMR3 signed by Intel, and reads from it the two
///         events that describe the IMAGE: compose-hash (the docker-compose launched) and os-image-hash.
///
///         Formulas (dstack sources, Apache-2.0: dstack/cc-eventlog/src/runtime_events.rs, `RuntimeEvent::preimage`
///         and `replay_events`, commit fbbc8ee4); V1 VERIFIED off chain in Python, then in Solidity, on the real event
///         log of our Phala enclave (test/vectors/phala-dstack-attest.json: the 10 RTMR3 events reproduce the quote's
///         RTMR3, offset 48 + 472):
///           V1: digest = SHA384(le32(0x08000001) ‖ ":" ‖ name ‖ ":" ‖ payload)
///           V2: digest = SHA384(RFC 8785 canonical JSON {"name":name,"payload":hex(payload),"type":134217729})
///           RTMR3 = 0^48, then, for each event, RTMR3 = SHA384(RTMR3 ‖ digest)
///         (V2 verified against the vector from dstack's tests; no real V2 event log was available to test against.)
///
///         ENCODING (the `eventLog` parameter of EnclaveRegistry.registerEnclave):
///           eventLog = abi.encode(FORMAT_V1, Event[] events), Event = (uint8 version, bytes name, bytes payload)
///         `events` = ALL the RTMR3 events (imr == 3), in the order of the log; `name` = the UTF-8 bytes of `event`;
///         `payload` = `event_payload` decoded from hexadecimal; `version` = 1, or 2 if the event carries
///         "version": 2. An event log in another format (for example dstack's raw JSON) is NOT read by the registry
///         (the v2 path: full fingerprint), see isFormatV1.
///
///         WHICH EVENTS ARE TRUSTED. The system extends RTMR3 before launching the application, which starts only
///         after "system-ready"; the application can then extend RTMR3 in turn (it could write a false "compose-hash"
///         there). So only the events located BEFORE the first "system-ready" are read; those after it are replayed,
///         never interpreted. The image is "known" only if this prefix contains "system-ready" and EXACTLY one
///         compose-hash and one os-image-hash of 32 bytes. The split of a real event cannot be forged: the replay
///         must reproduce RTMR3, so each preimage is the real log's; a V1 preimage starts with 01 00 00 08,
///         a V2 one with "{"; in V1, a name without ":" splits in only one way (a different split only produces an
///         unrecognizable name, hence an unknown image, never a false one); in V2, the name stops at the first '"'
///         (names that need escaping are refused).
library DstackEventLog {
    /// @notice Prefix of the format (first word of abi.encode(FORMAT_V1, events)).
    bytes32 internal constant FORMAT_V1 = keccak256("archive.dstack.rtmr3-events.v1");
    /// @notice event_type of dstack's runtime events (DSTACK_RUNTIME_EVENT_TYPE), the only one in RTMR3.
    uint32 internal constant DSTACK_EVENT_TYPE = 0x08000001;

    bytes32 private constant N_COMPOSE_HASH = keccak256("compose-hash");
    bytes32 private constant N_OS_IMAGE_HASH = keccak256("os-image-hash");
    bytes32 private constant N_SYSTEM_READY = keccak256("system-ready");

    /// @notice An RTMR3 event, as dstack's event log describes it.
    struct Event {
        uint8 version; // 1 (dstack's default) or 2
        bytes name; // `event`, UTF-8 bytes (e.g. "compose-hash")
        bytes payload; // `event_payload`, decoded from hexadecimal
    }

    /// @notice Result of the replay.
    struct Replay {
        bytes32 rtmr3Hi; // replayed RTMR3, bytes 0 to 31
        bytes16 rtmr3Lo; // bytes 32 to 47
        bool imageKnown; // compose-hash and os-image-hash read unambiguously before "system-ready"
        bytes32 composeHash; // 0 if the image is not known
        bytes32 osImageHash; // 0 if the image is not known
    }

    /// @notice The event log is not in the FORMAT_V1 format.
    error EventLogFormat();
    /// @notice Event version other than 1 or 2.
    error EventVersionUnsupported(uint256 index);
    /// @notice V2: a name that would need escaping in JSON ('"', '\' or a control character): refused.
    error EventNameUnsupported(uint256 index);

    /// @notice True if `eventLog` is in the FORMAT_V1 format (read in calldata, without a copy).
    function isFormatV1(bytes calldata eventLog) internal pure returns (bool) {
        return eventLog.length >= 64 && bytes32(eventLog[:32]) == FORMAT_V1;
    }

    /// @notice Replays RTMR3 from the event log and reads the image. Reverts if the format is not FORMAT_V1 (or if the
    ///         ABI is malformed: abi.decode reverts without data).
    function replay(bytes memory eventLog) internal pure returns (Replay memory r) {
        if (eventLog.length < 64 || _word(eventLog, 0) != FORMAT_V1) revert EventLogFormat();
        (, Event[] memory evs) = abi.decode(eventLog, (bytes32, Event[]));

        bytes memory k = Sha384.K; // loaded once for all the hashes
        bytes memory buf = new bytes(112); // extension buffer, reused
        bool ready;
        uint256 nCompose;
        uint256 nOs;
        bytes32 compose;
        bytes32 os;
        for (uint256 i = 0; i < evs.length; i++) {
            Event memory e = evs[i];
            bytes memory pre = _preimage(e, i);
            uint256 p;
            assembly ("memory-safe") {
                p := add(pre, 0x20)
            }
            (bytes32 dHi, bytes16 dLo) = Sha384.hashAt(k, p, pre.length);
            (r.rtmr3Hi, r.rtmr3Lo) = Sha384.extend(k, buf, r.rtmr3Hi, r.rtmr3Lo, dHi, dLo);

            if (ready) continue; // after "system-ready": replayed, never interpreted
            bytes32 n = keccak256(e.name);
            if (n == N_SYSTEM_READY) {
                ready = true;
            } else if (n == N_COMPOSE_HASH) {
                nCompose++;
                if (e.payload.length == 32) compose = _word(e.payload, 0);
                else nCompose = 2; // malformed payload: unknown image
            } else if (n == N_OS_IMAGE_HASH) {
                nOs++;
                if (e.payload.length == 32) os = _word(e.payload, 0);
                else nOs = 2;
            }
        }
        if (ready && nCompose == 1 && nOs == 1) {
            r.imageKnown = true;
            r.composeHash = compose;
            r.osImageHash = os;
        }
    }

    /// @notice The IMAGE fingerprint of a dstack VM: without RTMR3 (instance-specific) or mrConfigId, but with the
    ///         compose-hash and the os-image-hash read from RTMR3. A 272-byte preimage (the v2 full fingerprint has
    ///         304, so the two families of identifiers never get mixed up in the list of allowed images).
    ///         mrtd, rtmr0, rtmr1, rtmr2: 48 bytes each.
    function imageId(
        bytes memory mrtd,
        bytes memory rtmr0,
        bytes memory rtmr1,
        bytes memory rtmr2,
        bytes32 composeHash,
        bytes32 osImageHash,
        bytes8 xfam,
        bytes8 tdAttributes
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(mrtd, rtmr0, rtmr1, rtmr2, composeHash, osImageHash, xfam, tdAttributes));
    }

    /// @notice Preimage of an event's digest (see the header: V1 binary, V2 canonical JSON).
    function preimage(Event memory e) internal pure returns (bytes memory) {
        return _preimage(e, 0);
    }

    // ---- internal ----

    function _preimage(Event memory e, uint256 index) private pure returns (bytes memory) {
        if (e.version == 1) {
            // le32(0x08000001) = 01 00 00 08
            return abi.encodePacked(bytes4(0x01000008), ":", e.name, ":", e.payload);
        }
        if (e.version == 2) {
            bytes memory name = e.name;
            for (uint256 j = 0; j < name.length; j++) {
                bytes1 c = name[j];
                if (c < 0x20 || c == 0x22 || c == 0x5c) revert EventNameUnsupported(index);
            }
            // keys in RFC 8785 order (name < payload < type), without spaces; lowercase hexadecimal
            return abi.encodePacked('{"name":"', name, '","payload":"', _hex(e.payload), '","type":134217729}');
        }
        revert EventVersionUnsupported(index);
    }

    /// @dev Lowercase hexadecimal, without a prefix (like Rust's hex::encode).
    function _hex(bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(2 * b.length);
        bytes16 digits = "0123456789abcdef";
        for (uint256 i = 0; i < b.length; i++) {
            uint8 v = uint8(b[i]);
            out[2 * i] = digits[v >> 4];
            out[2 * i + 1] = digits[v & 0x0f];
        }
    }

    function _word(bytes memory d, uint256 o) private pure returns (bytes32 x) {
        assembly ("memory-safe") {
            x := mload(add(add(d, 0x20), o))
        }
    }
}
