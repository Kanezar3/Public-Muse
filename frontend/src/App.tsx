import { useCallback, useEffect, useState } from 'react';
import { BookMarked, ExternalLink, Landmark, Shield, Wallet } from 'lucide-react';
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

  // Attempt to load /proof.json (populated by Stage 3 deployer); fallback to src/data/proof.json
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

  return (
    <div className="app-shell">
      {/* Editorial Archival Masthead */}
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand-block">
            <div className="brand-mark">
              <Landmark size={20} strokeWidth={1.8} />
            </div>
            <div>
              <div className="brand-eyebrow mono">
                GENLAYER STUDIONET (CHAIN {STUDIONET_CHAIN_ID}) · CLEAN-ROOM PROVENANCE LEDGER
              </div>
              <h1 className="brand-title">Public Muse</h1>
            </div>
          </div>

          <div className="masthead-controls">
            <div className="contract-box">
              <label htmlFor="contract-addr-input" className="mono small muted">
                Contract
              </label>
              <input
                id="contract-addr-input"
                type="text"
                className="mono contract-input"
                value={contractOverride}
                onChange={(e) => setContractOverride(e.target.value)}
                placeholder={
                  proof.contract_address
                    ? proof.contract_address
                    : '0x… (from proof.json or override)'
                }
              />
              {contractExplorer && (
                <a
                  href={contractExplorer}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-link"
                  title="View contract on StudioNet Explorer"
                >
                  <ExternalLink size={14} />
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

        {/* Navigation Tabs */}
        <nav className="nav-bar" aria-label="Primary views">
          <div className="nav-inner">
            <button
              type="button"
              className={`nav-tab ${activeTab === 'inspector' ? 'active' : ''}`}
              onClick={() => setActiveTab('inspector')}
            >
              <BookMarked size={15} />
              <span>Reviewer Proof Inspector (No-Wallet)</span>
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'desk' ? 'active' : ''}`}
              onClick={() => setActiveTab('desk')}
            >
              <Shield size={15} />
              <span>Interactive Bond &amp; Challenge Desk</span>
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
      </header>

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
