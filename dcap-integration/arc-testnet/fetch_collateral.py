#!/usr/bin/env python3
"""Fetches the Intel collateral (PCS v4) needed to verify one TDX v4 quote on-chain.

Usage (run with `python3 -I`, standard library only):
    python3 -I fetch_collateral.py --enclave-url https://<app>-8802.<gw>/pubkeys --out collateral
    python3 -I fetch_collateral.py --quote-file quote.hex --out collateral [--tcb-eval 20]

What the script writes into --out:
    quote.hex              the exact quote used (hex 0x…)
    root_ca.der            Intel SGX Root CA (taken from the quote's PCK chain)
    pck_ca.der             Intel SGX PCK Platform CA or Processor CA (the quote's PCK chain)
    tcb_signing.der        Intel SGX TCB Signing (TCB-Info-Issuer-Chain header)
    root_ca_crl.der        the root CA's CRL (certificates.trustedservices.intel.com)
    pck_crl.der            the PCK CRL of the CA that issued the PCK leaf (platform/processor)
    tdx_tcb_info.json      TDX TCB info v3 for the quote's FMSPC, at the chosen evaluation number
    tdx_qe_identity.json   the TDX QE identity, same evaluation number
    tdx_tcb_eval.json      TDX TCB evaluation numbers (signed by Intel)
    manifest.json          FMSPC, CA, evaluation number, dates, sha256, URLs

Evaluation number: by default, the one Automata calls "standard" on-chain (TcbEvalDao.standard):
the highest number whose TCB recovery event is at least 365.25 days old. The quote is verified with
this number when verifyAndAttestOnChain(quote) is called without a number.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request

PCS = "https://api.trustedservices.intel.com"
ROOT_CRL_URL = "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der"
FMSPC_OID = bytes.fromhex("060A2A864886F84D010D0104")  # 1.2.840.113741.1.13.1.4
TWELVE_MONTHS = 31557600  # 365.25 days, as TcbEvalDao.TWELFTH_MONTHS_SECONDS


def http_get(url, tries=6):
    delay = 2
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "archive-dcap-arc/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read(), {k.lower(): v for k, v in r.headers.items()}
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise


def load_quote(args):
    if args.quote_file:
        raw = open(args.quote_file).read().strip()
        if raw.startswith("{"):
            raw = json.loads(raw)["lastQuote"]
    else:
        body, _ = http_get(args.enclave_url)
        raw = json.loads(body)["lastQuote"]
    raw = raw[2:] if raw.startswith("0x") else raw
    return bytes.fromhex(raw)


def pck_chain_from_quote(q):
    ver = struct.unpack("<H", q[0:2])[0]
    tee = q[4:8]
    if ver != 4 or tee != bytes.fromhex("81000000"):
        sys.exit(f"unsupported quote: version {ver}, tee {tee.hex()} (expected: V4 TDX)")
    off = 48 + 584
    ad_len = struct.unpack("<I", q[off:off + 4])[0]
    ad = q[off + 4:off + 4 + ad_len]
    if struct.unpack("<H", ad[128:130])[0] != 6:
        sys.exit("unexpected certification data type (expected: 6, QE report)")
    qe_auth = struct.unpack("<H", ad[582:584])[0]
    o = 584 + qe_auth
    cert_type, cert_size = struct.unpack("<HI", ad[o:o + 6])
    if cert_type != 5:
        sys.exit(f"certification type {cert_type} (expected: 5, PEM PCK chain)")
    pem = ad[o + 6:o + 6 + cert_size]
    blocks = re.findall(rb"-----BEGIN CERTIFICATE-----(.+?)-----END CERTIFICATE-----", pem, re.S)
    ders = [base64.b64decode(b"".join(b.split())) for b in blocks]
    if len(ders) != 3:
        sys.exit(f"PCK chain of {len(ders)} certificates (expected: 3)")
    return ders  # [PCK leaf, PCK CA, root]


def fmspc_from_pck(der):
    i = der.find(FMSPC_OID)
    if i < 0 or der[i + len(FMSPC_OID):i + len(FMSPC_OID) + 2] != b"\x04\x06":
        sys.exit("FMSPC not found in the PCK certificate")
    j = i + len(FMSPC_OID) + 2
    return der[j:j + 6].hex().upper()


def pck_ca_kind(ca_der):
    if b"Intel SGX PCK Platform CA" in ca_der:
        return "platform"
    if b"Intel SGX PCK Processor CA" in ca_der:
        return "processor"
    sys.exit("unknown PCK CA in the quote's chain")


def issuer_chain(headers, name):
    v = headers.get(name.lower())
    if not v:
        sys.exit(f"header {name} missing from Intel's response")
    pem = urllib.parse.unquote(v)
    blocks = re.findall(r"-----BEGIN CERTIFICATE-----(.+?)-----END CERTIFICATE-----", pem, re.S)
    return [base64.b64decode("".join(b.split())) for b in blocks]


def iso(ts):
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--enclave-url", help="the enclave's /pubkeys URL (field lastQuote)")
    src.add_argument("--quote-file", help="hex file (0x…) or JSON with lastQuote")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tcb-eval", type=int, default=0, help="evaluation number (0 = standard)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    def w(name, data):
        mode = "w" if isinstance(data, str) else "wb"
        with open(os.path.join(args.out, name), mode) as f:
            f.write(data)

    q = load_quote(args)
    leaf, pck_ca, root = pck_chain_from_quote(q)
    fmspc = fmspc_from_pck(leaf)
    ca = pck_ca_kind(pck_ca)
    print(f"quote: {len(q)} bytes, FMSPC {fmspc}, PCK CA {ca}")

    eval_body, eval_hdr = http_get(f"{PCS}/tdx/certification/v4/tcbevaluationdatanumbers")
    numbers = json.loads(eval_body)["tcbEvaluationDataNumbers"]["tcbEvalNumbers"]
    now = time.time()
    standard = 0
    for n in numbers:  # Intel lists them from newest to oldest, as TcbEvalDao does
        if now - iso(n["tcbRecoveryEventDate"]).timestamp() >= TWELVE_MONTHS:
            standard = n["tcbEvaluationDataNumber"]
            break
    tcb_eval = args.tcb_eval or standard
    early = numbers[0]["tcbEvaluationDataNumber"]
    print(f"TDX evaluation numbers: standard {standard}, early {early}, chosen {tcb_eval}")

    tcb_url = f"{PCS}/tdx/certification/v4/tcb?fmspc={fmspc}&tcbEvaluationDataNumber={tcb_eval}"
    qe_url = f"{PCS}/tdx/certification/v4/qe/identity?tcbEvaluationDataNumber={tcb_eval}"
    crl_url = f"{PCS}/sgx/certification/v4/pckcrl?ca={ca}&encoding=der"
    tcb_body, tcb_hdr = http_get(tcb_url)
    qe_body, _ = http_get(qe_url)
    crl_body, crl_hdr = http_get(crl_url)
    root_crl, _ = http_get(ROOT_CRL_URL)

    signing, root_from_tcb = issuer_chain(tcb_hdr, "TCB-Info-Issuer-Chain")
    crl_issuer = issuer_chain(crl_hdr, "SGX-PCK-CRL-Issuer-Chain")[0]
    if root_from_tcb != root:
        sys.exit("the root of Intel's TCB chain differs from the quote's")
    if crl_issuer != pck_ca:
        sys.exit("the PCK CRL's issuer differs from the quote's PCK CA")

    ti = json.loads(tcb_body)["tcbInfo"]
    qi = json.loads(qe_body)["enclaveIdentity"]
    if ti["fmspc"].upper() != fmspc or ti["tcbEvaluationDataNumber"] != tcb_eval:
        sys.exit("unexpected TCB info (FMSPC or evaluation number)")
    if qi["id"] != "TD_QE" or qi["tcbEvaluationDataNumber"] != tcb_eval:
        sys.exit("unexpected QE identity")

    w("quote.hex", "0x" + q.hex())
    w("root_ca.der", root)
    w("pck_ca.der", pck_ca)
    w("tcb_signing.der", signing)
    w("root_ca_crl.der", root_crl)
    w("pck_crl.der", crl_body)
    w("tdx_tcb_info.json", tcb_body.decode())
    w("tdx_qe_identity.json", qe_body.decode())
    w("tdx_tcb_eval.json", eval_body.decode())

    files = ["quote.hex", "root_ca.der", "pck_ca.der", "tcb_signing.der", "root_ca_crl.der",
             "pck_crl.der", "tdx_tcb_info.json", "tdx_qe_identity.json", "tdx_tcb_eval.json"]
    manifest = {
        "fetchedAtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": args.enclave_url or args.quote_file,
        "quoteBytes": len(q),
        "fmspc": fmspc,
        "pckCa": ca,
        "pckCaCode": {"platform": 2, "processor": 1}[ca],
        "tcbEvaluationDataNumber": tcb_eval,
        "standardTcbEvaluationDataNumber": standard,
        "earlyTcbEvaluationDataNumber": early,
        "tcbInfo": {"issueDate": ti["issueDate"], "nextUpdate": ti["nextUpdate"], "url": tcb_url},
        "qeIdentity": {"issueDate": qi["issueDate"], "nextUpdate": qi["nextUpdate"], "url": qe_url},
        "tcbEval": {"nextUpdate": json.loads(eval_body)["tcbEvaluationDataNumbers"]["nextUpdate"]},
        "urls": {"pckCrl": crl_url, "rootCrl": ROOT_CRL_URL,
                 "tcbEval": f"{PCS}/tdx/certification/v4/tcbevaluationdatanumbers"},
        "sha256": {f: hashlib.sha256(open(os.path.join(args.out, f), "rb").read()).hexdigest() for f in files},
    }
    w("manifest.json", json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k: manifest[k] for k in ("fmspc", "pckCa", "tcbEvaluationDataNumber")}))


if __name__ == "__main__":
    main()
