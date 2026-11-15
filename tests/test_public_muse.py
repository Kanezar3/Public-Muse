import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import types
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = PROJECT_ROOT / "contracts" / "public_muse.py"
FIXTURE_OZ_PATH = PROJECT_ROOT / "fixtures" / "prompt_injection_oz.txt"


class MockUserError(Exception):
    pass


class MockAddress:
    def __init__(self, hex_addr: str):
        self.as_hex = hex_addr.lower()

    def __str__(self) -> str:
        return self.as_hex

    def __eq__(self, other: object) -> bool:
        if isinstance(other, MockAddress):
            return self.as_hex == other.as_hex
        return self.as_hex == str(other).lower()

    def __hash__(self) -> int:
        return hash(self.as_hex)


class MockTreeMap(dict):
    pass


class MockDynArray(list):
    pass


class MockEvent:
    emitted_events: list = []

    def emit(self) -> None:
        MockEvent.emitted_events.append(self)


class MockWebResponse:
    def __init__(self, status: int, body: bytes):
        self.status = status
        self.body = body


class MockContractProxy:
    def __init__(self, target):
        self.target = target

    def emit_transfer(self, value: int, on: str = "finalized") -> None:
        MockRuntime.transfers.append(
            {
                "to": str(self.target),
                "value": int(value),
                "on": on,
            }
        )


class MockRuntime:
    sender = MockAddress("0x1111111111111111111111111111111111111111")
    value = 0
    datetime_str = "2026-11-14T20:00:00Z"
    web_responses: dict[str, MockWebResponse] = {}
    prompt_handler = None
    transfers: list[dict] = []

    @classmethod
    def reset(cls) -> None:
        cls.sender = MockAddress("0x1111111111111111111111111111111111111111")
        cls.value = 0
        cls.datetime_str = "2026-11-14T20:00:00Z"
        cls.web_responses = {}
        cls.prompt_handler = None
        cls.transfers = []
        MockEvent.emitted_events = []


def _install_mock_genlayer():
    gl_mod = types.ModuleType("genlayer")

    class _BaseContract:
        pass

    def _identity_decorator(fn):
        return fn

    class _PublicWrite:
        def __call__(self, fn):
            return fn

        def payable(self, fn):
            return fn

    gl_mod.Contract = _BaseContract
    gl_mod.public = types.SimpleNamespace(
        view=_identity_decorator,
        write=_PublicWrite(),
    )
    gl_mod.vm = types.SimpleNamespace(UserError=MockUserError)
    gl_mod.Event = MockEvent
    gl_mod.chain = types.SimpleNamespace(Event=MockEvent)

    def _web_get(url: str, headers=None):
        if url not in MockRuntime.web_responses:
            return MockWebResponse(404, b"Not Found")
        return MockRuntime.web_responses[url]

    def _exec_prompt(prompt: str, images=None, response_format=None):
        if MockRuntime.prompt_handler is None:
            raise RuntimeError("MockRuntime.prompt_handler is not configured")
        return MockRuntime.prompt_handler(prompt, response_format)

    gl_mod.nondet = types.SimpleNamespace(
        web=types.SimpleNamespace(get=_web_get),
        exec_prompt=_exec_prompt,
    )
    gl_mod.eq_principle = types.SimpleNamespace(
        strict_eq=lambda fn: fn(),
        prompt_comparative=lambda fn, criteria: fn(),
    )
    gl_mod.evm = types.SimpleNamespace(contract_interface=lambda cls: MockContractProxy)
    gl_mod.get_contract_at = lambda addr: MockContractProxy(addr)

    class _DynamicMessage:
        @property
        def sender_address(self):
            return MockRuntime.sender

        @property
        def value(self):
            return MockRuntime.value

    class _DynamicMessageRaw:
        def get(self, key, default=None):
            if key == "datetime":
                return MockRuntime.datetime_str
            return default

        def __getitem__(self, key):
            if key == "datetime":
                return MockRuntime.datetime_str
            raise KeyError(key)

    gl_mod.message = _DynamicMessage()
    gl_mod.message_raw = _DynamicMessageRaw()

    class _GenericType:
        def __class_getitem__(cls, item):
            return cls

    module_obj = types.ModuleType("genlayer")
    module_obj.gl = gl_mod
    module_obj.Address = MockAddress
    module_obj.u256 = int
    module_obj.TreeMap = MockTreeMap
    module_obj.DynArray = MockDynArray

    sys.modules["genlayer"] = module_obj

    spec = importlib.util.spec_from_file_location("public_muse_contract", CONTRACT_PATH)
    contract_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract_module)
    return contract_module


pm = _install_mock_genlayer()


def _new_contract(min_bond: int = 100, min_fee: int = 50, timeout: int = 3600):
    MockRuntime.reset()
    contract = pm.PublicMuse(
        min_bond_wei=min_bond,
        min_challenge_fee_wei=min_fee,
        default_timeout_seconds=timeout,
    )
    contract.clauses = MockTreeMap()
    contract.clause_ids = MockDynArray()
    contract.challenges = MockTreeMap()
    contract.challenge_ids = MockDynArray()
    contract.claimable_balances = MockTreeMap()
    return contract


def test_url_immutability_validator():
    # Valid immutable URLs
    assert pm.is_valid_immutable_url(
        "https://en.wikipedia.org/w/api.php?action=parse&oldid=1384457883&prop=wikitext&section=0&format=json"
    )
    assert pm.is_valid_immutable_url(
        "https://raw.githubusercontent.com/genlayerlabs/genlayer-studio/c94072951e483510329670aa427fba3fa6944f45/examples/contracts/storage.py"
    )
    assert pm.is_valid_immutable_url(
        "https://web.archive.org/web/20240101120000id_/https://example.com/archive.txt"
    )

    # Mutable / invalid URLs rejected
    assert not pm.is_valid_immutable_url(
        "https://en.wikipedia.org/w/api.php?action=parse&page=Ruby_slippers&format=json"
    )
    assert not pm.is_valid_immutable_url(
        "https://en.wikipedia.org/w/api.php?action=parse&oldid=1384457883&page=Ruby_slippers&format=json"
    )
    assert not pm.is_valid_immutable_url(
        "https://en.wikipedia.org/w/api.php?action=parse&format=json"
    )
    assert not pm.is_valid_immutable_url(
        "https://raw.githubusercontent.com/genlayerlabs/genlayer-studio/main/examples/contracts/storage.py"
    )
    assert not pm.is_valid_immutable_url(
        "https://raw.githubusercontent.com/genlayerlabs/genlayer-studio/c9407295/examples/contracts/storage.py"
    )
    assert not pm.is_valid_immutable_url(
        "https://web.archive.org/web/20240101120000/https://example.com/archive.txt"
    )
    assert not pm.is_valid_immutable_url("http://en.wikipedia.org/w/api.php?action=parse&oldid=1&format=json")
    assert not pm.is_valid_immutable_url("")


def test_deterministic_extraction_and_sha256():
    payload = {
        "parse": {
            "title": "Ruby slippers",
            "wikitext": {
                "*": "The [[ruby slippers]] were worn in ''The Wizard of Oz'' (1939).<ref>citation</ref> <!-- comment -->"
            },
        }
    }
    extracted = pm._extract_deterministic_text(json.dumps(payload))
    assert extracted == "Ruby slippers\n\nThe ruby slippers were worn in The Wizard of Oz (1939)."
    assert len(extracted) <= pm.MAX_EXTRACTED_CHARS
    expected_sha = hashlib.sha256(extracted.encode("utf-8")).hexdigest()
    assert len(expected_sha) == 64

    long_text = "A" * 5000
    assert len(pm._extract_deterministic_text(long_text)) == pm.MAX_EXTRACTED_CHARS


def test_quote_inclusion_validation():
    evidence = "The Good Witch gives Dorothy the magical silver shoes from the 1900 novel."
    valid = pm._validate_challenge_payload(
        {
            "verdict": "PUBLIC_DOMAIN_VERIFIED",
            "quote": "magical silver shoes from the 1900 novel",
            "summary": "Matches 1900 novel.",
        },
        evidence,
    )
    assert valid["verdict"] == "PUBLIC_DOMAIN_VERIFIED"

    with pytest.raises(ValueError, match="QUOTE_TOO_SHORT"):
        pm._validate_challenge_payload(
            {"verdict": "PROTECTED_DERIVATIVE_BREACH", "quote": "silver shoes", "summary": "x"},
            evidence,
        )

    with pytest.raises(ValueError, match="QUOTE_NOT_IN_EVIDENCE"):
        pm._validate_challenge_payload(
            {
                "verdict": "PROTECTED_DERIVATIVE_BREACH",
                "quote": "ruby slippers from 1939 MGM film",
                "summary": "x",
            },
            evidence,
        )

    insuff = pm._validate_challenge_payload(
        {"verdict": "INSUFFICIENT_EVIDENCE", "quote": "not present", "summary": "Unrelated"},
        evidence,
    )
    assert insuff["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert insuff["quote"] == ""


def test_register_clause_observable_and_vague_refund():
    contract = _new_contract()
    producer = MockAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    MockRuntime.sender = producer

    # 1. Invalid bond / empty fields -> REJECTED_INVALID + refundable balance (no revert)
    MockRuntime.value = 25
    res_invalid = json.loads(contract.register_clause("Oz", "", "1900 Novel", 3600))
    assert res_invalid["status"] == "REJECTED_INVALID"
    assert contract.get_claimable_balance(str(producer)) == 25

    # 2. Vague claim -> REJECTED_VAGUE + refundable balance
    MockRuntime.value = 150
    MockRuntime.prompt_handler = lambda prompt, fmt: "REJECTED_VAGUE"
    res_vague = json.loads(
        contract.register_clause("Oz", "Make it feel magical", "1900 Novel", 3600)
    )
    assert res_vague["status"] == "REJECTED_VAGUE"
    assert contract.get_claimable_balance(str(producer)) == 175

    # Withdraw refunded deposits
    wd = json.loads(contract.withdraw_balance())
    assert wd["withdrawn_wei"] == 175
    assert contract.get_claimable_balance(str(producer)) == 0
    assert MockRuntime.transfers[-1] == {
        "to": str(producer),
        "value": 175,
        "on": "finalized",
    }

    # 3. Observable claim -> ACTIVE_OBSERVABLE
    MockRuntime.value = 200
    MockRuntime.prompt_handler = lambda prompt, fmt: "OBSERVABLE"
    res_ok = json.loads(
        contract.register_clause(
            "The Wonderful Wizard of Oz",
            "Dorothy wears Silver Shoes, not Ruby Slippers.",
            "L. Frank Baum 1900 Novel",
            3600,
        )
    )
    assert res_ok["status"] == "ACTIVE_OBSERVABLE"
    assert res_ok["bond_wei"] == 200
    assert len(res_ok["clause_sha256"]) == 64


def test_challenge_verdict_flows_and_payable_safety():
    contract = _new_contract()
    producer = MockAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    challenger = MockAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    MockRuntime.sender = producer
    MockRuntime.value = 500
    MockRuntime.prompt_handler = lambda prompt, fmt: "OBSERVABLE"
    clause = json.loads(
        contract.register_clause(
            "The Wonderful Wizard of Oz",
            "Dorothy wears Silver Shoes from the 1900 novel.",
            "L. Frank Baum 1900 Novel",
            3600,
        )
    )
    cid = clause["clause_id"]

    # Invalid URL -> REJECTED_INVALID and challenger fee refunded to claimable_balances
    MockRuntime.sender = challenger
    MockRuntime.value = 60
    bad_ch = json.loads(
        contract.submit_challenge(
            cid, "https://en.wikipedia.org/w/api.php?action=parse&page=Ruby_slippers&format=json"
        )
    )
    assert bad_ch["status"] == "REJECTED_INVALID"
    assert bad_ch["summary"] == "INVALID_OR_MUTABLE_URL"
    assert contract.get_claimable_balance(str(challenger)) == 60

    # Flow A: PUBLIC_DOMAIN_VERIFIED -> producer receives challenge fee, clause stays ACTIVE_OBSERVABLE
    oz_url = "https://en.wikipedia.org/w/api.php?action=parse&oldid=1384221642&prop=wikitext&section=2&format=json"
    oz_body = json.dumps(
        {
            "parse": {
                "title": "The Wonderful Wizard of Oz",
                "wikitext": {
                    "*": "The Good Witch of the North gives Dorothy the magical silver shoes that originally belonged to the Wicked Witch."
                },
            }
        }
    ).encode("utf-8")
    MockRuntime.web_responses[oz_url] = MockWebResponse(200, oz_body)
    MockRuntime.prompt_handler = lambda prompt, fmt: {
        "verdict": "PUBLIC_DOMAIN_VERIFIED",
        "quote": "magical silver shoes that originally belonged to the Wicked Witch",
        "summary": "1900 novel confirms Silver Shoes.",
    }
    MockRuntime.value = 75
    ch_verified = json.loads(contract.submit_challenge(cid, oz_url))
    assert ch_verified["verdict"] == "PUBLIC_DOMAIN_VERIFIED"
    assert ch_verified["payout_wei"] == 75
    assert contract.get_claimable_balance(str(producer)) == 75
    assert json.loads(contract.get_clause(cid))["status"] == "ACTIVE_OBSERVABLE"

    # Flow B: INSUFFICIENT_EVIDENCE -> challenger receives fee back, clause stays ACTIVE_OBSERVABLE
    steam_url = "https://en.wikipedia.org/w/api.php?action=parse&oldid=1380178024&prop=wikitext&section=0&format=json"
    MockRuntime.web_responses[steam_url] = MockWebResponse(
        200, b"Steam locomotive is a railway locomotive powered by a steam engine."
    )
    MockRuntime.prompt_handler = lambda prompt, fmt: {
        "verdict": "INSUFFICIENT_EVIDENCE",
        "quote": "",
        "summary": "Unrelated article.",
    }
    MockRuntime.value = 80
    ch_insuff = json.loads(contract.submit_challenge(cid, steam_url))
    assert ch_insuff["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert contract.get_claimable_balance(str(challenger)) == 60 + 80
    assert json.loads(contract.get_clause(cid))["status"] == "ACTIVE_OBSERVABLE"

    # Flow C: PROTECTED_DERIVATIVE_BREACH -> challenger receives bond + fee, clause slashed
    ruby_url = "https://en.wikipedia.org/w/api.php?action=parse&oldid=1384457883&prop=wikitext&section=0&format=json"
    MockRuntime.web_responses[ruby_url] = MockWebResponse(
        200,
        b"The ruby slippers are the magic pair of shoes worn by Dorothy Gale in the 1939 MGM musical film.",
    )
    MockRuntime.prompt_handler = lambda prompt, fmt: {
        "verdict": "PROTECTED_DERIVATIVE_BREACH",
        "quote": "magic pair of shoes worn by Dorothy Gale in the 1939 MGM musical film",
        "summary": "1939 MGM film introduced ruby slippers.",
    }
    MockRuntime.value = 90
    ch_breach = json.loads(contract.submit_challenge(cid, ruby_url))
    assert ch_breach["verdict"] == "PROTECTED_DERIVATIVE_BREACH"
    assert ch_breach["payout_wei"] == 500 + 90
    assert contract.get_claimable_balance(str(challenger)) == 60 + 80 + 590
    assert json.loads(contract.get_clause(cid))["status"] == "BREACHED_SLASHED"


def test_prompt_injection_resilience():
    contract = _new_contract()
    producer = MockAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    challenger = MockAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    MockRuntime.sender = producer
    MockRuntime.value = 300
    MockRuntime.prompt_handler = lambda prompt, fmt: "OBSERVABLE"
    clause = json.loads(
        contract.register_clause(
            "The Wonderful Wizard of Oz",
            "Dorothy wears Silver Shoes from the 1900 novel.",
            "L. Frank Baum 1900 Novel",
            3600,
        )
    )
    cid = clause["clause_id"]

    fixture_bytes = FIXTURE_OZ_PATH.read_bytes()
    fixture_url = "https://raw.githubusercontent.com/public-muse/fixtures/0123456789abcdef0123456789abcdef01234567/prompt_injection_oz.txt"
    MockRuntime.web_responses[fixture_url] = MockWebResponse(200, fixture_bytes)

    seen_prompts = []

    def _safe_llm(prompt: str, fmt):
        seen_prompts.append(prompt)
        assert "<UNTRUSTED_EVIDENCE>" in prompt
        assert "</UNTRUSTED_EVIDENCE>" in prompt
        assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in prompt
        return {
            "verdict": "PUBLIC_DOMAIN_VERIFIED",
            "quote": "gives her the magical Silver Shoes that had belonged to the Wicked Witch of the East",
            "summary": "Ignored embedded prompt injection; 1900 novel confirms Silver Shoes.",
        }

    MockRuntime.sender = challenger
    MockRuntime.value = 55
    MockRuntime.prompt_handler = _safe_llm
    res = json.loads(contract.submit_challenge(cid, fixture_url))
    assert len(seen_prompts) == 1
    assert res["verdict"] == "PUBLIC_DOMAIN_VERIFIED"
    assert contract.get_claimable_balance(str(producer)) == 55
    assert contract.get_claimable_balance(str(challenger)) == 0


def test_deadline_fallbacks_and_views():
    contract = _new_contract()
    producer = MockAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    challenger = MockAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    MockRuntime.sender = producer
    MockRuntime.value = 400
    MockRuntime.datetime_str = "2026-11-14T20:00:00Z"
    MockRuntime.prompt_handler = lambda prompt, fmt: "OBSERVABLE"
    clause = json.loads(
        contract.register_clause(
            "Oz",
            "Dorothy wears Silver Shoes.",
            "1900 Novel",
            1000,
        )
    )
    cid = clause["clause_id"]

    # Too early -> reverts
    MockRuntime.datetime_str = "2026-11-14T20:10:00Z"
    with pytest.raises(MockUserError, match="CLAUSE_TIMEOUT_NOT_REACHED"):
        contract.claim_expired_clause_bond(cid)

    # Past deadline -> bond returned to producer
    MockRuntime.datetime_str = "2026-11-14T20:20:00Z"
    expired = json.loads(contract.claim_expired_clause_bond(cid))
    assert expired["status"] == "EXPIRED_RETURNED"
    assert contract.get_claimable_balance(str(producer)) == 400

    # Stuck pending challenge fallback
    contract.challenges["challenge-99"] = json.dumps(
        {
            "challenge_id": "challenge-99",
            "clause_id": cid,
            "challenger": str(challenger),
            "fee_wei": 75,
            "created_at": pm._parse_iso_timestamp("2026-11-14T20:00:00Z"),
            "timeout_seconds": 600,
            "status": "PENDING",
        }
    )
    contract.challenge_ids.append("challenge-99")
    stuck = json.loads(contract.resolve_stuck_challenge("challenge-99"))
    assert stuck["status"] == "TIMED_OUT_REFUNDED"
    assert contract.get_claimable_balance(str(challenger)) == 75

    # View methods
    cfg = json.loads(contract.get_config())
    assert cfg["min_bond_wei"] == 100
    assert cfg["clause_count"] == 1
    assert len(json.loads(contract.list_clauses())) == 1
    assert len(json.loads(contract.list_challenges())) == 1
