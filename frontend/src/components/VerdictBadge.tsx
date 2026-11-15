import { AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldAlert } from 'lucide-react';
import type { ProofVerdict } from '../types/proof';

interface VerdictBadgeProps {
  verdict: ProofVerdict | string;
  expiryStatus?: string | null;
}

const VERDICT_META: Record<
  string,
  { humanLabel: string; code: string; className: string; Icon: typeof CheckCircle2 }
> = {
  PUBLIC_DOMAIN_VERIFIED: {
    humanLabel: 'Public Domain Verified',
    code: 'PUBLIC_DOMAIN_VERIFIED',
    className: 'stamp stamp-verified',
    Icon: CheckCircle2,
  },
  PROTECTED_DERIVATIVE_BREACH: {
    humanLabel: 'Derivative Breach — Slashed',
    code: 'PROTECTED_DERIVATIVE_BREACH',
    className: 'stamp stamp-breach',
    Icon: ShieldAlert,
  },
  REJECTED_VAGUE: {
    humanLabel: 'Gate 1 Rejected — Vague',
    code: 'REJECTED_VAGUE',
    className: 'stamp stamp-vague',
    Icon: AlertTriangle,
  },
  INSUFFICIENT_EVIDENCE: {
    humanLabel: 'Insufficient Evidence',
    code: 'INSUFFICIENT_EVIDENCE',
    className: 'stamp stamp-insufficient',
    Icon: HelpCircle,
  },
  EXPIRED_RETURNED: {
    humanLabel: 'Bond Returned — Expired',
    code: 'EXPIRED_RETURNED',
    className: 'stamp stamp-expired',
    Icon: Clock,
  },
};

export function VerdictBadge({ verdict, expiryStatus }: VerdictBadgeProps) {
  const key = expiryStatus === 'EXPIRED_RETURNED' ? 'EXPIRED_RETURNED' : verdict;
  const meta = VERDICT_META[key] ?? {
    humanLabel: key,
    code: key,
    className: 'stamp stamp-insufficient',
    Icon: HelpCircle,
  };
  const { Icon } = meta;

  return (
    <span className={meta.className} title={meta.code}>
      <Icon size={13} strokeWidth={2} />
      <span className="stamp-label">{meta.humanLabel}</span>
      <span className="stamp-code mono">{meta.code}</span>
    </span>
  );
}
