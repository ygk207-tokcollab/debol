# Environment variables

Authoritative source: `backend/src/main/resources/application.yml`, every value written as
`${VAR:default}`. `backend/src/main/resources` contains only `application.yml` plus
`db/migration/` - there is **no** `application-dev.yml` / `application-prod.yml`, so the profile name
does not change any value today; it only matters for the dev-auth guard (see below).

Nothing is read from a `.env` file: no dotenv dependency exists in `build.gradle.kts`. Export the
variables or set them in the platform. Root `.env.example` is a template, not a loader.

Legend for "Prod": **must** = must be set for a working production install, **optional** = has a usable
default, **dev-only** = must stay off/false in production. **Secret** = must never appear in a client
bundle, a log line, git, or an API response.

## Database and process

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `SPRING_PROFILES_ACTIVE` | `dev` | Active Spring profile. `prod`/`production` additionally enables the dev-auth startup refusal | must be `prod` | no |
| `DB_HOST` | `127.0.0.1` | JDBC host | must | no |
| `DB_PORT` | `5433` | JDBC port (local cluster is on 5433, not 5432) | must | no |
| `DB_NAME` | `kidsstore_dev` | Database name (`kidsstore_dev`/`kidsstore_demo` locally) | must | no |
| `DB_USER` | `kidsstore` | JDBC role | must | no |
| `DB_PASSWORD` | *(empty)* | JDBC password; `run-backend.sh` refuses to start without it | must | **yes** |
| `DB_POOL_MAX` | `12` | HikariCP `maximum-pool-size` (connection timeout is fixed at 8000 ms) | optional | no |
| `SERVER_PORT` | `8080` | Tomcat port. Local tooling (vite proxy, acceptance script) assumes 8090 | optional | no |
| `LOG_LEVEL` | `INFO` | Log level for `com.kidsstore` | optional | no |
| `SQL_LOG_LEVEL` | `WARN` | Log level for `org.hibernate.SQL` | optional | no |

## Secrets

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | *(empty)* | HS256 key for admin + customer JWTs (`JwtService`). Lazy: the app boots without it and the first token issue/verify fails (`must be at least 32 bytes (set JWT_SECRET)`, surfaced as a 500). Needs >= 32 bytes | **must** | **yes** |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Bot API token. Used by `TelegramBotClient` and as the `initData` HMAC key. Absent ⇒ nothing is sent and outbox rows queue with `telegram_bot_token_missing`; `initData` login returns 503 `telegram_not_configured` | must for Telegram features | **yes** |
| `ADMIN_BOOTSTRAP_PASSWORD` | *(empty)* | First OWNER account password; only used when `administrator` is empty, min 10 characters, BCrypt(12)-hashed | must on first run, then rotate | **yes** |
| `DB_PASSWORD` | *(empty)* | see above | must | **yes** |

## Admin bootstrap and store identity

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `ADMIN_BOOTSTRAP_EMAIL` | *(empty)* | Email of the first OWNER. Without it `AdminBootstrap` logs a warning and creates nothing | must on first run | no |
| `ADMIN_BOOTSTRAP_NAME` | `Store owner` | Display name for the bootstrapped OWNER (also the audit actor label source) | optional | no |
| `CURRENCY_LABEL` | `ETB` | Bound in `AppProperties.Store.currencyLabel` but **not read by any code**; the live currency is `store_settings.currency`, set to `ETB` by V2 and editable in admin settings | optional (no effect today) | no |

## Security (`kidsstore.security.*`)

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `ADMIN_TOKEN_MINUTES` | `480` | Admin JWT lifetime | optional | no |
| `CUSTOMER_TOKEN_DAYS` | `30` | Customer JWT and `customer_session.expires_at` lifetime | optional | no |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated exact origins for the CORS source registered on `/api/**` (`SecurityConfig.corsConfigurationSource`). Methods `GET,POST,PATCH,PUT,DELETE,OPTIONS`; headers `Authorization,Content-Type,X-Cart-Key,X-Idempotency-Key,X-Language`; exposes `X-Idempotency-Replayed`; `allowCredentials=false` | **must** be the real site origins | no |
| `DEV_AUTH_ENABLED` | `false` | Enables passwordless `POST /api/v1/admin/auth/dev-login` (returns an OWNER token for the first active OWNER) | **must stay `false`** - see guard below | no |
| `ALLOW_PHONE_LOGIN` | `true` | When `false`, `SessionSource.WEB_PHONE` sessions are refused (`session_disabled`). Ownership is still proved with order number + receipt token, because no SMS/OTP provider exists | decide per deployment | no |
| `LOGIN_ATTEMPTS_PER_MINUTE` | `5` | Fixed-window limit per `remoteAddr` for `ADMIN_LOGIN` **and** `CUSTOMER_AUTH` | optional | no |
| `CHECKOUT_ATTEMPTS_PER_MINUTE` | `10` | Fixed-window limit per `remoteAddr` for `CHECKOUT` | optional | no |
| `INIT_DATA_MAX_AGE_SECONDS` | `86400` | Max accepted age of Telegram `initData.auth_date`; `init_data_expired` beyond it, `0` disables the check | optional (lower it, e.g. 3600) | no |

### The dev-auth production guard, verbatim

`backend/src/main/kotlin/com/kidsstore/config/SecurityConfig.kt`:

```kotlin
/**
 * Dev authentication must never leak into production: startup fails if it is enabled while a
 * production profile is active.
 */
@Bean
open fun devAuthGuard(): String {
    val prodLike = environment.activeProfiles.any { it.equals("prod", ignoreCase = true) || it.equals("production", ignoreCase = true) }
    if (prodLike && props.security.devAuthEnabled) {
        throw IllegalStateException("kidsstore.security.dev-auth-enabled cannot be true under a prod profile")
    }
    return "ok"
}
```

Two caveats that follow from reading this code: the check looks at **profile names only** (a
deployment running profile `live` or `staging` is not "prod-like" and gets no startup refusal), and it
is a startup check, not a runtime one - so `SPRING_PROFILES_ACTIVE=prod` plus `DEV_AUTH_ENABLED=true`
fails fast with `APPLICATION FAILED TO START`. Independently, `AdminAuthService.devLogin()` re-checks
`props.security.devAuthEnabled` per request and returns 403 `dev_login_disabled` when it is false, so
setting `DEV_AUTH_ENABLED=false` is sufficient on its own.

## Telegram (`kidsstore.telegram.*`)

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Bot API base; point at `http://127.0.0.1:9099` for the local stub | must stay the real URL | no |
| `TELEGRAM_ENABLED` | `true` | Master switch: `OutboxDispatcher.dispatch()` returns immediately when false, polling does not start | optional | no |
| `TELEGRAM_POLLING_ENABLED` | `true` | Starts `PollingWorker` (`/start`, pairing, inline buttons). Must be `false` if a webhook is used; only one instance may poll | set per topology | no |
| `TELEGRAM_POLLING_TIMEOUT_SECONDS` | `25` | Read, then clamped: `PollingWorker` passes `min(value, 5)` to `getUpdates`, which itself caps at 50 | optional | no |
| `TELEGRAM_ADMIN_CONTACT_PHONE` | `0911526922` | Admin's phone. Used as the pairing code's `requested_contact_phone` label, the bootstrapped admin's `phone`, and the fallback in `/admin/telegram/status`. It is **not** a chat id and is never used to send anything | optional | no (business contact) |
| `TELEGRAM_PAIRING_TTL_MINUTES` | `15` | Bound but **not read**: `TelegramPairingService.issueCode` hardcodes `plusMinutes(15)` | optional (no effect today) | no |
| `TELEGRAM_ENFORCE_CALLBACK_CHAT` | `true` | When true, inline-button callbacks whose `chat id` differs from the paired chat are refused (`unauthorized` in `telegram_callback_log`) | **must stay `true`** | no |
| `TELEGRAM_DISPATCH_BATCH_SIZE` | `10` | Outbox rows claimed per dispatch cycle | optional | no |
| `TELEGRAM_DISPATCH_INTERVAL_MS` | `5000` | `@Scheduled(fixedDelayString = "${kidsstore.telegram.dispatch-interval-ms:5000}")` - works as a real knob | optional | no |
| `TELEGRAM_BACKOFF_BASE_SECONDS` | `15` | Base of `base * 2^(attempts-1)`, shifted at most 12 times | optional | no |
| `TELEGRAM_BACKOFF_MAX_SECONDS` | `1800` | Backoff ceiling (a Telegram `retry_after` overrides it as `retry_after + 1`) | optional | no |
| `TELEGRAM_MAX_ATTEMPTS` | `8` | Bound but **not read**: new outbox rows are created with `maxAttempts = 8` in `NotificationService.enqueue` | optional (no effect today) | no |

## Storage (`kidsstore.storage.*`)

| Variable | Default | Purpose | Prod | Secret |
| --- | --- | --- | --- | --- |
| `STORAGE_DRIVER` | `local` | Bound but **not read**: `StorageService` always writes to the local filesystem and `WebConfig` always maps the media URL to it. `s3` has no implementation | optional (no effect today) | no |
| `STORAGE_LOCAL_DIR` | `./data/uploads` | Upload directory; relative paths resolve against the working directory. Holds binary files, not DB rows | **must** be a persistent volume | no |
| `STORAGE_PUBLIC_BASE_URL` | `/api/v1/media` | Public path prefix, mapped to the directory above with a 3600 s cache period; `permitAll` in `SecurityConfig` | optional | no |
| `STORAGE_MAX_UPLOAD_BYTES` | `8388608` | Application-level size check in `StorageService` (400 `image_too_large`). `spring.servlet.multipart.max-file-size` is 20MB / `max-request-size` 25MB and `server.tomcat.max-http-form-post-size` 25MB, all deliberately higher so oversized files reach this check and get a readable message | optional | no |

## Frontend / tooling (never reach the backend)

| Variable | Default | Read by | Purpose | Secret |
| --- | --- | --- | --- | --- |
| `VITE_BACKEND_URL` | `http://127.0.0.1:8090` | `vite.config.ts` (`process.env`, dev-server proxy target only) | Where `/api` is proxied during `npm run dev` | no |
| `VITE_PORT` | `5173` | `vite.config.ts` | Dev-server port | no |
| `VITE_API_BASE_URL` | unset → `/api/v1` | `frontend/src/lib/api.ts` (`import.meta.env`, baked in at build time) | API root for a frontend hosted apart from the backend, e.g. `https://debol-backend.onrender.com/api/v1`. Unset = same-origin, which is what `npm run dev` and an nginx setup use | no |
| `STUB_PORT` | `9099` | `scripts/telegram-stub.mjs` | Local Bot API stand-in port | no |
| `BASE_URL` | `http://127.0.0.1:8090/api/v1` | `scripts/acceptance.mjs` | API root under test | no |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `owner@kidsstore.test` / `LocalDemo2026pass` | `scripts/acceptance.mjs` | Credentials for the run (local demo values). The rebuilt local cluster now uses a different password - see `docs/SETUP-LOCAL.md` | keep local |
| `PSQL` | `C:/Program Files/PostgreSQL/18/bin/psql.exe` | `scripts/acceptance.mjs` | psql binary used for direct DB assertions | no |

`VITE_API_BASE_URL` is the only `import.meta.env` value read in `frontend/src`, and a `VITE_*` name is
public by construction: Vite inlines it into the bundle, so it can only ever hold an origin, never a
secret. `TELEGRAM_BOT_TOKEN` and `JWT_SECRET` stay backend-only - grepping `frontend/src` for them
finds nothing, and the only near-match is the response field `botTokenConfigured`, a boolean that
`GET /api/v1/admin/telegram/status` returns as `true`/`false` without the token.

