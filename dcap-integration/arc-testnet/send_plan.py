#!/usr/bin/env python3
"""Sends a transaction plan produced by `forge script` (dry-run mode) to the chain, one transaction at a time.

Why: `forge script --broadcast` fixes every nonce in advance and stops if another transaction from the same
account lands in between. Here each transaction is sent by `cast send` (nonce re-read before each send), and
its receipt is awaited and checked before the next one. The plan's deployments use CREATE2: addresses do not
depend on the nonce, and a contract already present is skipped (re-runs create no duplicates).

Usage (python3 -I):
    send_plan.py --plan <deploy-latest.json> --log results/txs.jsonl --rpc-url URL --key-file F \
                 --chain-id 5042002 [--priority-gas-price 1gwei] [--max-usdc 15]
The private key is read from --key-file (field privateKey) and passed to cast; it is never printed.
"""
import argparse
import json
import os
import subprocess
import sys
import time

RETRY_MARKERS = ("429", "too many requests", "rate limit", "nonce too low", "replacement transaction",
                 "already known", "timeout", "timed out", "connection", "temporarily unavailable",
                 "502", "503", "504")


def cast(args, retries=6, check=True):
    delay = 2
    for attempt in range(retries):
        p = subprocess.run(["cast", *args], capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout.strip()
        err = (p.stderr or p.stdout).lower()
        if attempt < retries - 1 and any(m in err for m in RETRY_MARKERS):
            time.sleep(delay)
            delay = min(delay * 2, 30)
            continue
        if check:
            # never print the command line (it holds the key): only the error
            raise RuntimeError((p.stderr or p.stdout).strip()[-2000:])
        return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--rpc-url", required=True)
    ap.add_argument("--key-file", required=True)
    ap.add_argument("--chain-id", type=int, required=True)
    ap.add_argument("--priority-gas-price", default="1gwei")
    ap.add_argument("--max-usdc", type=float, default=15.0, help="stop if the total spent exceeds this")
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    rpc = ["--rpc-url", args.rpc_url]
    chain = int(cast(["chain-id", *rpc]))
    if chain != args.chain_id:
        sys.exit(f"chain {chain} != expected {args.chain_id}")

    with open(args.key_file) as f:
        pk = json.load(f)["privateKey"]
    sender = cast(["wallet", "address", "--private-key", pk]).lower()

    plan = json.load(open(args.plan))["transactions"]
    print(f"plan: {len(plan)} transactions, sender {sender}, chain {chain}")
    spent = 0.0
    os.makedirs(os.path.dirname(os.path.abspath(args.log)), exist_ok=True)
    for i, t in enumerate(plan):
        tx = t["transaction"]
        if tx["from"].lower() != sender:
            sys.exit(f"tx {i}: sender {tx['from']} != key {sender}")
        kind = t["transactionType"]
        name = t.get("contractName") or "?"
        fn = t.get("function") or ""
        target = t.get("contractAddress") or tx["to"]
        if kind in ("CREATE2", "CREATE") and t.get("contractAddress"):
            code = cast(["code", t["contractAddress"], *rpc])
            if code and code != "0x":
                print(f"[{i:02d}] already deployed: {name} {t['contractAddress']}")
                continue
        if kind == "CREATE":
            sys.exit("CREATE (nonce-dependent) refused: the plan must use CREATE2")
        txhash = cast(["send", tx["to"], tx["input"], "--private-key", pk, *rpc,
                       "--priority-gas-price", args.priority_gas_price, "--async"])
        rcpt = json.loads(cast(["receipt", txhash, "--json", *rpc], retries=12))
        status = int(rcpt["status"], 16)
        gas = int(rcpt["gasUsed"], 16)
        price = int(rcpt["effectiveGasPrice"], 16)
        cost = gas * price / 1e18
        spent += cost
        rec = {"i": i, "label": args.label, "type": kind, "contract": name, "address": target, "function": fn,
               "txHash": txhash, "block": int(rcpt["blockNumber"], 16), "status": status, "gasUsed": gas,
               "effectiveGasPriceWei": price, "costUsdc": round(cost, 8), "time": int(time.time())}
        with open(args.log, "a") as f:
            f.write(json.dumps(rec) + "\n")
        print(f"[{i:02d}] {kind:7s} {name} {fn} -> {txhash} gas {gas} ({cost:.6f} USDC) status {status}")
        if status != 1:
            sys.exit(f"tx {i} failed on-chain: {txhash}")
        if kind == "CREATE2":
            code = cast(["code", t["contractAddress"], *rpc])
            if not code or code == "0x":
                sys.exit(f"tx {i}: no code at {t['contractAddress']} after CREATE2")
        if spent > args.max_usdc:
            sys.exit(f"total spent {spent:.4f} USDC > cap {args.max_usdc}")
        time.sleep(0.3)
    print(f"done: {spent:.6f} USDC spent in this run")


if __name__ == "__main__":
    main()
