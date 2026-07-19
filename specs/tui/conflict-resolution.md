# TUI Redesign — Conflict Resolution UI

## Task

- **Task ID**: `13c55977-d3e6-47a5-bbe7-4997944b8fc3`
- **Title**: T-CLI-0228 — TUI redesign: Conflict resolution UI — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; backend aggregate is a documented dependency.

---

## 1. Goal

Define the exact interaction model for the **Conflict resolution UI** in Ottili Coder:
git merge/rebase conflict list, per-file resolver, diff-backed conflict viewer,
validation, and abort/continue actions. Map current components and state, remove
obsolete OpenCode UX assumptions, and design the smallest reusable Ottili Coder
component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette (`packages/tui/src/theme`).
No pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Backend detection (`packages/tui/src/component/conflict-resolution/dialog.tsx`)

- `loadGitConflicts(dir)` runs `git rev-parse --git-path MERGE_HEAD` to detect
  merge conflicts, falls back to `git rev-parse --git-path rebase-merge` for rebase
  conflicts, then lists unmerged files via `git diff --name-only --diff-filter=U`
  (dialog.tsx:16-35).
- Detection is **polling only** — no live watch event. The dialog runs it once on
  mount (dialog.tsx:71, `onMount(load)`).
- Returns `ConflictFile[]` with `path`, `type` (merge/rebase/unknown), optional
  `binary` flag.

### 2.2 TUI state — Pure model (`packages/tui/src/component/conflict-resolution/model.ts`)

Well-architected pure domain model following the established pattern (303 lines):

| Type | Purpose |
| --- | --- |
| `ConflictFile` | One conflicted file: `path`, `type`, `binary?`, `resolution?`, `content?` |
| `ConflictSide` | `"ours"` \| `"theirs"` \| `"union"` \| `"manual"` |
| `ConflictResolutionStatus` | `"empty"` \| `"resolving"` \| `"ready"` \| `"error"` |
| `ConflictContext` | Harness-level `loading` + `error?` |
| `ConflictResolutionState` | Full derived state with `focusIndex`, `focusedPath`, `resolved`/`unresolved`, `allResolved`, `narrow`, `stale`, `status`, `summaryText` |
| `ResolutionReport` | Validation: `total`, `resolved`, `unresolved`, `allResolved`, `remaining` |
| `ConflictAction` | `select` \| `resolve` \| `continue` \| `abort` \| `blocked` |

Key pure functions:
- `conflictResolutionState(files, ctx, overrides)` — state constructor
- `resolveFile(files, path, side, content?)` — resolve one file (returns new array)
- `unresolveFile(files, path)` — undo resolution
- `validateResolution(files)` — counts and remaining set
- `mergeConflicts(prev, partial)` — streaming reconciliation, preserves existing resolutions
- `moveFocus(state, direction)` — keyboard focus, clamped
- `continueAction(allResolved, unresolved)` — action builder (blocked if unresolved remain)

### 2.3 TUI render — Solid component (`packages/tui/src/component/conflict-resolution/index.tsx`)

- `ConflictResolutionView` (179 lines) — file list, keyboard nav, action bar
- **Information shown per file**: path + `resolutionBadge` (`[ ]`, `[ours]`, `[theirs]`, `[union]`, `[manual]`)
- **Keyboard bindings**: `up`/`left`, `down`/`right` (focus), `o`/`t`/`u`/`m` (resolve sides), `enter` (select), `c` (continue), `a` (abort)
- **Action bar**: `[o]urs [t]heirs [u]nion [m]anual [c]ontinue [a]bort` + `⟳ scanning…` when stale
- **Narrow terminal** (< 60 cols): drops whitespace padding between file path and badge
- **Error state**: "Resolution failed" header + redacted error text; file list hidden
- **Empty state**: "No conflicts to resolve."
- **Stale state**: "⟳ scanning…" marker while streaming

### 2.4 Dialog wrapper (`packages/tui/src/component/conflict-resolution/dialog.tsx`)

- `DialogConflictResolution` (105 lines) — loads conflicts from git, renders the view
- Props: `api?` (TuiPluginApi), `loadConflicts?` (test override), `onResolve?` (continue/abort callback)
- App registration: `app.tsx:853-861` via slash command `"resolve"` → `dialog.replace(() => <DialogConflictResolution api={api} />)`

### 2.5 Tests

| File | Lines | Coverage |
| --- | --- | --- |
| `test/component/conflict-resolution/model.test.ts` | 255 | Pure model: type normalization, resolve/unresolve, validation, state construction, narrow terminal, focus navigation, action mapping, resolution badges, streaming merge, error+redaction |
| `test/component/conflict-resolution/index.test.tsx` | 296 | Component: semantic output, binary files, narrow width, keyboard nav, resolution keybindings, progress updates, validation blocking, abort/continue, streaming "scanning" marker, error+redaction |

### 2.6 Integration points

- **Git status bar** (`packages/tui/src/component/git-status/model.ts`): conflict segment (`⚠ conflict N`) in `theme.error`, action type `"resolve"` → `GitBarAction`
- **DialogGitStatus** (`packages/tui/src/component/dialog-git-status.tsx`): `⚠ N conflict(s)` in `theme.error` when `info().conflict > 0`; no link to the conflict resolver
- **Diff viewer** (`packages/tui/src/feature-plugins/system/diff-viewer.tsx`): full-featured diff viewer (hunks, accept/reject, file trees, split/unified), entirely separate from conflict resolution — no integration path
- **Legacy git status bar** (`packages/tui/src/component/git-status-bar.tsx`): shows `⚠{N}` for conflicts
- **Plugin adapters** (`packages/tui/src/plugin/adapters.tsx:121`): exposes `conflict` from VCS state

### 2.7 Web app + desktop

- Desktop is an Electron wrapper around the web app (`packages/app`), sharing components.
- The web app has no conflict resolution UI — only merge conflict detection via `vcs.status()` boolean dirty check.
- No conflict resolution components exist in `packages/app` or `packages/desktop`.

---

## 3. Gaps

### 3.1 No diff-backed conflict preview

The current conflict resolution UI shows only **file paths** and **resolution badges**.
It never displays the actual conflicting content (`<<<<<<<` / `=======` / `>>>>>>>` markers).
Users must `enter` (select) a file and then manually open it in their editor to see
what needs resolving. The full diff viewer (`diff-viewer.tsx`) exists but is entirely
disconnected from the conflict panel.

### 3.2 No per-line resolution

Resolution is file-granular only: pick side or mark manual. There is no hunk-by-hunk
conflict editing, no ability to accept/reject individual conflict markers, and no
inline merge editor. The diff viewer's hunk model (`acceptedHunks`, `rejectedHunks`,
`selectedHunk`) is not reused.

### 3.3 No "diff" action per file

The `enter` / `select` action emits a `ConflictAction` (`{ type: "select", path }`),
but no handler in `DialogConflictResolution` or `app.tsx` actually opens a diff view
for it. The action is defined but dead code.

### 3.4 No conflict file count in git status dialog link

`DialogGitStatus` shows `⚠ N conflict(s)` but has no click/keyboard action to open
the conflict resolver. The git status bar's action type `"resolve"` does navigate
to the resolver, but the status dialog does not.

### 3.5 Stale conflict detection

Conflicts are loaded once on mount. A user who resolves files externally (editor,
`git add`) then returns to the TUI will see stale data. The dialog should be
refreshable (e.g. via `r` key or auto-poll).

### 3.6 No web/desktop parity

Conflict resolution is TUI-only. Web and desktop apps have no way to navigate
to or resolve conflicts from within the app. The underlying SDK (`@opencode-ai/sdk`)
already exposes `vcs.status()` — extend to `vcs.conflicts()` for cross-surface
parity.

### 3.7 No conflict resolution from the git status bar

Clicking the conflict segment in the git status bar emits `{ type: "resolve" }`,
but the parent handler (`app.tsx`) does not currently route this action to the
conflict dialog. The action is defined but the wiring is missing.

### 3.8 No keyboard-driven file filtering/search

With many conflicted files, keyboard navigation requires scrolling through the
entire list. There is no `fuzzy search within conflict files` or `filter unresolved`
toggle (common in Claude Code's conflict resolver).

### 3.9 Minimal feedback for "manual" resolution

Marking a file `[manual]` provides no further guidance. Users must know to `git add`
it externally or edit it. The panel could show the file path as a hint when the
file is selected for manual resolution.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A **conflict resolution dialog** with two zones: a compact file list on the left
and a diff-backed conflict viewer on the right when a file is selected. On narrow
terminals, the viewer overlays or replaces the list.

Proposed **full-width layout** (≥ 100 cols):

```
┌─────────────────────────────────────────────────────────────┐
│ Merge conflicts — 2/4 resolved · 2 to go           esc      │
│                                                             │
│  ⚠ src/a.ts              [ours]  +10 -3                    │
│  > src/b.ts              [ ]     <<<<<<< 7 →  ||| 3 → >>>>>│
│    src/c.ts              [ ]      +++ private helpers.ts    │
│    docs/README.md        [ ]      ---  3 checking functions │
│                                                             │
│  > src/b.ts  ·  3 conflict regions   ·  ours: v2.1          │
│                                                             │
│ [o]urs [t]heirs [u]nion [m]anual [d]iff  [c]ontinue [a]bort│
└─────────────────────────────────────────────────────────────┘
```

Layout zones (top to bottom):

| Zone | Content | When visible |
| --- | --- | --- |
| **Header** | Summary line + `esc` to close | always |
| **File list** (primary) | Focusable conflict files with path, badge, +/- line counts | `files.length > 0` |
| **Conflict preview** (detail panel) | Per-hunk conflict markers with inline side picker, OR diff of working tree vs resolved | focused file has conflicts pending |
| **Status line** | Focused file + conflict region count + current resolution | file focused |
| **Action bar** | All resolution shortcuts with conditional styling | `status !== "error"` |

### 4.2 File list column detail

Per-file row, dense (Claude Code-inspired):

```
  ⚠ src/a.ts              [ours]  +10 -3
> src/b.ts                [ ]     <<<<<<<  7 conflict regions
  src/c.ts                [manual] ✎ edited
  docs/README.md          [ ]     binary
```

1. **Focus marker**: `> ` or `  ` (2 chars)
2. **Conflict icon**: `⚠` if unresolved, none if resolved
3. **File path**: left-aligned, wrapped to fit
4. **Resolution badge**: `[ ]`, `[ours]`, `[theirs]`, `[union]`, `[manual]` — same as current
5. **Detail**: on standard widths (≥ 80), show:
   - Resolved files: `+{additions} -{deletions}` from conflict region stats
   - Unresolved files: `<<<<<<<  N conflict regions`
   - Manual: `✎ edited` when content is set
   - Binary: `binary`

In narrow mode (< 80 cols): only path and badge, same as current implementation.

### 4.3 Conflict preview (split view, ≥ 120 cols)

When a file is focused (especially via `enter` or `d` key), show a **diff-style
conflict viewer** below the file list, using the existing `<diff>` element from
`@opentui/core` that the diff-viewer already uses.

Each conflict region rendered as:

```
<<<<<<< ours (current branch)
  existing code here
=======
  incoming code here
>>>>>>> theirs (feature branch)

[o] accept ours  [t] accept theirs  [u] accept both  [m] edit manually
```

The preview is scrollable if the file has many conflict regions. Each region can
be resolved independently (hunk-level) or the whole file at once.

At narrower widths (< 120), the preview is a unified diff view (same as the
diff viewer's flag-off behavior at non-wide terminals).

### 4.4 Keyboard bindings

| Key | Action | Scope |
| --- | --- | --- |
| `up` / `k` | Move focus up one file | File list |
| `down` / `j` | Move focus down one file | File list |
| `o` | Resolve focused file to "ours" | File list (file-level) |
| `t` | Resolve focused file to "theirs" | File list (file-level) |
| `u` | Resolve focused file to "union" | File list (file-level) |
| `m` | Mark focused file as "manual" | File list |
| `enter` / `return` | Open conflict preview for focused file | File list |
| `d` | Toggle conflict preview / diff view | Any |
| `r` | Refresh conflict list from git | Any |
| `/` | Enter search/filter mode within file list | File list |
| `c` | Continue merge/rebase | Any |
| `a` | Abort merge/rebase | Any |
| `esc` | Close dialog (or close preview back to list) | Any |
| `Tab` | Toggle focus between file list and conflict preview | Preview open |

Hunk-level keys (when conflict preview has focus):

| Key | Action |
| --- | --- |
| `up` / `k` | Previous conflict region |
| `down` / `j` | Next conflict region |
| `o` | Accept ours for this region |
| `t` | Accept theirs for this region |
| `u` | Accept both (union) for this region |
| `shift+o` | Accept ours for **all** remaining regions |
| `shift+t` | Accept theirs for **all** remaining regions |
| `shift+u` | Accept union for **all** remaining regions |
| `m` | Mark region as manual edit |

### 4.5 Terminal-width behavior

| Width | Layout |
| --- | --- |
| ≥ 120 | Full: file list (left) + conflict preview (right, `<diff>` split view) |
| 80–119 | File list full width + conflict preview below (unified diff) |
| 60–79 | File list + compact action bar (no detail column in file list) |
| < 60 | File list only + collapsed action bar: `[o] [t] [u] [m] [c] [a]` |

Width behavior reuses the `ResponsiveLayoutState` tier system from T-CLI-0212:
- `wide` (≥ 120): split view
- `standard` (100–119): preview below
- `compact` (60–99): detail column dropped
- `narrow` (< 60): collapsed action bar

The conflict preview opens **inline** (below or beside the file list) on all tiers.
It never overlays in a separate dialog, maintaining the single-dialog model.

### 4.6 Accessibility

- Each file row has a semantic text label (path + status).
- Resolution badges are text, not color-only — `[ours]` is readable without color.
- Keyboard fully drives every action; no mouse-required path.
- `Tab` alternates between file list and preview pane.
- The `/` filter shows a prompt line: `Filter: ` with live results.
- Color follows the Ottili palette: error (red) for unresolved, success (green)
  for resolved, warning (orange) for manual, primary (orange) for focus.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Current state — model additions needed

The existing `ConflictFile` type needs two new fields:

```ts
export interface ConflictFile {
  readonly path: string
  readonly type: ConflictType
  readonly binary?: boolean
  readonly resolution?: ConflictSide
  readonly content?: string
  // NEW — stats extracted from git conflict regions
  readonly conflictRegions?: number    // count of <<<<<< regions
  readonly additions?: number          // ++ lines across all regions
  readonly deletions?: number          // -- lines across all regions
  // NEW — per-region resolution state for the preview
  readonly regionResolutions?: Array<{
    regionIndex: number
    resolution?: ConflictSide
    content?: string
  }>
}
```

New derived state fields in `ConflictResolutionState`:

```ts
export interface ConflictResolutionState {
  // ... existing fields unchanged ...
  readonly previewOpen: boolean         // NEW — conflict preview visible
  readonly previewFileIndex: number     // NEW — which file's preview
  readonly previewFocus: "list" | "regions"  // NEW — tab focus
  readonly filterQuery: string          // NEW — active filter text
  readonly filteredFiles: ReadonlyArray<ConflictFile>  // NEW — filtered view
  readonly conflictRegionsTotal: number  // NEW — sum across all files
}
```

### 5.2 New component: `ConflictPreview`

**File**: `packages/tui/src/component/conflict-resolution/preview.tsx`

Pure-presentation component that renders the inline conflict viewer for one file:

```tsx
export interface ConflictPreviewProps {
  file: ConflictFile
  /** Hunk/region-level data from git conflict parsing */
  regions: ConflictRegion[]
  /** Currently focused region index */
  focusRegion: number
  /** Width for layout calculation */
  width: number
  onAction?: (action: ConflictRegionAction) => void
}
```

Reuses `<diff>` element from `@opentui/core` for rendering conflict markers with
syntax highlighting (same as `diff-viewer.tsx`). Renders each conflict region as a
compact diff block.

Rendering states:
- **No file focused**: `"Select a file to view conflicts"` (muted text)
- **File without conflicts**: `"No conflict regions in this file"` (edge case)
- **Binary file**: `"Binary file — resolve to a side"` (no preview)
- **Normal**: `<<<<<<<` / `=======` / `>>>>>>>` blocks with side-pick buttons
- **All resolved per-region**: green `"All regions resolved"` badge
- **Loading**: skeleton or spinner

### 5.3 New component: `ConflictFileFilter`

**File**: `packages/tui/src/component/conflict-resolution/filter.tsx`

A minimal one-line filter input that narrows the file list:

```tsx
export interface ConflictFileFilterProps {
  query: string
  onChange: (query: string) => void
  onClear: () => void
  resultCount: number
}
```

When `resultCount === 0`, show `"No matching conflicts"` in muted text.
When active, the file list is constrained to the filtered set; focus moves to
the first matching file.

### 5.4 Model additions: filter and preview state

In `model.ts`, add:

```ts
export function filterFiles(
  files: ReadonlyArray<ConflictFile>,
  query: string,
): ReadonlyArray<ConflictFile> {
  if (!query) return files
  const lower = query.toLowerCase()
  return files.filter((f) => f.path.toLowerCase().includes(lower))
}

export function togglePreview(
  state: ConflictResolutionState,
  fileIndex: number,
): ConflictResolutionState {
  if (state.previewOpen && state.previewFileIndex === fileIndex) {
    return { ...state, previewOpen: false }
  }
  return { ...state, previewOpen: true, previewFileIndex: fileIndex, previewFocus: "list" }
}

export function previewFocusTab(
  state: ConflictResolutionState,
): ConflictResolutionState {
  const next: "list" | "regions" = state.previewFocus === "list" ? "regions" : "list"
  return { ...state, previewFocus: next }
}
```

### 5.5 Integration with the diff viewer

The conflict preview should **not** reinvent the diff engine. Reuse:

- `<diff>` element from `@opentui/core` — already used by `diff-viewer.tsx` for
  syntax-highlighted diffs
- `buildAcceptedPatch` / `countHunks` / `normalizeAccepted` from
  `diff-viewer-hunks.ts` — the hunk model maps directly to conflict regions
- `filetype()` from `diff-viewer.tsx:75-80` to determine syntax highlighting

A new bridge module `packages/tui/src/component/conflict-resolution/diff-bridge.ts`
converts `ConflictRegion[]` into the `DiffRenderable` format that `<diff>` expects.

### 5.6 Keyboard handler split

The current `useKeyboard()` in `index.tsx` is a single flat switch statement. For
the two-focus-zone model (file list vs. conflict regions), split keyboard handling:

1. **`useConflictListKeyboard(props, state, setState)`** — handles file navigation
   (`up`/`down`/`j`/`k`), resolution keys (`o`/`t`/`u`/`m`), `enter`/`return` to
   open preview, `r` to refresh, `/` to filter, `c`/`a` for lifecycle.
2. **`useConflictRegionKeyboard(props, state, setState)`** — handles region
   navigation, per-region resolution, `Shift+O/T/U` for bulk, `Tab` to switch
   back to list.

Active keyboard handler is selected based on `previewFocus`:
```ts
if (state.previewOpen && state.previewFocus === "regions") {
  useConflictRegionKeyboard(...)
} else {
  useConflictListKeyboard(...)
}
```

### 5.7 Refresh mechanism

Add refresh logic to `DialogConflictResolution`:

```ts
// New prop
refreshInterval?: number  // ms (default: 0 = no auto-refresh)

// In component
let refreshTimer: Timer | undefined
onMount(() => {
  load()
  if (props.refreshInterval && props.refreshInterval > 0) {
    refreshTimer = setInterval(load, props.refreshInterval)
  }
})
onCleanup(() => clearInterval(refreshTimer))

// Keyboard trigger
case "r":
  load()
  break
```

### 5.8 Conflict region extraction — backend dependency

A new utility in the dialog or a new backend effect that parses a conflicted file
and extracts conflict regions:

```
git diff HEAD -- <path>              → full diff
git diff --check <path>              → conflict markers
parseConflictMarkers(filePath)       → Array<{ ours: string; theirs: string; lines: [start, end] }>
```

This is a documented dependency on a backend utility function (out of scope for
this specification task but implementable as a pure Node/Bun function using
`Bun.file()` and regex parsing of `<<<<<<<.*?=======.*?>>>>>>>`).

### 5.9 Web app / desktop

A new `packages/app/src/component/git-conflict-list.tsx` and
`packages/app/src/component/git-conflict-preview.tsx` mirror the TUI component
contract. Desktop inherits automatically.

The web app fetches conflict state via the SDK:

```ts
const conflicts = await sdk.client.vcs.conflicts({ directory: dir })
// Returns: { operation, files: [{ path, binary, conflictRegions }] }
```

This requires a new backend endpoint `GET /instance/vcs/conflicts` — documented
dependency (T-CLI-0055 shaped).

---

## 6. Removing OpenCode UX Assumptions

- The current `ConflictAction` type has `{ type: "select", path }` that is never
  consumed by any handler. This is a dead-code artifact from upstream. The
  specification makes it meaningful by routing it to the conflict preview.
- The `@opencode-ai/plugin/tui` import in `dialog.tsx` (line 2) is a data-contract
  import that re-exports from the package boundary — not user-visible branding.
- Do not remove the `@opencode-ai` package paths; they are the library names, not
  product references.
- No OpenCode-branded copy remains in any rendered text.

---

## 7. Feature Flag

Gate the redesigned conflict resolution (preview + filter + per-region resolution)
behind:

```ts
EVOLUTION_T_CLI_0228_TUI_REDESIGN_CONFLICT_RESOLUTION_UI__ENABLED = false
```

Use the existing `Flag` mechanism (`packages/core/src/flag/flag.ts`, already
imported in `app.tsx`, `ui/dialog.tsx`, `component/prompt/index.tsx`). Default
`false`; enable after staging validation.

When off, the existing `ConflictResolutionView` renders unchanged (zero regression).
When on, `ConflictResolutionViewV2` renders with the preview + filter features.

The feature flag has three levels:
1. **`false`** — original behavior (current), no changes
2. **`true`** — full redesign: preview + per-region + filter

---

## 8. Edge Cases / States

| State | Behavior |
| --- | --- |
| **No conflicts** (`empty`) | "No conflicts to resolve." — same as current |
| **Loading** (`resolving`) | Existing stale marker `⟳ scanning…` — same as current |
| **Error** (git crash) | "Resolution failed" + redacted error — same as current |
| **Empty filter match** | Shown in file list area: "No matching conflicts" |
| **Binary file focused** | Preview shows "Binary file — resolve to a side" |
| **Single conflict file** | Auto-opens the preview on mount (saves one keystroke) |
| **All resolved per-region** | Preview shows green "All regions resolved" badge |
| **Detached HEAD** | Works the same; branch is `"detached"` in git status |
| **Many conflict regions (> 50)** | Preview region list is virtual-scrolled (use `virtua` from catalog) |
| **Very deep conflict trees** | File paths truncate with `…` at the midpoint |
| **Refresh while preview open** | Preview closes; file focus preserved after refresh |
| **No git repo** | Dialog shows "Not a git repository" error state |
| **Web app** | Same component contract; no OpenTUI rendering, uses native HTML diff + buttons |

---

## 9. Validation Plan (for the implementation follow-up)

```bash
# 1. Typecheck
bun run --cwd packages/tui typecheck
bun run --cwd packages/ottili-coder typecheck

# 2. Existing tests (must pass unchanged)
bun run --cwd packages/tui test

# 3. New model tests
# test/component/conflict-resolution/model.test.ts — add tests for:
#   - filterFiles with empty/normalized query
#   - togglePreview open/close/toggle
#   - previewFocusTab cycle
#   - conflictRegionsTotal derivation
#   - regionResolutions per-file merge

# 4. New component tests
# test/component/conflict-resolution/preview.test.tsx — render tests for:
#   - Empty (no file focused)
#   - Normal conflict regions rendered
#   - Binary file placeholder
#   - All-resolved badge
#   - Per-region keybinding emits correct action
#   - Narrow vs wide layout

# 5. Filter integration test
# test/component/conflict-resolution/filter.test.tsx — render tests for:
#   - Empty query (no filter)
#   - Matching files shown
#   - No-match state
#   - Clear restores full list

# 6. Integration test (dialog + view + preview)
# test/component/conflict-resolution/integration.test.tsx — full flow:
#   - Open dialog → file list → enter → preview → resolve region → close

# 7. Lint
bun run lint

# 8. Manual verification in tmux:
#   - /resolve slash command
#   - Three width tiers (120, 80, 50)
#   - Git merge scenario with conflicting files
#   - Git rebase scenario
#   - Continue after all resolved
#   - Abort mid-resolution
#   - Filter with / key
#   - Per-region ours/theirs/union
#   - Bulk accept all remaining
```

---

## 10. Roadmap / Implementation Phases

### Phase 1 — Model and spec (current task)

- Write this specification
- Add `filterFiles`, `togglePreview`, `previewFocusTab` to model.ts
- Add `ConflictFile.filtered` support
- No production rendering changes

### Phase 2 — Per-region model + backend

- Parse conflict markers from files (`parseConflictMarkers` utility)
- Add `conflictRegions`, `additions`, `deletions`, `regionResolutions` to `ConflictFile`
- Extend `resolveFile` for per-region resolution
- Backend: `GET /instance/vcs/conflicts` endpoint or `parseConflictRegions` effect

### Phase 3 — Conflict preview component

- `ConflictPreview` component with `<diff>` rendering
- Per-region keyboard bindings
- Bulk accept (Shift+O/T/U)

### Phase 4 — Filter, refresh, web parity

- `/` filter input in file list
- `r` refresh with timer
- Web app components (`git-conflict-list.tsx`, `git-conflict-preview.tsx`)
- SDK extension (`vcs.conflicts()`)

### Phase 5 — Feature flag rollout

- Register `EVOLUTION_T_CLI_0228_TUI_REDESIGN_CONFLICT_RESOLUTION_UI__ENABLED`
- Gate Phase 3/4 behind it
- Enable for staging → validate → ship

---

## 11. Open Questions (for human review)

1. Should per-region resolution track its own `ConflictSide` per region, or should
   the file-level resolution be derived from per-region state (i.e. a file is "fully
   resolved" when all its regions are resolved)? **Recommend**: per-region is
   authoritative; file-level resolution is derived. When all regions are resolved,
   `file.resolution = "manual"` implicitly.

2. **Polling interval**: what refetch interval is acceptable for the live conflict
   refresh? Current recommendation: no auto-refresh by default; `r` key is sufficient.
   5s auto-refresh as an opt-in via `refreshInterval` prop.

3. **Conflict marker parsing**: should it be a backend effect (in `packages/ottili-coder/src`)
   or a frontend utility (in `packages/tui/src`)? The current `loadGitConflicts` is
   frontend-only (runs `git` directly). **Recommend**: keep it in the frontend
   for simplicity (parse file content with Bun APIs), but provide the extraction as
   a pure function in `model.ts` so it's testable. Move to backend if the web app
   needs it without a running CLI.

4. **Bulk actions in preview**: Shift+O/T/U for "all remaining regions." Should this
   be "all remaining" or "all regions" (including already-resolved)? **Recommend**:
   "all remaining" — re-resolving an already-resolved region is confusing. Show a
   confirmation: `Existing resolutions will not be overwritten`.

5. **File path truncation**: very long paths should truncate at the midpoint
   (`.../path/to/.../file.ts`). The `fitWidth` function exists in `git-status/model.ts`
   but is not shared. **Recommend**: extract a shared `truncatePath` utility in a
   common location `packages/tui/src/util/path.ts`.