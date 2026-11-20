/** help.ts — the help text, in English (like every message of the agent). */
import { DEFAULT_API, DEFAULT_PORT, PRODUCT_TDX } from "./constants";
import { VERSION } from "./version";

const API_HELP = `  --api <url>          ArcHive API (default: $ARCHIVE_API, else the one from pairing, else ${DEFAULT_API})`;

export const HELP: Record<string, string> = {
  main: `archive-node ${VERSION}: the ArcHive operator agent

Runs an ArcHive enclave on this machine and links it to your account (your wallet) on the
site. Your private key never leaves your wallet: the machine gets an operator key
(arcop_…) that can't spend anything.

Usage: archive-node <command> [options]

Commands:
  doctor               Checks that the machine is ready (Docker, TDX, clock, network, enclave)
  pair                 Pairs the machine with your wallet using a code (HIVE-XXXX-XXXX)
  up                   Starts the enclave and reports its state to the site every 30 s
  status               Sums up the local state and what the site knows about the machine
  logs                 Shows the enclave logs (-f to follow them)
  service install      Starts the agent at boot (systemd; the launchd equivalent on macOS)
  service uninstall    Removes that service

Options:
  -h, --help           Help (also: archive-node <command> --help)
  -V, --version        Version

Quick start:
  archive-node doctor
  archive-node pair
  archive-node up --product ${PRODUCT_TDX} --tunnel            Intel TDX VM (dstack): serves the network
  archive-node up --demo                                       local trial without TDX (nothing is registered)

Files: ~/.archive/node.json (operator key, mode 0600) · ~/.archive/state.json (last state)
Variables: ARCHIVE_API, ARCHIVE_KEY (operator key, instead of node.json), ARCHIVE_HOME (instead of ~/.archive),
           ARCHIVE_RPC, NO_COLOR, ARCHIVE_DEBUG`,

  doctor: `archive-node doctor: checks that this machine is ready to run an ArcHive enclave.

Usage: archive-node doctor [--json] [--port <n>] [--demo] [--api <url>]

Checks, in order: os, node, docker, tdx_guest, tsm_report, dstack_socket, clock, rpc,
api, port, enclave_health, attest. Each line says what to do if it isn't green.
Detected mode: dstack if /var/run/dstack.sock exists, tdx if /dev/tdx_guest exists, otherwise demo
(in demo mode, the TDX checks are optional and marked ·).

Options:
  --json               JSON output (scripts, copilot)
  --port <n>           Enclave port to check (default: the container's, else ${DEFAULT_PORT})
  --demo               Assess the machine in demo mode (TDX optional)
${API_HELP}

Exit code: 0 when nothing is blocking, 1 otherwise.`,

  pair: `archive-node pair: pairs this machine with your account (your wallet) using a code.

Usage: archive-node pair [--force] [--yes | --operator <address>] [--api <url>]

The machine shows a code (HIVE-XXXX-XXXX) and an address. Open it, enter the code and sign
with your wallet: no transaction, no fee. The machine then gets an operator key arcop_…,
which can't spend anything.

Before keeping it, the machine shows the FULL address of the account that approved the code
and asks "Keep this pairing? [y/N]". Compare it with the one the site shows after your
signature: if it isn't yours, answer n (someone else approved your code); the key is then
revoked and nothing is saved. On "y" (or "yes"), the key is stored in ~/.archive/node.json
(readable by you only). Enter alone, or no answer: that's a no.
Only an answer typed AFTER the question appears counts: anything typed while waiting
is ignored. Without a terminal (pipe, script, cloud-init), the question isn't asked:
--operator or --yes is then required.

Options:
  --force              Pair again even if the machine already is (new key)
  --operator <address> Safe automation: accepts only this account (0x + 40 characters), without
                       asking; any other account is refused and its key revoked
  -y, --yes            Automation: accepts whichever account approves, without asking.
                       Anyone who sees the code before you can then approve it in your place:
                       prefer --operator
${API_HELP}

Examples:
  archive-node pair
  archive-node pair --operator <the full address of YOUR wallet>     (script, cloud-init)`,

  up: `archive-node up: starts the enclave in Docker and reports its state to the site every 30 s
(diagnostics, status, last 100 log lines, public keys, address).

Usage: archive-node up [options]

Options:
  --product <n>        Product served by the enclave (default: ${PRODUCT_TDX}; with --demo, local trial, nothing is registered)
  --port <n>           Enclave port on this machine (default: ${DEFAULT_PORT})
  --image <ref>        Enclave image (default: sealed-chat, pinned by digest)
  --demo               Machine without TDX: simulated attestation, testnet only
  --tunnel             Automatic public https address (cloudflared quick tunnel)
  --public-url <url>   Your own public address for the enclave (takes precedence over --tunnel)
  --key-file <file>    File that holds the operator key arcop_… (alone, mode 600)
                       (default: $ARCHIVE_KEY, else the key from pairing, ~/.archive/node.json)
${API_HELP}

The key is never passed as an argument (--key is refused): it would show in the process
list and in the shell history. Use archive-node pair, --key-file or ARCHIVE_KEY.
Without --tunnel or --public-url, the announced address is http://<machine IP>:<port>.
Without TDX, --demo is required. Ctrl+C stops the enclave and tells the site.
Start at boot: archive-node service install (same options).

Examples:
  archive-node up --product ${PRODUCT_TDX} --tunnel            Intel TDX VM (dstack): serves the network
  archive-node up --demo                                       local trial without TDX (nothing is registered)`,

  status: `archive-node status: the machine's state at a glance.

Usage: archive-node status [--json] [--port <n>] [--api <url>]

Shows the pairing (account, machine, masked key), what the site knows (online, last
heartbeat, registration on Arc), the container, the agent and the diagnostics summary.

Options:
  --json               JSON output
  --port <n>           Enclave port (default: the container's)
${API_HELP}`,

  logs: `archive-node logs: the enclave logs (archive-enclave container).

Usage: archive-node logs [-f] [-n <lines>]

Options:
  -f, --follow         Follow new lines (Ctrl+C to stop)
  -n, --tail <n>       Number of lines from the end (default: 200)`,

  service: `archive-node service: start the agent when the machine boots.

Usage:
  archive-node service install [up options]
  archive-node service uninstall

Linux: writes a systemd unit (/etc/systemd/system/archive-node.service) that runs
"archive-node up" with the same options, as you. Without root, the unit is written to
~/.archive and the three sudo commands to run are shown.
macOS: shows the launchd equivalent (session agent).
The operator key is never written into the service: pair first with archive-node pair,
or pass --key-file <file> (only the file's path appears in the service). The ARCHIVE_KEY
variable isn't copied there.

install options: --product, --port, --image, --demo, --tunnel, --public-url, --key-file, --api
(see archive-node up --help)`,
};
