#!/bin/sh
# Runs inside postgres:18.6 (see `make db-bootstrap`) with the repository mounted at /w.
# Creates app_owner, app_api and app_system on the database in NEON_OWNER_URL with new random
# passwords, then writes the connection settings into /w/.env. Passwords are never printed.
set -eu

ENV_FILE=/w/.env
owner_url=$(sed -n 's/^NEON_OWNER_URL=//p' "$ENV_FILE")
[ -n "$owner_url" ] || { echo "NEON_OWNER_URL is empty in .env" >&2; exit 1; }

gen() { head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-32; }
APP_OWNER_PASSWORD=$(gen)
APP_API_PASSWORD=$(gen)
APP_SYSTEM_PASSWORD=$(gen)
export APP_OWNER_PASSWORD APP_API_PASSWORD APP_SYSTEM_PASSWORD

psql "$owner_url" -X -q -f /w/infra/db/bootstrap-roles.sql

# postgresql://user:pass@host/db?params -> host (direct and pooled) and database
rest=${owner_url#*@}
host=${rest%%/*}
db_and_params=${rest#*/}
db=${db_and_params%%\?*}
direct_host=$(printf '%s' "$host" | sed 's/-pooler\././')
pooled_host=$(printf '%s' "$direct_host" | sed 's/^\([^.]*\)\./\1-pooler./')

set_var() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
set_var DB_MIGRATE_JDBC_URL "jdbc:postgresql://$direct_host/$db?sslmode=require"
set_var DB_JDBC_URL "jdbc:postgresql://$pooled_host/$db?sslmode=require"
set_var DB_APP_OWNER_PASSWORD "$APP_OWNER_PASSWORD"
set_var DB_APP_API_PASSWORD "$APP_API_PASSWORD"
set_var DB_APP_SYSTEM_PASSWORD "$APP_SYSTEM_PASSWORD"

echo "Roles app_owner, app_api, app_system ready on database '$db'; connection settings written to .env"
