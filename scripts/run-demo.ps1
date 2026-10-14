$ErrorActionPreference = "Stop"

# Local demo launcher. Everything here is a throwaway development value; nothing in this file
# belongs in a real deployment, where the same settings arrive as platform environment variables.
$dbName    = if ($env:DB_NAME) { $env:DB_NAME } else { "kidsstore_demo" }
$port      = if ($env:SERVER_PORT) { $env:SERVER_PORT } else { "8080" }
$jar       = Join-Path $PSScriptRoot "..\backend\build\libs\kids-store-backend-0.1.0.jar"

if (-not (Test-Path $jar)) { throw "Backend jar not found. Run: ./gradlew bootJar  (in kids-store/backend)" }

$secret = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { "local-demo-secret-please-replace-0123456789abcdef" }

$env:DB_HOST                 = "127.0.0.1"
$env:DB_PORT                 = "5433"
$env:DB_NAME                 = $dbName
$env:DB_USER                 = if ($env:DB_USER) { $env:DB_USER } else { "kidsstore" }
$env:DB_PASSWORD             = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "kidsstore" }
$env:JWT_SECRET              = $secret
$env:ADMIN_BOOTSTRAP_EMAIL   = if ($env:ADMIN_BOOTSTRAP_EMAIL) { $env:ADMIN_BOOTSTRAP_EMAIL } else { "owner@kidsstore.test" }
$env:ADMIN_BOOTSTRAP_PASSWORD= if ($env:ADMIN_BOOTSTRAP_PASSWORD) { $env:ADMIN_BOOTSTRAP_PASSWORD } else { "LocalDemo2026pass" }
$env:ADMIN_BOOTSTRAP_NAME    = "Store owner"
$env:ALLOWED_ORIGINS         = "http://localhost:5173,http://localhost:4173"
$env:DEV_AUTH_ENABLED        = "false"
$env:SERVER_PORT             = $port
$env:STORAGE_LOCAL_DIR       = Join-Path $PSScriptRoot "..\data\uploads"
$env:TELEGRAM_ENABLED        = "true"
$env:TELEGRAM_POLLING_ENABLED= "false"
$env:TELEGRAM_DISPATCH_INTERVAL_MS = "4000"
$env:TELEGRAM_BACKOFF_BASE_SECONDS = "10"
# Points at the local Bot API stand-in in scripts/telegram-stub.mjs. A real deployment uses
# https://api.telegram.org and a BotFather token supplied through the environment.
$env:TELEGRAM_API_BASE_URL   = if ($env:TELEGRAM_API_BASE_URL) { $env:TELEGRAM_API_BASE_URL } else { "http://127.0.0.1:9099" }
$env:TELEGRAM_BOT_TOKEN      = if ($env:TELEGRAM_BOT_TOKEN) { $env:TELEGRAM_BOT_TOKEN } else { "123456:local-demo-stub-token" }

Write-Host "Booting kids-store backend on http://localhost:$port against database '$dbName'"
& java -jar $jar --spring.profiles.active=dev
