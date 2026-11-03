#!/usr/bin/env bash
# QA driver: OpenCode V2 LSP MCP re-port.
#
# Drives a real, isolated OpenCode server and asserts on the live plugin state:
#
#   RED   - the pre-change plugin registers the `lsp` MCP server as `disabled`.
#   GREEN - the post-change plugin registers it as `connected` and exposes the
#           `lsp_*` tools through the live tool registry.
#   ISOLATION - the real OpenCode DB row counts are unchanged by this QA.
#
# The server runs in an isolated XDG sandbox (its own config, data, state and
# cache roots), so no session is ever written to the real DB. The real DB is
# only ever READ, to prove the isolation.
#
# Usage: bash script/qa/lsp-mcp-qa.sh <plugin-dir>
set -uo pipefail

PLUGIN_DIR="${1:?usage: lsp-mcp-qa.sh <plugin-dir>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$REPO_ROOT/.omo/evidence/20261103-v2-lsp-mcp-report}"
REAL_DB="$HOME/.local/share/opencode/opencode.db"
QA_ROOT="$(mktemp -d /tmp/opencode/omo-lsp-qa.XXXXXX)"
PASSWORD="oqa-lsp-$$"

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  sleep 0.3
  [ -n "${SERVER_PID:-}" ] && kill -9 "$SERVER_PID" 2>/dev/null
  rm -rf "$QA_ROOT"
}
trap cleanup EXIT

mkdir -p "$EVIDENCE_DIR"
mkdir -p "$QA_ROOT/config" "$QA_ROOT/data" "$QA_ROOT/state" "$QA_ROOT/cache" "$QA_ROOT/proj"

export XDG_CONFIG_HOME="$QA_ROOT/config"
export XDG_DATA_HOME="$QA_ROOT/data"
export XDG_STATE_HOME="$QA_ROOT/state"
export XDG_CACHE_HOME="$QA_ROOT/cache"
export OPENCODE_CONFIG="$QA_ROOT/opencode.json"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1

cat > "$QA_ROOT/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugins": ["$PLUGIN_DIR"]
}
JSON

# A project-level LSP config, so the proof also covers the project-config
# plumbing (`LSP_TOOLS_MCP_PROJECT_CONFIG`).
mkdir -p "$QA_ROOT/proj/.opencode"
cat > "$QA_ROOT/proj/.opencode/lsp.json" <<JSON
{
  "typescript": {
    "command": ["typescript-language-server", "--stdio"],
    "extensions": [".ts", ".tsx"]
  }
}
JSON

# OpenCode 2.2.5 stores sessions in `session_v2` / `session_message`; the
# legacy `session` table no longer exists.
real_row_counts() {
  local sessions messages
  sessions="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_v2;" 2>/dev/null || echo "unavailable")"
  messages="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_message;" 2>/dev/null || echo "unavailable")"
  echo "$sessions $messages"
}

# The plugin under test must be built; `dist/index.js` is the published entry.
if [ ! -f "$PLUGIN_DIR/dist/index.js" ]; then
  echo "FAIL: $PLUGIN_DIR/dist/index.js is missing; run 'bun run build' first" >&2
  exit 1
fi

read -r BEFORE_SESSIONS BEFORE_MESSAGES <<<"$(real_row_counts)"
echo "real DB rows BEFORE: session_v2=$BEFORE_SESSIONS session_message=$BEFORE_MESSAGES"

PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
SERVER_URL="http://127.0.0.1:$PORT"

( cd "$QA_ROOT/proj" && OPENCODE_SERVER_PASSWORD="$PASSWORD" \
    opencode serve --port "$PORT" --hostname 127.0.0.1 >"$QA_ROOT/serve.log" 2>&1 & echo $! >"$QA_ROOT/pid" ) &
SERVER_PID="$(cat "$QA_ROOT/pid" 2>/dev/null)"

# Wait for the server to accept connections.
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 5 -u "opencode:$PASSWORD" "$SERVER_URL/global/health" && break
  sleep 0.5
done

rpc() {
  curl -s --max-time 20 -u "opencode:$PASSWORD" -X POST "$SERVER_URL/api/rpc/$1/$2" \
    -H 'Content-Type: application/json' -d "${3:-{\"input\":{}}}"
}

# The plugin loads lazily and the local MCP servers start asynchronously, so
# poll the plugin's own view until every server settles.
LSP_STATUS=""
SERVERS_JSON=""
for _ in $(seq 1 40); do
  SERVERS_JSON="$(rpc omo.mcp list)"
  LSP_STATUS="$(printf '%s' "$SERVERS_JSON" | jq -r '.output.servers[]? | select(.name=="lsp") | .status' 2>/dev/null)"
  case "$LSP_STATUS" in
    connected | disabled | failed | needs_auth) break ;;
  esac
  sleep 1
done

TOOLS_JSON="$(rpc omo.tools list)"
LSP_TOOLS="$(printf '%s' "$TOOLS_JSON" | jq -r '.output.tools[]? | select(startswith("lsp_"))' 2>/dev/null | sort | tr '\n' ' ')"

echo "--- live MCP server status (plugin: $PLUGIN_DIR) ---"
printf '%s' "$SERVERS_JSON" | jq '.output.servers' 2>/dev/null
echo
echo "lsp status: ${LSP_STATUS:-<not found>}"
echo "lsp tools: ${LSP_TOOLS:-<none>}"

{
  echo "plugin_dir=$PLUGIN_DIR"
  echo "lsp_status=$LSP_STATUS"
  echo "lsp_tools=$LSP_TOOLS"
} > "$EVIDENCE_DIR/lsp-qa-summary.env"

read -r AFTER_SESSIONS AFTER_MESSAGES <<<"$(real_row_counts)"
echo "real DB rows AFTER:  session_v2=$AFTER_SESSIONS session_message=$AFTER_MESSAGES"

# Rewrite the summary with the after-values now known.
{
  echo "plugin_dir=$PLUGIN_DIR"
  echo "lsp_status=$LSP_STATUS"
  echo "lsp_tools=$LSP_TOOLS"
  echo "session_v2_before=$BEFORE_SESSIONS"
  echo "session_v2_after=$AFTER_SESSIONS"
  echo "session_message_before=$BEFORE_MESSAGES"
  echo "session_message_after=$AFTER_MESSAGES"
} > "$EVIDENCE_DIR/lsp-qa-summary.env"

printf '%s\n' "$SERVERS_JSON" | jq '.output.servers' > "$EVIDENCE_DIR/mcp-servers.json" 2>/dev/null
printf '%s\n' "$LSP_TOOLS" | tr ' ' '\n' | grep -v '^$' > "$EVIDENCE_DIR/lsp-tools.txt"

if [ "$BEFORE_SESSIONS" != "$AFTER_SESSIONS" ] || [ "$BEFORE_MESSAGES" != "$AFTER_MESSAGES" ]; then
  echo "FAIL: the real OpenCode DB changed ($BEFORE_SESSIONS/$BEFORE_MESSAGES -> $AFTER_SESSIONS/$AFTER_MESSAGES)" >&2
  exit 1
fi

if [ "$LSP_STATUS" != "connected" ]; then
  echo "FAIL: expected lsp status 'connected', got '${LSP_STATUS:-<missing>}'" >&2
  exit 1
fi

if [ -z "$LSP_TOOLS" ]; then
  echo "FAIL: no lsp_* tools are exposed through the live tool registry" >&2
  exit 1
fi

echo "PASS: lsp MCP server is connected, its tools are registered, and the real DB was untouched"
