# MCP-router V2 Addendum — Config As-Is Under V2 (Task 17)

> Verifikasi akhir kondisional config owner (as-is saat task ini jalan) terhadap
> baseline dry-run task 3 (`docs/v2-config-normalization.md`).
> **ADDENDUM SAJA** — plan `mcp-router-v5` TIDAK dieksekusi di sini.

## Ringkasan

Config owner saat ini SUDAH memakai **mcp-router** live (4-konektor), BUKAN 15-MCP
legacy yang menjadi baseline task 3. Dry-run V2 (2.0.20) atas copy config owner
menghasilkan normalisasi yang **konsisten dengan baseline task 3** — tidak ada delta
baru yang tak terduga. Satu-satunya delta yang terobservasi adalah normalisasi field
`enabled: true` → `disabled: false` pada entri `mcp-router` (inversi boolean V2 yang
sudah diantisipasi). File config **TIDAK di-rewrite** (sha256 identik sebelum/sesudah).

## Status config owner saat ini (as-is, task 17)

| Item | Nilai |
|---|---|
| MCP connector | **4** (mcp-router + filesystem + text-editor + playwright) |
| mcp-router type | `remote`, url `http://100.100.17.99:9914/mcp`, headers `X-API-Key` |
| mcp-router enabled | `true` (V1 shape) |
| Provider | inferhub, zrouter, markettabrak (+ openai via allowlist) |
| model | `inferhub/glm-5.3` (string) |
| small_model | `inferhub/glm-5.3` |
| plugin | oh-my-openagent, dcp, tokenscope (3) |

Perubahan vs baseline task 3: install mcp-router menggantikan 15 MCP server legacy
(context7, grep_app, github, time, exa, sequential-thinking, playwright,
brave-search, fetch, filesystem, text-editor, firecrawl, tavily, enowx-rag, tinyfish)
menjadi 1 remote `mcp-router` + 3 local (filesystem, text-editor, playwright).
Playwright/filesystem/text-editor tetap dipertahankan sebagai konektor local stdio.

## Delta Table (per field)

| Field (V1 shape) | V2 normalized shape | Verdict |
|---|---|---|
| `$schema` | `$schema` | OK (tetap) |
| `model` = `"inferhub/glm-5.3"` (string) | `model: {providerID:"inferhub", model:"glm-5.3"}` | OK (dipecah jadi objek, sama dgn task 3) |
| `small_model` = `"inferhub/glm-5.3"` | *(diserap, tidak muncul eksplisit)* | OK (sama dgn task 3) |
| `plugin` (array string) | `plugins` (array string) | OK (rename key, isi sama 3 plugin) |
| `provider` (map) | `providers` (map) | OK (keys name/package/settings/models; apiKey → `***`, tidak bocor) |
| `enabled_providers` (array) | `experimental.policies` (provider.use deny * + allowlist) | OK (sama dgn task 3; allowlist zrouter/inferhub/openai/markettabrak) |
| `mcp` (map 4 server) | `mcp.servers` (map 4 server) | OK (rename key; 4 connector, env/headers dibawa) |
| `mcp.mcp-router.enabled` = `true` | `mcp.servers.mcp-router.disabled` = `false` | OK (inversi boolean V2 — expected, bukan bug) |
| `mcp.mcp-router.headers.X-API-Key` | `***` (redacted di debug output) | OK (secret tidak bocor) |
| *(baru di V2)* `agents` | `agents.title.model` = inferhub/glm-5.3 | OK (default agent shape, sama dgn task 3) |

**Kesimpulan delta**: 0 delta baru tak terduga. Perbedaan vs task-3 baseline hanya
pada **isi** `mcp.servers` (4 connector vs 15) yang merupakan drift yang
**disengaja** owner (install mcp-router), bukan perbedaan perilaku normalisasi.

## mcp-router pattern validity di V2

Pola 4-konektor (nested `mcp.servers`, remote `url`+`headers`) **VALID di V2**:

1. `debug config` menormalisasi `mcp.mcp-router` → `mcp.servers.mcp-router` dengan
   `type: remote`, `url`, `headers.X-API-Key` utuh (hanya redacted di output).
2. `opencode mcp list` (V2) melaporkan `✓ mcp-router connected` dengan **9 tools**
   ter-registrasi (list_mcps, list_tools, invoke_tool, list_prompts, get_prompt,
   list_resources, read_resource, search_capabilities, router_admin).
3. Konektor local stdio (filesystem 14 tools, playwright 23 tools, text-editor 1 tool)
   juga `connected` di V2.

## tools/list smoke — bukti

| Konektor | V2 status | Tool count |
|---|---|---|
| mcp-router | ✓ connected | 9 |
| filesystem | ✓ connected | 14 |
| playwright | ✓ connected | 23 |
| text-editor | ✓ connected | 1 |

- `opencode mcp list` → RC=0, keempat konektor `connected`.
- Raw MCP handshake ke mcp-router (initialize + tools/list via streamable HTTP, header
  `X-API-Key` real, session `Mcp-Session-Id`) → HTTP 200, serverInfo `MCP Router
  v0.5.0`, 9 tool ter-return (lihat `mcp-router-smoke-out.log`).

## Secret masking (task 17)

4 key-path di-mask (task 3 baseline: 10 — penurunan EXPECTED karena 15 server legacy
diganti 1 mcp-router):

- `mcp.mcp-router.headers.X-API-Key`
- `provider.inferhub.options.apiKey`
- `provider.zrouter.options.apiKey`
- `provider.markettabrak.options.apiKey`

## Harness notes (gotcha)

- Managed service port default (49374) bertabrakan dengan service V2 lain yang
  berjalan paralel (task 16/18). Fix: `opencode service set port 51717` (config
  masked) / `51718` (config real-key) sebelum `debug config`/`mcp list`. Ini murni
  gotcha isolasi harness, TIDAK terkait normalisasi config.
- Config real-key untuk smoke `mcp list` memakai harness TERPISAH
  (`task17-harness/scratch-realcfg/`); file config real-key TIDAK disalin ke evidence
  (secret tidak boleh masuk doc/evidence).

## Rekomendasi cutover (task 20/21)

1. **Tidak perlu rewrite manual** — V2 auto-normalize in-memory; rollback ke V1
   trivial (file config tidak diubah).
2. Pola mcp-router (remote url+headers) aman dipertahankan apa adanya saat cutover.
3. Perhatikan inversi `enabled` → `disabled` bila owner nanti ingin men-disable
   konektor via config V2.
4. Saat rehearsal cutover, pastikan managed service port tidak bertabrakan (set port
   eksplisit bila paralel dengan service lain).
