import { Database, ExternalLink, RefreshCw } from 'lucide-react';
import { formatWeiDisplay } from '../lib/format';
import {
  STUDIONET_RPC_URL,
  addressExplorerUrl,
  shortHash,
} from '../lib/genlayer';
import type { LiveChainSnapshot } from '../types/proof';
import { VerdictBadge } from './VerdictBadge';

interface LiveChainPanelProps {
  snapshot: LiveChainSnapshot | null;
  loading: boolean;
  connectedAddress: string | null;
  onRefresh: () => void;
}

export function LiveChainPanel({
  snapshot,
  loading,
  connectedAddress,
  onRefresh,
}: LiveChainPanelProps) {
  const contractUrl = addressExplorerUrl(snapshot?.contractAddress);
  const balanceFmt = formatWeiDisplay(snapshot?.claimableBalanceWei ?? '0');

  return (
    <section className="folio-panel live-panel">
      <div className="folio-header">
        <div>
          <p className="eyebrow">
            <Database size={12} />
            <span>Live StudioNet RPC Reads · Chain 61999</span>
          </p>
          <div className="heading-with-tag">
            <h3 className="folio-title">On-Chain Contract State</h3>
            <span className="method-tag mono">readContract</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>{loading ? 'Querying StudioNet…' : 'Refresh Live RPC'}</span>
        </button>
      </div>

      <div className="ledger-strip mono small">
        <div className="ledger-cell">
          <span className="ledger-k">RPC ENDPOINT</span>
          <span className="ledger-v">{STUDIONET_RPC_URL}</span>
        </div>
        <div className="ledger-cell">
          <span className="ledger-k">CONTRACT</span>
          <span className="ledger-v">
            {snapshot?.contractAddress ? (
              contractUrl ? (
                <a href={contractUrl} target="_blank" rel="noreferrer" className="ext-link">
                  {shortHash(snapshot.contractAddress, 10, 8)} <ExternalLink size={11} />
                </a>
              ) : (
                snapshot.contractAddress
              )
            ) : (
              'Not configured'
            )}
          </span>
        </div>
        {snapshot?.fetchedAt && (
          <div className="ledger-cell">
            <span className="ledger-k">LAST VERIFIED</span>
            <span className="ledger-v">{new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {snapshot?.error ? (
        <div className="notice-box">
          <strong>Live RPC Unavailable:</strong> {snapshot.error}
        </div>
      ) : (
        <div className="live-grid">
          <div className="sub-folio">
            <div className="sub-folio-head">
              <h4>Protocol Configuration</h4>
              <span className="method-tag mono">get_config</span>
            </div>
            {snapshot?.config ? (
              <dl className="kv-list small">
                {Object.entries(snapshot.config).map(([k, v]) => {
                  const isWei = k.endsWith('_wei');
                  const formatted = isWei ? formatWeiDisplay(String(v)) : null;
                  return (
                    <div key={k} className="kv-row">
                      <dt className="mono">{k}</dt>
                      <dd className="mono" title={formatted?.secondary}>
                        {formatted ? formatted.primary : String(v)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="muted small">No configuration returned yet.</p>
            )}
          </div>

          <div className="sub-folio">
            <div className="sub-folio-head">
              <h4>Account Escrow Ledger</h4>
              <span className="method-tag mono">get_claimable_balance</span>
            </div>
            {connectedAddress ? (
              <div className="balance-readout">
                <span className="mono big-num" title={balanceFmt.secondary}>
                  {balanceFmt.primary}
                </span>
                <span className="mono muted small">
                  {balanceFmt.secondary} · Account {shortHash(connectedAddress, 10, 8)}
                </span>
              </div>
            ) : (
              <p className="muted small">
                Connect a wallet in the masthead or Filing Desk to query your on-chain escrow
                balance. Proof inspection requires no wallet.
              </p>
            )}
          </div>

          <div className="sub-folio sub-folio-wide">
            <div className="sub-folio-head">
              <h4>
                Registered Adaptation Clauses ({snapshot?.clauses.length ?? 0})
              </h4>
              <span className="method-tag mono">list_clauses</span>
            </div>
            {snapshot?.clauses && snapshot.clauses.length > 0 ? (
              <div className="mini-table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Clause</th>
                      <th>Work &amp; Adaptation Claim</th>
                      <th>Bond</th>
                      <th>Disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.clauses.map((c) => {
                      const bond = formatWeiDisplay(c.bond_wei);
                      const refunded = formatWeiDisplay(c.refunded_wei);
                      return (
                        <tr key={c.clause_id}>
                          <td className="mono">
                            <div className="strong-mono">{c.clause_id}</div>
                            {c.producer && (
                              <div className="muted small" title={c.producer}>
                                {shortHash(c.producer, 8, 6)}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="table-work">{c.work_title}</div>
                            <div className="muted small">{c.element_claim}</div>
                            {c.reason && <div className="muted small">Note: {c.reason}</div>}
                          </td>
                          <td className="mono" title={bond.secondary}>
                            <div>{bond.primary}</div>
                            {c.refunded_wei && c.refunded_wei !== '0' && (
                              <div className="muted small">Returned: {refunded.primary}</div>
                            )}
                          </td>
                          <td className="mono">{c.status ?? 'ACTIVE'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No live clauses returned from contract.</p>
            )}
          </div>

          <div className="sub-folio sub-folio-wide">
            <div className="sub-folio-head">
              <h4>
                Filed Provenance Challenges ({snapshot?.challenges.length ?? 0})
              </h4>
              <span className="method-tag mono">list_challenges</span>
            </div>
            {snapshot?.challenges && snapshot.challenges.length > 0 ? (
              <div className="mini-table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Challenge</th>
                      <th>Clause</th>
                      <th>Validator Verdict &amp; Excerpt</th>
                      <th>Evidence SHA-256 &amp; Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.challenges.map((ch) => {
                      const payout = formatWeiDisplay(ch.payout_wei);
                      return (
                        <tr key={ch.challenge_id}>
                          <td className="mono">
                            <div className="strong-mono">{ch.challenge_id}</div>
                            {ch.challenger && (
                              <div className="muted small" title={ch.challenger}>
                                {shortHash(ch.challenger, 8, 6)}
                              </div>
                            )}
                          </td>
                          <td className="mono">{ch.clause_id}</td>
                          <td>
                            {ch.verdict ? (
                              <VerdictBadge verdict={ch.verdict} />
                            ) : (
                              <span className="mono">{ch.status ?? 'PENDING'}</span>
                            )}
                            {ch.quote && (
                              <div className="muted small table-quote">
                                “{ch.quote.slice(0, 110)}
                                {ch.quote.length > 110 ? '…' : ''}”
                              </div>
                            )}
                          </td>
                          <td className="mono">
                            <div title={ch.evidence_sha256}>
                              {shortHash(ch.evidence_sha256, 10, 8)}
                            </div>
                            {ch.payout_wei && (
                              <div className="muted small" title={payout.secondary}>
                                Payout: {payout.primary}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No live challenges returned from contract.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
