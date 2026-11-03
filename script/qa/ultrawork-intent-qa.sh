#!/usr/bin/env bash
# QA driver: OpenCode V2 ULW intent gate.
#
# Drives a real, isolated OpenCode server and asserts on the live plugin state:
#
#   GREEN - a prompt carrying the `ulw` keyword arms the ultrawork mode and the
#           mode body is injected into the request system prompt.
#   RED   - a prompt without any keyword injects nothing.
#   ISOLATION - the real OpenCode DB row counts are unchanged by this QA.
#
# The injected body lands in the system prompt, which no session API exposes, so
# the assertion reads the plugin's own diagnostic RPC (`omo.keyword/state`).
#
# Usage: bash script/qa/ultrawork-intent-qa.sh <plugin-dir>
set -uo pipefail

PLUGIN_DIR="${1:?usage: ultrawork-intent-qa.sh <plugin-dir>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$REPO_ROOT/.omo/evidence/20261103-v2-ultrawork-intent}"
REAL_DB="$HOME/.local/share/opencode/opencode.db"
QA_ROOT="$(mktemp -d /tmp/opencode/omo-ulw-qa.XXXXXX)"
PASSWORD="oqa-ulw-$$"

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

# OpenCode 2.2.5 stores sessions in `session_v2` / `session_message`; the
# legacy `session` table no longer exists.
real_row_counts() {
  local sessions messages
  sessions="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_v2;" 2>/dev/null || echo "unavailable")"
  messages="$(sqlite3 "$REAL_DB" "SELECT count(*) FROM session_message;" 2>/dev/null || echo "unavailable")"
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
    opencode serve --port "$PORT" --hostname 127.0.0.1 >"$QA_ROOT/serve.log" 2>&1 & echo $! >"$QA_ROOT/pid" ) &
SERVER_PID="$(cat "$QA_ROOT/pid" 2>/dev/null)"

for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 5 -u "opencode:$PASSWORD" "$SERVER_URL/global/health" && break
  sleep 0.5
done

rpc() {
  curl -s --max-time 20 -u "opencode:$PASSWORD" -X POST "$SERVER_URL/api/rpc/omo.keyword/state" \
    -H 'Content-Type: application/json' -d '{"input":{}}'
}

create_session() {
  curl -s --max-time 20 -u "opencode:$PASSWORD" -X POST "$SERVER_URL/api/session" \
    -H 'Content-Type: application/json' \
    -d "{\"location\":{\"directory\":\"$QA_ROOT/proj\"}}" | jq -r '.data.id // empty'
}

submit_prompt() {
  local session_id="$1" text="$2"
  # The model call fails in this sandbox (no provider is configured), but the
  # prompt and context hooks run before the provider is reached.
  curl -s -o /dev/null --max-time 25 -u "opencode:$PASSWORD" \
    -X POST "$SERVER_URL/api/session/$session_id/prompt?directory=$QA_ROOT/proj" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg text "$text" '{text:$text}')" >/dev/null 2>&1
}

wait_for_injection() {
  local session_id="$1" state=""
  for _ in $(seq 1 20); do
    state="$(rpc)"
    if printf '%s' "$state" | jq -e --arg sid "$session_id" \
        '.output.injections // [] | map(select(.sessionID == $sid)) | length > 0' >/dev/null 2>&1; then
      printf '%s' "$state"
      return 0
    fi
    sleep 1
  done
  printf '%s' "$state"
  return 1
}

# --- RED: a prompt without any keyword must not arm the mode --------------------
PLAIN_SESSION="$(create_session)"
if [ -z "$PLAIN_SESSION" ]; then
  echo "FAIL: could not create the sandbox session" >&2
  exit 1
fi
submit_prompt "$PLAIN_SESSION" "please summarise the parser module"
sleep 4
PLAIN_STATE="$(rpc)"
PLAIN_INJECTIONS="$(printf '%s' "$PLAIN_STATE" | jq -r --arg sid "$PLAIN_SESSION" '[.output.injections[]? | select(.sessionID == $sid)] | length' 2>/dev/null)"

# --- GREEN: the `ulw` keyword must arm the ultrawork mode -----------------------
ULW_SESSION="$(create_session)"
if [ -z "$ULW_SESSION" ]; then
  echo "FAIL: could not create the sandbox session" >&2
  exit 1
fi
submit_prompt "$ULW_SESSION" "ulw please refactor the parser"
ULW_STATE="$(wait_for_injection "$ULW_SESSION")" || true
ULW_INJECTIONS="$(printf '%s' "$ULW_STATE" | jq -c --arg sid "$ULW_SESSION" '[.output.injections[]? | select(.sessionID == $sid)]' 2>/dev/null)"
ULW_TYPE="$(printf '%s' "$ULW_INJECTIONS" | jq -r '.[0].type // empty' 2>/dev/null)"
ULW_CHARS="$(printf '%s' "$ULW_INJECTIONS" | jq -r '.[0].characters // 0' 2>/dev/null)"
ULW_AGENT="$(printf '%s' "$ULW_INJECTIONS" | jq -r '.[0].agent // empty' 2>/dev/null)"
ULW_MODEL="$(printf '%s' "$ULW_INJECTIONS" | jq -r '.[0].model // empty' 2>/dev/null)"

read -r AFTER_SESSIONS AFTER_MESSAGES <<<"$(real_row_counts)"
echo "real DB rows AFTER:  session_v2=$AFTER_SESSIONS session_message=$AFTER_MESSAGES"

# --- A second detector: `team mode` must arm the team mode ---------------------
TEAM_SESSION="$(create_session)"
if [ -z "$TEAM_SESSION" ]; then
  echo "FAIL: could not create the sandbox session" >&2
  exit 1
fi
submit_prompt "$TEAM_SESSION" "use team mode for this refactor"
TEAM_STATE="$(wait_for_injection "$TEAM_SESSION")" || true
TEAM_TYPE="$(printf '%s' "$TEAM_STATE" | jq -r --arg sid "$TEAM_SESSION" '[.output.injections[]? | select(.sessionID == $sid)][0].type // empty' 2>/dev/null)"
TEAM_CHARS="$(printf '%s' "$TEAM_STATE" | jq -r --arg sid "$TEAM_SESSION" '[.output.injections[]? | select(.sessionID == $sid)][0].characters // 0' 2>/dev/null)"

{
  echo "plugin_dir=$PLUGIN_DIR"
  echo "plain_session=$PLAIN_SESSION"
  echo "plain_injections=$PLAIN_INJECTIONS"
  echo "ulw_session=$ULW_SESSION"
  echo "ulw_type=$ULW_TYPE"
  echo "ulw_characters=$ULW_CHARS"
  echo "ulw_agent=$ULW_AGENT"
  echo "ulw_model=$ULW_MODEL"
  echo "team_session=$TEAM_SESSION"
  echo "team_type=$TEAM_TYPE"
  echo "team_characters=$TEAM_CHARS"
  echo "session_v2_before=$BEFORE_SESSIONS"
  echo "session_v2_after=$AFTER_SESSIONS"
  echo "session_message_before=$BEFORE_MESSAGES"
  echo "session_message_after=$AFTER_MESSAGES"
} > "$EVIDENCE_DIR/ulw-qa-summary.env"

printf '%s' "$ULW_STATE" | jq '.output' > "$EVIDENCE_DIR/ulw-keyword-state.json" 2>/dev/null

echo "--- plain prompt (no keyword) ---"
echo "injections: $PLAIN_INJECTIONS"
echo "--- ulw prompt ---"
echo "type: ${ULW_TYPE:-<none>}  characters: ${ULW_CHARS:-0}  agent: ${ULW_AGENT:-<none>}  model: ${ULW_MODEL:-<none>}"
echo "--- team mode prompt ---"
echo "type: ${TEAM_TYPE:-<none>}  characters: ${TEAM_CHARS:-0}"

if [ "$BEFORE_SESSIONS" != "$AFTER_SESSIONS" ] || [ "$BEFORE_MESSAGES" != "$AFTER_MESSAGES" ]; then
  echo "FAIL: the real OpenCode DB changed ($BEFORE_SESSIONS/$BEFORE_MESSAGES -> $AFTER_SESSIONS/$AFTER_MESSAGES)" >&2
  exit 1
fi

if [ "$PLAIN_INJECTIONS" != "0" ]; then
  echo "FAIL: a prompt without a keyword injected $PLAIN_INJECTIONS mode bodies" >&2
  exit 1
fi

if [ "$ULW_TYPE" != "ultrawork" ]; then
  echo "FAIL: expected an ultrawork injection, got '${ULW_TYPE:-<missing>}'" >&2
  exit 1
fi

if [ "${ULW_CHARS:-0}" -lt 1000 ]; then
  echo "FAIL: the injected ultrawork body is implausibly short (${ULW_CHARS:-0} characters)" >&2
  exit 1
fi

if [ "$TEAM_TYPE" != "team" ]; then
  echo "FAIL: expected a team injection, got '${TEAM_TYPE:-<missing>}'" >&2
  exit 1
fi

echo "PASS: the ulw and team-mode keywords armed their modes, the bodies were injected, and the real DB was untouched"
