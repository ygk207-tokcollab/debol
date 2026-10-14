import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X } from 'lucide-react';
import { useAgeGroups, useCategories, useProducts } from '../../lib/queries';
import { ListingRow } from '../../components/ProductCard';
import { EmptyState, ErrorState, GridSkeleton } from '../../components/PageState';

const SORTS: { value: string; key: string }[] = [
  { value: 'newest', key: 'catalog.sortNewest' },
  { value: 'price_asc', key: 'catalog.sortPriceLow' },
  { value: 'price_desc', key: 'catalog.sortPriceHigh' },
];

const AUDIENCE_LABEL: Record<string, string> = {
  CHILD: 'nav.kids',
  ADULT: 'nav.adults',
  FAMILY: 'nav.family',
};

/** A filter pill is a native select wearing a chip, so keyboard and mobile pickers still work. */
function Pill({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`pill-select max-w-[11rem] ${value ? 'border-primary-500 font-medium text-primary-700' : ''}`}
      >
        {children}
      </select>
    </div>
  );
}

export default function CatalogPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: categories } = useCategories();
  const { data: ageGroups } = useAgeGroups();
  const [moreOpen, setMoreOpen] = useState(false);

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const audience = params.get('audience') ?? '';
  const size = params.get('size') ?? '';
  const ageGroup = params.get('ageGroup') ?? '';
  const min = params.get('min') ?? '';
  const max = params.get('max') ?? '';
  const inStock = params.get('inStock') === '1';
  const sort = params.get('sort') ?? 'newest';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const audiences = useMemo(() => {
    const set = new Set((categories ?? []).map((c) => c.audience));
    return Array.from(set);
  }, [categories]);

  const query = useMemo(() => {
    const filters: Record<string, string | number | boolean> = {};
    if (q) filters.q = q;
    if (category) filters.category = category;
    if (audience) filters.audience = audience;
    if (size) filters.size = size;
    if (ageGroup) filters.ageGroup = ageGroup;
    if (min) filters.minPrice = min;
    if (max) filters.maxPrice = max;
    if (inStock) filters.inStock = true;
    if (sort && sort !== 'newest') filters.sort = sort;
    if (page > 1) filters.page = page - 1;
    return filters;
  }, [q, category, audience, ageGroup, size, min, max, inStock, sort, page]);

  const { data, isLoading, isError, error, refetch } = useProducts(query);

  function update(changes: Record<string, string | null>, keepPage = false) {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    });
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
  }

  const priceActive = Boolean(min || max || size);
  const filtersActive = Boolean(category || audience || ageGroup || min || max || size || inStock);

  return (
    <div>
      {q && (
        <div className="mb-3 flex items-center gap-2">
          <Search className="size-4 shrink-0 text-secondary-500" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-sm text-ink">
            {t('search.resultsFor', { q })}
          </p>
          <button type="button" className="btn-quiet px-2" onClick={() => update({ q: null })} aria-label={t('search.clear')}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Pill label={t('catalog.category')} value={category} onChange={(v) => update({ category: v || null })}>
          <option value="">{t('catalog.allCategories')}</option>
          {(categories ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>{c.nameEn}</option>
          ))}
        </Pill>

        <Pill label={t('catalog.ageGroup')} value={ageGroup} onChange={(v) => update({ ageGroup: v || null })}>
          <option value="">{t('catalog.anyAge')}</option>
          {(ageGroups ?? []).map((band) => (
            <option key={band.code} value={band.code}>{band.label}</option>
          ))}
        </Pill>

        {audiences.length > 1 && (
          <Pill label={t('catalog.audience')} value={audience} onChange={(v) => update({ audience: v || null })}>
            <option value="">{t('catalog.allOptions')}</option>
            {audiences.map((a) => (
              <option key={a} value={a}>{t(AUDIENCE_LABEL[a] ?? 'common.unknown')}</option>
            ))}
          </Pill>
        )}

        <button
          type="button"
          className="pill-select flex items-center gap-1 pr-3"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
        >
          <span className={priceActive ? 'text-primary-700' : ''}>
            {t('catalog.priceRange')}
          </span>
          <ChevronDown className={`size-3.5 text-secondary-500 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>

        <Pill label={t('catalog.availability')} value={inStock ? '1' : ''} onChange={(v) => update({ inStock: v || null })}>
          <option value="">{t('catalog.allOptions')}</option>
          <option value="1">{t('catalog.inStock')}</option>
        </Pill>

        <Pill label={t('catalog.sort')} value={sort} onChange={(v) => update({ sort: v === 'newest' ? null : v }, true)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{t(s.key)}</option>
          ))}
        </Pill>
      </div>

      {moreOpen && (
        <div className="card mt-2 flex flex-wrap items-end gap-3 px-4 py-3">
          <label className="min-w-[7rem] flex-1">
            <span className="field-label">{t('catalog.min')}</span>
            <input
              className="field"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder={t('catalog.min')}
              value={min}
              onChange={(e) => update({ min: e.target.value || null })}
              aria-label={t('catalog.min')}
            />
          </label>
          <label className="min-w-[7rem] flex-1">
            <span className="field-label">{t('catalog.max')}</span>
            <input
              className="field"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder={t('catalog.max')}
              value={max}
              onChange={(e) => update({ max: e.target.value || null })}
              aria-label={t('catalog.max')}
            />
          </label>
          <label className="min-w-[9rem] flex-1">
            <span className="field-label">{t('catalog.size')}</span>
            <input
              className="field"
              placeholder={'e.g. 4-5y · 30 · M'}
              value={size}
              onChange={(e) => update({ size: e.target.value || null })}
            />
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {data ? (
          <p className="text-sm text-ink-soft">{t('catalog.results', { count: data.totalElements })}</p>
        ) : <span />}
        {filtersActive && (
          <button type="button" className="btn-quiet text-sm" onClick={() => setParams(q ? { q } : {}, { replace: true })}>
            {t('catalog.clearFilters')}
          </button>
        )}
      </div>

      {isLoading && !data ? (
        <GridSkeleton count={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={t('catalog.empty')} />
      ) : (
        <>
          <ul className="mt-2 divide-y divide-surface-200 border-y border-surface-200">
            {data?.items.map((product) => (
              <ListingRow key={product.slug} product={product} />
            ))}
          </ul>

          {data && data.totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) }, true)}
              >
                {t('catalog.previous')}
              </button>
              <span className="text-sm text-ink-soft">
                {t('catalog.page', { page, total: data.totalPages })}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= data.totalPages}
                onClick={() => update({ page: String(page + 1) }, true)}
              >
                {t('catalog.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
