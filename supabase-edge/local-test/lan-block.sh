#!/usr/bin/env bash
# Stops other machines on your network from reaching local Supabase.
# Supabase CLI v2 publishes its ports (54321 API, 54322 DB, 54323 Studio,
# 54324 Mailpit) on all interfaces, and Studio / the DB admin API have no
# login. This adds macOS packet-filter (pf) rules, in their own anchor, that
# drop inbound TCP to those ports on every interface except loopback. Your
# Mac (browser, CLI) and Docker containers using host.docker.internal are
# unaffected. Nothing else in your firewall setup is changed.
#
#   supabase-edge/local-test/lan-block.sh on      # after each reboot
#   supabase-edge/local-test/lan-block.sh status
#   supabase-edge/local-test/lan-block.sh off
# Needs sudo (pfctl). Rules don't survive a reboot; run `on` again.
set -euo pipefail
ANCHOR="com.apple/billskills-supabase"   # loaded via /etc/pf.conf's com.apple/* anchor
PORTS="54321:54324"

case "${1:-status}" in
  on)
    printf 'block drop in quick on ! lo0 proto tcp from any to any port %s\n' "$PORTS" \
      | sudo pfctl -a "$ANCHOR" -f -
    sudo pfctl -e 2>/dev/null || true      # "already enabled" is fine
    echo "[lan-block] ON. Rules in $ANCHOR:"
    sudo pfctl -a "$ANCHOR" -sr
    ;;
  off)
    sudo pfctl -a "$ANCHOR" -F rules
    echo "[lan-block] OFF (rules removed from $ANCHOR; pf itself left as it was)."
    ;;
  status)
    echo "[lan-block] Rules in $ANCHOR (empty = off):"
    sudo pfctl -a "$ANCHOR" -sr 2>/dev/null || true
    sudo pfctl -s info 2>/dev/null | head -1
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
