#!/usr/bin/env bash
# Boots the backend against a local PostgreSQL. Credentials come from the environment;
# the defaults below are throwaway local-dev values and must never be used anywhere real.
set -euo pipefail
cd "$(dirname "$0")/../backend"

export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5433}"
export DB_NAME="${DB_NAME:-kidsstore_dev}"
export DB_USER="${DB_USER:-kidsstore}"
export DB_PASSWORD="${DB_PASSWORD:?set DB_PASSWORD}"

if [ -z "${JWT_SECRET:-}" ]; then
  export JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=')"
  echo "JWT_SECRET was not set; generated a random one for this run only."
fi
export ADMIN_BOOTSTRAP_EMAIL="${ADMIN_BOOTSTRAP_EMAIL:-owner@example.test}"
export ADMIN_BOOTSTRAP_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-Localdev2026pass}"
export ADMIN_BOOTSTRAP_NAME="${ADMIN_BOOTSTRAP_NAME:-Store owner}"
export TELEGRAM_DISPATCH_INTERVAL_MS="${TELEGRAM_DISPATCH_INTERVAL_MS:-3000}"
export SERVER_PORT="${SERVER_PORT:-8080}"

exec ./gradlew bootRun --args="--spring.profiles.active=${SPRING_PROFILES_ACTIVE:-dev}"
