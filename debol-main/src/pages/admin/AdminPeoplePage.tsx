import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, KeyRound, Pencil, ShieldAlert, ShieldX, UserPlus, X } from 'lucide-react';
import { SectionCard, SelectField, TextField, ToggleField } from '../../components/form';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { adminPeople } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatPhone } from '../../lib/format';
import { administratorSchema, fieldErrors } from '../../lib/validation';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { Administrator } from '../../lib/types';

interface PeopleFormValues {
  email: string;
  fullName: string;
  phone: string;
  role: string;
  active: boolean;
  password: string;
}

const BLANK: PeopleFormValues = { email: '', fullName: '', phone: '', role: 'MANAGER', active: true, password: '' };

type CreateBody = {
  email: string;
  fullName: string;
  phone?: string;
  role: string;
  password: string;
  active: boolean;
};

type UpdateBody = {
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  password: string | null;
  active: boolean;
};

type SaveVariables = { id: null; body: CreateBody } | { id: number; body: UpdateBody };

/** What the server grants per role - AdminAuthService.permissionsOf, not a client invention. */
const ROLE_HELP: Record<string, string> = {
  OWNER: 'Everything: settings, Telegram pairing, administrators and the audit trail.',
  MANAGER: 'Catalogue, orders, inventory, delivery zones, notification queue and audit.',
  DELIVERY_STAFF: 'Dashboard and orders only.',
};

export default function AdminPeoplePage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can, session } = useAdminAuth();

  const allowed = can(PERMISSION.administrators);

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [values, setValues] = useState<PeopleFormValues>(BLANK);
  const [errors, setErrors] = useState<Record<string, { message: string }>>({});
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  const people = useQuery({
    queryKey: ['admin', 'people'],
    queryFn: adminPeople.list,
    enabled: allowed,
    retry: false,
  });

  // 403 comes back as { error: "forbidden", message: "Your account may not do this" }: surface the
  // server message instead of letting a non-owner guess why the buttons do nothing.
  const forbiddenMessage =
    people.error instanceof ApiError ? people.error.message : 'Owner accounts only.';
  const lockedOut = !allowed || people.error instanceof ApiError;

  const save = useMutation({
    mutationFn: (variables: SaveVariables) =>
      variables.id === null ? adminPeople.create(variables.body) : adminPeople.update(variables.id, variables.body),
    onSuccess: (_result, payload) => {
      client.invalidateQueries({ queryKey: ['admin', 'people'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setEditingId(null);
      setValues(BLANK);
      setErrors({});
      toast.push(
        payload.id == null
          ? 'Administrator created. Hand the password over yourself - the server stores only a hash.'
          : 'Administrator updated.',
        'ok',
      );
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => adminPeople.revoke(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['admin', 'people'] });
      client.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setConfirmRevoke(null);
      toast.push(
        'Sessions revoked: that administrator is signed out on every device now.',
        'ok',
      );
    },
  });

  function set<K extends keyof PeopleFormValues>(key: K, next: PeopleFormValues[K]) {
    setValues((current) => ({ ...current, [key]: next }));
  }

  function startCreate() {
    setValues(BLANK);
    setErrors({});
    setEditingId('new');
  }

  function startEdit(row: Administrator) {
    setValues({
      email: row.email,
      fullName: row.fullName,
      phone: row.phone ?? '',
      role: row.role,
      active: row.active,
      password: '',
    });
    setErrors({});
    setEditingId(row.id);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCreate = editingId === 'new';
    const passwordGiven = values.password.trim() !== '';

    const checked = administratorSchema.omit({ password: true }).safeParse({
      email: values.email,
      fullName: values.fullName,
      phone: values.phone,
      role: values.role,
    });
    if (!checked.success) {
      setErrors(fieldErrors(checked.error));
      return;
    }
    if (isCreate || passwordGiven) {
      const passwordCheck = administratorSchema.pick({ password: true }).safeParse({ password: values.password });
      if (!passwordCheck.success) {
        setErrors(fieldErrors(passwordCheck.error));
        return;
      }
    }
    setErrors({});

    const identity = {
      email: values.email.trim().toLowerCase(),
      fullName: values.fullName.trim(),
      role: values.role,
      active: values.active,
    };

    if (isCreate) {
      save.mutate({
        id: null,
        body: { ...identity, phone: values.phone.trim() || undefined, password: values.password },
      });
      return;
    }

    save.mutate({
      id: editingId as number,
      body: {
        ...identity,
        phone: values.phone.trim() || null,
        // Blank means "keep the current password"; the value is never echoed back anywhere.
        password: passwordGiven ? values.password : null,
      },
    });
  }

  const rows = people.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{'Who can sign in'}</p>
          <h1 className="font-display text-xl leading-tight text-ink">{t('admin.administrators')}</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            {'Every create, edit and revocation is OWNER-only on the server and lands in the audit trail with the acting email and IP.'}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={startCreate} disabled={lockedOut}>
          <UserPlus className="size-4" aria-hidden />
          {t('admin.addAdmin')}
        </button>
      </div>

      {lockedOut && (
        <div className="card flex items-start gap-3 border-error-300/60 bg-error-100/60 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-error-600" aria-hidden />
          <p className="text-sm text-error-600">
            {allowed
              ? forbiddenMessage
              : 'Your role may not read or change administrator accounts, so this screen is read-disabled and the form is closed. Ask an OWNER to make the change.'}
          </p>
        </div>
      )}

      {editingId !== null && !lockedOut && (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <SectionCard
            title={editingId === 'new' ? 'New administrator' : 'Edit administrator'}
            description={'The server keeps only a bcrypt hash: it never returns a password, a hash or a login token, and it does not mail one either. The password you type here is the credential - deliver it to the person yourself.'}
            actions={
              <button type="button" className="btn-quiet" onClick={() => setEditingId(null)}>
                <X className="size-4" aria-hidden />
                {t('admin.cancel')}
              </button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('admin.email')}
                name="email"
                type="email"
                autoComplete="off"
                required
                disabled={editingId !== 'new'}
                hint={
                  editingId === 'new'
                    ? 'Stored lower-cased; it must be unique.'
                    : 'Email is the sign-in identity and cannot be rewritten - create a new account instead.'
                }
                value={values.email}
                error={errors.email?.message}
                onChange={(e) => set('email', e.target.value)}
              />
              <TextField
                label={t('checkout.fullName')}
                name="fullName"
                required
                hint={'Appears in the audit trail as the actor.'}
                value={values.fullName}
                error={errors.fullName?.message}
                onChange={(e) => set('fullName', e.target.value)}
              />
              <TextField
                label={'Phone (optional)'}
                name="phone"
                type="tel"
                inputMode="tel"
                value={values.phone}
                error={errors.phone?.message}
                onChange={(e) => set('phone', e.target.value)}
              />
              <SelectField
                label={t('admin.role')}
                name="role"
                value={values.role}
                error={errors.role?.message}
                onChange={(e) => set('role', e.target.value)}
                options={[
                  { value: 'OWNER', label: t('admin.roleOwner') },
                  { value: 'MANAGER', label: t('admin.roleManager') },
                  { value: 'DELIVERY_STAFF', label: t('admin.roleCourier') },
                ]}
              />
              <TextField
                label={
                  editingId === 'new'
                    ? 'Initial password'
                    : 'Replace password (leave blank to keep)'
                }
                name="password"
                type="password"
                autoComplete="new-password"
                required={editingId === 'new'}
                hint={'At least 12 characters. Never shown again here, never written to storage or the console.'}
                value={values.password}
                error={errors.password?.message}
                onChange={(e) => set('password', e.target.value)}
              />
              <div className="sm:col-span-2">
                <ToggleField
                  label={'Account active'}
                  checked={values.active}
                  onChange={(next) => set('active', next)}
                  hint={'Switching off blocks sign-in. Changing role, deactivating or setting a password invalidates that person’s existing sessions.'}
                />
                <p className="mt-1 text-xs text-ink-mute">
                  {ROLE_HELP[values.role]}
                </p>
              </div>
            </div>

            {editingId !== 'new' && session && rows.some((row) => row.id === editingId && row.email === session.email) && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600">
                <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
                {'This is your own account. Changing the role, deactivating it or setting a password signs you out immediately and you will need the new credentials to get back in.'}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                <Check className="size-4" aria-hidden />
                {save.isPending ? t('admin.saving') : t('admin.save')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
                {t('admin.cancel')}
              </button>
            </div>

            {save.isError && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {save.error instanceof ApiError
                  ? save.error.message
                  : 'The server refused this change.'}
              </p>
            )}
          </SectionCard>
        </form>
      )}

      {people.isLoading && allowed && <LoadingRows rows={3} />}
      {people.isError && allowed && <ErrorState error={people.error} onRetry={() => people.refetch()} />}

      {allowed && !people.isLoading && rows.length === 0 && (
        <EmptyState
          title={'No administrator accounts'}
          body={'Create the first owner account to open the panel.'}
        />
      )}

      {rows.length > 0 && (
        <SectionCard
          title={'Accounts'}
          description={`${rows.length} row(s) read from the administrators table. Password hashes and tokens are not part of this API, so they cannot be displayed.`}
        >
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-surface-300 text-xs uppercase tracking-wide text-ink-mute">
                  <th className="py-2 pr-3 font-semibold">{'Administrator'}</th>
                  <th className="py-2 pr-3 font-semibold">{'Phone'}</th>
                  <th className="py-2 pr-3 font-semibold">{t('admin.role')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('admin.lastLogin')}</th>
                  <th className="py-2 font-semibold text-right">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-surface-200 align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink">{row.fullName}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            row.active
                              ? 'border-secondary-300 bg-secondary-100 text-primary-600'
                              : 'border-surface-300 bg-surface-200 text-ink-mute'
                          }`}
                        >
                          {row.active ? t('admin.active') : 'Disabled'}
                        </span>
                      </span>
                      <span className="block text-xs text-ink-mute">{row.email}</span>
                      <span className="block text-xs text-ink-mute">
                        {'created'} {formatDateTime(row.createdAt)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-ink-soft">{formatPhone(row.phone)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="text-ink">
                        {row.role === 'OWNER'
                          ? t('admin.roleOwner')
                          : row.role === 'MANAGER'
                            ? t('admin.roleManager')
                            : t('admin.roleCourier')}
                      </span>
                      <span className="block text-xs text-ink-mute">{row.role}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft">
                      {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'never'}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-quiet px-2 py-1"
                          onClick={() => startEdit(row)}
                          disabled={lockedOut}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          <span className="sr-only">{'Edit'}</span>
                        </button>
                        {confirmRevoke === row.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-danger px-2 py-1"
                              disabled={revoke.isPending}
                              onClick={() => revoke.mutate(row.id)}
                            >
                              <ShieldX className="size-3.5" aria-hidden />
                              {'Confirm revoke'}
                            </button>
                            <button type="button" className="btn-quiet px-2 py-1" onClick={() => setConfirmRevoke(null)}>
                              {t('admin.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1"
                            onClick={() => setConfirmRevoke(row.id)}
                            disabled={lockedOut}
                          >
                            {t('admin.revokeAccess')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {confirmRevoke !== null && (
            <p className="mt-3 text-xs text-ink-soft">
              {'Revoke access bumps the token version, which signs that administrator out of every browser and device. It does not delete the account, its role or any audit row - use the Active switch to stop future sign-ins.'}
            </p>
          )}

          {revoke.isError && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {revoke.error instanceof ApiError
                ? revoke.error.message
                : 'Revocation failed.'}
            </p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
