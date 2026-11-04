#!/usr/bin/env bash
# QA driver: OpenCode V2 agent-override application (omo.json `agents.<id>`).
#
# Drives a real, isolated OpenCode server with a plugin build and asserts on
# the live agent catalog that omo.json agent overrides landed:
#
#   displayName / description / model "provider/model[#variant]"  → omo.agents get oracle
#   prompt + prompt_append via file:// (absolute + relative)      → omo.agents get momus
#   disable                                                        → omo.agents list (no atlas)
#
# Modes:
#   MODE=green  expect the NEW behavior (overrides applied; fix build)
#   MODE=red    expect the OLD behavior (overrides ignored; pre-change build)
#
# ISOLATION: the server runs in an isolated XDG sandbox (own config/data/state/
# cache roots) so nothing is written to the real OpenCode DB. The real DB is
# only ever READ, to prove the isolation.
#
# Usage: MODE=green bash script/qa/agent-overrides-qa.sh <plugin-dir>
set -uo pipefail

PLUGIN_DIR="${1:?usage: agent-overrides-qa.sh <plugin-dir>}"
MODE="${MODE:-green}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$REPO_ROOT/.omo/evidence/20261104-v2-agent-overrides}"
REAL_DB="$HOME/.local/share/opencode/opencode.db"
QA_ROOT="$(mktemp -d /tmp/opencode/omo-agent-overrides-qa.XXXXXX)"
PASSWORD="oqa-agents-$$"

case "$MODE" in
  green | red) ;;
  *) echo "FAIL: MODE must be 'green' or 'red' (got '$MODE')" >&2; exit 1 ;;
esac

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

# The project under test carries the omo.json agent overrides plus the two
# file:// prompt sources (absolute + relative-to-project).
mkdir -p "$QA_ROOT/proj/prompts"
cat > "$QA_ROOT/proj/prompts/momus-prompt.md" <<'MD'
QA FILE PROMPT BODY: momus system replacement.
MD
cat > "$QA_ROOT/proj/prompts/momus-append.md" <<'MD'
QA APPEND BODY: momus appended context.
MD

cat > "$QA_ROOT/proj/omo.json" <<JSON
{
  "agents": {
    "oracle": {
      "displayName": "QA Consultant",
      "description": "QA-overridden oracle description",
      "model": "zai-coding-plan/glm-5.2#high"
    },
    "momus": {
      "description": "QA-overridden momus description",
      "prompt": "file://$QA_ROOT/proj/prompts/momus-prompt.md",
      "prompt_append": "file://./prompts/momus-append.md"
    },
    "atlas": { "disable": true }
  }
}
JSON

# OpenCode 2.x stores sessions in `session_v2` / `session_message`.
real_row_counts() {
  local sessions messages
  sessions="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_v2;" 2>/dev/null || echo unavailable)"
  messages="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_message;" 2>/dev/null || echo unavailable)"
  echo "$sessions $messages"
}

if [ ! -f "$PLUGIN_DIR/dist/index.js" ]; then
  echo "FAIL: $PLUGIN_DIR/dist/index.js is missing; run 'bun run build' first" >&2
  exit 1
fi

read -r BEFORE_SESSIONS BEFORE_MESSAGES <<<"$(real_row_counts)"
echo "real DB rows BEFORE: session_v2=$BEFORE_SESSIONS session_message=$BEFORE_MESSAGES"

PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
SERVER_URL="http://127.0.0.1:$PORT"

( cd "$QA_ROOT/proj" && OPENCODE_SERVER_PASSWORD="$PASSWORD" \
    opencode serve --port "$PORT" --hostname 127.0.0.1 >"$QA_ROOT/serve.log" 2>&1 & echo $! >"$QA_ROOT/pid" )
SERVER_PID="$(cat "$QA_ROOT/pid" 2>/dev/null)"

for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 5 -u "opencode:$PASSWORD" "$SERVER_URL/global/health" && break
  sleep 0.5
done

rpc() {
  curl -s --max-time 20 -u "opencode:$PASSWORD" -X POST "$SERVER_URL/api/rpc/$1/$2" \
    -H 'Content-Type: application/json' -d "${3:-{\"input\":{}}}"
}

# The plugin registers asynchronously; poll until the catalog answers.
AGENTS_JSON=""
for _ in $(seq 1 40); do
  AGENTS_JSON="$(rpc omo.agents list)"
  [ "$(printf '%s' "$AGENTS_JSON" | jq -r '.output.count // empty' 2>/dev/null)" != "" ] && break
  sleep 1
done

ORACLE_JSON="$(rpc omo.agents get '{"input":{"agent":"oracle"}}')"
MOMUS_JSON="$(rpc omo.agents get '{"input":{"agent":"momus"}}')"
METIS_JSON="$(rpc omo.agents get '{"input":{"agent":"metis"}}')"

{
  echo "mode=$MODE"
  echo "plugin_dir=$PLUGIN_DIR"
  echo "--- omo.agents list ---"
  printf '%s' "$AGENTS_JSON" | jq . 2>/dev/null || printf '%s\n' "$AGENTS_JSON"
  echo "--- omo.agents get oracle ---"
  printf '%s' "$ORACLE_JSON" | jq . 2>/dev/null || printf '%s\n' "$ORACLE_JSON"
  echo "--- omo.agents get momus (system elided) ---"
  printf '%s' "$MOMUS_JSON" | jq '.output.agent |= if . == null then . else del(.system) end' 2>/dev/null || printf '%s\n' "$MOMUS_JSON"
  echo "--- momus system marker check ---"
  printf 'prompt_body=%s\nappend_body=%s\n' \
    "$(printf '%s' "$MOMUS_JSON" | jq -r '.output.agent.system | contains("QA FILE PROMPT BODY")' 2>/dev/null)" \
    "$(printf '%s' "$MOMUS_JSON" | jq -r '.output.agent.system | contains("QA APPEND BODY")' 2>/dev/null)"
  echo "--- omo.agents get metis (chain-resolution observation) ---"
  printf '%s' "$METIS_JSON" | jq . 2>/dev/null || printf '%s\n' "$METIS_JSON"
  echo "--- serve log tail ---"
  tail -40 "$QA_ROOT/serve.log" 2>/dev/null
} > "$EVIDENCE_DIR/agent-overrides-$MODE.log"

# --------------------------------------------------------------- assertions --
FAILURES=0
note() { echo "[$MODE] $*"; }
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    note "PASS $1: $2"
  else
    note "FAIL $1: expected '$3', got '$2'"
    FAILURES=$((FAILURES + 1))
  fi
}

ORACLE_NAME="$(printf '%s' "$ORACLE_JSON" | jq -r '.output.agent.name // empty' 2>/dev/null)"
ORACLE_DESC="$(printf '%s' "$ORACLE_JSON" | jq -r '.output.agent.description // empty' 2>/dev/null)"
ORACLE_MODEL="$(printf '%s' "$ORACLE_JSON" | jq -c '.output.agent.model // empty' 2>/dev/null)"
MOMUS_DESC="$(printf '%s' "$MOMUS_JSON" | jq -r '.output.agent.description // empty' 2>/dev/null)"
MOMUS_HAS_PROMPT="$(printf '%s' "$MOMUS_JSON" | jq -r '.output.agent.system | contains("QA FILE PROMPT BODY")' 2>/dev/null)"
MOMUS_HAS_APPEND="$(printf '%s' "$MOMUS_JSON" | jq -r '.output.agent.system | contains("QA APPEND BODY")' 2>/dev/null)"
ATLAS_LISTED="$(printf '%s' "$AGENTS_JSON" | jq -r '.output.agents[]? | select(.id=="atlas") | .id' 2>/dev/null)"
ORACLE_LISTED="$(printf '%s' "$AGENTS_JSON" | jq -r '.output.agents[]? | select(.id=="oracle") | .id' 2>/dev/null)"

if [ "$MODE" = "green" ]; then
  check "oracle displayName override" "$ORACLE_NAME" "QA Consultant"
  check "oracle description override" "$ORACLE_DESC" "QA-overridden oracle description"
  check "oracle model override (provider/model#variant)" "$ORACLE_MODEL" '{"providerID":"zai-coding-plan","id":"glm-5.2","variant":"high"}'
  check "momus description override" "$MOMUS_DESC" "QA-overridden momus description"
  check "momus prompt file:// (absolute)" "$MOMUS_HAS_PROMPT" "true"
  check "momus prompt_append file:// (relative)" "$MOMUS_HAS_APPEND" "true"
  check "atlas disabled (absent from catalog)" "$ATLAS_LISTED" ""
  check "oracle still registered" "$ORACLE_LISTED" "oracle"
else
  check "oracle name stays static" "$ORACLE_NAME" "Oracle"
  check "oracle model stays unset" "$ORACLE_MODEL" ""
  check "momus prompt NOT replaced" "$MOMUS_HAS_PROMPT" "false"
  check "atlas still registered" "$ATLAS_LISTED" "atlas"
fi

read -r AFTER_SESSIONS AFTER_MESSAGES <<<"$(real_row_counts)"
echo "real DB rows AFTER:  session_v2=$AFTER_SESSIONS session_message=$AFTER_MESSAGES"

{
  echo "mode=$MODE"
  echo "plugin_dir=$PLUGIN_DIR"
  echo "failures=$FAILURES"
  echo "session_v2_before=$BEFORE_SESSIONS"
  echo "session_v2_after=$AFTER_SESSIONS"
  echo "session_message_before=$BEFORE_MESSAGES"
  echo "session_message_after=$AFTER_MESSAGES"
} > "$EVIDENCE_DIR/agent-overrides-$MODE-summary.env"

note "evidence: $EVIDENCE_DIR/agent-overrides-$MODE.log"
if [ "$FAILURES" -gt 0 ]; then
  note "RESULT: FAIL ($FAILURES assertion(s))"
  exit 1
fi
note "RESULT: PASS"
