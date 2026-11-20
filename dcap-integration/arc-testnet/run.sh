#!/usr/bin/env bash
# Automata's DCAP stack on Arc: Intel collateral, deployment, real verification of a TDX quote, and the ArcHive
# module. See README.md (same folder).
#
#   ./run.sh fetch [--tcb-eval N]  Intel collateral for the enclave's quote (ENCLAVE_URL) -> collateral/
#   ./run.sh install               copies the forge script and the collateral into Automata's tree (vendor/)
#   ./run.sh plan                  dry run on a fork of Arc (nothing is sent) -> transaction plan
#   ./run.sh send                  sends the plan, one tx at a time (send_plan.py) -> results/txs.jsonl
#   ./run.sh deploy                install + plan + send + record
#   ./run.sh verify                eth_call + a real verifyAndAttestOnChain(quote) tx -> results/verify.json
#   ./run.sh module                compiles TdxAttestationModule (contracts/src, unchanged), deploys it, eth_call verify
#   ./run.sh measure               real gas: precompile 0x100 against Solidity P-256 (Daimo) + altered quotes (free)
#   ./run.sh record                writes deployments.dcap.<network>.json at the repository root
#   ./run.sh refresh               fetch + install + plan(refresh) + send + record (new TCB info, CRL…)
#   ./run.sh add-eval N            new TCB evaluation number: versioned DAOs N + collateral N
#
# Network: NETWORK=testnet (default, 5042002) or NETWORK=mainnet (5042, see README).
# Key: KEY_FILE (default .secrets/deployer.json, field privateKey); never printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
EVM="$ROOT/vendor/automata-dcap-attestation/evm"
export PATH="$HOME/.aztec/current/bin:$PATH"

NETWORK="${NETWORK:-testnet}"
if [ "$NETWORK" = "mainnet" ]; then
  RPC_URL="${RPC_URL:-https://rpc.mainnet.arc.io}"; CHAIN_ID=5042; EXPLORER="${EXPLORER:-}"   # mainnet explorer URL: set EXPLORER
else
  RPC_URL="${RPC_URL:-https://rpc.testnet.arc.io}"; CHAIN_ID=5042002; EXPLORER="${EXPLORER:-https://explorer.testnet.arc.io}"
fi
export RPC_URL
KEY_FILE="${KEY_FILE:-$ROOT/.secrets/deployer.json}"
ENCLAVE_URL="${ENCLAVE_URL:-https://4b6ccac7b634b7319f796d547b5cbb109f86b670-8802.dstack-pha1-prod9.phala.network/pubkeys}"
COLL="${COLL:-$HERE/collateral}"
RES="$HERE/results"
DEPLOYMENTS="${DEPLOYMENTS:-$ROOT/deployments.dcap.$NETWORK.json}"
SALT_TAG="${SALT_TAG:-archive-dcap-arc-v1}"
PRIORITY_GAS_PRICE="${PRIORITY_GAS_PRICE:-1gwei}"
MAX_USDC="${MAX_USDC:-15}"
ASSETS_REL="forge-test/assets/arc-$NETWORK"
SCRIPT="forge-script/arc/ArcTestnetDcap.s.sol:ArcTestnetDcap"
PLAN_DIR="$EVM/broadcast/ArcTestnetDcap.s.sol/$CHAIN_ID/dry-run"
TOPIC_ATTESTATION="$(cast keccak 'AttestationSubmitted(bool,uint8,bytes)')"
mkdir -p "$RES"

owner() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["address"])' "$KEY_FILE" 2>/dev/null \
  || cast wallet address --private-key "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["privateKey"])' "$KEY_FILE")"; }
pk() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["privateKey"])' "$KEY_FILE"; }
OWNER="${OWNER:-$(owner)}"; export OWNER
check_chain() { [ "$(cast chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || { echo "wrong chain"; exit 1; }; }
attestation() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["AutomataDcapAttestationFee"])' "$DEPLOYMENTS"; }

cmd_fetch() { python3 -I "$HERE/fetch_collateral.py" --enclave-url "$ENCLAVE_URL" --out "$COLL" "$@"; }

cmd_install() {
  mkdir -p "$EVM/forge-script/arc" "$EVM/$ASSETS_REL"
  cp "$HERE/ArcTestnetDcap.s.sol" "$EVM/forge-script/arc/ArcTestnetDcap.s.sol"
  cp "$COLL"/*.der "$COLL"/*.json "$COLL"/quote.hex "$EVM/$ASSETS_REL/"
  echo "installed: forge-script/arc/ArcTestnetDcap.s.sol + $ASSETS_REL/"
}

# plan <sig>: local run on a fork of Arc; nothing is sent (no --broadcast).
cmd_plan() {
  local sig="${1:-deploy()}" ev
  check_chain
  ev="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["tcbEvaluationDataNumber"])' "$COLL/manifest.json")"
  ev="${TCB_EVAL:-$ev}"
  rm -f "$PLAN_DIR/${sig%%\(*}-latest.json"   # never resend an old plan by mistake
  ( cd "$EVM" && COLLATERAL_DIR="$ASSETS_REL" SALT_TAG="$SALT_TAG" TCB_EVAL="$ev" \
      forge script "$SCRIPT" --sig "$sig" --rpc-url "$RPC_URL" --skip-simulation -vv \
        --compute-units-per-second "${FORGE_CUPS:-30}" ${FORGE_EXTRA:-} )   # Arc's public RPC rate-limits requests (HTTP 429)
}

# send <sig> [label]: sends the latest plan of <sig>
cmd_send() {
  local sig="${1:-deploy()}" label="${2:-deploy}"
  local name="${sig%%\(*}"
  local plan="$PLAN_DIR/${name}-latest.json"
  if [ ! -f "$plan" ]; then echo "empty plan: nothing to send (everything is already up to date on-chain)"; return 0; fi
  cp "$plan" "$RES/plan-${label}.json"
  python3 -I "$HERE/send_plan.py" --plan "$plan" --log "$RES/txs.jsonl" --rpc-url "$RPC_URL" \
    --key-file "$KEY_FILE" --chain-id "$CHAIN_ID" --priority-gas-price "$PRIORITY_GAS_PRICE" \
    --max-usdc "$MAX_USDC" --label "$label"
}

cmd_record() {
  python3 -I "$HERE/dcap_tool.py" record out="$DEPLOYMENTS" plan="$RES/plan-deploy.json" txlog="$RES/txs.jsonl" \
    collateral="$COLL" results="$RES" network="Arc $NETWORK" chain_id="$CHAIN_ID" rpc="$RPC_URL" \
    explorer="$EXPLORER" owner="$OWNER" date="$(date -u +%Y-%m-%d)" salt_tag="$SALT_TAG" \
    dcap_commit="$(git -C "$ROOT/vendor/automata-dcap-attestation" rev-parse --short HEAD 2>/dev/null || echo '?')" \
    pccs_commit="$(git -C "$EVM/lib/automata-on-chain-pccs" rev-parse --short HEAD 2>/dev/null || echo '?')"
}

cmd_verify() {
  check_chain
  local att quote; att="$(attestation)"; quote="$(cat "$COLL/quote.hex")"
  echo "AutomataDcapAttestationFee: $att"
  # 1) eth_call: read the output
  cast call "$att" "verifyAndAttestOnChain(bytes)(bool,bytes)" "$quote" --rpc-url "$RPC_URL" > "$RES/verify-call.txt"
  local ok out; ok="$(sed -n 1p "$RES/verify-call.txt")"; out="$(sed -n 2p "$RES/verify-call.txt")"
  echo "eth_call : success = $ok"
  [ "$ok" = "true" ] || { echo "reason: $(cast --to-ascii "$out")"; exit 1; }
  local est; est="$(cast estimate "$att" "verifyAndAttestOnChain(bytes)" "$quote" --rpc-url "$RPC_URL")"
  echo "eth_estimateGas : $est"
  # 2) the real transaction
  local h; h="$(cast send "$att" "verifyAndAttestOnChain(bytes)" "$quote" --private-key "$(pk)" --rpc-url "$RPC_URL" \
                 --priority-gas-price "$PRIORITY_GAS_PRICE" --async)"
  cast receipt "$h" --json --rpc-url "$RPC_URL" > "$RES/verify-receipt.json"
  cp "$COLL/quote.hex" "$RES/verify-quote.hex"   # the exact quote verified (collateral/ may be refreshed later)
  python3 -I - "$RES" "$h" "$out" "$est" "$TOPIC_ATTESTATION" "$HERE/dcap_tool.py" "$att" <<'PY'
import json, sys, importlib.util
res, h, out, est, topic, tool, att = sys.argv[1:8]
spec = importlib.util.spec_from_file_location("dcap_tool", tool); t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
rc = json.load(open(f"{res}/verify-receipt.json"))
ev = t.decode_event(f"{res}/verify-receipt.json", topic)
gas = int(rc["gasUsed"], 16); price = int(rc["effectiveGasPrice"], 16)
r = {"attestation": att, "method": "AutomataDcapAttestationFee.verifyAndAttestOnChain(bytes) — tcbEvaluationDataNumber 0 = standard",
     "ethCallSuccess": True, "estimateGas": int(est),
     "tx": {"hash": h, "block": int(rc["blockNumber"], 16), "status": int(rc["status"], 16), "gasUsed": gas,
            "effectiveGasPriceWei": price, "effectiveGasPriceGwei": price / 1e9, "costUsdc": round(gas * price / 1e18, 8)},
     "event": {"success": ev["success"], "verifierType": ev["verifierType"], "sameOutputAsEthCall": ev["output"] == out} if ev else None,
     "output": t.decode_output(out), "outputHex": out}
json.dump(r, open(f"{res}/verify.json", "w"), indent=2, ensure_ascii=False)
o = r["output"]
print(json.dumps({"tx": r["tx"], "event": r["event"], "tcbStatus": o["tcbStatusName"], "fmspc": o["fmspc"],
                  "advisoryIDs": o["advisoryIDs"], "mrTd": o["mrTd"], "reportDataFirst32": o["reportDataFirst32"]}, indent=2))
PY
}

cmd_module() {
  check_chain
  local att quote build; att="$(attestation)"; quote="$(cat "$COLL/quote.hex")"; build="$HERE/.module-build"
  # unchanged source, the project's settings (contracts/foundry.toml: solc 0.8.28, via-IR, prague); separate output dir
  mkdir -p "$build"
  ( cd "$ROOT/contracts" && forge build src/attestation/TdxAttestationModule.sol \
      --out "$build/out" --cache-path "$build/cache" > "$build/build.log" 2>&1 ) || { cat "$build/build.log"; exit 1; }
  local bytecode args; bytecode="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["bytecode"]["object"])' \
      "$build/out/TdxAttestationModule.sol/TdxAttestationModule.json")"
  args="$(cast abi-encode 'constructor(address)' "$att")"
  local h; h="$(cast send --private-key "$(pk)" --rpc-url "$RPC_URL" --priority-gas-price "$PRIORITY_GAS_PRICE" \
                 --async --create "${bytecode}${args#0x}")"
  cast receipt "$h" --json --rpc-url "$RPC_URL" > "$RES/module-receipt.json"
  local module; module="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["contractAddress"])' "$RES/module-receipt.json")"
  echo "TdxAttestationModule: $module (dcap = $(cast call "$module" 'dcap()(address)' --rpc-url "$RPC_URL"))"
  local sig='verify(bytes,bytes)((bool,uint16,uint16,uint8,bytes6,bytes,bytes,bytes,bytes,bytes,bytes,bytes,bytes8,bytes8,string[]))'
  local raw; raw="$(cast call "$module" 'verify(bytes,bytes)' "$quote" 0x --rpc-url "$RPC_URL")"
  cast decode-abi "$sig" "$raw" --json > "$RES/module-call.json"
  local est; est="$(cast estimate "$module" 'verify(bytes,bytes)' "$quote" 0x --rpc-url "$RPC_URL")"
  python3 -I - "$RES" "$module" "$h" "$est" "$att" <<'PY'
import json, sys
res, module, h, est, att = sys.argv[1:6]
rc = json.load(open(f"{res}/module-receipt.json"))
m = json.load(open(f"{res}/module-call.json"))[0]
v = json.load(open(f"{res}/verify.json"))["output"]
names = ["ok", "version", "bodyType", "tcbStatus", "fmspc", "reportData", "mrtd", "rtmr0", "rtmr1", "rtmr2", "rtmr3",
         "mrConfigId", "xfam", "tdAttributes", "advisories"]
mm = dict(zip(names, m))
checks = {"ok": mm["ok"] is True or mm["ok"] == "true",
          "mrtd == DCAP output": mm["mrtd"].lower() == v["mrTd"].lower(),
          "rtmr0..3 == DCAP output": all(mm[f"rtmr{i}"].lower() == v[f"rtmr{i}"].lower() for i in range(4)),
          "reportData == DCAP output": mm["reportData"].lower() == v["reportData"].lower(),
          "fmspc": mm["fmspc"].lower() == "0x" + v["fmspc"].lower(),
          "tcbStatus": int(mm["tcbStatus"]) == v["tcbStatus"]}
gas = int(rc["gasUsed"], 16); price = int(rc["effectiveGasPrice"], 16)
r = {"address": module, "constructorDcap": att,
     "source": "contracts/src/attestation/TdxAttestationModule.sol (unchanged) — solc 0.8.28 via-IR prague (contracts/foundry.toml)",
     "tx": {"hash": h, "block": int(rc["blockNumber"], 16), "gasUsed": gas, "effectiveGasPriceWei": price,
            "costUsdc": round(gas * price / 1e18, 8)},
     "verifyEthCall": mm, "verifyEstimateGas": int(est), "checks": checks}
json.dump(r, open(f"{res}/module.json", "w"), indent=2, ensure_ascii=False)
print(json.dumps({"address": module, "ok": mm["ok"], "version": mm["version"], "bodyType": mm["bodyType"],
                  "tcbStatus": mm["tcbStatus"], "fmspc": mm["fmspc"], "estimateGas": int(est), "checks": checks}, indent=2))
PY
}

cmd_measure() {
  check_chain
  local v4; v4="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["V4QuoteVerifier"])' "$DEPLOYMENTS")"
  python3 -I "$HERE/dcap_tool.py" measure rpc="$RPC_URL" att="$(attestation)" v4="$v4" quote_file="$COLL/quote.hex" \
    artifact="$EVM/out/V4QuoteVerifier.sol/V4QuoteVerifier.json" out="$RES/measure.json" from="$OWNER"
}

cmd_refresh() {
  cmd_fetch
  cmd_install
  eval "$(python3 -I "$HERE/dcap_tool.py" env "$DEPLOYMENTS")"
  cmd_plan "refresh()"
  cmd_send "refresh()" "refresh-$(date -u +%Y%m%dT%H%M)"
  cmd_record
}

cmd_add_eval() {
  local n="$1"
  COLL="$HERE/collateral-eval$n"; ASSETS_REL="forge-test/assets/arc-$NETWORK-eval$n"
  cmd_fetch --tcb-eval "$n"
  cmd_install
  eval "$(python3 -I "$HERE/dcap_tool.py" env "$DEPLOYMENTS")"
  TCB_EVAL="$n" cmd_plan "addTcbEval()"
  cmd_send "addTcbEval()" "add-eval-$n"
  COLL="$HERE/collateral" cmd_record
}

case "${1:-}" in
  fetch) shift; cmd_fetch "$@" ;;
  install) cmd_install ;;
  plan) cmd_plan "deploy()" ;;
  send) cmd_send "deploy()" "deploy" ;;
  deploy) cmd_install; cmd_plan "deploy()"; cmd_send "deploy()" "deploy"; cmd_record ;;
  verify) cmd_verify; cmd_record ;;
  module) cmd_module; cmd_record ;;
  measure) cmd_measure; cmd_record ;;
  record) cmd_record ;;
  refresh) cmd_refresh ;;
  add-eval) cmd_add_eval "${2:?TCB evaluation number}" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
