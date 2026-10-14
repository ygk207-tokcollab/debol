import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Baby, Blocks, BookOpen, Footprints, Shirt, ShoppingBasket, ToyBrick, Truck, type LucideIcon } from 'lucide-react';
import { useHome } from '../../lib/queries';
import { ProductCard } from '../../components/ProductCard';
import { ProductImage } from '../../components/ProductImage';
import { ErrorState, GridSkeleton } from '../../components/PageState';
import type { Banner, Category, ProductSummary } from '../../lib/types';

type AudienceTab = 'CHILD' | 'ADULT';

/** Mirrors the backend's audience rule: a FAMILY product belongs to both shops. */
function matchesAudience(item: ProductSummary, tab: AudienceTab): boolean {
  return item.audience === 'FAMILY' || item.audience === tab;
}

function bannerTarget(banner: Banner): string {
  const value = banner.linkValue?.trim();
  switch (banner.linkType) {
    case 'CATEGORY':
      return value ? `/products?category=${encodeURIComponent(value)}` : '/products';
    case 'PRODUCT':
      return value ? `/products/${encodeURIComponent(value)}` : '/products';
    default:
      return '/products';
  }
}

/** Categories have no icon field in the database, so the glyph is chosen from the slug. */
const GLYPHS: [RegExp, LucideIcon][] = [
  [/shoe|boot|sandal/i, Footprints],
  [/toy|game|puzzle/i, Blocks],
  [/book|story|learn/i, BookOpen],
  [/baby|infant|newborn/i, Baby],
  [/cloth|wear|dress|shirt|trouser|jacket/i, Shirt],
];

function categoryGlyph(category: Category): LucideIcon {
  const haystack = `${category.slug} ${category.nameEn}`;
  return GLYPHS.find(([pattern]) => pattern.test(haystack))?.[1]
    ?? (category.audience === 'ADULT' ? ShoppingBasket : ToyBrick);
}

function CategoryTile({ category }: { category: Category }) {
  const { t } = useTranslation();
  const Glyph = categoryGlyph(category);
  return (
    <Link
      to={`/products?category=${encodeURIComponent(category.slug)}`}
      className="group flex flex-col items-center gap-1.5 text-center"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-secondary-100 shadow-card transition-colors group-hover:bg-secondary-200">
        {category.imageUrl ? (
          <ProductImage url={category.imageUrl} name={category.nameEn} ratio="square" sizes="(max-width:640px) 20vw, 12vw" />
        ) : (
          <Glyph className="size-8 text-primary-600" aria-hidden />
        )}
      </span>
      <span className="line-clamp-2 text-[0.8rem] leading-tight text-ink">{category.nameEn}</span>
      <span className="text-[0.7rem] text-ink-mute">
        {t('home.itemsCount', { count: category.productCount })}
      </span>
    </Link>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const { data: home, isLoading, isError, error, refetch } = useHome();
  const [tab, setTab] = useState<AudienceTab>('CHILD');

  const hasAdult = useMemo(
    () => (home?.categories ?? []).some((c) => c.audience === 'ADULT'),
    [home],
  );

  if (isLoading && !home) return <div className="skeleton h-40 w-full rounded-xl" />;
  if (isError && !home) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!home) return null;

  const hero =
    home.banners.find((b) => b.placement === 'HERO') ??
    home.banners.find((b) => b.placement === 'HOME') ??
    home.banners[0] ??
    null;

  const featured = hasAdult ? home.featured.filter((p) => matchesAudience(p, tab)) : home.featured;
  const arrivals = hasAdult ? home.newArrivals.filter((p) => matchesAudience(p, tab)) : home.newArrivals;
  const categories = hasAdult ? home.categories.filter((c) => c.audience === 'FAMILY' || c.audience === tab) : home.categories;

  return (
    <div className="space-y-8">
      {/* Editorial banner — the store's own copy, not an invented slogan. */}
      {hero ? (
        <section className="overflow-hidden rounded-xl bg-primary-500 px-5 py-6 shadow-card sm:px-7">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-surface-50/80">{home.storeName}</p>
          <h1 className="mt-1.5 max-w-xl text-xl font-medium leading-snug text-surface-50 sm:text-2xl">
            {hero.titleEn}
          </h1>
          {hero.subtitleEn ? (
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-surface-50/90">{hero.subtitleEn}</p>
          ) : null}
          <Link to={bannerTarget(hero)} className="btn mt-4 bg-surface-50 text-primary-700 hover:bg-surface-100">
            {t('home.shopNow')}
          </Link>
        </section>
      ) : (
        <section className="px-1 py-1">
          <h1 className="text-xl leading-tight text-ink">{home.storeName}</h1>
          <p className="mt-1 max-w-lg text-sm text-ink-soft">{home.tagline}</p>
        </section>
      )}

      <p className="flex items-center gap-2 text-xs text-ink-soft">
        <Truck className="size-4 shrink-0 text-primary-600" aria-hidden />
        {t('home.deliveryNote')}
      </p>

      {/* Audience switch — only when the catalogue actually carries grown-up stock. */}
      {hasAdult && (
        <div className="flex gap-2" role="tablist" aria-label={t('catalog.audience')}>
          {(['CHILD', 'ADULT'] as const).map((option) => {
            const active = tab === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(option)}
                className={`btn flex-1 sm:flex-none ${
                  active ? 'bg-primary-500 text-surface-50' : 'btn-secondary'
                }`}
              >
                {option === 'CHILD' ? t('nav.kids') : t('nav.adults')}
              </button>
            );
          })}
        </div>
      )}

      {/* Category entry points */}
      {categories.length > 0 && (
        <section className="pt-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium text-ink">{t('home.categoriesTitle')}</h2>
            <Link to="/products" className="text-sm text-primary-600 hover:underline">
              {t('home.browseAll')}
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
            {categories.map((category) => (
              <CategoryTile key={category.slug} category={category} />
            ))}
          </div>
        </section>
      )}

      {/* Featured */}
      {featured.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium text-ink">{t('home.featured')}</h2>
            <Link to="/products?featured=true" className="text-sm text-primary-600 hover:underline">
              {t('home.viewAll')}
            </Link>
          </div>
          <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-2">
            {featured.map((product) => (
              <div key={product.slug} className="w-40 shrink-0 sm:w-48">
                <ProductCard product={product} sizes="192px" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* New arrivals */}
      {arrivals.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-ink">{t('home.newArrivals')}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {arrivals.slice(0, 8).map((product) => (
              <ProductCard key={product.slug} product={product} sizes="(max-width:640px) 45vw, 25vw" />
            ))}
          </div>
        </section>
      )}

      {/* Collections — rendered only when the payload carries products for them. */}
      {home.collections
        .filter((collection) => collection.products.length > 0)
        .map((collection) => (
          <section key={collection.slug}>
            <h2 className="text-lg font-medium text-ink">{collection.nameEn}</h2>
            {collection.descriptionEn ? (
              <p className="mt-1 text-sm text-ink-soft">{collection.descriptionEn}</p>
            ) : null}
            <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-2">
              {collection.products.map((product) => (
                <div key={product.slug} className="w-40 shrink-0 sm:w-48">
                  <ProductCard product={product} sizes="192px" />
                </div>
              ))}
            </div>
          </section>
        ))}

      {isLoading ? <GridSkeleton count={4} /> : null}
    </div>
  );
}
