# TUI Redesign — Git Status & Branch Bar

## Task

- **Task ID**: `96d31b2d-9fb4-4eea-8700-3a273365c05d`
- **Title**: T-CLI-0144 — TUI redesign: Git status and branch bar — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; backend aggregate is a documented dependency.

---

## 1. Goal

Define the exact interaction model for the **Git status and branch bar** in Ottili
Coder: branch, dirty state, ahead/behind, worktree, and conflict indicators. Map
current components and state, remove obsolete OpenCode UX assumptions, and design
the smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette (`packages/tui/src/theme`).
No pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Backend VCS domain (`packages/ottili-coder/src/project/vcs.ts`)

- `Vcs.Service` exposes `branch()`, `defaultBranch()`, `status()`, `diff()`,
  `diffRaw()`, `apply()`. (vcs.ts:287-295)
- `status()` returns `FileStatus[]` where each item is
  `{ file, additions, deletions, status: "added"|"deleted"|"modified" }`
  (vcs.ts:264-270, 354-378). It does **not** compute ahead/behind, conflict, or
  worktree facts.
- `branch()` reads `git branch`, `defaultBranch()` reads the repo root name
  (vcs.ts:348-353). These feed the `VcsInfo` response
  `{ branch, default_branch }` (vcs.ts:246-249).
- Live branch changes are emitted as `vcs.branch.updated` carrying only
  `{ branch }` (vcs.ts:237-244, 334). There is **no** event for dirty/ahead/behind/
  conflict changes.
- HTTP surface (`packages/ottili-coder/src/server/routes/instance/httpapi/handlers/instance.ts:40-109`):
  - `GET /instance/vcs` → `{ branch, default_branch }`
  - `GET /instance/vcs/status` → `FileStatus[]`
  - `GET /instance/vcs/diff`, `/diff/raw`, `POST /instance/vcs/apply`
  - Ahead/behind/conflict/worktree are **not** available from any endpoint.

### 2.2 TUI state (`packages/tui/src/context/sync.tsx`)

- Store field `vcs: VcsInfo | undefined` (sync.tsx:136, 165).
- Bootstrapped once from `sdk.client.vcs.get({ workspace })` (sync.tsx:538).
- Updated only by `case "vcs.branch.updated"` which sets `{ branch }`
  (sync.tsx:452-457). The TUI never calls `vcs.status()` for the status bar.
- `VcsInfo` shape consumed by the TUI (from `@opencode-ai/sdk/v2`) is
  `{ branch?, default_branch? }` only (sdk gen types.gen.ts:1400).

### 2.3 TUI rendering

- `feature-plugins/home/footer.tsx` renders the **only** VCS surface in the TUI:
  - `Directory` component appends `:branch` to the abbreviated cwd
    (footer.tsx:12-28).
  - The `View` footer shows, left-to-right: `Directory`, `Mcp`, `Setup`,
    `Account`, `Cloud`, `ThemeModeLabel`, spacer, `BrandLabel` (footer.tsx:122-149).
  - No dirty indicator, no ahead/behind, no conflict marker, no per-status counts.
- `context/directory.ts` also appends `:branch` to the window/directory title
  (directory.ts:14).
- Sidebar file tree / workspace list show branch only where relevant.

### 2.4 Web app + desktop (`packages/app`, `packages/desktop`)

Desktop is an Electron wrapper around the web app (`packages/app`), so both share
the same components.

- Sidebar workspace label: `Icon name="branch"` + branch name
  (`pages/layout/sidebar-workspace.tsx:101-122`, `sidebar-project.tsx:231,300`).
- Delete-workspace dialog computes `dirty = files.length > 0` from
  `serverSDK.client.vcs.status(...)` — a **boolean**, no counts/breakdown
  (`pages/layout.tsx:1624-1642`).
- Session review panel offers `git` / `branch` diff modes and calls
  `sdk.client.vcs.diff({ mode })`; shows uncommitted/branch changes, not a
  persistent status bar (`pages/session.tsx:79-504, 933-986`).
- No ahead/behind, conflict, or worktree indicator is surfaced anywhere in the app.

### 2.5 Branding

- `BrandLabel` renders `✻ Ottili Coder` (component/brand-label.tsx).
- `logo.ts` is Ottili block art ("OTILI").
- No user-visible "OpenCode" text remains in the TUI or app UI.
- The OpenCode legacy is in the **data contract**, not the pixels:
  `VcsInfo` schema identifier `"VcsInfo"` and the minimal `vcs.branch.updated`
  event payload `{ branch }` are both carried over from upstream and encode the
  assumption that "branch is the only live VCS fact."

---

## 3. Gaps

1. **No Git status bar exists in the TUI.** Only `directory:branch` text.
2. **No dirty breakdown.** Backend provides per-file `FileStatus[]` but the TUI
   never consumes it; the app reduces it to a boolean.
3. **No ahead/behind.** Not computed by backend at all; required for "↑a ↓b".
4. **No conflict indicator.** Merge/rebase-with-conflicts state is invisible.
5. **No worktree indicator.** Worktrees appear only as separate sidebar workspaces;
   the active root-vs-worktree relationship is not shown in the status bar.
6. **No live refresh of status.** Only branch changes stream; dirty/ahead/behind/
   conflict require polling or a new event.
7. **Minimal VCS event model** (`vcs.branch.updated` carries only `branch`)
   reflects an OpenCode UX assumption that must be widened.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A single dedicated **Git status bar** replaces the bare `directory:branch` suffix.
It is dense, left-aligned, monochrome-neutral except for status accents, and
truncated gracefully. Proposed full-density layout (≥100 cols):

```text
~/repo:main ↑2 ↓1  +3 ~5 -1 ?2  ⚠merge
```

Order and meaning:

| Segment | Source | When shown | Accent (Ottili palette) |
| --- | --- | --- | --- |
| `~/repo` | directory (abbreviated) | always | `textMuted` |
| `:main` | branch | git repo | `text` |
| `↑2 ↓1` | ahead/behind vs upstream | `ahead+behind > 0` | `info` / `warning` |
| `+3 ~5 -1` | added/modified/deleted counts | any > 0 | `success` / `warning` / `error` |
| `?2` | untracked count | > 0 | `textMuted` |
| `⚠merge` | merge/rebase with conflicts | `conflict` | `error` |
| `⌥wt` | worktree (non-root) | `is_worktree` | `textMuted` |

A dirty indicator is shown whenever `added+modified+deleted+untracked > 0`. When
clean and in sync, only `~/repo:branch` renders — never show a green "clean" badge
(Claude Code density: no noise when nothing to report).

### 4.2 Interaction

- The bar is **non-interactive by default** (matches Claude Code status line).
- `g` (or the existing `/status` slash command, `ottiliCoder.status`,
  app.tsx:820-822) opens `GitStatusDialog`: full breakdown + actions
  (view diff, commit, push, pull, stash, resolve conflicts). Reuses existing
  dialog primitives (`component/dialog-status.tsx`, `component/dialog-workspace-file-changes.tsx`).
- Conflict state (`⚠merge`) makes `g` jump directly to the conflict resolver.
- Keyboard accelerators inside `GitStatusDialog`: `d` diff, `c` commit, `p` push,
  `P` pull, `s` stash — gated by the feature flag (§7).

### 4.3 Terminal-width behavior

| Width | Rendered |
| --- | --- |
| ≥ 100 | full density (branch ↑a ↓b +counts ?untracked ⚠merge ⌥wt) |
| 60–99 | compact: `branch ↑a ↓b ✎N` where `N = total dirty` |
| < 60 | minimal: `branch` + a single dirty dot `•` (or `!` if conflict) |
| < 40 | `branch` only |

Truncation is right-to-left: drop `⌥wt`, then `?untracked`, then `⚠merge`, then
counts, preserving branch + ahead/behind last. Layout uses OpenTUI flex with
`flexShrink={0}` on the status cluster and a `flexGrow` spacer before `BrandLabel`.

### 4.4 Accessibility

- Each status segment is a `<text>` with an explicit `aria-label`-style spoken
  form via Solid `title`/`role` where supported by OpenTUI; e.g.
  `aria-label="2 commits ahead, 1 behind"`.
- Color is never the only signal: counts and glyphs (`↑ ↓ + ~ - ? ⚠ ⌥`) carry
  meaning without color.
- `g` is documented in the command palette and which-key overlay
  (`feature-plugins/system/which-key.tsx`).

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 State additions (TUI)

In `packages/tui/src/context/sync.tsx` store, add a status summary beside `vcs`:

```ts
vcs: VcsInfo | undefined
vcsStatus: VcsStatusSummary | undefined   // NEW
```

New type (TUI-local view; mirrors SDK `VcsStatusSummary`):

```ts
export type VcsStatusSummary = {
  branch: string | undefined
  default_branch: string | undefined
  added: number
  modified: number
  deleted: number
  untracked: number
  ahead: number
  behind: number
  upstream: string | undefined
  conflict: boolean
  merge: boolean
  rebase: boolean
  is_worktree: boolean
  worktree_root: string | undefined
}
```

Bootstrap (sync.tsx ~538): after `vcs.get`, also call
`sdk.client.vcs.summary({ workspace })` and `setStore("vcsStatus", x.data)`.

Events:
- Extend `vcs.branch.updated` to optionally carry the summary, OR add a new
  `vcs.status.updated` event emitted by the backend watcher when HEAD/index/
  worktree/refs change. TUI handler refreshes `vcsStatus` via `sdk.client.vcs.summary`.
- Polling fallback: when file-watch events are throttled (common in some
  terminals/SSH), the TUI refreshes `vcsStatus` on focus/workspace switch and on a
  low-frequency interval (e.g. 15s), gated by the feature flag.

### 5.2 Components

Keep it small and reusable. Two new units, both optional behind the flag:

1. **`useVcsStatus()` hook** (`packages/tui/src/context/vcs-status.ts` or extend
   `sync.tsx`): memoized selector returning `VcsStatusSummary | undefined` and
   derived helpers (`isDirty`, `totalDirty`, `hasConflict`).
2. **`<GitStatus api={TuiPluginApi} />`** component
   (`packages/tui/src/feature-plugins/home/git-status.tsx`): pure presentation of
   the summary per §4.1/§4.3. Registered into the existing `home_footer` slot
   (`api.slots.register({ slots: { home_footer() { return <View/> } } })`),
   placed **before** the `Directory`/`Mcp` cluster or replacing the `:branch`
   suffix inside `Directory`.

Reuse, do not duplicate:
- `dialog-status.tsx` / `dialog-workspace-file-changes.tsx` for the full dialog.
- `BrandLabel`, `ThemeModeLabel` for adjacent footer atoms.
- `useTheme()` palette tokens — no new colors.

### 5.3 Web app / desktop

The same `VcsStatusSummary` is fetched by `packages/app` (already has
`vcsCache`, `serverSDK.client.vcs.status`). Extend `sidebar-workspace.tsx` and
`sidebar-project.tsx` to show the bar in the workspace header, reusing the same
component contract. Desktop inherits automatically.

### 5.4 Backend dependency (documented, not implemented here)

`packages/ottili-coder/src/project/vcs.ts` needs a `summary()` effect that
computes ahead/behind (via `git rev-list --left-right` / `@{upstream}`),
conflict/merge/rebase state (`.git/MERGE_HEAD`, `.git/rebase-merge`,
`.git/rebase-apply`, `git diff --name-only --diff-filter=U`), untracked count,
and worktree root. Expose `GET /instance/vcs/summary` and regenerate the SDK
(`./packages/sdk/js/script/build.ts`). This is the T-CLI-0055-shaped dependency
and is intentionally out of scope for this specification task.

---

## 6. Removing OpenCode UX Assumptions

- Treat branch as **one of several** live VCS facts, not the only streamed one.
- Stop assuming `VcsInfo { branch, default_branch }` is the complete status
  contract; `VcsStatusSummary` becomes canonical. Keep `VcsInfo` wire-compatible
  for the sidebar's `branch !== default_branch` check (session.tsx:454-458) but do
  not extend its meaning.
- Do not introduce any OpenCode-branded copy; branding is already Ottili.
- Source of color remains the Ottili theme palette; Claude Code is a layout
  reference only.

---

## 7. Feature Flag

Gate the new bar + dialog + polling behind:

```ts
EVOLUTION_T_CLI_0144_TUI_REDESIGN_GIT_STATUS_AND_BRANCH_B_ENABLED = false
```

Use the existing `Flag` mechanism (`@opencode-ai/core/flag/flag`, already imported
in `app.tsx`, `ui/dialog.tsx`, `component/prompt/index.tsx`). Default `false`;
enable after staging validation. When off, behavior is identical to today
(`directory:branch` only).

---

## 8. Edge Cases / States

- **Not a git repo** (`project.vcs !== "git"`): `vcsStatus` stays `undefined`; bar
  renders `directory` only (current behavior). No crash.
- **Detached HEAD / no upstream**: `ahead/behind` hidden; branch still shown.
- **Loading** (before first `summary` resolves): render `directory:branch` only;
  never show a spinner in the footer.
- **Error** fetching summary: keep last-known summary; do not blank the bar.
- **Empty repo / clean tree**: show `directory:branch` only (no "clean" badge).
- **Very long branch names**: truncate branch with ellipsis before width-based
  segment drop.
- **Concurrent workspace switches**: `vcsStatus` keyed by current workspace; reset
  to `undefined` on switch to avoid stale cross-workspace data.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a render test for `<GitStatus>` covering
  full / compact / minimal widths and clean / dirty / conflict states)
- `bun run --cwd packages/ottili-coder typecheck` (backend summary effect)
- `./packages/sdk/js/script/build.ts` then `git diff --check`
- `bun run lint`
- Manual: `tmux` TUI smoke for the three widths; desktop web app sidebar bar.

---

## 10. Open Questions (for human review)

1. Should ahead/behind count against the *local* default branch or the tracked
   upstream? Recommend upstream (matches `git status -sb`).
2. Polling interval vs new `vcs.status.updated` event — implement event first,
   polling as fallback. Confirm 15s default is acceptable.
3. Glyph set: confirm `↑ ↓ + ~ - ? ⚠ ⌥` render in the target terminals (some
   terminals lack `⚠`). Fallback to ASCII `[!]` if needed.
