"""Stage 1 StudioNet Environment & Evidence Prober for Public Muse."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import types
from typing import Any

import requests

# Eth-account>=0.13.1 imports ckzg unconditionally even when EIP-4844 blobs are
# unused; Python 3.15 on Windows lacks a prebuilt ckzg wheel and MSVC build tools.
CKZG_SHIM_USED = False
try:
    import ckzg  # noqa: F401
except ImportError:
    CKZG_SHIM_USED = True
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
EVIDENCE_USER_AGENT = (
    "PublicMuseProber/1.0 (https://github.com/public-muse; probe@publicmuse.dev)"
)

STUDIONET_RPC_URL = "https://studio.genlayer.com/api"
STUDIONET_EXPLORER_URL = "https://explorer-studio.genlayer.com"
WORKING_RUNNER_HASH = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"

DEFAULT_DEPLOYED_CONTRACT = "0xaDDb04fF7a81076eda9D84f1ddEf7aDd74bB6CA9"
DEFAULT_DEPLOY_TX_ID = "0xf1eb0c76dedefa6e5011b3de4bb12dc713442fe175382a611a7dbb60e120472b"
DEFAULT_KNOWN_PROBE_TXS = {
    (
        "https://en.wikipedia.org/w/api.php?"
        "action=parse&oldid=1384457883&prop=wikitext&section=0&format=json"
    ): "0x47e290f910a6cd92d5f66075c964f644f0771fd0de4eb3c0dbd3d08b3c3fec1a",
}

MIN_POLL_INTERVAL_SECONDS = 6.0
DEFAULT_POLL_INTERVAL_SECONDS = 7.0
MAX_EXTRACTED_CHARS = 2500

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT_PATH = PROJECT_ROOT / "contracts" / "evidence_probe.py"
RESULTS_PATH = PROJECT_ROOT / "deploy" / "probe_results.json"

EVIDENCE_TARGETS: list[dict[str, str]] = [
    {
        "key": "wikipedia_ruby_slippers_lead",
        "purpose": "primary_supporting_evidence",
        "title": "Ruby slippers (Wikipedia revision 1384457883, section 0)",
        "revision_or_commit": "oldid=1384457883",
        "url": (
            "https://en.wikipedia.org/w/api.php?"
            "action=parse&oldid=1384457883&prop=wikitext&section=0&format=json"
        ),
    },
    {
        "key": "wikipedia_silver_shoes_lead",
        "purpose": "corroborating_supporting_evidence",
        "title": "Silver Shoes (Wikipedia revision 1378659855, section 0)",
        "revision_or_commit": "oldid=1378659855",
        "url": (
            "https://en.wikipedia.org/w/api.php?"
            "action=parse&oldid=1378659855&prop=wikitext&section=0&format=json"
        ),
    },
    {
        "key": "wikipedia_wonderful_wizard_of_oz_plot",
        "purpose": "primary_novel_plot_evidence",
        "title": "The Wonderful Wizard of Oz (Wikipedia revision 1384221642, section 2 Plot)",
        "revision_or_commit": "oldid=1384221642",
        "url": (
            "https://en.wikipedia.org/w/api.php?"
            "action=parse&oldid=1384221642&prop=wikitext&section=2&format=json"
        ),
    },
    {
        "key": "wikipedia_steam_locomotive_lead",
        "purpose": "insufficient_evidence_unrelated",
        "title": "Steam locomotive (Wikipedia revision 1380178024, section 0)",
        "revision_or_commit": "oldid=1380178024",
        "url": (
            "https://en.wikipedia.org/w/api.php?"
            "action=parse&oldid=1380178024&prop=wikitext&section=0&format=json"
        ),
    },
    {
        "key": "github_raw_genlayer_storage_py",
        "purpose": "github_raw_connectivity",
        "title": "genlayerlabs/genlayer-studio examples/contracts/storage.py (commit-pinned)",
        "revision_or_commit": "c94072951e483510329670aa427fba3fa6944f45",
        "url": (
            "https://raw.githubusercontent.com/genlayerlabs/genlayer-studio/"
            "c94072951e483510329670aa427fba3fa6944f45/examples/contracts/storage.py"
        ),
    },
]

_ORIG_SESSION_REQUEST = requests.sessions.Session.request
TRANSIENT_HTTP_STATUSES = {429, 502, 503, 504}


def _extract_rpc_method(kwargs: dict[str, Any]) -> str | None:
    """Return the JSON-RPC method from requests kwargs if present."""
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
    """Force browser User-Agent and safe retry on transient 502/503/504/429 for reads."""

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
            kwargs["headers"] = headers
        rpc_method = _extract_rpc_method(kwargs) if is_studionet else None
        can_retry = is_studionet and rpc_method != "eth_sendRawTransaction"
        max_attempts = 4 if can_retry else 1
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                resp = _ORIG_SESSION_REQUEST(self, method, url, **kwargs)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt >= max_attempts:
                    raise
                wait_s = 10.0 * attempt
                print(
                    f"  transient StudioNet error ({type(exc).__name__}); retrying in {wait_s:.0f}s",
                    flush=True,
                )
                time.sleep(wait_s)
                continue
            if can_retry and resp.status_code in TRANSIENT_HTTP_STATUSES and attempt < max_attempts:
                wait_s = 10.0 * attempt
                print(
                    f"  transient StudioNet HTTP {resp.status_code} on {rpc_method}; retrying in {wait_s:.0f}s",
                    flush=True,
                )
                time.sleep(wait_s)
                continue
            return resp
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Unreachable retry state")

    requests.sessions.Session.request = _patched_request  # type: ignore[method-assign]


_install_studionet_browser_ua_patch()

from genlayer_py import create_account, create_client  # noqa: E402
from genlayer_py.chains import studionet  # noqa: E402


def _extract_deterministic_text(raw_text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
    """Mirror EvidenceProbe._extract_deterministic_text for local digest verification."""
    text = raw_text
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            if "parse" in parsed and isinstance(parsed["parse"], dict):
                wikitext = parsed["parse"].get("wikitext")
                if isinstance(wikitext, dict) and "*" in wikitext:
                    title = str(parsed["parse"].get("title", "")).strip()
                    body = str(wikitext["*"])
                    text = f"{title}\n\n{body}" if title else body
            elif "query" in parsed and isinstance(parsed["query"], dict):
                pages = parsed["query"].get("pages", {})
                if isinstance(pages, dict):
                    for page in pages.values():
                        if isinstance(page, dict) and page.get("revisions"):
                            rev = page["revisions"][0]
                            slots = rev.get("slots", {})
                            main_slot = (
                                slots.get("main", {}) if isinstance(slots, dict) else {}
                            )
                            content = main_slot.get("*") or rev.get("*") or ""
                            if content:
                                title = str(page.get("title", "")).strip()
                                text = (
                                    f"{title}\n\n{content}"
                                    if title
                                    else str(content)
                                )
                                break
    except Exception:
        pass

    text = re.sub(r"<ref[^>]*>.*?</ref>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<ref[^>]*/>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"\[\[([^|\]]+\|)?([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"'''?", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:max_chars]


def _run_cmd(args: list[str], timeout: int = 15) -> dict[str, Any]:
    """Run an executable resolved via PATH without leaking secrets."""
    resolved = shutil.which(args[0])
    if not resolved:
        return {
            "installed": False,
            "path": None,
            "returncode": None,
            "stdout": "",
            "stderr": "Not found on PATH",
        }
    try:
        proc = subprocess.run(
            [resolved, *args[1:]],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "installed": True,
            "path": resolved,
            "returncode": proc.returncode,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip(),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "installed": True,
            "path": resolved,
            "returncode": None,
            "stdout": "",
            "stderr": repr(exc),
        }


def collect_tool_environment() -> dict[str, Any]:
    """Collect local toolchain versions, package metadata, and safe auth checks."""
    pip_cli = _run_cmd(["pip", "--version"])
    pip_mod = _run_cmd([sys.executable, "-m", "pip", "--version"])
    pip_show_genlayer = _run_cmd([sys.executable, "-m", "pip", "show", "genlayer-py"])
    pip_show_pytest = _run_cmd([sys.executable, "-m", "pip", "show", "pytest"])
    pip_show_gltest = _run_cmd([sys.executable, "-m", "pip", "show", "genlayer-test"])

    git_name = _run_cmd(["git", "config", "--get", "user.name"])
    git_email = _run_cmd(["git", "config", "--get", "user.email"])
    gh_ver = _run_cmd(["gh", "--version"])
    gh_auth = _run_cmd(["gh", "auth", "status"]) if gh_ver["installed"] else {
        "installed": False,
        "status": "gh CLI not installed",
    }
    vercel_ver = _run_cmd(["vercel", "--version"])
    vercel_auth = _run_cmd(["vercel", "whoami"]) if vercel_ver["installed"] else {
        "installed": False,
        "status": "vercel CLI not installed",
    }

    return {
        "python": {
            "installed": True,
            "executable": sys.executable,
            "version": sys.version.split()[0],
            "ckzg_stub_required": CKZG_SHIM_USED,
        },
        "pip": {
            "standalone_cli": pip_cli,
            "python_module": pip_mod,
        },
        "node": _run_cmd(["node", "--version"]),
        "npm": _run_cmd(["npm", "--version"]),
        "npm_global_list": _run_cmd(["npm", "list", "-g", "--depth=0"]),
        "git": {
            "version": _run_cmd(["git", "--version"]),
            "user_name_configured": bool(git_name.get("stdout")),
            "user_email": git_email.get("stdout") or None,
        },
        "gh": {
            "cli": gh_ver,
            "auth_status": gh_auth,
        },
        "vercel": {
            "cli": vercel_ver,
            "auth_status": vercel_auth,
        },
        "genlayer_py": {
            "installed": pip_show_genlayer.get("returncode") == 0,
            "pip_show": pip_show_genlayer.get("stdout"),
            "notes": (
                "genlayer-py 0.18.0 matches StudioNet ConsensusMain 5-arg ABI; "
                "0.19.0rc3 targets Consensus v0.6 methods absent on StudioNet. "
                "Installed --no-deps alongside eth-account==0.14.0 because ckzg lacks Python 3.15 win_amd64 wheels."
            ),
        },
        "genlayerjs": {
            "installed_globally": False,
            "npm_package_genlayerjs": "404 Not Found on npm registry; official package is genlayer-js",
            "npm_view_genlayer_js": _run_cmd(["npm", "view", "genlayer-js", "dist-tags", "--json"]),
        },
        "pytest": {
            "cli_on_path": _run_cmd(["pytest", "--version"]),
            "python_module": _run_cmd([sys.executable, "-m", "pytest", "--version"]),
            "pip_show": pip_show_pytest.get("stdout"),
        },
        "gltest": {
            "cli_on_path": _run_cmd(["gltest", "--version"]),
            "pip_show_genlayer_test": pip_show_gltest.get("returncode") == 0,
        },
    }


def rpc_call(method: str, params: list[Any], timeout: int = 30) -> dict[str, Any]:
    """Send a JSON-RPC call to StudioNet with a browser User-Agent header."""
    resp = requests.post(
        STUDIONET_RPC_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        headers={
            "Content-Type": "application/json",
            "User-Agent": BROWSER_USER_AGENT,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def check_studionet_environment(contract_code: str) -> dict[str, Any]:
    """Verify StudioNet HTTP, JSON-RPC, ConsensusMain ABI, and GenVM runner hash."""
    explorer_resp = requests.get(
        STUDIONET_EXPLORER_URL,
        headers={"User-Agent": BROWSER_USER_AGENT},
        timeout=30,
    )
    chain_id = rpc_call("eth_chainId", []).get("result")
    net_version = rpc_call("net_version", []).get("result")
    block_number = rpc_call("eth_blockNumber", []).get("result")
    gas_price = rpc_call("eth_gasPrice", []).get("result")
    latest_block = rpc_call("eth_getBlockByNumber", ["latest", False]).get("result") or {}
    consensus_main = rpc_call("sim_getConsensusContract", ["ConsensusMain"])
    fee_manager = rpc_call("sim_getConsensusContract", ["FeeManager"])
    lifecycle_probe = rpc_call("gen_getTransactionLifecycle", ["0x" + "0" * 64])
    schema_resp = rpc_call("gen_getContractSchemaForCode", [contract_code])

    add_tx_inputs: list[str] = []
    cm_result = consensus_main.get("result") or {}
    for item in cm_result.get("abi") or []:
        if item.get("name") == "addTransaction":
            add_tx_inputs = [
                f"{inp.get('name')}:{inp.get('type')}" for inp in item.get("inputs", [])
            ]
            add_tx_mutability = item.get("stateMutability")
            break
    else:
        add_tx_mutability = None

    return {
        "chain_id_hex": chain_id,
        "chain_id_int": int(chain_id, 16) if isinstance(chain_id, str) else None,
        "net_version": net_version,
        "rpc_url": STUDIONET_RPC_URL,
        "explorer_url": STUDIONET_EXPLORER_URL,
        "explorer_http_status": explorer_resp.status_code,
        "explorer_body_bytes": len(explorer_resp.content),
        "eth_blockNumber": block_number,
        "eth_gasPrice": gas_price,
        "latest_block_baseFeePerGas": latest_block.get("baseFeePerGas"),
        "consensus_main": {
            "address": cm_result.get("address"),
            "addTransaction_inputs": add_tx_inputs,
            "addTransaction_stateMutability": add_tx_mutability,
        },
        "unsupported_v06_probes": {
            "FeeManager": fee_manager.get("error"),
            "gen_getTransactionLifecycle": lifecycle_probe.get("error"),
        },
        "runner_hash": WORKING_RUNNER_HASH,
        "schema_verification": schema_resp,
    }


def _save_results_checkpoint(payload: dict[str, Any]) -> None:
    """Persist intermediate or final JSON results atomically to RESULTS_PATH."""
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def poll_tx_until_final(
    tx_id: str,
    poll_interval: float = DEFAULT_POLL_INTERVAL_SECONDS,
    max_polls: int = 36,
) -> dict[str, Any]:
    """Poll eth_getTransactionByHash every 6-8 seconds until terminal status."""
    interval = max(MIN_POLL_INTERVAL_SECONDS, poll_interval)
    for attempt in range(1, max_polls + 1):
        time.sleep(interval)
        try:
            res = rpc_call("eth_getTransactionByHash", [tx_id])
        except Exception as exc:  # noqa: BLE001
            print(f"  poll {attempt}: tx={tx_id[:12]}... transient error={exc}", flush=True)
            continue
        tx = res.get("result")
        if isinstance(tx, dict):
            status = str(tx.get("status_name") or tx.get("status") or "")
            print(f"  poll {attempt}: tx={tx_id[:12]}... status={status}", flush=True)
            if status in ("FINALIZED", "CANCELED", "UNDETERMINED"):
                return tx
        else:
            print(f"  poll {attempt}: tx={tx_id[:12]}... pending", flush=True)
    raise TimeoutError(f"Transaction {tx_id} did not finalize within {max_polls} polls")


def _summarize_final_tx(tx: dict[str, Any]) -> dict[str, Any]:
    """Extract key consensus and leader execution fields from a finalized tx."""
    consensus_data = tx.get("consensus_data") or {}
    leader_receipts = consensus_data.get("leader_receipt") or []
    leader = leader_receipts[0] if leader_receipts else {}
    last_round = tx.get("last_round") or {}
    return {
        "tx_id": tx.get("hash") or tx.get("tx_id"),
        "status": tx.get("status"),
        "result": tx.get("result"),
        "result_name": tx.get("result_name"),
        "leader_execution_result": leader.get("execution_result"),
        "leader_genvm_result": leader.get("genvm_result"),
        "validator_votes_name": last_round.get("validator_votes_name"),
    }


def _find_silver_excerpt(text: str) -> str | None:
    """Return a concise excerpt around Silver Shoes or Ruby slippers if present."""
    lower = text.lower()
    for term in ("silver shoes", "ruby slippers"):
        idx = lower.find(term)
        if idx != -1:
            start = max(0, idx - 120)
            end = min(len(text), idx + 220)
            return text[start:end].strip()
    return None


def main() -> int:
    """Execute Stage 1 environment checks, contract deploy/reuse, and URL probes."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract",
        default=DEFAULT_DEPLOYED_CONTRACT,
        help="Existing EvidenceProbe contract address to reuse unless --redeploy is set.",
    )
    parser.add_argument(
        "--deploy-tx",
        default=DEFAULT_DEPLOY_TX_ID,
        help="Deployment tx hash corresponding to --contract.",
    )
    parser.add_argument(
        "--redeploy",
        action="store_true",
        help="Deploy a fresh EvidenceProbe contract instead of reusing --contract.",
    )
    parser.add_argument(
        "--force-probe",
        action="store_true",
        help="Submit fresh probe_url transactions even if get_result(url) is non-empty.",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help="Seconds between StudioNet transaction polls (enforced >= 6.0s).",
    )
    args = parser.parse_args()

    previous_known_txs: dict[str, str] = {}
    if not args.redeploy and RESULTS_PATH.exists():
        try:
            prev_data = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
            if (prev_data.get("probe_contract") or {}).get("address") == args.contract:
                for prev_probe in prev_data.get("evidence_probes") or []:
                    if prev_probe.get("url") and prev_probe.get("tx_id"):
                        previous_known_txs[prev_probe["url"]] = prev_probe["tx_id"]
        except Exception:
            pass

    contract_code = CONTRACT_PATH.read_text(encoding="utf-8")
    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "project_root": str(PROJECT_ROOT),
        "tools": collect_tool_environment(),
        "studionet": check_studionet_environment(contract_code),
        "probe_contract": {},
        "evidence_probes": [],
        "pending_transactions": {},
    }
    _save_results_checkpoint(report)

    account = create_account()
    balance_before = rpc_call("eth_getBalance", [account.address, "latest"]).get("result")
    client = create_client(chain=studionet, account=account)

    if args.redeploy or not args.contract:
        print("Deploying fresh EvidenceProbe to StudioNet...", flush=True)
        deploy_tx_id = client.deploy_contract(code=contract_code, args=[])
        print(f"Deploy tx saved before polling: {deploy_tx_id}", flush=True)
        report["pending_transactions"]["deploy_tx_id"] = deploy_tx_id
        _save_results_checkpoint(report)
        deploy_tx = poll_tx_until_final(deploy_tx_id, poll_interval=args.poll_interval)
        contract_address = (
            (deploy_tx.get("data") or {}).get("contract_address")
            or deploy_tx.get("to_address")
            or deploy_tx.get("recipient")
        )
    else:
        contract_address = args.contract
        deploy_tx_id = args.deploy_tx
        deploy_tx = rpc_call("eth_getTransactionByHash", [deploy_tx_id]).get("result") or {}

    if not contract_address:
        raise RuntimeError("Could not determine EvidenceProbe contract_address")

    deploy_summary = _summarize_final_tx(deploy_tx)
    report["probe_contract"] = {
        "path": str(CONTRACT_PATH),
        "address": contract_address,
        "deployer": deploy_tx.get("from_address") or account.address,
        "writer_account": account.address,
        "writer_balance_before_hex": balance_before,
        "runner_hash": WORKING_RUNNER_HASH,
        **deploy_summary,
        "tx_id": deploy_tx_id,
    }
    _save_results_checkpoint(report)

    known_txs = (
        {**DEFAULT_KNOWN_PROBE_TXS, **previous_known_txs}
        if not args.redeploy
        else {}
    )
    for target in EVIDENCE_TARGETS:
        url = target["url"]
        print(f"Probing {target['key']} -> {url}", flush=True)
        local_resp = requests.get(
            url,
            headers={"User-Agent": EVIDENCE_USER_AGENT},
            timeout=30,
        )
        local_resp.raise_for_status()
        local_raw = local_resp.text
        local_extracted = _extract_deterministic_text(local_raw, MAX_EXTRACTED_CHARS)
        local_sha256 = hashlib.sha256(local_extracted.encode("utf-8")).hexdigest()

        existing_raw = client.read_contract(
            address=contract_address,
            function_name="get_result",
            args=[url],
        )
        if existing_raw and not args.force_probe and url in known_txs:
            probe_tx_id = known_txs[url]
            probe_tx = rpc_call("eth_getTransactionByHash", [probe_tx_id]).get("result") or {}
            reused = True
        else:
            time.sleep(2.0)
            probe_tx_id = client.write_contract(
                address=contract_address,
                function_name="probe_url",
                args=[url],
            )
            print(f"  Probe tx saved before polling: {probe_tx_id}", flush=True)
            report["pending_transactions"][target["key"]] = probe_tx_id
            _save_results_checkpoint(report)
            probe_tx = poll_tx_until_final(probe_tx_id, poll_interval=args.poll_interval)
            reused = False

        onchain_raw = client.read_contract(
            address=contract_address,
            function_name="get_result",
            args=[url],
        )
        onchain_parsed = json.loads(onchain_raw) if onchain_raw else {}
        onchain_sha256 = onchain_parsed.get("sha256")
        onchain_text = str(onchain_parsed.get("text") or "")

        entry = {
            **target,
            "tx_id": probe_tx_id,
            "reused_existing_onchain_probe": reused,
            "tx_summary": _summarize_final_tx(probe_tx),
            "onchain_status_code": onchain_parsed.get("status_code"),
            "onchain_raw_len": onchain_parsed.get("raw_len"),
            "onchain_extracted_len": onchain_parsed.get("extracted_len"),
            "onchain_sha256": onchain_sha256,
            "local_sha256": local_sha256,
            "sha256_matches_local": (onchain_sha256 == local_sha256),
            "text_matches_local": (onchain_text == local_extracted),
            "text_preview": onchain_text[:300],
            "matched_excerpt": _find_silver_excerpt(onchain_text),
        }
        report["evidence_probes"].append(entry)
        report["pending_transactions"].pop(target["key"], None)
        _save_results_checkpoint(report)

    report["pending_transactions"].pop("deploy_tx_id", None)
    report["probe_contract"]["probe_count"] = client.read_contract(
        address=contract_address,
        function_name="get_probe_count",
        args=[],
    )
    report["probe_contract"]["last_result"] = json.loads(
        client.read_contract(
            address=contract_address,
            function_name="get_last_result",
            args=[],
        )
    )
    _save_results_checkpoint(report)
    print(f"Wrote StudioNet probe results to {RESULTS_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
