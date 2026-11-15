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
import { formatWeiToGen, shortHash, txExplorerUrl } from '../lib/genlayer';
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
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    proof.cases[0]?.case_id ?? ''
  );

  const activeCase: ProofCase | undefined =
    proof.cases.find((c) => c.case_id === selectedCaseId) ?? proof.cases[0];

  const registerUrl = txExplorerUrl(activeCase?.register_tx_hash);
  const challengeUrl = txExplorerUrl(activeCase?.challenge_tx_hash);
  const resolveUrl = txExplorerUrl(activeCase?.resolve_tx_hash);
  const withdrawUrl = txExplorerUrl(activeCase?.withdraw_tx_hash);
  const expiredUrl = txExplorerUrl(activeCase?.expiry_fallback?.expired_tx_hash);
  const deployUrl = txExplorerUrl(proof.deploy_tx_hash);

  return (
    <div className="inspector-stack">
      {/* Recorded Proof Snapshot Section */}
      <section className="panel proof-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">
              <FileCheck2 size={12} /> Recorded Proof (`proof.json` Snapshot) · No Wallet Required
            </p>
            <h2 className="panel-title">
              Finalized StudioNet Provenance Dossiers ({proof.cases.length} Cases)
            </h2>
          </div>
          <div className="snapshot-meta mono small">
            {proof.is_placeholder ? (
              <span className="pill pill-warn">Placeholder Schema · Awaiting Stage 3 proof.json</span>
            ) : (
              <span className="pill pill-ok">
                Live Proof Snapshot · {new Date(proof.generated_at).toLocaleString()}
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
          {/* Case List Sidebar */}
          <aside className="case-sidebar" aria-label="Demo proof cases">
            {proof.cases.map((item, idx) => {
              const isSelected = item.case_id === activeCase?.case_id;
              return (
                <button
                  key={item.case_id}
                  type="button"
                  className={`case-tab ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedCaseId(item.case_id)}
                >
                  <div className="case-tab-top">
                    <span className="mono case-index">CASE 0{idx + 1}</span>
                    <span className="mono case-status">{item.tx_status}</span>
                  </div>
                  <div className="case-tab-title">{item.label}</div>
                  <div className="case-tab-badge">
                    <VerdictBadge verdict={item.verdict} />
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Detailed Case Dossier */}
          {activeCase ? (
            <article className="dossier">
              <header className="dossier-header">
                <div>
                  <div className="dossier-eyebrow mono">
                    Clause ID: {activeCase.clause_id}
                    {activeCase.challenge_id ? ` · Challenge ID: ${activeCase.challenge_id}` : ''}
                  </div>
                  <h3 className="dossier-title">{activeCase.work_title}</h3>
                </div>
                <VerdictBadge verdict={activeCase.verdict} />
              </header>

              {/* Clause Text & SHA-256 */}
              <div className="dossier-section">
                <div className="section-label">
                  <BookOpen size={14} />
                  <span>Adaptation Clause &amp; Cryptographic Digest</span>
                </div>
                <p className="clause-text">{activeCase.element_claim}</p>
                <div className="digest-row">
                  <span className="digest-key mono">clause_sha256</span>
                  <code className="digest-val mono">{activeCase.clause_sha256}</code>
                  <CopyButton value={activeCase.clause_sha256} label="clause_sha256" />
                </div>
                <div className="digest-row">
                  <span className="digest-key mono">public_domain_source</span>
                  <a
                    href={activeCase.public_domain_source}
                    target="_blank"
                    rel="noreferrer"
                    className="ext-link mono truncate"
                  >
                    {activeCase.public_domain_source}
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Validator Verbatim Quote & Evidence Digest */}
              <div className="dossier-section">
                <div className="section-label">
                  <Scale size={14} />
                  <span>Validator Consensus Evidence &amp; Verbatim Quote</span>
                </div>
                <blockquote className="verbatim-quote">
                  “{activeCase.verbatim_quote}”
                </blockquote>
                <div className="digest-row">
                  <span className="digest-key mono">evidence_sha256</span>
                  <code className="digest-val mono">{activeCase.evidence_sha256}</code>
                  <CopyButton value={activeCase.evidence_sha256} label="evidence_sha256" />
                </div>
                <div className="digest-row">
                  <span className="digest-key mono">immutable_evidence_url</span>
                  <a
                    href={activeCase.evidence_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ext-link mono truncate"
                  >
                    {activeCase.evidence_url}
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Bonds, Fees & Explorer Tx Links */}
              <div className="dossier-two-col">
                <div className="sub-card">
                  <h4>Bond &amp; Fee Ledger</h4>
                  <dl className="kv-list small">
                    <div className="kv-row">
                      <dt>Creator Bond</dt>
                      <dd className="mono">{formatWeiToGen(activeCase.bond_wei)}</dd>
                    </div>
                    <div className="kv-row">
                      <dt>Challenge Fee</dt>
                      <dd className="mono">
                        {formatWeiToGen(activeCase.challenge_fee_wei ?? '0')}
                      </dd>
                    </div>
                    {activeCase.payout_summary && (
                      <div className="kv-row kv-row-stack">
                        <dt>Settlement</dt>
                        <dd>{activeCase.payout_summary}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                <div className="sub-card">
                  <h4>StudioNet Explorer Transactions</h4>
                  <ul className="tx-links-list mono small">
                    <li>
                      <span>Register Clause:</span>
                      {registerUrl ? (
                        <a href={registerUrl} target="_blank" rel="noreferrer" className="ext-link">
                          {shortHash(activeCase.register_tx_hash)} <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span className="muted">
                          {shortHash(activeCase.register_tx_hash)} (placeholder)
                        </span>
                      )}
                    </li>
                    {activeCase.challenge_tx_hash && (
                      <li>
                        <span>Submit Challenge:</span>
                        {challengeUrl ? (
                          <a href={challengeUrl} target="_blank" rel="noreferrer" className="ext-link">
                            {shortHash(activeCase.challenge_tx_hash)} <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="muted">
                            {shortHash(activeCase.challenge_tx_hash)} (placeholder)
                          </span>
                        )}
                      </li>
                    )}
                    {activeCase.resolve_tx_hash && (
                      <li>
                        <span>Deadline / Resolve:</span>
                        {resolveUrl ? (
                          <a href={resolveUrl} target="_blank" rel="noreferrer" className="ext-link">
                            {shortHash(activeCase.resolve_tx_hash)} <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="muted">
                            {shortHash(activeCase.resolve_tx_hash)} (placeholder)
                          </span>
                        )}
                      </li>
                    )}
                    {activeCase.expiry_fallback?.expired_tx_hash && (
                      <li>
                        <span>Expiry Fallback:</span>
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
                    {activeCase.withdraw_tx_hash && (
                      <li>
                        <span>Withdraw Balance:</span>
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
                  </ul>
                </div>
              </div>

              {/* GenLayer Appeal Window Panel */}
              <div className="appeal-panel">
                <div className="appeal-header">
                  <ShieldCheck size={16} />
                  <strong>GenLayer Optimistic Democracy Appeal Window</strong>
                  <span className="mono pill pill-ok">
                    {activeCase.tx_status}
                    {activeCase.consensus_result ? ` · ${activeCase.consensus_result}` : ''}
                  </span>
                </div>
                <p className="small">
                  In GenLayer consensus, once validators reach agreement the transaction enters{' '}
                  <code>Accepted (5)</code>—opening an <strong>appeal window</strong> where
                  participants can challenge validator equivalence before settlement locks in{' '}
                  <code>Finalized (7)</code>.
                </p>
                <p className="mono small appeal-status-line">
                  Case Status: {activeCase.appeal_window_status ?? 'Finalized (7) — Appeal window closed'}
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
