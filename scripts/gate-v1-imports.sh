#!/usr/bin/env bash
# Gate: V1 @opencode-ai/* imports must not remain in ported source.
# Usage: scripts/gate-v1-imports.sh [target]   (default: packages/)
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-packages/}"
FILES=$(grep -rl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  '@opencode-ai/' "$TARGET" 2>/dev/null || true)
if [ -n "$FILES" ]; then
  echo "FAIL: V1 @opencode-ai/ imports found under $TARGET:" >&2
  echo "$FILES" >&2
  exit 1
fi
echo "PASS: no @opencode-ai/ imports under $TARGET"
