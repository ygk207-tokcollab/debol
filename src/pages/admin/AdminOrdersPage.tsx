import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { adminOrders } from '../../lib/adminApi';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { StatusPill } from '../../components/StatusPill';
import { ErrorState, LoadingRows, EmptyState } from '../../components/PageState';
import { money, formatPhone, formatDate } from '../../lib/format';

const STATUS_OPTIONS = [
  'PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED',
];
const PAYMENT_OPTIONS = ['UNPAID', 'PARTIAL', 'PAID'];
const PAGE_SIZE = 20;

interface Filters {
  q: string;
  status: string;
  paymentStatus: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: '', status: '', paymentStatus: '', from: '', to: '' };

export default function AdminOrdersPage() {
  const { t } = useTranslation();
  const { can } = useAdminAuth();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);

  // Backend binds these as OffsetDateTime, so a bare date must carry a time + zone offset.
  const query: Record<string, string | number> = { page, size: PAGE_SIZE };
  if (filters.q) query.q = filters.q;
  if (filters.status) query.status = filters.status;
  if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
  if (filters.from) query.from = `${filters.from}T00:00:00Z`;
  if (filters.to) query.to = `${filters.to}T23:59:59Z`;

  const rows = useQuery({
    queryKey: ['admin', 'orders', query],
    queryFn: () => adminOrders.list(query),
    enabled: can(PERMISSION.orders),
    placeholderData: (prev) => prev,
  });

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }

  if (!can(PERMISSION.orders)) {
    return (
      <div className="card px-5 py-6 text-sm text-ink-soft">
        {'This account cannot view orders.'}
      </div>
    );
  }

  const data = rows.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl text-ink">{t('admin.orders')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {data ? `${data.totalElements} ${'orders match'}` : t('admin.loading')}
        </p>
      </header>

      {/* Filter bar — every field maps 1:1 to an adminOrders.list parameter, nothing invented. */}
      <div className="card space-y-3 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-mute" aria-hidden />
            <input
              className="field pl-9"
              type="search"
              placeholder={t('admin.searchOrders')}
              value={filters.q}
              onChange={(e) => update('q', e.target.value)}
              aria-label={t('admin.searchOrders')}
            />
          </div>
          <label className="block">
            <span className="field-label">{t('admin.statusFilter')}</span>
            <select className="field" value={filters.status} onChange={(e) => update('status', e.target.value)}>
              <option value="">{'All statuses'}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(`status.${s}`, s)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">{t('admin.paymentFilter')}</span>
            <select className="field" value={filters.paymentStatus} onChange={(e) => update('paymentStatus', e.target.value)}>
              <option value="">{'All payments'}</option>
              {PAYMENT_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(`status.${s}`, s)}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">{t('admin.from')}</span>
              <input type="date" className="field" value={filters.from} onChange={(e) => update('from', e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">{t('admin.to')}</span>
              <input type="date" className="field" value={filters.to} onChange={(e) => update('to', e.target.value)} />
            </label>
          </div>
        </div>
        {(filters.q || filters.status || filters.paymentStatus || filters.from || filters.to) && (
          <button type="button" className="btn-quiet text-sm" onClick={() => { setFilters(EMPTY); setPage(0); }}>
            {'Clear filters'}
          </button>
        )}
      </div>

      {rows.error && !data ? (
        <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
      ) : rows.isLoading ? (
        <LoadingRows rows={6} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={t('admin.noResults')} body={'Adjust the filters or search.'} />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-300 text-left text-xs uppercase tracking-wide text-ink-mute">
                  <th className="px-4 py-2.5 font-medium">{t('order.number')}</th>
                  <th className="px-3 py-2.5 font-medium">{'Customer'}</th>
                  <th className="px-3 py-2.5 font-medium">{'Phone'}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{'Items'}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{'Total'}</th>
                  <th className="px-3 py-2.5 font-medium">{'Fulfilment'}</th>
                  <th className="px-3 py-2.5 font-medium">{'Payment'}</th>
                  <th className="px-4 py-2.5 font-medium">{t('order.placedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((o) => (
                  <tr key={o.id} className="border-b border-surface-200 last:border-0 transition-colors hover:bg-surface-100">
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/orders/${o.id}`} className="font-medium text-primary-600 hover:underline">
                        {o.orderNumber}
                      </Link>
                      {o.cancelRequested && (
                        <span className="ml-2 text-xs text-error-600">{'cancel requested'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{o.customerName}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{formatPhone(o.customerPhone)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.itemCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{money(o.totalAmount, o.currency)}</td>
                    <td className="px-3 py-2.5"><StatusPill value={o.status} /></td>
                    <td className="px-3 py-2.5"><StatusPill value={o.paymentStatus} /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink-mute">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            page={data?.page ?? page}
            totalPages={data?.totalPages ?? 1}
            totalElements={data?.totalElements ?? 0}
            disabled={rows.isFetching}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function Pager({
  page, totalPages, totalElements, disabled, onChange,
}: {
  page: number;
  totalPages: number;
  totalElements: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) {
    return totalElements > PAGE_SIZE
      ? <p className="text-center text-sm text-ink-mute">{'More results pending'}</p>
      : null;
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-1 disabled:opacity-50"
        disabled={disabled || page <= 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="size-4" aria-hidden /> {t('catalog.previous')}
      </button>
      <span className="text-sm text-ink-soft">{t('catalog.page', { page: page + 1, total: totalPages })}</span>
      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-1 disabled:opacity-50"
        disabled={disabled || page >= totalPages - 1}
        onClick={() => onChange(page + 1)}
      >
        {t('catalog.next')} <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
