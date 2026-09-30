# V2 Config Normalization — Dry-Run Verifikasi

> Task 3 (Wave 0) — opencode-v2-migration. Bukti runtime: normalisasi config V1→V2
> terjadi **in-memory**, TANPA rewrite file config.

## Ringkasan

OpenCode V2 (2.0.20) membaca config format V1 dan menormalisasinya secara in-memory
menjadi shape V2. Dry-run ini membuktikan:

1. File config V1 (copy ber-mask) **TIDAK di-rewrite** oleh V2 (sha256 identik sebelum/sesudah).
2. Mapping normalisasi terdokumentasi (tabel di bawah).
3. Tidak ada secret yang bocor ke output debug.

## Prosedur Dry-Run

| Langkah | Perintah | Hasil |
|---|---|---|
| 1. Mask secret | `python mask-config.py` (key-regex `(key\|token\|secret\|password\|authorization\|credential)` case-insensitive + value-pattern `sk-…\|ghp_\|gho_\|xox[bpars]-\|Bearer …\|AIza…`) | 10 key-path di-mask → `***MASKED***`; hanya NAMA key yang dicetak |
| 2. Copy ke harness | output → `harness-root/config/opencode.json` | copy 555-baris V1 config, pretty JSON |
| 3. Hash sebelum | `sha256sum harness-root/config/opencode.json` | `ccfa8a9109a10e68900af4bfc49cf7ad6e8d1730fcf006577ecedaef91e8544f` |
| 4. Jalankan V2 | `opencode debug config` (harness env terisolasi, cwd test-project) | EXIT=0, stdout 710 baris, stderr kosong |
| 5. Hash sesudah | `sha256sum harness-root/config/opencode.json` | **IDENTIK** → tidak ada rewrite |
| 6. Secret-scan output | grep regex secret pada stdout debug | 0 match |

Harness env: `OPENCODE_TEST_HOME`, `OPENCODE_CONFIG_DIR`, `OPENCODE_DISABLE_AUTOUPDATE=1`,
`OPENCODE_DISABLE_PROJECT_CONFIG=1` (+alias), `XDG_{CONFIG,DATA,CACHE,STATE}_HOME` — lihat
`docs/v2-isolation.md`.

## Key-Path yang Di-Mask (10)

- `mcp.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN`
- `mcp.exa.environment.EXA_API_KEY`
- `mcp.brave-search.environment.BRAVE_API_KEY`
- `mcp.firecrawl.environment.FIRECRAWL_API_KEY`
- `mcp.tavily.environment.TAVILY_API_KEY`
- `mcp.enowx-rag.headers.Authorization`
- `mcp.tinyfish.headers.X-API-Key`
- `provider.inferhub.options.apiKey`
- `provider.zrouter.options.apiKey`
- `provider.markettabrak.options.apiKey`

## Mapping Normalisasi V1 → V2

| V1 (top-level keys) | V2 (normalized) | Catatan |
|---|---|---|
| `$schema` | `$schema` | tetap |
| `model` (string `provider/model`) | `model: {providerID, model}` | dipecah jadi objek; `glm-5.3` via `inferhub` |
| `small_model` | *(diserap ke shape V2)* | tidak muncul eksplisit di debug output |
| `plugin` (array string) | `plugins` (array string) | rename key; isi sama: `oh-my-openagent@latest`, `@tarquinen/opencode-dcp@latest`, `@ramtinj95/opencode-tokenscope@latest` |
| `provider` (map) | `providers` (map) | tiap provider keys `[name, package, settings, models]`; **nilai apiKey TIDAK di-echo** oleh `debug config` (tampil None) — secret tidak bocor |
| `enabled_providers` (array) | `experimental.policies` | jadi policy `provider.use deny *` + allowlist eksplisit (zrouter, inferhub, openai, …) |
| `mcp` (map server) | `mcp.servers` (map) | 15 server: context7, grep_app, github, time, exa, sequential-thinking, playwright, brave-search, fetch, filesystem, text-editor, firecrawl, tavily, enowx-rag, tinyfish; env/headers tetap dibawa |
| *(baru di V2)* | `agents` | shape agent V2 (default) |

## Bukti

- `v2-home/config-hash-before.txt` / `config-hash-after.txt` — sha256 identik.
- `v2-home/test-project/debug-config-stdout.log` (710 baris) / `debug-config-stderr.log` (kosong).
- `v2-home/mask-config-run.log` — daftar key-path yang di-mask (nama saja).
- Secret-scan output debug: 0 match regex secret.

## Implikasi Cutover (Task 21)

- Config production V1 **tidak perlu rewrite manual** — V2 auto-normalize in-memory.
- Rollback ke V1 trivial karena file config tidak pernah diubah oleh V2.
- Verifikasi akhir kondisional config as-is dilakukan ulang di task 17 (addendum) dan
  saat rehearsal cutover task 20.
