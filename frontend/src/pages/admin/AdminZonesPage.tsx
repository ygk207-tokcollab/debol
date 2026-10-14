import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Compass, Pencil, Plus, Power, TriangleAlert, X } from 'lucide-react';
import { KeyValue, SectionCard, TextField, ToggleField } from '../../components/form';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import { Price } from '../../components/Price';
import { adminSettings } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { fieldErrors, zoneSchema } from '../../lib/validation';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { DeliveryZone } from '../../lib/types';

interface ZoneFormValues {
  nameEn: string;
  region: string;
  city: string;
  subCity: string;
  fee: string;
  freeOver: string;
  estimatedDays: string;
  active: boolean;
}

const BLANK_ZONE: ZoneFormValues = {
  nameEn: '',
  region: '',
  city: '',
  subCity: '',
  fee: '',
  freeOver: '',
  estimatedDays: '2',
  active: true,
};

function fromZone(zone: DeliveryZone): ZoneFormValues {
  return {
    nameEn: zone.nameEn,
    region: zone.region,
    city: zone.city,
    subCity: zone.subCity ?? '',
    fee: String(zone.fee),
    freeOver: zone.freeOver == null ? '' : String(zone.freeOver),
    estimatedDays: zone.estimatedDays == null ? '2' : String(zone.estimatedDays),
    active: zone.active,
  };
}

export default function AdminZonesPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();

  // Zones are the manager's job on the server (ROLE_MANAGER), so the manager permission key
  // 'delivery_zones' counts too - not only the owner's 'settings'.
  const allowed = can('delivery_zones') || can(PERMISSION.settings);

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [values, setValues] = useState<ZoneFormValues>(BLANK_ZONE);
  const [errors, setErrors] = useState<Record<string, { message: string }>>({});
  const [confirmDisable, setConfirmDisable] = useState<number | null>(null);

  const zones = useQuery({
    queryKey: ['admin', 'zones'],
    queryFn: adminSettings.zones,
    enabled: allowed,
    retry: false,
  });

  useEffect(() => {
    if (editingId && editingId !== 'new') {
      const row = zones.data?.find((zone) => zone.id === editingId);
      if (row) setValues(fromZone(row));
    }
  }, [editingId, zones.data]);

  const save = useMutation({
    mutationFn: (payload: { id: number | null; body: Record<string, unknown> }) =>
      payload.id == null ? adminSettings.createZone(payload.body) : adminSettings.updateZone(payload.id, payload.body),
    onSuccess: (_result, payload) => {
      client.invalidateQueries({ queryKey: ['admin', 'zones'] });
      // Checkout quotes are priced from these rows, so the storefront copy must refetch too.
      client.invalidateQueries({ queryKey: ['store', 'zones'] });
      setEditingId(null);
      setErrors({});
      toast.push(
        payload.id == null
          ? 'Zone created and live at checkout.'
          : 'Zone updated.',
        'ok',
      );
    },
  });

  const flipActive = useMutation({
    /**
     * The server's PATCH /delivery-zones/{id} route takes `active` as a query parameter, while the
     * shared helper puts it in the JSON body - that combination is rejected, so the flip is sent as
     * a full PUT (same ZoneRequest the editor uses) and lands as ZONE_UPDATED in the audit trail.
     * The money fields go as the numbers the row already holds, never as form strings.
     */
    mutationFn: (zone: DeliveryZone) =>
      adminSettings.updateZone(zone.id, {
        nameEn: zone.nameEn,
        region: zone.region,
        city: zone.city,
        subCity: zone.subCity,
        fee: zone.fee,
        freeOver: zone.freeOver,
        estimatedDays: zone.estimatedDays ?? 2,
        active: !zone.active,
      }),
    onSuccess: (zone) => {
      client.invalidateQueries({ queryKey: ['admin', 'zones'] });
      client.invalidateQueries({ queryKey: ['store', 'zones'] });
      setConfirmDisable(null);
      toast.push(
        zone.active
          ? `${zone.nameEn} is chargeable again.`
          : `${zone.nameEn} no longer offered at checkout.`,
        'ok',
      );
    },
    onError: (error) => {
      toast.push(
        error instanceof ApiError ? error.message : 'The change failed.',
        'warn',
      );
    },
  });

  function set<K extends keyof ZoneFormValues>(key: K, next: ZoneFormValues[K]) {
    setValues((current) => ({ ...current, [key]: next }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = zoneSchema.safeParse({
      ...values,
      fee: values.fee.trim() === '' ? 0 : values.fee,
      freeOver: values.freeOver.trim() === '' ? null : values.freeOver,
      // ZoneRequest.estimatedDays is a non-null integer: blank means the server default, not null.
      estimatedDays: values.estimatedDays.trim() === '' ? 2 : values.estimatedDays,
      subCity: values.subCity.trim() === '' ? null : values.subCity,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate({
      id: editingId && editingId !== 'new' ? editingId : null,
      body: { ...parsed.data, estimatedDays: parsed.data.estimatedDays ?? 2 },
    });
  }

  const rows = zones.data ?? [];
  const activeCount = rows.filter((zone) => zone.active).length;
  const activeFees = rows.filter((zone) => zone.active).map((zone) => zone.fee);

  if (!allowed) {
    return (
      <SectionCard
        title={t('admin.deliveryZones')}
        description={'The zone routes need the manager or owner role on the server, so nothing is loaded for this account.'}
      >
        <div className="flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {'Ask a manager or owner to price a zone.'}
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{'Delivery pricing'}</p>
          <h1 className="font-display text-xl leading-tight text-ink">{t('admin.deliveryZones')}</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            {'A zone is matched by region, city and sub-city when the shopper checks out, and the fee below is what the server adds to the order. Nothing is totalled in the browser, so a change here is the next order’s price.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-surface-300 bg-surface-50 px-3 py-1.5 text-sm text-ink-soft">
            {`${activeCount} of ${rows.length} chargeable`}
          </span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setValues(BLANK_ZONE);
              setErrors({});
              setEditingId('new');
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t('admin.addZone')}
          </button>
        </div>
      </div>

      {zones.isError && <ErrorState error={zones.error} onRetry={() => zones.refetch()} />}

      {editingId !== null && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <SectionCard
            title={
              editingId === 'new'
                ? 'New delivery zone'
                : 'Edit delivery zone'
            }
            description={'Both names are required: shoppers see the one that matches their language.'}
            actions={
              <button type="button" className="btn-quiet" onClick={() => setEditingId(null)}>
                <X className="size-4" aria-hidden />
                {t('admin.cancel')}
              </button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={'Zone name'}
                name="nameEn"
                required
                value={values.nameEn}
                error={errors.nameEn?.message}
                onChange={(e) => set('nameEn', e.target.value)}
              />
              <TextField
                label={t('checkout.region')}
                name="region"
                required
                hint={'Matched exactly against the address the shopper types.'}
                value={values.region}
                error={errors.region?.message}
                onChange={(e) => set('region', e.target.value)}
              />
              <TextField
                label={t('checkout.city')}
                name="city"
                required
                value={values.city}
                error={errors.city?.message}
                onChange={(e) => set('city', e.target.value)}
              />
              <TextField
                label={t('checkout.subCity')}
                name="subCity"
                hint={'Leave blank to match the whole city.'}
                value={values.subCity}
                onChange={(e) => set('subCity', e.target.value)}
              />
              <TextField
                label={`Fee (${t('common.currency')})`}
                name="fee"
                inputMode="decimal"
                required
                hint={'Charged on every order in this zone unless freeOver covers it.'}
                value={values.fee}
                error={errors.fee?.message}
                onChange={(e) => set('fee', e.target.value)}
              />
              <TextField
                label={t('admin.freeOver')}
                name="freeOver"
                inputMode="decimal"
                hint={'Blank means this zone never ships free.'}
                value={values.freeOver}
                error={errors.freeOver?.message}
                onChange={(e) => set('freeOver', e.target.value)}
              />
              <TextField
                label={t('admin.estimatedDays')}
                name="estimatedDays"
                inputMode="numeric"
                hint={'Whole days; the server stores 2 when the box is empty.'}
                value={values.estimatedDays}
                error={errors.estimatedDays?.message}
                onChange={(e) => set('estimatedDays', e.target.value)}
              />
              <div className="sm:col-span-2">
                <ToggleField
                  label={t('admin.active')}
                  checked={values.active}
                  onChange={(next) => set('active', next)}
                  hint={'An inactive zone is hidden from checkout but stays on orders already delivered to it.'}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                <Check className="size-4" aria-hidden />
                {save.isPending ? t('admin.saving') : t('admin.save')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
                {t('admin.cancel')}
              </button>
            </div>

            {errors.form && <p className="mt-2 text-sm text-error-600">{errors.form.message}</p>}
            {save.isError && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {save.error instanceof ApiError
                  ? save.error.message
                  : 'The server refused this zone.'}
              </p>
            )}
          </SectionCard>
        </form>
      )}

      {flipActive.isError && (
        <p
          role="alert"
          className="rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
        >
          {flipActive.error instanceof ApiError
            ? flipActive.error.message
            : 'That zone could not be changed.'}
        </p>
      )}

      {zones.isLoading && <LoadingRows rows={4} />}

      {!zones.isLoading && rows.length === 0 && (
        <EmptyState
          title={'No delivery zones yet'}
          body={'Add at least one zone or checkout cannot price delivery anywhere.'}
        />
      )}

      {rows.length > 0 && (
        <SectionCard
          title={'Zone table'}
          description={'The API has no delete route for zones - only GET, POST, PUT and PATCH. A zone already used by an order must stay so the recorded fee keeps its meaning, and any delete attempt the server does receive comes back as its own error and is printed above this table, not swallowed here. Switching a zone off is how it leaves checkout.'}
        >
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-surface-300 text-xs uppercase tracking-wide text-ink-mute">
                  <th className="py-2 pr-3 font-semibold">{'Zone'}</th>
                  <th className="py-2 pr-3 font-semibold">{'Matches'}</th>
                  <th className="py-2 pr-3 font-semibold text-right">{t('admin.fee')}</th>
                  <th className="py-2 pr-3 font-semibold text-right">{t('admin.freeOver')}</th>
                  <th className="py-2 pr-3 font-semibold text-right">{t('admin.estimatedDays')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('admin.active')}</th>
                  <th className="py-2 font-semibold text-right">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((zone) => (
                  <tr key={zone.id} className="border-b border-surface-200 last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium text-ink">{zone.nameEn}</span>
                      <span className="block text-xs text-ink-mute">{`#${zone.id}`}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft">
                      {zone.region} / {zone.city}
                      {zone.subCity ? ` / ${zone.subCity}` : ''}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Price value={zone.fee} size="sm" />
                    </td>
                    <td className="py-2.5 pr-3 text-right text-ink-soft">
                      {zone.freeOver == null ? '—' : money(zone.freeOver)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-soft">
                      {zone.estimatedDays ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          zone.active
                            ? 'border-secondary-300 bg-secondary-100 text-primary-600'
                            : 'border-surface-300 bg-surface-200 text-ink-mute'
                        }`}
                      >
                        {zone.active ? t('admin.active') : t('admin.inactive')}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-quiet px-2 py-1"
                          onClick={() => {
                            setValues(fromZone(zone));
                            setErrors({});
                            setEditingId(zone.id);
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          <span className="sr-only">{'Edit zone'}</span>
                        </button>
                        {confirmDisable === zone.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-danger px-2 py-1"
                              disabled={flipActive.isPending}
                              onClick={() => flipActive.mutate(zone)}
                            >
                              {zone.active
                                ? 'Confirm off'
                                : 'Confirm on'}
                            </button>
                            <button type="button" className="btn-quiet px-2 py-1" onClick={() => setConfirmDisable(null)}>
                              {t('admin.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1"
                            onClick={() => setConfirmDisable(zone.id)}
                          >
                            <Power className="size-3.5" aria-hidden />
                            {zone.active ? t('admin.inactive') : t('admin.active')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <p className="rounded-md border border-surface-300 bg-surface-100 px-3 py-2 text-xs text-ink-soft">
              {'Free delivery is decided in this order: the zone fee applies, then the store-wide freeDeliveryOver threshold and the zone freeOver value can waive it. Only the server adds the numbers up.'}
            </p>
            <dl className="text-xs text-ink-soft">
              <KeyValue
                label={'Zones stored in PostgreSQL'}
                value={String(rows.length)}
                mono
              />
              <KeyValue
                label={'Cheapest active fee'}
                value={activeFees.length === 0 ? '—' : money(Math.min(...activeFees))}
                mono
              />
            </dl>
          </div>
        </SectionCard>
      )}

      <p className="flex items-start gap-2 px-1 text-xs text-ink-mute">
        <Compass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {'Shopper-facing zones come from the same rows: /api/v1/delivery-zones reads this table.'}
      </p>
    </div>
  );
}
