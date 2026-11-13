#!/bin/sh
# Builds the allowlist: Claude Code's required hosts (code.claude.com/docs/en/network-config),
# npm, Google Fonts, and the TEST Supabase host passed in by e2e.sh. Nothing else.
set -eu
{
  for h in api.anthropic.com claude.ai claude.com platform.claude.com \
           registry.npmjs.org fonts.googleapis.com fonts.gstatic.com; do echo "$h"; done
  # A hosted (https/443) test project goes in the domain allowlist; a local
  # one on another port gets an exact host+port rule instead (below), so the
  # rest of that host (e.g. your Mac's other ports) stays unreachable.
  if [ -n "${E2E_SUPABASE_HOST:-}" ] && [ "${E2E_SUPABASE_PORT:-443}" = 443 ]; then
    echo "$E2E_SUPABASE_HOST"
  fi
} > /etc/squid/allowlist.txt
: > /etc/squid/extra.conf
if [ -n "${E2E_SUPABASE_HOST:-}" ] && [ "${E2E_SUPABASE_PORT:-443}" != 443 ]; then
  cat > /etc/squid/extra.conf <<CONF
acl test_supabase_host dstdomain ${E2E_SUPABASE_HOST}
acl test_supabase_port port ${E2E_SUPABASE_PORT}
http_access allow test_supabase_host test_supabase_port !CONNECT
CONF
  echo "[proxy] plus exactly: http://${E2E_SUPABASE_HOST}:${E2E_SUPABASE_PORT}"
fi
echo "[proxy] allowlist:"; sed 's/^/  /' /etc/squid/allowlist.txt

# squid runs as the unprivileged "squid" user, which can't reopen the
# container's stdout, so it logs to a file and we stream that file instead.
mkdir -p /var/log/squid
: > /var/log/squid/access.log
chown -R squid /var/log/squid
squid -N -d 1 -f /etc/squid/squid.conf &
pid=$!
tail -n0 -F /var/log/squid/access.log &
wait "$pid"
