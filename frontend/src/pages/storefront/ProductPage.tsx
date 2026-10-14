import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, ChevronDown, Minus, Plus, Ruler, Tag, Truck } from 'lucide-react';
import { useCart, useProduct } from '../../lib/queries';
import { ageBandText, useAgeBandLabels } from '../../lib/ageBands';
import { ApiError } from '../../lib/api';
import { useToast } from '../../state/Toast';
import { Price } from '../../components/Price';
import { ProductCard } from '../../components/ProductCard';
import { ProductImage } from '../../components/ProductImage';
import { ErrorState } from '../../components/PageState';

/** Collapsible section used for delivery and the size guide, matching the reference's Show rows. */
function Disclosure({
  icon: Icon, title, children,
}: {
  icon: typeof Truck;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="card px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Icon className="size-5 shrink-0 text-secondary-500" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-base font-medium text-ink">{title}</h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          {open ? t('product.hide') : t('product.show')}
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {open && <div className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</div>}
    </section>
  );
}

export default function ProductPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, isError, error, refetch } = useProduct(slug ?? '');
  const cart = useCart();
  const labelFor = useAgeBandLabels();
  const gallery = useRef<HTMLDivElement>(null);

  const variants = product?.variants ?? [];

  const sizes = useMemo(() => Array.from(new Set(variants.map((v) => v.sizeLabel))), [variants]);
  const preferred = useMemo(() => variants.find((v) => v.stock > 0) ?? variants[0] ?? null, [variants]);

  const [selSize, setSelSize] = useState<string | null>(null);
  const [selColor, setSelColor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSelSize(null);
    setSelColor(null);
    setQty(1);
    setActiveImage(0);
    setExpanded(false);
    gallery.current?.scrollTo({ left: 0 });
  }, [slug]);

  const chosenSize = selSize ?? preferred?.sizeLabel ?? '';
  const sizeVariants = variants.filter((v) => v.sizeLabel === chosenSize);
  const colorOptions = Array.from(new Set(sizeVariants.map((v) => v.colorName)));
  const preferredColor = selColor && colorOptions.includes(selColor)
    ? selColor
    : (sizeVariants.find((v) => v.stock > 0)?.colorName ?? sizeVariants[0]?.colorName ?? '');
  const selectedVariant =
    variants.find((v) => v.sizeLabel === chosenSize && v.colorName === preferredColor) ?? null;

  const maxQty = selectedVariant?.stock ?? 0;
  useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), Math.max(1, maxQty)));
  }, [maxQty]);

  const images = product?.images ?? [];

  if (isLoading && !product) {
    return (
      <div className="space-y-4">
        <div className="skeleton aspect-square w-full" />
        <div className="card space-y-3 px-4 py-4">
          <div className="skeleton h-6 w-2/3" />
          <div className="skeleton h-5 w-1/3" />
          <div className="skeleton h-24 w-full" />
        </div>
      </div>
    );
  }

  if (isError && !product) {
    const notFound = error instanceof ApiError && (error.code === 'product_not_found' || error.status === 404);
    if (notFound) {
      return (
        <div className="card flex flex-col items-start gap-3 px-5 py-6">
          <h1 className="text-lg font-medium text-ink">{t('product.notAvailable')}</h1>
          <p className="text-sm text-ink-soft">{'It may have sold out or moved.'}</p>
          <Link to="/products" className="btn-secondary">{t('nav.shop')}</Link>
        </div>
      );
    }
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  if (!product) return null;

  const soldOut = product.totalStock <= 0;
  const unitUnavailable = !selectedVariant || selectedVariant.stock <= 0;
  const colours = Array.from(new Set(variants.map((v) => v.colorName)));

  function addThen(goToCheckout: boolean) {
    if (!selectedVariant || selectedVariant.stock <= 0) return;
    cart.add.mutate(
      { variantId: selectedVariant.id, quantity: qty },
      {
        onSuccess: () => {
          if (goToCheckout) navigate('/checkout');
          else toast.push(t('product.added'));
        },
        onError: (e) => toast.push(e instanceof ApiError ? e.message : t('common.error'), 'warn'),
      },
    );
  }

  const attributes: { value: string; label: string }[] = [
    { value: product.categoryNameEn, label: t('product.categoryLabel') },
    ...(product.ageGroups.length > 0
      ? [{ value: ageBandText(product.ageGroups, labelFor), label: t('catalog.ageGroup') }]
      : []),
    ...(sizes.length > 0 ? [{ value: sizes.join(', '), label: t('product.sizesLabel') }] : []),
    ...(colours.length > 0 ? [{ value: colours.join(', '), label: t('product.coloursLabel') }] : []),
    { value: String(product.totalStock), label: t('product.stockLabel') },
  ];

  const description = product.descriptionEn ?? '';
  const descriptionLong = description.length > 240;

  return (
    <article className="-mt-5 space-y-3 pb-2">
      {/* Gallery: full-bleed, one photo per screen, swipeable, with the photo count on top of it. */}
      <div className="relative -mx-4 bg-surface-50">
        <div
          ref={gallery}
          onScroll={(e) => {
            const el = e.currentTarget;
            setActiveImage(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        >
          {(images.length > 0 ? images : [null]).map((image) => (
            <div key={image?.url ?? `${slug}-empty`} className="w-full shrink-0 snap-center">
              <ProductImage
                url={image?.url ?? null}
                name={image?.altEn ?? product.nameEn}
                ratio="square"
                sizes="100vw"
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-ink/75 px-2 py-1 text-xs font-medium tabular-nums text-surface-50">
            {Math.min(activeImage + 1, images.length)}/{images.length}
            <Camera className="size-3.5" aria-hidden />
          </span>
        )}
      </div>

      {/* Detail sheet pulled up over the gallery, as in the reference. */}
      <div className="relative -mt-4 rounded-t-2xl bg-surface-50 px-4 pb-5 pt-4 shadow-raised">
        <Link
          to={`/products?category=${encodeURIComponent(product.categorySlug)}`}
          className="flex items-center gap-1.5 text-sm text-ink-mute"
        >
          <Tag className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{product.categoryNameEn}</span>
        </Link>

        <h1 className="mt-1.5 text-xl font-medium leading-snug text-ink">{product.nameEn}</h1>

        <div className="mt-2">
          <Price
            value={selectedVariant?.price ?? product.price}
            sale={selectedVariant ? undefined : product.salePrice}
            currency={product.currency}
            size="lg"
          />
        </div>

        {product.isSample && (
          <p className="mt-2 inline-block rounded-md bg-tertiary-100 px-2 py-1 text-xs text-tertiary-600">
            {t('product.sampleLabel')}
          </p>
        )}

        {sizes.length > 1 && (
          <div className="mt-4">
            <span className="field-label">{t('product.chooseSize')}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {sizes.map((size) => {
                const out = !variants.some((v) => v.sizeLabel === size && v.stock > 0);
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelSize(size)}
                    aria-pressed={size === chosenSize}
                    className={`chip ${size === chosenSize ? 'chip-selected' : ''} ${out ? 'line-through opacity-60' : ''}`}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {colorOptions.length > 1 && (
          <div className="mt-4">
            <span className="field-label">{t('product.chooseColour')}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {colorOptions.map((color) => {
                const variant = variants.find((v) => v.sizeLabel === chosenSize && v.colorName === color);
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelColor(color)}
                    aria-pressed={color === preferredColor}
                    className={`chip ${color === preferredColor ? 'chip-selected' : ''}`}
                  >
                    {variant?.colorHex && (
                      <span
                        className="size-3.5 rounded-full border border-surface-300"
                        style={{ backgroundColor: variant.colorHex }}
                        aria-hidden
                      />
                    )}
                    {color}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4">
          <span className="field-label">{t('product.quantity')}</span>
          <div className="mt-1 flex items-center gap-3">
            <div className="flex items-center rounded-lg border border-surface-300 bg-surface-50">
              <button
                type="button"
                className="px-3 py-2 text-primary-600 transition-colors hover:bg-primary-50 disabled:text-ink-mute"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={unitUnavailable || qty <= 1}
                aria-label={'Decrease'}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span className="w-10 text-center tabular-nums text-ink">{unitUnavailable ? 0 : qty}</span>
              <button
                type="button"
                className="px-3 py-2 text-primary-600 transition-colors hover:bg-primary-50 disabled:text-ink-mute"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={unitUnavailable || qty >= maxQty}
                aria-label={'Increase'}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            {!unitUnavailable && selectedVariant && (
              <span className="text-sm text-ink-mute">
                {selectedVariant.stock <= 3
                  ? t('product.lowStock', { count: selectedVariant.stock })
                  : t('product.inStock', { count: selectedVariant.stock })}
              </span>
            )}
          </div>
        </div>

        {soldOut ? (
          <p className="mt-5 rounded-lg bg-error-100 px-4 py-3 text-sm font-medium text-error-600">
            {t('product.outOfStock')}
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => addThen(false)}
              disabled={unitUnavailable || cart.add.isPending}
              className="btn border border-primary-500 bg-surface-50 text-primary-600 hover:bg-primary-50"
            >
              {cart.add.isPending ? t('product.adding') : t('product.addToCart')}
            </button>
            <button
              type="button"
              onClick={() => addThen(true)}
              disabled={unitUnavailable || cart.add.isPending}
              className="btn-primary"
            >
              {t('product.buyNow')}
            </button>
          </div>
        )}
        {unitUnavailable && !soldOut && (
          <p className="mt-2 text-sm text-error-600">
            {'This size or colour is sold out. Pick another.'}
          </p>
        )}
      </div>

      {attributes.length > 0 && (
        <section className="card px-4 py-4">
          <h2 className="mb-3 text-base font-medium text-ink">{t('product.details')}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {attributes.map((row) => (
              <div key={row.label} className="min-w-0">
                <dd className="truncate text-[0.95rem] text-ink">{row.value}</dd>
                <dt className="text-xs text-ink-mute">{row.label}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Disclosure icon={Truck} title={t('product.delivery')}>
        <p>{t('product.deliveryBody')}</p>
      </Disclosure>

      {product.sizeGuide?.bodyEn && (
        <Disclosure icon={Ruler} title={product.sizeGuide.titleEn || t('product.sizeGuide')}>
          <p className="whitespace-pre-line">{product.sizeGuide.bodyEn}</p>
        </Disclosure>
      )}

      {description && (
        <section className="card px-4 py-4">
          <h2 className="mb-2 text-base font-medium text-ink">{t('product.description')}</h2>
          <p
            className={`whitespace-pre-line text-sm leading-relaxed text-ink-soft ${
              expanded || !descriptionLong ? '' : 'line-clamp-4'
            }`}
          >
            {description}
          </p>
          {descriptionLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="mt-2 flex w-full items-center justify-end gap-1 text-sm text-primary-600 hover:underline"
            >
              {expanded ? t('product.showLess') : t('product.showMore')}
              <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          )}
        </section>
      )}

      {product.related.length > 0 && (
        <section>
          <h2 className="text-base font-medium text-ink">{t('product.related')}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {product.related.map((item) => (
              <ProductCard key={item.slug} product={item} sizes="(max-width:640px) 45vw, 25vw" />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
