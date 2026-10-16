import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { SectionCard, SelectField, TextField } from '../../components/form';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { adminPeople } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { formatDateTime, relativeTime, titleCase } from '../../lib/format';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import type { AuditRow } from '../../lib/types';

/** /admin/audit also returns these columns; the shared AuditRow type does not name them yet. */
interface AuditEntry extends AuditRow {
  entityId?: string | null;
  ip?: string | null;
  changes?: string | null;
}

interface ServerQuery {
  entityType: string;
  entityId: string;
  page: number;
  size: number;
}

const DEFAULT_QUERY: ServerQuery = { entityType: '', entityId: '', page: 0, size: 50 };

/** Entity types the backend actually writes into audit_log. */
const ENTITY_TYPES = ['ORDER', 'PRODUCT', 'VARIANT', 'CATEGORY', 'DELIVERY_ZONE', 'SETTINGS', 'ADMINISTRATOR', 'NOTIFICATION'];

const ACTOR_TONE: Record<string, string> = {
  ADMIN: 'border-primary-200 bg-primary-50 text-primary-600',
  CUSTOMER: 'border-secondary-300 bg-secondary-100 text-primary-600',
  SYSTEM: 'border-surface-300 bg-surface-200 text-ink-mute',
  TELEGRAM_BUTTON: 'border-error-300/60 bg-error-100 text-error-600',
};

function entityLink(row: AuditEntry): string | null {
  if (!row.entityId) return null;
  if (row.entityType === 'ORDER') return `/admin/orders/${row.entityId}`;
  if (row.entityType === 'PRODUCT') return `/admin/products/${row.entityId}`;
  return null;
}

export default function AdminAuditPage() {
  const { t } = useTranslation();
  const { can } = useAdminAuth();
  const allowed = can(PERMISSION.audit);

  const [committed, setCommitted] = useState<ServerQuery>(DEFAULT_QUERY);
  const [draft, setDraft] = useState<ServerQuery>(DEFAULT_QUERY);
  const [actorText, setActorText] = useState('');
  const [actionText, setActionText] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [openRow, setOpenRow] = useState<number | null>(null);

  const audit = useQuery({
    queryKey: ['admin', 'audit', committed],
    queryFn: () =>
      adminPeople.audit({
        entityType: committed.entityType || undefined,
        entityId: committed.entityId || undefined,
        page: committed.page,
        size: committed.size,
      }),
    enabled: allowed,
    retry: false,
  });

  const loaded: AuditEntry[] = (audit.data?.items ?? []) as AuditEntry[];
  const matched = loaded.filter((row) => {
    if (actorText.trim() && !`${row.actor ?? ''} ${row.actorType}`.toLowerCase().includes(actorText.trim().toLowerCase())) {
      return false;
    }
    if (actionText.trim() && !row.action.toLowerCase().includes(actionText.trim().toLowerCase())) return false;
    const at = new Date(row.at).getTime();
    if (fromDate && at < new Date(`${fromDate}T00:00:00`).getTime()) return false;
    if (toDate && at > new Date(`${toDate}T23:59:59`).getTime()) return false;
    return true;
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommitted({ ...draft, page: 0 });
    setOpenRow(null);
  }

  function goToPage(next: number) {
    const page = Math.max(0, next);
    setDraft((current) => ({ ...current, page }));
    setCommitted((current) => ({ ...current, page }));
    setOpenRow(null);
  }

  if (!allowed) {
    return (
      <SectionCard
        title={t('admin.audit')}
        description={'The audit trail needs the manager or owner role. The server answers 403 for any other account.'}
      >
        <div className="flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {'Nothing to read with this account.'}
        </div>
      </SectionCard>
    );
  }

  const totalPages = audit.data?.totalPages ?? 0;
  const totalElements = audit.data?.totalElements ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{'Write history'}</p>
          <h1 className="font-display text-xl leading-tight text-ink">{t('admin.audit')}</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            {'These are the rows of the audit_log table in PostgreSQL, newest first: every order move, price change, stock adjustment, zone save, settings write, pairing and revocation, with the acting account and its IP. Nothing on this screen is generated by the panel.'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => audit.refetch()} disabled={audit.isFetching}>
          <RotateCcw className="size-4" aria-hidden />
          {audit.isFetching ? t('admin.loading') : 'Refresh'}
        </button>
      </div>

      <form onSubmit={applyFilters} noValidate>
        <SectionCard
          title={'Filters'}
          description={'Entity type and entity id are filtered by the database. Actor, action and the date range narrow the rows on the page you have loaded.'}
          actions={
            <button type="submit" className="btn-primary" disabled={audit.isFetching}>
              <Search className="size-4" aria-hidden />
              {'Apply'}
            </button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={'Entity type (server)'}
              name="entityType"
              placeholder={'Any entity'}
              value={draft.entityType}
              onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
              options={ENTITY_TYPES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <TextField
              label={'Entity id (server)'}
              name="entityId"
              inputMode="numeric"
              hint={'The database needs both a type and an id together; an id alone returns the recent stream.'}
              value={draft.entityId}
              onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
            />
            <SelectField
              label={'Rows per page'}
              name="size"
              value={String(draft.size)}
              onChange={(e) => setDraft({ ...draft, size: Number(e.target.value) })}
              options={[
                { value: '25', label: '25' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
              ]}
            />
            <TextField
              label={'Actor contains'}
              name="actorText"
              value={actorText}
              onChange={(e) => setActorText(e.target.value)}
            />
            <TextField
              label={'Action contains'}
              name="actionText"
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label={t('admin.from')}
                name="fromDate"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <TextField label={t('admin.to')} name="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <button
            type="button"
            className="btn-quiet mt-3"
            onClick={() => {
              setDraft(DEFAULT_QUERY);
              setCommitted(DEFAULT_QUERY);
              setActorText('');
              setActionText('');
              setFromDate('');
              setToDate('');
            }}
          >
            {'Clear filters'}
          </button>
        </SectionCard>
      </form>

      {audit.isError && (
        <ErrorState
          error={audit.error}
          onRetry={() => audit.refetch()}
        />
      )}
      {audit.isError && audit.error instanceof ApiError && audit.error.status === 403 && (
        <p className="px-1 text-xs text-error-600">{audit.error.message}</p>
      )}

      {audit.isLoading && <LoadingRows rows={6} />}

      {!audit.isLoading && audit.data && (
        <SectionCard
          title={'Audit rows'}
          description={
            actorText.trim() || actionText.trim() || fromDate || toDate
              ? `${matched.length} of ${loaded.length} loaded rows match the on-page filters; the database reports ${totalElements} rows in total.`
              : `${loaded.length} rows on this page, ${totalElements} rows in the table.`
          }
        >
          {matched.length === 0 ? (
            <EmptyState
              title={t('admin.noResults')}
              body={'No audit rows match. Widen the filters or load another page.'}
            />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-300 text-xs uppercase tracking-wide text-ink-mute">
                    <th className="py-2 pr-3 font-semibold">{'When'}</th>
                    <th className="py-2 pr-3 font-semibold">{'Actor'}</th>
                    <th className="py-2 pr-3 font-semibold">{'Action'}</th>
                    <th className="py-2 pr-3 font-semibold">{'Entity'}</th>
                    <th className="py-2 font-semibold">{'Detail'}</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((row) => {
                    const link = entityLink(row);
                    const open = openRow === row.id;
                    return (
                      <tr key={row.id} className="border-b border-surface-200 align-top last:border-0">
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span className="block text-ink">{formatDateTime(row.at)}</span>
                          <span className="block text-xs text-ink-mute">{relativeTime(row.at)}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                              ACTOR_TONE[row.actorType] ?? ACTOR_TONE.SYSTEM
                            }`}
                          >
                            {titleCase(row.actorType)}
                          </span>
                          <span className="mt-1 block text-ink-soft">{row.actor || 'system'}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="block font-medium text-ink">{titleCase(row.action)}</span>
                          <span className="block font-mono text-xs text-ink-mute">{row.action}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="block text-ink-soft">{titleCase(row.entityType)}</span>
                          {row.entityId ? (
                            link ? (
                              <Link
                                to={link}
                                className="text-xs text-primary-600 underline underline-offset-2 transition-colors hover:text-primary-700"
                              >
                                #{row.entityId}
                              </Link>
                            ) : (
                              <span className="block text-xs text-ink-mute">#{row.entityId}</span>
                            )
                          ) : (
                            <span className="block text-xs text-ink-mute">{'no single id'}</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <button
                            type="button"
                            className="flex w-full items-start gap-2 text-left"
                            onClick={() => setOpenRow(open ? null : row.id)}
                          >
                            <span className="flex-1 text-ink-soft">{row.summary || '—'}</span>
                            <ChevronDown
                              className={`mt-0.5 size-4 shrink-0 text-ink-mute ${open ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                          </button>
                          {open && (
                            <div className="mt-2 space-y-1 rounded-md border border-surface-300 bg-surface-100 px-3 py-2 text-xs text-ink-soft">
                              <p>
                                <span className="font-medium text-ink">{'Row id'}</span> #{row.id} ·{' '}
                                {'raw time'} {row.at}
                              </p>
                              <p>
                                <span className="font-medium text-ink">{'IP'}</span>{' '}
                                {row.ip ?? 'not recorded'}
                              </p>
                              <p>
                                <span className="font-medium text-ink">{'Field changes'}</span>{' '}
                                {row.changes ? (
                                  <span className="mt-1 block break-words font-mono text-ink">{row.changes}</span>
                                ) : (
                                  'the action wrote no field diff'
                                )}
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-mute">
              {`Page ${committed.page + 1} of ${Math.max(totalPages, 1)} · ${committed.size} rows requested per page`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => goToPage(committed.page - 1)}
                disabled={committed.page === 0 || audit.isFetching}
              >
                <ChevronLeft className="size-4" aria-hidden />
                {'Newer'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => goToPage(committed.page + 1)}
                disabled={committed.page + 1 >= totalPages || audit.isFetching}
              >
                {'Older'}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
