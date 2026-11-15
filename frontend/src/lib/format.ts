import { formatWeiToGen } from './genlayer';

export function isHttpUrl(value: string | null | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

export function formatWeiDisplay(wei: string | number | bigint | null | undefined): {
  primary: string;
  secondary: string;
} {
  if (wei === null || wei === undefined || wei === '') {
    return { primary: '0 wei', secondary: '0 GEN' };
  }
  try {
    const val = BigInt(String(wei));
    if (val === 0n) return { primary: '0 wei', secondary: '0 GEN' };
    if (val < 1_000_000_000_000n) {
      return {
        primary: `${val.toString()} wei`,
        secondary: formatWeiToGen(val),
      };
    }
    return {
      primary: formatWeiToGen(val),
      secondary: `${val.toString()} wei`,
    };
  } catch {
    return { primary: `${String(wei)} wei`, secondary: String(wei) };
  }
}
