# Provenance & License Compliance — omo-v2 (opencode v2 port)

This fork exists solely to port [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
(OMC) from the OpenCode **V1** plugin line (`@opencode-ai/plugin` 1.18.x) to the **V2** line
(`@opencode/*` 2.0.20). It is a **private, internal-use fork**. It must never be published,
redistributed, or made public without an explicit owner decision.

## 1. Upstream provenance

| Field | Value |
|---|---|
| Upstream repository | `https://github.com/code-yeongyu/oh-my-openagent` |
| Base commit | `d1317056ebdea8d22664f87046628f105a8be58f` |
| Base commit subject | `Merge pull request #9231 from code-yeongyu/release/v5.1.4-source-state` |
| Tag at base commit | `v5.1.4` |
| Upstream license | Sustainable Use License 1.0 (SUL-1.0) |
| Fork remote (`origin`) | `https://github.com/fazulfi/omo-v2` (**PRIVATE**) |
| Upstream remote (`upstream`) | fetch-only; **push is forbidden** |

### Provenance file hashes (sha256, verified at base commit)

| File | sha256 |
|---|---|
| `LICENSE.md` | `b61ac928f152d13517328263e6bee9175b928f9ab696a2d2ca2b6cfd961ddc32` |
| `THIRD-PARTY-NOTICES.md` | `5cba3d05e48cb53d89acaf701ff727bc09a571b0b35f2ce71c9737a79901ab1b` |
| `README.md` | `63a187a3361bc972ba483f72cea76aae7ce72194611bae03020ab11e56e3f2bd` |

`LICENSE.md` and `THIRD-PARTY-NOTICES.md` (and all embedded copyright/attribution notices)
must remain **unaltered** in every commit of this fork. Do not edit, remove, or obscure them.

## 2. SUL-1.0 compliance verdict

Relevant license terms (`LICENSE.md`, lines 26–28):

> "You may use or modify the software only for your own internal business purposes or for
> non-commercial or personal use. You may distribute the software or provide it to others
> only if you do so free of charge for non-commercial purposes. You may not alter, remove,
> or obscure any licensing, copyright, or other notices of the software."

Analysis:

- The license text contains **no dollar revenue threshold**. The gate is the *mode of use*:
  internal business use and non-commercial use are permitted; distribution is permitted only
  free-of-charge for non-commercial purposes; notices must stay intact.
- This fork is used exclusively as **internal tooling** for the owner's business (zrouter /
  zcloud development orchestration). OMC is not redistributed to customers, not embedded in
  any shipped product, and not resold.
- **Verdict: PASS** — internal-use private fork is compliant with SUL-1.0.
- **Prohibited regardless** (owner decision, stricter than the license): pushing to upstream,
  npm publishing, making this repository public, or any redistribution. These stay blocked
  unless the owner explicitly re-evaluates publication.

## 3. Toolchain pin (opencode v2 target)

All port work targets the **official V2 packages at exactly `2.0.20`** (no `^`/`~` ranges):

| Package | Pinned version |
|---|---|
| `@opencode/cli` | `2.0.20` |
| `@opencode/plugin` | `2.0.20` |
| `@opencode/client` | `2.0.20` |

Rules:

- **Forbidden imports**: `@opencode-ai/plugin/v2/*` and `@opencode-ai/sdk/v2` (V1-line
  bridge subpaths, not the port target). The static parity gate must show **zero**
  `@opencode-ai/*` imports in fork `packages/*/src` once the port is complete.
- **Forbidden packages**: any third-party npm package named `opencode2` (not an official
  product). Note: the official `@opencode/cli` 2.0.20 ships its own bin alias `opencode2` —
  that alias is fine.
- The existing V1-line devDependencies (`@opencode-ai/plugin` 1.18.31,
  `@opencode-ai/sdk` 1.18.31) are replaced by the pinned V2 packages **incrementally as the
  port lands** (tasks 9–15 of the port plan), together with a `bun.lock` update. CI installs
  with `--frozen-lockfile`, so `package.json` is only edited in the same change as the
  lockfile regeneration. This section is the binding declaration; the dependency swap itself
  is forward-looking by design.

## 4. Port conventions

- Port basis: `packages/omo-opencode/src` (authored source). Never port from
  `dist/index.js` (178k-line vendor bundle).
- All changes flow through branch `port/v2` → PR → `main` (this fork only), conventional
  commits, auditable PR descriptions.
- Isolated V2 test harness: see `docs/v2-isolation.md` (moved from the interim port
  workspace). Production V1 (binary 1.18.33, user config, plugin cache) is immutable
  outside sanctioned changes.
