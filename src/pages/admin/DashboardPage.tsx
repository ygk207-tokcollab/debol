import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { adminDashboard } from '../../lib/adminApi';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { ErrorState } from '../../components/PageState';
import { money, formatDateTime, titleCase } from '../../lib/format';
import type { Dashboard } from '../../lib/types';

function Metric({
  label, value, hint, emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">{label}</p>
      <p className={`mt-1 font-display text-2xl leading-tight tabular-nums ${emphasis ? 'text-primary-600' : 'text-ink'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-mute">{hint}</p>}
    </div>
  );
}

function StatusBars({
  caption, map,
}: {
  caption: string;
  map: Record<string, number>;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(map);
  const max = entries.reduce((m, [, c]) => Math.max(m, c), 0);
  return (
    <div className="card px-4 py-4">
      <h2 className="font-display text-base text-ink">{caption}</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-mute">{t('admin.noResults')}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {entries.map(([status, count]) => (
            <li key={status}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-soft">{t(`status.${status}`, titleCase(status))}</span>
                <span className="tabular-nums font-medium text-ink">{count}</span>
              </div>
              {/* Bar width is a pure ratio of the real count against the largest bucket. */}
              <div className="mt-1 h-1.5 rounded-full bg-surface-200">
                <div
                  className="h-1.5 rounded-full bg-secondary-400"
                  style={{ width: max > 0 ? `${(count / max) * 100}%` : '0%' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { can } = useAdminAuth();

  const query = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminDashboard.get,
    refetchInterval: 60_000,
  });

  if (!can(PERMISSION.dashboard)) {
    return (
      <div className="card px-5 py-6 text-sm text-ink-soft">
        {'This account has no dashboard access.'}
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
    );
  }
  if (query.error || !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const d: Dashboard = query.data;
  const currency = d.currency;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">{t('admin.dashboard')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {'Live figures from the store database'} ·{' '}
            {'as of'} {formatDateTime(d.generatedAt)}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2"
          onClick={() => void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] })}
        >
          <RefreshCw className="size-4" aria-hidden />
          {t('common.refresh')}
        </button>
      </header>

      {/* Telegram not ready: alerts were NOT delivered — state it plainly, never pretend. */}
      {!d.telegram.ready && (
        <div className="rounded-lg border border-error-300/60 bg-error-100/60 px-4 py-3 text-sm text-error-600">
          <p className="font-medium">
            {'Telegram alerts are not being delivered.'}
          </p>
          <p className="mt-1">
            {!d.telegram.botTokenConfigured
              ? t('admin.telegramNoToken')
              : t('admin.telegramNoChat')}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={'Orders today'} value={String(d.ordersToday)} />
        <Metric label={'Ordered value today'} value={money(d.orderedValueToday, currency)} />
        <Metric label={t('order.collected')} value={money(d.collectedRevenue, currency)} emphasis />
        <Metric label={'Awaiting confirmation'} value={String(d.awaitingConfirmation)} />
        <Metric label={'In fulfilment'} value={String(d.inFulfilment)} />
        <Metric label={t('order.delivered')} value={String(d.deliveredTotal)} />
        <Metric label={t('order.cancelled')} value={String(d.cancelledTotal)} />
        <Metric
          label={'Unpaid delivered'}
          value={String(d.unpaidDelivered)}
          hint={'cash not yet collected'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBars caption={'Orders by status'} map={d.ordersByStatus} />
        <StatusBars caption={'Orders by payment'} map={d.ordersByPaymentStatus} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Low stock: real variant rows, linked to the inventory screen for the operator. */}
        <section className="card px-4 py-4">
          <h2 className="font-display text-base text-ink">
            {t('admin.lowStock')} <span className="text-sm text-ink-mute">({d.lowStock.length})</span>
          </h2>
          {d.lowStock.length === 0 ? (
            <p className="mt-3 text-sm text-ink-mute">{'No variants below threshold.'}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-mute">
                    <th className="py-1 pr-3 font-medium">{'Item'}</th>
                    <th className="py-1 pr-3 font-medium">{'Size'}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t('admin.stock')}</th>
                    <th className="py-1 text-right font-medium">{'Min'}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lowStock.map((row) => (
                    <tr key={row.variantId} className="border-t border-surface-200">
                      <td className="py-1.5 pr-3 text-ink">
                        {row.product}
                        {row.outOfStock && (
                          <span className="ml-2 text-xs font-medium text-error-600">{t('admin.outOfStock')}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-soft">{row.sizeLabel} · {row.colorName}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{row.stock}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-mute">{row.threshold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Best sellers come straight from unitsSold in the DB — no fabricated ranking. */}
        <section className="card px-4 py-4">
          <h2 className="font-display text-base text-ink">{'Best sellers'}</h2>
          {d.bestSellers.length === 0 ? (
            <p className="mt-3 text-sm text-ink-mute">{'No sales recorded yet.'}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.bestSellers.map((row) => (
                <li key={row.productId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">{row.nameEn}</span>
                  <span className="shrink-0 tabular-nums font-medium text-primary-600">
                    {row.unitsSold} {'sold'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Notification queue health, straight from the outbox counts. */}
      <section className="card px-4 py-4">
        <h2 className="font-display text-base text-ink">{t('admin.outboxTitle')}</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <span className="rounded-md bg-surface-100 px-3 py-1.5 text-ink-soft">
            {t('admin.pending')}: <b className="tabular-nums text-ink">{d.notifications.pending}</b>
          </span>
          <span className="rounded-md bg-primary-50 px-3 py-1.5 text-primary-600">
            {t('admin.sent')}: <b className="tabular-nums">{d.notifications.sent}</b>
          </span>
          <span className="rounded-md bg-error-100 px-3 py-1.5 text-error-600">
            {t('admin.deadLetter')}: <b className="tabular-nums">{d.notifications.deadLetter}</b>
          </span>
        </div>
      </section>
    </div>
  );
}
