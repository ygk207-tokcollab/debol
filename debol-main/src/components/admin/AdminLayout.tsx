import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bell, Boxes, Compass, Gauge, LayoutGrid, ListChecks, Package, Settings, ShieldCheck, Tags, Users,
} from 'lucide-react';
import { adminNotifications } from '../../lib/adminApi';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'admin.roleOwner',
  MANAGER: 'admin.roleManager',
  DELIVERY_STAFF: 'admin.roleCourier',
};

const LINKS: { to: string; labelKey: string; icon: typeof Gauge; permission?: string }[] = [
  { to: '/admin/dashboard', labelKey: 'admin.dashboard', icon: Gauge, permission: PERMISSION.dashboard },
  { to: '/admin/orders', labelKey: 'admin.orders', icon: ListChecks, permission: PERMISSION.orders },
  { to: '/admin/products', labelKey: 'admin.products', icon: Package, permission: PERMISSION.products },
  { to: '/admin/inventory', labelKey: 'admin.inventory', icon: Boxes, permission: PERMISSION.inventory },
  { to: '/admin/categories', labelKey: 'admin.categories', icon: Tags, permission: PERMISSION.products },
  { to: '/admin/zones', labelKey: 'admin.deliveryZones', icon: Compass, permission: PERMISSION.settings },
  { to: '/admin/notifications', labelKey: 'admin.notifications', icon: Bell, permission: PERMISSION.orders },
  { to: '/admin/settings', labelKey: 'admin.settings', icon: Settings, permission: PERMISSION.settings },
  { to: '/admin/people', labelKey: 'admin.administrators', icon: Users, permission: PERMISSION.administrators },
  { to: '/admin/audit', labelKey: 'admin.audit', icon: ShieldCheck, permission: PERMISSION.audit },
];

export function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, signOut, can } = useAdminAuth();
  const telegram = useQuery({
    queryKey: ['admin', 'telegram', 'status'],
    queryFn: adminNotifications.telegramStatus,
    enabled: can(PERMISSION.orders) || can(PERMISSION.telegram),
    staleTime: 30_000,
  });

  const visible = LINKS.filter((link) => !link.permission || can(link.permission));

  return (
    <div className="min-h-dvh bg-surface-100">
      <header className="sticky top-0 z-30 border-b border-surface-300/70 bg-primary-600 text-surface-50">
        <div className="container flex items-center gap-3 py-3">
          <LayoutGrid className="size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base leading-tight">{t('admin.panel')}</p>
            <p className="truncate text-[0.7rem] text-surface-50/70">
              {session?.fullName} · {t(ROLE_LABEL[session?.role ?? "DELIVERY_STAFF"])}
            </p>
          </div>
          <a
            href="/"
            className="hidden rounded-md px-2 py-1.5 text-sm hover:bg-primary-500 sm:inline-flex"
          >
            {t('admin.viewStorefront')}
          </a>
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-sm hover:bg-primary-500"
            onClick={async () => {
              await signOut();
              navigate('/admin/login', { replace: true });
            }}
          >
            {t('admin.signOut')}
          </button>
        </div>
      </header>

      <div className="container grid gap-5 py-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:h-fit lg:flex-col lg:overflow-visible">
          {visible.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  isActive ? 'bg-primary-50 font-medium text-primary-700' : 'text-ink-soft hover:bg-surface-200'
                }`
              }
            >
              <link.icon className="size-4 shrink-0" aria-hidden />
              {t(link.labelKey)}
            </NavLink>
          ))}
          <div className="hidden lg:mt-3 lg:block">
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {telegram.data && !telegram.data.ready && (
            <div className="rounded-lg border border-error-300/60 bg-error-100/60 px-4 py-3 text-sm text-error-600">
              {!telegram.data.botTokenConfigured
                ? t('admin.telegramNoToken')
                : t('admin.telegramNoChat')}{' '}
              <NavLink to="/admin/notifications" className="underline underline-offset-2">
                {t('admin.telegramSetup')}
              </NavLink>
            </div>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
