import { useState, type FormEvent } from 'react';
import {
  Coins,
  FilePlus2,
  Gavel,
  TimerReset,
  Wallet,
} from 'lucide-react';
import type { Address } from 'viem';
import {
  createWalletClient,
  formatWeiToGen,
  parseGenToWei,
  shortHash,
} from '../lib/genlayer';
import type { LiveChainSnapshot } from '../types/proof';

interface WalletDeskProps {
  contractAddress: string;
  connectedAddress: Address | null;
  liveSnapshot: LiveChainSnapshot | null;
  onConnectWallet: () => Promise<void>;
  onTrackTx: (entry: {
    hash: `0x${string}`;
    method: string;
    summary: string;
    contractAddress: string;
  }) => void;
}

export function WalletDesk({
  contractAddress,
  connectedAddress,
  liveSnapshot,
  onConnectWallet,
  onTrackTx,
}: WalletDeskProps) {
  // Register Clause state
  const [workTitle, setWorkTitle] = useState(
    'The Wonderful Wizard of Oz (1900 Novel)'
  );
  const [elementClaim, setElementClaim] = useState(
    'Dorothy wears Silver Shoes gifted by the Good Witch of the North.'
  );
  const [pdSource, setPdSource] = useState(
    'https://en.wikipedia.org/w/index.php?title=Silver_Shoes&oldid=1378659855'
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState('3600');
  const [bondAmount, setBondAmount] = useState('1');
  const [bondUnit, setBondUnit] = useState<'gen' | 'wei'>('gen');

  // Submit Challenge state
  const [challengeClauseId, setChallengeClauseId] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState(
    'https://en.wikipedia.org/w/index.php?title=Ruby_slippers&oldid=1384457883'
  );
  const [feeAmount, setFeeAmount] = useState('0.25');
  const [feeUnit, setFeeUnit] = useState<'gen' | 'wei'>('gen');

  // Fallbacks state
  const [stuckChallengeId, setStuckChallengeId] = useState('');
  const [expiredClauseId, setExpiredClauseId] = useState('');

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const isContractReady = /^0x[a-fA-F0-9]{40}$/.test(contractAddress);

  const toWei = (amount: string, unit: 'gen' | 'wei'): bigint => {
    if (unit === 'wei') return BigInt(amount.trim() || '0');
    return parseGenToWei(amount);
  };

  const runWrite = async (
    actionKey: string,
    functionName: string,
    args: (string | number | bigint | boolean)[],
    value: bigint,
    summary: string
  ) => {
    setActionError(null);
    setActionSuccess(null);

    if (!isContractReady) {
      setActionError(
        'Contract address is not configured. Wait for Stage 3 proof.json or enter a deployed StudioNet address in the header.'
      );
      return;
    }
    if (!connectedAddress) {
      setActionError('Please connect your browser wallet on GenLayer StudioNet (Chain 61999).');
      return;
    }

    setBusyAction(actionKey);
    try {
      const client = await createWalletClient(connectedAddress);
      const txHash = (await client.writeContract({
        address: contractAddress as Address,
        functionName,
        args,
        value,
      })) as `0x${string}`;

      onTrackTx({
        hash: txHash,
        method: functionName,
        summary,
        contractAddress,
      });
      setActionSuccess(
        `${functionName} submitted (${shortHash(txHash, 12, 10)}). Tracking every 7s below.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegisterClause = async (e: FormEvent) => {
    e.preventDefault();
    const timeoutNum = Math.max(60, Number.parseInt(timeoutSeconds, 10) || 3600);
    const valueWei = toWei(bondAmount, bondUnit);
    await runWrite(
      'register',
      'register_clause',
      [workTitle.trim(), elementClaim.trim(), pdSource.trim(), timeoutNum],
      valueWei,
      `${workTitle.trim().slice(0, 38)} (${formatWeiToGen(valueWei)})`
    );
  };

  const handleSubmitChallenge = async (e: FormEvent) => {
    e.preventDefault();
    const valueWei = toWei(feeAmount, feeUnit);
    await runWrite(
      'challenge',
      'submit_challenge',
      [challengeClauseId.trim(), evidenceUrl.trim()],
      valueWei,
      `Challenge on ${challengeClauseId.trim()} (${formatWeiToGen(valueWei)})`
    );
  };

  return (
    <div className="desk-stack">
      {/* Wallet Status Banner */}
      <section className="panel wallet-banner">
        <div>
          <p className="eyebrow">Interactive StudioNet Flows (Chain 61999)</p>
          <h2 className="panel-title">Adaptation Bond &amp; Challenge Desk</h2>
          <p className="muted small">
            Transactions are signed via <code>window.ethereum</code> +{' '}
            <code>genlayer-js</code> (<code>studionet</code>) and tracked through{' '}
            <code>Accepted (5)</code> appeal window to <code>Finalized (7)</code>.
          </p>
        </div>
        <div className="wallet-banner-actions">
          {connectedAddress ? (
            <div className="wallet-pill mono">
              <Wallet size={14} />
              <span>{shortHash(connectedAddress, 8, 6)}</span>
              <span className="pill pill-ok">
                Claimable: {formatWeiToGen(liveSnapshot?.claimableBalanceWei ?? '0')}
              </span>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onConnectWallet}>
              <Wallet size={15} />
              <span>Connect MetaMask (Chain 61999)</span>
            </button>
          )}
        </div>
      </section>

      {actionError && <div className="alert alert-error">{actionError}</div>}
      {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}

      <div className="desk-grid">
        {/* Form 1: register_clause */}
        <form className="panel form-card" onSubmit={handleRegisterClause}>
          <div className="form-card-header">
            <FilePlus2 size={18} />
            <div>
              <h3>Register Adaptation Clause</h3>
              <p className="mono muted small">
                register_clause(work_title, element_claim, public_domain_source, timeout_seconds)
              </p>
            </div>
          </div>

          <label className="field">
            <span>Public-Domain Work Title</span>
            <input
              type="text"
              required
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              placeholder="e.g. The Wonderful Wizard of Oz (1900 Novel)"
            />
          </label>

          <label className="field">
            <span>Clean-Room Element Claim</span>
            <textarea
              rows={3}
              required
              value={elementClaim}
              onChange={(e) => setElementClaim(e.target.value)}
              placeholder="Specific character, prop, or plot element claimed as public domain..."
            />
          </label>

          <label className="field">
            <span>Public-Domain Source URL</span>
            <input
              type="url"
              required
              value={pdSource}
              onChange={(e) => setPdSource(e.target.value)}
              placeholder="https://en.wikipedia.org/w/index.php?title=...&oldid=..."
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Timeout (seconds)</span>
              <input
                type="number"
                min={60}
                required
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Creator Bond</span>
              <div className="input-with-unit">
                <input
                  type="text"
                  required
                  value={bondAmount}
                  onChange={(e) => setBondAmount(e.target.value)}
                />
                <select
                  value={bondUnit}
                  onChange={(e) => setBondUnit(e.target.value as 'gen' | 'wei')}
                >
                  <option value="gen">GEN</option>
                  <option value="wei">wei</option>
                </select>
              </div>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busyAction !== null || !isContractReady}
          >
            {busyAction === 'register' ? 'Submitting…' : 'Post Bond & Register Clause'}
          </button>
        </form>

        {/* Form 2: submit_challenge */}
        <form className="panel form-card" onSubmit={handleSubmitChallenge}>
          <div className="form-card-header">
            <Gavel size={18} />
            <div>
              <h3>Submit Provenance Challenge</h3>
              <p className="mono muted small">
                submit_challenge(clause_id, evidence_url) · payable
              </p>
            </div>
          </div>

          <label className="field">
            <span>Target Clause ID</span>
            <input
              type="text"
              required
              value={challengeClauseId}
              onChange={(e) => setChallengeClauseId(e.target.value)}
              placeholder="Enter clause_id (or pick from live clauses below)"
            />
            {liveSnapshot?.clauses && liveSnapshot.clauses.length > 0 && (
              <div className="quick-picks">
                {liveSnapshot.clauses.slice(0, 4).map((c) => (
                  <button
                    key={c.clause_id}
                    type="button"
                    className="chip-btn mono"
                    onClick={() => setChallengeClauseId(c.clause_id)}
                  >
                    {c.clause_id}
                  </button>
                ))}
              </div>
            )}
          </label>

          <label className="field">
            <span>Immutable Evidence URL Hint (Wikipedia oldid / GitHub commit)</span>
            <input
              type="url"
              required
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/w/index.php?title=...&oldid=..."
            />
          </label>

          <label className="field">
            <span>Challenge Fee</span>
            <div className="input-with-unit">
              <input
                type="text"
                required
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
              <select
                value={feeUnit}
                onChange={(e) => setFeeUnit(e.target.value as 'gen' | 'wei')}
              >
                <option value="gen">GEN</option>
                <option value="wei">wei</option>
              </select>
            </div>
          </label>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busyAction !== null || !isContractReady}
          >
            {busyAction === 'challenge' ? 'Submitting…' : 'Submit Equivalence Challenge'}
          </button>
        </form>

        {/* Form 3: Withdraw & Deadline Fallbacks */}
        <div className="panel form-card form-card-wide">
          <div className="form-card-header">
            <Coins size={18} />
            <div>
              <h3>Withdrawals &amp; Deadline Fallbacks</h3>
              <p className="mono muted small">
                withdraw_balance() · resolve_stuck_challenge(challenge_id) ·
                claim_expired_clause_bond(clause_id)
              </p>
            </div>
          </div>

          <div className="fallback-grid">
            <div className="sub-card">
              <h4>Claimable Balance</h4>
              <p className="mono big-num">
                {formatWeiToGen(liveSnapshot?.claimableBalanceWei ?? '0')}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyAction !== null || !isContractReady || !connectedAddress}
                onClick={() =>
                  runWrite('withdraw', 'withdraw_balance', [], 0n, 'Withdraw claimable GEN balance')
                }
              >
                {busyAction === 'withdraw' ? 'Withdrawing…' : 'Withdraw Balance'}
              </button>
            </div>

            <div className="sub-card">
              <h4>
                <TimerReset size={14} /> Resolve Stuck Challenge
              </h4>
              <label className="field">
                <span>Challenge ID</span>
                <input
                  type="text"
                  value={stuckChallengeId}
                  onChange={(e) => setStuckChallengeId(e.target.value)}
                  placeholder="challenge_id"
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  busyAction !== null || !isContractReady || !stuckChallengeId.trim()
                }
                onClick={() =>
                  runWrite(
                    'resolve_stuck',
                    'resolve_stuck_challenge',
                    [stuckChallengeId.trim()],
                    0n,
                    `Resolve stuck challenge ${stuckChallengeId.trim()}`
                  )
                }
              >
                {busyAction === 'resolve_stuck' ? 'Submitting…' : 'Resolve Stuck Challenge'}
              </button>
            </div>

            <div className="sub-card">
              <h4>
                <TimerReset size={14} /> Claim Expired Clause Bond
              </h4>
              <label className="field">
                <span>Clause ID</span>
                <input
                  type="text"
                  value={expiredClauseId}
                  onChange={(e) => setExpiredClauseId(e.target.value)}
                  placeholder="clause_id"
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  busyAction !== null || !isContractReady || !expiredClauseId.trim()
                }
                onClick={() =>
                  runWrite(
                    'claim_expired',
                    'claim_expired_clause_bond',
                    [expiredClauseId.trim()],
                    0n,
                    `Claim expired bond for ${expiredClauseId.trim()}`
                  )
                }
              >
                {busyAction === 'claim_expired' ? 'Submitting…' : 'Claim Expired Bond'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
