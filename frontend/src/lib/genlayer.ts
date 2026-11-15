import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import {
  TransactionHashVariant,
  TransactionStatus,
  type TransactionHash,
} from 'genlayer-js/types';
import { formatEther, parseEther, type Address, type Hex } from 'viem';
import type {
  LiveChainSnapshot,
  LiveChallenge,
  LiveClause,
  LiveConfig,
  TxLifecycleState,
} from '../types/proof';

export const STUDIONET_CHAIN_ID = 61999;
export const STUDIONET_RPC_URL = 'https://studio.genlayer.com/api';
export const STUDIONET_EXPLORER_URL = 'https://explorer-studio.genlayer.com';
export const TX_POLL_INTERVAL_MS = 7000;

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function txExplorerUrl(hash: string | null | undefined): string | null {
  if (!hash || /^0x0+$/.test(hash) || /^0x0{63}[0-9a-f]$/i.test(hash)) {
    return null;
  }
  return `${STUDIONET_EXPLORER_URL}/tx/${hash}`;
}

export function addressExplorerUrl(address: string | null | undefined): string | null {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return `${STUDIONET_EXPLORER_URL}/address/${address}`;
}

export function formatWeiToGen(wei: string | bigint | number | null | undefined): string {
  if (wei === null || wei === undefined || wei === '') return '0 GEN';
  try {
    const val = typeof wei === 'bigint' ? wei : BigInt(String(wei));
    return `${formatEther(val)} GEN`;
  } catch {
    return `${String(wei)} wei`;
  }
}

export function parseGenToWei(genAmount: string): bigint {
  const trimmed = genAmount.trim();
  if (!trimmed) return 0n;
  return parseEther(trimmed);
}

export function shortHash(value: string | null | undefined, head = 10, tail = 8): string {
  if (!value) return '—';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function createReadOnlyClient() {
  return createClient({
    chain: studionet,
    endpoint: STUDIONET_RPC_URL,
  });
}

export async function createWalletClient(account: Address) {
  if (!window.ethereum) {
    throw new Error('No browser wallet detected. Install MetaMask or a compatible EIP-1193 wallet.');
  }
  const client = createClient({
    chain: studionet,
    endpoint: STUDIONET_RPC_URL,
    account,
    provider: window.ethereum as never,
  });
  try {
    await client.connect('studionet');
  } catch {
    // Fallback: ensure wallet is on Chain 61999 (0xf22f)
    await ensureStudioNetChain();
  }
  return client;
}

export async function ensureStudioNetChain(): Promise<void> {
  if (!window.ethereum) return;
  const chainIdHex = `0x${STUDIONET_CHAIN_ID.toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: 'GenLayer StudioNet',
            nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
            rpcUrls: [STUDIONET_RPC_URL],
            blockExplorerUrls: [STUDIONET_EXPLORER_URL],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function connectBrowserWallet(): Promise<Address> {
  if (!window.ethereum) {
    throw new Error('No browser wallet detected (window.ethereum is unavailable).');
  }
  const accounts = (await window.ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet connection rejected or no accounts available.');
  }
  await ensureStudioNetChain();
  return accounts[0] as Address;
}

function normalizeContractValue<T>(raw: unknown): T {
  if (raw instanceof Map) {
    const obj: Record<string, unknown> = {};
    raw.forEach((v, k) => {
      obj[String(k)] = normalizeContractValue(v);
    });
    return obj as T;
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeContractValue(item)) as unknown as T;
  }
  if (typeof raw === 'bigint') {
    return raw.toString() as unknown as T;
  }
  if (raw && typeof raw === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      obj[k] = normalizeContractValue(v);
    }
    return obj as T;
  }
  return raw as T;
}

export async function readContractView<T>(
  contractAddress: Address,
  functionName: string,
  args: (string | number | bigint | boolean)[] = []
): Promise<T> {
  const client = createReadOnlyClient();
  const res = await client.readContract({
    address: contractAddress,
    functionName,
    args,
    jsonSafeReturn: true,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });

  if (typeof res === 'string') {
    const trimmed = res.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return normalizeContractValue<T>(JSON.parse(trimmed));
      } catch {
        // Fall through to normalizeContractValue if not valid JSON
      }
    }
  }

  return normalizeContractValue<T>(res);
}

export async function fetchLiveContractState(
  contractAddress: string,
  connectedAccount?: Address | null
): Promise<LiveChainSnapshot> {
  const fetchedAt = new Date().toISOString();
  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    return {
      contractAddress,
      fetchedAt,
      config: null,
      clauses: [],
      challenges: [],
      claimableBalanceWei: null,
      error: 'Contract address not configured yet. Awaiting Stage 3 deployment or manual address entry.',
    };
  }

  const addr = contractAddress as Address;
  try {
    const [configRaw, clausesRaw, challengesRaw, balanceRaw] = await Promise.all([
      readContractView<LiveConfig>(addr, 'get_config'),
      readContractView<LiveClause[]>(addr, 'list_clauses'),
      readContractView<LiveChallenge[]>(addr, 'list_challenges'),
      connectedAccount
        ? readContractView<string | number>(addr, 'get_claimable_balance', [connectedAccount])
        : Promise.resolve(null),
    ]);

    return {
      contractAddress: addr,
      fetchedAt,
      config: configRaw ?? null,
      clauses: Array.isArray(clausesRaw) ? clausesRaw : [],
      challenges: Array.isArray(challengesRaw) ? challengesRaw : [],
      claimableBalanceWei: balanceRaw !== null && balanceRaw !== undefined ? String(balanceRaw) : null,
      error: null,
    };
  } catch (err) {
    return {
      contractAddress: addr,
      fetchedAt,
      config: null,
      clauses: [],
      challenges: [],
      claimableBalanceWei: null,
      error: err instanceof Error ? err.message : 'Failed to query StudioNet RPC',
    };
  }
}

export function mapGenLayerTxToLifecycle(tx: Record<string, unknown>): {
  lifecycle: TxLifecycleState;
  rawStatus: string;
  rawResult?: string;
} {
  const statusVal = String(tx.statusName ?? tx.status ?? '').toUpperCase();
  const resultVal = String(
    tx.resultName ?? tx.consensus_data?.toString() ?? tx.result ?? ''
  ).toUpperCase();
  const execResult = String(tx.txExecutionResultName ?? tx.executionResult ?? '').toUpperCase();

  if (statusVal === TransactionStatus.FINALIZED || statusVal === '7' || statusVal === 'FINALIZED') {
    const isFailure =
      resultVal.includes('DISAGREE') ||
      resultVal.includes('FAILURE') ||
      resultVal.includes('TIMEOUT') ||
      resultVal.includes('VIOLATION') ||
      execResult === 'FINISHED_WITH_ERROR';
    return {
      lifecycle: isFailure ? 'finalized-error' : 'finalized-success',
      rawStatus: statusVal || 'FINALIZED',
      rawResult: resultVal || execResult || 'SUCCESS',
    };
  }

  if (
    statusVal === TransactionStatus.CANCELED ||
    statusVal === TransactionStatus.UNDETERMINED ||
    statusVal === TransactionStatus.LEADER_TIMEOUT ||
    statusVal === TransactionStatus.VALIDATORS_TIMEOUT ||
    statusVal === '8' ||
    statusVal === '6'
  ) {
    return {
      lifecycle: 'finalized-error',
      rawStatus: statusVal,
      rawResult: resultVal || execResult || 'ERROR',
    };
  }

  if (
    statusVal === TransactionStatus.ACCEPTED ||
    statusVal === TransactionStatus.APPEAL_COMMITTING ||
    statusVal === TransactionStatus.APPEAL_REVEALING ||
    statusVal === TransactionStatus.READY_TO_FINALIZE ||
    statusVal === '5'
  ) {
    return {
      lifecycle: 'accepted',
      rawStatus: statusVal,
      rawResult: resultVal || undefined,
    };
  }

  if (
    statusVal === TransactionStatus.PENDING ||
    statusVal === TransactionStatus.PROPOSING ||
    statusVal === TransactionStatus.COMMITTING ||
    statusVal === TransactionStatus.REVEALING ||
    statusVal === '1' ||
    statusVal === '2' ||
    statusVal === '3' ||
    statusVal === '4'
  ) {
    return {
      lifecycle: 'pending',
      rawStatus: statusVal,
    };
  }

  return {
    lifecycle: 'submitted',
    rawStatus: statusVal || 'UNINITIALIZED',
  };
}

export async function pollTransactionOnce(hash: Hex): Promise<{
  lifecycle: TxLifecycleState;
  rawStatus: string;
  rawResult?: string;
}> {
  const client = createReadOnlyClient();
  const tx = await client.getTransaction({ hash: hash as TransactionHash });
  return mapGenLayerTxToLifecycle(tx as unknown as Record<string, unknown>);
}
