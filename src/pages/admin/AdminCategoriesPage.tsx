import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EyeOff, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { adminProducts, adminSettings } from '../../lib/adminApi';
import { AgeBandsCard } from '../../components/admin/AgeBandsCard';
import { titleCase } from '../../lib/format';
import { categorySchema, fieldErrors } from '../../lib/validation';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { AdminCategory } from '../../lib/types';

/**
 * The categories endpoint answers with `imageUrl` as well, but the shared mirror leaves it out,
 * so the rows are widened here instead of editing a file every other page shares.
 */
type CategoryRow = AdminCategory & { imageUrl: string | null };

type Audience = 'CHILD' | 'ADULT' | 'FAMILY';

interface Draft {
  id: number | null;
  slug: string;
  nameEn: string;
  descriptionEn: string;
  audience: Audience;
  imageUrl: string;
  sortOrder: string;
  active: boolean;
}

const AUDIENCES: Audience[] = ['CHILD', 'ADULT', 'FAMILY'];

const BLANK: Draft = {
  id: null,
  slug: '',
  nameEn: '',
  descriptionEn: '',
  audience: 'CHILD',
  imageUrl: '',
  sortOrder: '10',
  active: true,
};

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** Exactly the fields `CategoryUpsertRequest` accepts — nothing invented. */
function bodyOf(input: {
  slug: string; nameEn: string; descriptionEn: string;
  audience: Audience; imageUrl: string; sortOrder: string; active: boolean;
}): Record<string, unknown> {
  return {
    nameEn: input.nameEn.trim(),
    descriptionEn: blankToNull(input.descriptionEn),
    audience: input.audience,
    imageUrl: blankToNull(input.imageUrl),
    sortOrder: /^\d+$/.test(input.sortOrder.trim()) ? Number(input.sortOrder.trim()) : 0,
    active: input.active,
    // The server keeps the existing slug when this is blank, and slugifies the English name for a
    // brand new category, so an empty box is a real choice rather than a missing field.
    ...(input.slug.trim() ? { slug: input.slug.trim() } : {}),
  };
}

function bodyForRow(row: CategoryRow, active: boolean) {
  return bodyOf({
    slug: row.slug,
    nameEn: row.nameEn,
    descriptionEn: row.descriptionEn ?? '',
    audience: AUDIENCES.includes(row.audience as Audience) ? (row.audience as Audience) : 'CHILD',
    imageUrl: row.imageUrl ?? '',
    sortOrder: String(row.sortOrder),
    active,
  });
}

function draftOf(row: CategoryRow): Draft {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    descriptionEn: row.descriptionEn ?? '',
    audience: AUDIENCES.includes(row.audience as Audience) ? (row.audience as Audience) : 'CHILD',
    imageUrl: row.imageUrl ?? '',
    sortOrder: String(row.sortOrder),
    active: row.active,
  };
}

function toMessages(errors: Record<string, { message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) out[key] = value.message;
  return out;
}

export default function AdminCategoriesPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();
  // Category writes need ROLE_MANAGER on the server; OWNER and MANAGER are exactly the two roles
  // that carry the `products` permission, so this gate mirrors the backend rule.
  const canWrite = can(PERMISSION.products);

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CategoryRow | null>(null);
  // The server only lists active categories, so a hidden one is kept here to be able to bring it
  // back with the exact values it was last read with.
  const [hidden, setHidden] = useState<{ row: CategoryRow; products: number | null }[]>([]);

  const list = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => adminSettings.categories() as Promise<CategoryRow[]>,
  });

  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [list.data]);

  const slugKey = rows.map((row) => row.slug).join(',');

  const counts = useQuery({
    queryKey: ['admin', 'categories', 'product-counts', slugKey],
    enabled: slugKey !== '',
    queryFn: async () => {
      const pages = await Promise.all(rows.map((row) => adminProducts.list({ category: row.slug, pageSize: 1 })));
      const out: Record<string, number> = {};
      rows.forEach((row, index) => { out[row.slug] = pages[index].totalElements; });
      return out;
    },
  });

  const productCount = (slug: string): number | null => counts.data?.[slug] ?? null;

  const audienceLabel = (value: string) =>
    value === 'CHILD' ? 'Children'
      : value === 'ADULT' ? 'Grown-ups'
      : value === 'FAMILY' ? t('nav.family')
      : titleCase(value);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin', 'categories'] });
    client.invalidateQueries({ queryKey: ['store'] });
    // The products table shows the category name, and stock rows carry it too.
    client.invalidateQueries({ queryKey: ['admin', 'products'] });
    client.invalidateQueries({ queryKey: ['admin', 'inventory'] });
  };

  const fail = (error: unknown) => {
    if (error instanceof ApiError) {
      const fieldText = error.fields.map((field) => `${field.field}: ${field.message}`).join(' · ');
      setBanner(fieldText ? `${error.message} — ${fieldText}` : error.message);
      error.fields.forEach((field) => setIssues((prev) => ({ ...prev, [field.field]: field.message })));
      return error.message;
    }
    setBanner('request failed');
    return 'request failed';
  };

  const save = useMutation({
    mutationFn: (variables: { id: number | null; body: Record<string, unknown> }) =>
      (variables.id === null
        ? adminSettings.createCategory(variables.body)
        : adminSettings.updateCategory(variables.id, variables.body)),
    onSuccess: (_result, variables) => {
      refresh();
      setBanner(null);
      setIssues({});
      setDraft(BLANK);
      toast.push(
        variables.id === null
          ? 'Category created and stored on the server.'
          : 'Category saved.',
        'ok',
      );
    },
    onError: (error) => toast.push(fail(error), 'warn'),
  });

  const setActive = useMutation({
    mutationFn: (variables: { row: CategoryRow; active: boolean; products: number | null }) =>
      adminSettings.updateCategory(variables.row.id, bodyForRow(variables.row, variables.active)),
    onSuccess: (_result, variables) => {
      refresh();
      setConfirming(null);
      if (variables.active) {
        setHidden((prev) => prev.filter((entry) => entry.row.id !== variables.row.id));
        toast.push(`${variables.row.nameEn} is listed and shoppable again.`, 'ok');
        return;
      }
      setHidden((prev) => [{ row: variables.row, products: variables.products }, ...prev.filter((e) => e.row.id !== variables.row.id)]);
      if (draft.id === variables.row.id) {
        setDraft(BLANK);
      }
      toast.push(
        `${variables.row.nameEn} is out of the shop. Its products still point at the category, so hide those too if nothing should sell.`,
        'warn',
      );
    },
    onError: (error) => toast.push(fail(error), 'warn'),
  });

  const submit = () => {
    setBanner(null);
    const body = bodyOf(draft);
    const checked = categorySchema.safeParse(body);
    if (!checked.success) {
      setIssues(toMessages(fieldErrors(checked.error)));
      return;
    }
    setIssues({});
    save.mutate({ id: draft.id, body });
  };


  const editing = draft.id !== null;
  const confirmCount = confirming ? productCount(confirming.slug) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{t('admin.panel')}</p>
        <h1 className="font-display text-2xl leading-tight text-ink">{t('admin.categories')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {'Categories are the shelves of the shop: a product picks one by its slug, and the storefront menu is built from this list.'}
        </p>
      </div>

      {banner && (
        <div className="card border-error-300/60 bg-error-100/50 px-4 py-3 text-sm text-error-600">{banner}</div>
      )}

      {confirming && (
        <div className="card border-error-300/60 bg-error-100/50 px-4 py-3">
          <p className="text-sm font-medium text-ink">
            {`Remove ${confirming.nameEn} from the shop?`}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {confirmCount !== null && confirmCount > 0
              ? `${confirmCount} product${confirmCount === 1 ? '' : 's'} still use${confirmCount === 1 ? 's' : ''} this category. The server has no route that erases a category in use, so this writes active = false: the shelf leaves the storefront menu and this list, while the products keep their stock and history.`
              : 'No product uses this category right now, so nothing else changes.'}
          </p>
          <p className="mt-1 text-xs text-ink-mute">
            {'The server lists active categories only, so the row disappears. Use the card beside the table to put it back in this session.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={setActive.isPending}
              onClick={() => setActive.mutate({ row: confirming, active: false, products: confirmCount })}
            >
              {'Yes, remove it'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setConfirming(null)}>{t('admin.cancel')}</button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-200 px-3 py-2.5">
            <h2 className="font-display text-base leading-tight text-ink">
              {`Categories (${rows.length})`}
            </h2>
            <span className="text-xs text-ink-mute">
              {counts.isFetching
                ? 'Counting products…'
                : counts.isError
                  ? 'The product counts could not be read from the server.'
                  : 'Product counts come from the server'}
            </span>
          </div>

          {list.isLoading && <div className="px-4 py-4"><LoadingRows rows={5} /></div>}
          {list.isError && <div className="px-4 py-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
          {!list.isLoading && !list.isError && rows.length === 0 && (
            <EmptyState
              title={t('admin.noResults')}
              body={'No category is stored yet. The first one you add shows up in the storefront menu.'}
            />
          )}
          {!list.isLoading && !list.isError && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-surface-100 text-xs uppercase tracking-wide text-ink-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">{'Category'}</th>
                    <th className="px-3 py-2 font-medium">{t('catalog.audience')}</th>
                    <th className="px-3 py-2 font-medium">{'Products'}</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">{'Order'}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-200">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-ink">{row.nameEn}</p>
                        <p className="mt-0.5 text-xs text-ink-mute">
                          {row.slug}
                          {row.isSample && (
                            <span className="ml-1 rounded border border-secondary-300 bg-secondary-100 px-1 py-0.5 text-[0.65rem] text-primary-700">
                              {t('admin.sampleData')}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">
                        {audienceLabel(row.audience)}
                      </td>
                      <td className="px-3 py-2.5 text-sm tabular-nums text-ink">
                        {counts.isLoading ? '—' : productCount(row.slug) ?? '—'}
                      </td>
                      <td className="hidden px-3 py-2.5 text-sm tabular-nums text-ink-soft sm:table-cell">{row.sortOrder}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs"
                            onClick={() => {
                              setDraft(draftOf(row));
                              setIssues({});
                              setBanner(null);
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            {'Edit'}
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs text-error-600"
                              onClick={() => setConfirming(row)}
                            >
                              <EyeOff className="size-3.5" aria-hidden />
                              {'Remove'}
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

        <div className="space-y-4">
          <section className="card px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-base leading-tight text-ink">
                {editing ? `Editing ${draft.slug || draft.nameEn}`
                  : 'New category'}
              </h2>
              {editing && (
                <button
                  type="button"
                  className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-xs"
                  onClick={() => { setDraft(BLANK); setIssues({}); }}
                >
                  <X className="size-3.5" aria-hidden />
                  {t('admin.cancel')}
                </button>
              )}
            </div>

            {!canWrite ? (
              <p className="mt-3 text-xs text-error-600">
                {'Your role may read the categories but not change them.'}
              </p>
            ) : (
              <div className="mt-3 space-y-3">

                <div className="grid gap-3">
                  <div>
                    <label className="field-label" htmlFor="cat-name-en">{'Name'}</label>
                    <input
                      id="cat-name-en"
                      className={`field px-2.5 py-2 text-sm ${issues.nameEn ? 'field-error' : ''}`}
                      value={draft.nameEn}
                      onChange={(event) => setDraft((prev) => ({ ...prev, nameEn: event.target.value }))}
                      placeholder="Baby clothing"
                    />
                    {issues.nameEn && <p className="mt-1 text-xs text-error-600">{issues.nameEn}</p>}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <label className="field-label" htmlFor="cat-desc-en">{'Short line'}</label>
                    <textarea
                      id="cat-desc-en"
                      rows={2}
                      className={`field px-2.5 py-2 text-sm ${issues.descriptionEn ? 'field-error' : ''}`}
                      value={draft.descriptionEn}
                      onChange={(event) => setDraft((prev) => ({ ...prev, descriptionEn: event.target.value }))}
                    />
                    {issues.descriptionEn && <p className="mt-1 text-xs text-error-600">{issues.descriptionEn}</p>}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="cat-audience">{t('catalog.audience')}</label>
                    <select
                      id="cat-audience"
                      className="field px-2.5 py-2 text-sm"
                      value={draft.audience}
                      onChange={(event) => setDraft((prev) => ({ ...prev, audience: event.target.value as Audience }))}
                    >
                      {AUDIENCES.map((value) => (
                        <option key={value} value={value}>{audienceLabel(value)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="cat-sort">{'Order in the menu'}</label>
                    <input
                      id="cat-sort"
                      inputMode="numeric"
                      className={`field px-2.5 py-2 text-sm tabular-nums ${issues.sortOrder ? 'field-error' : ''}`}
                      value={draft.sortOrder}
                      onChange={(event) => setDraft((prev) => ({ ...prev, sortOrder: event.target.value }))}
                    />
                    {issues.sortOrder && <p className="mt-1 text-xs text-error-600">{issues.sortOrder}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="cat-slug">
                      {'Slug'}
                      <span className="ml-1 text-xs font-normal text-ink-mute">({t('common.optional')})</span>
                    </label>
                    <input
                      id="cat-slug"
                      className={`field px-2.5 py-2 text-sm ${issues.slug ? 'field-error' : ''}`}
                      value={draft.slug}
                      onChange={(event) => setDraft((prev) => ({ ...prev, slug: event.target.value }))}
                      placeholder={draft.nameEn.trim() ? draft.nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'baby-clothing'}
                    />
                    <p className="mt-1 text-xs text-ink-mute">
                      {editing
                        ? 'Changing the slug breaks links shoppers already have; products keep pointing at this category.'
                        : 'Blank means the server builds it from the English name.'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="cat-image">
                    {'Shelf image URL'}
                    <span className="ml-1 text-xs font-normal text-ink-mute">({t('common.optional')})</span>
                  </label>
                  <input
                    id="cat-image"
                    className={`field px-2.5 py-2 text-sm ${issues.imageUrl ? 'field-error' : ''}`}
                    value={draft.imageUrl}
                    onChange={(event) => setDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                    placeholder="https://…/baby.jpg"
                  />
                  {issues.imageUrl && <p className="mt-1 text-xs text-error-600">{issues.imageUrl}</p>}
                </div>

                <label className="flex items-start gap-3 py-1">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary-500"
                    checked={draft.active}
                    onChange={(event) => setDraft((prev) => ({ ...prev, active: event.target.checked }))}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      {draft.active ? t('admin.active') : t('admin.inactive')}
                    </span>
                    <span className="block text-xs text-ink-mute">
                      {'An inactive category leaves the storefront menu and the product form list.'}
                    </span>
                  </span>
                </label>

                <button type="button" className="btn-primary flex w-full items-center justify-center gap-2" disabled={save.isPending} onClick={submit}>
                  {editing ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                  {save.isPending
                    ? t('admin.saving')
                    : editing ? 'Save changes' : t('admin.addCategory')}
                </button>
              </div>
            )}
          </section>

          {hidden.length > 0 && (
            <section className="card px-4 py-4">
              <h2 className="font-display text-base leading-tight text-ink">
                {'Removed in this session'}
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                {'The server will not list an inactive category, so these rows live here until you put one back or reload the page.'}
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {hidden.map((entry) => (
                  <li key={entry.row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-200 pb-2 last:border-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{entry.row.nameEn}</span>
                      <span className="block truncate text-xs text-ink-mute">
                        {entry.row.slug}
                        {entry.products !== null && ` · ${entry.products} ${'products'}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ row: entry.row, active: true, products: entry.products })}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      {'Put it back'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AgeBandsCard />

          <section className="card px-4 py-4">
            <h2 className="font-display text-base leading-tight text-ink">{'How removal works'}</h2>
            <ul className="mt-2 space-y-2 text-xs text-ink-soft">
              <li>
                {'The API exposes GET, POST and PUT /admin/categories — there is no DELETE, so a removal here writes active = false.'}
              </li>
              <li>
                {'A product whose category was removed keeps pointing at it, so it stops appearing in the storefront menu until you edit the product.'}
              </li>
              <li>
                {'Every save is audited on the server as CATEGORY_CREATED or CATEGORY_UPDATED.'}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
