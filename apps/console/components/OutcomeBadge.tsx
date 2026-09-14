import { Outcome } from '@/lib/api';

const STYLES: Record<Outcome, string> = {
  APPROVE: 'bg-green-100 text-green-800',
  REFER: 'bg-amber-100 text-amber-800',
  DECLINE: 'bg-red-100 text-red-800',
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STYLES[outcome]}`}>{outcome}</span>;
}
