# Deployment

Two supported shapes:

- **one origin** (nginx or any proxy in front of the jar plus `frontend/dist`) - sections 1-9;
- **Cloudflare Pages for the storefront + Render for the API** - section 10. That path is the one this
  repo now ships artifacts for: `backend/Dockerfile` and `render.yaml`.

There is still no Terraform, compose file or CI config here (verified by search). Commands below are
the real build/run commands for the artifacts this repo produces; anything platform-specific (process
manager, TLS certificates, bucket) is marked as an example you must adapt. The Dockerfile has not been
built or run from this machine - Docker is not installed here - so treat the first Render build as the
verification step and read its logs.

## 1. Build the backend jar

```bash
cd kids-store/backend
./gradlew clean bootJar        # Windows cmd: gradlew.bat clean bootJar
# -> backend/build/libs/kids-store-backend-0.1.0.jar  (version 0.1.0 comes from build.gradle.kts)
```

Requirements: JDK 21 (`sourceCompatibility`/`targetCompatibility`/`jvmTarget` are all `VERSION_21`).
`./gradlew test` runs the JUnit 5 suite under `backend/src/test` (9 test classes, 65 tests) against the
`test` profile and the real `kidsstore_test` database; `scripts/acceptance.mjs` + `docs/ACCEPTANCE.md`
remain the end-to-end gate.

Run it:

```bash
java -jar kids-store-backend-0.1.0.jar --spring.profiles.active=prod
```

Profile notes: use `prod` or `production`. With either active, startup is refused if
`DEV_AUTH_ENABLED=true` (`SecurityConfig.devAuthGuard`). There are no `application-prod.yml` /
`application-dev.yml` files, so the profile changes nothing else - every setting comes from
environment variables (see `docs/ENVIRONMENT.md`).

The app needs no servlet container (embedded Tomcat) and no external `WEB-INF`. `server.port` comes
from `SERVER_PORT` (default 8080). `server.error.include-stacktrace: never` and
`include-message: never` are already set, so error bodies stay generic.

## 2. Build and host the frontend

```bash
cd kids-store/frontend
npm ci
npm run build          # tsc --noEmit && vite build
# -> frontend/dist  (sourcemaps are generated: build.sourcemap = true)
```

`frontend/dist` is a plain static bundle. It calls **relative** `/api/v1` paths by default
(`frontend/src/lib/api.ts`), so on a single origin there is nothing to configure. When the frontend is
hosted apart from the API, set `VITE_API_BASE_URL=https://<api-host>/api/v1` at build time; that is the
only `import.meta.env` value in `frontend/src`, and it is inlined into public JS - never put a secret
in it. No other secret can leak from the bundle: the bot token and JWT secret are read only by Spring.

On a split origin, `ALLOWED_ORIGINS` on the backend must list the frontend origin exactly, because
every `/api/v1` call then becomes a cross-origin request (see section 3).

The backend does **not** serve the SPA: `WebConfig.addResourceHandlers` maps only
`STORAGE_PUBLIC_BASE_URL` (`/api/v1/media/**`) to the upload directory. So the static host must:

- serve `index.html` for unknown paths (client-side routes are `/`, `/products/:slug`, `/cart`,
  `/checkout`, `/order/:orderNumber`, `/track`, `/account`, `/admin/...`) - `index.html` has no
  `<base>` tag, so absolute-path fallbacks must land on `index.html`;
- leave `/api/*` and `/actuator/*` to the backend;
- be reachable over HTTPS at the exact origin you register in BotFather and put in `ALLOWED_ORIGINS`.

## 3. Reverse proxy + HTTPS

Telegram requires the Mini App URL to be served over HTTPS (Telegram platform requirement, not a
check in this code), and `initData` is only as trustworthy as the bot token plus the freshness window -
so no HTTP-only production origin.

Example nginx shape (adjust paths/certs; nothing here is shipped by this repo):

```nginx
server {
  listen 443 ssl http2;
  server_name shop.example.et;                    # your real origin
  client_max_body_size 12m;                        # >= spring.servlet.multipart.max-request-size

  root /var/www/kids-store/frontend/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;              # SPA fallback
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;                        # Telegram polling holds requests up to 5s
  }

  location /actuator/health { proxy_pass http://127.0.0.1:8080; }   # LB health checks
}
server { listen 80; server_name shop.example.et; return 301 https://$host$request_uri; }
```

Two verified details that bite:

- **Body size**: `spring.servlet.multipart.max-file-size: 20MB`, `max-request-size: 25MB`,
  `server.tomcat.max-http-form-post-size: 25MB`. Those container limits sit above
  `STORAGE_MAX_UPLOAD_BYTES` (8 MB) on purpose so an oversized image gets the app's own
  `image_too_large` message instead of a bare 413. A smaller proxy limit turns image uploads into
  413s before the backend ever sees them, so nginx `client_max_body_size` should be at least 25m.
- **Client IP for rate limiting**: `RateLimiter` and the admin login audit use
  `HttpServletRequest.remoteAddr`, and there is no `server.forward-headers-strategy` setting in
  `application.yml`. Behind a proxy all users share the proxy IP, so
  `LOGIN_ATTEMPTS_PER_MINUTE=5` will lock out the whole store within a minute of traffic. UNVERIFIED
  fix: either set `SERVER_FORWARD_HEADERS_STRATEGY` (not present in `application.yml` today), move
  the limit to the proxy, or raise the value - do not assume `X-Forwarded-For` is honored, because it
  is not read by this code.

CORS: `ALLOWED_ORIGINS` is a comma-separated list of **exact** origins applied to `/api/**` (no
wildcards, no trailing slash, no paths). For a single-origin deploy the browser never sends a
cross-origin preflight, but set it anyway to the storefront and admin origins, e.g.
`https://shop.example.et`. `allowCredentials=false`, allowed methods
`GET, POST, PATCH, PUT, DELETE, OPTIONS`, allowed headers `Authorization, Content-Type, X-Cart-Key,
X-Idempotency-Key`, exposed `X-Idempotency-Replayed`, max-age 3600 (`SecurityConfig`
`corsConfigurationSource`). The client never sends `Accept-Language`/`X-Language`, so nothing else has
to be added to that list for the current frontend.

## 4. PostgreSQL

- Version: the recorded local run was PostgreSQL 18.6 and the DDL is PostgreSQL 14+ syntax. Flyway
  logs a compatibility warning on 18 (`latest supported version is 17`) but applies V1/V2 fine.
- Network: `DB_HOST`/`DB_PORT` (the local dev cluster uses 5433; use whatever your managed service
  gives you) and `DB_NAME`/`DB_USER`/`DB_PASSWORD`.
- The role needs: `CREATE`/`CONNECT` on its own schema, `CREATE` on the database for the first run
  (Flyway creates 26 tables + `flyway_schema_history`), and `USAGE` on the schema. It does **not**
  need superuser. Locally the role was created with `-SDR` (no superuser, no createdb, no inherit).
- Pool: `DB_POOL_MAX` (default 12), fixed 8 s connection timeout, pool name `kidsstore-pool`. Size it
  below the server's `max_connections`, especially with more than one instance.
- Time: `hibernate.jdbc.time_zone: UTC` and all columns are `TIMESTAMPTZ`; keep the server on UTC.
- Migrations run at boot with `ddl-auto: validate`, so the jar must connect to a database it can
  migrate. **Do not let several instances race the first migration**: start exactly one instance to
  completion (log line `Successfully applied N migrations ... now at version vN`), then start the rest.
- Never point a production URL at a local `application.yml` default; the defaults
  (`127.0.0.1:5433`, `kidsstore_dev`) are dev conveniences.

## 5. Uploads

`StorageService` writes JPEG/PNG/WebP (magic bytes verified) into
`{STORAGE_LOCAL_DIR}/{folder}/{uuid}.{ext}` and the DB keeps only `storage_key` + `url`
(`/api/v1/media/{folder}/{file}`). `WebConfig` serves that directory back with a 3600 s cache period.

- `STORAGE_LOCAL_DIR` must be a persistent shared volume if you run more than one instance, otherwise
  an image uploaded by instance A is missing on instance B.
- Relative values resolve against the process working directory; give an absolute path.
- `STORAGE_DRIVER=s3` is **not implemented**: `driver` is bound but never read; the local filesystem
  is the only driver. Plan disk, or add a bucket driver before scaling out.
- Deleting a product/image removes the file best-effort (`StorageService.delete` swallows failures), so
  include the uploads directory in backups regardless.

## 6. Rollout order

1. Backup (see section 8).
2. Remove sample data if this is the first production load:
   `docs/DATA-AND-MIGRATIONS.md` (or ship a `V3__remove_sample_catalog.sql`).
3. Set the environment (secrets from the platform store): `SPRING_PROFILES_ACTIVE=prod`, DB vars,
   `JWT_SECRET` (>= 32 bytes, stable across restarts and instances), `SERVER_PORT`,
   `ALLOWED_ORIGINS`, `TELEGRAM_*` (`TELEGRAM_POLLING_ENABLED=true` on **one** instance only,
   `TELEGRAM_API_BASE_URL=https://api.telegram.org`), `STORAGE_LOCAL_DIR`, `ADMIN_BOOTSTRAP_*` (first
   run only), `DEV_AUTH_ENABLED=false`, `INIT_DATA_MAX_AGE_SECONDS`, `LOG_LEVEL`.
4. Deploy the jar and start a single instance; Flyway migrates and `AdminBootstrap` may create the
   first OWNER (only when `administrator` is empty).
5. Verify: `GET /actuator/health` → `{"status":"UP"}`,
   `GET /api/v1/store` returns the store payload,
   `POST /api/v1/admin/auth/login` returns a token,
   `GET /api/v1/admin/telegram/status` shows `botTokenConfigured: true` and `ready: true`,
   `POST /api/v1/admin/notifications/test` + `/dispatch` delivers to the paired chat.
6. Pair the admin chat if `setupComplete` is false (`docs/TELEGRAM-SETUP.md`).
7. Deploy the frontend bundle to the static host and confirm the origin matches `ALLOWED_ORIGINS`
   and the BotFather Web App URL.
8. Scale to the remaining instances (they must not run migrations concurrently).
9. Delete or rotate `ADMIN_BOOTSTRAP_PASSWORD` from the environment now that the account exists, and
   confirm the admin can log in.

Rollback: the schema is forward-only (Flyway has no undo here). To roll back code, redeploy the
previous jar - but only if it is compatible with the current schema; a new migration is not reverted.
Restoring the pre-deploy dump is the only full rollback of data.

## 7. Health, docs and observability

| Endpoint | Notes |
| --- | --- |
| `GET /actuator/health` | enabled, `show-details: never` → `{"status":"UP"}` (LivenessState/ReadinessState included in the aggregate status only) |
| `GET /actuator/health/liveness`, `/readiness` | probes are enabled (`management.endpoint.health.probes.enabled: true`); path is allowed by `SecurityConfig` |
| `GET /actuator/info` | exposed, no data configured |
| `GET /v3/api-docs` | OpenAPI 3 JSON (springdoc), `permitAll`, bearer scheme declared |
| `GET /swagger-ui.html` | Swagger UI, `permitAll` |

Only `health` and `info` are exposed from the actuator. Both Swagger endpoints are public by
configuration; startup logs the recommendation to disable them in production:

```
SpringDoc /v3/api-docs endpoint is enabled by default. To disable it in production, set the property 'springdoc.api-docs.enabled=false'
```

If you keep them public, at minimum put `/swagger-ui.html` and `/v3/api-docs` behind the proxy's basic
auth or IP allowlist, or set `SPRINGDOC_API_DOCS_ENABLED=false` /
`SPRINGDOC_SWAGGER_UI_ENABLED=false` (Spring Boot relaxed binding accepts these as env vars; UNVERIFIED
in this repo because no deploy sets them).

Logging: `logging.level.com.kidsstore=${LOG_LEVEL:INFO}`, `org.hibernate.SQL=${SQL_LOG_LEVEL:WARN}`.
Unhandled errors log `Unhandled error [<8-char ref>]` and return that ref as `requestId` in the body,
with no stack trace or DB detail to the caller - quote the ref when reporting incidents.
`TelegramBotClient` logs failures without the token.

## 8. Backups

```bash
pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f kidsstore-$(date +%F).dump
```

Include `STORAGE_LOCAL_DIR` (image files are not in the database). `data/kidsstore_demo-preseed.dump`
in the repo is a demo snapshot, not a backup, and it contains a BCrypt hash for a demo password -
do not ship it. Schedule dumps off-box and test one restore on a scratch database before you need it.

## 9. Production checklist

- [ ] `SPRING_PROFILES_ACTIVE=prod` (or `production`) and `DEV_AUTH_ENABLED=false`. The startup guard
      only fires on those exact profile names, so verify
      `POST /api/v1/admin/auth/dev-login` returns 403 `dev_login_disabled`.
- [ ] `JWT_SECRET` rotated to a real >= 32-byte value, stored in the secret store, identical across
      instances, never logged. All previously issued tokens invalidate when it changes.
- [ ] `TELEGRAM_BOT_TOKEN` present, production token, not the stub token
      (`123456:local-demo-stub-token`), `TELEGRAM_API_BASE_URL=https://api.telegram.org`,
      `TELEGRAM_ENFORCE_CALLBACK_CHAT=true`, polling on exactly one instance.
- [ ] Neither secret appears in `frontend/dist` (grep the bundle: `grep -r "botToken\|JWT_SECRET" dist`),
      in CI logs, or in git.
- [ ] `DB_PASSWORD` set to a real credential; `DB_HOST`/`DB_PORT` point at the production cluster.
- [ ] Local demo credentials from `scripts/run-backend.sh` / `scripts/run-demo.ps1`
      (`owner@example.test`, `owner@kidsstore.test`, `Localdev2026pass`, `LocalDemo2026pass`) do not
      work: `GET /api/v1/admin/administrators` lists only intended accounts, all active, and the
      demo ones are deactivated or deleted.
- [ ] Sample catalogue removed (`SELECT count(*) FROM product WHERE is_sample;` → 0) and the
      storefront no longer shows "Sample catalogue item" badges.
- [ ] `store_settings` updated for real: `store_name_en` (V4 seeds it as `Debol`), `tagline_en`,
      `contact_phone`, `contact_email`,
      `mini_app_url`, `bot_username`, `admin_notify_url`, `free_delivery_over`, delivery zone fees,
      `telegram_setup_complete` true via a fresh pairing code.
- [ ] `ALLOWED_ORIGINS` = real origins only; `localhost` entries gone.
- [ ] Backups scheduled and a restore rehearsed; `STORAGE_LOCAL_DIR` on a persistent volume with a
      documented size trend.
- [ ] `GET /actuator/health` monitored; `notification_outbox` `DEAD_LETTER` count monitored (it is
      surfaced in `GET /api/v1/admin/notifications` `counts` and on the dashboard).
- [ ] Proxy `client_max_body_size` >= 12 MB; SPA fallback configured; HTTP redirects to HTTPS.
- [ ] Rate limiting handled consciously (see the `remoteAddr` caveat in section 3).
- [ ] No `.env` file committed (root `.gitignore` covers `.env`, `.env.*`, `*.env`, `data/uploads/`,
      logs and the stub artifacts); only `.env.example` is tracked.
- [ ] On the Pages + Render split: `VITE_API_BASE_URL` is in the Pages build env, `ALLOWED_ORIGINS`
      lists the Pages origin, and an image upload has been run through the live admin panel.

## 10. Cloudflare Pages (storefront) + Render (API)

Artifacts this repo ships for that split: `backend/Dockerfile`, `backend/.dockerignore`,
`render.yaml` (repo root), `frontend/public/_redirects`.

**Unverified here:** this machine has no Docker, so the image has never been built or run locally, and
nothing in `render.yaml` has been applied to a real Render account. The first Render build is the test
- read its log rather than assuming it worked. What *is* verified locally: the jar builds
(`./gradlew bootJar`), the suite passes (`./gradlew test` - 65 tests, 0 failures), and `npm run build`
succeeds with `VITE_API_BASE_URL` set, with that origin appearing once inside `dist/assets/*.js`.

### 10.1 Who serves what

| Piece | Host | Notes |
| --- | --- | --- |
| `frontend/dist` | Cloudflare Pages | static only; no Pages Function, no `/api` proxy |
| Spring Boot jar in Docker | Render web service | `render.yaml` → `debol-backend` |
| PostgreSQL | Neon (external) | connected by `SPRING_DATASOURCE_URL`; `render.yaml` provisions no database |
| Uploaded images | Render disk at `/app/data/uploads` | `STORAGE_LOCAL_DIR` is baked into the image |
| Media files back to browsers | Render `/api/v1/media/**` | `permitAll`, 3600 s cache, rewritten to the API origin by `assetUrl()` |

### 10.2 Render

1. Push the project to GitHub (Render builds from a repo; a zip cannot be deployed).
2. Edit `render.yaml` first: two placeholders remain in the file -
   `REPLACE-WITH-YOUR-PAGES-PROJECT.pages.dev` (the real Pages origin) and `REPLACE-WITH-OWNER-EMAIL`
   (the bootstrap admin address). The database URI is *not* in the file; see step 4.
3. Render dashboard → New + → Blueprint → connect the repo. It reads `render.yaml` and creates the web
   service only; the database lives outside Render.
4. `sync: false` marks variables that are deliberately blank in the file, so paste them in the
   service's Environment tab and redeploy: `JWT_SECRET` (>= 32 bytes, e.g. `openssl rand -base64 48`),
   `TELEGRAM_BOT_TOKEN`, `ADMIN_BOOTSTRAP_PASSWORD` (>= 10 characters) and `SPRING_DATASOURCE_URL`
   (the Neon URI). Never put real values in `render.yaml` - that last one contains the database
   password.
5. Neon is pasted as one variable, rewritten into query-parameter form. Take Connection Details'
   **pooled** URI,
   `postgresql://USER:PASS@ep-xxx-pooler.<region>.aws.neon.tech/<db>?sslmode=require`, and write it as
   `jdbc:postgresql://ep-xxx-pooler.<region>.aws.neon.tech/<db>?user=USER&password=PASS&sslmode=require`.
   Do **not** leave the credentials in front of the host: pgjdbc 42.7.11 - the version this build
   resolves - treats `USER:PASS@ep-xxx…` as the hostname and dies with `UnknownHostException`. Verified
   locally against the driver jar; `?user=&password=` form connects, `user:pass@host` form does not.
   URL-encode the password if it contains `&`, `%` or `#`.
6. Watch the first build: `gradlew bootJar` downloads Gradle 8.13 and Maven Central artifacts, so it is
   slow; then Flyway applies V1-V4 and `AdminBootstrap` creates the OWNER only if `administrator` is
   empty.
7. Health check is `/actuator/health` → `{"status":"UP"}`. Copy the `*.onrender.com` URL for step 10.3.

Plan notes, all of them real constraints:

- `plan: 0.5c-1g` for the web service. Render's free instances sleep after inactivity, which stalls
  Telegram long-polling and adds a cold start to the shopper's first request. Nothing is lost -
  `notification_outbox` rows stay `PENDING` and retry with backoff once the process wakes - but
  notifications are late.
- Render Disks need a paid instance and mount root-owned, which is why the image's runtime stage does
  not drop to a non-root `USER`. If Render rejects the `disk:` block on your plan, either upgrade or
  delete it - and then uploaded images disappear on every redeploy, since the container filesystem is
  ephemeral.
- The database is Neon, so it is not a Render resource and the blueprint does not provision it. Three
  consequences: put a **pooled** endpoint in `SPRING_DATASOURCE_URL` (the direct one counts every Hikari
  connection against Neon's limit and `DB_POOL_MAX=10` will hit it sooner); disable or lengthen Neon's
  autosuspend, because a suspended branch drops the pooled connections the app is still holding; and
  choose a Neon region next to the Render region (`singapore` ↔ `aws-ap-southeast-1`) since every query
  crosses clouds. Neon's free tier is not a production database - restore/pit options and the retention
  window are on the paid plans, and `docs/DATA-AND-MIGRATIONS.md` covers `pg_dump` in the meantime.
- Because Render's Postgres is no longer used, there is no `databases:` block and no
  `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`. Do not add them back: `SPRING_DATASOURCE_URL` overrides
  the `application.yml` template wholesale, and a defined-but-empty `DB_USER` resolves to a blank
  username instead of falling back to the default.
- One instance only while `TELEGRAM_POLLING_ENABLED=true`. Scaling out needs polling off on all but one
  (and a shared volume for uploads).

### 10.3 Cloudflare Pages

1. Workers + Pages → Create project → connect the same repo.
2. Framework preset: **None** (Vite is detected but the defaults are wrong here). Settings:
   - Root directory: `frontend`
   - Build command: `npm run build` (that is `tsc --noEmit && vite build`)
   - Output directory: `dist`
3. Build environment variables:
   - `NODE_VERSION=22` - Vite 7 needs Node 20.19+/22.12+; the Pages default image may hand you an
     older Node and the build then fails outright.
   - `VITE_API_BASE_URL=https://<the-onrender-host>/api/v1` (scheme + host + `/api/v1`, no trailing
     slash needed - it is stripped in `src/lib/api.ts`).
4. `frontend/public/_redirects` is copied to the dist root and gives the SPA fallback, so `/products/…`
   and `/admin/…` deep links resolve. It is a `200` rewrite, not a `301`, so the URL stays shareable.
   The file contains exactly one rule and no comments: comment syntax in `_redirects` was not verified
   against Cloudflare, and a line the parser misreads would cost you the fallback.
5. Add a custom domain if you have one, then put that exact origin into Render's `ALLOWED_ORIGINS`
   (comma separated for more than one, `https://`, no trailing slash) and restart the service.
6. Telegram: the Web App / Mini App URL in BotFather must be the Pages origin you actually open, and
   `store_settings.mini_app_url` (admin → Settings) should match it.

### 10.4 Consequences of the split, checked in code

- Every API call is cross-origin, so the browser sends a preflight. `SecurityConfig` answers it for
  `/api/**` with `allowCredentials=false`; the app authenticates with `Authorization: Bearer`, not
  cookies, so nothing else is needed.
- `frontend/src/lib/api.ts` reads `VITE_API_BASE_URL`; unset means relative `/api/v1`, which keeps
  `npm run dev` (Vite proxy to `127.0.0.1:8090`) and any single-origin deploy working unchanged.
- Image URLs the backend stores as `/api/v1/media/…` are rewritten onto the API origin by `assetUrl()`
  (`ProductImage`, `AdminProductsPage`, `AdminProductEditorPage`). Leave `STORAGE_PUBLIC_BASE_URL`
  relative so the DB keeps origin-independent values.
- Multipart image upload posts straight to Render through `buildUrl()`. Verify one after the first
  deploy: the app rejects files over `STORAGE_MAX_UPLOAD_BYTES` (8 MB) with a readable message, and any
  limit between the browser and the jar would show up as a bare 413 instead.
- Rate limits key on `request.remoteAddr`, which behind Render is Render's own proxy IP - shared by
  every visitor. `render.yaml` therefore raises `LOGIN_ATTEMPTS_PER_MINUTE`/`CHECKOUT_ATTEMPTS_PER_MINUTE`
  instead of leaving the local defaults in place; see section 3 for why `X-Forwarded-For` is not read.

### 10.5 Prove the deployment

```bash
curl -s https://<render-host>/actuator/health
curl -s https://<render-host>/api/v1/store | head -c 300
curl -s -X POST https://<render-host>/api/v1/admin/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"<bootstrap admin>","password":"<ADMIN_BOOTSTRAP_PASSWORD>"}' | head -c 200
curl -sI https://<pages-origin>/products/<a-real-slug> | head -3     # 200 + text/html, not 404
```

Then in the browser: hard-load the Pages URL, open a product page (cross-origin image requests must be
`200` from the Render host), sign in at `/admin`, upload one product image, place one cash-on-delivery
order and confirm the Telegram message arrives. Once the account exists, clear
`ADMIN_BOOTSTRAP_PASSWORD` from the environment.
