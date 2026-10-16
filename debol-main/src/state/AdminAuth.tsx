import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminAuth } from '../lib/adminApi';
import type { AdminLogin } from '../lib/adminApi';
import { adminToken, rememberAdminToken } from '../lib/session';

interface AdminAuthValue {
  session: AdminLogin | null;
  isSignedIn: boolean;
  /** A stored token is still being checked against the server; guards must not bounce yet. */
  restoring: boolean;
  busy: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminLogin | null>(null);
  const [restoring, setRestoring] = useState(() => Boolean(adminToken()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The token is only usable if the server still accepts it: passwords, roles and revocations live
  // in PostgreSQL, so /admin/auth/me is the authority on who is signed in.
  useEffect(() => {
    if (!adminToken()) return;
    adminAuth.me().then(setSession).catch(() => {
      rememberAdminToken(null);
      setSession(null);
    }).finally(() => setRestoring(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminAuth.login(email, password);
      rememberAdminToken(result.token);
      setSession(result);
      return true;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'sign-in failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await adminAuth.signOut().catch(() => undefined);
    rememberAdminToken(null);
    setSession(null);
  }, []);

  const value = useMemo<AdminAuthValue>(() => ({
    session,
    isSignedIn: Boolean(session && adminToken()),
    restoring,
    busy,
    error,
    signIn,
    signOut,
    can: (permission: string) => Boolean(session?.permissions?.includes(permission)),
  }), [session, restoring, busy, error, signIn, signOut]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return value;
}

/** Keys returned by the backend: dashboard, products, orders, inventory, settings, telegram, administrators, audit. */
export const PERMISSION = {
  dashboard: 'dashboard',
  products: 'products',
  orders: 'orders',
  inventory: 'inventory',
  settings: 'settings',
  telegram: 'telegram',
  administrators: 'administrators',
  audit: 'audit',
} as const;
