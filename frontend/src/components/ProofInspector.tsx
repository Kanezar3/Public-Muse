import { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { formatWeiDisplay, isHttpUrl } from '../lib/format';
import { shortHash, txExplorerUrl } from '../lib/genlayer';
import type { LiveChainSnapshot, ProofCase, ProofDocument } from '../types/proof';
import { LiveChainPanel } from './LiveChainPanel';
import { VerdictBadge } from './VerdictBadge';

interface ProofInspectorProps {
  proof: ProofDocument;
  liveSnapshot: LiveChainSnapshot | null;
  liveLoading: boolean;
  connectedAddress: string | null;
  onRefreshLive: () => void;
}

interface WithdrawalRecord {
  address: string;
  claimable_before_wei: string;
  eoa_before_wei: string;
  eoa_after_wei: string;
  contract_before_wei: string;
  contract_after_wei: string;
  tx_id: string;
}

type ExtendedProofDocument = ProofDocument & {
  withdrawals?: {
    producer?: WithdrawalRecord;
    challenger?: WithdrawalRecord;
  };
};

function getDispositionNote(item: ProofCase): { title: string; detail: string } {
  if (item.expiry_fallback?.status === 'EXPIRED_RETURNED') {
    return {
      title: 'Challenge Window Expired Uncontested',
      detail:
        'No provenance challenge was filed before the clause deadline elapsed. The full creator bond was returned via the deterministic expiry fallback.',
    };
  }
  if (item.verdict === 'REJECTED_VAGUE') {
    return {
      title: 'Gate 1 Observability Filter',
      detail:
        'Rejected during Gate 1 deterministic screening as subjective or non-falsifiable prior to evidence fetching. The creator deposit was safely credited to claimable escrow without stranding funds.',
    };
  }
  return {
    title: 'Insufficient Documentary Basis',
    detail:
      'Validators audited the pinned source document and determined it neither proves nor refutes the adaptation claim. The challenge fee was refunded to challenger escrow.',
  };
}

function computeVerifiedTxCount(proofDoc: ExtendedProofDocument): number {
  const hashes = new Set<string>();
  if (proofDoc.deploy_tx_hash) hashes.add(proofDoc.deploy_tx_hash);
  for (const c of proofDoc.cases) {
    if (c.register_tx_hash) hashes.add(c.register_tx_hash);
    if (c.challenge_tx_hash) hashes.add(c.challenge_tx_hash);
    if (c.resolve_tx_hash) hashes.add(c.resolve_tx_hash);
    if (c.withdraw_tx_hash) hashes.add(c.withdraw_tx_hash);
    if (c.expiry_fallback?.expired_tx_hash) {
      hashes.add(c.expiry_fallback.expired_tx_hash);
    }
  }
  if (proofDoc.withdrawals?.producer?.tx_id) {
    hashes.add(proofDoc.withdrawals.producer.tx_id);
  }
  if (proofDoc.withdrawals?.challenger?.tx_id) {
    hashes.add(proofDoc.withdrawals.challenger.tx_id);
  }
  return hashes.size;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      title={`Copy ${label ?? 'value'}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function ProofInspector({
  proof,
  liveSnapshot,
  liveLoading,
  connectedAddress,
  onRefreshLive,
}: ProofInspectorProps) {
  const extProof = proof as ExtendedProofDocument;
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    proof.cases[0]?.case_id ?? ''
  );

  const activeCase: ProofCase | undefined =
    proof.cases.find((c) => c.case_id === selectedCaseId) ?? proof.cases[0];

  const caseCountFormatted = String(proof.cases.length).padStart(2, '0');
  const finalizedCount = String(
    proof.cases.filter((c) => c.tx_status === 'FINALIZED').length
  ).padStart(2, '0');
  const verifiedTxCount = computeVerifiedTxCount(extProof);

  const producerWithdrawWei = BigInt(
    extProof.withdrawals?.producer?.claimable_before_wei ?? '0'
  );
  const challengerWithdrawWei = BigInt(
    extProof.withdrawals?.challenger?.claimable_before_wei ?? '0'
  );
  const totalSettledWei = producerWithdrawWei + challengerWithdrawWei;

  const registerUrl = txExplorerUrl(activeCase?.register_tx_hash);
  const challengeUrl = txExplorerUrl(activeCase?.challenge_tx_hash);
  const resolveUrl = txExplorerUrl(activeCase?.resolve_tx_hash);
  const withdrawUrl = txExplorerUrl(activeCase?.withdraw_tx_hash);
  const expiredUrl = txExplorerUrl(activeCase?.expiry_fallback?.expired_tx_hash);
  const deployUrl = txExplorerUrl(proof.deploy_tx_hash);

  const producerWithdrawUrl = txExplorerUrl(extProof.withdrawals?.producer?.tx_id);
  const challengerWithdrawUrl = txExplorerUrl(extProof.withdrawals?.challenger?.tx_id);

  const bondFmt = formatWeiDisplay(activeCase?.bond_wei);
  const feeFmt = formatWeiDisplay(activeCase?.challenge_fee_wei ?? '0');

  return (
    <div className="inspector-stack">
      {/* Executive Protocol Summary Strip */}
      <section className="exec-strip" aria-label="Protocol summary">
        <div className="exec-cell">
          <div className="exec-k mono">FINALIZED DOCKETS</div>
          <div className="exec-v">
            {finalizedCount} / {caseCountFormatted}
          </div>
          <div className="exec-sub">
            {verifiedTxCount} Verified StudioNet Txs · Majority Consensus
          </div>
        </div>
        <div className="exec-cell">
          <div className="exec-k mono">ADJUDICATION ENGINE</div>
          <div className="exec-v">Two-Gate Consensus</div>
          <div className="exec-sub">
            Observability Gate → Comparative Evidence Audit
          </div>
        </div>
        <div className="exec-cell">
          <div className="exec-k mono">CRYPTOGRAPHIC PINNING</div>
          <div className="exec-v">SHA-256 + Verbatim</div>
          <div className="exec-sub">
            Bounded 2,500-char text + ≥ 16-char quote check
          </div>
        </div>
        <div className="exec-cell">
          <div className="exec-k mono">ESCROW SETTLEMENT</div>
          <div className="exec-v">
            {totalSettledWei > 0n
              ? `${totalSettledWei.toString()} wei Settled`
              : 'Escrow Verified'}
          </div>
          <div className="exec-sub">
            {totalSettledWei > 0n
              ? `Producer ${producerWithdrawWei.toString()} wei · Challenger ${challengerWithdrawWei.toString()} wei`
              : 'Direct EOA withdrawals via GenLayer bridge'}
          </div>
        </div>
      </section>

      {/* Recorded Proof Snapshot Section */}
      <section className="folio-panel proof-panel">
        <div className="folio-header">
          <div>
            <p className="eyebrow">
              <FileCheck2 size={12} />
              <span>Recorded Proof Snapshot · No Wallet Required</span>
            </p>
            <div className="heading-with-tag">
              <h2 className="folio-title">
                Finalized StudioNet Provenance Dossiers ({proof.cases.length} Cases)
              </h2>
              <span className="method-tag mono">proof.json</span>
            </div>
          </div>
          <div className="snapshot-meta mono small">
            {proof.is_placeholder ? (
              <span className="stamp-inline stamp-inline-warn">
                Placeholder Schema · Awaiting Live Proof
              </span>
            ) : (
              <span className="stamp-inline stamp-inline-ok">
                Verified Snapshot · {new Date(proof.generated_at).toLocaleString()}
              </span>
            )}
            {deployUrl && (
              <a href={deployUrl} target="_blank" rel="noreferrer" className="ext-link">
                Deploy Tx <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        <div className="inspector-grid">
          {/* Docket Sidebar */}
          <aside className="case-sidebar" aria-label="Demo proof dockets">
            {proof.cases.map((item, idx) => {
              const isSelected = item.case_id === activeCase?.case_id;
              const verdictClass =
                item.expiry_fallback?.status === 'EXPIRED_RETURNED'
                  ? 'docket-expired'
                  : item.verdict === 'PUBLIC_DOMAIN_VERIFIED'
                    ? 'docket-verified'
                    : item.verdict === 'PROTECTED_DERIVATIVE_BREACH'
                      ? 'docket-breach'
                      : item.verdict === 'REJECTED_VAGUE'
                        ? 'docket-vague'
                        : 'docket-insufficient';

              return (
                <button
                  key={item.case_id}
                  type="button"
                  className={`case-tab ${verdictClass} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedCaseId(item.case_id)}
                >
                  <div className="case-tab-top mono">
                    <span className="case-index">CASE 0{idx + 1}</span>
                    <span className="case-status">{item.tx_status}</span>
                  </div>
                  <div className="case-tab-title">{item.label}</div>
                  <div className="case-tab-badge">
                    <VerdictBadge
                      verdict={item.verdict}
                      expiryStatus={item.expiry_fallback?.status}
                    />
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Detailed Exhibit Folio */}
          {activeCase ? (
            <article className="dossier">
              <header className="dossier-header">
                <div>
                  <div className="dossier-eyebrow mono">
                    Clause: {activeCase.clause_id}
                    {activeCase.challenge_id ? ` · Challenge: ${activeCase.challenge_id}` : ''}
                  </div>
                  <h3 className="dossier-title">{activeCase.work_title}</h3>
                </div>
                <VerdictBadge
                  verdict={activeCase.verdict}
                  expiryStatus={activeCase.expiry_fallback?.status}
                />
              </header>

              {/* Exhibit I: Adaptation Clause & Source Claim */}
              <div className="exhibit-block">
                <div className="exhibit-label">
                  <BookOpen size={14} />
                  <span>Exhibit I · Adaptation Clause &amp; Source Claim</span>
                </div>
                <p className="clause-text">{activeCase.element_claim}</p>
                {activeCase.notes && (
                  <p className="case-note small muted">{activeCase.notes}</p>
                )}
                <div className="digest-table">
                  <div className="digest-row">
                    <span className="digest-key">Public-Domain Work</span>
                    {isHttpUrl(activeCase.public_domain_source) ? (
                      <a
                        href={activeCase.public_domain_source}
                        target="_blank"
                        rel="noreferrer"
                        className="ext-link mono"
                      >
                        {activeCase.public_domain_source}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="digest-val">
                        {activeCase.public_domain_source}
                      </span>
                    )}
                  </div>
                  <div className="digest-row">
                    <span className="digest-key">Clause Digest (SHA-256)</span>
                    <code className="digest-val mono">{activeCase.clause_sha256}</code>
                    <CopyButton value={activeCase.clause_sha256} label="Clause SHA-256" />
                  </div>
                </div>
              </div>

              {/* Exhibit II: Archival Evidence & Validator Audit */}
              <div className="exhibit-block">
                <div className="exhibit-label">
                  <Scale size={14} />
                  <span>Exhibit II · Archival Evidence &amp; Validator Audit</span>
                </div>

                {activeCase.verbatim_quote && activeCase.verbatim_quote.trim().length > 0 ? (
                  <blockquote className="verbatim-quote">
                    “{activeCase.verbatim_quote}”
                  </blockquote>
                ) : (
                  <div className="disposition-note">
                    <strong>{getDispositionNote(activeCase).title}</strong>
                    <p>{getDispositionNote(activeCase).detail}</p>
                  </div>
                )}

                {activeCase.evidence_sha256 || activeCase.evidence_url ? (
                  <div className="digest-table">
                    {activeCase.evidence_sha256 && (
                      <div className="digest-row">
                        <span className="digest-key">Evidence Digest (SHA-256)</span>
                        <code className="digest-val mono">{activeCase.evidence_sha256}</code>
                        <CopyButton
                          value={activeCase.evidence_sha256}
                          label="Evidence SHA-256"
                        />
                      </div>
                    )}
                    {activeCase.evidence_url && (
                      <div className="digest-row">
                        <span className="digest-key">Archival Snapshot URL</span>
                        {isHttpUrl(activeCase.evidence_url) ? (
                          <a
                            href={activeCase.evidence_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ext-link mono"
                          >
                            {activeCase.evidence_url}
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="digest-val mono">{activeCase.evidence_url}</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="na-indicator mono small">
                    N/A — Settled prior to Gate 2 archival audit
                  </div>
                )}
              </div>

              {/* Exhibit III: Bond Accounting & Finalized Chain Record */}
              <div className="exhibit-block">
                <div className="exhibit-label">
                  <ShieldCheck size={14} />
                  <span>Exhibit III · Bond Accounting &amp; Finalized Chain Record</span>
                </div>
                <div className="dossier-two-col">
                  <div className="exhibit-col">
                    <h4>Bond &amp; Fee Settlement</h4>
                    <dl className="kv-list small">
                      <div className="kv-row">
                        <dt>Creator Bond</dt>
                        <dd className="mono" title={bondFmt.secondary}>
                          {bondFmt.primary}
                          {bondFmt.primary !== bondFmt.secondary && (
                            <span className="muted wei-sub"> ({bondFmt.secondary})</span>
                          )}
                        </dd>
                      </div>
                      <div className="kv-row">
                        <dt>Challenge Fee</dt>
                        <dd className="mono" title={feeFmt.secondary}>
                          {feeFmt.primary}
                          {feeFmt.primary !== feeFmt.secondary && (
                            <span className="muted wei-sub"> ({feeFmt.secondary})</span>
                          )}
                        </dd>
                      </div>
                      {activeCase.payout_summary && (
                        <div className="kv-row kv-row-stack">
                          <dt>Outcome</dt>
                          <dd>{activeCase.payout_summary}</dd>
                        </div>
                      )}
                      {activeCase.expiry_fallback?.note && (
                        <div className="kv-row kv-row-stack">
                          <dt>Escrow &amp; Fallback Audit</dt>
                          <dd className="muted">{activeCase.expiry_fallback.note}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <div className="exhibit-col">
                    <h4>StudioNet Explorer Transactions</h4>
                    <ul className="tx-links-list mono small">
                      <li>
                        <span>Register Clause</span>
                        {registerUrl ? (
                          <a href={registerUrl} target="_blank" rel="noreferrer" className="ext-link">
                            {shortHash(activeCase.register_tx_hash)} <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="muted">
                            {shortHash(activeCase.register_tx_hash)}
                          </span>
                        )}
                      </li>
                      {activeCase.challenge_tx_hash && (
                        <li>
                          <span>Submit Challenge</span>
                          {challengeUrl ? (
                            <a href={challengeUrl} target="_blank" rel="noreferrer" className="ext-link">
                              {shortHash(activeCase.challenge_tx_hash)} <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="muted">
                              {shortHash(activeCase.challenge_tx_hash)}
                            </span>
                          )}
                        </li>
                      )}
                      {activeCase.resolve_tx_hash && (
                        <li>
                          <span>Deadline / Resolve</span>
                          {resolveUrl ? (
                            <a href={resolveUrl} target="_blank" rel="noreferrer" className="ext-link">
                              {shortHash(activeCase.resolve_tx_hash)} <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="muted">
                              {shortHash(activeCase.resolve_tx_hash)}
                            </span>
                          )}
                        </li>
                      )}
                      {activeCase.expiry_fallback?.expired_tx_hash && (
                        <li>
                          <span>Expiry Fallback</span>
                          {expiredUrl ? (
                            <a href={expiredUrl} target="_blank" rel="noreferrer" className="ext-link">
                              {shortHash(activeCase.expiry_fallback.expired_tx_hash)}{' '}
                              <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="muted">
                              {shortHash(activeCase.expiry_fallback.expired_tx_hash)}
                            </span>
                          )}
                        </li>
                      )}
                      {activeCase.withdraw_tx_hash && !extProof.withdrawals && (
                        <li>
                          <span>Withdraw Balance</span>
                          {withdrawUrl ? (
                            <a href={withdrawUrl} target="_blank" rel="noreferrer" className="ext-link">
                              {shortHash(activeCase.withdraw_tx_hash)} <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="muted">
                              {shortHash(activeCase.withdraw_tx_hash)}
                            </span>
                          )}
                        </li>
                      )}
                      {activeCase.expiry_fallback?.status === 'EXPIRED_RETURNED' &&
                        extProof.withdrawals?.producer && (
                          <li>
                            <span>
                              Producer Withdraw ({extProof.withdrawals.producer.claimable_before_wei}{' '}
                              wei)
                            </span>
                            {producerWithdrawUrl ? (
                              <a
                                href={producerWithdrawUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ext-link"
                              >
                                {shortHash(extProof.withdrawals.producer.tx_id)}{' '}
                                <ExternalLink size={11} />
                              </a>
                            ) : (
                              <span className="muted">
                                {shortHash(extProof.withdrawals.producer.tx_id)}
                              </span>
                            )}
                          </li>
                        )}
                      {activeCase.expiry_fallback?.status === 'EXPIRED_RETURNED' &&
                        extProof.withdrawals?.challenger && (
                          <li>
                            <span>
                              Challenger Withdraw (
                              {extProof.withdrawals.challenger.claimable_before_wei} wei)
                            </span>
                            {challengerWithdrawUrl ? (
                              <a
                                href={challengerWithdrawUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ext-link"
                              >
                                {shortHash(extProof.withdrawals.challenger.tx_id)}{' '}
                                <ExternalLink size={11} />
                              </a>
                            ) : (
                              <span className="muted">
                                {shortHash(extProof.withdrawals.challenger.tx_id)}
                              </span>
                            )}
                          </li>
                        )}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Consensus & Appeal Lifecycle Strip */}
              <div className="appeal-panel">
                <div className="appeal-header">
                  <strong>Consensus &amp; Appeal Lifecycle</strong>
                  <span className="mono stamp-inline stamp-inline-ok">
                    {activeCase.tx_status}
                    {activeCase.consensus_result ? ` · ${activeCase.consensus_result}` : ''}
                  </span>
                </div>
                <div className="lifecycle-flow mono" aria-label="GenLayer consensus stages">
                  <span className="lc-step done">1. Proposed</span>
                  <span className="lc-arrow">→</span>
                  <span className="lc-step done">2. Validators Agreed</span>
                  <span className="lc-arrow">→</span>
                  <span className="lc-step done">3. Accepted (5) Appeal Window</span>
                  <span className="lc-arrow">→</span>
                  <span className="lc-step done-final">4. Finalized (7)</span>
                </div>
                <p className="small muted">
                  In GenLayer Optimistic Democracy, validator agreement enters{' '}
                  <code>Accepted (5)</code>—opening an appeal window for equivalence challenges
                  before locking permanently in <code>Finalized (7)</code>.{' '}
                  <strong className="mono">
                    {activeCase.appeal_window_status ?? 'Appeal window closed — Finalized (7)'}
                  </strong>
                </p>
              </div>
            </article>
          ) : (
            <p className="muted">No cases found in proof.json.</p>
          )}
        </div>
      </section>

      {/* Live StudioNet RPC Reads Section */}
      <LiveChainPanel
        snapshot={liveSnapshot}
        loading={liveLoading}
        connectedAddress={connectedAddress}
        onRefresh={onRefreshLive}
      />
    </div>
  );
}
