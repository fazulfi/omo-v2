#!/usr/bin/env bash
# Gate: package.json deps must not use @opencode-ai/* (V1 line) and every
# @opencode/* dependency must be pinned EXACTLY to 2.0.20 (no ^ or ~).
# Usage: scripts/gate-deps.sh [target]   (default: packages/)
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-packages/}"
FAIL=0
while IFS= read -r PJ; do
  OUT=$(node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const secs = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const errs = [];
for (const s of secs) {
  const d = p[s] || {};
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith("@opencode-ai/")) errs.push(`forbidden V1 dep ${k}@${v}`);
    if (k.startsWith("@opencode/") && v !== "2.0.20") errs.push(`${k} must be exact 2.0.20, found ${v}`);
  }
}
if (errs.length) { console.error(process.argv[1] + ": " + errs.join("; ")); process.exit(1); }
' "$PJ" 2>&1) || { echo "$OUT" >&2; FAIL=1; }
done < <(find "$TARGET" -name package.json -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*')
if [ "$FAIL" -ne 0 ]; then
  echo "FAIL: dependency gate violations under $TARGET" >&2
  exit 1
fi
echo "PASS: deps clean under $TARGET"
