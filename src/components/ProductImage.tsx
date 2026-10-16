import { useState } from 'react';
import { assetUrl } from '../lib/api';

function Placeholder({ label, ratio, className }: { label: string; ratio: string; className: string }) {
  return (
    <div
      className={`${ratio} ${className} flex items-end justify-start bg-secondary-100 p-4`}
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, rgba(90,100,114,0.12) 0 10px, rgba(90,100,114,0) 10px 20px)',
      }}
      role="img"
      aria-label={label}
    >
      <span className="font-display text-sm leading-snug text-secondary-500">{label}</span>
    </div>
  );
}

/**
 * Every catalogue tile uses the same 4:5 frame so the grid stays calm. Products without a photo —
 * or with one that has gone missing — fall back to a plain woven placeholder.
 */
export function ProductImage({
  url, name, ratio = 'product', className = '', sizes,
}: {
  url?: string | null;
  name: string;
  ratio?: 'product' | 'square' | 'banner';
  className?: string;
  sizes?: string;
}) {
  const [broken, setBroken] = useState(false);
  const aspect = ratio === 'square' ? 'aspect-square' : ratio === 'banner' ? 'aspect-banner' : 'aspect-product';
  const label = name;
  const src = assetUrl(url);

  if (!src || broken) return <Placeholder label={label} ratio={aspect} className={className} />;

  return (
    <div className={`${aspect} ${className} overflow-hidden bg-secondary-100`}>
      <img
        src={src}
        alt={label}
        loading="lazy"
        sizes={sizes ?? '45vw'}
        className="size-full object-cover"
        onError={() => setBroken(true)}
      />
    </div>
  );
}
