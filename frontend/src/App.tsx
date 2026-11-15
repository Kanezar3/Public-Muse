import { useCallback, useEffect, useState } from 'react';
import { BookMarked, ExternalLink, Shield, Wallet } from 'lucide-react';
import type { Address } from 'viem';
import fallbackProof from './data/proof.json';
import { ProofInspector } from './components/ProofInspector';
import { TxTrackerPanel } from './components/TxTrackerPanel';
import { WalletDesk } from './components/WalletDesk';
import { useTxTracker } from './hooks/useTxTracker';
import {
  STUDIONET_CHAIN_ID,
  STUDIONET_EXPLORER_URL,
  addressExplorerUrl,
  connectBrowserWallet,
  fetchLiveContractState,
  shortHash,
} from './lib/genlayer';
import type { LiveChainSnapshot, ProofDocument } from './types/proof';

type ActiveTab = 'inspector' | 'desk';

export function App() {
  const [proof, setProof] = useState<ProofDocument>(fallbackProof as ProofDocument);
  const [contractOverride, setContractOverride] = useState<string>(
    import.meta.env.VITE_CONTRACT_ADDRESS ?? ''
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('inspector');
  const [connectedAddress, setConnectedAddress] = useState<Address | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [liveSnapshot, setLiveSnapshot] = useState<LiveChainSnapshot | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const activeContractAddress =
    contractOverride.trim() || proof.contract_address || '';

  const refreshLiveState = useCallback(async () => {
    setLiveLoading(true);
    const snap = await fetchLiveContractState(activeContractAddress, connectedAddress);
    setLiveSnapshot(snap);
    setLiveLoading(false);
  }, [activeContractAddress, connectedAddress]);

  const {
    transactions,
    hasActive,
    trackTransaction,
    clearTransactions,
    removeTransaction,
    pollNow,
  } = useTxTracker(refreshLiveState);

  // Attempt to load /proof.json; fallback to bundled src/data/proof.json
  useEffect(() => {
    let cancelled = false;
    fetch('/proof.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProofDocument | null) => {
        if (!cancelled && data && Array.isArray(data.cases) && data.cases.length > 0) {
          setProof(data);
        }
      })
      .catch(() => {
        // Keep bundled fallbackProof
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh live StudioNet state whenever contract address or wallet changes
  useEffect(() => {
    void refreshLiveState();
  }, [refreshLiveState]);

  // Listen for wallet account changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const handleAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as string[]) : [];
      setConnectedAddress(list[0] ? (list[0] as Address) : null);
    };
    eth.on('accountsChanged', handleAccountsChanged);
    return () => {
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, []);

  const handleConnectWallet = async () => {
    setWalletError(null);
    try {
      const addr = await connectBrowserWallet();
      setConnectedAddress(addr);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  };

  const contractExplorer = addressExplorerUrl(activeContractAddress);
  const finalizedCount = String(
    proof.cases.filter((c) => c.tx_status === 'FINALIZED').length
  ).padStart(2, '0');
  const totalCount = String(proof.cases.length).padStart(2, '0');

  return (
    <div className="app-shell">
      {/* Editorial Double-Rule Archival Masthead (scrolls naturally) */}
      <header className="masthead">
        <div className="masthead-ledger mono">
          <div className="masthead-ledger-inner">
            <span>NETWORK · STUDIONET {STUDIONET_CHAIN_ID}</span>
            <span className="ledger-sep">·</span>
            <span>
              CONTRACT ·{' '}
              {activeContractAddress ? (
                contractExplorer ? (
                  <a href={contractExplorer} target="_blank" rel="noreferrer" className="ext-link">
                    {shortHash(activeContractAddress, 6, 4)}
                  </a>
                ) : (
                  shortHash(activeContractAddress, 6, 4)
                )
              ) : (
                'UNSET'
              )}
            </span>
            <span className="ledger-sep">·</span>
            <span>CONSENSUS · OPTIMISTIC DEMOCRACY</span>
            <span className="ledger-sep">·</span>
            <span>
              FINALIZED CASES · {finalizedCount} / {totalCount}
            </span>
          </div>
        </div>

        <div className="masthead-inner">
          <div className="brand-block">
            <div className="folio-seal" aria-hidden="true">
              <span className="folio-seal-section">§</span>
              <span className="folio-seal-mono">PM</span>
            </div>
            <div>
              <h1 className="brand-title">Public Muse</h1>
              <p className="brand-subtitle">
                Public-Domain Clean-Room Adaptation &amp; Provenance Bonds
              </p>
            </div>
          </div>

          <div className="masthead-controls">
            <div className="contract-box">
              <label htmlFor="contract-addr-input" className="mono small muted">
                Override
              </label>
              <input
                id="contract-addr-input"
                type="text"
                className="mono contract-input"
                value={contractOverride}
                onChange={(e) => setContractOverride(e.target.value)}
                placeholder={
                  proof.contract_address
                    ? shortHash(proof.contract_address, 8, 6)
                    : '0x… contract address'
                }
                aria-label="Contract address override"
              />
              {contractExplorer && (
                <a
                  href={contractExplorer}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-link"
                  title="View contract on StudioNet Explorer"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </div>

            {connectedAddress ? (
              <div className="wallet-chip mono">
                <span className="dot-online" />
                <span>{shortHash(connectedAddress, 6, 4)}</span>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleConnectWallet}
              >
                <Wallet size={14} />
                <span>Connect Wallet</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Compact Sticky Navigation Bar (~44px) */}
      <nav className="nav-bar" aria-label="Primary views">
        <div className="nav-inner">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'inspector' ? 'active' : ''}`}
            onClick={() => setActiveTab('inspector')}
          >
            <BookMarked size={14} />
            <span>Proof Dossiers</span>
            <span className="nav-pill mono">NO WALLET</span>
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'desk' ? 'active' : ''}`}
            onClick={() => setActiveTab('desk')}
          >
            <Shield size={14} />
            <span>Filing Desk</span>
          </button>
          <a
            href={STUDIONET_EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="nav-ext mono small"
          >
            <span>StudioNet Explorer</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </nav>

      <main className="main-content">
        {walletError && <div className="alert alert-error">{walletError}</div>}

        {activeTab === 'inspector' ? (
          <ProofInspector
            proof={proof}
            liveSnapshot={liveSnapshot}
            liveLoading={liveLoading}
            connectedAddress={connectedAddress}
            onRefreshLive={refreshLiveState}
          />
        ) : (
          <WalletDesk
            contractAddress={activeContractAddress}
            connectedAddress={connectedAddress}
            liveSnapshot={liveSnapshot}
            onConnectWallet={handleConnectWallet}
            onTrackTx={trackTransaction}
          />
        )}

        <TxTrackerPanel
          transactions={transactions}
          hasActive={hasActive}
          onPollNow={pollNow}
          onRemove={removeTransaction}
          onClearAll={clearTransactions}
        />
      </main>
    </div>
  );
}

export default App;
