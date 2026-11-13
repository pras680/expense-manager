#!/usr/bin/env bash
# Dumps the LIVE project's database STRUCTURE (no rows) for the local test
# backend. Read-only against live. Run on your Mac from the repo root:
#   supabase-edge/local-test/dump-schema.sh
#
# Uses pg_dump inside the already-running local DB container (no psql/pg_dump
# needed on the Mac). DATABASE_URL is read from notebooks/.env and handed to
# the container on stdin, so it never appears on a command line or on screen.
# Output (gitignored): supabase-edge/local-test/.schema/live-schema.sql
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
env_file="$repo/notebooks/.env"
out="$repo/supabase-edge/local-test/.schema/live-schema.sql"
db="supabase_db_expense-manager"

[ -f "$env_file" ] || { echo "Missing notebooks/.env (needs DATABASE_URL)." >&2; exit 1; }
url="$(grep -E '^DATABASE_URL=' "$env_file" | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')"
[ -n "$url" ] || { echo "No DATABASE_URL in notebooks/.env." >&2; exit 1; }
case "$url" in
  *127.0.0.1*|*localhost*|*host.docker.internal*)
    echo "DATABASE_URL points at a local DB; expected the live project." >&2; exit 1 ;;
esac
docker ps --format '{{.Names}}' | grep -qx "$db" \
  || { echo "Local Supabase isn't running ($db). Start it first (see README)." >&2; exit 1; }

mkdir -p "$(dirname "$out")"
tmp="$out.partial"
# --schema-only: no rows. --schema=public: only the app's own schema (auth,
# storage, cron, vault etc. are Supabase-managed and already exist locally).
# --no-owner: everything is owned by the local postgres role. GRANTs are kept,
# because PostgREST relies on them for anon/authenticated access.
printf '%s\n' "$url" | docker exec -i "$db" sh -c \
  'read -r PGURL; exec pg_dump "$PGURL" --schema-only --schema=public --no-owner' > "$tmp"

# The local database already has a public schema.
sed -i.bak -E '/^CREATE SCHEMA public;$/d' "$tmp" && rm -f "$tmp.bak"

# Belt and braces: a structure dump has no row data.
if grep -qE '^(COPY |INSERT INTO )' "$tmp"; then
  echo "Dump unexpectedly contains row data. Deleted; nothing was loaded." >&2
  rm -f "$tmp"; exit 1
fi
mv "$tmp" "$out"
echo "Structure dump written: ${out#$repo/} ($(wc -l < "$out" | tr -d ' ') lines, $(grep -c '^CREATE TABLE' "$out") tables)."
