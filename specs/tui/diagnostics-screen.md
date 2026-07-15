# Diagnostics Screen — Interaction Specification & Component Architecture

**Task**: T-CLI-0236 · **Layer**: coder-cli · **Category**: FRONTEND_REDESIGN
**Reference**: Claude Code interaction/layout only — no proprietary assets. Ottili brand palette is the source of truth.
**Depends on**: T-CLI-0055

This document is derived entirely from source inspection of:

- `packages/ottili-coder/src/doctor.ts` (the only current "diagnostics" producer — a markdown string generator)
- `packages/ottili-coder/src/command/index.ts:140-148` (`doctor` CLI command wiring)
- `packages/tui/src/component/dialog-status.tsx` (the TUI's only status surface today, bound at `app.tsx:835-843`)
- `packages/tui/src/config/keybind.ts:89,303` (`<leader>s` → `ottiliCoder.status`)
- `packages/tui/src/context/sync.tsx:40-163` (reactive `mcp` / `lsp` / `formatter` / `plugin` / `account_status` / `cloud_status` / `session_status` store; `mcp.status` fetch at `:529`)
- `packages/tui/src/context/local.tsx:504-535` (MCP connect/disconnect helpers reading `sync.data.mcp[name].status`)
- `packages/tui/src/ui/dialog-export-options.tsx` (export *transcript* options dialog — not a diagnostics bundle)
- `packages/tui/src/context/theme/index.ts` (Ottili `Theme` palette: `primary` #f97316, `accent` #a77fc4, `success`/`warning`/`error`/`info`, `text` #eae6e1, `textMuted` #7d7670)
- `packages/tui/src/ui/update-banner-model.ts` (the pure, rendering-free, unit-testable model pattern this spec mirrors)
- `packages/tui/src/ui/dialog.tsx` + existing `*.show` promise-based dialog pattern (`dialog-export-options.tsx:187`)
- `packages/app/src/context/platform.tsx:106-107` (`exportDebugLogs?()` — desktop-only diagnostic log export)
- `packages/ottili-coder/src/server/routes/instance/httpapi/groups/control.ts:33,71` (`POST /log` only — no readable log endpoint)
- `packages/ottili-coder/src/config/config.ts:269-270` (provider/model resolution from config)

---

## 1. Current behavior (from source, not guessed)

### 1.1 The `doctor` command (core — CLI only)
- `report(cwd)` (`doctor.ts:35-60`) is the **sole** diagnostics producer. It returns a **markdown string**, never a structured object.
- It collects: `version()` (package.json, `doctor.ts:7-14`), `runtime` (`bun ${process.versions.bun} / node ${process.versions.node}`, `:39`), `platform` (`process.platform process.arch`, `:40`), `cwd` (`:41`), `git --version` + `git rev-parse --show-toplevel` (`:43-48`), hooks via `Hooks.list(cwd)` (`:50-52`), and **provider keys present** (`:54-55`).
- **Provider detection is env-name presence only.** `PROVIDER_ENV` (`doctor.ts:25-33`) is a hard-coded list of 7 env var names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `AWS_ACCESS_KEY_ID`, `OPENROUTER_API_KEY`, `OTTILI_CODER_API_KEY`, `XAI_API_KEY`). It checks `process.env[name]` and reports the name with `_API_KEY` stripped. It **never** validates key format, never probes reachability, and **cannot see** providers configured via `ottiliCoder.json` (`config.ts:269-270`) or OAuth providers (e.g. `xai.ts`, `github-copilot/copilot.ts`).
- `report` is wired as a CLI command only: `command["doctor"] = { name, description, get template() { return doctorReport(process.cwd()) } }` (`command/index.ts:140-148`). `template` is rendered as text — **there is no TUI entry point**.

### 1.2 The TUI status surface — `DialogStatus`
- Bound at `app.tsx:835-843` to command `ottiliCoder.status` (slash `/status`, category "System"), and to key `<leader>s` (`keybind.ts:89`, mapped `:303`). It is a **dialog**, not a tabbed screen.
- It renders **four** reactive sections from `useSync()`:
  - **MCP Servers** (`dialog-status.tsx:53-95`): per-server bullet colored by `item.status` ∈ `connected | failed | disabled | needs_auth | needs_client_registration` (`:62-70`), with the exact error string for `failed`/`needs_client_registration` (`:80`, `:86`).
  - **LSP Servers** (`:96-120`): `connected | error`.
  - **Formatters** (`:121-142`) and **Plugins** (`:143-165`): name (+ version).
- **What it does NOT show**: environment (version/runtime/platform/cwd/git), provider key presence or health, account/cloud status, logs, or any export action. It is a *capability inventory*, not a *diagnostics* view.

### 1.3 Cross-surface diagnostics today
- **Web/app** (`platform.tsx:106-107`): only `exportDebugLogs?()` — a **desktop-only** opaque "collect diagnostic logs" call. No structured diagnostics UI in `packages/app/src`. The web settings surface is the updater/account area (see T-CLI-0232 spec §1.5).
- **Desktop** (`packages/desktop/src/main/updater-controller.ts`, `constants.ts:3`): an `electron`/`tauri`-style updater with its own `dev|beta|prod` taxonomy — unrelated to diagnostics data.
- **Export** (`dialog-export-options.tsx`): exports a **session transcript** (thinking/toolDetails/assistantMetadata/openWithoutSaving) — a different concern from a diagnostics bundle.
- **Logs**: Effect logging (`Effect.logError/Warning/Info/Debug`) is used throughout, gated by `OTTILI_CODER_LOG_LEVEL` (`index.ts:69`, `temporary.ts:28`). The only server log hook is `POST /log` (`control.ts:33,71`) — there is **no readable log endpoint** and no TUI surface showing recent logs.

### 1.4 Component / state map
| Concern | Owner | State primitive | Trigger |
|---|---|---|---|
| Diagnostics data | `doctor.report(cwd)` (`doctor.ts`) | markdown string | CLI `doctor` cmd only |
| TUI status surface | `DialogStatus` (`dialog-status.tsx`) | `useSync()` (mcp/lsp/formatter/plugin) | `ottiliCoder.status` (`<leader>s`) |
| MCP/LSP live status | `sync.data.*` (`sync.tsx`) | Solid store, refreshed via `sdk.client.*.status` (`:529-534`) | mount + account/cloud fetch |
| Account/Cloud status | `sync.data.account_status`/`cloud_status` (`sync.tsx:40-101`) | Solid store | `fetchAccountStatus`/`fetchCloudStatus` (`:539-540`) |
| Export transcript | `DialogExportOptions` (`dialog-export-options.tsx`) | dialog promise | session export only |
| Log export | `platform.exportDebugLogs()` (app/desktop only) | platform call | desktop menu |

---

## 2. Gaps & obsolete OpenCode UX assumptions

- **G1 — Diagnostics is CLI-only.** `doctor` has no TUI route; users must drop to the shell. The TUI's only "status" surface (`DialogStatus`) is a capability list, not a diagnostics view.
- **G2 — No environment section in the TUI.** `doctor.ts` already computes version/runtime/platform/cwd/git/hooks, but `DialogStatus` never surfaces it. The data exists; the TUI wiring does not.
- **G3 — No provider presence/health in either surface.** `doctor.ts` only checks 7 hard-coded env names and cannot see config/OAuth providers (`config.ts:269`, `xai.ts`, `github-copilot/copilot.ts`). `DialogStatus` ignores providers entirely. `account_status.loggedIn` / `cloud_status.configured` (`sync.tsx:40-42`) exist but are never shown in status.
- **G4 — No log visibility anywhere.** Effect logging is present, but there is no readable endpoint (`/log` is POST-only, `control.ts:33,71`) and no TUI log surface.
- **G5 — No unified export bundle.** Transcript export (`dialog-export-options.tsx`) and desktop `exportDebugLogs()` are unrelated, siloed features. A single "export diagnostics bundle" (env + provider/MCP status + logs) does not exist in any package.
- **G6 — Diagnostics is a markdown blob, not a structured model.** `doctor.report` returns a string (`doctor.ts:35`). The OpenCode assumption is "diagnostics = text you print." This blocks a component-driven, color-coded, keyboard-navigable screen. The redesign makes diagnostics a **typed, client-fetchable service**.
- **G7 — No keyboard / width model for the status surface.** Unlike the notification (`specs/tui/notifications-and-toasts.md`) and update-banner (`specs/tui/update-release-banner.md`) specs, `DialogStatus` uses a fixed `paddingLeft={2}` with no width tiers and no section navigation keys.
- **G8 — No actionability link.** `DialogStatus` shows MCP `failed`/`needs_auth` but offers no inline path to `dialog-mcp.tsx` to fix it. Diagnostics should deep-link to the corrective dialog.
- **G9 — Provider health is not probed.** Only passive connect status (`sync`) is reflected. There is no "can I reach the provider API?" check.

---

## 3. Target interaction model

### 3.1 A single consolidated `DialogDiagnostics`
- Replaces/augments the current `ottiliCoder.status` (`app.tsx:835-843`) with **one** dialog that consolidates every diagnostic domain into collapsible **sections**: `Environment`, `Providers`, `MCP`, `LSP`, `Formatters`, `Plugins`, `Account/Cloud`, `Logs`. This mirrors Claude Code's single `/status` panel while staying visibly Ottili.
- Each section header shows a **summary glyph + word** using the Ottili palette (`success`/`warning`/`error`/`textMuted`) so color is never the only signal.
- Reuses the existing `DialogStatus` section renderers (MCP/LSP/Formatters/Plugins) verbatim where possible; adds the missing sections (Environment, Providers, Account/Cloud, Logs) and the Export action.

### 3.2 Environment section (from `doctor`)
- Renders the structured equivalent of `doctor.report` (`doctor.ts:38-52`): `version`, `runtime` (bun/node), `platform`, `cwd`, `git` (+ repo root), `hooks`. Values are fields (`theme.textMuted` key, `theme.text` value), not a markdown blob.

### 3.3 Providers section
- Lists every provider the user could use, from three sources unified: (a) env keys (`PROVIDER_ENV`, `doctor.ts:25-33`), (b) `ottiliCoder.json` provider config (`config.ts:269-270`), (c) OAuth/plugin providers (`xai.ts`, `github-copilot/copilot.ts`), and (d) `account_status.loggedIn` (`sync.tsx:40`).
- Per provider: `name`, `source` (env | config | oauth | account), and a status derived as: `error` if configured-but-no-credential-or-auth-failed, `warn` if present-but-unverified, `ok` if `account_status.loggedIn` (OAuth) or env key present. **Keys are never displayed** — only presence/health, satisfying the secret-redaction rule.

### 3.4 Logs section
- Shows the last N lines (default 200) of the runtime log stream. Because no readable endpoint exists today (G4), this section is the **implementation trigger** for adding a readable log source (see §6.3). Until then it shows "Logs unavailable in this build" rather than fabricated content.

### 3.5 Export bundle (`[x]`)
- A single `[x]` Export action gathers: structured environment, provider/MCP/LSP/account status snapshots, and recent logs, into one markdown file (redacting any key/token values via `redactSensitive` from `agent-roster/model.ts:112`).
- On TUI: reuse the `DialogExportOptions.show` filename-prompt pattern (`dialog-export-options.tsx:187`) but write the diagnostics bundle; default filename `ottili-diagnostics-<timestamp>.md`.
- On desktop/web: delegate to the existing `platform.exportDebugLogs()` parity where available.
- On CLI: extend `doctor` with `--export <path>` writing the same bundle.

### 3.6 Refresh (`[r]`)
- Re-runs `collectDiagnostics`; shows the existing `spinner.ts` while in flight. Respects `Effect.cached`-style memoization so passive `sync` updates still flow.

---

## 4. Information hierarchy (Claude Code-like clarity, visibly Ottili)

| Layer | Element | Color role (Ottili palette) | Density |
|---|---|---|---|
| Dialog title | "Diagnostics" + `esc` hint | `text` bold / `textMuted` | 1.0 |
| Section header | Environment / Providers / MCP / … | `text` bold + summary glyph | 1.0 |
| Summary glyph | ● ok / ▲ warn / ✕ err | `success` / `warning` / `error` | high contrast |
| Field key | "version", "git" | `textMuted` | 0.7 |
| Field value | `1.0.5-beta`, `bun 1.x` | `text` | 1.0 |
| Action key | `[x]` export · `[r]` refresh | `primary` (#f97316) key cap | high contrast |
| Log line (error) | recent error entries | `error` | 1.0 |

Clarity rule (matches notifications §4.1 / update-banner §4): **color is never the only signal** — every status carries a glyph + word, every action shows its key, and values are spelled out. Brand anchors stay orange `#f97316` / plum `#a77fc4`; this is visibly Ottili, not a Claude Code copy.

---

## 5. Keyboard & terminal-width behavior

### 5.1 Keyboard
- **Open**: `<leader>D` (new, free — only `<leader>s` is taken, `keybind.ts:89`) and slash `/diagnostics`. Keep `/status` mapped to the same dialog (deprecate the old `DialogStatus` surface behind the flag in §8).
- **Navigate sections**: `Tab` / `Shift+Tab` (or `↑`/`↓`) move focus between section headers; the active section uses `theme.borderActive` focus ring. `↑`/`↓` within a section move between items.
- **Actions**: `[x]` export bundle · `[r]` refresh · `Esc` close (yields to any nested dialog such as `dialog-mcp.tsx` opened via G8 deep-link).
- **Mouse**: click a section header to expand/collapse; click an action key. Hidden when `Flag.OTTILI_CODER_DISABLE_MOUSE` is set (mirrors `footer.permission.tsx`).
- **No focus theft**: the dialog is a modal overlay like `DialogStatus`; the agent loop and prompt caret are suspended while open (existing dialog behavior at `app.tsx:840`).

### 5.2 Terminal-width tiers
| Width | Rendered |
|---|---|
| ≥ 110 | full: every section expanded inline with all fields + `[x] [r]` |
| 80–109 | sections as one-line summary rows (`● MCP 3 · ▲ Providers 1`); expand focused section |
| 60–79 | single summary line: `Diagnostics: 3 ok · 1 warn · 0 err  [x]` |
| < 60 | minimal tinted strip: `⚕ 3·1·0` (ok·warn·err counts) + `[x]` on focus |

Truncation drops field values first, then section bodies, preserving the summary counts + export action last. Re-layout on `SIGWINCH` (OpenTUI renderer, same as `DegradedStates`).

---

## 6. Component / state architecture (smallest reusable)

```
┌──────────────────────────────────────────────────────────────┐
│  packages/tui/src/ui/diagnostics-model.ts   (NEW · pure)       │
│   • DiagnosticsStatus ("ok"|"warn"|"error"|"unknown")         │
│   • DiagnosticsItem / DiagnosticsSection / DiagnosticsData    │
│   • collectDiagnostics(cwd, sources): Promise<DiagnosticsData>│
│   • sectionSummary(section): DiagnosticsStatus                │
│   • diagnosticsViewModel(data): { sections, overall, export } │
│   • redactSecrets(text)  (reuses redactSensitive, model.ts:112)│
└───────────────┬───────────────────────────┬──────────────────┘
                │ used by                    │ reads (client)
      ┌─────────▼──────────┐       ┌──────────▼────────────────────┐
      │ component/         │       │ sdk.client.system.diagnostics │
      │ dialog-diagnostics │       │ (NEW GET → doctor.collect)    │
      │ .tsx  (NEW · view) │       │ + sync.data.* (live status)   │
      └─────────┬──────────┘       └──────────────────────────────┘
                │ mounted in app.tsx (replace app.tsx:835-843 block)
         ┌───────▼────────────────┐
         │ existing dialog system │ (dialog.tsx, useDialog)
         └────────────────────────┘
```

### 6.1 Pure model — `packages/tui/src/ui/diagnostics-model.ts`
- Mirrors `update-banner-model.ts` (pure, no SolidJS, fully unit-testable). Exports the typed `Diagnostics*` shapes, `collectDiagnostics`, `sectionSummary`, `diagnosticsViewModel`, `redactSecrets`.
- `collectDiagnostics` is async and accepts injected `sources` (env reader, config reader, `sync` snapshot, log reader) so tests stub them — no network/filesystem in unit tests.
- Reuses `redactSensitive`, `truncate`, `isNarrow` from `agent-roster/model.ts` (exactly as `update-banner-model.ts:17` already does).

### 6.2 View — `packages/tui/src/component/dialog-diagnostics.tsx` (NEW)
- A `<Show>`-free dialog (always rendered when opened) that calls `dialog.setSize("large")` and renders `diagnosticsViewModel`. Owns the key layer (`<leader>D`, `Tab`, `[x]`, `[r]`, `Esc`).
- Reads `useSync()` (mcp/lsp/formatter/plugin/account_status/cloud_status) reactively for live status, and `useTheme()` for palette.
- Export delegates to a `DialogExportOptions`-style filename prompt writing the bundle (redacted). Refresh re-invokes `collectDiagnostics`.
- Deep-link: a failed MCP row's `[fix]` opens `dialog-mcp.tsx` (closes G8).

### 6.3 Wire contract extension (backward compatible, client model)
- Add `GET /system/diagnostics` (or `global.diagnostics`) on the HTTP API that returns structured `DiagnosticsData`. The handler reuses a **new structured** `doctor.collect(cwd)` sibling of `report()` (`doctor.ts`), keeping `report()` intact for the CLI `get template()` (`command/index.ts:144-146`).
- The TUI calls `sdk.client.system.diagnostics()` (or `sdk.fetch`) — no cross-package import of `@ottili-coder` into the TUI package. This is the clean "diagnostics is a service, not a printed blob" boundary that removes G6.
- For Logs (G4): the same handler additionally exposes the most recent log lines from the runtime log sink. **Open question** — confirm the readable log source (see §12.1); if none exists yet, the handler returns `available: false` and the section shows the honest fallback.

### 6.4 State boundaries (concrete)
- A single Solid store inside `DialogDiagnostics`: `{ data: DiagnosticsData | null, activeSection, expanded: Set, loading }`.
- Live `sync.data.*` is read reactively (not copied), so MCP/LSP/account changes reflect without a manual refresh.
- `doctor.collect` / the `/system/diagnostics` handler is the **only** data source; the view stays presentational. The `Installation` service and `sync` fetch loops are unchanged.
- No new reactive theme/refresh loops; uses `useTheme` + `useTerminalDimensions` (like `error-state` / `DegradedStates`).

---

## 7. Removing OpenCode UX assumptions

- **Printed blob → structured service.** Replace the markdown `doctor.report` as the *only* output with a typed `doctor.collect` + `GET /system/diagnostics` (closes G6). The CLI `report` stays for terminal use.
- **CLI-only → TUI-first.** Add `ottiliCoder.diagnostics` (`<leader>D`, `/diagnostics`) consolidating `DialogStatus`'s sections plus the missing ones (closes G1, G2, G3).
- **Siloed exports → one bundle.** Unify transcript export, desktop `exportDebugLogs`, and a new CLI `--export` behind a single `collectDiagnostics` + redaction path (closes G5).
- **Silent logs → visible + exportable.** Add a readable log source and a Logs section (closes G4).
- **Static status → actionable.** Failed MCP/provider rows deep-link to the corrective dialog (closes G8).
- **No keyboard/width model → explicit.** Add the §5 key layer + 4 width tiers (closes G7).
- **No brand drift.** Colors stay the Ottili theme tokens; no OpenCode/Anthropic copy or assets. Upstream SDK wire contracts are untouched (per AGENTS.md scope).

---

## 8. Feature Flag

Gate the new dialog + endpoint behind the existing `Flag` mechanism (`packages/core/src/flag/flag.ts`):

```ts
// packages/core/src/flag/flag.ts — add (mirrors experimental getters)
get OTTILI_CODER_EXPERIMENTAL_TUI_DIAGNOSTICS() {
  return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_TUI_DIAGNOSTICS")
},
```

Default `false` (env-unset → `enabledByExperimental` returns the global experimental flag or `false`). When **off**, `app.tsx` keeps the **identical** current behavior (`DialogStatus` at `app.tsx:835-843`); the new store stays `null`. The MEE feature-flag name `EVOLUTION_T_CLI_0236_TUI_REDESIGN_DIAGNOSTICS_SCREEN__IN_ENABLED` maps to this env var.

---

## 9. Edge Cases / States

- **No MCP/LSP/plugins** (`sync.data.*` empty): section shows "None configured" (`textMuted`), summary `ok` (nothing broken). No crash (mirrors `DialogStatus` `fallback`).
- **Env keys absent**: Providers section shows `warn` "No API keys detected" with the set-env hint from `doctor.ts:58-59` — no fabricated keys.
- **Provider auth failed** (`account_status.loggedIn === false`): `error` glyph + "Sign in with /login" deep-link.
- **Logs unavailable** (no readable source yet): Logs section shows the honest fallback (G4) — never fabricated lines.
- **Secret redaction**: keys/tokens are shown only as presence/health; export bundle runs `redactSecrets` over every field.
- **Width < 60**: minimal count strip + `[x]` on focus (§5.2).
- **Concurrent sessions / subagents**: dialog is a global overlay (matches current global-scoped `ottiliCoder.status`).
- **Mouse disabled** (`Flag.OTTILI_CODER_DISABLE_MOUSE`): keyboard `[x]`/`[r]`/`Tab`/`Esc` only.
- **Accessibility**: the dialog is a focusable region with `aria-label` = `Diagnostics: N ok, M warn, K error. Tab to navigate sections, x to export, r to refresh, esc to close.` Color reinforced by glyph + word — never color-alone.
- **Loading**: `spinner.ts` while `collectDiagnostics` is in flight; previous data stays visible underneath.

---

## 10. Acceptance-criteria trace

| Criterion | Where satisfied |
|---|---|
| Current behavior from source | §1 (file:line cited: `doctor.ts:35`, `command/index.ts:140`, `dialog-status.tsx:53`, `sync.tsx:529`) |
| Claude Code-like clarity, visibly Ottili | §4 (orange/plum retained; glyph + word + key signals) |
| Ottili colors remain source | §4, §6.4 (theme tokens; `doctor`/`sync` unchanged) |
| Keyboard & terminal-width specified | §5 (key layer + 4 width tiers) |
| Concrete component/state boundaries | §6 (`diagnostics-model.ts`, `dialog-diagnostics.tsx`, store, `GET /system/diagnostics`) |
| Remove obsolete OpenCode UX | §7 (blob→service, CLI-only→TUI, siloed→bundle, silent→visible) |

---

## 11. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/ottili-coder typecheck` (no new runtime code in core beyond `doctor.collect`; model is TUI-side).
- `bun run --cwd packages/tui typecheck`.
- Add pure-model unit tests (`packages/tui/test/ui/diagnostics-model.test.ts`): `sectionSummary` (ok/warn/error/unknown), `redactSecrets` (key values stripped), `diagnosticsViewModel` (overall rollup), `collectDiagnostics` with stubbed sources (env-only, config-only, mixed, empty).
- Add a render test (`packages/tui/test/ui/dialog-diagnostics.test.tsx`): 0/1 dialog, the four width tiers (§5.2), `[x]` opens export prompt, `[r]` triggers refresh, failed-MCP `[fix]` opens `dialog-mcp`, `Esc` closes. Keep existing `DialogStatus` / `dialog-*` callers green.
- `bun run lint` (oxlint) and `git diff --check`.
- Manual: `tmux` TUI smoke at the four widths with a simulated `GET /system/diagnostics` (ok + warn + error variants); verify `DialogStatus` unchanged when flag is off; verify desktop `exportDebugLogs` parity review.

---

## 12. Open Questions (for human review)

1. **Readable log source.** Searched the codebase: logging is Effect `logError/Warning/Info/Debug` with level gated by `OTTILI_CODER_LOG_LEVEL` (`index.ts:69`), and the only server hook is `POST /log` (`control.ts:33,71`) — there is **no GET / readable file sink** I could find. The Logs section and export bundle need a decided source (in-memory ring buffer vs. a new readable endpoint). Recommend adding a capped ring buffer in the Effect logger that `/system/diagnostics` reads.
2. **Provider health probing.** Presence + `account_status.loggedIn` first (recommended); optional async provider ping behind `[r]`. Confirm whether active reachability probing is in scope.
3. **Unify vs keep `DialogStatus`.** Recommend unifying into `DialogDiagnostics` and deprecating `DialogStatus` behind the flag (§8). Confirm no external consumer depends on the old command name.
4. **Filename prompt reuse.** Extend `DialogExportOptions.show` (`dialog-export-options.tsx:187`) with a `bundle` mode, or add a lightweight prompt in `dialog-diagnostics.tsx`. Recommend extending the existing one.
5. **Keymap collision.** `<leader>D` is currently free (only `<leader>s` at `keybind.ts:89`). Confirm no plugin/theme overrides `<leader>D` before implementation.
