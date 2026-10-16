import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Home, Receipt, Search, ShoppingBag, UserRound } from 'lucide-react';
import { useCart, useHome } from '../../lib/queries';
import { useCustomerAuth } from '../../state/CustomerAuth';

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Home }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.7rem] font-medium transition-colors ${
          isActive ? 'text-primary-500' : 'text-secondary-400 hover:text-ink-soft'
        }`
      }
    >
      <Icon className="size-5" aria-hidden />
      <span>{label}</span>
    </NavLink>
  );
}

/** The search box is the entry point of the page, so it lives in the shell rather than per page. */
function SearchBar({ q }: { q: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState(q);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = term.trim();
    navigate(value ? `/products?q=${encodeURIComponent(value)}` : '/products');
  }

  return (
    <form onSubmit={submit} role="search" className="container pb-3">
      <div className="flex items-center gap-2 rounded-lg bg-surface-50 pl-3 shadow-raised">
        <input
          className="h-11 w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-mute"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          type="search"
        />
        <button
          type="submit"
          aria-label={t('search.submit')}
          className="flex size-11 shrink-0 items-center justify-center text-secondary-400 transition-colors hover:text-primary-600"
        >
          <Search className="size-5" aria-hidden />
        </button>
      </div>
    </form>
  );
}

export function StoreLayout() {
  const { t } = useTranslation();
  const { data: home } = useHome();
  const { count } = useCart();
  const { profile, isSignedIn } = useCustomerAuth();
  const location = useLocation();
  // Remounting the field on a new query seeds it with the term that produced the results.
  const activeQuery = new URLSearchParams(location.search).get('q') ?? '';

  useEffect(() => {
    // A fresh page in a chat webview should start at the top, not where the previous page scrolled.
    if (window.scrollY > 40) window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    document.title = home ? home.storeName : 'Debol';
  }, [home]);

  return (
    <div className="min-h-dvh bg-surface-100 pb-20">
      <header className="sticky top-0 z-30 bg-primary-500">
        <div className="container flex items-center gap-3 pb-1.5 pt-3">
          <NavLink to="/" className="flex min-w-0 flex-1 items-center gap-2.5">
            <img
              src="/logo-mark.png"
              alt="Debol"
              width={40}
              height={40}
              className="size-9 shrink-0 rounded-lg"
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-lg leading-tight text-surface-50">
                {home ? home.storeName : 'Debol'}
              </span>
              {home && (
                <span className="truncate text-[0.7rem] text-surface-50/80">{home.tagline}</span>
              )}
            </span>
          </NavLink>
          <NavLink
            to="/cart"
            className="relative rounded-lg p-2 text-surface-50 transition-colors hover:bg-primary-600"
            aria-label={t('cart.title')}
          >
            <ShoppingBag className="size-6" aria-hidden />
            {count > 0 && (
              <span className="absolute right-0 top-0.5 min-w-[1.15rem] rounded-full bg-tertiary-500 px-1 text-center text-[0.65rem] font-semibold text-ink">
                {count}
              </span>
            )}
          </NavLink>
        </div>
        <SearchBar key={activeQuery} q={activeQuery} />
      </header>

      <main className="container py-5">
        <Outlet context={{ storeHome: home, signedInAs: isSignedIn ? profile?.fullName ?? null : null }} />
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-surface-200 bg-surface-50 shadow-bar">
        <NavItem to="/" label={t('nav.home')} icon={Home} />
        <NavItem to="/products" label={t('nav.shop')} icon={Compass} />
        <NavItem to="/track" label={t('order.track')} icon={Receipt} />
        <NavItem to="/account" label={t('nav.account')} icon={UserRound} />
      </nav>
    </div>
  );
}
