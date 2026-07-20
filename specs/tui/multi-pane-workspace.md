# TUI Redesign — Multi-Pane Workspace

## Task

- **Task ID**: `75b055c0-80b5-4b71-8ea0-7f88fea181e7`
- **Title**: T-CLI-0200 — TUI redesign: Multi-pane workspace — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI chat + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055 (redesign scaffolding), T-CLI-0212 (responsive layout), T-CLI-0205 (focus mode), T-CLI-0209 (compact mode)
- **Status**: Specification (design + component/state architecture). No production source changed by this task; this spec defines the multi-pane workspace interaction model, maps the current single-column layout, removes obsolete OpenCode UX assumptions, and designs the smallest reusable Ottili Coder component/state architecture for a resizable 5-pane workspace. The actual wiring is implemented in the follow-up gated by the flag in §7.

---

## 1. Goal

Define the exact interaction model for **Multi-pane workspace** in Ottili Coder's TUI: a
resizable layout of transcript, files, diff, tasks, and terminal panes that brings
multi-tool-workspace convenience to the terminal while maintaining the keyboard-driven,
high-density character of the existing TUI. Map the current components and state, remove
obsolete OpenCode UX assumptions, and design the **smallest reusable Ottili Coder
component/state architecture**.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme/assets/ottiliCoder.json`, `packages/tui/src/theme/index.ts`).
No pixel-copy of proprietary artwork or brand assets. `models.dev` is explicitly out of
scope and untouched.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Single-Column Layout (`routes/session/index.tsx`)

The current TUI session route renders a **single-column** layout with an optional sidebar:

```
┌─────────────────────────────────────────────────────┐
│  SessionHeaderStrip (hidden in focus mode / sidebar) │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ScrollBox (transcript)                             │
│  ┌───────────────────────────────────────────┐      │
│  │ UserMessage (markdown)                     │      │
│  │ AssistantMessage (streaming / markdown)    │      │
│  │   ├─ ReasoningBlock                        │      │
│  │   ├─ ToolCallCard                          │      │
│  │   ├─ CodeBlock                             │      │
│  │   └─ TextPart                              │      │
│  └───────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────┤
│  Prompt / Permission / Question composer (footer)   │
│  StatusLine (mode | model | queued | spinner)       │
└─────────────────────────────────────────────────────┘
```

Key observations:
- **No side-by-side panes**: the transcript, diff viewer, file tree, and terminal all stack vertically or replace each other.
- **Diff viewer** opens as a dialog overlay or replaces the transcript area — not a side panel.
- **File tree** is plugin-based (`feature-plugins/sidebar/files.tsx`) and rendered in a collapsible sidebar section, not a dedicated pane.
- **Terminal** is not rendered in the TUI at all — it is a split-footer component in `packages/ottili-coder/src/cli/cmd/run/` only.
- **Tasks** (to-do lists) render inline in the transcript as collapsed expandable sections.

### 2.2 Width Breakpoints

From `component/responsive-layout/model.ts`:

| Tier | Width | Sidebar | Header Density | Diff View |
|------|-------|---------|----------------|-----------|
| narrow | < 60 | hidden/overlay | condensed → minimal | unified |
| compact | 60-99 | hidden/overlay | condensed | unified |
| standard | 100-119 | docked (42px) | full | unified |
| wide | ≥ 120 | docked (42px) | full | split |

The sidebar is the **only** secondary column — 42 characters wide, no resize affordance.

### 2.3 Web/Desktop App Layout (`packages/app/src/pages/session.tsx`)

The web app already has a mature multi-pane layout:

```
┌──────────────────────────────────────────────────────────────┐
│  SessionHeader                                               │
├──────────┬────────────────────────────────┬──────────────────┤
│sidebar   │  MessageTimeline    │ Resize   │  SessionSidePanel │
│rail+panel│  ┌──────────────┐  │ handle   │  ┌──────────────┐ │
│          │  │ user messages│  │          │  │ Review tab   │ │
│          │  │ assistant msgs│ │          │  │ File tabs    │ │
│          │  └──────────────┘  │          │  │ File tree    │ │
│          │  ComposerDock      │          │  └──────────────┘ │
├──────────┴────────────────────┴──────────┴──────────────────┤
│  TerminalPanel (collapsible, resizable, multi-tab)          │
└─────────────────────────────────────────────────────────────┘
```

The web app has three resize handles:
1. **Sidebar width** — min 244px, max 30vw + 64px
2. **Session width** (between message timeline and side panel) — min 450px, max 45vw
3. **File tree width** (inside side panel) — min 200px, max 480px
4. **Terminal height** — min 100px, max 60% viewport

Session tabs track open files per session (persisted as `sessionTabs` in layout store).

### 2.4 Gaps

| Gap | Impact | Current Workaround |
|-----|--------|-------------------|
| No side-by-side transcript + diff | User must toggle between views | Dialog overlay |
| No persistent terminal pane | User cannot see terminal output while coding | None (not available in TUI) |
| No resizable pane splits | Single column can't be customized | None |
| No file tree pane | Files only in Sidebar plugin or `@` autocomplete | Sidebar toggle |
| No task pane | Tasks are inline-collapsed in transcript | Scroll to find collapsed section |
| No pane focus/cycle keybindings | Keyboard only navigates transcript | Must use mouse in overlays |
| No pane state persistence | Layout resets on session change | None |
| Terminal width constrained | Diff+terminal compete horizontally | Not applicable (no terminal pane) |

---

## 3. Multi-Pane Workspace Design

### 3.1 Pane Slots

The multi-pane workspace defines **5 pane slots** within a grid:

```
┌───────────────────────────────────────────────────────────────┐
│  Header Strip (condensed)                                     │
├───────────────────────────────────┬───────────────────────────┤
│                                   │                           │
│  [0] TRANSCRIPT (primary)         │  [1] DIFF / REVIEW        │
│                                   │                           │
│  ┌─────────────────────────────┐  │  ┌─────────────────────┐  │
│  │ user/assistant messages      │  │  │ file diffs (split)  │  │
│  │ streaming content            │  │  │ hunk navigation    │  │
│  │ reasoning blocks             │  │  │ accept/reject      │  │
│  │ tool call cards              │  │  └─────────────────────┘  │
│  └─────────────────────────────┘  │                           │
│                                   ├───────────────────────────┤
│  [2] FILES / FILE TREE            │  [3] TASKS / TODOS        │
│                                   │                           │
│  ┌─────────────────────────────┐  │  ┌─────────────────────┐  │
│  │ file tree (changes / all)   │  │  │ task list w/ status │  │
│  │ file content preview        │  │  │ completion toggles  │  │
│  │ open file tabs              │  │  └─────────────────────┘  │
│  └─────────────────────────────┘  │                           │
│                                   │                           │
├───────────────────────────────────┴───────────────────────────┤
│  [4] TERMINAL (collapsible, resizable)                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ multi-tab terminal output                                │ │
│  │ command history                                          │ │
│  └─────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────┤
│  StatusLine (mode | model | spinner | queued | queued tasks) │
│  Prompt composer                                              │
└───────────────────────────────────────────────────────────────┘
```

Pane slots and their visibility by width tier:

| Slot | Name | narrow (<60) | compact (60-99) | standard (100-119) | wide (≥120) |
|------|------|-------------|-----------------|--------------------|-------------|
| 0 | Transcript | always | always | always | always |
| 1 | Diff/Review | overlay | overlay | docked | docked |
| 2 | Files | — | overlay | overlay | docked |
| 3 | Tasks | — | — | overlay | docked |
| 4 | Terminal | — | overlay | docked | docked |

**Overlay panes** float atop the transcript (like the current sidebar on narrow tiers)
and collapse when focus leaves them. **Docked panes** sit in their grid slot and show
persistently until toggled closed.

### 3.2 Responsive Degradation

The layout degrades gracefully as terminal width shrinks:

**Wide (≥120 cols)** — All 5 panes visible:
```
[T transcript | diff   ][D]
[          | files  ][F]
[          | tasks  ][T]
[━━━━━━━━━━━━━━━━━━━━━━]
[     terminal          ]
[     prompt composer   ]
```

**Standard (100-119 cols)** — 4 panes, diff+docked terminal:
```
[T transcript | diff    ]
[             │         ]
[━━━━━━━━━━━━━━━━━━━━━━━]
[     terminal          ]
```

**Compact (60-99 cols)** — 3 panes, secondary panes overlay:
```
[T transcript          ]
[                      ]
[  ── overlay ──       ]
[  diff or files       ]
[  ──────────────       ]
[━━━━━━━━━━━━━━━━━━━━━━]
[  terminal (overlay)  ]
```

**Narrow (<60 cols)** — Single pane only (transcript):
```
[T transcript          ]
[                      ]
[  All secondary panes ]
[  accessible via      ]
[  `<leader>` toggle   ]
```

### 3.3 Pane toggles and cycling

Each pane is toggled individually. Active pane states persist across sessions via KV:

| Keybinding | Command | Effect |
|-----------|---------|--------|
| `<leader>d` | `pane.diff.toggle` | Toggle diff/review pane |
| `<leader>f` | `pane.files.toggle` | Toggle file tree pane |
| `<leader>k` | `pane.tasks.toggle` | Toggle tasks pane |
| `<leader>t` | `pane.terminal.toggle` | Toggle terminal pane |
| `<leader>` + `[` / `]` | `pane.focus.prev` / `pane.focus.next` | Cycle focus between visible panes |
| `ctrl+w h/j/k/l` | `pane.focus.left/down/up/right` | Vim-style directional focus |
| `ctrl+w =` | `pane.resize.equalize` | Equalize all visible pane sizes |
| `ctrl+w [_ / \|]` | `pane.resize.maximize` | Maximize current pane (minimize others) |

### 3.4 Resize Behavior

Pane resize follows the terminal idiom — keyboard-driven, incremental:

| Input | Effect |
|-------|--------|
| `<leader>r h` / `<leader>r ←` | Resize pane boundary left by 1 column |
| `<leader>r l` / `<leader>r →` | Resize pane boundary right by 1 column |
| `<leader>r j` / `<leader>r ↓` | Resize pane boundary down by 1 row |
| `<leader>r k` / `<leader>r ↑` | Resize pane boundary up by 1 row |
| `<leader>r H` / `<leader>r shift+←` | Resize by 10 columns |
| `<leader>r L` / `<leader>r shift+→` | Resize by 10 columns |

**Constraints** (matching web/app minima):
- Transcript pane: min 40 cols
- Diff/review pane: min 30 cols (or unified-only below 40)
- Files pane: min 20 cols
- Tasks pane: min 20 cols
- Terminal pane: min 5 rows, max 60% of terminal height

### 3.5 Focus and Keyboard Navigation

Each pane has a **focus ring**. When a pane is focused:
- Its border is highlighted with `borderActive` color
- Keyboard input routes to that pane's handler
- Unfocused panes dim slightly (`borderSubtle`)

**Focus transitions**:
- Opening a pane auto-focuses it
- `Esc` returns focus to the transcript pane
- `Tab`/`Shift+Tab` cycles through visible panes (in addition to vim-style)
- Typing any printable character when no pane is focused focuses the prompt composer

### 3.6 Terminal Pane

The terminal pane (slot 4) is a **read-only terminal output viewer**, distinct from the
interactive `RunFooter` shell mode. It displays:
- Command output from tool calls (stdout/stderr)
- Background job logs
- Build/test output

It is **not** an interactive PTY (the interactive shell lives in the prompt composer's
`!` mode). This matches how Claude Code displays terminal output — as scrolled output
with follow-along.

### 3.7 Task Pane

The task pane (slot 3) surfaces the session's **to-do list** (`packages/core/src/todo/`)
as a live-updating pane, not inline collapsed blocks. Each task shows:
- Checkbox (completed / pending / failed)
- Description
- Status badge (running / pending / done / error)
- Collapsible detail (file paths, tool calls)

Keyboard interaction:
- `j`/`k` — navigate tasks
- `space` — toggle completion (local only; server sync happens on next turn)
- `o` — expand/collapse task detail
- `enter` — scroll transcript to the tool call that produced this task

### 3.8 Diff/Review Pane

The diff pane (slot 1) mirrors the web app's `SessionReviewTab` and the existing
TUI diff dialog but renders **inline** in the side slot instead of as a modal overlay:

- File tree sidebar (changes / all tabs)
- Split or unified view (controlled by `toolDiffView` from `ResponsiveLayoutState`)
- Hunk navigation with `[` / `]`
- Accept/reject hunks (`a` / `r`)
- Apply accepted hunks (`g`)

Existing diff keybindings from `config/keybind.ts` (`diff_*` commands) are preserved.

---

## 4. Component Architecture

### 4.1 New Modules

Create `packages/tui/src/component/multi-pane/` with these files:

```
multi-pane/
  types.ts          — Pane ID, PaneState, MultiPaneLayoutState interfaces
  model.ts          — Pure layout math (computeMultiPaneLayout)
  store.tsx         — Reactive store with Solid signals for pane state
  layout.tsx        — MultiPaneLayout component (the grid container)
  pane.tsx          — PaneFrame component (border, header, focus indicator)
  transcript-pane.tsx   — Slot 0: wraps existing ScrollBox
  diff-pane.tsx         — Slot 1: wraps existing diff viewer
  files-pane.tsx        — Slot 2: wraps existing file tree component
  tasks-pane.tsx        — Slot 3: wraps existing todo list with visual wrapper
  terminal-pane.tsx     — Slot 4: read-only terminal output viewer
  commands.ts           — Keybinding registration for pane commands
```

### 4.2 Types (`types.ts`)

```typescript
export type PaneID = "transcript" | "diff" | "files" | "tasks" | "terminal"

export type PaneVisibility =
  | "hidden"      // Not rendered at all (saves CPU)
  | "overlay"     // Floating over the transcript pane
  | "docked"      // Fixed in grid slot

export interface PaneState {
  id: PaneID
  visibility: PaneVisibility
  /** Width in columns (for side panes). 0 = auto/fill. */
  width: number
  /** Height in rows (for terminal pane). 0 = auto. */
  height: number
  /** Whether this pane currently has keyboard focus. */
  focused: boolean
}

export interface MultiPaneLayoutState {
  panes: Record<PaneID, PaneState>
  /** Ordered list of focused pane IDs (focus ring). */
  focusOrder: PaneID[]
  /** Active index in focusOrder. */
  focusIndex: number
  /** Column width of the main content area after side panes. */
  contentWidth: number
  /** Row height of the terminal pane. */
  terminalHeight: number
}
```

### 4.3 Model (`model.ts`)

Pure function following the `computeResponsiveLayout` / `computeCompactChrome` pattern:

```typescript
export function computeMultiPaneLayout(input: {
  tier: LayoutTier
  width: number
  height: number
  paneToggles: Record<PaneID, boolean>
  paneWidths: Record<PaneID, number>
  terminalHeight: number
  focused: boolean
}): {
  visibility: Record<PaneID, PaneVisibility>
  contentWidth: number
  terminalHeight: number
  hasOverlays: boolean
}
```

Key rules:
- If `focused` (focus mode active), all secondary panes become `"hidden"` regardless
- Terminal pane collapses to "hidden" if toggled off or if height < narrow threshold
- Overlays take precedence over docked when width insufficient
- `contentWidth = width - sum(docked side pane widths)`

### 4.4 Store (`store.tsx`)

Solid signals wrapping the memoized `computeMultiPaneLayout`:

```typescript
export function useMultiPaneLayout(params: {
  tier: () => LayoutTier
  width: () => number
  height: () => number
  focused: () => boolean
  compactMode: () => boolean
}) {
  // Persistent KV-backed state
  const paneToggles = {
    diff: useKV("pane_diff_visible", false),
    files: useKV("pane_files_visible", false),
    tasks: useKV("pane_tasks_visible", false),
    terminal: useKV("pane_terminal_visible", false),
  }
  const paneWidths = {
    diff: useKV("pane_diff_width", 48),
    files: useKV("pane_files_width", 30),
    tasks: useKV("pane_tasks_width", 30),
  }
  const terminalHeight = useKV("pane_terminal_height", 10)

  const layout = createMemo(() =>
    computeMultiPaneLayout({
      tier: params.tier(),
      width: params.width(),
      height: params.height(),
      paneToggles: { ... },
      paneWidths: { ... },
      terminalHeight: terminalHeight(),
      focused: params.focused(),
    })
  )

  // Focus ring state
  const [focusIndex, setFocusIndex] = createSignal(0)
  const focusOrder = createMemo(() =>
    computePaneFocusOrder(layout().visibility)
  )

  return {
    layout,
    paneToggles,
    paneWidths,
    terminalHeight,
    focusIndex,
    focusOrder,
    focusNext, focusPrev, focusDirection, ...
  }
}
```

### 4.5 Layout Component (`layout.tsx`)

The `MultiPaneLayout` component is a flexbox grid that slots into the session route:

```tsx
/** @jsxImportSource @opentui/solid */
export function MultiPaneLayout(props: {
  children: {
    transcript: JSX.Element
    diff: JSX.Element
    files: JSX.Element
    tasks: JSX.Element
    terminal: JSX.Element
  }
}) {
  const mp = useMultiPaneLayout()

  return (
    <box flexDirection="row" width="100%" height="100%">
      {/* Main column: transcript (+ overlay panes) */}
      <box flexDirection="column" flexGrow={1}>
        <box flexGrow={1} position="relative">
          <PaneFrame id="transcript" focused={isFocused("transcript")}>
            {props.children.transcript}
          </PaneFrame>

          {/* Overlay panes render on top when active */}
          <Show when={mp.layout().visibility.diff === "overlay"}>
            <box position="absolute" right={0} width={mp.layout().diffWidth}>
              <PaneFrame id="diff">...</PaneFrame>
            </box>
          </Show>
          ...
        </box>

        {/* Terminal pane at the bottom */}
        <Show when={mp.layout().visibility.terminal === "docked"}>
          <PaneFrame id="terminal" height={mp.terminalHeight()}>
            {props.children.terminal}
          </PaneFrame>
        </Show>
      </box>

      {/* Docked side panes */}
      <Show when={mp.layout().visibility.diff === "docked"}>
        <PaneFrame id="diff" width={mp.paneWidths.diff()}>...</PaneFrame>
      </Show>
      <Show when={mp.layout().visibility.files === "docked"}>
        <PaneFrame id="files" width={mp.paneWidths.files()}>...</PaneFrame>
      </Show>
      <Show when={mp.layout().visibility.tasks === "docked"}>
        <PaneFrame id="tasks" width={mp.paneWidths.tasks()}>...</PaneFrame>
      </Show>
    </box>
  )
}
```

### 4.6 PaneFrame Component (`pane.tsx`)

A reusable wrapper for any pane:

```typescript
export interface PaneFrameProps {
  id: PaneID
  focused?: boolean
  width?: number       // in columns (0 = auto/flex)
  height?: number     // in rows (0 = auto)
  title?: string
  children: JSX.Element
  onClose?: () => void
}
```

Renders:
- A header line with pane title + close indicator when focused
- Border: `borderActive` color when focused, `borderSubtle` when unfocused
- Optional resize handle in the border (corner or edge)
- The child content fills the remaining space

### 4.7 State Integration

The session route in `index.tsx` adopts the multi-pane layout by:

1. Calling `useMultiPaneLayout()` alongside `useResponsiveLayout()`
2. Wrapping the existing ScrollBox in `<PaneFrame id="transcript">`
3. Wrapping the existing diff dialog content in `<PaneFrame id="diff">`
4. Creating thin wrappers for files/tasks/terminal pane content
5. Replacing the raw `<box>` layout with `<MultiPaneLayout>`

When the feature flag is off, the session renders exactly as today (zero regression).

---

## 5. Keyboard and Terminal-Width Behavior

### 5.1 Keyboard Behavior Specification

| Scenario | Behavior |
|----------|----------|
| All panes hidden (no toggle set) | Single-column fallback renders identically to today |
| Only transcript visible | Same as today; no layout changes |
| Side pane toggled on at narrow width | Overlay appears, 38-42 cols wide, auto-focuses |
| Side pane toggled on at wide width | Docked slot opens, auto-focuses, content shrinks |
| Focus in side pane, press Esc | Focus returns to transcript, side pane stays visible |
| Terminal toggled on | Appears at bottom in docked mode, overlay in compact/narrow |
| Leader+r pressed | Enters resize mode: arrow keys resize, Esc exits resize mode |
| All panes visible on wide terminal | 3-column grid: transcript | diff | files/tasks, terminal bottom |
| Focus mode activated | All secondary panes hidden, transcript fills terminal |
| Terminal width changes during session | Layout recomputes via `computeMultiPaneLayout` (reactive) |
| Session switches (child/parent) | Pane toggles persist, focus resets to transcript |

### 5.2 Terminal-Width Behavior Matrix

```
Width  | Transcript | Diff       | Files     | Tasks     | Terminal
< 60   | full       | overlay    | hidden    | hidden    | overlay
60-79  | full       | overlay    | overlay   | hidden    | overlay
80-99  | full       | overlay    | overlay   | overlay   | overlay
100-119| ~60%       | docked 30% | overlay   | overlay   | docked (6 rows)
120+   | ~45%       | docked 25% | docked 15%| docked 15%| docked (8 rows)
```

Percentages are approximate. Exact widths come from `paneWidths` KV store, defaulting to
column counts (not percentages) for terminal predictability.

### 5.3 Color Palette

All pane chrome (borders, headers, focus indicators) uses the existing Ottili color palette
from `packages/tui/src/theme/index.ts` and is **not** derived from Claude Code assets:

| Role | Theme Token | OttiliCoder Theme Value |
|------|-----------|----------------------|
| Active pane border | `borderActive` | `step10` (#fb923c) |
| Inactive pane border | `borderSubtle` | `step6` (#3c3531) |
| Pane header text | `textMuted` | `step11` (#7d7670) |
| Pane header bg | `backgroundPanel` | `step2` (#161311) |
| Pane content bg | `background` | `step1` (#0d0a08) |
| Resize handle | `border` | `step9` (#f97316) |
| Focus glow (if used) | `primary` | `step9` (#f97316) |

No new color tokens are introduced. All pane chrome uses existing theme properties.

---

## 6. State Management

### 6.1 Persistent State (KV store, survives session changes)

| KV Key | Type | Default | Description |
|--------|------|---------|-------------|
| `pane_diff_visible` | boolean | false | Diff pane visibility |
| `pane_files_visible` | boolean | false | Files pane visibility |
| `pane_tasks_visible` | boolean | false | Tasks pane visibility |
| `pane_terminal_visible` | boolean | false | Terminal pane visibility |
| `pane_diff_width` | number | 48 | Diff pane width in cols |
| `pane_files_width` | number | 30 | Files pane width in cols |
| `pane_tasks_width` | number | 30 | Tasks pane width in cols |
| `pane_terminal_height` | number | 10 | Terminal pane height in rows |

### 6.2 Session State (in-memory, resets on session switch)

| Variable | Type | Description |
|----------|------|-------------|
| `focusIndex` | `number` | Current position in focus ring |
| `focusOrder` | `PaneID[]` | Ordered, visible-only focus ring |
| `resizeMode` | `boolean` | Whether the user is in resize mode |
| `resizeTarget` | `PaneID \| "edge"` | Which pane/edge is being resized |

### 6.3 Reactivity

All pane layout state flows through Solid `createMemo` from the same `useTerminalDimensions()`
that drives `useResponsiveLayout`. Resize is immediate (no debounce) during active dragging
and debounced at 150ms after release for persistence.

---

## 7. Feature Flag

Gate behind `EVOLUTION_T_CLI_0200_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED` environment
variable, matching the MEE flag pattern in `packages/core/src/flag/flag.ts`:

```typescript
// Multi-pane workspace (T-CLI-0200): resizable transcript, files, diff, tasks and
// terminal panes. When enabled the session route renders panes according to
// computeMultiPaneLayout; when off the single-column fallback renders exactly as
// today (zero regression).
get EVOLUTION_T_CLI_0200_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED() {
  return truthy("EVOLUTION_T_CLI_0200_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED")
},
```

Default: `false`. Enable via `EVOLUTION_T_CLI_0200_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED=true`.

---

## 8. Non-Goals (explicitly out of scope)

- No interactive PTY terminal pane (terminal pane is read-only output display; interactive shell remains in `!` prompt mode)
- No pane drag-and-drop reordering (focus-based navigation is sufficient for terminal UX)
- No windowing/pane stacking (all panes are visible or toggled independently)
- No mouse-driven resize (keyboard resize only; the terminal has no pointer)
- No macOS/Linux/Win32 differences in layout (same pane logic across all platforms)
- No changes to `packages/app` or `packages/desktop` (they already have multi-pane; this spec is TUI-only)

---

## 9. Implementation Plan (follow-up task)

1. Add feature flag to `packages/core/src/flag/flag.ts`
2. Create `packages/tui/src/component/multi-pane/` with `types.ts`, `model.ts`, `store.tsx`
3. Create `pane.tsx` (PaneFrame wrapper component)
4. Create pane slot components (`transcript-pane.tsx`, `diff-pane.tsx`, etc.)
5. Create `layout.tsx` (MultiPaneLayout grid container)
6. Create `commands.ts` (keybinding registration for pane commands)
7. Add keybinding definitions in `packages/tui/src/config/keybind.ts`
8. Integrate into `routes/session/index.tsx` behind the feature flag
9. Write tests (`test/multi-pane-model.test.ts` following the `computeResponsiveLayout` pattern)
10. Add `useKV` pane state migration in `context/kv.tsx`

---

## 10. Rollback

Revert: set `EVOLUTION_T_CLI_0200_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED=false`
(default). The feature flag ensures zero regression when off. If follow-up implementation
changes session route internals, the `computeMultiPaneLayout` result is merged into
the existing layout path at the flag gate and does not modify legacy code paths.