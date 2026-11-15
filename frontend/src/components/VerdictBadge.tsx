import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert } from 'lucide-react';
import type { ProofVerdict } from '../types/proof';

const VERDICT_META: Record<
  ProofVerdict | string,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  PUBLIC_DOMAIN_VERIFIED: {
    label: 'PUBLIC_DOMAIN_VERIFIED',
    className: 'badge badge-verified',
    Icon: CheckCircle2,
  },
  PROTECTED_DERIVATIVE_BREACH: {
    label: 'PROTECTED_DERIVATIVE_BREACH',
    className: 'badge badge-breach',
    Icon: ShieldAlert,
  },
  REJECTED_VAGUE: {
    label: 'REJECTED_VAGUE',
    className: 'badge badge-vague',
    Icon: AlertTriangle,
  },
  INSUFFICIENT_EVIDENCE: {
    label: 'INSUFFICIENT_EVIDENCE',
    className: 'badge badge-insufficient',
    Icon: HelpCircle,
  },
};

export function VerdictBadge({ verdict }: { verdict: ProofVerdict | string }) {
  const meta = VERDICT_META[verdict] ?? {
    label: verdict,
    className: 'badge badge-insufficient',
    Icon: HelpCircle,
  };
  const { Icon } = meta;
  return (
    <span className={meta.className}>
      <Icon size={13} strokeWidth={2.2} />
      <span>{meta.label}</span>
    </span>
  );
}
