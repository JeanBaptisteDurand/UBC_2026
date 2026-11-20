// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {MockUSDC3009} from "./mocks/MockUSDC3009.sol";
import {MockIdentityRegistry} from "./mocks/MockERC8004.sol";
import {MockAutomataDcap} from "./mocks/MockAutomataDcap.sol";

import {TdxAttestationModule} from "../src/attestation/TdxAttestationModule.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {IEnclaveRegistry} from "../src/interfaces/IEnclaveRegistry.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";
import {DstackEventLog} from "../src/lib/DstackEventLog.sol";
import {Sha384} from "../src/lib/Sha384.sol";

/// @notice Always returns the same "block hash" (EIP-2935): the one carried by REPORTDATA[32:64] of the real quote.
contract FixedHistory {
    bytes32 private immutable h;

    constructor(bytes32 _h) {
        h = _h;
    }

    fallback() external {
        bytes32 x = h;
        assembly {
            mstore(0, x)
            return(0, 32)
        }
    }
}

/// @notice The REAL quote and the REAL RTMR3 event log of our inference enclave on Phala (dstack), captured on 2026-11-13
///         (test/vectors/phala-dstack-attest.json: a 5,010-byte TDX v4 quote, an event log of 30 events, 10 of them in
///         RTMR3; test/vectors/phala-dstack-eventlog.json). Expected values computed off chain (Python hashlib +
///         cast keccak); the quote is bound (REPORTDATA) to the v2 stack on Arc testnet (deployments.v2.testnet.json), product 1.
abstract contract PhalaVector {
    bytes internal constant QUOTE = hex"040002008100000000000000939a7233f79c4ca9940a0db3957f0607cca1e818c0d9e8b17007c295c31004ec000000000b0105000000000000000000000000007bf063280e94fb051f5dd7b1fc59ce9aac42bb961df8d44b709c9b0ff87a7b4df648657ba6d1189589feab1d5a3c9a9d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000007020000000000007fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173016d26fa8f8b96b5e3398596ff5822ed2db578d2e7a5fb1b15802d3e5a8be504d300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000068102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe964ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec80e945df96ec417b68d574dba18d199a7448d66c3d0e56f073167a9513d2381601f5d614853646d2c49c5d8d58a7daf5e5e4499c111bb7c88a00264443e66a47b373cbe70282064cb982b345ea166fc77d4c8c5830356a274021cf61611151d7beaed08fe658e0739ad9b4fe431c51f7af1677bcef23cf3d3bc951ff7c0cf67f5a99ef0ae4de897083522f83f1d60ec8a6c69b044a7af04f7d2020eda5539131d0100000fa3bf2103dd9a7d0db496dfee1f05704950bdea66f6d84b27ecf44aa51c999e04c0d9bbd1ac35d44e7462a27337f926142a71ecdb99f0533c6340d56a42a2a339e04d3f419f6fefccd570008a9383a56b10805f400827f1f860274c13986219ec834641cc39badf83be6c98dfb021cbfeff7775b3ab1594f5db195b3fc509acb06004a10000005050a0a05ff00020000000000000000000000000000000000000000000000000000000000000000000000000000000015000000000000000700000000000000e5a3a7b5d830c2953b98534c6c59a3a34fdc34e933f7f5898f0a85cf08846bca0000000000000000000000000000000000000000000000000000000000000000dc9e2a7c6f948f17474e34a7fc43ed030f7c1563f1babddf6340c82e0e54a8c500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c3181e37daaa4153e416d13b28484d8abe8ce7b7a41faf7ee280baf0f304f84000000000000000000000000000000000000000000000000000000000000000002b339abb59f34b4d81ffeb53ffef6f7400e5075c00cbd9b69729fbd9a5ef76c08c303350cd9a0906026a43e2ba11742a4b4ef23e617c539dbc7fb57ed6d4dca62000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f0500620e00002d2d2d2d2d424547494e2043455254494649434154452d2d2d2d2d0a4d494945386a4343424a69674177494241674956414b685252415768304973374f6c613841354433364879736641726c4d416f4743437147534d343942414d430a4d484178496a416742674e5642414d4d47556c756447567349464e4857434251513073675547786864475a76636d306751304578476a415942674e5642416f4d0a45556c756447567349454e76636e4276636d4630615739754d5251774567594456515148444174545957353059534244624746795954454c4d416b47413155450a4341774351304578437a414a42674e5642415954416c56544d423458445449324d4445794f5441314e5441314d566f5844544d7a4d4445794f5441314e5441310a4d566f77634445694d434147413155454177775a535735305a5777675530645949464244537942445a584a3061575a70593246305a5445614d426747413155450a43677752535735305a577767513239796347397959585270623234784644415342674e564241634d43314e68626e526849454e7359584a684d517377435159440a5651514944414a445154454c4d416b474131554542684d4356564d775754415442676371686b6a4f5051494242676771686b6a4f50514d4242774e434141546f0a487278654b587841794544784e343576302b7a48676250446a426a6f434c786b37544443306a50374754617a64504478333542364832416830614a7149796e440a34672b4263746e7068346b3353414d5a673057586f3449444454434341776b77487759445652306a42426777466f41556c5739647a62306234656c4153636e550a3944504f4156634c336c5177617759445652306642475177596a42676f46366758495a616148523063484d364c79396863476b7564484a316333526c5a484e6c0a636e5a705932567a4c6d6c75644756734c6d4e766253397a5a3367765932567964476c6d61574e6864476c76626939324e4339775932746a636d772f593245390a6347786864475a76636d306d5a57356a62325270626d63395a4756794d4230474131556444675157424253543746304969413438394565484573627a6a307a310a32662f4f677a414f42674e56485138424166384542414d434273417744415944565230544151482f4241497741444343416a6f4743537147534962345451454e0a41515343416973776767496e4d42344743697147534962345451454e4151454545474c565145444c6e66774975784d41623664657a6c59776767466b42676f710a686b69472b453042445145434d4949425644415142677371686b69472b45304244514543415149424254415142677371686b69472b45304244514543416749420a4254415142677371686b69472b4530424451454341774942416a415142677371686b69472b4530424451454342414942416a415142677371686b69472b4530420a44514543425149424254415242677371686b69472b4530424451454342674943415038774541594c4b6f5a496876684e4151304241676343415141774541594c0a4b6f5a496876684e4151304241676743415149774541594c4b6f5a496876684e4151304241676b43415141774541594c4b6f5a496876684e4151304241676f430a415141774541594c4b6f5a496876684e4151304241677343415141774541594c4b6f5a496876684e4151304241677743415141774541594c4b6f5a496876684e0a4151304241673043415141774541594c4b6f5a496876684e4151304241673443415141774541594c4b6f5a496876684e4151304241673843415141774541594c0a4b6f5a496876684e4151304241684143415141774541594c4b6f5a496876684e4151304241684543415130774877594c4b6f5a496876684e41513042416849450a45415546416749462f7741434141414141414141414141774541594b4b6f5a496876684e4151304241775143414141774641594b4b6f5a496876684e415130420a42415147494b4276414141414d41384743697147534962345451454e4151554b415145774867594b4b6f5a496876684e415130424267515155437844723245370a4b73656b434549476569682b3044424542676f71686b69472b453042445145484d4459774541594c4b6f5a496876684e4151304242774542416638774541594c0a4b6f5a496876684e4151304242774942416638774541594c4b6f5a496876684e4151304242774d4241663877436759494b6f5a497a6a304541774944534141770a525149684149434348435551515532364178732b4e6a6e79324836666668456d2f66473645756a4a684a58595a596a4241694254554835416e5071396e4b74380a7833687a4d397557532b58737877792b556c6941586e4d663030645345513d3d0a2d2d2d2d2d454e442043455254494649434154452d2d2d2d2d0a2d2d2d2d2d424547494e2043455254494649434154452d2d2d2d2d0a4d4949436c6a4343416a32674177494241674956414a567658633239472b487051456e4a3150517a7a674658433935554d416f4743437147534d343942414d430a4d476778476a415942674e5642414d4d45556c756447567349464e48574342536232393049454e424d526f77474159445651514b4442464a626e526c624342440a62334a7762334a6864476c76626a45554d424947413155454277774c553246756447456751327868636d4578437a414a42674e564241674d416b4e424d5173770a435159445651514745774a56557a4165467730784f4441314d6a45784d4455774d5442614677307a4d7a41314d6a45784d4455774d5442614d484178496a41670a42674e5642414d4d47556c756447567349464e4857434251513073675547786864475a76636d306751304578476a415942674e5642416f4d45556c75644756730a49454e76636e4276636d4630615739754d5251774567594456515148444174545957353059534244624746795954454c4d416b474131554543417743513045780a437a414a42674e5642415954416c56544d466b77457759484b6f5a497a6a3043415159494b6f5a497a6a304441516344516741454e53422f377432316c58534f0a3243757a7078773734654a423732457944476757357258437478327456544c7136684b6b367a2b5569525a436e71523770734f766771466553786c6d546c4a6c0a65546d693257597a33714f42757a43427544416642674e5648534d4547444157674251695a517a575770303069664f44744a5653763141624f536347724442530a42674e5648523845537a424a4d45656752614244686b466f64485277637a6f764c324e6c636e52705a6d6c6a5958526c63793530636e567a6447566b633256790a646d6c6a5a584d75615735305a577775593239744c306c756447567355306459556d397664454e424c6d526c636a416442674e5648513445466751556c5739640a7a62306234656c4153636e553944504f4156634c336c517744675944565230504151482f42415144416745474d42494741315564457745422f7751494d4159420a4166384341514177436759494b6f5a497a6a30454177494452774177524149675873566b6930772b6936565947573355462f32327561586530594a446a3155650a6e412b546a44316169356343494359623153416d4435786b66545670766f34556f79695359787244574c6d5552344349394e4b7966504e2b0a2d2d2d2d2d454e442043455254494649434154452d2d2d2d2d0a2d2d2d2d2d424547494e2043455254494649434154452d2d2d2d2d0a4d4949436a7a4343416a53674177494241674955496d554d316c71644e496e7a6737535655723951477a6b6e42717777436759494b6f5a497a6a3045417749770a614445614d4267474131554541777752535735305a5777675530645949464a766233516751304578476a415942674e5642416f4d45556c756447567349454e760a636e4276636d4630615739754d5251774567594456515148444174545957353059534244624746795954454c4d416b47413155454341774351304578437a414a0a42674e5642415954416c56544d423458445445344d4455794d5445774e4455784d466f58445451354d54497a4d54497a4e546b314f566f77614445614d4267470a4131554541777752535735305a5777675530645949464a766233516751304578476a415942674e5642416f4d45556c756447567349454e76636e4276636d46300a615739754d5251774567594456515148444174545957353059534244624746795954454c4d416b47413155454341774351304578437a414a42674e56424159540a416c56544d466b77457759484b6f5a497a6a3043415159494b6f5a497a6a3044415163445167414543366e45774d4449595a4f6a2f69505773437a61454b69370a314f694f534c52466857476a626e42564a66566e6b59347533496a6b4459594c304d784f346d717379596a6c42616c54565978465032734a424b357a6c4b4f420a757a43427544416642674e5648534d4547444157674251695a517a575770303069664f44744a5653763141624f5363477244425342674e5648523845537a424a0a4d45656752614244686b466f64485277637a6f764c324e6c636e52705a6d6c6a5958526c63793530636e567a6447566b63325679646d6c6a5a584d75615735300a5a577775593239744c306c756447567355306459556d397664454e424c6d526c636a416442674e564851344546675155496d554d316c71644e496e7a673753560a55723951477a6b6e4271777744675944565230504151482f42415144416745474d42494741315564457745422f7751494d4159424166384341514577436759490a4b6f5a497a6a3045417749445351417752674968414f572f35516b522b533943695344634e6f6f774c7550524c735747662f59693747535839344267775477670a41694541344a306c72486f4d732b586f356f2f7358364f39515778485241765a55474f6452513763767152586171493d0a2d2d2d2d2d454e442043455254494649434154452d2d2d2d2d0a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    uint256 internal constant O_RTMR3 = 48 + 472; // 48-byte header + offset inside the TD10 body
    uint256 internal constant O_REPORTDATA = 48 + 520;

    bytes internal constant RTMR3 =
        hex"e5e4499c111bb7c88a00264443e66a47b373cbe70282064cb982b345ea166fc77d4c8c5830356a274021cf61611151d7";
    bytes32 internal constant COMPOSE_HASH = 0x6d26fa8f8b96b5e3398596ff5822ed2db578d2e7a5fb1b15802d3e5a8be504d3;
    bytes32 internal constant OS_IMAGE_HASH = 0xe866e987221db357129ebc3f066b6706ef955889ea95e5510acbdf3d3055186b;
    /// @dev The full fingerprint (v2) of this quote = that of enclave 1 in deployments.v2.testnet.json.
    bytes32 internal constant LEGACY_WORKLOAD_ID = 0x9b21399b827e42da3a6753340f938b946bf635d7e96496896dbe9753e67e5d06;
    /// @dev keccak256(mrtd ‖ rtmr0 ‖ rtmr1 ‖ rtmr2 ‖ compose-hash ‖ os-image-hash ‖ xfam ‖ tdAttributes) (cast keccak).
    bytes32 internal constant IMAGE_ID = 0x4e4d0a863c0ebd6b3734254bfa2d54407ba754f5113970dd76ab89941aef5c5b;

    // measurements from the quote body (for imageIdOf)
    bytes internal constant MRTD =
        hex"7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173";
    bytes internal constant RTMR0 =
        hex"68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96";
    bytes internal constant RTMR1 =
        hex"4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec";
    bytes internal constant RTMR2 =
        hex"80e945df96ec417b68d574dba18d199a7448d66c3d0e56f073167a9513d2381601f5d614853646d2c49c5d8d58a7daf5";
    bytes8 internal constant XFAM = 0x0702000000000000;
    bytes8 internal constant TD_ATTRIBUTES = 0x0000001000000000; // DEBUG at 0, SEPT_VE_DISABLE at 1

    // RTMR3 of other event logs of the SAME image (Python: same formula, same events unless stated)
    /// @dev reboot: instance-id = 00112233445566778899aabbccddeeff00112233
    bytes internal constant RTMR3_RESTART =
        hex"8ff9f749151a60b305911588147105b8a5e345d2a47d80fb8142084cdb00886d3f5a9119fd71c322f4dc28db59a05670";
    bytes32 internal constant LEGACY_WORKLOAD_ID_RESTART =
        0x452866536eca653ae8c902592ea912643a07e73a31c094016024175985bcaa9b;
    /// @dev compose-hash = sha256("evil-compose")
    bytes internal constant RTMR3_EVIL_COMPOSE =
        hex"d6ea5857fc74fdd2fa7ec53726e4387a514526b228367f0b3b340ebf8a67177e2ef9252056ed451cb761a99d736e657d";
    /// @dev the 10 real events + a "compose-hash" (payload = the real one, bytes reversed) emitted AFTER system-ready
    bytes internal constant RTMR3_APP_EVENT =
        hex"186d9b917e6fc6fb12d57314fde3c81b071eeae24b37bfee11168b89be1a79b586e69af7ebb8336eba119033de3121d1";
    /// @dev compose-hash = sha256("evil-compose") at boot, then the application emits the REAL compose-hash after
    ///      system-ready (an attempt to pass itself off as the allowed image)
    bytes internal constant RTMR3_EVIL_THEN_APP_GOOD =
        hex"203946d6dfcfdea20651481f479b3a7a34d51902e20de078ce23d6d90e03fcc2ad0f1398eb39ef3756ee86bb3728f7cd";

    // REPORTDATA binding of the real quote: keccak256(abi.encode("ARC-ENCLAVE-v1", 5042002, v2 registry, 1, operator,
    // signer, x25519)) ‖ hash of the anchor block (checked: recomputed rd0 = the quote's)
    uint256 internal constant ARC_TESTNET = 5042002;
    address internal constant V2_REGISTRY = 0x54AeCc6500a1CfB33FD5BFB3008ed7A600Ae7d38;
    address internal constant V2_OPERATOR = 0x344f2d2fA5AeAe78871F0B882245069F887c2e1a;
    address internal constant SIGNER = 0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6;
    bytes32 internal constant X25519 = 0x27a96915bcc18e70e635236893ad21b15e302402816a8e9e507b428d2d44c552;
    bytes32 internal constant RD1 = 0x5a99ef0ae4de897083522f83f1d60ec8a6c69b044a7af04f7d2020eda5539131;
    bytes6 internal constant FMSPC = 0x20a06f000000; // deployments.dcap.testnet.json

    /// @dev The 10 RTMR3 events of the real event log (imr == 3), in order; all in V1.
    function _events() internal pure returns (DstackEventLog.Event[] memory evs) {
        evs = new DstackEventLog.Event[](10);
        evs[0] = DstackEventLog.Event(1, "system-preparing", "");
        evs[1] = DstackEventLog.Event(1, "app-id", hex"d9604a1ae63013a744dff9214780db8090aaac92");
        evs[2] = DstackEventLog.Event(1, "compose-hash", abi.encodePacked(COMPOSE_HASH));
        evs[3] = DstackEventLog.Event(1, "instance-id", hex"5fdc8af94da3b69eb144f50a5bc000eb3fc4994b");
        evs[4] = DstackEventLog.Event(1, "boot-mr-done", "");
        evs[5] = DstackEventLog.Event(1, "mr-kms", hex"9361ef64eaa890652423e94c7622d2a907a3ce74e06f67434bb0f9cb9b23086b");
        evs[6] = DstackEventLog.Event(1, "os-image-hash", abi.encodePacked(OS_IMAGE_HASH));
        evs[7] = DstackEventLog.Event(
            1,
            "key-provider",
            hex"7b226e616d65223a226b6d73222c226964223a223330353933303133303630373261383634386365336430323031303630383261383634386365336430333031303730333432303030346538653332356134373762306266323238303064633932376134366336383633383933386432383366653733643166393032386565616337303238313933663334373031323231393338373566353938623761646463353033653533343731326162343337623431323037373662626163333264646638383937663834346565227d"
        );
        evs[8] = DstackEventLog.Event(1, "storage-fs", "zfs");
        evs[9] = DstackEventLog.Event(1, "system-ready", "");
    }

    function _log(DstackEventLog.Event[] memory evs) internal pure returns (bytes memory) {
        return abi.encode(DstackEventLog.FORMAT_V1, evs);
    }

    function _append(DstackEventLog.Event[] memory evs, DstackEventLog.Event memory e)
        internal
        pure
        returns (DstackEventLog.Event[] memory out)
    {
        out = new DstackEventLog.Event[](evs.length + 1);
        for (uint256 i = 0; i < evs.length; i++) {
            out[i] = evs[i];
        }
        out[evs.length] = e;
    }

    function _slice(bytes memory d, uint256 start, uint256 len) internal pure returns (bytes memory r) {
        r = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            r[i] = d[start + i];
        }
    }

    function _reversed(bytes32 x) internal pure returns (bytes memory r) {
        r = new bytes(32);
        for (uint256 i = 0; i < 32; i++) {
            r[i] = x[31 - i];
        }
    }
}

/// @notice Image fingerprint, end to end on the REAL quote: the output of Automata's DCAP verifier is
///         simulated (Intel's signature check does not run locally; it is proven on Arc testnet,
///         tx 0x142ed00e…) but it carries the REAL quote body, which the REAL TdxAttestationModule parses; the registry
///         is placed at the address of the v2 stack on Arc testnet, on chain 5042002, so that the quote's REAL
///         REPORTDATA binding passes as is. Only the "rebooted" quotes (modified body: RTMR3 of another
///         instance and REPORTDATA of a new key) are fabricated: what the hardware would sign for a 2nd instance.
contract DstackImageRealVectorTest is Test, PhalaVector {
    address internal constant HISTORY_ADDR = 0x0000F90827F1C53a10cb7A02335B175320002935;

    MockUSDC3009 internal usdc;
    MockAutomataDcap internal dcap;
    TdxAttestationModule internal module;
    ProductRegistry internal products;
    OperatorBond internal bond;
    EnclaveRegistry internal registry;

    function setUp() public {
        vm.chainId(ARC_TESTNET);
        vm.roll(71_210_000);
        vm.warp(1_762_540_000);

        usdc = new MockUSDC3009();
        MockIdentityRegistry identity = new MockIdentityRegistry();
        dcap = new MockAutomataDcap();
        module = new TdxAttestationModule(address(dcap));
        products = new ProductRegistry(0); // timelock 0, as on testnet
        bond = new OperatorBond(address(usdc), makeAddr("treasury"), address(this), address(identity));
        // same parameters as the v2 stack on Arc testnet (SEPT_VE_DISABLE required, 170,000 blocks ≈ 24 h)
        EnclaveRegistry impl =
            new EnclaveRegistry(address(module), address(products), address(bond), true, 170_000, 20_000, 508);
        vm.etch(V2_REGISTRY, address(impl).code); // immutables included: the registry "is" at the address bound in the quote
        registry = EnclaveRegistry(V2_REGISTRY);
        address[] memory settlements = new address[](1);
        settlements[0] = address(this);
        bond.initialize(V2_REGISTRY, settlements);

        vm.etch(HISTORY_ADDR, address(new FixedHistory(RD1)).code);

        usdc.mint(V2_OPERATOR, 1000e6);
        vm.startPrank(V2_OPERATOR);
        usdc.approve(address(bond), 100e6);
        bond.bondFrom(100e6);
        vm.stopPrank();

        dcap.setOutput(QUOTE, _dcapOutput(QUOTE));
    }

    // ---- helpers ----

    /// @dev What Automata returns for a verified TDX v4 quote: version (BE), TD10 body type = 2, TCB up to date (0),
    ///      FMSPC, a 584-byte body.
    function _dcapOutput(bytes memory quote) internal pure returns (bytes memory) {
        return abi.encodePacked(uint16(4), uint16(2), uint8(0), FMSPC, _slice(quote, 48, 584));
    }

    /// @dev Product 1 (the one REPORTDATA binds), which allows `id`.
    function _product(bytes32 id) internal {
        bytes32[] memory wl = new bytes32[](1);
        wl[0] = id;
        ProductRegistry.ProposeParams memory q = ProductRegistry.ProposeParams({
            manifestHash: keccak256("sealed-chat-v2"),
            manifestURI: "https://archive.example/manifests/sealed-chat-v2.json",
            workloadIds: wl,
            deterministic: false,
            price: 100,
            bpsOperator: 9500,
            bpsAuthor: 0,
            bpsNetwork: 500,
            minBond: 1e6,
            exposureCap: 0,
            settlement: address(0xdead),
            param: keccak256("openai/gpt-oss-120b"),
            advisoryIds: new string[](0),
            unitTokens: 1,
            outWeight: 1
        });
        assertEq(products.propose(q), 1);
        products.activate(1);
    }

    function _register(bytes memory quote, address signer, bytes32 x, bytes memory eventLog) internal {
        uint256 r = vm.getBlockNumber() - 1;
        vm.prank(V2_OPERATOR);
        registry.registerEnclave(1, quote, r, signer, x, eventLog);
    }

    /// @dev Quote of ANOTHER instance of the same VM: RTMR3 of its event log, REPORTDATA of its new key.
    function _otherInstanceQuote(bytes memory rtmr3, address signer, bytes32 x) internal returns (bytes memory q) {
        q = QUOTE;
        for (uint256 i = 0; i < 48; i++) {
            q[O_RTMR3 + i] = rtmr3[i];
        }
        bytes32 rd0 = keccak256(abi.encode("ARC-ENCLAVE-v1", block.chainid, V2_REGISTRY, uint256(1), V2_OPERATOR, signer, x));
        bytes memory rd = abi.encodePacked(rd0, RD1);
        for (uint256 i = 0; i < 64; i++) {
            q[O_REPORTDATA + i] = rd[i];
        }
        dcap.setOutput(q, _dcapOutput(q));
    }

    function _legacyIdOf(bytes memory quote) internal returns (bytes32) {
        IAttestationModule.Measurements memory m = module.verify(quote, "");
        return keccak256(
            abi.encodePacked(m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes)
        );
    }

    // ---- the real vector ----

    /// a) The formula: the 10 real RTMR3 events, replayed on chain (SHA-384 in EVM), give back the RTMR3 signed
    ///    in the quote. Measures the gas of the replay.
    function test_realVector_replayGivesQuoteRtmr3() public {
        bytes memory log = _log(_events());

        uint256 g = gasleft();
        DstackEventLog.Replay memory rr = DstackEventLog.replay(log);
        uint256 libGas = g - gasleft();
        assertEq(abi.encodePacked(rr.rtmr3Hi, rr.rtmr3Lo), _slice(QUOTE, O_RTMR3, 48), "the quote's RTMR3");

        g = gasleft();
        (bytes memory r3, bool known, bytes32 compose, bytes32 os) = registry.replayEventLog(log);
        uint256 callGas = g - gasleft();
        assertEq(r3, RTMR3);
        assertTrue(known);
        assertEq(compose, COMPOSE_HASH);
        assertEq(os, OS_IMAGE_HASH);
        // dstack writes 0x01 ‖ compose-hash into MRCONFIGID: consistent with the replayed event
        assertEq(_slice(QUOTE, 48 + 184, 33), abi.encodePacked(bytes1(0x01), COMPOSE_HASH));

        emit log_named_uint("RTMR3 replay, 10 real events (library), gas", libGas);
        emit log_named_uint("RTMR3 replay, 10 real events (replayEventLog, external call), gas", callGas);
        emit log_named_uint("event log encoded in FORMAT_V1, bytes", log.length);
    }

    /// The identifiers: the full fingerprint of the real quote, recomputed by the real module, is that of the deployed
    /// v2 stack; the image fingerprint computed on chain is the one computed off chain.
    function test_realVector_ids() public {
        assertEq(_legacyIdOf(QUOTE), LEGACY_WORKLOAD_ID, "full fingerprint = deployments.v2.testnet.json");
        assertEq(
            registry.imageIdOf(MRTD, RTMR0, RTMR1, RTMR2, COMPOSE_HASH, OS_IMAGE_HASH, XFAM, TD_ATTRIBUTES), IMAGE_ID
        );
        IAttestationModule.Measurements memory m = module.verify(QUOTE, "");
        assertEq(m.mrtd, MRTD);
        assertEq(m.rtmr0, RTMR0);
        assertEq(m.rtmr1, RTMR1);
        assertEq(m.rtmr2, RTMR2);
        assertEq(m.rtmr3, RTMR3);
        assertEq(m.xfam, XFAM);
        assertEq(m.tdAttributes, TD_ATTRIBUTES);
    }

    /// b) The real quote registers on the IMAGE fingerprint (the product allows ONLY the image); gas measured.
    function test_realVector_registersOnImageId() public {
        _product(IMAGE_ID);
        bytes memory log = _log(_events());

        vm.expectEmit(true, true, true, true, V2_REGISTRY);
        emit IEnclaveRegistry.EnclaveImage(SIGNER, 1, IMAGE_ID, COMPOSE_HASH, OS_IMAGE_HASH);
        uint256 g = gasleft();
        _register(QUOTE, SIGNER, X25519, log);
        uint256 used = g - gasleft();

        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(SIGNER);
        assertEq(e.workloadId, IMAGE_ID, "admitted on the image fingerprint");
        assertEq(e.operator, V2_OPERATOR);
        assertTrue(e.active);
        assertEq(e.fmspc, FMSPC);
        assertTrue(registry.isActiveAt(SIGNER, 1, vm.getBlockNumber()));
        emit log_named_uint("registerEnclave, real quote + event log (simulated DCAP), gas", used);
    }

    /// Gas reference: the same quote through the v2 path (no event log, full fingerprint).
    function test_realVector_registersOnLegacyId_withoutLog() public {
        _product(LEGACY_WORKLOAD_ID);
        uint256 g = gasleft();
        _register(QUOTE, SIGNER, X25519, "");
        uint256 used = g - gasleft();
        assertEq(registry.enclaveOf(SIGNER).workloadId, LEGACY_WORKLOAD_ID);
        emit log_named_uint("registerEnclave, real quote without event log (simulated DCAP), gas", used);
    }

    /// THE TARGET CASE: the VM reboots (new instance-id, hence a new RTMR3; a new ephemeral key). Same image:
    /// accepted on the same image fingerprint, without the author allowing anything new.
    function test_restart_sameImageNewInstance_accepted() public {
        _product(IMAGE_ID);
        _register(QUOTE, SIGNER, X25519, _log(_events()));

        DstackEventLog.Event[] memory evs = _events();
        evs[3].payload = hex"00112233445566778899aabbccddeeff00112233"; // instance-id of the new instance
        address signer2 = vm.addr(0xBEEF);
        bytes32 x2 = keccak256("x25519-instance-2");
        bytes memory q2 = _otherInstanceQuote(RTMR3_RESTART, signer2, x2);
        assertEq(_legacyIdOf(q2), LEGACY_WORKLOAD_ID_RESTART, "the full fingerprint changed (RTMR3)");

        vm.roll(vm.getBlockNumber() + 100);
        _register(q2, signer2, x2, _log(evs));
        assertEq(registry.enclaveOf(signer2).workloadId, IMAGE_ID, "same image, another instance: accepted");
        assertTrue(registry.isActiveAt(signer2, 1, vm.getBlockNumber()));
    }

    /// What v2.1 fixes: with the full fingerprint alone (v2), the rebooted instance is refused.
    function test_restart_legacyIdOnly_refused() public {
        _product(LEGACY_WORKLOAD_ID);
        _register(QUOTE, SIGNER, X25519, _log(_events())); // image not allowed: admitted on the full fingerprint
        assertEq(registry.enclaveOf(SIGNER).workloadId, LEGACY_WORKLOAD_ID);

        DstackEventLog.Event[] memory evs = _events();
        evs[3].payload = hex"00112233445566778899aabbccddeeff00112233";
        address signer2 = vm.addr(0xBEEF);
        bytes32 x2 = keccak256("x25519-instance-2");
        bytes memory q2 = _otherInstanceQuote(RTMR3_RESTART, signer2, x2);
        vm.roll(vm.getBlockNumber() + 100);
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory log2 = _log(evs);
        vm.prank(V2_OPERATOR);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(1, q2, r, signer2, x2, log2);
    }

    /// ANOTHER application (another compose) on the same dstack image: another image fingerprint, refused.
    function test_otherCompose_refused() public {
        _product(IMAGE_ID);
        DstackEventLog.Event[] memory evs = _events();
        evs[2].payload = abi.encodePacked(sha256("evil-compose"));
        address s = vm.addr(0xE111);
        bytes32 x = keccak256("x-evil");
        bytes memory q = _otherInstanceQuote(RTMR3_EVIL_COMPOSE, s, x);
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory log = _log(evs);
        vm.prank(V2_OPERATOR);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(1, q, r, s, x, log);
    }

    /// The application started by a malicious compose emits, AFTER system-ready, the allowed compose-hash: ignored
    /// (only the events from before system-ready count); the image read is the real one, refused.
    function test_appForgedComposeAfterSystemReady_ignored() public {
        _product(IMAGE_ID);
        DstackEventLog.Event[] memory evs = _events();
        evs[2].payload = abi.encodePacked(sha256("evil-compose"));
        evs = _append(evs, DstackEventLog.Event(1, "compose-hash", abi.encodePacked(COMPOSE_HASH)));
        address s = vm.addr(0xE222);
        bytes32 x = keccak256("x-forge");
        bytes memory q = _otherInstanceQuote(RTMR3_EVIL_THEN_APP_GOOD, s, x);
        bytes memory log = _log(evs);
        (bytes memory r3, bool known, bytes32 compose,) = registry.replayEventLog(log);
        assertEq(r3, RTMR3_EVIL_THEN_APP_GOOD, "replay = Python");
        assertTrue(known);
        assertEq(compose, sha256("evil-compose"), "the boot compose, not the application's");

        uint256 r = vm.getBlockNumber() - 1;
        vm.prank(V2_OPERATOR);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(1, q, r, s, x, log);
    }

    /// Application events after system-ready are replayed (RTMR3 must match) but do not change
    /// the image: the real image, with one more application event, stays accepted.
    function test_appEventAfterSystemReady_replayedNotInterpreted() public {
        _product(IMAGE_ID);
        DstackEventLog.Event[] memory evs =
            _append(_events(), DstackEventLog.Event(1, "compose-hash", _reversed(COMPOSE_HASH)));
        address s = vm.addr(0xA333);
        bytes32 x = keccak256("x-app");
        bytes memory q = _otherInstanceQuote(RTMR3_APP_EVENT, s, x);
        _register(q, s, x, _log(evs));
        assertEq(registry.enclaveOf(s).workloadId, IMAGE_ID);
    }

    /// An event log that does not give back the quote's RTMR3 (instance-id changed, real quote): refused.
    function test_tamperedLog_reverts() public {
        _product(IMAGE_ID);
        DstackEventLog.Event[] memory evs = _events();
        evs[3].payload = hex"00112233445566778899aabbccddeeff00112233";
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory log = _log(evs);
        vm.prank(V2_OPERATOR);
        vm.expectRevert(EnclaveRegistry.Rtmr3Mismatch.selector);
        registry.registerEnclave(1, QUOTE, r, SIGNER, X25519, log);
    }

    /// v2 compatibility: the RAW event log that the v2 SDK sends (/attest: hex of "0x" + JSON) is not
    /// in FORMAT_V1: ignored as in v2; only the full fingerprint can then admit the enclave.
    function test_rawDstackJsonLog_ignored_imageNotUsed() public {
        _product(IMAGE_ID);
        bytes memory raw = bytes('0x[{"imr":3,"event_type":134217729,"digest":"","event":"system-ready","event_payload":""}]');
        uint256 r = vm.getBlockNumber() - 1;
        vm.prank(V2_OPERATOR);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(1, QUOTE, r, SIGNER, X25519, raw);
    }

    function test_rawDstackJsonLog_ignored_legacyStillWorks() public {
        _product(LEGACY_WORKLOAD_ID);
        _register(QUOTE, SIGNER, X25519, bytes('0x[{"imr":3,"event_type":134217729}]'));
        assertEq(registry.enclaveOf(SIGNER).workloadId, LEGACY_WORKLOAD_ID);
    }
}

/// @notice Replay rules (synthetic event logs, Base's configurable attestation module). The expected RTMR3
///         of a synthetic event log is computed with the same formula as the registry (proven on the real vector
///         above); the V2 vectors come from Python and from dstack's tests.
contract DstackEventLogRulesTest is Base {
    bytes32 constant COMPOSE = keccak256("compose");
    bytes32 constant OS = keccak256("os-image");

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
    }

    // ---- helpers ----

    function _rtmr3(DstackEventLog.Event[] memory evs) internal pure returns (bytes memory) {
        bytes memory k = Sha384.K;
        bytes memory buf = new bytes(112);
        bytes32 hi;
        bytes16 lo;
        for (uint256 i = 0; i < evs.length; i++) {
            (bytes32 dh, bytes16 dl) = Sha384.hash(DstackEventLog.preimage(evs[i]));
            (hi, lo) = Sha384.extend(k, buf, hi, lo, dh, dl);
        }
        return abi.encodePacked(hi, lo);
    }

    function _boot(bytes32 compose, bytes32 os) internal pure returns (DstackEventLog.Event[] memory evs) {
        evs = new DstackEventLog.Event[](5);
        evs[0] = DstackEventLog.Event(1, "app-id", hex"01");
        evs[1] = DstackEventLog.Event(1, "compose-hash", abi.encodePacked(compose));
        evs[2] = DstackEventLog.Event(1, "instance-id", hex"02");
        evs[3] = DstackEventLog.Event(1, "os-image-hash", abi.encodePacked(os));
        evs[4] = DstackEventLog.Event(1, "system-ready", "");
    }

    function _imageId(bytes32 compose, bytes32 os) internal pure returns (bytes32) {
        return DstackEventLog.imageId(
            _b48("mrtd"), _b48("rtmr0"), _b48("rtmr1"), _b48("rtmr2"), compose, os, bytes8(uint64(0x00000000000e0003)), bytes8(0)
        );
    }

    function _productWith(bytes32 id) internal returns (uint256 pid) {
        bytes32[] memory wl = new bytes32[](1);
        wl[0] = id;
        ProductRegistry.ProposeParams memory q = ProductRegistry.ProposeParams({
            manifestHash: keccak256("manifest"),
            manifestURI: "ipfs://manifest",
            workloadIds: wl,
            deterministic: false,
            price: 1e6,
            bpsOperator: 8000,
            bpsAuthor: 1000,
            bpsNetwork: 1000,
            minBond: 100e6,
            exposureCap: 0,
            settlement: address(sessionPay),
            param: bytes32("model"),
            advisoryIds: new string[](0),
            unitTokens: 0,
            outWeight: 0
        });
        pid = products.propose(q);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.activate(pid);
    }

    /// @dev Registers `signerPk_` with Base's measurements, RTMR3 = the event log's (or a forced `rtmr3`).
    function _registerWithLog(uint256 pid, uint256 signerPk_, bytes memory rtmr3, bytes memory log, bytes32 salt)
        internal
        returns (address signer)
    {
        signer = vm.addr(signerPk_);
        bytes32 x = keccak256(abi.encodePacked("x", salt));
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory quote = abi.encodePacked("quote-img", salt);
        IAttestationModule.Measurements memory m = _measurements(pid, operator, signer, x, r, false);
        m.rtmr3 = rtmr3;
        module.setMeasurements(quote, m);
        vm.prank(operator);
        registry.registerEnclave(pid, quote, r, signer, x, log);
    }

    function _log(DstackEventLog.Event[] memory evs) internal pure returns (bytes memory) {
        return abi.encode(DstackEventLog.FORMAT_V1, evs);
    }

    // ---- admission and emergency brake ----

    /// An enclave admitted on the image fingerprint is invalidated without grace when the author retires the IMAGE.
    function test_imageAdmitted_retiringImageKillsEnclave() public {
        bytes32 img = _imageId(COMPOSE, OS);
        uint256 pid = _productWith(img);
        DstackEventLog.Event[] memory evs = _boot(COMPOSE, OS);
        address s = _registerWithLog(pid, signerPk, _rtmr3(evs), _log(evs), "a");
        assertEq(registry.enclaveOf(s).workloadId, img);

        products.retireWorkload(pid, img);
        registry.invalidateRetiredWorkload(s);
        assertTrue(registry.killed(s));
        assertFalse(registry.isActiveAt(s, pid, vm.getBlockNumber()));
    }

    /// Image and full fingerprint both allowed: the image is kept (it is what the brake targets).
    function test_bothAllowed_imagePreferred() public {
        bytes32 img = _imageId(COMPOSE, OS);
        DstackEventLog.Event[] memory evs = _boot(COMPOSE, OS);
        bytes memory r3 = _rtmr3(evs);
        uint256 pid = _productWith(img);
        bytes32 full = keccak256(
            abi.encodePacked(
                _b48("mrtd"), _b48("rtmr0"), _b48("rtmr1"), _b48("rtmr2"), r3, _b48("mrconfig"),
                bytes8(uint64(0x00000000000e0003)), bytes8(0)
            )
        );
        products.proposeWorkload(pid, full);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyWorkload(pid, full);
        address s = _registerWithLog(pid, signerPk, r3, _log(evs), "b");
        assertEq(registry.enclaveOf(s).workloadId, img);
    }

    // ---- which events count ----

    function _expectImageUnknownAndRefused(DstackEventLog.Event[] memory evs, bytes32 salt) internal {
        bytes memory log = _log(evs);
        (bytes memory r3, bool known,,) = registry.replayEventLog(log);
        assertFalse(known, "image inconnue");
        uint256 pid = _productWith(_imageId(COMPOSE, OS));
        address s = vm.addr(signerPk);
        bytes32 x = keccak256(abi.encodePacked("x", salt));
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory quote = abi.encodePacked("quote-unknown", salt);
        IAttestationModule.Measurements memory m = _measurements(pid, operator, s, x, r, false);
        m.rtmr3 = r3;
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(pid, quote, r, s, x, log);
    }

    /// Two compose-hashes before system-ready: ambiguous, unknown image (no admission on the image).
    function test_duplicateComposeBeforeReady_imageUnknown() public {
        DstackEventLog.Event[] memory b = _boot(COMPOSE, OS);
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](6);
        for (uint256 i = 0; i < 4; i++) {
            evs[i] = b[i];
        }
        evs[4] = DstackEventLog.Event(1, "compose-hash", abi.encodePacked(COMPOSE));
        evs[5] = b[4];
        _expectImageUnknownAndRefused(evs, "dup");
    }

    /// Without system-ready, nothing separates the system from the application: unknown image.
    function test_noSystemReady_imageUnknown() public {
        DstackEventLog.Event[] memory b = _boot(COMPOSE, OS);
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](4);
        for (uint256 i = 0; i < 4; i++) {
            evs[i] = b[i];
        }
        _expectImageUnknownAndRefused(evs, "noready");
    }

    /// compose-hash of a size other than 32 bytes: unknown image.
    function test_badComposePayload_imageUnknown() public {
        DstackEventLog.Event[] memory evs = _boot(COMPOSE, OS);
        evs[1].payload = hex"0102";
        _expectImageUnknownAndRefused(evs, "badlen");
    }

    /// A FORMAT_V1 event log that does not give back the quote's RTMR3: Rtmr3Mismatch, even if the full fingerprint would pass.
    function test_rtmr3Mismatch_reverts() public {
        uint256 pid = _productWith(_imageId(COMPOSE, OS));
        DstackEventLog.Event[] memory evs = _boot(COMPOSE, OS);
        bytes memory log = _log(evs);
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x-mm");
        uint256 r = vm.getBlockNumber() - 1;
        bytes memory quote = abi.encodePacked("quote-mm");
        module.setMeasurements(quote, _measurements(pid, operator, s, x, r, false)); // rtmr3 = _b48("rtmr3")
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.Rtmr3Mismatch.selector);
        registry.registerEnclave(pid, quote, r, s, x, log);
    }

    // ---- V2 (JSON canonique) ----

    /// The V2 preimage is the one from dstack's tests (runtime_events.rs, v2_digest_is_canonical_json_hash).
    function test_v2_preimage_matchesDstackTestVector() public pure {
        assertEq(
            DstackEventLog.preimage(DstackEventLog.Event(2, "compose-hash", hex"abcd")),
            bytes('{"name":"compose-hash","payload":"abcd","type":134217729}')
        );
        assertEq(
            DstackEventLog.preimage(DstackEventLog.Event(1, "app-id", hex"deadbeef")),
            abi.encodePacked(hex"01000008", ":app-id:", hex"deadbeef")
        );
    }

    /// Mixed V1/V2 event log (the one in dstack's mixed_v1_v2_replay): RTMR3 = Python.
    function test_v2_mixedReplay_matchesPython() public view {
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](3);
        evs[0] = DstackEventLog.Event(1, "app-id", hex"0102");
        evs[1] = DstackEventLog.Event(2, "compose-hash", hex"0304");
        evs[2] = DstackEventLog.Event(1, "instance-id", hex"0506");
        (bytes memory r3, bool known,,) = registry.replayEventLog(_log(evs));
        assertEq(
            r3,
            hex"79815fb79fc512fffb0f244ad86bd084a3b1d31049aefd2d49c77a07b9f8476eb6b9ae3fcbdc27fee36018ce9a366bb5"
        );
        assertFalse(known);
    }

    /// Boot in V2 (os-image-hash in V1): RTMR3 = Python, image read.
    function test_v2_bootSequence_imageKnown() public view {
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](7);
        evs[0] = DstackEventLog.Event(2, "system-preparing", "");
        evs[1] = DstackEventLog.Event(2, "app-id", hex"d9604a1ae63013a744dff9214780db8090aaac92");
        evs[2] = DstackEventLog.Event(
            2, "compose-hash", hex"6d26fa8f8b96b5e3398596ff5822ed2db578d2e7a5fb1b15802d3e5a8be504d3"
        );
        evs[3] = DstackEventLog.Event(2, "instance-id", hex"5fdc8af94da3b69eb144f50a5bc000eb3fc4994b");
        evs[4] = DstackEventLog.Event(2, "boot-mr-done", "");
        evs[5] = DstackEventLog.Event(
            1, "os-image-hash", hex"e866e987221db357129ebc3f066b6706ef955889ea95e5510acbdf3d3055186b"
        );
        evs[6] = DstackEventLog.Event(2, "system-ready", "");
        (bytes memory r3, bool known, bytes32 compose, bytes32 os) = registry.replayEventLog(_log(evs));
        assertEq(
            r3,
            hex"c2a1aede20a7278b497db065028ae17571d7063430d372b485b6f18fc9ae09eaa638185bfc261050ce5f0e588ea0e186"
        );
        assertTrue(known);
        assertEq(compose, 0x6d26fa8f8b96b5e3398596ff5822ed2db578d2e7a5fb1b15802d3e5a8be504d3);
        assertEq(os, 0xe866e987221db357129ebc3f066b6706ef955889ea95e5510acbdf3d3055186b);
    }

    function test_v2_nameNeedingEscape_reverts() public {
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](2);
        evs[0] = DstackEventLog.Event(1, "ok", "");
        evs[1] = DstackEventLog.Event(2, 'a"b', "");
        vm.expectRevert(abi.encodeWithSelector(DstackEventLog.EventNameUnsupported.selector, 1));
        registry.replayEventLog(_log(evs));
    }

    function test_unknownEventVersion_reverts() public {
        DstackEventLog.Event[] memory evs = new DstackEventLog.Event[](1);
        evs[0] = DstackEventLog.Event(3, "x", "");
        vm.expectRevert(abi.encodeWithSelector(DstackEventLog.EventVersionUnsupported.selector, 0));
        registry.replayEventLog(_log(evs));
    }

    function test_replayEventLog_rejectsOtherFormat() public {
        vm.expectRevert(DstackEventLog.EventLogFormat.selector);
        registry.replayEventLog(bytes('0x[{"imr":3,"event":"system-ready"}]'));
    }
}
