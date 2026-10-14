import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Price } from './Price';
import { ProductImage } from './ProductImage';
import { compactAgeBands, useAgeBandShort } from '../lib/ageBands';
import type { ProductSummary } from '../lib/types';

function SoldOutBadge() {
  const { t } = useTranslation();
  return (
    <span className="absolute left-2 top-2 rounded-md bg-ink/75 px-2 py-0.5 text-[0.7rem] font-medium text-surface-50">
      {t('product.outOfStock')}
    </span>
  );
}

function StockNote({ product }: { product: ProductSummary }) {
  const { t } = useTranslation();
  const shortFor = useAgeBandShort();
  if (product.totalStock <= 0) return <span className="text-error-600">{t('product.outOfStock')}</span>;
  if (product.totalStock <= 3) {
    return <span>{t('product.lowStock', { count: product.totalStock })}</span>;
  }
  const bands = compactAgeBands(product.ageGroups, shortFor);
  return <span>{bands || product.categoryNameEn}</span>;
}

/** Grid tile: square photo, price first, then the name and one grey meta line. */
export function ProductCard({ product, sizes }: { product: ProductSummary; sizes?: string }) {
  return (
    <article className="group relative flex flex-col">
      <Link
        to={`/products/${product.slug}`}
        className="block overflow-hidden rounded-xl bg-surface-50 shadow-card transition-shadow hover:shadow-raised"
      >
        <div className="relative">
          <ProductImage
            url={product.imageUrl}
            name={product.nameEn}
            sizes={sizes}
            className={product.totalStock <= 0 ? 'opacity-55' : ''}
          />
          {product.totalStock <= 0 && <SoldOutBadge />}
        </div>
        <div className="px-3 pb-3 pt-2.5">
          <Price value={product.price} sale={product.salePrice} currency={product.currency} />
          <h3 className="mt-1 line-clamp-2 text-[0.95rem] leading-snug text-ink">{product.nameEn}</h3>
          <p className="mt-1 truncate text-xs text-ink-mute">
            <StockNote product={product} />
          </p>
        </div>
      </Link>
    </article>
  );
}

/** Catalogue row: the same information laid out beside the photo for narrow, list-style results. */
export function ListingRow({ product }: { product: ProductSummary }) {
  return (
    <li>
      <Link
        to={`/products/${product.slug}`}
        className="listing-row items-stretch gap-3 p-0 overflow-hidden"
      >
        <div className="relative w-[7.5rem] shrink-0 self-start sm:w-40">
          <ProductImage
            url={product.imageUrl}
            name={product.nameEn}
            sizes="(max-width:640px) 40vw, 25vw"
            className={product.totalStock <= 0 ? 'opacity-55' : ''}
          />
          {product.totalStock <= 0 && <SoldOutBadge />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center py-3 pr-3">
          <Price value={product.price} sale={product.salePrice} currency={product.currency} />
          <h3 className="mt-1 line-clamp-2 leading-snug text-ink">{product.nameEn}</h3>
          <p className="mt-1 truncate text-xs text-ink-mute">
            <StockNote product={product} />
          </p>
        </div>
      </Link>
    </li>
  );
}
