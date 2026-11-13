#!/bin/sh
# Runs Playwright against $E2E_BASE_URL; artifacts go to webapp/e2e-artifacts/.
set -eu
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-http://supabase.invalid}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-e2e-placeholder}"
rm -rf e2e-artifacts/screenshots e2e-artifacts/visual-findings.json
mkdir -p e2e-artifacts
exec npx playwright test --output e2e-artifacts/results "$@"
