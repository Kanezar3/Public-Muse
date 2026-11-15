# Public Muse — Portal Submission Fields

Ready-to-paste fields for the GenLayer Portal submission.

---

## Contribution Type

```text
Projects / deployed contract
```

## One-Liner

```text
Public-domain clean-room adaptation & provenance bonds on GenLayer StudioNet: LLM validators audit immutable archival evidence while deterministic Python enforces payouts and EOA withdrawals.
```

## Description

> **Character count check:** Verified strictly `<= 1,000` characters.

```text
Public Muse is an on-chain clean-room adaptation registry and provenance bond protocol on GenLayer StudioNet (chainId 61999). Studios and creators stake bonds on falsifiable adaptation claims for pre-1929 works—such as distinguishing L. Frank Baum's 1900 public-domain Silver Shoes from MGM's 1939 Ruby Slippers.

Gate 1 uses gl.eq_principle.strict_eq to reject vague marketing claims and refund deposits. Gate 2 uses gl.eq_principle.prompt_comparative so validators agree on an immutable snapshot's SHA-256, verdict, and verbatim quote (>=16 chars verified in extracted text). Deterministic Python enforces URL immutability (Wikipedia oldid, GitHub 40-hex SHA, Wayback id_), non-reverting refunds, timeout fallbacks, and EOA withdrawals via @gl.evm.contract_interface emit_transfer.

All 6 live StudioNet proof cases (breach slash, public-domain verify, vague reject, prompt-injection resilience, insufficient evidence, expiry + EOA withdrawals) are finalized and verifiable without a wallet.
```

## Reviewer How-To Steps

```text
1. Open the live deployed frontend at https://public-muse.vercel.app (or run `cd frontend && npm install && npm run dev` locally).
2. In the default **Proof Inspector** tab (no wallet required), inspect Cases 1 through 6, including immutable Wikipedia `oldid` URLs, the commit-pinned GitHub raw prompt-injection fixture (Case 4), `evidence_sha256` digests, verbatim quotes, and payout summaries.
3. Click any transaction link to verify `FINALIZED` / `MAJORITY_AGREE` status in the GenLayer StudioNet Explorer.
4. Optionally run `npm run verify:proof` from the repo root to verify all 11 finalized StudioNet transactions via RPC, or `python -m pytest tests/test_public_muse.py -v` to run the unit test suite.
5. Switch to the **Live Contract & Wallet Desk** tab to inspect live RPC state (`get_config`, `list_clauses`, `list_challenges`) or connect a StudioNet wallet to register/challenge/withdraw.
```

## Expected Outcome

```text
- `npm run verify:proof` verifies 11 unique finalized StudioNet transactions (contract deploy + Cases 1–6) on chainId 61999 with `FINALIZED / MAJORITY_AGREE / SUCCESS`.
- The Proof Inspector displays all 6 live StudioNet cases with matching `evidence_sha256` and verbatim quotes, and the Live Contract & Wallet Desk reads live contract state from `0xa528723770aaf22D6e3893D2E8168e48F9217F64`.
- `python -m pytest tests/test_public_muse.py -v` passes all unit tests, including mocked prompt-injection resilience (Case 4).
```

## Contract & Proof Explorer Links

- **GitHub Repository:** https://github.com/Kanezar3/Public-Muse
- **Live Frontend (Vercel):** https://public-muse.vercel.app
- **PublicMuse Contract (`0xa528723770aaf22D6e3893D2E8168e48F9217F64`):** https://explorer-studio.genlayer.com/address/0xa528723770aaf22D6e3893D2E8168e48F9217F64
- **EvidenceProbe Contract (`0xaDDb04fF7a81076eda9D84f1ddEf7aDd74bB6CA9`):** https://explorer-studio.genlayer.com/address/0xaDDb04fF7a81076eda9D84f1ddEf7aDd74bB6CA9
- **PayableProbe Contract (`0xa01A982D8e41529251850B65C6deCEfD575D3967`):** https://explorer-studio.genlayer.com/address/0xa01A982D8e41529251850B65C6deCEfD575D3967
- **Deploy Tx:** https://explorer-studio.genlayer.com/tx/0x2c61eb5e0ae1a176a987b87eb8d59d34a391913a8414efe9ed15fabc56bfc678
- **Case 1 (Ruby Slippers Breach) Register / Challenge:** https://explorer-studio.genlayer.com/tx/0x0d465af8c928add02fd6c2e9d9754c609917a5db8d17a7ed64080a788a59766b · https://explorer-studio.genlayer.com/tx/0x43e13080ebcb0a549fd981a8c20999bec6c4e1bb0bef2aac8ac16c3d795d56b9
- **Case 2 (Silver Shoes Verified) Register / Challenge:** https://explorer-studio.genlayer.com/tx/0xdd1f620f765b11e9efd5180fb3f4923dc140f7e0b2bf04962cb5fb44013ac9c5 · https://explorer-studio.genlayer.com/tx/0x649675edee463c6e556a48b3e7ce41a6f3c534d9e104061d881917017928c1d8
- **Case 3 (Rejected Vague) Register:** https://explorer-studio.genlayer.com/tx/0x853eed9db9c0f3b5195a33d48d5e2255cccd6332d1b5576cc7bc3808bb208248
- **Case 4 (Prompt-Injection Resilience) Challenge:** https://explorer-studio.genlayer.com/tx/0xfc686466590bcd1bab82ef3c305fff357316cb5913128f3407f7c51735b9985e (Evidence: https://raw.githubusercontent.com/Kanezar3/Public-Muse/8812f82f8d492d7f0c7bf406c95147e7e6a17a4a/fixtures/prompt_injection_oz.txt)
- **Case 5 (Insufficient Evidence) Challenge:** https://explorer-studio.genlayer.com/tx/0xe4de5d29dd31692aea4e794193ce260c3bf86144529c7628544388d5bc43d03f
- **Case 6 (Timeout Fallback & EOA Withdrawals) Register / Expire / Producer Withdraw / Challenger Withdraw:** https://explorer-studio.genlayer.com/tx/0x867938125f02270e19e3386be8658646238da482b8432d283b2789695c3ba39e · https://explorer-studio.genlayer.com/tx/0x40c6bd70e10d25591a502796455ff4a792d7582f3b141c21b50c8494b75e39bc · https://explorer-studio.genlayer.com/tx/0x6023a08c18fe032ac12406d88aa9e5d01942bfe9f17b52afa38120b2a3b5b3d3 · https://explorer-studio.genlayer.com/tx/0x0b505a99017d1b342797a29a11cc6eeaf6073a9525d6db88de673e298334f765
