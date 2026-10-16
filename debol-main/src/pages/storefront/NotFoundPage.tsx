import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="card mx-auto mt-8 flex max-w-md flex-col items-center gap-4 px-6 py-10 text-center">
      <h1 className="font-display text-2xl text-primary-700">
        {'This page could not be found'}
      </h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        {'The link may be old or mistyped. The storefront is still open below.'}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Link to="/" className="btn-primary">{t('nav.home')}</Link>
        <Link to="/products" className="btn-secondary">{t('nav.shop')}</Link>
      </div>
    </div>
  );
}
