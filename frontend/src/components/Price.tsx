import { useTranslation } from 'react-i18next';
import { money } from '../lib/format';

/** Sale price leads, list price is struck through — but only when the backend actually sends both. */
export function Price({
  value, sale, currency, size = 'base',
}: {
  value: number | string;
  sale?: number | string | null;
  currency?: string;
  size?: 'sm' | 'base' | 'lg';
}) {
  const { t } = useTranslation();
  const unit = currency ?? t('common.currency');
  const shown = sale != null && Number(sale) < Number(value) ? sale : value;
  const classes = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base';

  return (
    <span className={`inline-flex items-baseline gap-2 tabular-nums ${classes}`}>
      <span className="font-bold text-primary-600">{money(shown, unit)}</span>
      {sale != null && Number(sale) < Number(value) && (
        <s className="text-xs text-ink-mute/70">{money(value, unit)}</s>
      )}
    </span>
  );
}
