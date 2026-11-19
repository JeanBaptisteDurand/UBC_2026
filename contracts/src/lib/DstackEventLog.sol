// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Sha384} from "./Sha384.sol";

/// @title DstackEventLog — rejeu on-chain du registre RTMR3 d'une VM dstack (Phala) et empreinte d'IMAGE (v2.1)
/// @notice Chez dstack, RTMR3 ne reçoit que des « événements d'exécution » (event_type 0x08000001), étendus par le
///         système au démarrage puis, éventuellement, par l'application. Certains sont propres à l'INSTANCE de la VM
///         (instance-id, app-id) : RTMR3 change à chaque redémarrage, donc une empreinte qui l'inclut aussi. Ce module
///         rejoue le journal, vérifie (côté appelant) qu'il redonne le RTMR3 signé par Intel, et en lit les deux
///         événements qui décrivent l'IMAGE : compose-hash (le docker-compose lancé) et os-image-hash.
///
///         Formules (sources de dstack, Apache-2.0 : dstack/cc-eventlog/src/runtime_events.rs, `RuntimeEvent::preimage`
///         et `replay_events`, commit fbbc8ee4 du 22/07/2026) ; V1 VÉRIFIÉE hors chaîne en Python puis en Solidity sur
///         le vrai journal de notre enclave Phala (test/vectors/phala-dstack-attest.json, 7/11 : les 10 événements de
///         RTMR3 redonnent le RTMR3 du quote, décalage 48 + 472) :
///           V1 : condensat = SHA384(le32(0x08000001) ‖ ":" ‖ nom ‖ ":" ‖ charge)
///           V2 : condensat = SHA384(JSON canonique RFC 8785 {"name":nom,"payload":hex(charge),"type":134217729})
///           RTMR3 = 0^48 puis, pour chaque événement, RTMR3 = SHA384(RTMR3 ‖ condensat)
///         (V2 vérifiée contre le vecteur des tests de dstack ; aucun journal V2 réel en main au 8/11.)
///
///         ENCODAGE (le paramètre `eventLog` de EnclaveRegistry.registerEnclave) :
///           eventLog = abi.encode(FORMAT_V1, Event[] events), Event = (uint8 version, bytes name, bytes payload)
///         `events` = TOUS les événements de RTMR3 (imr == 3), dans l'ordre du journal ; `name` = les octets UTF-8 de
///         `event` ; `payload` = `event_payload` décodé de l'hexadécimal ; `version` = 1, ou 2 si l'événement porte
///         "version": 2. Un journal d'un autre format (par exemple le JSON brut de dstack) n'est PAS lu par le registre
///         (chemin v2 : empreinte complète), voir isFormatV1.
///
///         QUELS ÉVÉNEMENTS FONT FOI. Le système étend RTMR3 avant de lancer l'application, qui ne démarre qu'après
///         « system-ready » ; l'application peut ensuite étendre RTMR3 à son tour (elle pourrait y écrire un faux
///         « compose-hash »). Seuls les événements situés AVANT le premier « system-ready » sont donc lus ; ceux d'après
///         sont rejoués, jamais interprétés. L'image n'est « connue » que si ce préfixe contient « system-ready » et
///         EXACTEMENT un compose-hash et un os-image-hash de 32 octets. Le découpage d'un événement réel n'est pas
///         falsifiable : le rejeu doit redonner RTMR3, donc chaque préimage est celle du journal réel ; une préimage V1
///         commence par 01 00 00 08, une V2 par « { » ; en V1, un nom sans « : » se découpe d'une seule façon (un
///         découpage différent ne produit qu'un nom méconnaissable, donc une image inconnue, jamais une fausse) ; en V2,
///         le nom s'arrête au premier « " » (les noms à échapper sont refusés).
library DstackEventLog {
    /// @notice Préfixe du format (premier mot de abi.encode(FORMAT_V1, events)).
    bytes32 internal constant FORMAT_V1 = keccak256("archive.dstack.rtmr3-events.v1");
    /// @notice event_type des événements d'exécution de dstack (DSTACK_RUNTIME_EVENT_TYPE), le seul de RTMR3.
    uint32 internal constant DSTACK_EVENT_TYPE = 0x08000001;

    bytes32 private constant N_COMPOSE_HASH = keccak256("compose-hash");
    bytes32 private constant N_OS_IMAGE_HASH = keccak256("os-image-hash");
    bytes32 private constant N_SYSTEM_READY = keccak256("system-ready");

    /// @notice Un événement de RTMR3, tel que le journal de dstack le décrit.
    struct Event {
        uint8 version; // 1 (défaut de dstack) ou 2
        bytes name; // `event`, octets UTF-8 (ex. "compose-hash")
        bytes payload; // `event_payload`, décodé de l'hexadécimal
    }

    /// @notice Résultat du rejeu.
    struct Replay {
        bytes32 rtmr3Hi; // RTMR3 rejoué, octets 0 à 31
        bytes16 rtmr3Lo; // octets 32 à 47
        bool imageKnown; // compose-hash et os-image-hash lus sans ambiguïté avant « system-ready »
        bytes32 composeHash; // 0 si l'image n'est pas connue
        bytes32 osImageHash; // 0 si l'image n'est pas connue
    }

    /// @notice Le journal n'est pas au format FORMAT_V1.
    error EventLogFormat();
    /// @notice Version d'événement autre que 1 ou 2.
    error EventVersionUnsupported(uint256 index);
    /// @notice V2 : nom qu'il faudrait échapper en JSON (« " », « \ » ou caractère de contrôle) : refusé.
    error EventNameUnsupported(uint256 index);

    /// @notice Vrai si `eventLog` est au format FORMAT_V1 (lu en calldata, sans copie).
    function isFormatV1(bytes calldata eventLog) internal pure returns (bool) {
        return eventLog.length >= 64 && bytes32(eventLog[:32]) == FORMAT_V1;
    }

    /// @notice Rejoue RTMR3 à partir du journal et lit l'image. Revert si le format n'est pas FORMAT_V1 (ou si
    ///         l'abi est malformée : revert sans données de abi.decode).
    function replay(bytes memory eventLog) internal pure returns (Replay memory r) {
        if (eventLog.length < 64 || _word(eventLog, 0) != FORMAT_V1) revert EventLogFormat();
        (, Event[] memory evs) = abi.decode(eventLog, (bytes32, Event[]));

        bytes memory k = Sha384.K; // chargée une fois pour tous les hachages
        bytes memory buf = new bytes(112); // tampon d'extension, réutilisé
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

            if (ready) continue; // après « system-ready » : rejoué, jamais interprété
            bytes32 n = keccak256(e.name);
            if (n == N_SYSTEM_READY) {
                ready = true;
            } else if (n == N_COMPOSE_HASH) {
                nCompose++;
                if (e.payload.length == 32) compose = _word(e.payload, 0);
                else nCompose = 2; // charge malformée : image inconnue
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

    /// @notice L'empreinte d'IMAGE d'une VM dstack : sans RTMR3 (propre à l'instance) ni mrConfigId, mais avec le
    ///         compose-hash et l'os-image-hash lus dans RTMR3. Préimage de 272 octets (l'empreinte complète de la v2 en
    ///         a 304 : les deux familles d'identifiants ne se confondent pas dans la liste d'images autorisées).
    ///         mrtd, rtmr0, rtmr1, rtmr2 : 48 octets chacun.
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

    /// @notice Préimage du condensat d'un événement (voir l'en-tête : V1 binaire, V2 JSON canonique).
    function preimage(Event memory e) internal pure returns (bytes memory) {
        return _preimage(e, 0);
    }

    // ---- interne ----

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
            // clés dans l'ordre de RFC 8785 (name < payload < type), sans espace ; hexadécimal en minuscules
            return abi.encodePacked('{"name":"', name, '","payload":"', _hex(e.payload), '","type":134217729}');
        }
        revert EventVersionUnsupported(index);
    }

    /// @dev Hexadécimal en minuscules, sans préfixe (comme hex::encode de Rust).
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
