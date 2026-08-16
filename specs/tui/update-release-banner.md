# Update & Release Banner — Interaction Specification & Component Architecture

**Task**: T-CLI-0232 · **Layer**: coder-cli · **Category**: FRONTEND_REDESIGN
**Reference**: Claude Code interaction/layout only — no proprietary assets. Ottili brand palette is the source of truth.
**Depends on**: T-CLI-0055

This document is derived entirely from source inspection of:

- `packages/ottili-coder/src/cli/upgrade.ts` (auto-update check + `installation.update-available` emitter)
- `packages/ottili-coder/src/installation/index.ts` (channel/version detection, `latest()`, `upgrade()`, `getReleaseType`, `isPreview`)
- `packages/core/src/installation/version.ts` (`InstallationVersion` / `InstallationChannel` build-time constants)
- `packages/tui/src/app.tsx:1093-1139` (the only consumer of `installation.update-available` today)
- `packages/tui/src/component/brand-label.tsx` + `routes/session/sidebar.tsx:424` (current version display)
- `packages/tui/src/component/error-state/*` (`DegradedStateProvider` / `<DegradedStates />` — the existing top-strip banner surface)
- `packages/tui/src/ui/toast-model.ts` + `specs/tui/notifications-and-toasts.md` (toast variant/keyboard/width conventions this banner reuses)
- `packages/app/src/components/updater-action.ts` + `settings-general.tsx` (web/app update state machine)
- `packages/desktop/src/main/updater-controller.ts` + `constants.ts:3` (desktop `dev|beta|prod` updater)
- `packages/ottili-coder/src/server/routes/instance/httpapi/handlers/global.ts:97` (`global.upgrade` endpoint the TUI delegates to)

---

## 1. Current behavior (from source, not guessed)

### 1.1 Update detection & event emission (core)
- `upgrade()` (`cli/upgrade.ts:8`) runs once at startup. It is gated by `config.autoupdate` and `Flag.OTTILI_CODER_DISABLE_AUTOUPDATE` (`upgrade.ts:10`), then resolves the install `method` and `latest` (`upgrade.ts:11-13`).
- It emits exactly one `installation.update-available` event (`upgrade.ts:16-23`, `upgrade.ts:31-38`) with payload `{ version: latest }` when:
  - `Flag.OTTILI_CODER_ALWAYS_NOTIFY_UPDATE` is set, **or**
  - `InstallationVersion !== latest` **and** (`autoupdate === "notify"` **or** the release `kind !== "patch"`) — i.e. patch releases are auto-installed silently, while minor/major prompt (`upgrade.ts:26-39`).
- Otherwise it auto-installs via `Installation.upgrade(method, latest)` and emits `installation.updated` (`upgrade.ts:42-52`).
- **The emitted event carries only `version`** — never the channel of the available release, and never a changelog pointer.

### 1.2 Channel / stability model (core)
- `InstallationChannel` = `OTTILI_CODER_CHANNEL` build-time constant, defaulting to `"local"` (`core/installation/version.ts:7`). The npm path uses it as a dist-tag: `ottili-coder-ai/${InstallationChannel}` (`installation/index.ts:242`), so the live channel taxonomy is **`local` (dev) | `latest` (stable) | `beta` | `nightly`**.
- `isPreview()` = `InstallationChannel !== "latest"` (`installation/index.ts:59-61`). `isLocal()` = `=== "local"` (`installation/index.ts:63-65`).
- `getReleaseType(current, latest)` returns `"major" | "minor" | "patch"` by semver compare (`installation/index.ts:36-45`) and directly drives whether the user is prompted (`upgrade.ts:28-30`).
- **Gap**: the channel/stability distinction exists in core but is never surfaced to the user in the update prompt.

### 1.3 The only TUI consumer today (app.tsx)
- `event.on("installation.update-available", …)` (`app.tsx:1093`) is the **sole** update surface in the TUI.
- It begins with a leftover debug `console.log("installation.update-available", evt)` (`app.tsx:1094`) — dead code.
- It reads `version` and honors a previously `skipped_version` in `kv` (`app.tsx:1097-1098`) via `isVersionGreater`.
- It then opens a **blocking modal** `DialogConfirm.show(dialog, "Update Available", "A new release v… is available. Would you like to update now?", "skip")` (`app.tsx:1100-1105`).
- `skip` → persists `kv.set("skipped_version", version)` and returns (`app.tsx:1107-1110`). Confirm → `sdk.client.global.upgrade({ target: version })` (`app.tsx:1120`), shows an `info` toast "Updating…" for 30s (`app.tsx:1114-1118`), and on success shows a **second blocking** `DialogAlert` "Update Complete … Please restart" then `exit()` (`app.tsx:1122-1138`).
- **No changelog preview. No channel label. No banner. No keyboard model. No width behavior.** The modal steals focus from the active session.

### 1.4 Where the version is currently shown
- `BrandLabel` renders `Ottili Coder <version>` in the session sidebar footer (`routes/session/sidebar.tsx:424`, `brand-label.tsx:22-24`). This is the only passive version display — it shows the *installed* version, never "an update is pending".

### 1.5 Cross-surface update UX (for hierarchy consistency)
- **Web/app** (`updater-action.ts`): a clean state machine `checking | downloading | ready | installing | disabled` with a single `run` action (`check` → `install`) and a success toast on up-to-date. This is the vocabulary the TUI banner should mirror.
- **Desktop** (`updater-controller.ts`, `constants.ts:3`): a separate `electron`/`tauri`-style updater using a **different** channel taxonomy — `dev | beta | prod` — and its own `UpdaterState`. The desktop never shares the CLI's `installation.update-available` event.
- **Changelog source already exists**: `readReleaseNotes(cwd)` (`routes/session/index.tsx:623-638`) walks up to 6 dirs for `RELEASE_NOTES_*.md` and returns the newest. The banner's preview can reuse this reader.

### 1.6 Component / state map
| Concern | Owner | State primitive | Trigger |
|---|---|---|---|
| Update check + emit | `upgrade()` (`cli/upgrade.ts`) | fire-and-forget at startup | `AppRuntime` init |
| Channel/version constants | `core/installation/version.ts` | build-time consts | n/a |
| Detect latest / upgrade | `Installation` service (`installation/index.ts`) | Effect service | event → TUI |
| **TUI update surface** | `app.tsx:1093` handler | `DialogConfirm` (blocking) | `installation.update-available` |
| Version label | `BrandLabel` (`sidebar.tsx:424`) | Solid prop | mount |
| Top-strip banner region | `<DegradedStates />` (`error-state`) | Solid store | degraded states |

---

## 2. Gaps & obsolete OpenCode UX assumptions

- **G1 — Blocking modal interrupts the session.** `DialogConfirm` (`app.tsx:1100`) pops over the active session, stealing focus. Claude Code surfaces updates as a **non-blocking top banner**; the modal is the obsolete OpenCode assumption. Highest impact.
- **G2 — No changelog preview.** The user is asked to install blind. The reader (`routes/session/index.tsx:623`) already exists but is unused for updates.
- **G3 — No stable/beta/nightly visibility.** `isPreview()` / `InstallationChannel` (`installation/index.ts:59-65`) are computed but never shown; a beta user and a stable user get identical copy.
- **G4 — Leftover debug `console.log`** at `app.tsx:1094` (dead code).
- **G5 — Skip keyed by version only.** `kv.set("skipped_version", version)` (`app.tsx:1109`) ignores channel; switching preview channels with the same version number can re-prompt.
- **G6 — Two blocking dialogs, no progress.** `DialogConfirm` then `DialogAlert` (`app.tsx:1100`, `app.tsx:1132`) with a 30s `info` toast standing in for real progress. No `downloading`/`installing` state like the web/app `ready`/`installing` machine.
- **G7 — Channel taxonomy divergence.** CLI `local|latest|beta|nightly` vs desktop `dev|beta|prod` (`constants.ts:3`). Inconsistent stability vocabulary across surfaces.
- **G8 — No keyboard / width model.** Unlike the toast redesign (`specs/tui/notifications-and-toasts.md` §4.2-4.3), the current prompt has no key affordances and no terminal-width tiers.
- **G9 — Banner event is channel-less.** `installation.update-available` payload (`upgrade.ts:19,34`) carries only `version`; the TUI cannot label stability without re-deriving it.

---

## 3. Target interaction model

### 3.1 A non-blocking top banner (replaces the modal)
- A persistent, dismissible **banner strip** pinned at the top of the session/home view, rendered as a sibling strip **above** `<DegradedStates />` so updates are the highest-priority, always-visible surface until acted on or dismissed.
- The banner shows: a **stability glyph + label** (`Beta` / `Nightly` / `Update`), the **target version**, a one-line summary ("a new release is available"), and **two inline key actions**: `[c]` changelog, `[u]` update. A third `[d]` dismisses (skip).
- Clicking `[u]` opens a **single safe-install confirm** (`DialogConfirm`, reusing the existing component) that states "requires restart" — replacing the two-dialog flow. On confirm it delegates to `sdk.client.global.upgrade({ target, channel })` and shows a **progress toast** (`downloading` → `installing`) reusing the toast variant model, then a `DialogAlert` "restart required" on completion. No second blocking dialog mid-flow.

### 3.2 Changelog preview (`[c]`)
- Opens `DialogReleasePreview` (new), a TUI dialog that renders the bundled `RELEASE_NOTES_*.md` via the existing markdown renderer, reusing `readReleaseNotes(cwd)` (`routes/session/index.tsx:623`). Falls back to "No release notes found for this installation." (`routes/session/index.tsx:637`) when absent — no fabricated content.

### 3.3 Safe install action (`[u]`)
- Two-step: banner → confirm dialog (explicit "requires restart", states the channel/target) → progress toast → restart prompt. Mirrors the web/app `ready → install → installing` machine (`updater-action.ts`) so the three surfaces read consistently. The actual install stays server-side via `global.upgrade` (`handlers/global.ts:97`); the TUI only orchestrates and reports.

### 3.4 Visibility rules (state machine)
```
UpdateBannerState =
  | { status: "hidden" }
  | { status: "available"; channel: Channel; target: string; releaseType: "major"|"minor"|"patch"; current: string }
  | { status: "installing"; target: string }   // progress toast, banner hidden/collapsed
```
- `available` shows when an `installation.update-available` arrives and `{target, channel}` is not in `dismissed` (kv) and `target` is newer than `current`.
- `installing` hides the banner and switches to a progress toast; on `installation.updated` → restart prompt.

---

## 4. Information hierarchy (Claude Code-like clarity, visibly Ottili)

| Layer | Element | Color role (Ottili palette) | Density |
|---|---|---|---|
| Stability pill | `Beta` / `Nightly` / `Stable` tag | `accent` (#a77fc4) for preview, `success` for stable | single glyph + word |
| Primary text | "Update available · vX.Y.Z" | `text` (#eae6e1) | 1.0 |
| Hint | "press [c] notes · [u] update" | `textMuted` (#7d7670) | 0.7 |
| Action key | `[u]` / `[c]` / `[d]` | `primary` (#f97316) key cap | high contrast |
| Installing | progress toast | `info` (cyan) | per toast model |

Clarity rule (matches notifications spec §4.1): **color is never the only signal** — the stability pill carries a non-color word (`Beta`/`Nightly`), the action shows its key, and the version is spelled out. Brand anchors stay orange `#f97316` / plum `#a77fc4`; this is visibly Ottili, not a Claude Code copy.

---

## 5. Keyboard & terminal-width behavior

### 5.1 Keyboard
- The banner owns a **transient key layer active only while visible** (mirrors the toast layer, `notifications-and-toasts.md` §4.2) so it never steals the prompt's bindings.
- `[c]` open changelog preview · `[u]` update (→ confirm) · `[d]` dismiss/skip (`kv` `skipped_version` + channel). `Esc` dismisses only if no dialog has captured it.
- Mouse: `onMouseUp` on the action keys mirrors `footer.permission.tsx` affordances; hidden when `Flag.OTTILI_CODER_DISABLE_MOUSE` is set.
- No focus theft: the agent loop and prompt caret are unaffected. This is the core distinction from the current blocking `DialogConfirm`.

### 5.2 Terminal-width tiers (mirror notifications §4.3)
| Width | Rendered |
|---|---|
| ≥ 110 | full strip: `[Beta] Update available · v1.2.3  [c] notes  [u] update  [d] dismiss` |
| 80–109 | `Update v1.2.3  [c]  [u]  [d]` (drop the prose hint) |
| 60–79 | single line `⤓ v1.2.3 [u]` (drop changelog key + pill word) |
| < 60 | minimal tinted strip `⤓ 1.2.3` (version only; `[u]` on hover/key) |

Truncation drops the hint first, then the changelog key, then the pill word, preserving version + update action last. Re-layout on `SIGWINCH` (handled by the OpenTUI renderer, same as `DegradedStates`).

---

## 6. Component / state architecture (smallest reusable)

```
┌──────────────────────────────────────────────────────────────┐
│  packages/tui/src/ui/update-banner-model.ts   (NEW · pure)    │
│   • UpdateChannel  ("local"|"latest"|"beta"|"nightly")        │
│   • UpdateBannerState  (hidden | available | installing)      │
│   • channelLabel(channel): "Stable"|"Beta"|"Nightly"|"Dev"    │
│   • shouldShowBanner({current,target,channel,dismissed})      │
│   • bannerViewModel(state): { glyph, label, colorRole, actions }│
└───────────────┬───────────────────────────┬──────────────────┘
                │ used by                    │ uses
      ┌─────────▼──────────┐       ┌──────────▼────────────────┐
      │ component/         │       │ core/installation/version │
      │ update-banner.tsx  │       │ (InstallationChannel,     │
      │ (NEW · view)       │       │  InstallationVersion)     │
      │ + dialog-release-  │       └───────────────────────────┘
      │   preview.tsx      │
      └─────────┬──────────┘
                │ mounted in app.tsx (replace app.tsx:1093 block)
        ┌───────▼────────────┐
        │ existing <DegradedStates/> top strip (sibling) │
        └────────────────────────┘
```

### 6.1 Pure model — `packages/tui/src/ui/update-banner-model.ts`
- Mirrors `toast-model.ts` shape (pure, testable, no SolidJS). Exports `UpdateChannel`, `UpdateBannerState`, `channelLabel`, `shouldShowBanner`, `bannerViewModel`.
- `shouldShowBanner` encodes §3.4 visibility (newer-than-current + not dismissed). `bannerViewModel` maps state → glyph/label/`theme` color role/action list so the view stays presentational.

### 6.2 View — `packages/tui/src/component/update-banner.tsx` (NEW)
- A `<Show when={state().status === "available"}>` top strip, fixed `top={0}`, `maxWidth` per §5.2. Renders `bannerViewModel`. Owns the transient key layer (`[c]/[u]/[d]`, `Esc`).
- `Dismiss` writes `kv` (`skipped_version` + `skipped_channel`) — closes G5.
- `Update` → `DialogConfirm` (reuse existing component) "Update to vX (channel) — requires restart?" → on confirm `sdk.client.global.upgrade({ target, channel })` + progress toast → on `installation.updated` a `DialogAlert` restart prompt. This collapses G1/G6 into one safe flow.
- `Changelog` → `DialogReleasePreview` (NEW) rendering `readReleaseNotes(cwd)` via the markdown renderer.

### 6.3 Wire contract extension (backward compatible)
- Extend `installation.update-available` payload (`cli/upgrade.ts:19,34`) with an **optional** `channel: string` so the banner can label stability without re-deriving it (closes G9). Old emitters omitting `channel` fall back to deriving from `InstallationChannel`. No handler/schema break.

### 6.4 State boundaries (concrete)
- A single Solid store `createStore<{ state: UpdateBannerState }>({ state: { status: "hidden" } })` lives in the `app.tsx` handler scope (replacing the inline `DialogConfirm` call at `app.tsx:1093-1139`).
- The banner component reads `state` + `InstallationChannel` (passed through context like `version` at `app.tsx:391`).
- **The `Installation` service (`installation/index.ts`) is unchanged** — it remains the data source for `latest()` / `upgrade()`. The redesign only changes the *presentation* layer.
- Banner must NOT own reactive theme/refresh loops; it uses `useTheme` + `useTerminalDimensions` like `error-state`.

---

## 7. Removing OpenCode UX assumptions

- **Modal → banner.** Replace the blocking `DialogConfirm` (`app.tsx:1100`) with a non-blocking top strip; surfacing updates becomes ambient, not interrupting (mirrors Claude Code, closes G1).
- **Blind install → preview.** Add `[c]` changelog via the existing `readReleaseNotes` reader (closes G2).
- **Channel-less → labeled.** Show `Beta`/`Nightly`/`Stable` from `InstallationChannel`/`isPreview()` (closes G3, G9).
- **Two-dialog flow → confirm + progress toast.** One safe-install confirm, then a progress toast reusing the toast variant model (closes G6); aligns with web/app `ready`/`installing` (§1.5).
- **Dead code removed.** Delete the `console.log` at `app.tsx:1094` (closes G4).
- **No OpenCode-branded copy.** Branding is already Ottili; colors stay the Ottili theme palette (`brand-label.tsx`, `theme/index.ts`). Keep the upstream SDK wire contract untouched (per AGENTS.md scope).
- **Cross-surface vocabulary.** Recommend converging the desktop `dev|beta|prod` taxonomy (`constants.ts:3`) toward the CLI `local|latest|beta|nightly` in a follow-up; documented here as G7, not fixed in this spec task.

---

## 8. Feature Flag

Gate the new banner + preview behind the existing `Flag` mechanism (`packages/core/src/flag/flag.ts`):

```ts
// packages/core/src/flag/flag.ts — add (mirrors experimental getters)
get OTTILI_CODER_EXPERIMENTAL_TUI_UPDATE_BANNER() {
  return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_TUI_UPDATE_BANNER")
},
```

Default `false` (env-unset → `enabledByExperimental` returns the global experimental flag or `false`). Enable after staging validation. When **off**, `app.tsx` keeps the **identical** current behavior (`DialogConfirm` at `app.tsx:1093-1139`); the banner store stays `hidden`. The MEE feature-flag name `EVOLUTION_T_CLI_0232_TUI_REDESIGN_UPDATE_AND_RELEASE_B_ENABLED` maps to this env var.

---

## 9. Edge Cases / States

- **No update** (`installation.update-available` never fires): banner stays `hidden`; `BrandLabel` still shows installed version. No regression.
- **Empty/missing changelog**: `readReleaseNotes` returns the fallback string (`routes/session/index.tsx:637`); preview dialog shows it verbatim — no fabricated notes.
- **Same-version re-prompt**: `shouldShowBanner` compares `target > current` semver; `dismissed` is keyed by `{version, channel}` (closes G5).
- **Local/dev build** (`InstallationChannel === "local"`): banner labels `Dev`; `isLocal()` path skips auto-install.
- **Install failure**: `global.upgrade` returns `error` → error toast (existing `app.tsx:1122-1128` path kept); banner returns to `available`.
- **Width < 60**: minimal strip, version + `[u]` only (§5.2).
- **Concurrent sessions / subagents**: banner is a global top overlay (matches current global-scoped event at `upgrade.ts:17`), no per-session routing.
- **Mouse disabled** (`Flag.OTTILI_CODER_DISABLE_MOUSE`): keyboard `[c]/[u]/[d]` only.
- **Accessibility**: the strip is a focusable region with `aria-label` = `Update available vX.Y.Z, channel Beta. Press c for notes, u to update, d to dismiss.` Color reinforced by the pill word + action keys — never color-alone (per notifications §4.4).

---

## 10. Acceptance-criteria trace

| Criterion | Where satisfied |
|---|---|
| Current behavior from source | §1 (file:line cited: `app.tsx:1093`, `cli/upgrade.ts:8`, `installation/index.ts:36`) |
| Claude Code-like clarity, visibly Ottili | §4 (orange/plum brand retained; pill word + key signals) |
| Ottili colors remain source | §4, §6.4 (theme tokens; `Installation` service unchanged) |
| Keyboard & terminal-width specified | §5 (key layer + 4 width tiers) |
| Concrete component/state boundaries | §6 (`update-banner-model.ts`, `update-banner.tsx`, store, wire extension) |
| Remove obsolete OpenCode UX | §7 (modal→banner, blind→preview, channel-less→labeled) |

---

## 11. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/ottili-coder typecheck` (no new code in core; model is TUI-side).
- `bun run --cwd packages/tui typecheck`.
- Add pure-model unit tests (`packages/tui/test/ui/update-banner-model.test.ts`): `channelLabel`, `shouldShowBanner` (newer/equal/older, dismissed-by-version+channel), `bannerViewModel` glyph/color-role. Keep existing `app.tsx` / `dialog-*` callers green.
- Add a render test (`packages/tui/test/ui/update-banner.test.tsx`): 0/1 banner, the four width tiers (§5.2), `[c]` opens preview, `[u]` opens confirm, `[d]` dismisses + persists kv, `Esc` yields to dialogs.
- `bun run lint` (oxlint) and `git diff --check`.
- Manual: `tmux` TUI smoke at the four widths with a simulated `installation.update-available` (stable + beta variants); verify `BrandLabel` unchanged; web `<UpdaterAction>` and desktop `updater-controller` vocabulary alignment review.

---

## 12. Open Questions (for human review)

1. Should the banner also surface **auto-installed patch** completions (`installation.updated`) as a transient "updated to vX, restart" toast? Recommend yes (non-blocking), mirroring web success toast.
2. Channel taxonomy: converge desktop `dev|beta|prod` → CLI `local|latest|beta|nightly`? Recommend converge in a follow-up (G7); out of scope for this spec.
3. Skip granularity: per `{version, channel}` (this spec) vs per-channel-only? Recommend per `{version, channel}` to avoid re-prompt across preview flips.
4. Confirm key layer `[c]/[u]/[d]` has no collision in `packages/tui/src/keymap.tsx` before implementation (the layer is active only while the banner is visible, so collisions are unlikely).
