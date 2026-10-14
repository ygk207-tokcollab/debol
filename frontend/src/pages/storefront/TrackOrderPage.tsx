import { useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { accountApi, ApiError, ordersApi } from '../../lib/api';
import { useMyOrders } from '../../lib/queries';
import { useCustomerAuth } from '../../state/CustomerAuth';
import { useToast } from '../../state/Toast';
import { deliveryTimeKey, formatDate, formatDateTime, formatPhone } from '../../lib/format';
import { Price } from '../../components/Price';
import { StatusPill } from '../../components/StatusPill';
import { KeyValue, SectionCard, TextAreaField, TextField } from '../../components/form';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import type { OrderDetail } from '../../lib/types';

type Source = { kind: 'account'; id: number } | { kind: 'guest'; orderNumber: string; token: string };

const CANCELLABLE = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING'];

export default function TrackOrderPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { isSignedIn } = useCustomerAuth();
  const myOrders = useMyOrders(isSignedIn);
  const locState = useLocation().state as { orderNumber?: string; publicToken?: string; accountOrderId?: number } | null;
  const [params] = useSearchParams();
  const urlOrder = params.get('order');
  const urlToken = params.get('token');
  // A receipt link has to survive a refresh and being pasted into another device, so the query string
  // is preferred over router state.
  const fromUrl: Source | null = urlOrder && urlToken ? { kind: 'guest', orderNumber: urlOrder, token: urlToken } : null;

  const [source, setSource] = useState<Source | null>(() => {
    if (fromUrl) return fromUrl;
    if (locState?.accountOrderId != null) return { kind: 'account', id: locState.accountOrderId };
    if (locState?.orderNumber && locState?.publicToken) return { kind: 'guest', orderNumber: locState.orderNumber, token: locState.publicToken };
    return null;
  });
  const [guest, setGuest] = useState({ orderNumber: urlOrder ?? '', token: urlToken ?? '' });
  const [reason, setReason] = useState('');

  const detail = useQuery({
    queryKey: ['order-detail', source],
    queryFn: async (): Promise<OrderDetail> => {
      if (!source) throw new Error('no order selected');
      if (source.kind === 'account') return accountApi.order(source.id);
      const res = await ordersApi.track(source.orderNumber, source.token);
      return res.order;
    },
    enabled: Boolean(source),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: (vars: { id: number; reason: string }) => accountApi.requestCancellation(vars.id, vars.reason),
    onSuccess: () => {
      void detail.refetch();
      toast.push(t('order.cancelRequested'));
    },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? e.message : t('common.error'), 'warn'),
  });

  function submitGuest(event: FormEvent) {
    event.preventDefault();
    const orderNumber = guest.orderNumber.trim();
    const token = guest.token.trim();
    if (!orderNumber || !token) return;
    setReason('');
    setSource({ kind: 'guest', orderNumber, token });
  }

  const order = detail.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-ink">{t('order.track')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('order.trackHelp')}</p>
      </div>

      {isSignedIn && (
        <SectionCard title={t('account.yourOrders')}>
          {myOrders.isLoading && <LoadingRows rows={2} />}
          {myOrders.isError && <ErrorState error={myOrders.error} />}
          {myOrders.data && myOrders.data.length === 0 && <p className="text-sm text-ink-mute">{t('account.noOrders')}</p>}
          {myOrders.data && myOrders.data.length > 0 && (
            <ul className="divide-y divide-surface-200">
              {myOrders.data.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-primary-50"
                    onClick={() => { setReason(''); setSource({ kind: 'account', id: o.id }); }}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{o.orderNumber}</p>
                      <p className="text-xs text-ink-mute">
                        {formatDate(o.createdAt)} · {t('catalog.results', { count: o.itemCount })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill value={o.status} />
                      <Price value={o.totalAmount} currency={o.currency} size="sm" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard title={'Track with a receipt'}>
        <form onSubmit={submitGuest} className="space-y-4">
          <TextField
            label={t('order.number')}
            required
            value={guest.orderNumber}
            onChange={(e) => setGuest((g) => ({ ...g, orderNumber: e.target.value }))}
          />
          <TextField
            label={'Receipt token'}
            required
            value={guest.token}
            onChange={(e) => setGuest((g) => ({ ...g, token: e.target.value }))}
          />
          <button type="submit" className="btn-primary w-full">
            <Search className="size-4" aria-hidden />
            {t('order.trackNow')}
          </button>
        </form>
      </SectionCard>

      {source && detail.isPending && <LoadingRows rows={3} />}
      {source && detail.isError && <ErrorState error={detail.error} />}

      {!source && (
        <EmptyState
          title={t('order.track')}
          body={'Select one of your orders above, or enter an order number and receipt token.'}
        />
      )}

      {order && (
        <div className="space-y-5">
          <SectionCard title={order.orderNumber} actions={<StatusPill value={order.status} />}>
            <dl className="text-sm">
              <KeyValue label={t('order.placedAt')} value={formatDate(order.createdAt)} />
              <KeyValue label={t('order.status')} value={<StatusPill value={order.status} />} />
              <KeyValue label={t('order.paymentStatus')} value={<StatusPill value={order.paymentStatus} />} />
              {order.deliveryZoneName && (
                <KeyValue
                  label={t('checkout.zone')}
                  value={order.deliveryZoneName}
                />
              )}
              {order.estimatedDays != null && (
                <KeyValue
                  label={'Estimated delivery'}
                  value={t('checkout.eta', { count: order.estimatedDays })}
                />
              )}
            </dl>
          </SectionCard>

          <div className="card space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">{t('order.balanceDue')}</span>
              <Price value={order.balanceDue} currency={order.currency} size="lg" />
            </div>
            <p className="text-xs text-ink-mute">{t('checkout.codNote')}</p>
            <dl className="text-sm">
              <KeyValue label={t('cart.subtotal')} value={<Price value={order.subtotal} currency={order.currency} size="sm" />} />
              <KeyValue label={t('checkout.deliveryFee')} value={<Price value={order.deliveryFee} currency={order.currency} size="sm" />} />
              <KeyValue label={t('order.collected')} value={<Price value={order.amountCollected} currency={order.currency} size="sm" />} />
              <KeyValue label={t('checkout.total')} value={<Price value={order.totalAmount} currency={order.currency} size="sm" />} />
            </dl>
          </div>

          <SectionCard title={t('order.deliveryAddress')}>
            <p className="text-sm text-ink-soft">
              {[order.addressLine, order.neighborhood, order.subCity, order.city, order.region].filter(Boolean).join(', ')}
            </p>
            {order.deliveryInstructions && (
              <p className="mt-1 text-sm text-ink-mute">{order.deliveryInstructions}</p>
            )}
            {order.preferredDeliveryTime && (
              <p className="mt-1 text-sm text-ink-mute">
                {t('checkout.preferredTime')}: {t(deliveryTimeKey(order.preferredDeliveryTime))}
              </p>
            )}
            <p className="mt-1 text-sm text-ink-soft">
              {t('checkout.phone')}: {formatPhone(order.dialPhone)}
            </p>
            {order.courierName && (
              <p className="mt-1 text-sm text-ink-soft">
                {t('order.courier')}: {order.courierName}
                {order.courierPhone ? ` · ${formatPhone(order.courierPhone)}` : ''}
              </p>
            )}
          </SectionCard>

          <SectionCard title={t('order.items')}>
            <ul className="divide-y divide-surface-200">
              {order.items.map((item, index) => (
                <li key={`${item.productSlug ?? 'line'}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-ink">{item.productNameEn}</p>
                    <p className="text-xs text-ink-mute">
                      {item.sizeLabel}
                      {item.colorName ? ` · ${item.colorName}` : ''} · ×{item.quantity}
                    </p>
                  </div>
                  <Price value={item.lineTotal} currency={order.currency} size="sm" />
                </li>
              ))}
            </ul>
          </SectionCard>

          {order.history.length > 0 && (
            <SectionCard title={t('order.history')}>
              <ol className="space-y-3">
                {order.history.map((event, index) => (
                  <li key={index} className="flex gap-3">
                    <div className="mt-1 flex flex-col items-center">
                      <span className="size-2.5 rounded-full bg-primary-500" aria-hidden />
                      {index < order.history.length - 1 && <span className="mt-1 w-px flex-1 bg-surface-300" aria-hidden />}
                    </div>
                    <div className="min-w-0 pb-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill value={event.toStatus} />
                        <span className="text-xs text-ink-mute">{formatDateTime(event.at)}</span>
                      </div>
                      {event.note && <p className="mt-0.5 text-sm text-ink-soft">{event.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          {source?.kind === 'account' && (
            <SectionCard title={t('order.requestCancel')}>
              {order.cancelRequested ? (
                <p className="rounded-md border border-secondary-300 bg-secondary-100 px-3 py-2 text-sm text-primary-600">
                  {t('order.cancelRequested')}
                </p>
              ) : CANCELLABLE.includes(order.status) ? (
                <div className="space-y-3">
                  <TextAreaField
                    label={t('order.cancelReason')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={!reason.trim() || cancel.isPending}
                    onClick={() => cancel.mutate({ id: order.id, reason: reason.trim() })}
                  >
                    {cancel.isPending ? t('common.loading') : t('order.requestCancel')}
                  </button>
                  {cancel.isError && (
                    <p className="text-sm text-error-600">
                      {cancel.error instanceof ApiError ? cancel.error.message : t('common.error')}
                    </p>
                  )}
                  <p className="text-xs text-ink-mute">
                    {'Sending a request does not cancel the order by itself — the store confirms it.'}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-soft">{t('order.cancelNotAllowed', { phone: formatPhone(order.dialPhone) })}</p>
              )}
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
