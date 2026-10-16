import { useEffect, useRef } from 'react';
import { inTelegram, rawInitData } from '../lib/telegram';
import { customerToken } from '../lib/session';
import { useCustomerAuth } from './CustomerAuth';

/** Inside Telegram the shopper is already authenticated by the container: exchange initData for a session. */
export function TelegramAutoSignIn() {
  const { profile, signInByInitData } = useCustomerAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || profile || customerToken()) return;
    const data = rawInitData();
    if (!inTelegram() || !data) return;
    attempted.current = true;
    void signInByInitData(data);
  }, [profile, signInByInitData]);

  return null;
}
