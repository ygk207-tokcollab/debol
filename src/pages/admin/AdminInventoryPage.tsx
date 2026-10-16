import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Boxes, ChevronRight, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { adminInventory } from '../../lib/adminApi';
import { formatDateTime, titleCase } from '../../lib/format';
import { INVENTORY_REASONS, fieldErrors, stockAdjustSchema } from '../../lib/validation';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { StatusPill } from '../../components/StatusPill';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { InventoryRow } from '../../lib/types';

const FILTERS = [
  { value: '', labelKey: 'all' },
  { value: 'low_or_out', labelKey: 'low_or_out' },
  { value: 'low', labelKey: 'low' },
  { value: 'out', labelKey: 'out' },
] as const;

/** Stock adjustment form state. Amounts stay integers; the server owns the resulting quantity. */
interface AdjustState {
  mode: 'DELTA' | 'SET';
  direction: 'add' | 'subtract';
  amount: string;
  reason: string;
  note: string;
}

const START: AdjustState = { mode: 'DELTA', direction: 'add', amount: '', reason: 'ADMIN_ADJUST', note: '' };

/**
 * The movements endpoint answers with a Spring page (`content`) whose rows use `actor` / `at`,
 * while the shared mirror speaks `items` / `actorEmail` / `createdAt` — normalise both.
 */
interface MovementEntry {
  id: number;
  variantId?: number | null;
  product?: string | null;
  sizeLabel?: string | null;
  colorName?: string | null;
  changeQty?: number;
  balanceAfter?: number;
  reason?: string;
  actorType?: string;
  actor?: string | null;
  actorEmail?: string | null;
  note?: string | null;
  at?: string | null;
  createdAt?: string | null;
}

function readRows(payload: unknown): MovementEntry[] {
  const body = payload as { items?: MovementEntry[]; content?: MovementEntry[] } | undefined;
  return body?.items ?? body?.content ?? [];
}

/** zod hands back `{ field: { message } }`; the panels here only need the text. */
function toMessages(errors: Record<string, { message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) out[key] = value.message;
  return out;
}

export default function AdminInventoryPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();
  const canWrite = can(PERMISSION.inventory);
  const [params] = useSearchParams();

  const [filter, setFilter] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [adjust, setAdjust] = useState<AdjustState>(START);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [restoreId, setRestoreId] = useState('');

  const productParam = params.get('product');
  const productId = productParam !== null && /^\d+$/.test(productParam) ? Number(productParam) : null;

  // The server inventory endpoint only understands `filter`; narrowing to one product happens
  // below on the rows it returns (each row carries its productId).
  const list = useQuery({
    queryKey: ['admin', 'inventory', { filter }],
    queryFn: () => adminInventory.list(filter ? { filter } : {}),
  });

  const rows = useMemo(() => {
    const data: InventoryRow[] = list.data ?? [];
    const forProduct = productId === null ? data : data.filter((row) => row.productId === productId);
    const needle = term.trim().toLowerCase();
    if (!needle) return forProduct;
    return forProduct.filter((row) => [row.nameEn, row.sku, row.category, row.sizeLabel, row.colorName]
      .some((value) => (value ?? '').toLowerCase().includes(needle)));
  }, [list.data, term, productId]);

  const current = useMemo(() => rows.find((row) => row.variantId === selected) ?? null, [rows, selected]);

  useEffect(() => {
    setThreshold(current ? String(current.threshold) : '');
    setAdjust(START);
    setIssues({});
    setConfirmDeactivate(false);
  }, [selected, current?.variantId, current?.threshold]);

  const movements = useQuery({
    queryKey: ['admin', 'movements', { variantId: selected }],
    queryFn: () => adminInventory.movements(selected === null ? { size: 15 } : { variantId: selected, size: 15 })
      .then(readRows),
  });

  const movementRows = movements.data ?? [];

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin', 'inventory'] });
    client.invalidateQueries({ queryKey: ['admin', 'movements'] });
    // Stock lives on the variant, so the product list totals are stale too.
    client.invalidateQueries({ queryKey: ['admin', 'products'] });
  };

  const adjustMutation = useMutation({
    mutationFn: (variables: { variantId: number; body: { mode: 'DELTA' | 'SET'; delta?: number; stock?: number; reason: string; note?: string } }) =>
      adminInventory.adjust(variables.variantId, variables.body),
    onSuccess: (result, variables) => {
      const answer = result as unknown as { stock?: number; lowStock?: boolean };
      refresh();
      setAdjust({ ...START, reason: variables.body.mode === 'SET' ? 'STOCK_SET' : 'ADMIN_ADJUST' });
      const after = typeof answer.stock === 'number' ? answer.stock : null;
      toast.push(
        after === null
          ? 'Stock saved on the server.'
          : `Stock is now ${after} units — reload keeps this number.`,
        'ok',
      );
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : 'request failed', 'warn'),
  });

  /**
   * The amount field always holds whole, unsigned units: `stockAdjustSchema` rejects negatives,
   * and the sign is applied here when the DELTA body is built. A SET body sends `stock` instead.
   */
  const submitAdjust = () => {
    if (current === null) return;
    const checked = stockAdjustSchema.safeParse({
      mode: adjust.mode,
      amount: adjust.amount.trim().replace(/^-+/, ''),
      reason: adjust.reason,
      note: adjust.note.trim() || undefined,
    });
    if (!checked.success) {
      setIssues(toMessages(fieldErrors(checked.error)));
      return;
    }
    setIssues({});
    const units = checked.data.amount;
    const shared = { reason: checked.data.reason, note: checked.data.note };
    adjustMutation.mutate({
      variantId: current.variantId,
      body: adjust.mode === 'DELTA'
        ? { mode: 'DELTA', delta: adjust.direction === 'subtract' ? -units : units, ...shared }
        : { mode: 'SET', stock: units, ...shared },
    });
  };

  const patchVariant = useMutation({
    mutationFn: (variables: { variantId: number; query: { lowStockThreshold?: number; active?: boolean } }) =>
      adminInventory.patch(variables.variantId, variables.query),
    onSuccess: (_result, variables) => {
      refresh();
      setConfirmDeactivate(false);
      toast.push(
        variables.query.active !== undefined
          ? variables.query.active
            ? 'Variant is sellable again.'
            : 'Variant hidden: it leaves this list until it is re-activated.'
          : 'Low stock alert saved.',
        'ok',
      );
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : 'request failed', 'warn'),
  });

  const saveThreshold = () => {
    if (current === null) return;
    const value = Number(threshold.trim());
    if (!Number.isInteger(value) || value < 0) {
      setIssues({ threshold: 'Whole units, zero or more.' });
      return;
    }
    setIssues({});
    patchVariant.mutate({ variantId: current.variantId, query: { lowStockThreshold: value } });
  };

  const restoreVariant = () => {
    const id = Number(restoreId.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setIssues({ restore: 'Enter the variant id from the movement history.' });
      return;
    }
    setIssues({});
    patchVariant.mutate({ variantId: id, query: { active: true } });
    setRestoreId('');
  };

  const reasonLabel = (value: string) => {
    if (value === 'ADMIN_ADJUST') return 'Manual correction';
    if (value === 'STOCK_SET') return 'Counted stock';
    if (value === 'INITIAL_STOCK') return 'Initial delivery';
    if (value === 'CANCEL_RESTORED') return 'Returned from a cancelled order';
    return titleCase(value);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{t('admin.panel')}</p>
        <h1 className="font-display text-2xl leading-tight text-ink">{t('admin.inventory')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {'Every number here is read from and written to PostgreSQL — nothing is kept only in the browser.'}
        </p>
      </div>

      {productId !== null && (
        <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
          <span className="text-ink-soft">
            {`Showing the sizes of product #${productId} only — the shop-wide stock list is at this URL without ?product.`}
          </span>
          <Link to="/admin/inventory" className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs">
            <X className="size-3.5" aria-hidden />
            {t('catalog.clearFilters')}
          </Link>
        </div>
      )}

      {productParam !== null && productId === null && (
        <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
          <span className="text-error-600">
            {`?product=${productParam} is not a product id, so the full stock list is shown.`}
          </span>
          <Link to="/admin/inventory" className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs">
            <X className="size-3.5" aria-hidden />
            {t('catalog.clearFilters')}
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-surface-200 px-3 py-2.5">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    filter === option.value ? 'bg-primary-50 font-medium text-primary-700' : 'text-ink-soft hover:bg-surface-200'
                  }`}
                >
                  {option.value === '' ? 'All sizes'
                    : option.value === 'low' ? t('admin.lowStock')
                    : option.value === 'out' ? t('admin.outOfStock')
                    : 'Low or empty'}
                </button>
              ))}
            </div>
            <input
              className="field ml-auto w-full px-2.5 py-1.5 text-xs sm:w-56"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={'Filter loaded rows by name or SKU'}
              aria-label={'Filter rows'}
            />
          </div>

          {list.isLoading && <div className="px-4 py-4"><LoadingRows rows={6} /></div>}
          {list.isError && <div className="px-4 py-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
          {!list.isLoading && !list.isError && rows.length === 0 && (
            <EmptyState
              title={t('admin.noResults')}
              body={'No size matches this filter.'}
            />
          )}
          {!list.isLoading && !list.isError && rows.length > 0 && (
            <ul className="divide-y divide-surface-200">
              {rows.map((row) => (
                <li key={row.variantId}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.variantId)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selected === row.variantId ? 'bg-primary-50' : 'hover:bg-surface-100'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {row.nameEn}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-mute">
                        {row.sizeLabel} · {row.colorName}{row.sku ? ` · ${row.sku}` : ''} · {row.category}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-sm font-semibold tabular-nums ${
                        row.outOfStock ? 'text-error-600' : row.lowStock ? 'text-error-600' : 'text-ink'
                      }`}>
                        {row.stock}
                      </span>
                      <span className="block text-[0.65rem] text-ink-mute">
                        {`alert ${row.threshold}`}
                      </span>
                    </span>
                    <span className="hidden shrink-0 sm:block"><StatusPill value={row.status} /></span>
                    <ChevronRight className="size-4 shrink-0 text-ink-mute" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          {current === null ? (
            <div className="card px-4 py-6 text-center">
              <Boxes className="mx-auto size-7 text-secondary-400" aria-hidden />
              <h2 className="mt-2 font-display text-lg text-ink">{t('admin.adjustStock')}</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {'Pick a size on the left to change its stock, set the low-stock alert or hide it from the shop.'}
              </p>
            </div>
          ) : (
            <section className="card px-4 py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-base leading-tight text-ink">
                    {current.nameEn}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-ink-mute">
                    {current.sizeLabel} · {current.colorName} · {'variant'} {current.variantId}
                  </p>
                </div>
                <button type="button" className="btn-quiet px-2 py-1 text-xs" onClick={() => setSelected(null)}>
                  <X className="size-3.5" aria-hidden />
                  {t('common.close')}
                </button>
              </div>

              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-3 border-b border-surface-200 py-1.5">
                  <dt className="text-ink-mute">{t('admin.stock')}</dt>
                  <dd className="tabular-nums font-semibold text-ink">{current.stock}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-surface-200 py-1.5">
                  <dt className="text-ink-mute">{t('admin.lowStockThreshold')}</dt>
                  <dd className="tabular-nums text-ink">{current.threshold}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-surface-200 py-1.5">
                  <dt className="text-ink-mute">{'Sellable'}</dt>
                  <dd className="text-ink">
                    {current.outOfStock ? t('admin.outOfStock') : current.lowStock ? t('admin.lowStock') : t('admin.active')}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="text-ink-mute">{t('admin.statusFilter')}</dt>
                  <dd><StatusPill value={current.status} /></dd>
                </div>
              </dl>

              {!canWrite ? (
                <p className="mt-3 text-xs text-error-600">
                  {'Your role can read stock but not change it.'}
                </p>
              ) : (
                <>
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-1">
                      {(['DELTA', 'SET'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setAdjust((prev) => ({
                            ...prev,
                            mode,
                            reason: mode === 'SET' ? 'STOCK_SET' : 'ADMIN_ADJUST',
                          }))}
                          className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                            adjust.mode === mode ? 'bg-primary-50 font-medium text-primary-700' : 'text-ink-soft hover:bg-surface-200'
                          }`}
                        >
                          {mode === 'DELTA' ? 'Change by' : t('admin.setTo')}
                        </button>
                      ))}
                    </div>

                    {adjust.mode === 'DELTA' && (
                      <div className="flex gap-1">
                        {(['add', 'subtract'] as const).map((direction) => (
                          <button
                            key={direction}
                            type="button"
                            onClick={() => setAdjust((prev) => ({ ...prev, direction }))}
                            className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                              adjust.direction === direction ? 'bg-primary-50 font-medium text-primary-700' : 'text-ink-soft hover:bg-surface-200'
                            }`}
                          >
                            {direction === 'add' ? t('admin.add') : t('admin.subtract')}
                          </button>
                        ))}
                      </div>
                    )}

                    <div>
                      <label className="field-label" htmlFor="adjust-amount">
                        {adjust.mode === 'SET'
                          ? 'Exact units on the shelf'
                          : adjust.direction === 'add'
                            ? 'Units to add'
                            : 'Units to remove'}
                      </label>
                      <input
                        id="adjust-amount"
                        className={`field px-2.5 py-2 text-sm tabular-nums ${issues.amount ? 'field-error' : ''}`}
                        inputMode="numeric"
                        value={adjust.amount}
                        onChange={(event) => setAdjust((prev) => ({ ...prev, amount: event.target.value }))}
                        placeholder={adjust.mode === 'SET' ? String(current.stock) : '4'}
                      />
                      {issues.amount && <p className="mt-1 text-xs text-error-600">{issues.amount}</p>}
                    </div>

                    <div>
                      <label className="field-label" htmlFor="adjust-reason">{t('admin.reason')}</label>
                      <select
                        id="adjust-reason"
                        className="field px-2.5 py-2 text-sm"
                        value={adjust.reason}
                        onChange={(event) => setAdjust((prev) => ({ ...prev, reason: event.target.value }))}
                      >
                        {INVENTORY_REASONS.map((value) => (
                          <option key={value} value={value}>{reasonLabel(value)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="field-label" htmlFor="adjust-note">{t('admin.noteOptional')}</label>
                      <textarea
                        id="adjust-note"
                        className={`field px-2.5 py-2 text-sm ${issues.note ? 'field-error' : ''}`}
                        rows={2}
                        value={adjust.note}
                        onChange={(event) => setAdjust((prev) => ({ ...prev, note: event.target.value }))}
                        placeholder={'Who counted it, from which delivery note'}
                      />
                      {issues.note && <p className="mt-1 text-xs text-error-600">{issues.note}</p>}
                    </div>

                    <button
                      type="button"
                      className="btn-primary w-full"
                      disabled={adjustMutation.isPending}
                      onClick={submitAdjust}
                    >
                      {adjustMutation.isPending
                        ? 'Writing to stock…'
                        : 'Record this change'}
                    </button>
                    <p className="text-[0.7rem] text-ink-mute">
                      {`Current stock is ${current.stock}. A DELTA move adds or removes; a SET move overwrites it. Both are written to the movement history.`}
                    </p>
                  </div>

                  <div className="mt-4 border-t border-surface-200 pt-3">
                    <label className="field-label" htmlFor="variant-threshold">{t('admin.lowStockThreshold')}</label>
                    <div className="flex gap-2">
                      <input
                        id="variant-threshold"
                        className={`field px-2.5 py-2 text-sm tabular-nums ${issues.threshold ? 'field-error' : ''}`}
                        inputMode="numeric"
                        value={threshold}
                        onChange={(event) => setThreshold(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-secondary px-3 py-2 text-xs"
                        disabled={patchVariant.isPending || threshold === String(current.threshold)}
                        onClick={saveThreshold}
                      >
                        {t('admin.save')}
                      </button>
                    </div>
                    {issues.threshold && <p className="mt-1 text-xs text-error-600">{issues.threshold}</p>}

                    <p className="mt-3 text-xs text-ink-soft">
                      {'Hiding a size keeps its stock but stops shoppers seeing or buying it.'}
                    </p>
                    {confirmDeactivate ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-danger px-3 py-1.5 text-xs"
                          disabled={patchVariant.isPending}
                          onClick={() => patchVariant.mutate({ variantId: current.variantId, query: { active: false } })}
                        >
                          {'Yes, hide this size'}
                        </button>
                        <button type="button" className="btn-quiet px-3 py-1.5 text-xs" onClick={() => setConfirmDeactivate(false)}>
                          {t('admin.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-danger mt-2 px-3 py-1.5 text-xs"
                        onClick={() => setConfirmDeactivate(true)}
                      >
                        {'Hide from storefront'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {canWrite && (
            <section className="card px-4 py-4">
              <h2 className="font-display text-base leading-tight text-ink">
                {'Bring a hidden size back'}
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                {'A hidden variant leaves this list — the server only lists sellable sizes. Use its variant id from the movement history below to make it sellable again.'}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  className={`field px-2.5 py-2 text-sm tabular-nums ${issues.restore ? 'field-error' : ''}`}
                  inputMode="numeric"
                  aria-label={'Variant id'}
                  value={restoreId}
                  onChange={(event) => setRestoreId(event.target.value)}
                  placeholder="19"
                />
                <button
                  type="button"
                  className="btn-secondary px-3 py-2 text-xs"
                  disabled={patchVariant.isPending || restoreId.trim() === ''}
                  onClick={restoreVariant}
                >
                  {'Re-activate'}
                </button>
              </div>
              {issues.restore && <p className="mt-1 text-xs text-error-600">{issues.restore}</p>}
            </section>
          )}

          <section className="card px-4 py-4">
            <h2 className="font-display text-base leading-tight text-ink">{t('admin.movements')}</h2>
            <p className="mt-1 text-xs text-ink-mute">
              {current === null
                ? 'Newest stock writes across the store.'
                : 'Every change recorded for this size.'}
            </p>
            {movements.isLoading && <div className="mt-3"><LoadingRows rows={3} /></div>}
            {movements.isError && <div className="mt-3"><ErrorState error={movements.error} /></div>}
            {!movements.isLoading && !movements.isError && movementRows.length === 0 && (
              <p className="mt-3 text-sm text-ink-mute">{'Nothing recorded yet.'}</p>
            )}
            {!movements.isLoading && !movements.isError && movementRows.length > 0 && (
              <ul className="mt-3 space-y-2 text-xs">
                {movementRows.map((entry) => (
                  <li key={entry.id} className="border-b border-surface-200 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`font-semibold tabular-nums ${
                        (entry.changeQty ?? 0) >= 0 ? 'text-primary-600' : 'text-error-600'
                      }`}
                      >
                        {(entry.changeQty ?? 0) >= 0 ? `+${entry.changeQty ?? 0}` : entry.changeQty ?? 0}
                      </span>
                      <span className="text-ink-mute tabular-nums">
                        {'left'} {entry.balanceAfter ?? '—'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-ink-soft">
                      {reasonLabel(entry.reason ?? '')}
                      {current === null && (entry.product || entry.sizeLabel) && (
                        <span className="text-ink-mute"> · {entry.product} {entry.sizeLabel}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-ink-mute">
                      {formatDateTime(entry.at ?? entry.createdAt)}
                      {(entry.actor ?? entry.actorEmail) ? ` · ${entry.actor ?? entry.actorEmail}` : ''}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
