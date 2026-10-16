import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { LogOut, Plus, Trash2 } from 'lucide-react';
import { accountApi, ApiError } from '../../lib/api';
import { keys, useAddresses, useMyOrders } from '../../lib/queries';
import {
  addressSchema,
  normalizeEthiopianPhone,
  optionalPhone,
  phone as phoneField,
} from '../../lib/validation';
import { useCustomerAuth } from '../../state/CustomerAuth';
import { useToast } from '../../state/Toast';
import { formatDate } from '../../lib/format';
import { Price } from '../../components/Price';
import { StatusPill } from '../../components/StatusPill';
import { SectionCard, TextAreaField, TextField } from '../../components/form';
import { EmptyState, LoadingRows } from '../../components/PageState';
import type { CustomerProfile } from '../../lib/types';

const profileSchema = z.object({
  fullName: z.string().trim().min(3, 'Please give your full name.'),
  phone: phoneField,
  secondaryPhone: optionalPhone,
});
type ProfileForm = z.infer<typeof profileSchema>;
type AddressForm = z.infer<typeof addressSchema>;

export default function AccountPage() {
  const { t } = useTranslation();
  const { profile, isSignedIn, busy, error: authError, signInByPhone, signOut, refreshProfile } = useCustomerAuth();

  if (!isSignedIn || !profile) {
    return <SignInForm busy={busy} authError={authError} onSubmit={signInByPhone} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl text-ink">{t('account.profile')}</h1>
        <button type="button" className="btn-quiet" onClick={() => void signOut()}>
          <LogOut className="size-4" aria-hidden />
          {t('account.signOut')}
        </button>
      </div>

      <ProfileCard profile={profile} onSaved={refreshProfile} />
      <AddressesSection />
      <OrdersSection />
    </div>
  );
}

function SignInForm({
  busy,
  authError,
  onSubmit,
}: {
  busy: boolean;
  authError: string | null;
  onSubmit: (input: { phone: string; orderNumber?: string; publicToken?: string }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [publicToken, setPublicToken] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeEthiopianPhone(phone);
    if (!normalized) {
      setLocalError(t('checkout.phoneHint'));
      return;
    }
    setLocalError(null);
    await onSubmit({
      phone: normalized,
      orderNumber: orderNumber.trim() || undefined,
      publicToken: publicToken.trim() || undefined,
    });
  }

  const message = localError ?? authError;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl text-ink">{t('account.signIn')}</h1>
      <SectionCard title={t('account.phoneSignIn')} description={t('account.phoneSignInHelp')}>
        <form onSubmit={submit} className="space-y-4">
          <TextField
            label={t('checkout.phone')}
            required
            inputMode="tel"
            placeholder="0912345678"
            hint={t('checkout.phoneHint')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField label={t('order.number')} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          <TextField
            label={'Receipt token'}
            value={publicToken}
            onChange={(e) => setPublicToken(e.target.value)}
          />

          {message && (
            <p className="rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">{message}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t('common.loading') : t('account.signIn')}
          </button>
          <p className="text-center text-xs text-ink-mute">
            <Link to="/track" className="text-primary-600 hover:underline">
              {t('order.track')}
            </Link>
          </p>
        </form>
      </SectionCard>
    </div>
  );
}

function ProfileCard({ profile, onSaved }: { profile: CustomerProfile; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: '', phone: '', secondaryPhone: '' },
  });

  useEffect(() => {
    reset({ fullName: profile.fullName, phone: profile.phone, secondaryPhone: profile.secondaryPhone ?? '' });
  }, [profile, reset]);

  const save = useMutation({
    mutationFn: (values: ProfileForm) => {
      const normalized = normalizeEthiopianPhone(values.phone) ?? values.phone;
      const secondary = values.secondaryPhone ? normalizeEthiopianPhone(values.secondaryPhone) : null;
      return accountApi.saveProfile({
        fullName: values.fullName.trim(),
        phone: normalized,
        secondaryPhone: secondary,
      });
    },
    onSuccess: () => {
      void onSaved();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.fields.length > 0) {
        for (const f of e.fields) setError(f.field as 'fullName' | 'phone' | 'secondaryPhone', { message: f.message });
      }
    },
  });

  function normalizeOnBlur(name: 'phone' | 'secondaryPhone') {
    const raw = getValues(name);
    if (!raw) return;
    const n = normalizeEthiopianPhone(raw);
    if (n) setValue(name, n);
  }

  return (
    <SectionCard
      title={t('account.profile')}
      actions={save.isSuccess ? <span className="text-xs text-primary-600">{t('admin.saved')}</span> : undefined}
    >
      <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4">
        <TextField label={t('checkout.fullName')} required error={errors.fullName?.message} {...register('fullName')} />
        <TextField
          label={t('checkout.phone')}
          required
          inputMode="tel"
          hint={t('checkout.phoneHint')}
          error={errors.phone?.message}
          {...register('phone')}
          onBlur={() => normalizeOnBlur('phone')}
        />
        <TextField
          label={t('checkout.secondaryPhone')}
          inputMode="tel"
          error={errors.secondaryPhone?.message}
          {...register('secondaryPhone')}
          onBlur={() => normalizeOnBlur('secondaryPhone')}
        />

        <div className="rounded-md border border-surface-300 bg-surface-100 px-3 py-2 text-sm text-ink-soft">
          {'Telegram'}:{' '}
          {profile.telegramLinked ? (
            <span className="text-primary-600">{t('account.telegramLinked')}</span>
          ) : (
            <span className="text-ink-mute">{t('account.telegramNotLinked')}</span>
          )}
        </div>

        {save.isError && (
          <p className="text-sm text-error-600">
            {save.error instanceof ApiError ? save.error.message : t('common.error')}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? t('admin.saving') : t('admin.save')}
        </button>
      </form>
    </SectionCard>
  );
}
function AddressesSection() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const { data: addresses, isLoading } = useAddresses(true);
  const [adding, setAdding] = useState(false);

  const remove = useMutation({
    mutationFn: (id: number) => accountApi.deleteAddress(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.addresses });
      toast.push('Address removed');
    },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? e.message : t('common.error'), 'warn'),
  });

  return (
    <SectionCard
      title={t('account.addresses')}
      actions={
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-3.5" aria-hidden />
          {t('account.addAddress')}
        </button>
      }
    >
      {isLoading && <LoadingRows rows={2} />}
      {!isLoading && addresses && addresses.length === 0 && (
        <p className="text-sm text-ink-mute">{t('account.noAddresses')}</p>
      )}
      {addresses && addresses.length > 0 && (
        <ul className="divide-y divide-surface-200">
          {addresses.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {a.label ? `${a.label} · ` : ''}
                  {a.isDefault && <span className="text-xs text-primary-600">({t('account.defaultAddress')})</span>}
                </p>
                <p className="text-sm text-ink-soft">
                  {[a.addressLine, a.neighborhood, a.subCity, a.city, a.region].filter(Boolean).join(', ')}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-ink-mute transition-colors hover:text-error-600"
                onClick={() => remove.mutate(a.id)}
                disabled={remove.isPending}
                aria-label={t('account.deleteAddress')}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddAddressForm
          onDone={() => {
            setAdding(false);
            client.invalidateQueries({ queryKey: keys.addresses });
          }}
        />
      )}
    </SectionCard>
  );
}

function AddAddressForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      region: '',
      city: '',
      subCity: '',
      neighborhood: '',
      addressLine: '',
      deliveryInstructions: '',
      label: '',
    },
  });

  const add = useMutation({
    mutationFn: (values: AddressForm) =>
      accountApi.addAddress({
        label: values.label?.trim() || null,
        region: values.region.trim(),
        city: values.city.trim(),
        subCity: values.subCity?.trim() || null,
        neighborhood: values.neighborhood?.trim() || null,
        addressLine: values.addressLine.trim(),
        instructions: values.deliveryInstructions?.trim() || null,
      }),
    onSuccess: () => onDone(),
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.fields.length > 0) {
        for (const f of e.fields) setError(f.field as keyof AddressForm, { message: f.message });
      } else {
        toast.push(e instanceof ApiError ? e.message : t('common.error'), 'warn');
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => add.mutate(values))} className="mt-4 space-y-4 border-t border-surface-200 pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('checkout.region')} required error={errors.region?.message} {...register('region')} />
        <TextField label={t('checkout.city')} required error={errors.city?.message} {...register('city')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('checkout.subCity')} error={errors.subCity?.message} {...register('subCity')} />
        <TextField label={'Label'} error={errors.label?.message} {...register('label')} />
      </div>
      <TextField label={t('checkout.neighborhood')} error={errors.neighborhood?.message} {...register('neighborhood')} />
      <TextField label={t('checkout.addressLine')} required error={errors.addressLine?.message} {...register('addressLine')} />
      <TextAreaField label={t('checkout.instructions')} error={errors.deliveryInstructions?.message} {...register('deliveryInstructions')} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={add.isPending}>
          {add.isPending ? t('admin.saving') : t('account.saveAddress')}
        </button>
        <button type="button" className="btn-quiet" onClick={onDone}>
          {t('admin.cancel')}
        </button>
      </div>
    </form>
  );
}

function OrdersSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: orders, isLoading } = useMyOrders(true);

  return (
    <SectionCard title={t('account.yourOrders')}>
      {isLoading && <LoadingRows rows={2} />}
      {!isLoading && orders && orders.length === 0 && (
        <EmptyState
          title={t('account.noOrders')}
          action={
            <Link to="/products" className="btn-primary">
              {t('cart.startShopping')}
            </Link>
          }
        />
      )}
      {orders && orders.length > 0 && (
        <ul className="divide-y divide-surface-200">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{o.orderNumber}</p>
                <p className="text-xs text-ink-mute">
                  {formatDate(o.createdAt)} · {'Cash on delivery'}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <StatusPill value={o.status} />
                  <StatusPill value={o.paymentStatus} />
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Price value={o.totalAmount} currency={o.currency} size="sm" />
                <button
                  type="button"
                  className="text-sm text-primary-600 hover:underline"
                  onClick={() => navigate('/track', { state: { accountOrderId: o.id } })}
                >
                  {t('order.track')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
