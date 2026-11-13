#!/bin/bash
# Verifies the claude container's boundaries. Prints PASS/FAIL per check.
# Usage (inside the container): e2e-doctor
fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }
reach() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1" | grep -qv '^000$'; }
check "runs as non-root (uid $(id -u))"             '[ "$(id -u)" != 0 ]'
check "no Docker socket"                             '[ ! -e /var/run/docker.sock ]'
check "no docker CLI"                                '! command -v docker'
check "webapp/.env.local masked (empty)"             '[ ! -s /workspace/webapp/.env.local ]'
check "notebooks/.env masked (empty)"                '[ ! -s /workspace/notebooks/.env ]'
check ".claude/settings.local.json masked"           '[ "$(tr -d "[:space:]" < /workspace/.claude/settings.local.json)" = "{}" ]'
check "app reachable at http://app:5173"             'curl -sf -m 10 http://app:5173/ -o /dev/null'
check "Anthropic API reachable via proxy"            'reach https://api.anthropic.com/'
check "npm registry reachable via proxy"             'curl -sf -m 10 https://registry.npmjs.org/ -o /dev/null'
if [ -n "${VITE_SUPABASE_URL:-}" ]; then
  check "TEST Supabase reachable via proxy"          "reach '${VITE_SUPABASE_URL}/auth/v1/health'"
fi
check "example.com BLOCKED"                          '[ "$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://example.com/)" = 000 ]'
check "direct egress BLOCKED (no proxy)"             '[ "$(curl -s --noproxy "*" -o /dev/null -m 5 -w "%{http_code}" https://api.anthropic.com/)" = 000 ]'
if [ -n "${LIVE_SUPABASE_HOST:-}" ]; then
  check "LIVE Supabase BLOCKED"                      "[ \"\$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://${LIVE_SUPABASE_HOST}/auth/v1/health)\" = 000 ]"
fi
if [ -n "${E2E_SUPABASE_PORT:-}" ] && [ "$E2E_SUPABASE_PORT" != 443 ]; then
  # Studio (54323) and other ports on the same host must not be reachable.
  check "same host, other port BLOCKED (:54323 Studio)" \
    "curl -s -o /dev/null -m 10 -w '%{http_code}' http://${E2E_SUPABASE_HOST}:54323/ | grep -qE '^(000|403)$'"
fi
check "Node fetch uses proxy (NODE_USE_ENV_PROXY)"   'node -e "fetch(\"https://registry.npmjs.org/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"'
exit $fail
