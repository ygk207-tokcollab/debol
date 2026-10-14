# Telegram setup

What the bot really is in this project: a module inside the backend
(`backend/src/main/kotlin/com/kidsstore/telegram/`), not a separate `bot/` service. It shares the
database transaction with order writes and the same `OrderStatusService` state machine as the admin
panel. See the deviation note in `../README.md`.

Components:

| File | Role |
| --- | --- |
| `TelegramBotClient.kt` | Bot API HTTP calls: `sendMessage`, `getUpdates`, `answerCallbackQuery`; classifies errors as retryable; builds the inline keyboard (`InlineKeyboard.orderButtons`) |
| `PollingWorker.kt` | long-poll loop for admin pairing + `/start` welcome; also `TelegramPairingService` and `TelegramOrderActions` |
| `NotificationService.kt` | `MessageRenderer` + enqueueing inside the caller's transaction |
| `OutboxDispatcher.kt` | scheduled drain of `notification_outbox` with backoff and dead-lettering |

## 1. Create the bot (BotFather)

1. In Telegram, open `@BotFather` and run `/newbot`; pick a display name and a username ending in
   `bot`. BotFather replies with the **HTTP API token** - that is `TELEGRAM_BOT_TOKEN`.
2. Optional but recommended: `/setdescription`, `/setname`, and `/setuserpic`.
3. Add the Mini App to the bot. In BotFather this is the Web App / menu-button flow
   (`/newapp`, or `Bot Settings → Menu Button → Change menu button` for an existing bot). UNVERIFIED:
   BotFather's command names change over time - what must be true is that the bot has a Web App /
   menu-button entry whose URL is your **HTTPS** frontend origin. The URL lives in BotFather's config
   *and* separately in `store_settings.mini_app_url` (used by the `/start` button), so set both.
4. Keep "Group privacy" defaults; the bot only ever messages the paired admin chat.

The token goes **only** into the backend environment:

```bash
TELEGRAM_BOT_TOKEN=123456789:AA...   # backend process env only
```

- `TelegramBotClient` builds `{TELEGRAM_API_BASE_URL}/bot{token}/{method}`, so the token appears in
  the outbound URL. It is never returned by any endpoint: `GET /api/v1/admin/telegram/status` reports
  `botTokenConfigured: true|false` only, and `PUT /api/v1/admin/telegram/config` accepts
  `botUsername`, `miniAppUrl`, `adminNotifyUrl`, `contactPhone`, `enabled` - no token field.
- Never put it in `frontend/` (there are no `import.meta.env` variables at all), never in a URL you
  share, never in an issue/screenshot, never in git. If it leaks, revoke it in BotFather with
  `/revoke` and rotate.
- The same token is the key for `initData` verification, so customer sign-in breaks the moment the
  token changes (see `docs/TROUBLESHOOTING.md`).

## 2. Environment variables

| Variable | Value for a real bot |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token (secret, backend only) |
| `TELEGRAM_API_BASE_URL` | leave the default `https://api.telegram.org` |
| `TELEGRAM_ENABLED` | `true` (master switch for dispatch + polling) |
| `TELEGRAM_POLLING_ENABLED` | `true` on exactly one instance; required for `/start`, pairing and buttons |
| `TELEGRAM_ADMIN_CONTACT_PHONE` | the owner's Ethiopian phone, e.g. `0911526922` |
| `TELEGRAM_ENFORCE_CALLBACK_CHAT` | `true` |
| `TELEGRAM_DISPATCH_INTERVAL_MS` | `5000` |
| `TELEGRAM_BACKOFF_BASE_SECONDS` / `_MAX_SECONDS` | `15` / `1800` |

UNVERIFIED / not effective today: `TELEGRAM_PAIRING_TTL_MINUTES` and `TELEGRAM_MAX_ATTEMPTS` are bound
in `application.yml` and `AppProperties` but no code reads them - pairing expiry is hardcoded
`OffsetDateTime.now().plusMinutes(15)` in `TelegramPairingService.issueCode`, and new outbox rows are
created with `maxAttempts = 8` in `NotificationService.enqueue`. To change either, change the code.

There is **no webhook receiver** in this backend (no controller calls `setWebhook`; only the local
stub answers that method). Registering a real webhook with BotFather would break `getUpdates`
polling, so do not configure one while `TELEGRAM_POLLING_ENABLED=true`.

## 3. What the bot actually does

Implemented in `PollingWorker` (`/start`, `/help`, `/pair`, pairing codes, inline buttons) and
`NotificationService` (one-way admin messages). It does **not** offer a customer chatbot: shopping
happens in the Mini App, and the bot only greets, pairs, notifies, and answers admin buttons.

`pollOnce()` calls `getUpdates(offset, min(TELEGRAM_POLLING_TIMEOUT_SECONDS, 5))` with
`allowed_updates = ["message","callback_query"]`, advances `offset` past each `update_id`, routes
`message` → `handleIt` and `callback_query` → `TelegramOrderActions.handle`, and never lets one bad
update kill the loop (each is wrapped, errors logged as warnings). On `TelegramApiException` it sleeps
5 s, on anything else 10 s.

### `/start` and the store button

`handleIt(message)` checks the pairing pattern `^/(?:start|pair)\s+(\d{6})$` **first**. So:

- `/start 481920` → treated as a pairing attempt, not a welcome (see section 4).
- `/start` or `/help` (no 6-digit argument) → welcome message built from `store_settings`:

  ```
  Welcome to <store_name_en>!
  Tap the button below to start shopping.        # only when mini_app_url is set
  ```
  or, when the URL is blank: `The store is being set up - please check back shortly.`

  With a URL configured it attaches one inline button: `{"text": "Open the store", "url": <miniAppUrl>}`.
  Note this is a plain URL button, not a `web_app` button: the link opens in the in-app browser. The
  real Mini App entry point is the bot's menu button configured in BotFather.
- `/pair` with no code → `Usage: /pair <6 digit code shown in the admin panel>`.
- Any other text → ignored (no auto-reply).
- A failed welcome send is logged at INFO and swallowed; it never blocks polling.

The Mini App itself (frontend) uses `@tma.js/sdk`: it guards every call with `isTMAFp()`, calls
`web_app_expand` / `web_app_set_background_color` / `web_app_set_bottom_bar_color` / `web_app_ready`,
and POSTs the raw `initData` string to `/api/v1/telegram/auth`. It works in a normal browser too
(phone sign-in instead).

## 4. Admin pairing (chat registration)

Pairing links one Telegram chat as the store's notification target and button operator. The proof of
control is a **6-digit code minted inside the authenticated admin panel** - not the phone number.
`TELEGRAM_ADMIN_CONTACT_PHONE` (`0911526922`) is a phone number for contact/audit purposes; it is
never a `chat_id` and cannot be used to send anything.

### Recommended: code pairing (requires `TELEGRAM_POLLING_ENABLED=true`)

1. As **OWNER** (`/api/v1/admin/telegram/**` is `hasRole("OWNER")`):

   ```
   POST /api/v1/admin/telegram/pairing-code
   ```
   Returns `{"code":"481920","expiresAt":"...","instructions":"Open the bot in Telegram and send: /pair 481920"}`.
   The code is `Tokens.numericCode(6)`, status `PENDING`, `requested_contact_phone` =
   `store_settings.telegram_admin_contact_phone` (falling back to `TELEGRAM_ADMIN_CONTACT_PHONE`),
   `created_by_email` = the acting admin, `expires_at` = now + 15 minutes. A row is written to
   `telegram_pairing_code`. The UI for this is on `/admin/notifications`.

2. The owner opens the bot in Telegram and sends `/pair 481920` (or `/start 481920`).

3. `consumePairingCode` accepts it only if it matches a `PENDING` code that has not expired
   (`findPending` + expiry filter + exact code match) **and** whose `requested_contact_phone` equals
   the currently stored contact phone. On success:
   - the row becomes `CONSUMED` with the sender's `telegram_user_id` / `telegram_chat_id` and
     `consumed_at` (single use; a replayed code is rejected because it is no longer pending);
   - `store_settings` is updated: `telegram_chat_id`, `telegram_user_id`,
     `telegram_setup_complete = true`, contact phone preserved;
   - the chat gets `This bot is now linked to the store. Order notifications will arrive here.` plus
     one `TEST` notification ("Pairing complete - this is a test order notification.") that proves the
     whole send path.
   On failure: `That pairing code is invalid or expired. Start again from the admin panel.`

Expired rows are simply skipped; nothing in the code flips a row to `EXPIRED` (that enum value exists
but is never written).

### Fallback: manual registration

```
POST /api/v1/admin/telegram/register
{"telegramUserId": 123456789, "chatId": 123456789}
```

Validates `telegramUserId > 0` and `chatId != 0`, writes the same three `store_settings` columns,
audits `TELEGRAM_PAIRED_MANUALLY`, and enqueues a `TEST` notification. Use this when polling is off
(local demo, acceptance run, the stub). UNVERIFIED: how you obtain the real numeric ids when you
cannot poll - common practice is to message the bot and read the id from your own Mini App's
`initData.user.id` (`POST /api/v1/telegram/auth` returns the verified user id), or temporarily enable
polling.

### Check state

```
GET /api/v1/admin/telegram/status
```

Returns `botTokenConfigured`, `enabled`, `setupComplete`, `adminChatId`, `adminTelegramUserId`,
`adminContactPhone`, `botUsername`, `miniAppUrl`, `adminPanelUrl`, `pollingEnabled`, `ready`
(`= telegramEnabled && token configured && setupComplete`, per `StoreSettings.telegramReady()`) and a
human `warning` naming the first missing step, plus `pendingPairingCodes` (unexpired PENDING codes only).

## 5. Verification and authority

Two independent layers; neither trusts a client-supplied id.

**`initData` (customer sign-in).** `TelegramInitDataVerifier.verify()` implements Telegram's documented
scheme: `secret = HMAC_SHA256(key="WebAppData", data=botToken)`, then
`check = HMAC_SHA256(key=secret, data=sorted "k=v" lines joined by \n, excluding hash)`, compared to
`hash` in constant time (`MessageDigest.isEqual`). It also requires `auth_date` to be within
`INIT_DATA_MAX_AGE_SECONDS` (default 86400) and parses `user` from the JSON payload. Missing
`hash`/`auth_date`/`user` → 400 `invalid_init_data`; no token → 503 `telegram_not_configured`;
signature mismatch → 401 `invalid_init_data` with a warning log. The result is stored as a
`telegram_account` row plus a `customer_session` (SHA-256 token hash, source `TELEGRAM`).

**Callback/button authority (admin actions).** `TelegramOrderActions.handle` recomputes authorization
server-side for every press:

```kotlin
val authorized = settings.telegramSetupComplete &&
    settings.telegramUserId != null &&
    settings.telegramUserId == userId &&
    (!props.telegram.enforceCallbackChat || chatId == null || chatId == settings.telegramChatId)
```

so the pressing user must equal the paired `telegram_user_id`, and (with
`TELEGRAM_ENFORCE_CALLBACK_CHAT=true`) the chat must equal the paired chat. Note the honest caveat
that `chatId == null` skips the chat check - the user check still applies. Every press is written to
`telegram_callback_log` with `authorized`, the raw action string, order id, and the result (max 512
chars), and a repeated `callback_query_id` short-circuits as already handled.

Actions then run through `OrderStatusService` with `actorType = TELEGRAM_BUTTON` and
`actorEmail = "telegram-admin:<userId>"`, i.e. the same transition table as the panel:

| Button | Server action |
| --- | --- |
| `confirm:<orderId>` | `transition(..., CONFIRMED)` |
| `reject:<orderId>` | `cancel(..., "Rejected by administrator")` |
| `deliver:<orderId>` | `deliver(...)` (only valid from `OUT_FOR_DELIVERY`/`FAILED_DELIVERY`) |

An illegal action is answered as `Not allowed: <message>` instead of changing state.
Every admin notification with `inline_actions = true` gets its keyboard from
`InlineKeyboard.orderButtons`: an optional `View order <number>` URL button
(`admin_notify_url` ?: `mini_app_url`, path `/admin/orders/{id}`), plus Confirm/Reject while
`PENDING_CONFIRMATION` or Mark delivered from `CONFIRMED`/`PROCESSING`/`OUT_FOR_DELIVERY`/`FAILED_DELIVERY`.

## 6. Outbound messages

Enqueueing happens inside the business transaction (`@Transactional` on the callers), so a
notification is committed exactly when the order change is. Duplicate suppression is the unique
`idempotency_key`: `NEW_ORDER:ORDER:<id>`, `<EVENT>:ORDER:<id>:<status>[:suffix]`,
`<TYPE>:VARIANT:<variantId>:<stock>`, `TEST:<random>`.

| Event | Trigger | Inline buttons |
| --- | --- | --- |
| `NEW_ORDER` | checkout commits the order | yes |
| `ORDER_CONFIRMED` | confirm (panel, Telegram, `CONFIRMED`) | no |
| `FAILED_DELIVERY` | failed delivery attempt (key suffix `attempt:<n>`) | yes |
| `ORDER_DELIVERED` | delivery recorded | no |
| `ORDER_CANCELLED` | admin cancellation | yes |
| `CANCEL_REQUEST` | customer cancel request | no |
| `CASH_COLLECTED` | cash collection recorded | yes |
| `LOW_STOCK` / `OUT_OF_STOCK` | stock crosses the variant/store threshold | no |
| `TEST` | pairing, `/admin/notifications/test`, manual register | no |

The `NEW_ORDER` body is rendered from persisted values only (`MessageRenderer.newOrderMessage`):
order number, customer name/phone/Telegram id, item lines (name, size, colour, quantity, line total),
subtotal, delivery fee, `TOTAL TO COLLECT: ETB x,xxx.xx`, `Payment: CASH ON DELIVERY`, payment status,
full address line, instructions/preferred time, order status, timestamp. `Money.format` emits
`ETB 1,250.00`. Status changes use `statusMessage` (order number, customer, total, order status,
payment status, optional extra); stock alerts use `stockMessage` (product, variant, SKU, remaining).
No token or credential ever appears in a message body.

## 7. When Telegram is unreachable

The order is already committed; only delivery is affected. `OutboxDispatcher.dispatch()` runs every
`TELEGRAM_DISPATCH_INTERVAL_MS`, claims up to `TELEGRAM_DISPATCH_BATCH_SIZE` due rows
(`claimDue(now, ...)` → `SENDING` with `locked_until = now + 90 s`), then performs the HTTP call
*outside* the transaction and records the outcome in a new transaction.

- No paired chat (`payload.chatId` and `settings.telegramChatId` both null) → `markNotConfigured` with
  `last_error = "telegram_admin_not_paired"`; the row stays `RETRY` (with backoff) until
  `attempts >= max_attempts`, then `DEAD_LETTER`. On each pass it re-reads the paired chat, so pairing
  later self-heals.
- No token → same path with `telegram_bot_token_missing`.
- Bot API failure → `markFailure`: `attempts += 1`, `status = RETRY` and
  `next_attempt_at = now + backoff` when the error is retryable, otherwise `DEAD_LETTER`. Retryable =
  HTTP 429, 5xx, `IOException` (`errorType: network`), unparsed/zero codes; not retryable = 400
  `bad_request` (bad chat id), 401, 403 `forbidden` (bot blocked/kicked), 404, and
  `not_configured`. `retry_after` from Telegram 429 wins: `retry_after + 1` seconds.
- Backoff: `min(backoff_base * 2^(attempts-1), backoff_max)` with the shift capped at 12
  → 15 s, 30 s, 60 s, ... ceiling 1800 s.
- `TELEGRAM_ENABLED=false` makes the dispatcher return before claiming, so rows pile up as `PENDING`.
- On success: `status = SENT`, `sent_at`, `telegram_message_id`, `last_error = null`.

Recovery is operator-driven and visible on `/admin/notifications` (list + per-status counts +
`telegram` status block) via `POST /api/v1/admin/notifications/{id}/retry`,
`POST /api/v1/admin/notifications/retry-all` (re-queues `RETRY`/`DEAD_LETTER`/`PENDING`, 200 rows max),
`POST /api/v1/admin/orders/{id}/notification-retry`, `POST /api/v1/admin/notifications/dispatch`
(runs one cycle immediately) and `POST /api/v1/admin/notifications/test`. All requeue paths reset
`attempts = 0` and clear `locked_until`; already `SENT` rows answer 409 `already_sent`. Those
endpoints require `MANAGER` or `OWNER`.

## 8. Production checklist for the bot

- `TELEGRAM_BOT_TOKEN` from the platform secret store, never in git; confirm
  `GET /api/v1/admin/telegram/status` → `botTokenConfigured: true`, `ready: true`.
- `TELEGRAM_API_BASE_URL=https://api.telegram.org` (the demo value `http://127.0.0.1:9099` must not
  survive a deploy).
- `TELEGRAM_POLLING_ENABLED=true` on one instance only; `TELEGRAM_ENFORCE_CALLBACK_CHAT=true`.
- Real `TELEGRAM_ADMIN_CONTACT_PHONE`, `store_settings.mini_app_url`, `admin_notify_url`,
  `bot_username`, `telegram_enabled=true`.
- Pairing done through a fresh code (rotate the code if it leaks; codes are single-use and expire).
- Frontend served over HTTPS from the origin registered in BotFather, otherwise `initData`
  verification fails for real clients (`docs/DEPLOYMENT.md`).
