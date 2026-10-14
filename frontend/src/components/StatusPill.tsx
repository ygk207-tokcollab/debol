import { useTranslation } from 'react-i18next';
import { titleCase } from '../lib/format';

const TONES: Record<string, string> = {
  PENDING_CONFIRMATION: 'bg-error-100 text-error-600 border-error-300/60',
  CONFIRMED: 'bg-secondary-100 text-primary-600 border-secondary-300',
  PROCESSING: 'bg-primary-50 text-primary-600 border-primary-200',
  OUT_FOR_DELIVERY: 'bg-primary-100 text-primary-700 border-primary-200',
  DELIVERED: 'bg-primary-500 text-surface-50 border-primary-500',
  CANCELLED: 'bg-surface-200 text-ink-mute border-surface-300',
  PAYMENT_FAILED: 'bg-error-100 text-error-600 border-error-300/60',
  UNPAID: 'bg-surface-100 text-ink-soft border-surface-300',
  PARTIAL: 'bg-secondary-100 text-primary-600 border-secondary-300',
  PAID: 'bg-primary-500 text-surface-50 border-primary-500',
  PUBLISHED: 'bg-primary-50 text-primary-600 border-primary-200',
  DRAFT: 'bg-surface-100 text-ink-soft border-surface-300',
  ARCHIVED: 'bg-surface-200 text-ink-mute border-surface-300',
  SENT: 'bg-primary-50 text-primary-600 border-primary-200',
  PENDING: 'bg-surface-100 text-ink-soft border-surface-300',
  RETRY: 'bg-error-100 text-error-600 border-error-300/60',
  SENDING: 'bg-secondary-100 text-primary-600 border-secondary-300',
  DEAD_LETTER: 'bg-error-100 text-error-600 border-error-300/60',
};

export function StatusPill({ value }: { value: string }) {
  const { t } = useTranslation();
  const tone = TONES[value] ?? 'bg-surface-100 text-ink-soft border-surface-300';
  const label = t(`status.${value}`, titleCase(value));
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
