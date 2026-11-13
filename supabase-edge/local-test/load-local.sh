#!/usr/bin/env bash
# Loads the live STRUCTURE dump into the LOCAL Supabase started with
# `supabase start`, then creates the storage bucket and its policies and
# prints a checklist. Never connects anywhere but the local DB container.
#   supabase-edge/local-test/load-local.sh           # fresh local DB only
#   supabase-edge/local-test/load-local.sh --reset   # wipe local DB first
set -euo pipefail
# Docker Desktop's CLI isn't always on PATH (its "User" install puts it in
# ~/.docker/bin); look in its standard locations before giving up.
if ! command -v docker >/dev/null 2>&1; then
  for d in "$HOME/.docker/bin" /usr/local/bin /opt/homebrew/bin /Applications/Docker.app/Contents/Resources/bin; do
    [ -x "$d/docker" ] && { PATH="$d:$PATH"; export PATH; break; }
  done
fi
command -v docker >/dev/null 2>&1 || { echo "docker CLI not found. Is Docker Desktop installed and running?" >&2; exit 1; }
repo="$(cd "$(dirname "$0")/../.." && pwd)"
here="$repo/supabase-edge/local-test"
dump="$here/.schema/live-schema.sql"
cd "$repo"

# The local DB container `supabase start` creates for project_id
# "expense-manager" (supabase/config.toml). Talking to it via docker exec
# means no psql on the Mac and no way to point this at a remote database.
db="supabase_db_expense-manager"
docker ps --format '{{.Names}}' | grep -qx "$db" \
  || { echo "Local Supabase isn't running ($db). Run: supabase start" >&2; exit 1; }
[ -f "$dump" ] || { echo "No dump yet. Run: supabase-edge/local-test/dump-schema.sh" >&2; exit 1; }

psql_local() { docker exec -i "$db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

if [ "${1:-}" = "--reset" ]; then
  echo "[local] Resetting the LOCAL database (supabase db reset)..."
  supabase db reset
fi

if [ "$(psql_local -tAc "select to_regclass('public.receipts') is not null")" = "t" ]; then
  echo "Local DB already has the schema. Use --reset to rebuild it from the dump." >&2
  exit 1
fi

echo "[local] 1/3 Loading structure dump..."
# Live has pg_cron and pg_net enabled; locally they're available but off.
# Enabling them only creates their schemas (no jobs are scheduled), so any
# function or grant in the dump that names them still loads.
psql_local -c "create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;"
# Skipped: ALTER DEFAULT PRIVILEGES lines. They restate Supabase's standard
# defaults for the public schema (some "FOR ROLE supabase_admin"), which the
# local image already has, and the local postgres role may not set another
# role's defaults ("permission denied to change default privileges").
# Also skipped: COMMENT ON SCHEMA public (needs schema ownership; it's only
# the description "standard public schema").
skip_re='^(ALTER DEFAULT PRIVILEGES|COMMENT ON SCHEMA public )'
skipped=$(grep -cE "$skip_re" "$dump" || true)
echo "[local]     (skipping $skipped line(s): default-privilege restatements + schema comment; local image already has them)"
grep -vE "$skip_re" "$dump" | psql_local --single-transaction

echo "[local] 2/3 Creating private receipt-documents bucket..."
psql_local -c "insert into storage.buckets (id, name, public) values ('receipt-documents', 'receipt-documents', false)
               on conflict (id) do update set public = false;"

echo "[local] 3/3 Storage policies (multiuser-05, idempotent)..."
psql_local < supabase-edge/multiuser-05-storage.sql

echo "[local] Checklist:"
docker exec -i "$db" psql -U postgres -d postgres -P pager=off < "$here/verify.sql"
