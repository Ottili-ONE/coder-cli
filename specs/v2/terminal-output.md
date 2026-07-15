# V2 Terminal Output — Interaction Specification & Component Architecture

**Task:** T-CLI-0120 — TUI redesign: Terminal output
**Layer:** coder-cli (`packages/tui`)
**Reference:** 40% Claude Code-inspired Ottili Coder frontend redesign
**Depends on:** T-CLI-0055 (tool-card model + store scaffold)
**Status:** Specification (implementation-ready)

---

## 1. Goal

Define the exact interaction model for **Terminal output** in the Ottili Coder TUI:
streaming ANSI-safe logs, folding, in-output search, copy, and failure emphasis.

This spec is intentionally scoped to the multi-line text viewer that renders command
output, tool logs, and streamed agent text. It reuses the work from T-CLI-0055
(`ToolCallCard` model + `tool-call-store`) and adds the smallest reusable
Ottili Coder component/state architecture needed to implement the experience
immediately. Claude Code is a layout/clarity reference only; the palette, icons,
and identifiers stay Ottili.

---

## 2. Current Behavior (documented from source)

All findings below are taken from the working tree (`dev`), not guessed.

### 2.1 Where output is rendered today

- **`Shell`** — `packages/tui/src/routes/session/index.tsx:2303`
  - Renders `metadata.output` for the `bash` tool.
  - `const output = stripAnsi(stringValue(props.metadata.output)?.trim() ?? "")` (`index.tsx:2308`).
    **All ANSI is stripped** — output is monochrome `theme.text`.
  - `maxLines = 10`; `maxChars = maxLines * Math.max(20, ctx.width - 6)` (`index.tsx:2310-2311`).
  - Folding via `collapseToolOutput(output, maxLines, maxChars)` (`index.tsx:2312`).
  - **Expand/collapse is mouse-only** (`onClick` on `BlockTool`, `index.tsx:2339`).
  - Title built from `description` + `workdir` (`index.tsx:2324`).
  - Error shown as plain `theme.error` text appended at bottom of the block
    (`BlockTool`, `index.tsx:2296-2298`).
  - Running state shows a `Spinner` (`index.tsx:2338`); `isRunning` memo at `index.tsx:2307`.
  - **Streaming gap:** `limited()` returns the collapsed preview whenever
    `collapsed().overflow` is true — so a long command that is still streaming
    collapses mid-run instead of following the tail (`index.tsx:2313-2316`).

- **`GenericTool`** — `packages/tui/src/routes/session/index.tsx:2054`
  - `maxLines = 3`; gated by `ctx.showGenericToolOutput()`.
  - `showGenericToolOutput` reads `kv.signal("generic_tool_output_visibility", false)`
    (`index.tsx:264`) — **generic tool output is hidden by default**.

- **`collapseToolOutput`** — `packages/tui/src/util/collapse-tool-output.ts:1`
  - Naive: keeps the first `maxLines` lines; if the char budget overflows, truncates
    the preview with `…`. No middle-fold, no "keep last lines", no error-biased fold.

- **`InlineTool` / `InlineToolRow`** — `packages/tui/src/routes/session/index.tsx:2092`
  - Inline one-line tool row; error details expand on mouse click
    (`index.tsx:2156-2163`, `errorExpanded` signal).
  - Denied permissions rendered with `STRIKETHROUGH` (`index.tsx:2220`).

### 2.2 Redesign scaffolding already present (from T-CLI-0055)

- **`packages/tui/src/component/tool-card/model.ts`** (untracked, NEW)
  - `ToolCallCard`, `categorizeTool`, `projectToolCall`, `formatDuration`.
  - For `bash` it produces `evidence.kind === "command"` carrying
    `{ command, output, workdir?, description }` and `expandable`/`defaultExpanded`.
  - **No `index.tsx` renderer exists yet** — the model is built but unwired.
  - `evidence.command` does **not** yet carry an `exitCode` or `stderr` split.

- **`packages/tui/src/component/tool-call-store.ts`** (untracked, NEW)
  - Global reactive state keyed by tool part id: `expanded`, `errorExpanded`,
    `activeCard`, an insertion-ordered `registry`, and helpers
    (`toggleExpanded`, `toggleErrorExpanded`, `toggleActiveOrLastToolCard`, …).
  - `toggleActiveOrLastToolCard` exists but **no keybind is wired to it**.

### 2.3 Palette (the only color source)

`packages/tui/src/theme/index.ts` — `primary`/`accent` = cyan, `secondary` = magenta,
`error` = red, `warning` = yellow, `success` = green, `info` = cyan;
`textMuted`, `backgroundPanel = grays[2]`, `backgroundElement = grays[3]`,
`borderSubtle = grays[6]`. SGR codes (0–255) are resolved by `ansiToRgba`
(`theme/index.ts:311`). The redesign must derive all log color from these theme
roles — never hard-coded hex.

### 2.4 Copy / clipboard

- `packages/tui/src/context/clipboard.tsx` + `packages/tui/src/clipboard.ts`
  provide `useClipboard().write(text)` over OSC 52 (tmux-aware).
- Existing copy entry points: `session_copy` (`keybind.ts:84`, default `none`),
  `messages_copy` (`keybind.ts:142`, `<leader>y`), arbitrary-selection copy in
  `app.tsx:202`/`Selection.handleSelectionKey`. There is **no "copy this output
  block"** action.

### 2.5 Keyboard surface

`packages/tui/src/config/keybind.ts` defines the `Definitions` map. Relevant today:
`session_copy`, `messages_copy`, `session_toggle_generic_tool_output`,
`tool_details` (all default `none` or unset). **No per-output expand, search,
fold-all, or follow-tail bindings exist.**

---

## 3. Gaps (what this spec fixes)

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | No ANSI color in logs — everything stripped | `stripAnsi` at `index.tsx:2308` |
| G2 | No in-output search/find | no search binding in `keybind.ts` |
| G3 | No "copy this output" action | only session/message copy exists |
| G4 | Expand/collapse is mouse-only | `onClick` only at `index.tsx:2339` |
| G5 | Folding is naive (head-only, char-budget ellipsis) | `collapse-tool-output.ts:1` |
| G6 | Failure emphasis is a plain error line; no exit code, no stderr split, no banner | `BlockTool` `index.tsx:2296` |
| G7 | Streaming collapses mid-run instead of following tail | `limited()` at `index.tsx:2313` |
| G8 | Width handling wraps silently; no wrap↔truncate toggle, no long-line indicator | `maxChars` at `index.tsx:2311` |
| G9 | Generic tool output hidden by default (low observability) | `kv.signal(..., false)` at `index.tsx:264` |
| G10 | `ToolCallCard` model built but no renderer wired | missing `tool-card/index.tsx` |
| G11 | Obsolete OpenCode UX assumptions: hidden-by-default noise, mouse-only, OpenCode-style pending copy | `index.tsx:264`, `index.tsx:2156`, `InlineTool` pending strings |

---

## 4. Information Hierarchy (Claude Code-like, visibly Ottili)

Each terminal-output block is a single, scannable card with three zones:

```
┌─ command ────────────────────────────────────── exit 1 ─┐   ← header zone
│ $ npm run build                                        │
├────────────────────────────────────────────────────────┤
│ <streamed, ANSI-mapped, wrapped log lines>             │   ← body zone
│   ... folded middle (12 lines hidden) ...              │
├────────────────────────────────────────────────────────┤
│ ⠿ 12 lines hidden · / search · y copy · z fold all     │   ← affordance zone
└────────────────────────────────────────────────────────┘
```

- **Header zone** (one line): `$ <command>` in `theme.text`; trailing right-aligned
  status token in `theme.success` (exit 0 / done) or `theme.error` (exit ≠ 0),
  using `formatDuration` for completed runs (`tool-card/model.ts`).
- **Body zone**: streamed lines, ANSI remapped to Ottili roles, wrapped at
  `ctx.width - chrome`. Errors/warnings keep their color; muted metadata (timing,
  spinner) uses `theme.textMuted`.
- **Affordance zone** (footer, only when overflow or active): fold state, search
  hint, copy hint, fold-all hint — all dim (`theme.textMuted`), revealed by focus.

Density follows Claude Code (compact one-block, color-coded, zero chrome until
interaction) while the `$` prompt glyph, cyan accent, and Ottili palette keep it
visibly Ottili (no Claude Code artwork/branding).

---

## 5. Interaction Model

### 5.1 Streaming ANSI-safe logs

- **Do not `stripAnsi`.** Replace with a sanitizer that:
  1. Drops unsafe sequences (cursor moves, altscreen, bracketed paste, bell,
     OSC except OSC 8 hyperlinks we choose to honor).
  2. Parses SGR (`\x1b[…m`) and maps the 16-base + bright palette and common
     256/truecolor codes to Ottili theme roles:
     red→`error`, yellow→`warning`, green→`success`, cyan/blue→`info`,
     plus `text`/`textMuted` by intensity. Truecolor is quantized to the nearest
     Ottili role to preserve brand consistency.
- Output is **append-only and live**: the body re-renders from the reactive
  `ToolCallCard.evidence.command.output` memo. While running, the view **follows
  the tail** (autoscroll) instead of collapsing (fixes G7).
- Long lines wrap by default; a `…` + column indicator marks truncated width.

### 5.2 Folding (fixes G5, G9)

`collapseOutput(segments, opts)` returns `{ head, folded, tail, hidden, overflow }`
with smarter rules:
- Keep the **first** `maxHead` lines and the **last** `maxTail` lines.
- Always keep lines flagged `error`/`warning` even inside the folded middle.
- Fold the middle with a single `… N lines hidden` row.
- `maxHead`/`maxTail` derive from `ctx.width` (e.g. `maxHead = 12`,
  `maxTail = 6`), not a fixed char budget.
- Two explicit states per card: `collapsed` (default for very long output) and
  `expanded` (all lines, scrollable). `defaultExpanded` already exists on
  `ToolCallCard` (`tool-card/model.ts`) — honor it.
- **Generic tool output defaults visible** (fixes G9): compact one-line summary
  when collapsed, full text on expand. Drop the hidden-by-default toggle in favor
  of this smart collapse.

### 5.3 Search (fixes G2)

- `tool_search` opens an in-block find bar. Query is case-insensitive substring
  with optional regex (toggle `/` vs `#`).
- Matches highlighted with `theme.accent` background; `n` / `N` jump next/prev
  match and scroll it into view.
- Search state is per-card: `searchQuery`, `searchActive`, `matchIndex` in the
  store, keyed by part id.

### 5.4 Copy (fixes G3)

- `tool_copy` copies the full `$ command` + output (respecting fold state:
  collapsed copies the visible window + a note that output was truncated, expanded
  copies everything) to the clipboard via `useClipboard().write` (OSC 52).
- Confirms with a `toast` ("Copied output", `variant: "info"`) — mirror
  `dialog-provider.tsx:259`.

### 5.5 Failure emphasis (fixes G6)

- `detectFailure(output, metadata)` returns
  `{ failed, exitCode?, summary? }`:
  - Parse trailing `exit code N` / nonzero process exit; read `metadata.exitCode`
    if the tool surfaces it (add `exitCode` to `evidence.command`).
  - Detect error signatures (`Error:`, `Traceback`, `npm ERR!`, `cargo: error`,
    panic) to set `failed` even without an explicit code.
- On failure: **left border** switches to `theme.error`, header shows
  `exit N` in `theme.error`, and a one-line **failure banner** summarizes the last
  error line (dimmed context + `theme.error` headline). stderr, when available as
  a separate field, renders in its own `theme.error`-tinted region.

---

## 6. Keyboard & Terminal-Width Behavior

### 6.1 New keybindings (add to `packages/tui/src/config/keybind.ts` Definitions)

| Key | Binding | Action |
| --- | --- | --- |
| `Enter` / `Space` | `tool_toggle` | Toggle expand/collapse of the active card |
| `/` | `tool_search` | Open in-block search |
| `n` / `N` | `tool_search_next` / `tool_search_prev` | Next / previous match |
| `y` | `tool_copy` | Copy command + output |
| `z` | `tool_fold_all` | Fold/expand all cards in the session |
| `f` | `tool_follow` | Toggle tail-follow during streaming |
| `w` | `tool_wrap` (reuse `app_toggle_diffwrap` pattern) | Toggle wrap ↔ truncate |

Defaults avoid clashing with existing `session_*`/`messages_*`/`diff_*` maps
(`keybind.ts`). All new bindings default to the keys above unless a user overrides
them in `ottiliCoder.json` (same config path as `definitions` today).

### 6.2 Focus model

- `tool-call-store.activeCard` is the keyboard target. Mouse hover/focus sets it;
  `toggleActiveOrLastToolCard` becomes `tool_toggle`'s handler (fixes G4).
- Keyboard acts on `activeCard`; if none, falls back to `lastToolCard()`
  (existing registry logic in `tool-call-store.ts`).

### 6.3 Terminal-width behavior

- All line widths computed from `ctx.width` (already available via `use()`).
  Recalculate `maxHead`/`maxTail`/wrap on resize — reactive memos already do this
  for `ctx.width`.
- Minimum usable width: below ~40 cols, hide the affordance zone and render the
  header compactly (`$ cmd … exit 1`); body still wraps.
- Wrap is the default; `tool_wrap` switches to truncate-with-scroll for wide logs.
- No horizontal scrollbar in wrapped mode; when truncated, show a right-edge
  `›` marker and allow `left`/`right` to pan the active line.

---

## 7. Component / State Architecture (concrete, implementable)

Follow the existing redesign pattern: **pure `model.ts` + Solid `index.tsx`**,
exactly like `tool-card/model.ts` and `task-queue/model.ts`.

### 7.1 Files to add

```
packages/tui/src/component/terminal-output/
  model.ts          # pure functions, no Solid/reactivity
  index.tsx         # Solid component rendering a ToolCallCard command/text evidence
  index.test.ts     # unit tests for the pure model
```

### 7.2 `model.ts` (pure, testable)

```ts
import type { ToolCallCard } from "../tool-card/model"

export type LogRole = "text" | "muted" | "error" | "warning" | "success" | "info"
export type Segment = { text: string; role: LogRole }

// G1: strip unsafe sequences, map SGR → Ottili roles
export function sanitizeAnsi(input: string): string
export function parseAnsi(input: string): Segment[]

// G5: smarter fold — keep head + tail, always keep error/warning lines
export type CollapsedOutput = {
  head: Segment[]
  tail: Segment[]
  hidden: number
  overflow: boolean
}
export function collapseOutput(
  segments: Segment[],
  opts: { maxHead: number; maxTail: number; keepRoles?: LogRole[] },
): CollapsedOutput

// G6: failure detection
export type FailureInfo = { failed: boolean; exitCode?: number; summary?: string }
export function detectFailure(output: string, exitCode?: number): FailureInfo

// G2: search
export type Match = { line: number; start: number; end: number }
export function findMatches(
  segments: Segment[],
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean },
): Match[]
```

### 7.3 `index.tsx` (Solid component)

```tsx
export function TerminalOutput(props: { card: ToolCallCard }) {
  const { theme } = useTheme()
  const ctx = use()
  const clipboard = useClipboard()
  const store = useTerminalOutput(props.card.id)   // wraps tool-call-store + search state
  const segments = createMemo(() => parseAnsi(evidence.command.output))
  const failure = createMemo(() => detectFailure(evidence.command.output, evidence.command.exitCode))
  const folded = createMemo(() =>
    collapseOutput(segments(), { maxHead: 12, maxTail: 6 }),
  )
  // renders header (status token), body (segments or folded window), footer affordances,
  // search bar overlay, and wires onMouseUp/onKeyUp to store actions.
}
```

### 7.4 State — extend `tool-call-store.ts`

Add per-id search/follow state alongside the existing `expanded`/`errorExpanded`/
`activeCard` signals:

```ts
const [search, setSearch] = createSignal<Record<string, { query: string; active: boolean; match: number }>>({})
const [follow, setFollow] = createSignal<Record<string, boolean>>({})
// getSearch(id) / setSearchQuery(id, q) / toggleFollow(id) / nextMatch(id) / prevMatch(id)
```

The `Shell` and `GenericTool` renderers in `session/index.tsx` are then
replaced by `<TerminalOutput card={projectToolCall(part)} />` (consuming the
existing `ToolCallCard` model), removing the duplicate `collapseToolOutput`
calls and `stripAnsi` usage. This retires `util/collapse-tool-output.ts` in favor
of `terminal-output/model.ts`.

### 7.5 Wiring

- `keybind.ts`: add the `Definitions` entries from §6.1 and map each to an action
  in the session keymap that calls the corresponding `tool-call-store` helper on
  `activeCard()`.
- `tool-card/index.tsx` (the missing renderer from T-CLI-0055) composes
  `TerminalOutput` for `evidence.kind === "command" | "text"`.

---

## 8. Remove Obsolete OpenCode UX Assumptions

- **Hidden-by-default tool output** (`generic_tool_output_visibility=false`,
  `index.tsx:264`): replace with always-visible smart-fold (§5.2). Keep the
  `showGenericToolOutput` knob only as an "expand all generic" affordance.
- **Mouse-only interactions**: every action gains keyboard parity (§6).
- **OpenCode-style pending copy** ("Writing command…", "Preparing write…") in
  `InlineTool`/`Shell`: keep semantics, use Ottili phrasing; reserved
  `@opencode-ai/sdk/v2` `ToolPart` import stays as a compatibility boundary
  (per repo policy — do not rename upstream SDK types).
- **Strikethrough-denied** rendering is fine and Ottili-appropriate; keep it.

---

## 9. Validation Plan

1. **Pure model unit tests** (`terminal-output/index.test.ts`):
   - `parseAnsi` maps red SGR → `error`, strips cursor/altscreen.
   - `collapseOutput` keeps first/last lines and folds the middle; keeps
     error lines inside the fold.
   - `detectFailure` returns `failed` for `exit code 1` and for `Traceback`.
   - `findMatches` returns correct offsets for case-insensitive and regex queries.
2. **Typecheck:** `bun run --cwd packages/ottili-coder typecheck`
3. **Lint:** `bun run lint` (oxlint)
4. **Package tests:** `bun run --cwd packages/ottili-coder test`
5. **Repo diff hygiene:** `git diff --check`
6. **Manual:** run `bun dev`, execute a failing and a long-running shell command,
   verify color, fold, search (`/`), copy (`y`), and tail-follow (`f`).

## 10. Rollout

Wrap the new renderer behind feature flag
`EVOLUTION_T_CLI_0120_TUI_REDESIGN_TERMINAL_OUTPUT__INTER_ENABLED` (default
`false`). When off, `session/index.tsx` keeps the current `Shell`/`GenericTool`
path. When on, route `bash`/generic text evidence through `TerminalOutput`.

## 11. Acceptance Criteria Mapping

- Current behavior/gaps documented from source → §2, §3 (file:line cited).
- Claude Code-like clarity, visibly Ottili → §4, palette from §2.3.
- Ottili colors remain the palette source → §2.3, §5.1, §5.5.
- Keyboard + terminal-width specified → §6.
- Component/state boundaries concrete → §7.
