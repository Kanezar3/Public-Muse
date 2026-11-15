import { useCallback, useEffect, useRef, useState } from 'react';
import { pollTransactionOnce, TX_POLL_INTERVAL_MS } from '../lib/genlayer';
import type { TrackedTransaction } from '../types/proof';

const STORAGE_KEY = 'public_muse_tracked_txs_v1';

function loadStoredTransactions(): TrackedTransaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackedTransaction[]) : [];
  } catch {
    return [];
  }
}

function saveStoredTransactions(txs: TrackedTransaction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs.slice(0, 30)));
  } catch {
    // ignore storage quota errors
  }
}

export function useTxTracker(onFinalized?: () => void) {
  const [transactions, setTransactions] = useState<TrackedTransaction[]>(() =>
    loadStoredTransactions()
  );
  const onFinalizedRef = useRef(onFinalized);
  onFinalizedRef.current = onFinalized;

  useEffect(() => {
    saveStoredTransactions(transactions);
  }, [transactions]);

  const trackTransaction = useCallback(
    (entry: {
      hash: `0x${string}`;
      method: string;
      summary: string;
      contractAddress: string;
    }) => {
      const now = new Date().toISOString();
      setTransactions((prev) => {
        const filtered = prev.filter(
          (item) => item.hash.toLowerCase() !== entry.hash.toLowerCase()
        );
        const next: TrackedTransaction = {
          hash: entry.hash,
          method: entry.method,
          summary: entry.summary,
          contractAddress: entry.contractAddress,
          createdAt: now,
          updatedAt: now,
          lifecycle: 'submitted',
          rawStatus: 'SUBMITTED',
        };
        return [next, ...filtered];
      });
    },
    []
  );

  const clearTransactions = useCallback(() => {
    setTransactions([]);
  }, []);

  const removeTransaction = useCallback((hash: string) => {
    setTransactions((prev) => prev.filter((item) => item.hash !== hash));
  }, []);

  const pollActiveTransactions = useCallback(async () => {
    const active = transactions.filter(
      (tx) => tx.lifecycle !== 'finalized-success' && tx.lifecycle !== 'finalized-error'
    );
    if (active.length === 0) return;

    let newlyFinalized = false;
    const updates = new Map<
      string,
      Partial<Pick<TrackedTransaction, 'lifecycle' | 'rawStatus' | 'rawResult' | 'errorMessage'>>
    >();

    for (const tx of active) {
      try {
        const res = await pollTransactionOnce(tx.hash);
        if (
          res.lifecycle === 'finalized-success' ||
          res.lifecycle === 'finalized-error'
        ) {
          newlyFinalized = true;
        }
        updates.set(tx.hash, {
          lifecycle: res.lifecycle,
          rawStatus: res.rawStatus,
          rawResult: res.rawResult,
          errorMessage: undefined,
        });
      } catch (err) {
        updates.set(tx.hash, {
          errorMessage: err instanceof Error ? err.message : 'Polling error',
        });
      }
    }

    if (updates.size > 0) {
      const now = new Date().toISOString();
      setTransactions((prev) =>
        prev.map((tx) => {
          const patch = updates.get(tx.hash);
          return patch ? { ...tx, ...patch, updatedAt: now } : tx;
        })
      );
    }

    if (newlyFinalized && onFinalizedRef.current) {
      onFinalizedRef.current();
    }
  }, [transactions]);

  const hasActive = transactions.some(
    (tx) => tx.lifecycle !== 'finalized-success' && tx.lifecycle !== 'finalized-error'
  );

  useEffect(() => {
    if (!hasActive) return;
    // Run an immediate poll on mount/resume, then every 7 seconds
    const initialTimeout = window.setTimeout(() => {
      void pollActiveTransactions();
    }, 1200);
    const interval = window.setInterval(() => {
      void pollActiveTransactions();
    }, TX_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(interval);
    };
  }, [hasActive, pollActiveTransactions]);

  return {
    transactions,
    hasActive,
    trackTransaction,
    clearTransactions,
    removeTransaction,
    pollNow: pollActiveTransactions,
  };
}
