# Public Muse Developer Tutorial

This step-by-step tutorial walks through the design and implementation of `contracts/public_muse.py` on GenLayer StudioNet (`chainId: 61999`) and shows how to verify on-chain proofs with `scripts/verify_proof.mjs`.

Public Muse solves a concrete entertainment-IP problem: when a studio or creator adapts a pre-1929 public-domain work such as L. Frank Baum's 1900 novel *The Wonderful Wizard of Oz*, they must prove they are using public-domain elements (*Silver Shoes*) rather than later studio-copyrighted inventions (*Ruby Slippers* from MGM's 1939 film).

---

## Step 1: GenVM Runner Header and Contract State

Every GenLayer Intelligent Contract begins with a pinned GenVM runner header so all validators execute against the exact same Python runtime:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
```

Inside `PublicMuse(gl.Contract)`, state uses GenLayer's storage primitives (`Address`, `u256`, `TreeMap`, and `DynArray`):

- `clauses: TreeMap[str, str]` and `clause_ids: DynArray[str]` store canonical JSON records for each adaptation claim.
- `challenges: TreeMap[str, str]` and `challenge_ids: DynArray[str]` store provenance challenge records.
- `claimable_balances: TreeMap[str, u256]` tracks pull-based payouts and refunds per normalized lowercase address (`_norm_addr`).

Keeping accounting in `claimable_balances` avoids pushing native transfers inside consensus-critical branches and lets users withdraw deterministically later.

---

## Step 2: Strict URL Immutability Validation

If a challenger could submit a mutable web page (such as a live Wikipedia article or a `main` branch URL), validators fetching the URL seconds apart might observe different bytes and fail consensus. `is_valid_immutable_url(url)` in `contracts/public_muse.py` enforces that every `https://` evidence URL is pinned to an immutable snapshot:

1. **Wikipedia API (`en.wikipedia.org/w/api.php`)**: Must specify `action=parse`, `format=json`, and a numeric `oldid=<digits>` parameter, while rejecting mutable `page=`, `pageid=`, or `title=` parameters.
2. **GitHub Raw (`raw.githubusercontent.com`)**: Must pin a full 40-hex-character commit SHA (`/<owner>/<repo>/<40-hex-sha>/<path>`), rejecting branch names and `.` / `..` path traversal.
3. **Wayback Machine (`web.archive.org`)**: Must match `/web/<14-digits>id_/http(s)://...` so Wayback returns the raw archived capture without injected banner HTML.

Any URL failing `is_valid_immutable_url` is rejected deterministically before any network call is made.

---

## Step 3: Deterministic Wikitext Extraction and SHA-256 Pinning

Even with an immutable URL, Wikipedia's `action=parse&format=json` response wraps wikitext inside JSON and may contain markup noise. `_extract_deterministic_text(raw_text, max_chars=2500)` normalizes the payload deterministically:

- Parses `parse.wikitext["*"]` (or `query.pages.*.revisions[0]`) and prepends the article `title`.
- Strips `<ref>...</ref>` tags, HTML comments (`<!-- ... -->`), wiki link syntax (`[[target|label]]` -> `label`), and bold/italic quotes (`'''`).
- Collapses whitespace and truncates to `MAX_EXTRACTED_CHARS = 2500`.

Inside `_fetch_and_audit()`, `submit_challenge` computes:

```python
evidence_sha256 = hashlib.sha256(extracted.encode("utf-8")).hexdigest()
```

This cryptographic digest binds the LLM's judgment to the exact normalized text that every validator saw.

---

## Step 4: Gate 1 (`strict_eq`) vs. Gate 2 (`prompt_comparative`)

Public Muse separates intake filtering from evidence auditing using two distinct GenLayer Equivalence Principles:

### Gate 1: Observability Intake (`gl.eq_principle.strict_eq`)

When a producer calls `register_clause(work_title, element_claim, public_domain_source, timeout_seconds)`, the contract first checks non-empty fields, `deposit_wei >= min_bond_wei`, and `timeout_seconds >= 0`. It then runs `_judge_observability()` inside `gl.eq_principle.strict_eq`:

- Validators must reach **exact token agreement** on either `"OBSERVABLE"` (a falsifiable factual claim, such as wearing Silver Shoes from the 1900 novel) or `"REJECTED_VAGUE"` (subjective marketing language like *"captures the timeless emotional warmth"*).
- Because the output space is binary, `strict_eq` is fast, deterministic, and prevents vague unchallengeable clauses from locking bonds.

### Gate 2: Provenance Audit (`gl.eq_principle.prompt_comparative`)

When a challenger calls `submit_challenge(clause_id, evidence_url)`, `_fetch_and_audit()` fetches the immutable URL via `gl.nondet.web.get`, normalizes the text, and passes it inside `<UNTRUSTED_EVIDENCE>...</UNTRUSTED_EVIDENCE>` tags to `gl.nondet.exec_prompt(prompt, response_format="json")`.

Before returning, deterministic Python calls `_validate_challenge_payload(payload, extracted)`:
- `verdict` must be one of `PROTECTED_DERIVATIVE_BREACH`, `PUBLIC_DOMAIN_VERIFIED`, or `INSUFFICIENT_EVIDENCE`.
- For breach or verified verdicts, `quote` must be at least `MIN_QUOTE_CHARS = 16` characters and must appear **verbatim** (`quote in extracted_text`), eliminating hallucinated citations.

Then `gl.eq_principle.prompt_comparative` instructs validators to verify that both leader and validators produced **identical `evidence_sha256`**, **identical `verdict`**, and (for non-insufficient verdicts) a valid verbatim quote from the evidence.

---

## Step 5: Payable Refund Safety and Timeout Fallbacks

In GenLayer `@gl.public.write.payable` methods, reverting after receiving value can strand funds or break UX expectations if validation fails. Public Muse uses a **non-reverting credit-on-reject** pattern:

- In `register_clause`, if required fields are empty, `deposit_wei < min_bond_wei`, `timeout_seconds < 0`, or Gate 1 returns `REJECTED_VAGUE`, the contract calls `self._credit_balance(sender, deposit_wei)` and records `REJECTED_INVALID` or `REJECTED_VAGUE`.
- In `submit_challenge`, invalid/mutable URLs, inactive clauses, or insufficient fees credit `fee_wei` back to `challenger` in `claimable_balances` and record `REJECTED_INVALID`.
- If a clause goes unchallenged past `created_at + timeout_seconds`, anyone can call `claim_expired_clause_bond(clause_id)` to mark it `EXPIRED_RETURNED` and credit the bond back to the producer.

---

## Step 6: EOA Withdrawals via `@gl.evm.contract_interface`

To send native GEN from the contract back to an Externally Owned Account (EOA), `PublicMuse` declares an empty EVM interface:

```python
@gl.evm.contract_interface
class _EoaRecipient:
    class View:
        pass

    class Write:
        pass
```

Inside `withdraw_balance()`, the contract follows the **checks-effects-interactions** pattern: it verifies `amount > 0`, zeroes `self.claimable_balances[sender] = u256(0)` first, and then executes:

```python
_EoaRecipient(gl.message.sender_address).emit_transfer(value=u256(amount))
```

On StudioNet, this transfers `amount` wei directly from the contract's balance to the caller's EOA.

---

## Step 7: Verifying On-Chain Proofs with `verify_proof.mjs`

After deploying and seeding on StudioNet, `scripts/verify_proof.mjs` independently audits `deploy/proof.json` against `https://studio.genlayer.com/api`:

1. Confirms `eth_chainId` equals `61999` (StudioNet).
2. Iterates over `deploy_tx_hash` and every case's `register_tx_hash`, `challenge_tx_hash`, `resolve_tx_hash`, `expiry_fallback.expired_tx_hash`, and `withdraw_tx_hash`.
3. Calls `eth_getTransactionByHash` for each hash and asserts `status_name === "FINALIZED"`, `result_name === "MAJORITY_AGREE"`, and `leader_receipt[0].execution_result === "SUCCESS"`.
4. Verifies `frontend/public/proof.json` and `frontend/src/data/proof.json` match `deploy/proof.json`.

Run it locally with:

```bash
npm run verify:proof
```
