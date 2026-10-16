import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, Truck, XCircle, Bell, CircleDollarSign } from 'lucide-react';
import { adminOrders } from '../../lib/adminApi';
import { ApiError } from '../../lib/api';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import { StatusPill } from '../../components/StatusPill';
import { ErrorState, LoadingRows } from '../../components/PageState';
import { KeyValue, SectionCard, TextAreaField, TextField } from '../../components/form';
import { money, formatPhone, formatDateTime, titleCase, deliveryTimeKey } from '../../lib/format';
import type { OrderDetail } from '../../lib/types';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'request failed');

function canCancel(order: OrderDetail): boolean {
  return order.status !== 'DELIVERED' && order.status !== 'CANCELLED';
}

export default function AdminOrderDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const id = Number(params.id);
  const client = useQueryClient();
  const toast = useToast();
  const { can, session } = useAdminAuth();

  const order = useQuery({
    queryKey: ['admin', 'orders', 'detail', id],
    queryFn: () => adminOrders.get(id),
    enabled: Number.isFinite(id),
  });

  const editable = can(PERMISSION.orders);
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ['admin', 'orders'] });
  };

  // --- Status transitions: buttons are built from order.allowedStatuses, the server's legal moves.
  const [note, setNote] = useState('');
  const transition = useMutation({
    mutationFn: (target: string) => adminOrders.transition(id, target, note.trim() || undefined),
    onSuccess: (res) => {
      invalidate();
      setNote('');
      toast.push(`Status set to ${titleCase(res.status)}`);
    },
  });

  // --- Cash collection: the ONLY path to PAID. Sent amount defaults to the full balance when blank.
  const [cashAmount, setCashAmount] = useState('');
  const [cashNote, setCashNote] = useState('');
  const collectCash = useMutation({
    mutationFn: () => {
      const amount = cashAmount.trim() === '' ? undefined : Number(cashAmount);
      return adminOrders.collectCash(id, {
        amount: Number.isFinite(amount as number) ? amount : undefined,
        collectedBy: session?.email ?? undefined,
        note: cashNote.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      invalidate();
      setCashAmount('');
      setCashNote('');
      toast.push(`Cash recorded · ${money(res.amountCollected, order.data?.currency)} (${res.paymentStatus})`, 'ok');
    },
    onError: (e) => toast.push(errText(e), 'warn'),
  });

  // --- Cancellation: reports whether stock was restored, straight from the server response.
  const [cancelReason, setCancelReason] = useState('');
  const [restoreStock, setRestoreStock] = useState(true);
  const cancel = useMutation({
    mutationFn: () => adminOrders.cancel(id, cancelReason.trim(), restoreStock),
    onSuccess: (res) => {
      invalidate();
      setCancelReason('');
      toast.push(
        res.stockRestored
          ? 'Order cancelled — stock returned to inventory.'
          : 'Order cancelled — stock was NOT returned.',
        res.stockRestored ? 'ok' : 'warn',
      );
    },
    onError: (e) => toast.push(errText(e), 'warn'),
  });

  // --- Courier assignment via the dedicated endpoint.
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const courier = useMutation({
    mutationFn: () => adminOrders.assignCourier(id, {
      courierName: courierName.trim() || undefined,
      courierPhone: courierPhone.trim() || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setCourierName('');
      setCourierPhone('');
      toast.push('Courier assigned.');
    },
    onError: (e) => toast.push(errText(e), 'warn'),
  });

  // --- Notification retry for THIS order; reports the actual retried count.
  const retryNotes = useMutation({
    mutationFn: () => adminOrders.retryNotifications(id),
    onSuccess: (res) => {
      invalidate();
      toast.push(
        res.retried > 0
          ? `${res.retried} notification(s) re-queued for delivery.`
          : 'No notifications were due for retry.',
        res.retried > 0 ? 'ok' : 'warn',
      );
    },
    onError: (e) => toast.push(errText(e), 'warn'),
  });

  if (!Number.isFinite(id)) {
    return <ErrorState error={new Error('Unknown order id.')} />;
  }
  if (order.isLoading) return <LoadingRows rows={8} />;
  if (order.error || !order.data) {
    return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  }

  const o = order.data;
  const currency = o.currency;
  const failedNotes = (o.notifications ?? []).filter((n) => n.status !== 'SENT' && n.status !== 'SENDING');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/admin/orders" className="btn-quiet inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden /> {t('nav.back')}
        </Link>
        <h1 className="font-display text-xl text-ink">{o.orderNumber}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill value={o.status} />
        <StatusPill value={o.paymentStatus} />
        {o.cancelRequested && (
          <span className="inline-flex items-center rounded-full border border-error-300/60 bg-error-100 px-2.5 py-0.5 text-xs font-medium text-error-600">
            {'Customer requested cancellation'}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Line items with unit prices and variant detail (size + colour). */}
          <SectionCard title={t('order.items')}>
            <ul className="divide-y divide-surface-200">
              {o.items.map((it, index) => (
                <li key={`${it.variantId ?? 'x'}-${index}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{it.productNameEn}</p>
                    <p className="mt-0.5 text-xs text-ink-mute">
                      {'Size'}: {it.sizeLabel} · {'Colour'}: {it.colorName}
                      {it.variantId == null && ` · ${'variant removed'}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className="text-ink">{it.quantity} × {money(it.unitPrice, currency)}</p>
                    <p className="text-xs text-ink-mute">{money(it.lineTotal, currency)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* Totals — money only through money(); balance due shown until cash is recorded. */}
          <SectionCard title={'Payment'}>
            <dl>
              <KeyValue label={t('cart.subtotal')} value={money(o.subtotal, currency)} mono />
              <KeyValue label={t('checkout.deliveryFee')} value={money(o.deliveryFee, currency)} mono />
              {o.discountAmount > 0 && (
                <KeyValue label={'Discount'} value={money(-o.discountAmount, currency)} mono />
              )}
              <KeyValue label={t('checkout.total')} value={money(o.totalAmount, currency)} mono />
              <KeyValue label={t('order.collected')} value={money(o.amountCollected, currency)} mono />
              {o.paymentStatus !== 'PAID' ? (
                <KeyValue
                  label={t('order.balanceDue')}
                  value={<span className="font-semibold text-error-600">{money(o.balanceDue, currency)}</span>}
                  mono
                />
              ) : (
                <KeyValue
                  label={t('order.paid')}
                  value={
                    <span>
                      {t('order.paid')} · {formatDateTime(o.paymentCollectedAt)}
                      {o.paymentCollectedBy ? ` · ${o.paymentCollectedBy}` : ''}
                    </span>
                  }
                />
              )}
            </dl>
          </SectionCard>

          {/* Status history timeline. */}
          <SectionCard title={t('order.history')}>
            {o.history.length === 0 ? (
              <p className="text-sm text-ink-mute">{t('admin.noResults')}</p>
            ) : (
              <ol className="space-y-3">
                {o.history.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-secondary-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {h.fromStatus ? `${t(`status.${h.fromStatus}`, titleCase(h.fromStatus))} → ` : ''}
                        <b>{t(`status.${h.toStatus}`, titleCase(h.toStatus))}</b>
                      </p>
                      <p className="text-xs text-ink-mute">
                        {formatDateTime(h.at)} · {h.actor ? `${titleCase(h.actorType)}: ${h.actor}` : titleCase(h.actorType)}
                      </p>
                      {h.note && <p className="mt-0.5 text-xs text-ink-soft">{h.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        {/* Right column: delivery info + operational controls. */}
        <div className="space-y-4">
          <SectionCard title={t('order.deliveryAddress')}>
            <dl className="space-y-1 text-sm">
              <p className="font-medium text-ink">{o.customerName}</p>
              <p className="text-ink-soft">{o.addressLine}</p>
              <p className="text-ink-soft">
                {[o.neighborhood, o.subCity, o.city, o.region].filter(Boolean).join(', ')}
              </p>
              <p className="flex items-center gap-1.5 pt-1 text-ink">
                <Phone className="size-3.5 text-ink-mute" aria-hidden /> {formatPhone(o.dialPhone)}
              </p>
              {o.secondaryPhone && <p className="text-ink-soft">{'Alt'}: {formatPhone(o.secondaryPhone)}</p>}
              {o.deliveryZoneName && (
                <p className="text-xs text-ink-mute">
                  {t('checkout.zone')}: {o.deliveryZoneName}
                  {o.estimatedDays != null && ` · ${t('checkout.eta', { count: o.estimatedDays })}`}
                </p>
              )}
              {o.deliveryInstructions && <p className="pt-1 text-sm text-ink-soft">{o.deliveryInstructions}</p>}
              {o.preferredDeliveryTime && (
                <p className="text-sm text-ink-soft">{t('checkout.preferredTime')}: {t(deliveryTimeKey(o.preferredDeliveryTime))}</p>
              )}
            </dl>
          </SectionCard>

          {editable ? (
            <>
              {/* Transition buttons — rendered from allowedStatuses, never a hardcoded list. */}
              <SectionCard title={t('admin.updateStatus')}>
                {o.allowedStatuses.length === 0 ? (
                  <p className="text-sm text-ink-mute">{'No further status changes are allowed.'}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {o.allowedStatuses.map((target) => (
                      <button
                        key={target}
                        type="button"
                        className={target === 'CANCELLED' ? 'btn-danger' : 'btn-primary'}
                        disabled={transition.isPending}
                        onClick={() => transition.mutate(target)}
                      >
                        {t(`status.${target}`, titleCase(target))}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <TextAreaField
                    label={t('admin.noteOptional')}
                    name="statusNote"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                {/* A backward or illegal move returns 409 — the server message is surfaced verbatim. */}
                {transition.error && (
                  <p className="mt-2 text-sm text-error-600">{errText(transition.error)}</p>
                )}
              </SectionCard>

              {/* Cash collection — the only way an order becomes PAID. */}
              {o.paymentStatus !== 'PAID' && (
                <SectionCard title={t('admin.collectCash')} description={t('admin.cashHelp')}>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => { e.preventDefault(); collectCash.mutate(); }}
                  >
                    <TextField
                      label={t('admin.amountCollected')}
                      name="cashAmount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder={money(o.balanceDue, currency)}
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                    />
                    <TextField
                      label={t('admin.noteOptional')}
                      name="cashNote"
                      value={cashNote}
                      onChange={(e) => setCashNote(e.target.value)}
                    />
                    <button type="submit" className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={collectCash.isPending}>
                      <CircleDollarSign className="size-4" aria-hidden />
                      {'Confirm cash collected'}
                    </button>
                    {collectCash.error && <p className="text-sm text-error-600">{errText(collectCash.error)}</p>}
                  </form>
                </SectionCard>
              )}

              {/* Courier assignment. */}
              <SectionCard title={t('admin.assignCourier')}
                description={o.courierName ? `${o.courierName}${o.courierPhone ? ` · ${formatPhone(o.courierPhone)}` : ''}` : undefined}>
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); courier.mutate(); }}>
                  <TextField
                    label={t('admin.courierName')}
                    name="courierName"
                    value={courierName}
                    onChange={(e) => setCourierName(e.target.value)}
                  />
                  <TextField
                    label={t('admin.courierPhone')}
                    name="courierPhone"
                    type="tel"
                    value={courierPhone}
                    onChange={(e) => setCourierPhone(e.target.value)}
                  />
                  <button type="submit" className="btn-secondary inline-flex w-full items-center justify-center gap-2" disabled={courier.isPending}>
                    <Truck className="size-4" aria-hidden /> {t('admin.assignCourier')}
                  </button>
                  {courier.error && <p className="text-sm text-error-600">{errText(courier.error)}</p>}
                </form>
              </SectionCard>

              {/* Cancellation with explicit stock-restore choice. */}
              {canCancel(o) && (
                <SectionCard title={t('admin.cancelOrder')}>
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); cancel.mutate(); }}>
                    <TextAreaField
                      label={t('order.cancelReason')}
                      name="cancelReason"
                      rows={2}
                      required
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" className="size-4 accent-primary-500" checked={restoreStock} onChange={(e) => setRestoreStock(e.target.checked)} />
                      {t('admin.restoreStock')}
                    </label>
                    <button type="submit" className="btn-danger inline-flex w-full items-center justify-center gap-2" disabled={cancel.isPending || cancelReason.trim() === ''}>
                      <XCircle className="size-4" aria-hidden /> {t('admin.cancelOrder')}
                    </button>
                    {cancel.error && <p className="text-sm text-error-600">{errText(cancel.error)}</p>}
                  </form>
                </SectionCard>
              )}
            </>
          ) : (
            <div className="card px-4 py-3 text-sm text-ink-mute">
              {'Your role can view orders but not change them.'}
            </div>
          )}

          {/* Notification delivery for THIS order — never pretend it was delivered. */}
          <SectionCard title={t('admin.notifications')}>
            {o.notifications == null ? (
              <p className="text-sm text-ink-mute">{'Notification history not available for this account.'}</p>
            ) : o.notifications.length === 0 ? (
              <p className="text-sm text-ink-mute">{'No notifications for this order.'}</p>
            ) : (
              <ul className="space-y-2">
                {o.notifications.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 border-b border-surface-200 py-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{titleCase(n.eventType)}</p>
                      <p className="text-xs text-ink-mute">
                        {'Attempts'}: {n.attempts}
                        {n.sentAt && ` · ${formatDateTime(n.sentAt)}`}
                      </p>
                      {n.status !== 'SENT' && n.lastError && (
                        <p className="mt-0.5 text-xs text-error-600">{t('admin.lastError')}: {n.lastError}</p>
                      )}
                    </div>
                    <StatusPill value={n.status} />
                  </li>
                ))}
              </ul>
            )}
            {editable && failedNotes.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  className="btn-secondary inline-flex w-full items-center justify-center gap-2"
                  disabled={retryNotes.isPending}
                  onClick={() => retryNotes.mutate()}
                >
                  <Bell className="size-4" aria-hidden /> {'Retry this order’s notifications'}
                </button>
                {retryNotes.error && <p className="mt-2 text-sm text-error-600">{errText(retryNotes.error)}</p>}
              </div>
            )}
          </SectionCard>

          {o.cancellationReason && (
            <div className="card border-error-300/60 bg-error-100/40 px-4 py-3 text-sm">
              <p className="font-medium text-error-600">{t('order.cancelReason')}</p>
              <p className="text-ink-soft">{o.cancellationReason}</p>
              <p className="mt-1 text-xs text-ink-mute">
                {'Stock restored'}: {o.stockRestored ? t('common.yes') : t('common.no')}
                {o.cancelledAt && ` · ${formatDateTime(o.cancelledAt)}`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
