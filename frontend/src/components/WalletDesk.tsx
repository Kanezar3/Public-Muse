import { useState, type FormEvent } from 'react';
import {
  BookmarkCheck,
  Coins,
  FilePlus2,
  Gavel,
  TimerReset,
  Wallet,
} from 'lucide-react';
import type { Address } from 'viem';
import { formatWeiDisplay } from '../lib/format';
import {
  createWalletClient,
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

interface FilingPreset {
  id: string;
  label: string;
  target: 'register' | 'challenge';
  workTitle?: string;
  elementClaim?: string;
  pdSource?: string;
  timeoutSeconds?: string;
  bondAmount?: string;
  bondUnit?: 'gen' | 'wei';
  clauseId?: string;
  evidenceUrl?: string;
  feeAmount?: string;
  feeUnit?: 'gen' | 'wei';
}

const FILING_PRESETS: FilingPreset[] = [
  {
    id: 'silver-shoes',
    label: '1900 Silver Shoes Clean Claim',
    target: 'register',
    workTitle: 'The Wonderful Wizard of Oz',
    elementClaim:
      "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, Dorothy Gale wears magical Silver Shoes.",
    pdSource: 'The Wonderful Wizard of Oz (1900 novel)',
    timeoutSeconds: '900',
    bondAmount: '100',
    bondUnit: 'wei',
  },
  {
    id: 'ruby-slippers',
    label: '1939 Ruby Slippers Breach Test',
    target: 'register',
    workTitle: 'The Wonderful Wizard of Oz',
    elementClaim:
      "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, Dorothy Gale wears magical Ruby Slippers.",
    pdSource: 'The Wonderful Wizard of Oz (1900 novel)',
    timeoutSeconds: '900',
    bondAmount: '100',
    bondUnit: 'wei',
  },
  {
    id: 'vague-filter',
    label: 'Vague Marketing Filter Test',
    target: 'register',
    workTitle: 'The Wonderful Wizard of Oz',
    elementClaim:
      'Our Oz stage adaptation will faithfully preserve the timeless emotional warmth and wholesome cinematic spirit of the story.',
    pdSource: 'The Wonderful Wizard of Oz (1900 novel)',
    timeoutSeconds: '900',
    bondAmount: '100',
    bondUnit: 'wei',
  },
  {
    id: 'prompt-injection',
    label: 'Prompt-Injection Fixture Challenge',
    target: 'challenge',
    clauseId: 'clause-2',
    evidenceUrl:
      'https://raw.githubusercontent.com/Kanezar3/Public-Muse/8812f82f8d492d7f0c7bf406c95147e7e6a17a4a/fixtures/prompt_injection_oz.txt',
    feeAmount: '20',
    feeUnit: 'wei',
  },
];

export function WalletDesk({
  contractAddress,
  connectedAddress,
  liveSnapshot,
  onConnectWallet,
  onTrackTx,
}: WalletDeskProps) {
  // Register Clause state
  const [workTitle, setWorkTitle] = useState('The Wonderful Wizard of Oz');
  const [elementClaim, setElementClaim] = useState(
    "In L. Frank Baum's 1900 novel The Wonderful Wizard of Oz, Dorothy Gale wears magical Silver Shoes."
  );
  const [pdSource, setPdSource] = useState('The Wonderful Wizard of Oz (1900 novel)');
  const [timeoutSeconds, setTimeoutSeconds] = useState('900');
  const [bondAmount, setBondAmount] = useState('100');
  const [bondUnit, setBondUnit] = useState<'gen' | 'wei'>('wei');

  // Submit Challenge state
  const [challengeClauseId, setChallengeClauseId] = useState('clause-2');
  const [evidenceUrl, setEvidenceUrl] = useState(
    'https://en.wikipedia.org/w/api.php?action=parse&oldid=1384457883&prop=wikitext&section=0&format=json'
  );
  const [feeAmount, setFeeAmount] = useState('20');
  const [feeUnit, setFeeUnit] = useState<'gen' | 'wei'>('wei');

  // Fallbacks state
  const [stuckChallengeId, setStuckChallengeId] = useState('');
  const [expiredClauseId, setExpiredClauseId] = useState('');

  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const isContractReady = /^0x[a-fA-F0-9]{40}$/.test(contractAddress);

  const applyPreset = (preset: FilingPreset) => {
    setActivePresetId(preset.id);
    if (preset.target === 'register') {
      if (preset.workTitle !== undefined) setWorkTitle(preset.workTitle);
      if (preset.elementClaim !== undefined) setElementClaim(preset.elementClaim);
      if (preset.pdSource !== undefined) setPdSource(preset.pdSource);
      if (preset.timeoutSeconds !== undefined) setTimeoutSeconds(preset.timeoutSeconds);
      if (preset.bondAmount !== undefined) setBondAmount(preset.bondAmount);
      if (preset.bondUnit !== undefined) setBondUnit(preset.bondUnit);
    } else {
      if (preset.clauseId !== undefined) setChallengeClauseId(preset.clauseId);
      if (preset.evidenceUrl !== undefined) setEvidenceUrl(preset.evidenceUrl);
      if (preset.feeAmount !== undefined) setFeeAmount(preset.feeAmount);
      if (preset.feeUnit !== undefined) setFeeUnit(preset.feeUnit);
    }
  };

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
        'Contract address is not configured. Enter a deployed StudioNet address in the masthead.'
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
    const timeoutNum = Math.max(60, Number.parseInt(timeoutSeconds, 10) || 900);
    const valueWei = toWei(bondAmount, bondUnit);
    await runWrite(
      'register',
      'register_clause',
      [workTitle.trim(), elementClaim.trim(), pdSource.trim(), timeoutNum],
      valueWei,
      `${workTitle.trim().slice(0, 38)} (${formatWeiDisplay(valueWei).primary})`
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
      `Challenge on ${challengeClauseId.trim()} (${formatWeiDisplay(valueWei).primary})`
    );
  };

  return (
    <div className="desk-stack">
      {/* Wallet Status Banner */}
      <section className="folio-panel wallet-banner">
        <div>
          <p className="eyebrow">Interactive StudioNet Flows · Chain 61999</p>
          <h2 className="folio-title">Adaptation Bond &amp; Challenge Filing Desk</h2>
          <p className="muted small">
            Transactions are signed via <code>window.ethereum</code> +{' '}
            <code>genlayer-js</code> and tracked through{' '}
            <code>Accepted (5)</code> appeal window to <code>Finalized (7)</code>.
          </p>
        </div>
        <div className="wallet-banner-actions">
          {connectedAddress ? (
            <div className="wallet-pill mono">
              <Wallet size={14} />
              <span>{shortHash(connectedAddress, 8, 6)}</span>
              <span className="stamp-inline stamp-inline-ok">
                Escrow: {formatWeiDisplay(liveSnapshot?.claimableBalanceWei ?? '0').primary}
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

      {/* One-Click Example Filing Preset Bar */}
      <section className="preset-bar" aria-label="Load example filing presets">
        <div className="preset-label">
          <BookmarkCheck size={14} />
          <span className="mono">LOAD EXAMPLE FILING</span>
        </div>
        <div className="preset-buttons">
          {FILING_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-btn ${activePresetId === preset.id ? 'active' : ''}`}
              onClick={() => applyPreset(preset)}
            >
              <span>{preset.label}</span>
              <span className="preset-target mono">
                {preset.target === 'register' ? 'Clause' : 'Challenge'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {actionError && <div className="alert alert-error">{actionError}</div>}
      {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}

      <div className="desk-grid">
        {/* Form 1: register_clause */}
        <form className="folio-panel form-card" onSubmit={handleRegisterClause}>
          <div className="form-card-header">
            <FilePlus2 size={18} />
            <div>
              <div className="heading-with-tag">
                <h3>Register Adaptation Clause</h3>
                <span className="method-tag mono">register_clause · payable</span>
              </div>
              <p className="muted small">
                Post a creator bond and submit a clean-room claim for Gate 1 observability screening.
              </p>
            </div>
          </div>

          <fieldset className="fieldset-group">
            <label className="field">
              <span>Public-Domain Work Title</span>
              <input
                type="text"
                required
                value={workTitle}
                onChange={(e) => setWorkTitle(e.target.value)}
                placeholder="e.g. The Wonderful Wizard of Oz"
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
              <span>Public-Domain Source Citation / URL</span>
              <input
                type="text"
                required
                value={pdSource}
                onChange={(e) => setPdSource(e.target.value)}
                placeholder="e.g. The Wonderful Wizard of Oz (1900 novel)"
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
                <span>Creator Bond ({bondUnit.toUpperCase()})</span>
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
                    <option value="wei">wei</option>
                    <option value="gen">GEN</option>
                  </select>
                </div>
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busyAction !== null || !isContractReady}
          >
            {busyAction === 'register' ? 'Submitting…' : 'Post Bond & Register Clause'}
          </button>
        </form>

        {/* Form 2: submit_challenge */}
        <form className="folio-panel form-card" onSubmit={handleSubmitChallenge}>
          <div className="form-card-header">
            <Gavel size={18} />
            <div>
              <div className="heading-with-tag">
                <h3>Submit Provenance Challenge</h3>
                <span className="method-tag mono">submit_challenge · payable</span>
              </div>
              <p className="muted small">
                Attach an immutable source URL for validator equivalence audit against the claim.
              </p>
            </div>
          </div>

          <fieldset className="fieldset-group">
            <label className="field">
              <span>Target Clause ID</span>
              <input
                type="text"
                required
                value={challengeClauseId}
                onChange={(e) => setChallengeClauseId(e.target.value)}
                placeholder="Enter clause_id (or pick from live clauses)"
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
              <span>Immutable Evidence URL (Wikipedia oldid / GitHub SHA / Wayback)</span>
              <input
                type="url"
                required
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://en.wikipedia.org/w/api.php?action=parse&oldid=..."
              />
            </label>

            <label className="field">
              <span>Challenge Fee ({feeUnit.toUpperCase()})</span>
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
                  <option value="wei">wei</option>
                  <option value="gen">GEN</option>
                </select>
              </div>
            </label>
          </fieldset>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busyAction !== null || !isContractReady}
          >
            {busyAction === 'challenge' ? 'Submitting…' : 'Submit Equivalence Challenge'}
          </button>
        </form>

        {/* Form 3: Withdraw & Deadline Fallbacks */}
        <div className="folio-panel form-card form-card-wide">
          <div className="form-card-header">
            <Coins size={18} />
            <div>
              <div className="heading-with-tag">
                <h3>Escrow Withdrawals &amp; Deadline Fallbacks</h3>
                <span className="method-tag mono">withdraw · expiry</span>
              </div>
              <p className="muted small">
                Withdraw settled EOA escrow balances or trigger deterministic timeout fallbacks.
              </p>
            </div>
          </div>

          <div className="fallback-grid">
            <div className="sub-folio">
              <h4>Claimable Escrow</h4>
              <p className="mono big-num">
                {formatWeiDisplay(liveSnapshot?.claimableBalanceWei ?? '0').primary}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyAction !== null || !isContractReady || !connectedAddress}
                onClick={() =>
                  runWrite('withdraw', 'withdraw_balance', [], 0n, 'Withdraw claimable balance')
                }
              >
                {busyAction === 'withdraw' ? 'Withdrawing…' : 'Withdraw Balance'}
              </button>
            </div>

            <div className="sub-folio">
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

            <div className="sub-folio">
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
