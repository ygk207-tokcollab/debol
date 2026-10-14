import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { accountApi, cartApi } from '../lib/api';
import { customerToken, rememberCustomerToken } from '../lib/session';
import type { CustomerProfile } from '../lib/types';

interface CustomerAuthValue {
  profile: CustomerProfile | null;
  isSignedIn: boolean;
  busy: boolean;
  error: string | null;
  signInByPhone: (input: { phone: string; orderNumber?: string; publicToken?: string; fullName?: string }) => Promise<CustomerProfile | null>;
  signInByInitData: (initData: string) => Promise<CustomerProfile | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthValue | null>(null);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!customerToken()) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await accountApi.profile());
    } catch {
      // An expired or revoked session simply means "not signed in"; the token is cleared in api.ts.
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const afterSignIn = useCallback(async (token: string) => {
    rememberCustomerToken(token);
    // The guest cart becomes the account cart, so a signed-in customer never loses their basket.
    await cartApi.claim().catch(() => undefined);
    await loadProfile();
  }, [loadProfile]);

  const signInByPhone = useCallback<CustomerAuthValue['signInByPhone']>(async (input) => {
    setBusy(true);
    setError(null);
    try {
      const result = await accountApi.loginByPhone(input);
      await afterSignIn(result.token);
      return result.profile;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'sign-in failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [afterSignIn]);

  const signInByInitData = useCallback<CustomerAuthValue['signInByInitData']>(async (initData) => {
    setBusy(true);
    setError(null);
    try {
      const result = await accountApi.telegramLogin(initData);
      await afterSignIn(result.token);
      return result.profile;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Telegram sign-in failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [afterSignIn]);

  const signOut = useCallback(async () => {
    await accountApi.logout().catch(() => undefined);
    rememberCustomerToken(null);
    setProfile(null);
  }, []);

  const value = useMemo<CustomerAuthValue>(() => ({
    profile,
    isSignedIn: Boolean(profile && customerToken()),
    busy,
    error,
    signInByPhone,
    signInByInitData,
    signOut,
    refreshProfile: loadProfile,
  }), [profile, busy, error, signInByPhone, signInByInitData, signOut, loadProfile]);

  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
}

export function useCustomerAuth(): CustomerAuthValue {
  const value = useContext(CustomerAuthContext);
  if (!value) throw new Error('useCustomerAuth must be used inside CustomerAuthProvider');
  return value;
}
