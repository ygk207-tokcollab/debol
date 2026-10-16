import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { ApiError, assetUrl } from '../../lib/api';
import { adminProducts, adminSettings } from '../../lib/adminApi';
import { money, titleCase } from '../../lib/format';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { Price } from '../../components/Price';
import { StatusPill } from '../../components/StatusPill';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { AdminProduct, Paged } from '../../lib/types';

const PAGE_SIZE = 20;
/** The products endpoint has no audience parameter, so the audience chip narrows one wide page. */
const WIDE_PAGE_SIZE = 100;
const STATUSES = ['PUBLISHED', 'DRAFT', 'ARCHIVED'];
const AUDIENCES = ['CHILD', 'ADULT', 'FAMILY'];

type Pending = { product: AdminProduct; action: 'delete' | 'status'; next?: string } | null;

export default function AdminProductsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();
  const canWrite = can(PERMISSION.products);

  const [term, setTerm] = useState('');
  const [searched, setSearched] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState('');
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(term.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    setPage(0);
  }, [searched, status, category, audience]);

  const narrowing = audience !== '';
  const request = {
    q: searched || undefined,
    status: status || undefined,
    category: category || undefined,
    page: narrowing ? 0 : page,
    pageSize: narrowing ? WIDE_PAGE_SIZE : PAGE_SIZE,
  };

  const list = useQuery({
    queryKey: ['admin', 'products', request],
    queryFn: () => adminProducts.list(request),
  });

  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: adminSettings.categories,
    staleTime: 120_000,
  });

  const view = useMemo(() => {
    const data: Paged<AdminProduct> | undefined = list.data;
    if (!data) return { rows: [] as AdminProduct[], pages: 1, shown: 0, total: 0, page: 0 };
    if (!narrowing) {
      return {
        rows: data.items,
        pages: Math.max(data.totalPages, 1),
        shown: data.items.length,
        total: data.totalElements,
        page: Math.min(page, Math.max(data.totalPages - 1, 0)),
      };
    }
    const matched = data.items.filter((product) => product.audience === audience);
    const pages = Math.max(Math.ceil(matched.length / PAGE_SIZE), 1);
    const current = Math.min(page, pages - 1);
    return {
      rows: matched.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
      pages,
      shown: matched.length,
      total: matched.length,
      page: current,
    };
  }, [list.data, narrowing, audience, page]);

  const currentPage = view.page;

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin', 'products'] });
    // Published rows feed the storefront, so its cache is stale as soon as a status changes.
    client.invalidateQueries({ queryKey: ['store'] });
  };

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: number; next: string }) => adminProducts.setStatus(id, next),
    onSuccess: (product) => {
      refresh();
      setPending(null);
      toast.push(
        `${product.nameEn} is now ${titleCase(product.status)}.`,
        'ok',
      );
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : 'request failed', 'warn'),
  });

  const toggleFeatured = useMutation({
    mutationFn: ({ id, featured }: { id: number; featured: boolean }) => adminProducts.setFeatured(id, featured),
    onSuccess: (product) => {
      refresh();
      toast.push(
        product.featured
          ? `${product.nameEn} is featured on the home page.`
          : `${product.nameEn} is no longer featured.`,
        'ok',
      );
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : 'request failed', 'warn'),
  });

  /** DELETE either drops the row or archives it — the server decides, so the toast reports its answer. */
  const remove = useMutation({
    mutationFn: (id: number) => adminProducts.archive(id),
    onSuccess: (result, id) => {
      const answer = result as unknown as { deleted?: boolean; archived?: boolean; reason?: string };
      refresh();
      client.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      setPending(null);
      if (answer.archived) {
        toast.push(
          answer.reason
            ?? 'Archived instead of deleted because past orders reference it.',
          'warn',
        );
      } else if (answer.deleted) {
        toast.push(`Product #${id} deleted from the catalogue.`, 'ok');
      } else {
        toast.push(t('admin.saved'), 'ok');
      }
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : 'request failed', 'warn'),
  });

  const askStatus = (product: AdminProduct, next: string) => {
    if (next === product.status) return;
    if (next === 'PUBLISHED') {
      changeStatus.mutate({ id: product.id, next });
      return;
    }
    setPending({ product, action: 'status', next });
  };

  const filtersActive = searched !== '' || status !== '' || category !== '' || audience !== '';
  const clearFilters = () => {
    setTerm('');
    setSearched('');
    setStatus('');
    setCategory('');
    setAudience('');
  };

  const confirmDelete = pending && pending.action === 'delete' ? pending.product : null;
  const confirmHide = pending && pending.action === 'status'
    ? { product: pending.product, next: pending.next ?? 'ARCHIVED' }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('admin.panel')}</p>
          <h1 className="font-display text-2xl leading-tight text-ink">{t('admin.products')}</h1>
        </div>
        {canWrite && (
          <Link to="/admin/products/new" className="btn-primary">
            <Plus className="size-4" aria-hidden />
            {t('admin.newProduct')}
          </Link>
        )}
      </div>

      <section className="card px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="products-q">
              {'Search name or slug'}
            </label>
            <input
              id="products-q"
              className="field"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={'sneakers, school shoes'}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="products-status">{t('admin.statusFilter')}</label>
            <select id="products-status" className="field" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{'Any status'}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>{t(`status.${value}`, titleCase(value))}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="products-category">{t('catalog.category')}</label>
            <select id="products-category" className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{'All categories'}</option>
              {(categories.data ?? []).map((row) => (
                <option key={row.slug} value={row.slug}>{row.nameEn}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="products-audience">{t('catalog.audience')}</label>
            <select id="products-audience" className="field" value={audience} onChange={(event) => setAudience(event.target.value)}>
              <option value="">{'Everyone'}</option>
              {AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {value === 'CHILD' ? 'Children'
                    : value === 'ADULT' ? 'Grown-ups'
                    : t('nav.family')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-mute">
          <span>
            {view.total > 0
              ? `${view.shown} of ${view.total} products shown`
              : 'No products yet'}
          </span>
          {narrowing && (
            <span>
              {'The products endpoint has no audience filter, so this narrows the loaded page.'}
            </span>
          )}
          {filtersActive && (
            <button type="button" className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden />
              {t('catalog.clearFilters')}
            </button>
          )}
        </div>
      </section>

      {confirmDelete && (
        <div className="card border-error-300/60 bg-error-100/50 px-4 py-3">
          <p className="text-sm font-medium text-ink">
            {`Delete ${confirmDelete.nameEn} (${money(confirmDelete.basePrice)})?`}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {'Sizes, images and stock go with it. If an order already bought it the server archives the product instead of deleting it.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(confirmDelete.id)}
            >
              {'Yes, delete it'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setPending(null)}>{t('admin.cancel')}</button>
          </div>
        </div>
      )}

      {confirmHide && (
        <div className="card border-error-300/60 bg-error-100/50 px-4 py-3">
          <p className="text-sm font-medium text-ink">
            {confirmHide.next === 'ARCHIVED'
              ? `Hide ${confirmHide.product.nameEn} from the storefront?`
              : `Move ${confirmHide.product.nameEn} back to draft?`}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {'Shoppers stop seeing it right away; orders already placed keep their history and the stock stays recorded.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ id: confirmHide.product.id, next: confirmHide.next })}
            >
              {confirmHide.next === 'ARCHIVED' ? 'Yes, hide it' : t('admin.draft')}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setPending(null)}>{t('admin.cancel')}</button>
          </div>
        </div>
      )}

      <section className="card overflow-hidden">
        {list.isLoading && <div className="px-4 py-4"><LoadingRows rows={6} /></div>}
        {list.isError && <div className="px-4 py-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
        {!list.isLoading && !list.isError && view.rows.length === 0 && (
          <EmptyState
            title={t('admin.noResults')}
            body={filtersActive
              ? 'No product matches these filters.'
              : 'The catalogue is empty. Create the first product.'}
            action={canWrite && !filtersActive
              ? <Link to="/admin/products/new" className="btn-primary">{t('admin.newProduct')}</Link>
              : undefined}
          />
        )}
        {!list.isLoading && !list.isError && view.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-surface-100 text-xs uppercase tracking-wide text-ink-mute">
                <tr>
                  <th className="px-3 py-2 font-medium">{'Product'}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.stock')}</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">{'Sizes'}</th>
                  <th className="px-3 py-2 font-medium">{'Price'}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.statusFilter')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200">
                {view.rows.map((product) => (
                  <tr key={product.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="size-12 shrink-0 overflow-hidden rounded-md bg-secondary-100">
                          {product.images[0]?.url && (
                            <img src={assetUrl(product.images[0].url)} alt="" className="size-full object-cover" loading="lazy" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{product.nameEn}</p>
                          <p className="truncate text-xs text-ink-mute">{product.slug}</p>
                          <p className="truncate text-xs text-ink-mute">
                            {product.categoryNameEn}
                            {product.featured ? ` · ${'featured'}` : ''}
                            {product.isSample ? ` · ${t('admin.sampleData')}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      <span className={product.totalStock === 0 ? 'font-medium text-error-600' : 'text-ink'}>
                        {product.totalStock}
                      </span>
                      {product.lowStockVariants > 0 && (
                        <span className="ml-1 text-xs text-error-600">
                          {`${product.lowStockVariants} low`}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-ink-soft sm:table-cell">
                      {product.variants.length}
                      <span className="ml-1 text-ink-mute">{product.sizingSystem}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Price value={product.basePrice} sale={product.salePrice} size="sm" />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill value={product.status} />
                      {canWrite && (
                        <select
                          className="field mt-1.5 w-full px-2 py-1 text-xs"
                          value={product.status}
                          aria-label={`Change the status of ${product.nameEn}`}
                          onChange={(event) => askStatus(product, event.target.value)}
                          disabled={changeStatus.isPending}
                        >
                          {STATUSES.map((value) => (
                            <option key={value} value={value}>{t(`status.${value}`, titleCase(value))}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Link to={`/admin/products/${product.id}`} className="btn-secondary px-2.5 py-1 text-xs">
                          <Pencil className="size-3.5" aria-hidden />
                          {t('admin.editProduct')}
                        </Link>
                        {canWrite && (
                          <button
                            type="button"
                            className="btn-quiet px-2.5 py-1 text-xs"
                            disabled={toggleFeatured.isPending}
                            onClick={() => toggleFeatured.mutate({ id: product.id, featured: !product.featured })}
                          >
                            {product.featured ? t('admin.unfeature') : t('admin.markFeatured')}
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            className="btn-danger px-2.5 py-1 text-xs"
                            onClick={() => setPending({ product, action: 'delete' })}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {t('admin.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-mute">{t('catalog.page', { page: currentPage + 1, total: view.pages })}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            {t('catalog.previous')}
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            disabled={currentPage + 1 >= view.pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('catalog.next')}
          </button>
        </div>
      </div>

      {!canWrite && (
        <p className="text-xs text-ink-mute">
          {'Your role can read the catalogue but not change it.'}
        </p>
      )}
    </div>
  );
}
