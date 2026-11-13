#!/bin/sh
# Starts the webapp inside the container. Without .env.e2e.local, Supabase
# points at an unroutable placeholder so the app renders its signed-out
# screens and can never reach the live project. Output is also written to
# e2e-artifacts/logs/ so Claude (no docker logs access) can read it.
set -eu
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-http://supabase.invalid}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-e2e-placeholder}"
mkdir -p e2e-artifacts/logs
mode="${1:-dev}"
log="e2e-artifacts/logs/app-$mode.log"
case "$mode" in
  dev)  npx vite --host 0.0.0.0 --port 5173 --strictPort 2>&1 | tee "$log" ;;
  prod)
    # Same steps as `npm run build`, but output stays inside the container
    # (/build) so the host's webapp/dist is left alone.
    { npx tsc -b && npx vite build --outDir /build/dist --emptyOutDir; } 2>&1 | tee "$log"
    [ -f /build/dist/index.html ] || { echo "[app-prod] build failed, see $log" >&2; exit 1; }
    npx vite preview --outDir /build/dist --host 0.0.0.0 --port 4173 --strictPort 2>&1 | tee -a "$log" ;;
esac
