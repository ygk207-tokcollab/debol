import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { useCart } from '../../lib/queries';
import { Price } from '../../components/Price';
import { ProductImage } from '../../components/ProductImage';
import { EmptyState, ErrorState, LoadingRows } from '../../components/PageState';
import type { CartItem } from '../../lib/types';

export default function CartPage() {
  const { t } = useTranslation();
  const { cart, isLoading, isError, refresh, setQuantity, remove, clear } = useCart();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const busy = setQuantity.isPending || remove.isPending || clear.isPending;

  const fail = (e: unknown) => setActionError(e instanceof ApiError ? e.message : t('common.error'));

  // The backend caps quantities at available stock and returns the corrected cart, so we render the
  // server's number — never an optimistic one. If it clamped below what was requested, say so.
  function changeQty(item: CartItem, next: number) {
    if (next < 1 || next === item.quantity || next > item.stock) return;
    setNotice(null);
    setActionError(null);
    setQuantity.mutate(
      { variantId: item.variantId, quantity: next },
      {
        onSuccess: (data) => {
          const after = data.items.find((i) => i.variantId === item.variantId);
          if (after && after.quantity !== next) setNotice(t('cart.onlyInCart', { count: after.stock }));
        },
        onError: fail,
      },
    );
  }

  function removeItem(item: CartItem) {
    setNotice(null);
    setActionError(null);
    remove.mutate(item.variantId, { onError: fail });
  }

  function clearCart() {
    setNotice(null);
    setActionError(null);
    clear.mutate(undefined, { onError: fail });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl text-ink">{t('cart.title')}</h1>
        {cart && cart.items.length > 0 && (
          <button type="button" className="btn-quiet px-2 text-sm" onClick={clearCart} disabled={busy}>
            <Trash2 className="size-4" aria-hidden />
            {t('cart.remove')}
          </button>
        )}
      </div>

      {isLoading && <LoadingRows rows={3} />}

      {isError && <ErrorState error={null} onRetry={refresh} />}

      {!isLoading && !isError && !cart && (
        <EmptyState
          title={t('cart.empty')}
          body={t('home.heroKicker')}
          action={
            <Link to="/products" className="btn-primary">
              <ShoppingBag className="size-4" aria-hidden />
              {t('cart.startShopping')}
            </Link>
          }
        />
      )}

      {cart && cart.items.length === 0 && (
        <EmptyState
          title={t('cart.empty')}
          action={
            <Link to="/products" className="btn-primary">
              {t('cart.startShopping')}
            </Link>
          }
        />
      )}

      {actionError && (
        <p className="rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-secondary-300 bg-secondary-100 px-3 py-2 text-sm text-primary-600">{notice}</p>
      )}

      {cart && cart.items.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
          <ul className="space-y-3">
            {cart.items.map((item) => {
              const name = item.nameEn;
              const atMax = item.quantity >= item.stock;
              return (
                <li key={item.variantId} className="card p-3">
                  <div className="flex gap-3">
                    <Link to={`/products/${item.productSlug}`} className="w-20 shrink-0">
                      <ProductImage url={item.imageUrl} name={item.nameEn} ratio="square" />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link to={`/products/${item.productSlug}`} className="block truncate font-medium text-ink hover:text-primary-600">
                        {name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {item.sizeLabel}
                        {item.colorName ? ` · ${item.colorName}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        <Price value={item.unitPrice} currency={cart.currency} size="sm" />
                        {' · '}
                        {'each'}
                      </p>

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center rounded-md border border-surface-300">
                          <button
                            type="button"
                            className="px-2 py-1.5 text-primary-600 transition-colors hover:bg-primary-50 disabled:opacity-40"
                            onClick={() => changeQty(item, item.quantity - 1)}
                            disabled={busy || item.quantity <= 1}
                            aria-label={t('cart.updateQuantity')}
                          >
                            <Minus className="size-3.5" aria-hidden />
                          </button>
                          <span className="min-w-9 text-center text-sm tabular-nums text-ink" aria-live="polite">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="px-2 py-1.5 text-primary-600 transition-colors hover:bg-primary-50 disabled:opacity-40"
                            onClick={() => changeQty(item, item.quantity + 1)}
                            disabled={busy || atMax}
                            aria-label={t('cart.updateQuantity')}
                            title={atMax ? t('product.lowStock', { count: item.stock }) : undefined}
                          >
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        </div>

                        <div className="flex items-center gap-3">
                          <Price value={item.lineTotal} currency={cart.currency} size="sm" />
                          <button
                            type="button"
                            className="text-ink-mute transition-colors hover:text-error-600"
                            onClick={() => removeItem(item)}
                            disabled={busy}
                            aria-label={`${t('cart.remove')} ${name}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </div>

                      {atMax && (
                        <p className="mt-1 text-xs text-ink-mute">{t('product.lowStock', { count: item.stock })}</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <aside className="lg:w-80">
            <div className="card space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-soft">{t('cart.subtotal')}</span>
                <Price value={cart.subtotal} currency={cart.currency} size="lg" />
              </div>
              <p className="text-xs text-ink-mute">{t('cart.deliveryNote')}</p>
              <Link
                to="/checkout"
                className="btn-primary w-full"
              >
                {t('cart.checkout')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link to="/products" className="btn-quiet w-full">
                {t('cart.continue')}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
