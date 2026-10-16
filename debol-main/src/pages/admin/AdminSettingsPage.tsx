import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Save, ShieldAlert } from 'lucide-react';
import { KeyValue, SectionCard, SelectField, TextAreaField, TextField, ToggleField } from '../../components/form';
import { ErrorState, LoadingRows } from '../../components/PageState';
import { Price } from '../../components/Price';
import { adminSettings } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { fieldErrors, normalizeEthiopianPhone, settingsSchema } from '../../lib/validation';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { StoreSettings } from '../../lib/types';

/**
 * The settings row the server actually returns (see AdminOpsService.settingsView): the shared
 * StoreSettings type does not yet name these extra columns, so they are re-declared here and passed
 * through untouched on save - a partial body would silently fall back to the server defaults.
 */
type SettingsPayload = StoreSettings & {
  logoUrl?: string | null;
  contactSecondaryPhone?: string | null;
  contactTelegramUsername?: string | null;
  miniAppUrl?: string | null;
  adminNotifyUrl?: string | null;
};

interface FormValues {
  storeNameEn: string;
  taglineEn: string;
  logoUrl: string;
  contactPhone: string;
  contactSecondaryPhone: string;
  contactEmail: string;
  contactTelegramUsername: string;
  miniAppUrl: string;
  adminNotifyUrl: string;
  botUsername: string;
  currency: string;
  lowStockThreshold: string;
  freeDeliveryOver: string;
  allowCustomerCancelUntil: string;
  restoreStockOnCancellation: boolean;
  requireAdminConfirmation: boolean;
  telegramEnabled: boolean;
}

const BLANK: FormValues = {
  storeNameEn: '',
  taglineEn: '',
  logoUrl: '',
  contactPhone: '',
  contactSecondaryPhone: '',
  contactEmail: '',
  contactTelegramUsername: '',
  miniAppUrl: '',
  adminNotifyUrl: '',
  botUsername: '',
  currency: 'ETB',
  lowStockThreshold: '3',
  freeDeliveryOver: '',
  allowCustomerCancelUntil: 'PROCESSING',
  restoreStockOnCancellation: true,
  requireAdminConfirmation: true,
  telegramEnabled: true,
};

function fromLoaded(loaded: SettingsPayload): FormValues {
  return {
    storeNameEn: loaded.storeNameEn ?? '',
    taglineEn: loaded.taglineEn ?? '',
    logoUrl: loaded.logoUrl ?? '',
    contactPhone: loaded.contactPhone ?? '',
    contactSecondaryPhone: loaded.contactSecondaryPhone ?? '',
    contactEmail: loaded.contactEmail ?? '',
    contactTelegramUsername: loaded.contactTelegramUsername ?? '',
    miniAppUrl: loaded.miniAppUrl ?? '',
    adminNotifyUrl: loaded.adminNotifyUrl ?? '',
    botUsername: loaded.botUsername ?? '',
    currency: loaded.currency ?? 'ETB',
    lowStockThreshold: String(loaded.lowStockThreshold ?? 3),
    freeDeliveryOver: loaded.freeDeliveryOver == null ? '' : String(loaded.freeDeliveryOver),
    allowCustomerCancelUntil: loaded.allowCustomerCancelUntil ?? 'PROCESSING',
    restoreStockOnCancellation: Boolean(loaded.restoreStockOnCancellation),
    requireAdminConfirmation: Boolean(loaded.requireAdminConfirmation),
    telegramEnabled: Boolean(loaded.telegramEnabled),
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();

  // /admin/settings is OWNER-only in SecurityConfig, so a manager never fires a doomed request.
  const allowed = can(PERMISSION.settings);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [errors, setErrors] = useState<Record<string, { message: string }>>({});
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminSettings.get,
    enabled: allowed,
    retry: false,
  });

  const loaded = settings.data as SettingsPayload | undefined;

  useEffect(() => {
    if (loaded && !dirty) setValues(fromLoaded(loaded));
  }, [loaded, dirty]);

  const save = useMutation({
    mutationFn: (payload: SettingsPayload) => adminSettings.save(payload),
    onSuccess: () => {
      // The row lives in PostgreSQL: refetch so the panel shows what the server actually stored.
      client.invalidateQueries({ queryKey: ['admin', 'settings'] });
      client.invalidateQueries({ queryKey: ['admin', 'telegram'] });
      client.invalidateQueries({ queryKey: ['store'] });
      setDirty(false);
      setErrors({});
      toast.push('Settings saved on the server.', 'ok');
    },
  });

  function set<K extends keyof FormValues>(key: K, next: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: next }));
    setDirty(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded) return;
    const parsed = settingsSchema.safeParse({
      storeNameEn: values.storeNameEn,
      taglineEn: values.taglineEn,
      contactPhone: values.contactPhone,
      contactEmail: values.contactEmail,
      currency: values.currency,
      lowStockThreshold: values.lowStockThreshold,
      // Blank must reach the server as null: a coerced 0 would mean "everything ships free".
      freeDeliveryOver: values.freeDeliveryOver.trim() === '' ? null : values.freeDeliveryOver,
      allowCustomerCancelUntil: values.allowCustomerCancelUntil,
      restoreStockOnCancellation: values.restoreStockOnCancellation,
      requireAdminConfirmation: values.requireAdminConfirmation,
      telegramEnabled: values.telegramEnabled,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    // settingsSchema covers the fields it knows; these three URLs are the extra columns the server
    // stores verbatim, so a malformed one is caught here instead of breaking the bot link later.
    const urlFields: (keyof FormValues)[] = ['logoUrl', 'miniAppUrl', 'adminNotifyUrl'];
    const urlErrors: Record<string, { message: string }> = {};
    urlFields.forEach((key) => {
      const raw = String(values[key] ?? '').trim();
      if (!raw) return;
      try {
        const candidate = new URL(raw);
        if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') {
          urlErrors[key] = { message: 'Use an http(s) address.' };
        }
      } catch {
        urlErrors[key] = { message: 'That is not a full address.' };
      }
    });
    // The server runs these two through EthiopianPhone.normalize and answers 400 "Invalid";
    // checking the same rule here tells the operator which box is wrong.
    if (!normalizeEthiopianPhone(values.contactPhone)) {
      urlErrors.contactPhone = { message: 'Use an Ethiopian mobile number, 09… or 07…' };
    }
    if (values.contactSecondaryPhone.trim() && !normalizeEthiopianPhone(values.contactSecondaryPhone)) {
      urlErrors.contactSecondaryPhone = { message: 'That secondary number is not a valid Ethiopian mobile.' };
    }
    if (Object.keys(urlErrors).length > 0) {
      setErrors(urlErrors);
      return;
    }
    setErrors({});
    const body: SettingsPayload = {
      ...loaded,
      ...parsed.data,
      allowCustomerCancelUntil: parsed.data.allowCustomerCancelUntil,
      taglineEn: values.taglineEn.trim(),
      logoUrl: values.logoUrl.trim() || null,
      contactSecondaryPhone: values.contactSecondaryPhone.trim() || null,
      contactTelegramUsername: values.contactTelegramUsername.trim() || null,
      miniAppUrl: values.miniAppUrl.trim() || null,
      adminNotifyUrl: values.adminNotifyUrl.trim() || null,
      botUsername: values.botUsername.trim() || null,
      freeDeliveryOver: parsed.data.freeDeliveryOver ?? null,
    };
    // updatedAt is a server column, never part of the request body.
    delete body.updatedAt;
    save.mutate(body);
  }

  const cancelOptions = useMemo(
    () => [
      { value: 'PENDING_CONFIRMATION', label: 'Until confirmed' },
      { value: 'CONFIRMED', label: 'Until processing starts' },
      { value: 'PROCESSING', label: 'Until packed / out for delivery' },
    ],
    [],
  );

  if (!allowed) {
    return (
      <SectionCard
        title={t('admin.settings')}
        description={'Store settings are OWNER-only on the server (/admin/settings requires the owner role), so this screen shows nothing for your account and no request is made.'}
      >
        <div className="flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {'Ask an owner to change these values.'}
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{'Store settings'}</p>
        <h1 className="font-display text-xl leading-tight text-ink">{t('admin.settings')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('admin.settingsHelp')}</p>
      </div>

      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.isLoading && <LoadingRows rows={6} />}

      {settings.data && loaded && (
        <>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <SectionCard
              title={'Identity'}
              description={'Shown on the home page, receipts and Telegram alerts.'}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('admin.storeNameEn')}
                  name="storeNameEn"
                  required
                  value={values.storeNameEn}
                  error={errors.storeNameEn?.message}
                  onChange={(e) => set('storeNameEn', e.target.value)}
                />
                <TextAreaField
                  label={t('admin.taglineEn')}
                  name="taglineEn"
                  rows={2}
                  value={values.taglineEn}
                  error={errors.taglineEn?.message}
                  onChange={(e) => set('taglineEn', e.target.value)}
                />
                <TextField
                  label={'Logo URL'}
                  name="logoUrl"
                  type="url"
                  placeholder="https://…"
                  value={values.logoUrl}
                  error={errors.logoUrl?.message}
                  onChange={(e) => set('logoUrl', e.target.value)}
                />
                <TextField
                  label={'Currency code'}
                  name="currency"
                  required
                  maxLength={3}
                  hint={'Three letters. The server uppercases it.'}
                  value={values.currency}
                  error={errors.currency?.message}
                  onChange={(e) => set('currency', e.target.value)}
                />
              </div>
            </SectionCard>

            <SectionCard
              title={'Contact'}
              description={'Ethiopian mobile numbers only (09… or 07…). The store is cash on delivery, so these are the numbers customers call.'}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('admin.contactPhone')}
                  name="contactPhone"
                  type="tel"
                  inputMode="tel"
                  required
                  hint={'Example 0911526922'}
                  value={values.contactPhone}
                  error={errors.contactPhone?.message}
                  onChange={(e) => set('contactPhone', e.target.value)}
                />
                <TextField
                  label={'Secondary contact phone'}
                  name="contactSecondaryPhone"
                  type="tel"
                  inputMode="tel"
                  value={values.contactSecondaryPhone}
                  error={errors.contactSecondaryPhone?.message}
                  onChange={(e) => set('contactSecondaryPhone', e.target.value)}
                />
                <TextField
                  label={t('admin.contactEmail')}
                  name="contactEmail"
                  type="email"
                  value={values.contactEmail}
                  error={errors.contactEmail?.message}
                  onChange={(e) => set('contactEmail', e.target.value)}
                />
                <TextField
                  label={'Contact Telegram username'}
                  name="contactTelegramUsername"
                  hint={'Without the @ sign.'}
                  value={values.contactTelegramUsername}
                  onChange={(e) => set('contactTelegramUsername', e.target.value)}
                />
              </div>
            </SectionCard>

            <SectionCard
              title={'Delivery and stock rules'}
              description={'freeDeliveryOver is compared against the cart subtotal in Ethiopian birr; zone fees still apply below it.'}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('admin.freeDeliveryOver')}
                  name="freeDeliveryOver"
                  inputMode="decimal"
                  hint={'Leave blank to always charge a delivery fee.'}
                  value={values.freeDeliveryOver}
                  error={errors.freeDeliveryOver?.message}
                  onChange={(e) => set('freeDeliveryOver', e.target.value)}
                />
                <TextField
                  label={t('admin.lowStockThreshold')}
                  name="lowStockThreshold"
                  inputMode="numeric"
                  required
                  hint={'Variants at or below this number raise a low-stock alert.'}
                  value={values.lowStockThreshold}
                  error={errors.lowStockThreshold?.message}
                  onChange={(e) => set('lowStockThreshold', e.target.value)}
                />
                <SelectField
                  label={t('admin.cancelUntil')}
                  name="allowCustomerCancelUntil"
                  value={values.allowCustomerCancelUntil}
                  error={errors.allowCustomerCancelUntil?.message}
                  onChange={(e) => set('allowCustomerCancelUntil', e.target.value)}
                  options={cancelOptions}
                />
                <div className="space-y-1 sm:col-span-2">
                  <ToggleField
                    label={t('admin.restoreOnCancel')}
                    checked={values.restoreStockOnCancellation}
                    onChange={(next) => set('restoreStockOnCancellation', next)}
                  />
                  <ToggleField
                    label={t('admin.requireConfirm')}
                    checked={values.requireAdminConfirmation}
                    onChange={(next) => set('requireAdminConfirmation', next)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={`${t('admin.telegram')} / ${t('admin.telegramSetup')}`}
              description={'Pairing, the bot token and the retry queue live on the notifications screen. This form never asks for a token: the bot token is only ever read from the server environment, so it cannot reach the browser, the source or a log.'}
              actions={
                <Link to="/admin/notifications" className="btn-quiet text-sm">
                  {t('admin.telegramSetup')}
                </Link>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={'Mini app URL'}
                  name="miniAppUrl"
                  type="url"
                  placeholder="https://…/"
                  hint={'The link the bot sends shoppers.'}
                  value={values.miniAppUrl}
                  error={errors.miniAppUrl?.message}
                  onChange={(e) => set('miniAppUrl', e.target.value)}
                />
                <TextField
                  label={'Admin panel URL'}
                  name="adminNotifyUrl"
                  type="url"
                  placeholder="https://…/admin"
                  hint={'Used for the “open in panel” buttons in Telegram.'}
                  value={values.adminNotifyUrl}
                  error={errors.adminNotifyUrl?.message}
                  onChange={(e) => set('adminNotifyUrl', e.target.value)}
                />
                <TextField
                  label={t('admin.botUsername')}
                  name="botUsername"
                  hint={'Display name only - the token is never edited here.'}
                  value={values.botUsername}
                  onChange={(e) => set('botUsername', e.target.value)}
                />
                <div className="sm:col-span-2">
                  <ToggleField
                    label={'Send order alerts to the administrator chat'}
                    checked={values.telegramEnabled}
                    onChange={(next) => set('telegramEnabled', next)}
                    hint={'Switching this off stops every outbound alert; queued rows stay in the outbox untouched.'}
                  />
                </div>
              </div>
            </SectionCard>

            <div className="card px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn-primary" disabled={save.isPending || !dirty}>
                  <Save className="size-4" aria-hidden />
                  {save.isPending ? t('admin.saving') : t('admin.save')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setValues(fromLoaded(loaded));
                    setErrors({});
                    setDirty(false);
                  }}
                  disabled={!dirty}
                >
                  {'Discard changes'}
                </button>
                {!dirty && (
                  <span className="text-xs text-ink-mute">
                    {'Nothing to save yet - the form matches the server.'}
                  </span>
                )}
              </div>
              {errors.form && <p className="mt-2 text-sm text-error-600">{errors.form.message}</p>}
              {save.isError && (
                <p
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
                >
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {errorText(save.error, 'The server refused the save.')}
                </p>
              )}
            </div>
          </form>

          <SectionCard
            title={'Stored on the server right now'}
            description={'Read back from /api/v1/admin/settings after each save, so this is the PostgreSQL row - not what the form holds.'}
          >
            <dl>
              <KeyValue
                label={'Store name'}
                value={loaded.storeNameEn}
              />
              <KeyValue label={'Logo URL'} value={loaded.logoUrl ?? 'not set'} />
              <KeyValue label={t('admin.contactPhone')} value={loaded.contactPhone} mono />
              <KeyValue
                label={'Secondary phone'}
                value={loaded.contactSecondaryPhone ?? 'not set'}
                mono
              />
              <KeyValue label={t('admin.contactEmail')} value={loaded.contactEmail || '—'} />
              <KeyValue
                label={'Telegram contact'}
                value={loaded.contactTelegramUsername ? `@${loaded.contactTelegramUsername}` : 'not set'}
              />
              <KeyValue
                label={t('admin.freeDeliveryOver')}
                value={
                  loaded.freeDeliveryOver == null
                    ? 'always charge'
                    : <Price value={loaded.freeDeliveryOver} currency={loaded.currency} size="sm" />
                }
              />
              <KeyValue label={t('admin.lowStockThreshold')} value={String(loaded.lowStockThreshold)} mono />
              <KeyValue label={t('admin.cancelUntil')} value={loaded.allowCustomerCancelUntil} />
              <KeyValue
                label={t('admin.restoreOnCancel')}
                value={loaded.restoreStockOnCancellation ? t('common.yes') : t('common.no')}
              />
              <KeyValue
                label={t('admin.requireConfirm')}
                value={loaded.requireAdminConfirmation ? t('common.yes') : t('common.no')}
              />
              <KeyValue label={'Mini app URL'} value={loaded.miniAppUrl ?? '—'} />
              <KeyValue
                label={'Admin panel URL'}
                value={loaded.adminNotifyUrl ?? '—'}
              />
              <KeyValue label={t('admin.botUsername')} value={loaded.botUsername ? `@${loaded.botUsername}` : '—'} />
              <KeyValue
                label={'Telegram alerts'}
                value={loaded.telegramEnabled ? t('common.yes') : t('common.no')}
              />
              <KeyValue
                label={'Last write'}
                value={formatDateTime(loaded.updatedAt)}
                mono
              />
            </dl>
          </SectionCard>
        </>
      )}
    </div>
  );
}
