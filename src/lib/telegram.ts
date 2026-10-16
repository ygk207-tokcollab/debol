import { isTMAFp, postEvent, retrieveRawInitData, setDebug } from '@tma.js/sdk';

/**
 * The Mini App must also work in a plain browser, so every SDK call stays inside a guard.
 * Nothing here can leak credentials: initData is only ever sent to our own backend, which
 * verifies its HMAC before trusting a Telegram user id.
 */
let cachedInTelegram: boolean | null = null;

export function inTelegram(): boolean {
  if (cachedInTelegram === null) {
    try {
      cachedInTelegram = isTMAFp();
    } catch {
      cachedInTelegram = false;
    }
  }
  return cachedInTelegram;
}

/** Raw initData string, or null when the app was opened outside Telegram. */
export function rawInitData(): string | null {
  if (!inTelegram()) return null;
  try {
    return retrieveRawInitData() ?? null;
  } catch {
    return null;
  }
}

export function telegramUserName(): string | null {
  const data = rawInitData();
  if (!data) return null;
  try {
    const user = JSON.parse(new URLSearchParams(data).get('user') ?? 'null');
    if (!user) return null;
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || null;
  } catch {
    return null;
  }
}

/** Called once when the app starts: expand the frame and match the shop palette. */
export function configureTelegramChrome(background: `#${string}`, bottomBar: `#${string}`) {
  if (!inTelegram()) return;
  setDebug(false);
  try {
    postEvent('web_app_expand');
    postEvent('web_app_set_background_color', { color: background });
    postEvent('web_app_set_bottom_bar_color', { color: bottomBar });
    postEvent('web_app_ready');
  } catch {
    /* older clients ignore methods they do not know */
  }
}
