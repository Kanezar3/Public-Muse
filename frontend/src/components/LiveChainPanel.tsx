import { Database, ExternalLink, RefreshCw } from 'lucide-react';
import {
  STUDIONET_RPC_URL,
  addressExplorerUrl,
  formatWeiToGen,
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

  return (
    <section className="panel live-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            <Database size={12} /> Live StudioNet RPC Reads (Chain 61999)
          </p>
          <h3 className="panel-title">On-Chain Contract State (`readContract`)</h3>
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

      <div className="live-meta-bar mono small">
        <span>Endpoint: {STUDIONET_RPC_URL}</span>
        <span>
          Contract:{' '}
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
        {snapshot?.fetchedAt && (
          <span>Last Read: {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
        )}
      </div>

      {snapshot?.error ? (
        <div className="notice-box">
          <strong>Live RPC Unavailable / Unconfigured:</strong> {snapshot.error}
        </div>
      ) : (
        <div className="live-grid">
          <div className="live-card">
            <h4>get_config()</h4>
            {snapshot?.config ? (
              <dl className="kv-list small">
                {Object.entries(snapshot.config).map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <dt className="mono">{k}</dt>
                    <dd className="mono">
                      {k.endsWith('_wei') ? formatWeiToGen(String(v)) : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted small">No config returned yet.</p>
            )}
          </div>

          <div className="live-card">
            <h4>get_claimable_balance(account)</h4>
            {connectedAddress ? (
              <div className="balance-readout">
                <span className="mono big-num">
                  {formatWeiToGen(snapshot?.claimableBalanceWei ?? '0')}
                </span>
                <span className="mono muted small">
                  Account: {shortHash(connectedAddress, 10, 8)}
                </span>
              </div>
            ) : (
              <p className="muted small">
                Connect a wallet in the header or Bond Desk to query your claimable GEN balance.
                Proof inspection requires no wallet.
              </p>
            )}
          </div>

          <div className="live-card live-card-wide">
            <h4>list_clauses() — On-Chain Clauses ({snapshot?.clauses.length ?? 0})</h4>
            {snapshot?.clauses && snapshot.clauses.length > 0 ? (
              <div className="mini-table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Clause ID</th>
                      <th>Work &amp; Element Claim</th>
                      <th>Bond</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.clauses.map((c) => (
                      <tr key={c.clause_id}>
                        <td className="mono">
                          <div>{c.clause_id}</div>
                          {c.producer && (
                            <div className="muted small">{shortHash(c.producer, 8, 6)}</div>
                          )}
                        </td>
                        <td>
                          <strong>{c.work_title}</strong>
                          <div className="muted small">{c.element_claim}</div>
                          {c.reason && <div className="muted small">Reason: {c.reason}</div>}
                        </td>
                        <td className="mono">
                          <div>{formatWeiToGen(c.bond_wei)}</div>
                          {c.refunded_wei && c.refunded_wei !== '0' && (
                            <div className="muted small">
                              Refunded: {formatWeiToGen(c.refunded_wei)}
                            </div>
                          )}
                        </td>
                        <td className="mono">{c.status ?? 'ACTIVE'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No live clauses returned from contract.</p>
            )}
          </div>

          <div className="live-card live-card-wide">
            <h4>list_challenges() — On-Chain Challenges ({snapshot?.challenges.length ?? 0})</h4>
            {snapshot?.challenges && snapshot.challenges.length > 0 ? (
              <div className="mini-table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Challenge ID</th>
                      <th>Clause ID</th>
                      <th>Verdict</th>
                      <th>Evidence Digest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.challenges.map((ch) => (
                      <tr key={ch.challenge_id}>
                        <td className="mono">
                          <div>{ch.challenge_id}</div>
                          {ch.challenger && (
                            <div className="muted small">{shortHash(ch.challenger, 8, 6)}</div>
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
                            <div className="muted small">“{ch.quote.slice(0, 90)}…”</div>
                          )}
                        </td>
                        <td className="mono">
                          <div>{shortHash(ch.evidence_sha256, 10, 8)}</div>
                          {ch.payout_wei && (
                            <div className="muted small">
                              Payout: {formatWeiToGen(ch.payout_wei)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
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
