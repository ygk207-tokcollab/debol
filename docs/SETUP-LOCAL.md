# Local setup (fresh machine)

Verified against this repository on Windows 11 + Git Bash. The stack is PostgreSQL 18 (local cluster
on port 5433), Java 21, Gradle wrapper 8.13, Node 24 / npm 11.

## 0. Toolchain check

```bash
java -version    # 21.x required: build.gradle.kts sets JVM_21 for source/target/jvmTarget
node --version   # v24.x used for the recorded run; any Node with ESM support runs the .mjs scripts
npm --version
ls "C:/Program Files/PostgreSQL/18/bin/psql.exe"
```

Gradle needs no install: `backend/gradlew` fetches wrapper 8.13 from
`backend/gradle/wrapper/gradle-wrapper.properties` (`gradle-8.13-bin.zip`). All plugins and
dependencies come from Maven Central through `buildscript`/`apply` because the Gradle plugin portal
is unreachable from the development network (see the comment at the top of `build.gradle.kts`).

UNVERIFIED: whether a fully offline build works. `./gradlew --offline bootJar` can succeed only if the
Maven Central artifacts and the wrapper distribution are already in `~/.gradle/caches`. Nothing in the
repo configures offline mode. If a clean build fails on resolution, it needs network.

## 1. Database

The application connects as a single login role named `kidsstore` and picks the database with
`DB_NAME`. The local cluster has `kidsstore_dev`, `kidsstore_demo` and `kidsstore_test`; nothing in
the repository reads `kidsstore_test` (there are no backend test sources), so create only the two you
plan to use.

```bash
PGDIR="C:/Program Files/PostgreSQL/18/bin"
"$PGDIR/createuser.exe" -h 127.0.0.1 -p 5433 -SDR --pwprompt kidsstore   # -S no superuser, -D no createdb, -R no role inherit
"$PGDIR/createdb.exe"    -h 127.0.0.1 -p 5433 -O kidsstore kidsstore_dev
"$PGDIR/createdb.exe"    -h 127.0.0.1 -p 5433 -O kidsstore kidsstore_demo

# smoke test (the local demo password is `kidsstore`)
PGPASSWORD=kidsstore "$PGDIR/psql.exe" -h 127.0.0.1 -p 5433 -U kidsstore -d kidsstore_dev -c "select version()"
```

Notes:
- Port 5433 is only the default in `application.yml` (`DB_PORT:5433`); the local cluster is configured
  to listen there. `application.yml` never uses the PostgreSQL default 5432.
- The first backend start creates all 26 tables plus `flyway_schema_history`. Do not create them by
  hand. See [DATA-AND-MIGRATIONS.md](DATA-AND-MIGRATIONS.md).
- `DB_PASSWORD` has an empty default in `application.yml`, so it must be provided.

## 2. Backend

Option A - run from source (`scripts/run-backend.sh`, Git Bash):

```bash
cd kids-store
DB_PASSWORD=kidsstore \
ADMIN_BOOTSTRAP_EMAIL=owner@example.test \
ADMIN_BOOTSTRAP_PASSWORD=Localdev2026pass \
SERVER_PORT=8090 \
  ./scripts/run-backend.sh
```

What the script does (read it before trusting it):
- requires `DB_PASSWORD` (`${DB_PASSWORD:?set DB_PASSWORD}` - it exits if unset);
- defaults `DB_HOST=127.0.0.1`, `DB_PORT=5433`, `DB_NAME=kidsstore_dev`, `DB_USER=kidsstore`,
  `SERVER_PORT=8080`, `TELEGRAM_DISPATCH_INTERVAL_MS=3000`,
  `ADMIN_BOOTSTRAP_EMAIL=owner@example.test`, `ADMIN_BOOTSTRAP_PASSWORD=Localdev2026pass`;
- if `JWT_SECRET` is unset it generates a throwaway one with `head -c 48 /dev/urandom | base64` and
  prints that it is for this run only (all tokens die with the process);
- execs `./gradlew bootRun --args="--spring.profiles.active=${SPRING_PROFILES_ACTIVE:-dev}"`.

Option B - run the packaged jar (`scripts/run-demo.ps1`):

```bash
cd kids-store/backend
./gradlew bootJar      # -> backend/build/libs/kids-store-backend-0.1.0.jar
powershell -File ../scripts/run-demo.ps1
```

`run-demo.ps1` throws if that jar is missing, then sets: `DB_HOST=127.0.0.1`, `DB_PORT=5433`,
`DB_NAME=kidsstore_demo` (override with `$env:DB_NAME`), `DB_USER=kidsstore` /
`DB_PASSWORD=kidsstore`, `JWT_SECRET=local-demo-secret-please-replace-0123456789abcdef`,
`ADMIN_BOOTSTRAP_EMAIL=owner@kidsstore.test` / `ADMIN_BOOTSTRAP_PASSWORD=LocalDemo2026pass`,
`ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173`, `DEV_AUTH_ENABLED=false`,
`SERVER_PORT=8080` (override with `$env:SERVER_PORT`), `STORAGE_LOCAL_DIR=<repo>/data/uploads`,
`TELEGRAM_ENABLED=true`, `TELEGRAM_POLLING_ENABLED=false`, `TELEGRAM_DISPATCH_INTERVAL_MS=4000`,
`TELEGRAM_BACKOFF_BASE_SECONDS=10`, and the stub coordinates
`TELEGRAM_API_BASE_URL=http://127.0.0.1:9099` + `TELEGRAM_BOT_TOKEN=123456:local-demo-stub-token`.
It starts `java -jar ... --spring.profiles.active=dev`.

Every credential in both scripts is a throwaway local-dev value; none belongs in a real deployment.

Watch for these startup lines (from the recorded `data/backend.log`):

```
Migrating schema "public" to version "1 - baseline schema"
Migrating schema "public" to version "2 - configuration and sample catalog"
Successfully applied 2 migrations to schema "public", now at version v2
Bootstrapped initial OWNER account for owner@kidsstore.test
Serving /api/v1/media from C:\...\kids-store\data\uploads
Telegram polling not started (enabled=true, polling=false, tokenConfigured=true)
Tomcat started on port 8090 (http) with context path '/'
```

Startup takes about 60 s on the recorded machine. `STORAGE_LOCAL_DIR` is resolved against the working
directory when left at `./data/uploads`, so `java -jar` from `backend/` writes to
`backend/data/uploads`; the demo script avoids that with an absolute path.

## 3. Frontend

```bash
cd kids-store/frontend
npm install            # package-lock.json is committed
npm run dev            # http://localhost:5173  (VITE_PORT overrides)
```

- Real scripts only: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `typecheck`. There is
  no test script.
- `vite.config.ts` proxies `/api` to `process.env.VITE_BACKEND_URL`, default
  `http://127.0.0.1:8090`. So either start the backend with `SERVER_PORT=8090` or export
  `VITE_BACKEND_URL=http://127.0.0.1:8080` before `npm run dev`.
- The app calls relative `/api/v1` (`frontend/src/lib/api.ts`), and no `import.meta.env` variable is
  read anywhere in `frontend/src`, so nothing sensitive is baked into the bundle.
- Storefront: `http://localhost:5173/`. Admin: `http://localhost:5173/admin/login` with the
  `ADMIN_BOOTSTRAP_*` credentials.
- `npm run build` then `npm run preview` serves the production bundle on port 4173; port 4173 is
  already in the default `ALLOWED_ORIGINS`.

## 4. Telegram, locally

Without a token the backend still works: notifications queue with `last_error`
`telegram_bot_token_missing` / `telegram_admin_not_paired` and every admin Telegram status response
reports `botTokenConfigured: false`.

To exercise notifications offline, start the Bot API stand-in in its own shell:

```bash
cd kids-store/scripts
node telegram-stub.mjs        # "Telegram Bot API stub listening on 127.0.0.1:9099"
```

Run it from `scripts/`: it writes `.telegram-stub-log.jsonl` (every Bot API call it received) and
`.telegram-stub-offline` (outage flag) into the current working directory. Control endpoints:
`POST /__reset` (clear the log), `POST /__offline` (answer 500 "Simulated Bot API outage"),
`POST /__online` (resume), `GET /__log` (read recorded calls). It understands `sendMessage`,
`getUpdates` (always returns `[]`), `answerCallbackQuery`, `getMe`, `setWebhook`, `deleteWebhook`.

When to use it: any time you want notification delivery, retry and outage behaviour without a real
bot or without internet. Limits: because `getUpdates` returns nothing, chat-driven pairing and inline
buttons cannot be exercised against the stub - pair with
`POST /api/v1/admin/telegram/register` (`{"telegramUserId":777001,"chatId":777001}`) instead, which is
what `scripts/acceptance.mjs` does. For a real bot, set `TELEGRAM_BOT_TOKEN`, leave
`TELEGRAM_API_BASE_URL` at `https://api.telegram.org`, and set `TELEGRAM_POLLING_ENABLED=true` on
exactly one instance. See [TELEGRAM-SETUP.md](TELEGRAM-SETUP.md).

## 5. The recorded demo snapshot in `data/`

`data/kidsstore_demo-preseed.dump` is a **data-only** `pg_dump -Fc` of `kidsstore_demo` taken after an
acceptance run: `pg_restore --list` shows 27 `TABLE DATA` entries plus `SEQUENCE SET` items and no
`CREATE` statements. It contains `flyway_schema_history`, an `administrator` row with a demo BCrypt
hash, and the demo customers/orders/carts that run produced.

UNVERIFIED: there is no supported way to load it into a fresh database in this repo. It is data-only,
so the target schema must already exist - but a freshly migrated database already holds V2's seed rows
(unique `category.slug` / `product.slug` / `collection.slug`), so the dump's `INSERT`s collide. There is
no script that clears them first, and no schema is inside the archive.

Treat the file as (a) a backup example and (b) a way to inspect the real row shapes:

```bash
"C:/Program Files/PostgreSQL/18/bin/pg_restore.exe" --list data/kidsstore_demo-preseed.dump | head -40
```

To reproduce a demo state instead: start the backend (Flyway seeds V2) and run
`scripts/acceptance.mjs`, which creates its own product, orders and notifications.
Never restore this file against a production database.

## 6. Verify the install

```bash
curl -s http://127.0.0.1:8090/actuator/health          # {"status":"UP"}
curl -s http://127.0.0.1:8090/api/v1/store | head -c 300
curl -s -X POST http://127.0.0.1:8090/api/v1/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@kidsstore.test","password":"<see section 7>"}' | head -c 200
```

The current local password for `owner@kidsstore.test` and `demo@kidsstore.test` is **not**
`LocalDemo2026pass` any more: it was rotated on 2026-10-14 and recorded in `../.env.local`
(git-ignored). `scripts/run-demo.ps1` still bootstraps `LocalDemo2026pass`, but only when the
`administrator` table is empty, so a rebuilt database gets that password again.

Then run the full 12-scenario acceptance check: [ACCEPTANCE.md](ACCEPTANCE.md). If you rotated the
password, pass it in for that run: `ADMIN_PASSWORD='<your password>' node scripts/acceptance.mjs`.

## 7. If you forget the admin password

Passwords are BCrypt (cost 12) hashes in `administrator.password_hash`, and this app has **no**
forgot-password flow - there is no mail or SMS provider to send a reset link through. So recovery means
either using another account that still works, or writing a new hash directly.

**A. Another administrator still can sign in.** Log in, open **People**, edit the locked account and set
a new password (10+ characters). `AdminOpsService` re-hashes it with the same encoder and bumps
`token_version`, which signs that account's existing tokens out.

**B. Nobody can sign in.** Hash a new password with the exact encoder the app uses
(`BCryptPasswordEncoder(12)`), then write it with `psql`. Verified against `kidsstore_demo`:

```bash
# 1. one-off hasher - spring-jcl is required, BCrypt logs through commons-logging
CRYPTO=$(ls ~/.gradle/caches/modules-2/files-2.1/org.springframework.security/spring-security-crypto/*/spring-security-crypto-*.jar | head -1)
JCL=$(ls ~/.gradle/caches/modules-2/files-2.1/org.springframework/spring-jcl/*/spring-jcl-*.jar | head -1)
cat > /tmp/HashAdminPassword.java <<'EOF'
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
public class HashAdminPassword {
  public static void main(String[] a) { System.out.println(new BCryptPasswordEncoder(12).encode(a[0])); }
}
EOF
java -cp "$CRYPTO;$JCL" /tmp/HashAdminPassword.java 'Replace-With-Your-New-Password'
```

Git Bash yields `/c/...` paths and the Windows JVM wants `C:\...`; if Java says it cannot find
`BCryptPasswordEncoder`, pipe both jars through `cygpath -w` before building `-cp`. The classpath
separator is `;` on Windows and `:` under Linux/WSL.

```bash
# 2. apply it. Single quotes, not double: bash expands the $2a$... prefix inside double quotes.
"/c/Program Files/PostgreSQL/18/bin/psql.exe" -h 127.0.0.1 -p 5433 -U kidsstore -d kidsstore_demo \
  -v ON_ERROR_STOP=1 \
  -c "UPDATE administrator SET token_version = token_version + 1,
      password_hash = '<the hash from step 1>' WHERE email = 'owner@kidsstore.test';"
```

Then sign in at `/admin` and confirm `POST /api/v1/admin/auth/login` returns 200. Notes:

- `token_version = token_version + 1` is what logs old sessions out. The `administrator` table has no
  `updated_at` column, so do not add one to the statement.
- There is no endpoint that does this for you: `POST /api/v1/admin/administrators` and
  `PUT /api/v1/admin/administrators/{id}` (`AdminOpsService`) can set a password, but both require an
  authorized admin token, which is exactly what you no longer have.
- Same two statements work against a production database via `psql` with the Render credentials - that
  is a direct data change outside the app, so take a `pg_dump` first and record who did it.
- Do not "fix" a forgotten production password by emptying the `administrator` table just so
  `ADMIN_BOOTSTRAP_*` fires again: you lose every account and the audit trail with them.
- If you use this procedure, update `../.env.local` and any script that logs in
  (`scripts/acceptance.mjs` reads `ADMIN_EMAIL`/`ADMIN_PASSWORD`).

## 8. Ports in use

| Port | Service |
| --- | --- |
| 5433 | PostgreSQL (local cluster; `DB_PORT`) |
| 8080 | backend default (`SERVER_PORT`) |
| 8090 | port used by the vite proxy default and `scripts/acceptance.mjs` |
| 5173 | Vite dev server (`VITE_PORT`, in default `ALLOWED_ORIGINS`) |
| 4173 | `vite preview` (in default `ALLOWED_ORIGINS`) |
| 9099 | Telegram Bot API stub (`STUB_PORT`) |

Check before starting: `netstat -ano | findstr ":5433 :8080 :8090 :9099"` (Windows) - see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the port-in-use failure.
