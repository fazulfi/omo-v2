#!/usr/bin/env bash
# Gate: no ': any' type suppression in source.
# Usage: scripts/gate-any.sh [target]   (default: packages/)
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-packages/}"
MATCHES=$(grep -rn --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  -E ':[[:space:]]*any\b' "$TARGET" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  echo "FAIL: ': any' found under $TARGET:" >&2
  echo "$MATCHES" >&2
  exit 1
fi
echo "PASS: no ': any' under $TARGET"
