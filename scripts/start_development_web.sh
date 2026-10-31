#!/usr/bin/env bash
set -euo pipefail
expected_node="$(cat .node-version)"
actual_node="$(node -p 'process.versions.node')"
if [ "$actual_node" != "$expected_node" ]; then
  printf 'Node版本不匹配：需要%s，当前%s\n' "$expected_node" "$actual_node" >&2
  exit 1
fi
corepack enable
if [ "$(corepack pnpm --version)" != "10.34.5" ]; then
  printf '需要pnpm 10.34.5\n' >&2
  exit 1
fi
CI=true corepack pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store
printf 'SHOPRO_DEVELOPMENT_READY backend=%s\n' "$VITE_SUPABASE_URL"
exec corepack pnpm dev --port 5173 --strictPort
