#!/usr/bin/env python3
"""Tools for the DCAP stack on Arc (python3 -I, standard library only).

    dcap_tool.py decode-output <hex>                 decodes Automata's output (verifyAndAttestOnChain)
    dcap_tool.py decode-event <receipt.json>         decodes AttestationSubmitted in the receipt of a real tx
    dcap_tool.py addresses <plan.json>               contract addresses of a forge plan (JSON)
    dcap_tool.py env <deployments.json>              shell exports of the addresses (for refresh/add-eval)
    dcap_tool.py record out=F plan=P txlog=L collateral=DIR results=DIR ...
    dcap_tool.py measure rpc=URL att=ADDR v4=ADDR quote_file=F artifact=V4QuoteVerifier.json out=F from=ADDR
                 real gas on Arc (eth_estimateGas): precompile 0x100 against Solidity P-256 (Daimo, through a
                 state override of the verifier's code) + altered quotes (which must be refused)
"""
import json
import os
import subprocess
import sys

# order of Automata's TCBStatus enum (helpers/FmspcTcbHelper.sol)
TCB_STATUS = ["OK (UpToDate)", "TCB_SW_HARDENING_NEEDED", "TCB_CONFIGURATION_AND_SW_HARDENING_NEEDED",
              "TCB_CONFIGURATION_NEEDED", "TCB_OUT_OF_DATE", "TCB_OUT_OF_DATE_CONFIGURATION_NEEDED",
              "TCB_REVOKED", "TCB_UNRECOGNIZED"]
BODY = {"tdAttributes": (120, 8), "xfam": (128, 8), "mrTd": (136, 48), "mrConfigId": (184, 48),
        "mrOwner": (232, 48), "mrOwnerConfig": (280, 48), "rtmr0": (328, 48), "rtmr1": (376, 48),
        "rtmr2": (424, 48), "rtmr3": (472, 48), "reportData": (520, 64), "teeTcbSvn": (0, 16),
        "mrSeam": (16, 48)}


def _hex(b):
    return "0x" + b.hex()


def _abi_string_array(b):
    """abi.encode(string[]) -> list[str]"""
    word = lambda o: int.from_bytes(b[o:o + 32], "big")
    base = word(0)
    n = word(base)
    out = []
    for k in range(n):
        off = base + 32 + word(base + 32 + 32 * k)
        ln = word(off)
        out.append(b[off + 32:off + 32 + ln].decode())
    return out


def decode_output(h):
    b = bytes.fromhex(h[2:] if h.startswith("0x") else h)
    r = {"quoteVersion": int.from_bytes(b[0:2], "big"), "quoteBodyType": int.from_bytes(b[2:4], "big"),
         "tcbStatus": b[4], "tcbStatusName": TCB_STATUS[b[4]] if b[4] < len(TCB_STATUS) else "?",
         "fmspc": b[5:11].hex().upper()}
    body_len = {2: 584, 3: 648}.get(r["quoteBodyType"])
    if body_len is None:
        r["note"] = "not a TDX body"
        return r
    body = b[11:11 + body_len]
    for k, (o, n) in BODY.items():
        r[k] = _hex(body[o:o + n])
    r["reportDataFirst32"] = _hex(body[520:552])
    td = int.from_bytes(body[120:128], "little")
    r["tdAttributesDecoded"] = {"DEBUG": td & 1, "SEPT_VE_DISABLE": (td >> 28) & 1, "PKS": (td >> 30) & 1,
                                "KL": (td >> 31) & 1}
    adv = b[11 + body_len:]
    r["advisoryIDs"] = _abi_string_array(adv) if adv else []
    r["outputBytes"] = len(b)
    return r


def decode_event(receipt_path, topic0):
    rc = json.load(open(receipt_path))
    for lg in rc.get("logs", []):
        if lg["topics"][0].lower() == topic0.lower():
            d = bytes.fromhex(lg["data"][2:])
            word = lambda o: int.from_bytes(d[o:o + 32], "big")
            success = bool(word(0))
            vtype = word(32)
            off = word(64)
            ln = word(off)
            out = d[off + 32:off + 32 + ln]
            return {"emitter": lg["address"], "success": success, "verifierType": vtype, "output": _hex(out)}
    return None


def addresses(plan_path):
    plan = json.load(open(plan_path))["transactions"]
    out = {}
    for t in plan:
        if t["transactionType"] in ("CREATE2", "CREATE") and t.get("contractAddress"):
            out[t["contractName"]] = t["contractAddress"]
    return out


def _contract_key(name, label, default_eval):
    if name in ("AutomataEnclaveIdentityDaoVersioned", "AutomataFmspcTcbDaoVersioned"):
        ev = label.split("add-eval-", 1)[1] if label.startswith("add-eval-") else str(default_eval)
        return f"{name}_tcbeval_{ev}"
    return name


def cmd_env(dep_path):
    d = json.load(open(dep_path))
    c = d["contracts"]
    m = {"PCCS_STORAGE": "AutomataDaoStorage", "PCS_DAO": "AutomataPcsDao", "PCK_DAO": "AutomataPckDao",
         "PCCS_DEPENDENCY_CONFIG": "PccsDependencyConfig", "TCB_EVAL_DAO": "AutomataTcbEvalDao",
         "ENCLAVE_ID_HELPER": "EnclaveIdentityHelper", "FMSPC_TCB_HELPER": "FmspcTcbHelper",
         "PCK_HELPER": "PCKHelper", "X509_CRL_HELPER": "X509CRLHelper", "PCCS_ROUTER": "PCCSRouter",
         "DCAP_ATTESTATION": "AutomataDcapAttestationFee", "V4_QUOTE_VERIFIER": "V4QuoteVerifier"}
    for k, v in m.items():
        print(f"export {k}={c[v]}")
    ev = str(d["collateral"]["tcbEvaluationDataNumber"])
    print(f"export ENCLAVE_ID_DAO={c['AutomataEnclaveIdentityDaoVersioned_tcbeval_' + ev]}")
    print(f"export FMSPC_TCB_DAO={c['AutomataFmspcTcbDaoVersioned_tcbeval_' + ev]}")
    print(f"export OWNER={d['owner']}")


def cmd_record(a):
    def load(p, default=None):
        return json.load(open(p)) if p and os.path.exists(p) else default

    prev = load(a["out"], {})
    man = load(os.path.join(a["collateral"], "manifest.json"), {})
    res = a["results"]
    txs = [json.loads(l) for l in open(a["txlog"])] if os.path.exists(a["txlog"]) else []
    contracts = dict(prev.get("contracts", {}))
    ev = man.get("tcbEvaluationDataNumber")
    for t in txs:
        if t["type"] in ("CREATE2", "CREATE"):
            contracts[_contract_key(t["contract"], t.get("label", ""), ev)] = t["address"]
    if a.get("plan") and os.path.exists(a["plan"]):
        for k, v in addresses(a["plan"]).items():
            contracts.setdefault(_contract_key(k, a.get("label", ""), ev), v)
    module = load(os.path.join(res, "module.json"))
    if module:
        contracts["TdxAttestationModule"] = module["address"]
    verify = load(os.path.join(res, "verify.json"))
    measure = load(os.path.join(res, "measure.json"))
    spent = sum(t["costUsdc"] for t in txs)
    extra = 0.0
    for r in (verify, module):
        if r and r.get("tx"):
            extra += r["tx"]["costUsdc"]
    out = {
        "network": a["network"],
        "chainId": int(a["chain_id"]),
        "rpc": a["rpc"],
        "explorer": a["explorer"],
        "deployedAt": prev.get("deployedAt") or a["date"],
        "updatedAt": a["date"],
        "deployer": a["owner"],
        "owner": a["owner"],
        "note": "Automata's DCAP stack (MIT, contracts unchanged) deployed with CREATE2 (factory 0x4e59…) "
                "by dcap-integration/arc-testnet/run.sh. P-256 = Arc's precompile 0x100. "
                "Real verification of a TDX v4 quote from ArcHive's Phala enclave.",
        "source": {
            "automataDcapAttestation": "vendor/automata-dcap-attestation @ " + a["dcap_commit"],
            "automataOnChainPccs": "evm/lib/automata-on-chain-pccs @ " + a["pccs_commit"],
            "compiler": "solc 0.8.27, via-IR, optimizer 200, evm paris (foundry.toml d'Automata)",
            "planScript": "dcap-integration/arc-testnet/ArcTestnetDcap.s.sol",
            "create2Factory": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
            "saltTag": a["salt_tag"],
        },
        "p256Verifier": "0x0000000000000000000000000000000000000100",
        "contracts": contracts,
        "collateral": {k: man.get(k) for k in ("fmspc", "pckCa", "tcbEvaluationDataNumber",
                                                "standardTcbEvaluationDataNumber", "earlyTcbEvaluationDataNumber",
                                                "tcbInfo", "qeIdentity", "tcbEval", "fetchedAtUtc", "sha256")},
        "verification": verify,
        "module": module,
        "measurements": measure,
        "transactions": txs,
        "totals": {"transactions": len(txs) + sum(1 for r in (verify, module) if r and r.get("tx")),
                   "usdcSpentDeployAndCollateral": round(spent, 6),
                   "usdcSpentVerificationAndModule": round(extra, 6),
                   "usdcSpentTotal": round(spent + extra, 6)},
    }
    with open(a["out"], "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {a['out']}: {len(contracts)} contracts, {len(txs)} deployment/collateral txs, "
          f"{out['totals']['usdcSpentTotal']} USDC in total")


DAIMO = "c2b78104907F722DABAc4C69f826a522B2754De4"


def _cast(*args):
    p = subprocess.run(["cast", *args], capture_output=True, text=True)
    return p.returncode, (p.stdout.strip() if p.returncode == 0 else (p.stderr or p.stdout).strip())


def cmd_measure(a):
    rpc = ["--rpc-url", a["rpc"]]
    rc, code = _cast("code", a["v4"], *rpc)
    code = bytearray(bytes.fromhex(code[2:]))
    refs = json.load(open(a["artifact"]))["deployedBytecode"]["immutableReferences"]
    p256 = (0x100).to_bytes(32, "big")
    n = 0
    for locs in refs.values():
        if {bytes(code[l["start"]:l["start"] + 32]) for l in locs} == {p256}:
            for l in locs:
                code[l["start"]:l["start"] + 32] = bytes(12) + bytes.fromhex(DAIMO)
                n += 1
    if n == 0:
        sys.exit("immutable P256_VERIFIER (0x100) not found in the verifier's code")
    quote = open(a["quote_file"]).read().strip()
    rc, data = _cast("calldata", "verifyAndAttestOnChain(bytes)", quote)
    tx = json.dumps({"from": a["from"], "to": a["att"], "data": data})
    rc, g1 = _cast("rpc", "eth_estimateGas", tx, "latest", *rpc)
    ov = json.dumps({a["v4"]: {"code": "0x" + code.hex()}})
    rc2, g2 = _cast("rpc", "eth_estimateGas", tx, "latest", ov, *rpc)
    g1 = int(json.loads(g1), 16)
    g2 = int(json.loads(g2), 16) if rc2 == 0 else None
    q = bytes.fromhex(quote[2:])
    neg = {}
    for label, off in (("reportData[0] altered", 48 + 520), ("MRTD[0] altered", 48 + 136),
                       ("quote ECDSA signature altered", 48 + 584 + 4)):
        b = bytearray(q)
        b[off] ^= 1
        rc, out = _cast("call", a["att"], "verifyAndAttestOnChain(bytes)(bool,bytes)", "0x" + b.hex(), *rpc)
        if rc != 0:
            neg[label] = "refused: revert (" + out.splitlines()[-1][-120:] + ")"
        else:
            ok, outb = (out.splitlines() + ["", ""])[:2]
            neg[label] = "refused: success=false" if ok == "false" else "ACCEPTED (abnormal): " + out[:80]
    r = {"method": "eth_estimateGas on Arc, same state; Daimo = the V4QuoteVerifier's code overridden "
                   "(immutable P256_VERIFIER 0x100 -> Daimo 0xc2b7…) for the estimate only",
         "estimateGasPrecompile0x100": g1, "estimateGasDaimoSolidity": g2,
         "differenceGas": (g2 - g1) if g2 else None, "p256VerificationsPerQuote": 5,
         "tamperedQuotes": neg}
    json.dump(r, open(a["out"], "w"), indent=2, ensure_ascii=False)
    print(json.dumps(r, indent=2, ensure_ascii=False))


def main():
    cmd = sys.argv[1]
    if cmd == "decode-output":
        print(json.dumps(decode_output(sys.argv[2]), indent=2))
    elif cmd == "decode-event":
        print(json.dumps(decode_event(sys.argv[2], sys.argv[3]), indent=2))
    elif cmd == "addresses":
        print(json.dumps(addresses(sys.argv[2]), indent=2))
    elif cmd == "env":
        cmd_env(sys.argv[2])
    elif cmd == "measure":
        cmd_measure(dict(arg.split("=", 1) for arg in sys.argv[2:]))
    elif cmd == "record":
        kv = dict(arg.split("=", 1) for arg in sys.argv[2:])
        cmd_record(kv)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
