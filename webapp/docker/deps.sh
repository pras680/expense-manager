#!/bin/sh
# Installs Linux node_modules into the named volume, only when the lockfile
# changed since the last install (keeps restarts fast). Made writable by any
# uid so the non-root claude container (pwuser, uid 1001 in the Playwright
# image) can run tsc/vite builds, which write caches under node_modules.
# The volume belongs to this test stack only.
set -eu
hash=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.e2e-lock-hash 2>/dev/null || true)" != "$hash" ]; then
  npm ci --no-audit --no-fund
  echo "$hash" > node_modules/.e2e-lock-hash
else
  echo "[deps] node_modules up to date"
fi
if [ ! -f node_modules/.e2e-perms-open ]; then
  chmod -R a+rwX node_modules && touch node_modules/.e2e-perms-open
fi
