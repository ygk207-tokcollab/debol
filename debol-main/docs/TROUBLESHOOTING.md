# Troubleshooting

Every entry below corresponds to a message the code actually produces (file named in the "source"
line). Error bodies are uniform: `{"error":"<code>","message":"...","fields":[...],"requestId":"..."}`;
quote the `requestId` when a 500 is involved (`ApiExceptionHandler` logs `Unhandled error [<ref>]`
with the stack trace server-side only, since `server.error.include-stacktrace: never`).

## Startup and infrastructure

### "Web server failed to start. Port 8080 was already in use."

Source: embedded Tomcat, `server.port: ${SERVER_PORT:8080}`.
Fix: `netstat -ano | findstr ":8080"` (Windows) or `lsof -i :8080`, stop the other process, or start
with a different port - note that the vite dev proxy and `scripts/acceptance.mjs` both assume
**8090**, so `SERVER_PORT=8090` is the path of least resistance locally.

### `FlywayException: Validate failed: Migration checksum mismatch for migration version N`

Cause: a file in `backend/src/main/resources/db/migration/` that has already been applied was edited
(often `V2__configuration_and_sample_catalog.sql` when someone tries to remove sample data).
Fix: revert the file to the applied content. For a dev database the usual answer is to recreate it
(`docs/SETUP-LOCAL.md` section 1 + `docs/DATA-AND-MIGRATIONS.md`); for real data, add a new `V3__...`.
UNVERIFIED: how to run `flyway repair` here - no Flyway Gradle plugin and no Flyway CLI are configured
in this repo, so there is no documented command.

### `Found non-empty schema(s) ... without schema history table!`

Cause: the target database already has tables but no `flyway_schema_history`, and
`spring.flyway.baseline-on-migrate: false` forbids adopting it.
Fix: point `DB_NAME` at an empty database, or drop and recreate it. Do not hand-insert history rows.

### `Schema-validation: missing column [...] in table [...]` / `Unable to build Hibernate SessionFactory`

Cause: entity mapping and Flyway schema disagree - Hibernate runs with `ddl-auto: validate` and will
not create anything. Fix the migration or the `@Column` in `backend/src/main/kotlin/com/kidsstore/domain/*.kt`.

### App starts, then every request fails with `store_settings row 1 is missing - run the Flyway migrations`

Source: `StoreConfigService.settings()`. Someone deleted the singleton settings row (or V2 never
ran). Restore it by recreating the database or re-inserting the `store_settings` `id = 1` row from
`V2__configuration_and_sample_catalog.sql`.

### Login returns 500 `server_error` and the log says `kidsstore.security.jwt-secret must be at least 32 bytes (set JWT_SECRET)`

Source: `JwtService.key` (a `by lazy` `require(...)`). Because it is lazy, the app boots fine without
`JWT_SECRET` and only fails the first time a token is issued or verified.
Fix: `JWT_SECRET=$(openssl rand -base64 48)`; the value must be stable across restarts and instances,
otherwise every session is invalidated on the next boot.

### `FATAL: password authentication failed for user "kidsstore"` / Hikari `connection-timeout` (8 s)

Check `DB_HOST`/`DB_PORT` (5433 locally, not 5432), `DB_USER`, `DB_PASSWORD`. `scripts/run-backend.sh`
exits immediately with `DB_PASSWORD: set DB_PASSWORD` when it is unset; `application.yml` defaults it
to an empty string, which is not a valid local password.

## Authentication and authorization

### 401 `{"error":"unauthorized","message":"Authentication required"}`

Source: `SecurityConfig` entry point. Means no bearer token, an unverifiable token (wrong/expired
`JWT_SECRET`, tampered), or an admin token whose `tv` claim no longer matches
`administrator.token_version` - `BearerAuthFilter` re-checks the database on every request, so
deactivating an admin or calling `POST /api/v1/admin/administrators/{id}/revoke` /
`POST /api/v1/admin/auth/revoke` logs sessions out immediately. Fix by signing in again; for customers
the `customer_session` row must exist, be unrevoked, and be unexpired.

### 403 `{"error":"forbidden","message":"Your account may not do this"}`

Role mismatch against the URL rules in `SecurityConfig`: `/admin/orders/**` + `/admin/dashboard/**`
need `STAFF`, `/admin/notifications/**`, `/admin/audit/**`, `/admin/delivery-zones/**` and everything
else under `/admin/**` need `MANAGER`, `/admin/settings/**`, `/admin/telegram/**`,
`/admin/administrators/**` need `OWNER`, `/me/**` needs `CUSTOMER`. `OWNER` inherits `MANAGER`+`STAFF`,
`MANAGER` inherits `STAFF`, `DELIVERY_STAFF` only gets `STAFF` (`Roles.authoritiesFor`).
Related codes: `admin_only` ("Administrator login required") when an admin endpoint is hit anonymously
by a customer token, `customer_only`, and 403 `forbidden` for a track request whose `?token=` does not
match `orders.public_token`.

### 403 `{"error":"dev_login_disabled"}`

`POST /api/v1/admin/auth/dev-login` with `DEV_AUTH_ENABLED=false` (`AdminAuthService.devLogin`). That
is the intended production state; use the real email/password login. If startup itself failed with
`kidsstore.security.dev-auth-enabled cannot be true under a prod profile`, both were set
inconsistently - either drop the flag or drop the prod profile name. Note the guard matches only the
profile names `prod`/`production`.

### Admin login works locally but not after a redeploy

`AdminBootstrap` creates the OWNER **only while `administrator` is empty** and only if the password is
>= 10 characters (otherwise it logs `Refusing to bootstrap an administrator: ...` and creates
nothing). Changing `ADMIN_BOOTSTRAP_PASSWORD` later does not change an existing account - use
`PUT /api/v1/admin/administrators/{id}` (which also bumps `token_version`, logging everyone out).

### 400 `{"error":"no_owner"}` on dev-login

No active `OWNER` row exists. Seed one with `ADMIN_BOOTSTRAP_*` on an empty `administrator` table.

## Checkout and orders

### 409 `{"error":"invalid_transition","message":"Cannot move an order from X to Y"}`

Source: `OrderStatusService.ALLOWED` (the single state machine, used by the panel, the Telegram buttons
and customer cancellation). Legal moves:

| From | To |
| --- | --- |
| `PENDING_CONFIRMATION` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `PROCESSING`, `CANCELLED` |
| `PROCESSING` | `OUT_FOR_DELIVERY`, `FAILED_DELIVERY`, `CANCELLED` |
| `OUT_FOR_DELIVERY` | `DELIVERED`, `FAILED_DELIVERY` |
| `FAILED_DELIVERY` | `OUT_FOR_DELIVERY`, `PROCESSING`, `CANCELLED` |
| `DELIVERED` | *(terminal)* |
| `CANCELLED` | *(terminal)* |

Backward moves are rejected by design - that is what `scripts/acceptance.mjs` scenario 7 asserts.
Related 409s: `delivered_cannot_cancel` ("A delivered order cannot be cancelled; record a refund
instead"), `already_cancelled`, `not_delivered` ("Record cash collection only after the order is
delivered"), `already_paid`, `cancelled_order`, `cancel_not_possible`, `cancel_window_closed`
(customer attempt past `store_settings.allow_customer_cancel_until`; the message includes the store
phone), `already_sent` (retrying a delivered notification), `email_taken`, and the generic `conflict`
that `ApiExceptionHandler` returns for any `DataIntegrityViolationException` (unique slug/SKU/
`idempotency_key`, etc.).

### 400 `price_changed` / `insufficient_stock` / `product_unavailable` / `variant_unavailable` / `empty_cart`

`CartAndCheckout.checkout`: prices or the delivery fee moved since the quote (the request carries
`expectedTotal`), the variant sold out, or the product is not `PUBLISHED`. Re-quote
(`POST /api/v1/checkout/quote`) and let the customer confirm the new total. Stock is reserved by
locking variant rows (`findByIdForUpdate`) in a stable order, so two shoppers cannot oversell.

### 400 `payment_method_unavailable`

Only `CASH_ON_DELIVERY` exists (`orders.payment_method` even has a `CHECK` constraint for it).

### 400 `invalid_phone`

Ethiopian numbers only, normalized by `EthiopianPhone` (`09`/`07` prefixes, 10 digits); messages say
"Enter a valid Ethiopian phone number such as 0912345678". Same check applies to the admin contact
phone in `PUT /api/v1/admin/telegram/config` (`invalid_phone`, "Admin contact must be a valid
Ethiopian number").

### 400 `undeliverable_location`

`region`/`city`/`subCity` matched no active `delivery_zone`. Add or enable the zone
(`POST /api/v1/admin/delivery-zones`, `PATCH /api/v1/admin/delivery-zones/{id}?active=true`) or fix the
address.

### Duplicate order created from one button press

The replay guard is `orders.idempotency_key` (unique). `checkout()` returns the existing order when the
key matches (`CartAndCheckout.kt:262`), and the JSON body carries `"replayed": true`
(`CheckoutResponse.replayed`, default `false`). The storefront shows a duplicate-order notice for that
case (`frontend/src/pages/storefront/OrderPlacedPage.tsx:68`). No code sets an
`X-Idempotency-Replayed` response header; the name appears only in the CORS `exposedHeaders` list in
`SecurityConfig.kt:97`, so ignore it.
Send the same key on retry; note the acceptance script sends it both in the body
(`idempotencyKey`) and as a header.

## Rate limiting (429)

`{"error":"rate_limited","message":"Too many attempts, please wait a minute"}` from
`RateLimiter.check`, applied to `ADMIN_LOGIN`, `CUSTOMER_AUTH`
(`LOGIN_ATTEMPTS_PER_MINUTE`, default 5) and `CHECKOUT`
(`CHECKOUT_ATTEMPTS_PER_MINUTE`, default 10). Buckets are fixed 1-minute windows keyed by
`"<KIND>:<request.remoteAddr>"`, in-memory, per instance.

- Log line: `Rate limit exceeded for ADMIN_LOGIN 127.0.0.1`.
- Waiting a minute clears it; there is no admin override endpoint.
- Behind a reverse proxy `remoteAddr` is the proxy address, so all users share one bucket. Short
  lockouts on a busy store usually mean this, not abuse - see `docs/DEPLOYMENT.md` section 3.
- Failed admin logins also log `Failed admin login attempt for <email>`; the response is always
  401 `unauthorized` with "Email or password is incorrect" (no account enumeration).

## Telegram

### Nothing is sent; notifications pile up

Read `GET /api/v1/admin/telegram/status` (or the same block inside
`GET /api/v1/admin/notifications`) and the outbox `last_error` column:

| `last_error` / warning | Meaning | Fix |
| --- | --- | --- |
| `telegram_admin_not_paired` | no `store_settings.telegram_chat_id` (dispatch found no chat) | pair via `/admin/telegram/pairing-code` + `/pair <code>`, or `/admin/telegram/register` |
| `telegram_bot_token_missing` | `TELEGRAM_BOT_TOKEN` empty/blank (`client.configured` false) | set the token; `botTokenConfigured` becomes true |
| `telegram_not_configured` (at enqueue) | settings not ready when the row was created; row starts in `RETRY` | pair + enable, then `POST /admin/notifications/retry-all` |
| warning "Telegram notifications are switched off in store settings." | `store_settings.telegram_enabled = false` | `PUT /admin/telegram/config {"enabled":true}` |
| warning "The bot has no paired administrator chat yet: ..." | `telegram_setup_complete = false` | pair |

Rows never send while `TELEGRAM_ENABLED=false` (the dispatcher returns before claiming).

### `POST /api/v1/telegram/auth` fails

| Status / code | Cause (from `TelegramInitDataVerifier.verify`) |
| --- | --- |
| 503 `telegram_not_configured` | no bot token on the server, so the HMAC key does not exist |
| 400 `invalid_init_data`, "Empty Telegram init data" | frontend opened outside Telegram / `initData` blank |
| 400 `invalid_init_data`, "Missing hash/auth_date/user" | malformed or stripped `initData` |
| 401 `invalid_init_data` ("signature mismatch" in the log) | wrong bot token (e.g. token rotated, or a token from another bot), or `initData` tampered with |
| 400 `init_data_expired` | `now - auth_date > INIT_DATA_MAX_AGE_SECONDS` (default 24 h). Clock skew on the server produces this too |

Checks: the server token must be the same bot the Mini App URL belongs to; the server clock must be
right (`initData.auth_date` is a Unix epoch from Telegram); the frontend must send the *raw*
`initData` string (`retrieveRawInitData()` in `frontend/src/lib/telegram.ts`), never a re-encoded one,
because the value is URL-decoded before hashing; a stale `auth_date` is fixed by reopening the Mini
App (Telegram issues fresh initData per open).

### A button press does nothing / answer is "Not allowed: ..."

`TelegramOrderActions.handle` requires `setupComplete` and `telegram_user_id == callback.from.id`;
with `TELEGRAM_ENFORCE_CALLBACK_CHAT=true` the chat must equal the paired chat too. Everything is
written to `telegram_callback_log` (`authorized`, `action`, `result`), which is the first place to
look. Log line: `Rejected Telegram callback <data> from user <id> (authorized=false)`. A second press
of the same `callback_query_id` short-circuits with "Already handled (...)". Business rejections come
from the same state machine, e.g. `deliver:` on an order that is not out for delivery →
"Not allowed: Only an order that is out for delivery can be marked delivered".

### Polling never starts, or keeps erroring

- `Telegram polling not started (enabled=..., polling=..., tokenConfigured=...)` at INFO means one of
  `TELEGRAM_ENABLED`, `TELEGRAM_POLLING_ENABLED`, or the token is off/absent. Local demo scripts set
  polling to `false`, so `/start`, pairing codes and buttons are dead by design there.
- `Telegram polling error: Telegram getUpdates failed: ...` every ~5 s. HTTP 409 from Telegram
  ("getUpdates conflict") means another poller or a configured webhook owns the stream - exactly one
  consumer may poll.
- `Telegram sendMessage failed: ... (network)` / `Telegram sendMessage unreachable` at INFO means the
  Bot API is not reachable (DNS, egress, or the stub is down); rows go to `RETRY` with backoff.

### Messages land in `DEAD_LETTER`

`markFailure` dead-letters non-retryable errors or when `attempts >= max_attempts` (8): 400
`bad_request` (chat id wrong or the user blocked/never started the bot), 401 `unauthorized` (bad
token), 403 `forbidden` (bot blocked/kicked), 404 `not_found`, and unparsed 4xx. `GET
/api/v1/admin/notifications?status=DEAD_LETTER` shows them with `last_error`, `attempts`,
`chatId`, and the full message text. Recovery: fix the cause (re-pair the chat, unblock the bot), then
`POST /admin/notifications/{id}/retry` (or `/retry-all`, which re-queues up to 200 due/failed/pending
rows and resets `attempts`), then `POST /admin/notifications/dispatch` to send immediately instead of
waiting for the next 5 s cycle. `POST /admin/orders/{id}/notification-retry` re-queues one order's
undelivered rows.

### 429 from Telegram

Honoured as a real delay: `next_attempt_at = now + retry_after + 1` seconds, error type
`flood_control`. Nothing to fix; reduce batch size (`TELEGRAM_DISPATCH_BATCH_SIZE`) if it recurs.

## Media / images

### 413 on image upload

Two different limits: the proxy or Tomcat/Spring rejects first when the body exceeds
`spring.servlet.multipart.max-file-size: 20MB` / `max-request-size: 25MB` /
`server.tomcat.max-http-form-post-size: 25MB` (raise `client_max_body_size` on nginx to at least 25m).
The application's own check answers 400 instead, and is the one an admin normally meets:

| Code | Meaning |
| --- | --- |
| `image_too_large` | above `STORAGE_MAX_UPLOAD_BYTES` (default 8 MB) - "Image must be smaller than 8 MB" |
| `unsupported_image_type` | not JPEG/PNG/WebP (content type) |
| `corrupt_image` | magic bytes do not match the claimed type |
| `empty_upload` | zero-byte file - "Choose an image file to upload" |
| `invalid_upload` | folder name escaped the upload root (defensive) |

UNVERIFIED: whether an above-limit file reaches the `image_too_large` branch at all, since Spring's
multipart parser throws first and there is no `MaxUploadSizeExceededException` handler in
`ApiExceptionHandler` (its catch-all maps unknown exceptions to 500 `server_error`). Test with a 9 MB
file and read the status; a `requestId` in the answer means it went through the catch-all.

### Uploaded image 404s

`/api/v1/media/**` is mapped by `WebConfig` to the **absolute** form of `STORAGE_LOCAL_DIR`, logged at
startup as `Serving /api/v1/media from <path>`. Relative paths resolve against the working directory,
so a service started from a different directory looks in the wrong place. Fix by setting an absolute
`STORAGE_LOCAL_DIR` and restarting. Note also that a database restore without the matching upload
directory leaves every `storage_key` dangling (files are not in the DB).

## Frontend

### Requests to `/api/...` fail with `ECONNREFUSED` in the browser console

Vite proxies `/api` to `VITE_BACKEND_URL` (default `http://127.0.0.1:8090`); the backend default port
is 8080. Align them (`SERVER_PORT=8090` or `VITE_BACKEND_URL=http://127.0.0.1:8080`).

### CORS error in the console

`ALLOWED_ORIGINS` must contain the exact origin (`scheme://host[:port]`, no trailing slash, no
wildcard path). Defaults are `http://localhost:5173,http://localhost:4173`. Custom headers that must
be listed to survive a preflight: `Authorization`, `Content-Type`, `X-Cart-Key`, `X-Idempotency-Key`,
`X-Language`.

### `npm run build` fails on an unused import

`tsconfig.json` turns on `strict`, `noUnusedLocals`, `noUnusedParameters`, and `build` runs
`tsc --noEmit` first - that is by design (`frontend/PAGE_BRIEF.md`). Run `npm run typecheck` for the
same check without bundling.

### A blank admin screen where a feature should be

No page is a placeholder: `grep -rl "data-stub=" frontend/src` returns nothing. A blank or stuck screen
is therefore a failed request, not missing UI. Check the browser network tab for a `/api/v1/admin/...`
call and read its error envelope (`{"error","message","fields","requestId"}`): `unauthorized` means the
admin token expired or was revoked (sign in again), `forbidden` means the account's role lacks that
permission, and a `429` is the login/checkout rate limiter.

## Reading logs

`scripts/run-backend.sh` and `java -jar` both log to stdout; `data/backend.log` is a captured example
of a full successful run (migrations, OWNER bootstrap, dispatch, a simulated outage). Levels:
`LOG_LEVEL` for `com.kidsstore`, `SQL_LOG_LEVEL` for `org.hibernate.SQL` (WARN by default, so no
query spam). Useful grep targets: `Bootstrapped initial OWNER`, `Telegram polling started`,
`Notification <id> delivered to Telegram (message ...)`, `Outbox <id> attempt <n> failed: ...`,
`Rate limit exceeded`, `Rejected Telegram initData`, `Constraint violation`, `Unhandled error [`.
