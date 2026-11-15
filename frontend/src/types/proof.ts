export type ProofVerdict =
  | 'PROTECTED_DERIVATIVE_BREACH'
  | 'PUBLIC_DOMAIN_VERIFIED'
  | 'REJECTED_VAGUE'
  | 'INSUFFICIENT_EVIDENCE';

export interface ProofCase {
  case_id: string;
  label: string;
  clause_id: string;
  challenge_id?: string | null;
  work_title: string;
  element_claim: string;
  public_domain_source: string;
  clause_sha256: string;
  verdict: ProofVerdict;
  verbatim_quote: string;
  evidence_url: string;
  evidence_sha256: string;
  register_tx_hash: string;
  challenge_tx_hash?: string | null;
  resolve_tx_hash?: string | null;
  withdraw_tx_hash?: string | null;
  expiry_fallback?: {
    expired_tx_hash?: string | null;
    status?: string;
    refunded_wei?: string;
    note?: string;
  } | null;
  tx_status: string; // e.g. "FINALIZED"
  consensus_result?: string; // e.g. "MAJORITY_AGREE"
  appeal_window_status?: string; // e.g. "Appeal window closed — Finalized (7)"
  bond_wei: string;
  challenge_fee_wei?: string;
  payout_summary?: string;
  notes?: string;
}

export interface ProofDocument {
  schema_version: string;
  is_placeholder?: boolean;
  network: {
    name: string;
    chain_id: number;
    rpc_url: string;
    explorer_url: string;
  };
  contract_address: string;
  deploy_tx_hash: string;
  generated_at: string;
  cases: ProofCase[];
}

export interface LiveConfig {
  owner?: string;
  min_bond_wei?: string;
  min_challenge_fee_wei?: string;
  default_timeout_seconds?: number;
  clause_count?: number;
  challenge_count?: number;
  [key: string]: unknown;
}

export interface LiveClause {
  clause_id: string;
  producer?: string;
  work_title: string;
  element_claim: string;
  public_domain_source: string;
  clause_sha256?: string;
  bond_wei?: string;
  refunded_wei?: string;
  timeout_seconds?: number;
  created_at?: number;
  status?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface LiveChallenge {
  challenge_id: string;
  clause_id: string;
  challenger?: string;
  evidence_url: string;
  evidence_sha256?: string;
  extracted_len?: number;
  verdict?: string;
  quote?: string;
  summary?: string;
  fee_wei?: string;
  payout_recipient?: string;
  payout_wei?: string;
  created_at?: number;
  timeout_seconds?: number;
  status?: string;
  [key: string]: unknown;
}

export interface LiveChainSnapshot {
  contractAddress: string;
  fetchedAt: string;
  config: LiveConfig | null;
  clauses: LiveClause[];
  challenges: LiveChallenge[];
  claimableBalanceWei: string | null;
  error: string | null;
}

export type TxLifecycleState =
  | 'submitted'
  | 'pending'
  | 'accepted'
  | 'finalized-success'
  | 'finalized-error';

export interface TrackedTransaction {
  hash: `0x${string}`;
  method: string;
  summary: string;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
  lifecycle: TxLifecycleState;
  rawStatus?: string;
  rawResult?: string;
  errorMessage?: string;
}
