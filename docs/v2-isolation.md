# V2 Isolation Harness — proof & operating manual

> Interim doc (Wave 0, task 3). Will be moved into the private fork `fazulfi/omo-v2` docs at task 4/22.
> Evidence dir: `C:\Users\faizz\new-saas\.omo\evidence\opencode-v2-migration\task-3\`

## 1. Purpose

All V2 (opencode 2.0.20) testing MUST run in an isolated harness so that the owner's V1
production install (binary 1.18.33, user config, cache, sessions, db) is never touched.
This document records the exact env vars/flags used, how their names were verified, and
the runtime proof that isolation holds on native Windows.

## 2. Harness layout

```
C:\Users\faizz\ports\omo-v2\v2-home\
├── npm-prefix\          # isolated npm install of @opencode/cli@2.0.20 (exact)
│   └── node_modules\@opencode\cli\bin\opencode.exe   (v2.0.20)
├── harness-root\       # ALL V2 state roots (redirected via env)
│   ├── config\         # OPENCODE_CONFIG_DIR
│   ├── data\            # OPENCODE_TEST_HOME → data (opencode.db, log/)
│   ├── cache\           # spawned service binaries, models.json
│   ├── state\
│   └── tmp\
└── test-project\        # scratch cwd for runs (project config DISABLED)
```

## 3. Isolation env vars (names verified from installed binary source + runtime)

| Env var | Effect | Verified how |
|---|---|---|
| `OPENCODE_TEST_HOME` | Overrides home for data/state/log/db/bin paths (paths module: `process.env.OPENCODE_TEST_HOME ?? homedir()`) | grep of installed exe (static) + runtime: `data/opencode/opencode.db`, `data/opencode/log/opencode.log`, `state/opencode/service.json` all created under harness-root |
| `OPENCODE_CONFIG_DIR` | Overrides config directory in config resolution | static grep + runtime: `config/service.json` created under harness config dir |
| `OPENCODE_DISABLE_PROJECT_CONFIG` (alias `OPENCODE_CONFIG_PROJECT_DISABLE`) | Disables project (cwd) config discovery | runtime: cwd `test-project` stayed EMPTY after run |
| `OPENCODE_DISABLE_AUTOUPDATE` | Disables self-updater | static grep (present in exe) + behavioral: no update writes; service binary spawned inside harness cache |
| `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` | XDG roots (set as defense-in-depth on Windows) | static grep shows vars referenced; primary isolation provided by OPENCODE_* vars |

Notes:

- The installed 2.0.20 exe is a bun single-file binary (198MB) with sources embedded;
  env names were confirmed by `grep -a` string extraction against the exe, then
  behaviorally at runtime (below). No third-party "opencode2" package is used —
  `opencode2` is an official alias bin of `@opencode/cli` itself.
- Spawned V2 service binary (`opencode-service-*.exe`) lands in the HARNESS cache
  dir (`harness-root/cache/opencode/`), not the real `~/.cache/opencode/` — the
  harness is self-contained.

## 4. Canonical harness invocation

```bash
HARNESS="C:/Users/faizz/ports/omo-v2/v2-home/harness-root"
export OPENCODE_TEST_HOME="$HARNESS"
export OPENCODE_CONFIG_DIR="$HARNESS/config"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_PROJECT_CONFIG=1
export OPENCODE_CONFIG_PROJECT_DISABLE=1
export XDG_CONFIG_HOME="$HARNESS/config"
export XDG_DATA_HOME="$HARNESS/data"
export XDG_CACHE_HOME="$HARNESS/cache"
export XDG_STATE_HOME="$HARNESS/state"

OC="C:/Users/faizz/ports/omo-v2/v2-home/npm-prefix/node_modules/@opencode/cli/bin/opencode.exe"
cd "C:/Users/faizz/ports/omo-v2/v2-home/test-project"
"$OC" models   # or any subcommand
```

## 5. Runtime isolation proof (2026-09-30, native Windows — no fallback needed)

Run: `opencode.exe models`, cwd = test-project, EXIT=0.

All writes landed inside harness-root:

```
harness-root/cache/opencode/opencode-service-24264-67b7f887.exe
harness-root/config/service.json
harness-root/data/opencode/log/opencode.log
harness-root/data/opencode/opencode.db (+ -shm, -wal)
harness-root/state/opencode/service.json
```

Harness log shows server events (`model.updated`, `agent.updated`, `command.updated`,
`provider.updated`) with `event.location.directory=test-project`.

Real V1 roots NOT touched by the V2 run:

| Real path | mtime after run | Verdict |
|---|---|---|
| `~/.config/opencode/opencode.json` | Sep 26 19:36 (unchanged) | untouched |
| `~/.bun/bin/opencode.exe` | Sep 28 13:05 (unchanged) | untouched |
| `~/.cache/opencode/models.json` | 23:31:51 — BEFORE run window (23:37:40–23:40:53) | untouched by V2 |
| `~/.config/opencode/service.json` | 17:00:35 | V1-owner usage, hours before run |
| `~/.local/share/opencode/opencode.db` | 23:40:59 | live V1 session of the owner (out-of-scope drift per plan) |

The harness service process terminated after the run (tasklist shows no
`opencode-service-24264` process) — no lingering V2 daemons.

## 6. Fallback posture

Not needed: native Windows isolation is proven above. The plan's fallbacks
(separate Windows user profile, VPS staging `172.236.144.22`) remain documented
but unused. Production VPS (`82.25.62.204`) is never used by this plan.
