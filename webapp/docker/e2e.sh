#!/usr/bin/env bash
# Local Docker test environment for the webapp. Run from anywhere:
#   webapp/docker/e2e.sh up            start the dev server (http://127.0.0.1:5180)
#   webapp/docker/e2e.sh test [args]   run the Playwright suite against it
#   webapp/docker/e2e.sh shots         run only the screenshot/visual-review spec
#   webapp/docker/e2e.sh prod [args]   build + preview the production bundle, run the suite against it
#   webapp/docker/e2e.sh report        serve the last HTML report (http://127.0.0.1:9323)
#   webapp/docker/e2e.sh logs [svc]    follow container logs (app, app-prod, deps)
#   webapp/docker/e2e.sh agent         start app + proxy, open Claude Code in its locked-down container
#   webapp/docker/e2e.sh doctor        check the claude container's boundaries (PASS/FAIL list)
#   webapp/docker/e2e.sh status        list this environment's containers
#   webapp/docker/e2e.sh down          stop containers, keep the node_modules volume
#   webapp/docker/e2e.sh clean         remove this environment's containers + volumes only
#                                      (includes Claude's login volume: you sign in again after)
# Artifacts: webapp/e2e-artifacts/{report,results,screenshots,visual-findings.json}
set -euo pipefail
# Docker Desktop's CLI isn't always on PATH (its "User" install puts it in
# ~/.docker/bin); look in its standard locations before giving up.
if ! command -v docker >/dev/null 2>&1; then
  for d in "$HOME/.docker/bin" /usr/local/bin /opt/homebrew/bin /Applications/Docker.app/Contents/Resources/bin; do
    [ -x "$d/docker" ] && { PATH="$d:$PATH"; export PATH; break; }
  done
fi
command -v docker >/dev/null 2>&1 || { echo "docker CLI not found. Is Docker Desktop installed and running?" >&2; exit 1; }
cd "$(dirname "$0")/.."            # webapp/
DC=(docker compose -f docker/compose.e2e.yaml)

host_of() { # prints only the hostname of VITE_SUPABASE_URL in a file, never the key
  [ -f "$1" ] || return 0
  grep -E '^VITE_SUPABASE_URL=' "$1" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' \
    | sed -E 's#^[a-z]+://##; s#[/:].*$##'
}

port_of() { # port of VITE_SUPABASE_URL in a file (default by scheme), never the key
  [ -f "$1" ] || return 0
  local u; u=$(grep -E '^VITE_SUPABASE_URL=' "$1" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')
  [ -n "$u" ] || return 0
  local hp=${u#*://}; hp=${hp%%/*}
  case "$hp" in *:*) echo "${hp##*:}" ;; *) case "$u" in http://*) echo 80 ;; *) echo 443 ;; esac ;; esac
}

guard() {
  local live test
  live=$(host_of .env.local); test=$(host_of .env.e2e.local)
  if [ ! -f .env.e2e.local ]; then
    echo "[e2e] No webapp/.env.e2e.local: running WITHOUT a backend (signed-out screens only)."
    echo "      Signed-in specs will self-skip. See docker/.env.e2e.example."
  elif [ -z "$test" ]; then
    echo "[e2e] .env.e2e.local has no VITE_SUPABASE_URL. Refusing to run (would be ambiguous)." >&2; exit 1
  elif [ -n "$live" ] && [ "$live" = "$test" ]; then
    echo "[e2e] .env.e2e.local points at the same Supabase project as .env.local (live)." >&2
    echo "      Refusing to run: the seed step writes receipts. Use a separate test project." >&2
    exit 1
  else
    echo "[e2e] Using test Supabase at $test:$(port_of .env.e2e.local)"
  fi
}

# Hostnames only (never keys) for the proxy allowlist and the doctor's checks.
export E2E_SUPABASE_HOST="$(host_of .env.e2e.local)"
export E2E_SUPABASE_PORT="$(port_of .env.e2e.local)"
export LIVE_SUPABASE_HOST="$(host_of .env.local)"
export GIT_AUTHOR_NAME="$(git config user.name || true)"
export GIT_AUTHOR_EMAIL="$(git config user.email || true)"
ALL=(--profile prod --profile test --profile report --profile agent)

cmd=${1:-help}; shift || true
case "$cmd" in
  up)     guard; "${DC[@]}" up -d --wait app; echo "[e2e] App: http://127.0.0.1:${E2E_APP_PORT:-5180}" ;;
  test)   guard; "${DC[@]}" up -d --wait app
          "${DC[@]}" --profile test run --rm e2e "$@" ;;
  shots)  guard; "${DC[@]}" up -d --wait app
          "${DC[@]}" --profile test run --rm e2e visual-review "$@" ;;
  prod)   guard; "${DC[@]}" --profile prod up -d --wait app-prod
          "${DC[@]}" --profile test run --rm -e E2E_TARGET_URL=http://app-prod:4173 \
            -e E2E_BASE_URL=http://app-prod:4173 e2e "$@" ;;
  agent)  guard; "${DC[@]}" --profile agent build proxy claude
          "${DC[@]}" --profile agent up -d --wait app proxy
          "${DC[@]}" --profile agent run --rm claude "$@" ;;
  doctor) guard; "${DC[@]}" --profile agent build proxy claude
          "${DC[@]}" --profile agent up -d --wait app proxy
          "${DC[@]}" --profile agent run --rm -T claude e2e-doctor ;;
  report) "${DC[@]}" --profile report up report ;;
  logs)   "${DC[@]}" logs -f --tail=200 "${@:-app}" ;;
  status) "${DC[@]}" "${ALL[@]}" ps -a ;;
  down)   "${DC[@]}" "${ALL[@]}" down ;;
  clean)  "${DC[@]}" "${ALL[@]}" down --volumes --remove-orphans ;;
  *)      sed -n '2,17p' "$0" ;;
esac
