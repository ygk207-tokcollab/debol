import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Receipt, Search, ShoppingBag } from 'lucide-react';
import type { OrderPlaced } from '../../lib/types';
import { Price } from '../../components/Price';
import { StatusPill } from '../../components/StatusPill';
import { KeyValue, SectionCard } from '../../components/form';

interface PlacedState {
  publicToken?: string;
  order?: OrderPlaced;
  address?: string;
}

export default function OrderPlacedPage() {
  const { t } = useTranslation();
  const params = useParams();
  const state = (useLocation().state ?? {}) as PlacedState;
  const order = state.order;

  // Opened directly (shared link, refresh) with no order in memory: be honest, don't invent one.
  if (!order) {
    return (
      <div className="space-y-5">
        <SectionCard title={t('order.number')}>
          <p className="text-sm text-ink-soft">
            {`We don't have the details of order ${params.orderNumber ?? ''} on this screen — it may have
               been placed in another session. Track it with your order number and receipt token, or open
               your account if you are signed in.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/track" className="btn-primary">
              <Search className="size-4" aria-hidden />
              {t('order.track')}
            </Link>
            <Link to="/account" className="btn-secondary">
              {t('nav.account')}
            </Link>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card flex items-start gap-3 border-primary-200 bg-primary-50 px-4 py-4">
        <Receipt className="mt-0.5 size-6 shrink-0 text-primary-600" aria-hidden />
        <div>
          <h1 className="font-display text-xl text-ink">{t('order.placed')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {'Pay the courier in cash when your order arrives — nothing is charged now.'}
          </p>
        </div>
      </div>

      {order.replayed && (
        <p className="rounded-md border border-secondary-300 bg-secondary-100 px-3 py-2 text-sm text-primary-600">
          {'This matches an order you already placed.'}
        </p>
      )}

      <SectionCard
        title={t('order.number')}
        actions={<StatusPill value={order.status} />}
      >
        <dl className="text-sm">
          <KeyValue label={t('order.number')} value={<span className="font-medium tabular-nums">{order.orderNumber}</span>} mono />
          <KeyValue label={t('order.paymentStatus')} value={<StatusPill value={order.paymentStatus} />} />
          <KeyValue label={'Payment method'} value={<StatusPill value={order.paymentMethod} />} />
        </dl>
      </SectionCard>

      <div className="card space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">{t('order.balanceDue')}</span>
          <Price value={order.totalAmount} currency={order.currency} size="lg" />
        </div>
        <p className="text-xs text-ink-mute">{t('checkout.codNote')}</p>
        <dl className="text-sm">
          <KeyValue label={t('cart.subtotal')} value={<Price value={order.subtotal} currency={order.currency} size="sm" />} />
          <KeyValue label={t('checkout.deliveryFee')} value={<Price value={order.deliveryFee} currency={order.currency} size="sm" />} />
        </dl>
      </div>

      <SectionCard title={t('order.items')}>
        <ul className="divide-y divide-surface-200">
          {order.items.map((item) => (
            <li key={item.variantId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate text-ink">{item.nameEn}</p>
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

      {state.address && (
        <SectionCard title={t('order.deliveryAddress')}>
          <p className="text-sm text-ink-soft">{state.address}</p>
        </SectionCard>
      )}

      <SectionCard title={t('order.track')}>
        <p className="text-sm text-ink-soft">{t('order.keepReceipt')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            to={
              state.publicToken
                ? `/track?order=${encodeURIComponent(order.orderNumber)}&token=${encodeURIComponent(state.publicToken)}`
                : '/track'
            }
            state={state.publicToken ? { orderNumber: order.orderNumber, publicToken: state.publicToken } : undefined}
            className="btn-primary"
          >
            <Search className="size-4" aria-hidden />
            {t('order.trackNow')}
          </Link>
          <Link to="/products" className="btn-quiet">
            <ShoppingBag className="size-4" aria-hidden />
            {t('cart.continue')}
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
