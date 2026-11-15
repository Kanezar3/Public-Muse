# Public Muse — 2-Minute Reviewer Demo Script

**Target Duration:** ~2 minutes  
**Network:** GenLayer StudioNet (`chainId: 61999`, RPC: `https://studio.genlayer.com/api`)  
**Contract:** `0xa528723770aaf22D6e3893D2E8168e48F9217F64`

---

## 0:00 – 0:25 · Problem & Concept (No Wallet Needed)

- Open the **Public Muse** web app (loads directly into the **Proof Inspector** tab—no wallet connection required).
- Point out the core IP problem: when adapting a pre-1929 public-domain work like L. Frank Baum's 1900 *The Wonderful Wizard of Oz*, creators must prove they use public-domain elements (*Silver Shoes*) rather than later studio-copyrighted additions (*Ruby Slippers* from MGM's 1939 film).
- Show the masthead contract address (`0xa528723770aaf22D6e3893D2E8168e48F9217F64`) and the live StudioNet RPC status panel.

## 0:25 – 1:05 · Walk Through Finalized Proof Cases

- **Case 1 (`PROTECTED_DERIVATIVE_BREACH`)**: Click Case 1 in the Proof Inspector. Highlight the producer's claim (*Ruby Slippers* in the 1900 novel), the immutable Wikipedia `oldid=1384457883` evidence URL, its `evidence_sha256`, the verbatim quote proving MGM's 1939 origin, and the `120 wei` payout credited to the challenger.
- **Case 2 (`PUBLIC_DOMAIN_VERIFIED`)**: Click Case 2. Highlight the *Silver Shoes* claim verified against Wikipedia `oldid=1378659855`, where the producer keeps the `100 wei` bond and earns the `20 wei` challenge fee.
- **Case 3 (`REJECTED_VAGUE`) & Case 5 (`INSUFFICIENT_EVIDENCE`)**: Briefly note Gate 1 rejecting subjective claims with a full deposit refund, and Gate 2 rejecting unrelated evidence (the Steam Locomotive article).

## 1:05 – 1:35 · Live Explorer & CLI Proof Verification

- Click any transaction link in the Proof Inspector (for example, Case 1 challenge [`0x43e13080...`](https://explorer-studio.genlayer.com/tx/0x43e13080ebcb0a549fd981a8c20999bec6c4e1bb0bef2aac8ac16c3d795d56b9)) to open the **GenLayer StudioNet Explorer** showing `FINALIZED` / `MAJORITY_AGREE`.
- Optionally run in terminal to verify all finalized transactions and live RPC state:
  ```bash
  npm run verify:proof
  ```

## 1:35 – 2:00 · Live Contract & Wallet Desk

- Switch to the **Live Contract & Wallet Desk** tab.
- Show live on-chain clauses, challenges, and config fetched directly from StudioNet RPC (`get_config`, `list_clauses`, `list_challenges`).
- Note that connecting MetaMask / EIP-1193 lets a human signer register a new clause, submit an immutable-URL challenge, claim an expired bond, or withdraw `claimable_balances` via `@gl.evm.contract_interface` `emit_transfer` (each StudioNet write takes ~30–120+ seconds to finalize).
