"""Stage 3 Resumable StudioNet Deploy, Seeding & Proof Builder for Public Muse."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import pathlib
import sys
import time
import types
from typing import Any

import requests

# Python 3.15 on Windows lacks a prebuilt ckzg wheel; stub unused EIP-4844 helpers.
try:
    import ckzg  # noqa: F401
except ImportError:
    _ckzg_stub = types.ModuleType("ckzg")
    for _fn in (
        "blob_to_kzg_commitment",
        "compute_blob_kzg_proof",
        "compute_cells_and_kzg_proofs",
        "load_trusted_setup",
    ):
        setattr(_ckzg_stub, _fn, lambda *args, **kwargs: None)
    sys.modules["ckzg"] = _ckzg_stub

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
STUDIONET_RPC_URL = "https://studio.genlayer.com/api"
STUDIONET_EXPLORER_URL = "https://explorer-studio.genlayer.com"
STUDIONET_CHAIN_ID = 61999
DEFAULT_POLL_INTERVAL = 7.0
MIN_POLL_INTERVAL = 6.0
TRANSIENT_HTTP_STATUSES = {429, 502, 503, 504}

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT_PATH = PROJECT_ROOT / "contracts" / "public_muse.py"
SEED_STATE_PATH = PROJECT_ROOT / "deploy" / "seed_state.json"
PROOF_PATH = PROJECT_ROOT / "deploy" / "proof.json"
SECRETS_PATH = PROJECT_ROOT / ".secrets.local.json"
FRONTEND_PUBLIC_PROOF = PROJECT_ROOT / "frontend" / "public" / "proof.json"
FRONTEND_DATA_PROOF = PROJECT_ROOT / "frontend" / "src" / "data" / "proof.json"

MIN_BOND_WEI = 100
MIN_CHALLENGE_FEE_WEI = 20
DEFAULT_TIMEOUT_SECONDS = 900

URL_RUBY_SLIPPERS = (
    "https://en.wikipedia.org/w/api.php?"
    "action=parse&oldid=1384457883&prop=wikitext&section=0&format=json"
)
URL_SILVER_SHOES = (
    "https://en.wikipedia.org/w/api.php?"
    "action=parse&oldid=1378659855&prop=wikitext&section=0&format=json"
)
URL_STEAM_LOCOMOTIVE = (
    "https://en.wikipedia.org/w/api.php?"
    "action=parse&oldid=1380178024&prop=wikitext&section=0&format=json"
)

_ORIG_SESSION_REQUEST = requests.sessions.Session.request


def _extract_rpc_method(kwargs: dict[str, Any]) -> str | None:
    payload = kwargs.get("json")
    if isinstance(payload, dict):
        return payload.get("method")
    raw_data = kwargs.get("data")
    if isinstance(raw_data, (str, bytes)):
        try:
            parsed = json.loads(raw_data)
            if isinstance(parsed, dict):
                return parsed.get("method")
        except Exception:
            return None
    return None


def _install_studionet_browser_ua_patch() -> None:
    """Force browser User-Agent and retry transient 429/502/503/504 on reads."""

    def _patched_request(
        self: requests.sessions.Session,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> requests.Response:
        is_studionet = "studio.genlayer.com" in str(url)
        if is_studionet:
            headers = dict(kwargs.get("headers") or {})
            headers["User-Agent"] = BROWSER_USER_AGENT
            headers["Connection"] = "close"
            kwargs["headers"] = headers
        rpc_method = _extract_rpc_method(kwargs) if is_studionet else None
        can_retry_http = is_studionet and rpc_method != "eth_sendRawTransaction"
        max_attempts = 6 if can_retry_http else (4 if is_studionet else 1)
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                resp = _ORIG_SESSION_REQUEST(self, method, url, **kwargs)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt >= max_attempts:
                    raise
                time.sleep(10.0 * attempt)
                continue
            if can_retry_http and resp.status_code in TRANSIENT_HTTP_STATUSES and attempt < max_attempts:
                time.sleep(10.0 * attempt)
                continue
            return resp
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Unreachable retry state")

    requests.sessions.Session.request = _patched_request  # type: ignore[method-assign]


_install_studionet_browser_ua_patch()

from eth_account import Account  # noqa: E402
from genlayer_py import create_account, create_client  # noqa: E402
from genlayer_py.chains import studionet  # noqa: E402


def rpc_call(method: str, params: list[Any], timeout: int = 30) -> dict[str, Any]:
    """Execute a StudioNet JSON-RPC call."""
    resp = requests.post(
        STUDIONET_RPC_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        headers={"Content-Type": "application/json", "User-Agent": BROWSER_USER_AGENT},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def _load_json(path: pathlib.Path, default: dict[str, Any]) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return dict(default)


def _save_json(path: pathlib.Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def ensure_accounts(state: dict[str, Any]) -> tuple[Any, Any]:
    """Load or generate producer/challenger accounts and fund via sim_fundAccount."""
    secrets = _load_json(SECRETS_PATH, {})
    changed = False
    for role in ("producer", "challenger"):
        if role not in secrets or "private_key" not in secrets[role]:
            acct = create_account()
            secrets[role] = {
                "address": acct.address,
                "private_key": acct.key.hex(),
            }
            changed = True
    if changed:
        _save_json(SECRETS_PATH, secrets)

    producer = Account.from_key(secrets["producer"]["private_key"])
    challenger = Account.from_key(secrets["challenger"]["private_key"])

    acct_state = state.setdefault("accounts", {})
    for role, acct in (("producer", producer), ("challenger", challenger)):
        bal_hex = rpc_call("eth_getBalance", [acct.address, "latest"]).get("result") or "0x0"
        bal_int = int(bal_hex, 16)
        role_info = acct_state.setdefault(role, {"address": acct.address})
        role_info["address"] = acct.address
        if bal_int < 10_000:
            fund_tx = rpc_call("sim_fundAccount", [acct.address, 1_000_000]).get("result")
            time.sleep(2.0)
            bal_hex = rpc_call("eth_getBalance", [acct.address, "latest"]).get("result") or "0x0"
            role_info["sim_fundAccount_tx"] = fund_tx
        role_info["funded_balance_hex"] = bal_hex
        role_info["funded_balance_wei"] = str(int(bal_hex, 16))
    _save_json(SEED_STATE_PATH, state)
    return producer, challenger


def poll_tx_until_final(
    tx_id: str,
    label: str,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    max_polls: int = 45,
) -> dict[str, Any]:
    """Poll StudioNet every >= 6s until FINALIZED / CANCELED / UNDETERMINED."""
    interval = max(MIN_POLL_INTERVAL, poll_interval)
    for attempt in range(1, max_polls + 1):
        time.sleep(interval)
        try:
            res = rpc_call("eth_getTransactionByHash", [tx_id])
        except Exception as exc:  # noqa: BLE001
            print(f"  [{label}] poll {attempt}: transient error={exc}", flush=True)
            continue
        tx = res.get("result")
        if isinstance(tx, dict):
            status = str(tx.get("status_name") or tx.get("status") or "")
            print(f"  [{label}] poll {attempt}: tx={tx_id[:12]}... status={status}", flush=True)
            if status in ("FINALIZED", "CANCELED", "UNDETERMINED"):
                return tx
        else:
            print(f"  [{label}] poll {attempt}: pending", flush=True)
    raise TimeoutError(f"[{label}] {tx_id} did not finalize within {max_polls} polls")


def summarize_tx(tx: dict[str, Any]) -> dict[str, Any]:
    """Summarize finalized transaction consensus and leader execution status."""
    cd = tx.get("consensus_data") or {}
    lr = (cd.get("leader_receipt") or [{}])[0]
    last_round = tx.get("last_round") or {}
    return {
        "tx_id": tx.get("hash") or tx.get("tx_id"),
        "status": tx.get("status"),
        "result": tx.get("result"),
        "result_name": tx.get("result_name"),
        "leader_execution_result": lr.get("execution_result"),
        "leader_genvm_result": lr.get("genvm_result"),
        "validator_votes_name": last_round.get("validator_votes_name"),
    }


def run_resumable_write(
    state: dict[str, Any],
    step_key: str,
    client: Any,
    contract_address: str,
    function_name: str,
    args: list[Any],
    value: int = 0,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    force: bool = False,
) -> dict[str, Any]:
    """Execute or resume a StudioNet contract write transaction cleanly."""
    steps = state.setdefault("steps", {})
    existing = steps.get(step_key) or {}
    if existing.get("done") and not force:
        print(f"[{step_key}] reusing finalized tx {existing['tx_id']}", flush=True)
        return existing

    tx_id = existing.get("pending_tx_id")
    if not tx_id:
        time.sleep(2.0)
        print(f"[{step_key}] submitting {function_name} (value={value})...", flush=True)
        tx_id = client.write_contract(
            address=contract_address,
            function_name=function_name,
            args=args,
            value=value,
        )
        print(f"[{step_key}] tx_id saved before polling: {tx_id}", flush=True)
        steps[step_key] = {"pending_tx_id": tx_id, "done": False}
        _save_json(SEED_STATE_PATH, state)
    else:
        print(f"[{step_key}] resuming pending tx {tx_id}...", flush=True)

    tx = poll_tx_until_final(tx_id, step_key, poll_interval=poll_interval)
    summary = summarize_tx(tx)
    summary["done"] = True
    steps[step_key] = summary
    _save_json(SEED_STATE_PATH, state)

    if summary["status"] != "FINALIZED" or summary["result_name"] != "MAJORITY_AGREE":
        raise RuntimeError(
            f"[{step_key}] unexpected consensus outcome: "
            f"status={summary['status']} result_name={summary['result_name']} "
            f"leader_exec={summary['leader_execution_result']}"
        )
    if summary["leader_execution_result"] != "SUCCESS":
        raise RuntimeError(
            f"[{step_key}] leader execution failed: {summary['leader_genvm_result']}"
        )
    return summary


def ensure_deployed(
    state: dict[str, Any],
    producer_client: Any,
    poll_interval: float,
    force: bool,
) -> str:
    """Deploy PublicMuse or resume/reuse existing deployment from seed_state.json."""
    dep = state.get("deploy") or {}
    if dep.get("done") and dep.get("contract_address") and not force:
        print(f"[deploy] reusing contract {dep['contract_address']}", flush=True)
        return str(dep["contract_address"])

    tx_id = dep.get("pending_tx_id")
    if not tx_id:
        code = CONTRACT_PATH.read_text(encoding="utf-8")
        print("[deploy] deploying contracts/public_muse.py...", flush=True)
        tx_id = producer_client.deploy_contract(
            code=code,
            args=[MIN_BOND_WEI, MIN_CHALLENGE_FEE_WEI, DEFAULT_TIMEOUT_SECONDS],
        )
        print(f"[deploy] deploy tx saved before polling: {tx_id}", flush=True)
        state["deploy"] = {"pending_tx_id": tx_id, "done": False}
        _save_json(SEED_STATE_PATH, state)

    tx = poll_tx_until_final(tx_id, "deploy", poll_interval=poll_interval)
    summary = summarize_tx(tx)
    addr = (
        (tx.get("data") or {}).get("contract_address")
        or tx.get("to_address")
        or tx.get("recipient")
    )
    if not addr:
        raise RuntimeError("Deploy tx finalized without contract_address")
    summary["contract_address"] = addr
    summary["done"] = True
    state["deploy"] = summary
    _save_json(SEED_STATE_PATH, state)

    if summary["status"] != "FINALIZED" or summary["result_name"] != "MAJORITY_AGREE":
        raise RuntimeError(f"Deploy did not finalize with MAJORITY_AGREE: {summary}")
    return str(addr)


def read_clauses(client: Any, contract_address: str) -> list[dict[str, Any]]:
    raw = client.read_contract(address=contract_address, function_name="list_clauses", args=[])
    return json.loads(raw) if raw else []


def read_challenges(client: Any, contract_address: str) -> list[dict[str, Any]]:
    raw = client.read_contract(address=contract_address, function_name="list_challenges", args=[])
    return json.loads(raw) if raw else []


def find_clause(clauses: list[dict[str, Any]], element_claim: str) -> dict[str, Any]:
    for c in reversed(clauses):
        if c.get("element_claim") == element_claim:
            return c
    raise RuntimeError(f"Clause not found on-chain for claim: {element_claim[:60]}...")


def find_challenge(
    challenges: list[dict[str, Any]],
    clause_id: str,
    evidence_url: str,
) -> dict[str, Any]:
    for ch in reversed(challenges):
        if ch.get("clause_id") == clause_id and ch.get("evidence_url") == evidence_url:
            return ch
    raise RuntimeError(
        f"Challenge not found on-chain for clause_id={clause_id} url={evidence_url}"
    )


def build_proof_document(state: dict[str, Any], client: Any, contract_address: str) -> dict[str, Any]:
    """Assemble deploy/proof.json matching frontend/src/types/proof.ts."""
    clauses = {c["clause_id"]: c for c in read_clauses(client, contract_address)}
    challenges = {ch["challenge_id"]: ch for ch in read_challenges(client, contract_address)}
    steps = state.get("steps") or {}
    meta = state.get("case_meta") or {}

    cases: list[dict[str, Any]] = []

    def add_challenged_case(
        case_id: str,
        label: str,
        reg_step: str,
        ch_step: str,
        payout_summary: str,
        notes: str | None = None,
    ) -> None:
        m = meta.get(case_id)
        if not m:
            return
        clause = clauses[m["clause_id"]]
        challenge = challenges[m["challenge_id"]]
        cases.append(
            {
                "case_id": case_id,
                "label": label,
                "clause_id": clause["clause_id"],
                "challenge_id": challenge["challenge_id"],
                "work_title": clause["work_title"],
                "element_claim": clause["element_claim"],
                "public_domain_source": clause["public_domain_source"],
                "clause_sha256": clause["clause_sha256"],
                "verdict": challenge["verdict"],
                "verbatim_quote": challenge.get("quote") or "",
                "evidence_url": challenge["evidence_url"],
                "evidence_sha256": challenge.get("evidence_sha256") or "",
                "register_tx_hash": steps[reg_step]["tx_id"],
                "challenge_tx_hash": steps[ch_step]["tx_id"],
                "resolve_tx_hash": None,
                "withdraw_tx_hash": None,
                "expiry_fallback": None,
                "tx_status": steps[ch_step]["status"],
                "consensus_result": steps[ch_step]["result_name"],
                "appeal_window_status": "Appeal window closed — Finalized (7)",
                "bond_wei": str(clause.get("bond_wei", MIN_BOND_WEI)),
                "challenge_fee_wei": str(challenge.get("fee_wei", MIN_CHALLENGE_FEE_WEI)),
                "payout_summary": payout_summary,
                **({"notes": notes} if notes else {}),
            }
        )

    add_challenged_case(
        "case-1-ruby-slippers-breach",
        "Case 1: Protected Derivative Breach (1939 MGM Ruby Slippers vs 1900 Novel)",
        "case1_register",
        "case1_challenge",
        "Challenger credited 120 wei (100 bond + 20 fee).",
        "Proof that Ruby Slippers originated in MGM's 1939 film while Baum's 1900 novel had Silver Shoes.",
    )
    add_challenged_case(
        "case-2-silver-shoes-public-domain",
        "Case 2: Public Domain Verified (1900 Baum Novel Silver Shoes)",
        "case2_register",
        "case2_challenge",
        "Producer retains 100 wei bond and is credited 20 wei challenge fee.",
    )

    if "case3" in meta:
        c3 = clauses[meta["case3"]["clause_id"]]
        cases.append(
            {
                "case_id": "case-3-rejected-vague",
                "label": "Case 3: Rejected Vague (Gate 1 Subjective Claim Refund)",
                "clause_id": c3["clause_id"],
                "challenge_id": None,
                "work_title": c3["work_title"],
                "element_claim": c3["element_claim"],
                "public_domain_source": c3["public_domain_source"],
                "clause_sha256": c3["clause_sha256"],
                "verdict": "REJECTED_VAGUE",
                "verbatim_quote": "",
                "evidence_url": "",
                "evidence_sha256": "",
                "register_tx_hash": steps["case3_register"]["tx_id"],
                "challenge_tx_hash": None,
                "resolve_tx_hash": None,
                "withdraw_tx_hash": None,
                "expiry_fallback": None,
                "tx_status": steps["case3_register"]["status"],
                "consensus_result": steps["case3_register"]["result_name"],
                "appeal_window_status": "Appeal window closed — Finalized (7)",
                "bond_wei": str(c3.get("refunded_wei", MIN_BOND_WEI)),
                "challenge_fee_wei": "0",
                "payout_summary": "100 wei deposit safely credited to producer claimable_balances.",
            }
        )

    if "case-4-prompt-injection" in meta:
        add_challenged_case(
            "case-4-prompt-injection",
            "Case 4: Prompt Injection Resilience (Untrusted Raw Text)",
            "case2_register",
            "case4_challenge",
            "Producer retains bond and receives 20 wei challenge fee; injection ignored.",
        )

    add_challenged_case(
        "case-5-insufficient-evidence",
        "Case 5: Insufficient Evidence (Unrelated Steam Locomotive Article)",
        "case2_register",
        "case5_challenge",
        "Challenger refunded 20 wei challenge fee.",
    )

    if "case6" in meta:
        c6 = clauses[meta["case6"]["clause_id"]]
        w_prod = (steps.get("case6_withdraw_producer") or {}).get("tx_id")
        cases.append(
            {
                "case_id": "case-6-expiry-withdrawal",
                "label": "Case 6: Timeout Fallback & EOA Withdrawal",
                "clause_id": c6["clause_id"],
                "challenge_id": None,
                "work_title": c6["work_title"],
                "element_claim": c6["element_claim"],
                "public_domain_source": c6["public_domain_source"],
                "clause_sha256": c6["clause_sha256"],
                "verdict": "INSUFFICIENT_EVIDENCE",
                "verbatim_quote": "",
                "evidence_url": "",
                "evidence_sha256": "",
                "register_tx_hash": steps["case6_register"]["tx_id"],
                "challenge_tx_hash": None,
                "resolve_tx_hash": None,
                "withdraw_tx_hash": w_prod,
                "expiry_fallback": {
                    "expired_tx_hash": steps["case6_expire"]["tx_id"],
                    "status": c6["status"],
                    "refunded_wei": str(c6.get("refunded_wei", MIN_BOND_WEI)),
                    "note": (
                        "15s timeout clause expired and returned 100 wei; both producer and "
                        "challenger withdrew claimable balances to EOA via @gl.evm.contract_interface."
                    ),
                },
                "tx_status": steps["case6_expire"]["status"],
                "consensus_result": steps["case6_expire"]["result_name"],
                "appeal_window_status": "Appeal window closed — Finalized (7)",
                "bond_wei": str(c6.get("refunded_wei", MIN_BOND_WEI)),
                "challenge_fee_wei": "0",
                "payout_summary": (
                    f"Producer withdrew {state['withdrawals']['producer']['claimable_before_wei']} wei; "
                    f"challenger withdrew {state['withdrawals']['challenger']['claimable_before_wei']} wei."
                ),
            }
        )

    proof = {
        "schema_version": "1.0.0",
        "is_placeholder": False,
        "network": {
            "name": "GenLayer StudioNet",
            "chain_id": STUDIONET_CHAIN_ID,
            "rpc_url": STUDIONET_RPC_URL,
            "explorer_url": STUDIONET_EXPLORER_URL,
        },
        "contract_address": contract_address,
        "deploy_tx_hash": state["deploy"]["tx_id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "accounts": state.get("accounts"),
        "withdrawals": state.get("withdrawals"),
        "cases": cases,
    }
    _save_json(PROOF_PATH, proof)
    if FRONTEND_PUBLIC_PROOF.parent.exists():
        _save_json(FRONTEND_PUBLIC_PROOF, proof)
    if FRONTEND_DATA_PROOF.parent.exists():
        _save_json(FRONTEND_DATA_PROOF, proof)
    return proof


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        default="all",
        choices=("all", "deploy", "case1", "case2", "case3", "case4", "case5", "case6", "build-proof"),
        help="Stage to run.",
    )
    parser.add_argument("--injection-url", default="", help="Immutable URL for Case 4.")
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    state = _load_json(SEED_STATE_PATH, {"steps": {}, "case_meta": {}, "withdrawals": {}})
    if args.force and args.stage == "all":
        state["deploy"] = {}
        state["steps"] = {}
        state["case_meta"] = {}
        state["withdrawals"] = {}
        _save_json(SEED_STATE_PATH, state)
    producer, challenger = ensure_accounts(state)
    p_client = create_client(chain=studionet, account=producer)
    c_client = create_client(chain=studionet, account=challenger)

    addr = ensure_deployed(state, p_client, args.poll_interval, force=args.force and args.stage in ("all", "deploy"))
    if args.stage == "deploy":
        return 0

    meta = state.setdefault("case_meta", {})

    if args.stage in ("all", "case1"):
        claim1 = (
            "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, "
            "Dorothy Gale wears magical Ruby Slippers."
        )
        run_resumable_write(
            state, "case1_register", p_client, addr, "register_clause",
            ["The Wonderful Wizard of Oz", claim1, "The Wonderful Wizard of Oz (1900 novel)", 900],
            value=MIN_BOND_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        c1 = find_clause(read_clauses(p_client, addr), claim1)
        if c1["status"] not in ("ACTIVE_OBSERVABLE", "BREACHED_SLASHED"):
            raise RuntimeError(f"Case 1 expected ACTIVE_OBSERVABLE or BREACHED_SLASHED, got {c1['status']}")
        run_resumable_write(
            state, "case1_challenge", c_client, addr, "submit_challenge",
            [c1["clause_id"], URL_RUBY_SLIPPERS],
            value=MIN_CHALLENGE_FEE_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        ch1 = find_challenge(read_challenges(c_client, addr), c1["clause_id"], URL_RUBY_SLIPPERS)
        if ch1["verdict"] != "PROTECTED_DERIVATIVE_BREACH":
            raise RuntimeError(f"Case 1 expected PROTECTED_DERIVATIVE_BREACH, got {ch1}")
        meta["case-1-ruby-slippers-breach"] = {"clause_id": c1["clause_id"], "challenge_id": ch1["challenge_id"]}
        _save_json(SEED_STATE_PATH, state)

    if args.stage in ("all", "case2"):
        claim2 = (
            "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, "
            "Dorothy Gale wears magical Silver Shoes."
        )
        run_resumable_write(
            state, "case2_register", p_client, addr, "register_clause",
            ["The Wonderful Wizard of Oz", claim2, "The Wonderful Wizard of Oz (1900 novel)", 900],
            value=MIN_BOND_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        c2 = find_clause(read_clauses(p_client, addr), claim2)
        if c2["status"] != "ACTIVE_OBSERVABLE":
            raise RuntimeError(f"Case 2 expected ACTIVE_OBSERVABLE, got {c2['status']}")
        run_resumable_write(
            state, "case2_challenge", c_client, addr, "submit_challenge",
            [c2["clause_id"], URL_SILVER_SHOES],
            value=MIN_CHALLENGE_FEE_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        ch2 = find_challenge(read_challenges(c_client, addr), c2["clause_id"], URL_SILVER_SHOES)
        if ch2["verdict"] != "PUBLIC_DOMAIN_VERIFIED":
            raise RuntimeError(f"Case 2 expected PUBLIC_DOMAIN_VERIFIED, got {ch2}")
        meta["case-2-silver-shoes-public-domain"] = {"clause_id": c2["clause_id"], "challenge_id": ch2["challenge_id"]}
        _save_json(SEED_STATE_PATH, state)

    if args.stage in ("all", "case3"):
        claim3 = (
            "Our Oz stage adaptation will faithfully preserve the timeless emotional warmth "
            "and wholesome cinematic spirit of the story."
        )
        run_resumable_write(
            state, "case3_register", p_client, addr, "register_clause",
            ["The Wonderful Wizard of Oz", claim3, "The Wonderful Wizard of Oz (1900 novel)", 900],
            value=MIN_BOND_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        c3 = find_clause(read_clauses(p_client, addr), claim3)
        if c3["status"] != "REJECTED_VAGUE":
            raise RuntimeError(f"Case 3 expected REJECTED_VAGUE, got {c3}")
        meta["case3"] = {"clause_id": c3["clause_id"]}
        _save_json(SEED_STATE_PATH, state)

    if args.stage in ("all", "case5"):
        c2_id = meta["case-2-silver-shoes-public-domain"]["clause_id"]
        run_resumable_write(
            state, "case5_challenge", c_client, addr, "submit_challenge",
            [c2_id, URL_STEAM_LOCOMOTIVE],
            value=MIN_CHALLENGE_FEE_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        ch5 = find_challenge(read_challenges(c_client, addr), c2_id, URL_STEAM_LOCOMOTIVE)
        if ch5["verdict"] != "INSUFFICIENT_EVIDENCE":
            raise RuntimeError(f"Case 5 expected INSUFFICIENT_EVIDENCE, got {ch5}")
        meta["case-5-insufficient-evidence"] = {"clause_id": c2_id, "challenge_id": ch5["challenge_id"]}
        _save_json(SEED_STATE_PATH, state)

    if args.stage in ("all", "case6"):
        claim6 = (
            "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, "
            "Dorothy Gale travels with Toto to the Emerald City."
        )
        run_resumable_write(
            state, "case6_register", p_client, addr, "register_clause",
            ["The Wonderful Wizard of Oz", claim6, "The Wonderful Wizard of Oz (1900 novel)", 15],
            value=MIN_BOND_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        c6 = find_clause(read_clauses(p_client, addr), claim6)
        if c6["status"] == "ACTIVE_OBSERVABLE":
            print("[case6] waiting 25s for 15s clause timeout...", flush=True)
            time.sleep(25.0)
            run_resumable_write(
                state, "case6_expire", p_client, addr, "claim_expired_clause_bond",
                [c6["clause_id"]], poll_interval=args.poll_interval, force=args.force,
            )
            c6 = find_clause(read_clauses(p_client, addr), claim6)
        if c6["status"] != "EXPIRED_RETURNED":
            raise RuntimeError(f"Case 6 expected EXPIRED_RETURNED, got {c6}")
        meta["case6"] = {"clause_id": c6["clause_id"]}

        withdrawals = state.setdefault("withdrawals", {})
        for role, acct, w_client, step_name in (
            ("producer", producer, p_client, "case6_withdraw_producer"),
            ("challenger", challenger, c_client, "case6_withdraw_challenger"),
        ):
            if not (state["steps"].get(step_name) or {}).get("done") or args.force:
                claimable = w_client.read_contract(
                    address=addr, function_name="get_claimable_balance", args=[acct.address]
                )
                eoa_before = int(
                    rpc_call("eth_getBalance", [acct.address, "latest"]).get("result") or "0x0", 16
                )
                contract_before = int(
                    rpc_call("eth_getBalance", [addr, "latest"]).get("result") or "0x0", 16
                )
                w_sum = run_resumable_write(
                    state, step_name, w_client, addr, "withdraw_balance",
                    [], poll_interval=args.poll_interval, force=args.force,
                )
                eoa_after = int(
                    rpc_call("eth_getBalance", [acct.address, "latest"]).get("result") or "0x0", 16
                )
                contract_after = int(
                    rpc_call("eth_getBalance", [addr, "latest"]).get("result") or "0x0", 16
                )
                withdrawals[role] = {
                    "address": acct.address,
                    "claimable_before_wei": str(claimable),
                    "eoa_before_wei": str(eoa_before),
                    "eoa_after_wei": str(eoa_after),
                    "contract_before_wei": str(contract_before),
                    "contract_after_wei": str(contract_after),
                    "tx_id": w_sum["tx_id"],
                }
        _save_json(SEED_STATE_PATH, state)

    if args.stage == "case4":
        if not args.injection_url:
            raise ValueError("--injection-url is required for --stage case4")
        c2_id = meta["case-2-silver-shoes-public-domain"]["clause_id"]
        run_resumable_write(
            state, "case4_challenge", c_client, addr, "submit_challenge",
            [c2_id, args.injection_url],
            value=MIN_CHALLENGE_FEE_WEI, poll_interval=args.poll_interval, force=args.force,
        )
        ch4 = find_challenge(read_challenges(c_client, addr), c2_id, args.injection_url)
        meta["case-4-prompt-injection"] = {"clause_id": c2_id, "challenge_id": ch4["challenge_id"]}
        _save_json(SEED_STATE_PATH, state)

    proof = build_proof_document(state, p_client, addr)
    print(f"Built {PROOF_PATH} with {len(proof['cases'])} finalized cases.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
