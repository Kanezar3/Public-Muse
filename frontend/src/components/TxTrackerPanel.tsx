import {
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { shortHash, txExplorerUrl } from '../lib/genlayer';
import type { TrackedTransaction, TxLifecycleState } from '../types/proof';

interface TxTrackerPanelProps {
  transactions: TrackedTransaction[];
  hasActive: boolean;
  onPollNow: () => void;
  onRemove: (hash: string) => void;
  onClearAll: () => void;
}

const LIFECYCLE_LABELS: Record<
  TxLifecycleState,
  { label: string; step: number; className: string }
> = {
  submitted: { label: 'Submitted', step: 1, className: 'tx-pill tx-submitted' },
  pending: { label: 'Pending Consensus', step: 2, className: 'tx-pill tx-pending' },
  accepted: {
    label: 'Accepted (5) · Appeal Window Open',
    step: 3,
    className: 'tx-pill tx-accepted',
  },
  'finalized-success': {
    label: 'Finalized (7) · Success',
    step: 4,
    className: 'tx-pill tx-success',
  },
  'finalized-error': {
    label: 'Finalized · Error / Canceled',
    step: 4,
    className: 'tx-pill tx-error',
  },
};

export function TxTrackerPanel({
  transactions,
  hasActive,
  onPollNow,
  onRemove,
  onClearAll,
}: TxTrackerPanelProps) {
  if (transactions.length === 0) {
    return (
      <section className="panel tracker-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Resumable Lifecycle Tracker</p>
            <h3 className="panel-title">StudioNet Transaction Queue</h3>
          </div>
          <span className="mono muted small">localStorage · 7s poll interval</span>
        </div>
        <p className="muted small">
          No active or recent wallet transactions. Any write transaction you submit (
          <code>register_clause</code>, <code>submit_challenge</code>,{' '}
          <code>withdraw_balance</code>) is persisted in <code>localStorage</code> and
          automatically resumes polling every 7 seconds across page reloads until{' '}
          <code>Finalized (7)</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="panel tracker-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Resumable Lifecycle Tracker</p>
          <h3 className="panel-title">
            StudioNet Transaction Queue ({transactions.length})
          </h3>
        </div>
        <div className="row-actions">
          {hasActive && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPollNow}>
              <RefreshCw size={13} className="spin" />
              <span>Poll Now (7s auto)</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearAll}>
            <Trash2 size={13} />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      <div className="tx-list">
        {transactions.map((tx) => {
          const meta = LIFECYCLE_LABELS[tx.lifecycle];
          const url = txExplorerUrl(tx.hash);
          return (
            <div key={tx.hash} className="tx-item">
              <div className="tx-item-top">
                <div className="tx-item-title">
                  <span className="mono tx-method">{tx.method}</span>
                  <span className="tx-summary">{tx.summary}</span>
                </div>
                <div className="row-actions">
                  <span className={meta.className}>
                    {tx.lifecycle === 'finalized-success' && <CheckCircle2 size={12} />}
                    {tx.lifecycle === 'finalized-error' && <XCircle size={12} />}
                    {tx.lifecycle === 'accepted' && <ShieldCheck size={12} />}
                    {(tx.lifecycle === 'submitted' || tx.lifecycle === 'pending') && (
                      <Clock size={12} />
                    )}
                    <span>{meta.label}</span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove from history"
                    onClick={() => onRemove(tx.hash)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="tx-steps" aria-label="Transaction lifecycle stages">
                <span className={meta.step >= 1 ? 'step active' : 'step'}>1. submitted</span>
                <span className={meta.step >= 2 ? 'step active' : 'step'}>2. pending</span>
                <span className={meta.step >= 3 ? 'step active' : 'step'}>
                  3. accepted (5)
                </span>
                <span
                  className={
                    meta.step >= 4
                      ? tx.lifecycle === 'finalized-error'
                        ? 'step error'
                        : 'step active'
                      : 'step'
                  }
                >
                  4. {tx.lifecycle === 'finalized-error' ? 'finalized-error' : 'finalized-success'}
                </span>
              </div>

              <div className="tx-item-meta mono">
                <span>Tx: {shortHash(tx.hash, 12, 10)}</span>
                {tx.rawStatus && <span>RPC Status: {tx.rawStatus}</span>}
                {tx.rawResult && <span>Consensus: {tx.rawResult}</span>}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="ext-link">
                    <span>Explorer</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {tx.errorMessage && (
                <p className="error-note small">Poll note: {tx.errorMessage}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
