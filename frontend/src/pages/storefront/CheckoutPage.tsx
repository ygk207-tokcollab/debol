import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote } from 'lucide-react';
import { ApiError, accountApi } from '../../lib/api';
import {
  checkoutSchema,
  normalizeEthiopianPhone,
  type CheckoutForm,
} from '../../lib/validation';
import { useAddresses, useCart, useIdempotencyKey, usePlaceOrder, useQuote } from '../../lib/queries';
import { useCustomerAuth } from '../../state/CustomerAuth';
import { useToast } from '../../state/Toast';
import { deliveryTimeKey, formatPhone, money } from '../../lib/format';
import { Price } from '../../components/Price';
import { KeyValue, SectionCard, TextAreaField, TextField } from '../../components/form';
import { EmptyState, LoadingRows } from '../../components/PageState';

const TIME_WINDOWS = ['ANY', 'MORNING', 'AFTERNOON', 'EVENING'] as const;

export default function CheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { isSignedIn, profile } = useCustomerAuth();
  const { cart } = useCart();
  const { data: addresses } = useAddresses(isSignedIn);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    getValues,
    formState: { errors },
  } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      secondaryPhone: '',
      region: '',
      city: '',
      subCity: '',
      neighborhood: '',
      addressLine: '',
      deliveryInstructions: '',
      preferredDeliveryTime: 'ANY',
    },
  });

  const region = watch('region');
  const city = watch('city');
  const subCity = watch('subCity');

  // Totals are never computed here — they come only from the server quote for this area.
  const quote = useQuote({ region, city, subCity });
  const place = usePlaceOrder();

  // One stable idempotency key per attempt: retries of the same attempt reuse it, but a genuinely
  // different attempt (the total changed) gets a fresh key.
  const { key: idempotencyKey, reset: resetKey } = useIdempotencyKey('order');
  const lastTotal = useRef<number | null>(null);
  useEffect(() => {
    const total = quote.data?.total;
    if (total == null) return;
    if (lastTotal.current !== null && lastTotal.current !== total) resetKey();
    lastTotal.current = total;
  }, [quote.data?.total, resetKey]);

  // Prefill contact + a default saved address once, without clobbering what the shopper types.
  const prefilledContact = useRef(false);
  const prefilledAddress = useRef(false);
  useEffect(() => {
    if (prefilledContact.current || !profile) return;
    prefilledContact.current = true;
    setValue('fullName', profile.fullName);
    setValue('phone', profile.phone);
    if (profile.secondaryPhone) setValue('secondaryPhone', profile.secondaryPhone);
  }, [profile, setValue]);
  useEffect(() => {
    if (prefilledAddress.current || !addresses || addresses.length === 0) return;
    prefilledAddress.current = true;
    const a = addresses.find((x) => x.isDefault) ?? addresses[0];
    setValue('region', a.region);
    setValue('city', a.city);
    setValue('subCity', a.subCity ?? '');
    setValue('neighborhood', a.neighborhood ?? '');
    setValue('addressLine', a.addressLine);
    setValue('deliveryInstructions', a.instructions ?? '');
  }, [addresses, setValue]);

  const [saveAddress, setSaveAddress] = useState(false);

  function useSaved(addressId: number) {
    const a = addresses?.find((x) => x.id === addressId);
    if (!a) return;
    setValue('region', a.region);
    setValue('city', a.city);
    setValue('subCity', a.subCity ?? '');
    setValue('neighborhood', a.neighborhood ?? '');
    setValue('addressLine', a.addressLine);
    setValue('deliveryInstructions', a.instructions ?? '');
  }

  function normalizeOnBlur(name: 'phone' | 'secondaryPhone') {
    const raw = getValues(name);
    if (!raw) return;
    const normalized = normalizeEthiopianPhone(raw);
    if (normalized) setValue(name, normalized);
  }

  const needArea = region.trim().length < 2 || city.trim().length < 2;
  const quoteFailed = quote.isError;
  const quoteMessage = quote.error instanceof ApiError ? quote.error.message : t('checkout.quoteError');

  const canPlace = Boolean(quote.data) && !quoteFailed && Boolean(cart && cart.items.length > 0);

  function submit(data: CheckoutForm) {
    const q = quote.data;
    if (!q) {
      toast.push(quoteMessage, 'warn');
      return;
    }
    const phoneNorm = normalizeEthiopianPhone(data.phone);
    if (!phoneNorm) {
      setError('phone', { message: t('checkout.phoneHint') });
      return;
    }
    const secondaryNorm = data.secondaryPhone ? normalizeEthiopianPhone(data.secondaryPhone) : null;

    const body: Record<string, unknown> = {
      fullName: data.fullName.trim(),
      phone: phoneNorm,
      secondaryPhone: secondaryNorm,
      region: data.region.trim(),
      city: data.city.trim(),
      subCity: data.subCity?.trim() || null,
      neighborhood: data.neighborhood?.trim() || null,
      addressLine: data.addressLine.trim(),
      deliveryInstructions: data.deliveryInstructions?.trim() || null,
      preferredDeliveryTime: data.preferredDeliveryTime || null,
      paymentMethod: 'CASH_ON_DELIVERY',
      currency: q.currency,
      expectedTotal: q.total, // exact server total — the client never recomputes it
    };

    const addressSummary = [
      data.addressLine.trim(),
      data.neighborhood?.trim(),
      data.subCity?.trim(),
      data.city.trim(),
      data.region.trim(),
    ]
      .filter(Boolean)
      .join(', ');

    place.mutate(
      { body, idempotencyKey },
      {
        onSuccess: (res) => {
          if (isSignedIn && saveAddress) {
            accountApi
              .addAddress({
                region: body.region,
                city: body.city,
                subCity: body.subCity,
                neighborhood: body.neighborhood,
                addressLine: body.addressLine,
                instructions: body.deliveryInstructions,
              })
              .catch(() => undefined);
          }
          navigate(`/order/${res.orderNumber}`, {
            state: { publicToken: res.publicToken, order: res, address: addressSummary },
          });
        },
        onError: (e: unknown) => {
          if (e instanceof ApiError) {
            if (e.fields.length > 0) {
              for (const f of e.fields) setError(f.field as FieldPath<CheckoutForm>, { message: f.message });
            }
            toast.push(e.message, 'warn');
          } else {
            toast.push(t('common.error'), 'warn');
          }
        },
      },
    );
  }

  const emptyCart = cart && cart.items.length === 0;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl text-ink">{t('checkout.title')}</h1>

      {emptyCart ? (
        <EmptyState
          title={t('cart.empty')}
          action={
            <Link to="/products" className="btn-primary">
              {t('cart.startShopping')}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <form onSubmit={handleSubmit(submit)} className="space-y-5">
            <SectionCard title={t('checkout.contact')}>
              <div className="space-y-4">
                <TextField
                  label={t('checkout.fullName')}
                  required
                  autoComplete="name"
                  error={errors.fullName?.message}
                  {...register('fullName')}
                />
                <TextField
                  label={t('checkout.phone')}
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  hint={t('checkout.phoneHint')}
                  placeholder="0912345678"
                  error={errors.phone?.message}
                  {...register('phone')}
                  onBlur={() => normalizeOnBlur('phone')}
                  />
                <TextField
                  label={t('checkout.secondaryPhone')}
                  inputMode="tel"
                  placeholder="0712345678"
                  error={errors.secondaryPhone?.message}
                  {...register('secondaryPhone')}
                  onBlur={() => normalizeOnBlur('secondaryPhone')}
                />
              </div>
            </SectionCard>

            <SectionCard title={t('checkout.address')}>
              {addresses && addresses.length > 0 && (
                <div className="mb-4">
                  <p className="field-label">{t('checkout.savedAddresses')}</p>
                  <div className="flex flex-wrap gap-2">
                    {addresses.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs"
                        onClick={() => useSaved(a.id)}
                      >
                        {a.isDefault ? `${t('account.defaultAddress')} · ` : ''}
                        {[a.addressLine, a.subCity, a.city].filter(Boolean).join(', ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={t('checkout.region')}
                    required
                    error={errors.region?.message}
                    {...register('region')}
                  />
                  <TextField label={t('checkout.city')} required error={errors.city?.message} {...register('city')} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={t('checkout.subCity')} error={errors.subCity?.message} {...register('subCity')} />
                  <TextField
                    label={t('checkout.neighborhood')}
                    error={errors.neighborhood?.message}
                    {...register('neighborhood')}
                  />
                </div>
                <TextField
                  label={t('checkout.addressLine')}
                  required
                  error={errors.addressLine?.message}
                  {...register('addressLine')}
                />
                <TextAreaField
                  label={t('checkout.instructions')}
                  maxLength={400}
                  error={errors.deliveryInstructions?.message}
                  {...register('deliveryInstructions')}
                />
                <div>
                  <label className="field-label" htmlFor="preferredDeliveryTime">
                    {t('checkout.preferredTime')}
                  </label>
                  <select id="preferredDeliveryTime" className="field" {...register('preferredDeliveryTime')}>
                    {TIME_WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        {t(deliveryTimeKey(w))}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t('checkout.payment')}>
              <div className="flex items-start gap-3 rounded-md border border-primary-200 bg-primary-50 px-3 py-3">
                <Banknote className="mt-0.5 size-5 shrink-0 text-primary-600" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-ink">{t('checkout.cod')}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{t('checkout.codNote')}</p>
                </div>
              </div>
              {isSignedIn && (
                <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary-500"
                    checked={saveAddress}
                    onChange={(e) => setSaveAddress(e.target.checked)}
                  />
                  {t('account.saveAddress')}
                </label>
              )}
            </SectionCard>
          </form>

          <aside>
            <div className="card space-y-3 p-4 lg:sticky lg:top-20">
              <h2 className="font-display text-lg text-ink">{t('checkout.summary')}</h2>

              {needArea ? (
                <p className="text-sm text-ink-mute">
                  {'Enter your region and city to see the delivery fee and total.'}
                </p>
              ) : quoteFailed ? (
                <p className="rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
                  {quoteMessage}
                </p>
              ) : quote.isFetching ? (
                <LoadingRows rows={3} />
              ) : quote.data ? (
                <dl className="text-sm">
                  <KeyValue label={t('cart.subtotal')} value={money(quote.data.subtotal, quote.data.currency)} mono />
                  <KeyValue label={t('checkout.deliveryFee')} value={money(quote.data.deliveryFee, quote.data.currency)} mono />
                  {quote.data.zoneNameEn && (
                    <KeyValue label={t('checkout.zone')} value={quote.data.zoneNameEn} />
                  )}
                  {quote.data.estimatedDays != null && (
                    <KeyValue label={t('order.status')} value={t('checkout.eta', { count: quote.data.estimatedDays })} />
                  )}
                  <div className="mt-2 flex items-baseline justify-between border-t border-surface-200 pt-2">
                    <span className="text-sm font-medium text-ink">{t('checkout.total')}</span>
                    <Price value={quote.data.total} currency={quote.data.currency} size="lg" />
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-ink-mute">{t('checkout.quoteError')}</p>
              )}

              <p className="text-xs text-ink-mute">{t('checkout.codNote')}</p>

              <button type="button" className="btn-primary w-full" onClick={handleSubmit(submit)} disabled={!canPlace || place.isPending}>
                {place.isPending ? t('checkout.placing') : t('checkout.placeOrder')}
              </button>
              <Link to="/cart" className="btn-quiet w-full">
                {t('cart.title')}
              </Link>

              {isSignedIn && profile && (
                <p className="text-xs text-ink-mute">{t('account.signedInAs', { name: profile.fullName })}</p>
              )}
              {!isSignedIn && (
                <p className="text-xs text-ink-mute">
                  <Link to="/account" className="text-primary-600 hover:underline">
                    {t('account.signIn')}
                  </Link>{' '}
                  — {'track past orders and save addresses'}
                </p>
              )}

              {profile && (
                <p className="text-xs text-ink-mute">
                  {t('checkout.phone')}: {formatPhone(profile.phone)}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
