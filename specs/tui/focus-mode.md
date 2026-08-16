# TUI Redesign — Focus Mode

## Task

- **Task ID**: `92e62a3f-6cec-4984-918c-36cd993aab45`
- **Title**: T-CLI-0204 — TUI redesign: Focus mode — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI chat + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055 (redesign scaffolding)
- **Status**: Specification (design + component/state architecture). No production source changed by this task; this spec defines the minimal-transcript/composer "Focus mode" interaction model, maps the current chrome, removes obsolete OpenCode UX assumptions, and designs the smallest reusable Ottili Coder component/state architecture. The actual wiring is implemented in the follow-up gated by the flag in §7.

---

## 1. Goal

Define the exact interaction model for **Focus mode** in Ottili Coder's TUI: a minimal
transcript/composer surface that strips away all non-essential chrome (sidebar, header
meta, status bar) and returns to the full "detailed" session view with a single
keystroke. Map the current components and state, remove obsolete OpenCode UX
assumptions, and design the **smallest reusable Ottili Coder component/state
architecture**.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`, `packages/ui/src/theme/resolve.ts`,
`packages/ottili-coder/src/cli/cmd/run/theme.ts`). No pixel-copy of proprietary
artwork or brand assets. `models.dev` is explicitly out of scope and untouched.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Session view composition (`routes/session/index.tsx`)

The session route renders one horizontal `<box flexDirection="row">` (`:1462`) split
into a main column and an optional sidebar:

- **Main column** (`:1463`): padding `2` L/R, `1` bottom, `gap={1}`.
  - `SessionHeaderStrip` — shown **only when `session() && !sidebarVisible()`**
    (`:1464-1466`). When the sidebar is visible, the header is suppressed entirely.
  - `<scrollbox>` transcript (`:1468-1581`): `<For each={messages()}>` rendering
    `UserMessage` / `AssistantMessage` (`:1553-1577`), the revert banner, `Toast`
    (`:1629`).
  - **Blocking/contextual prompts** (`:1582-1597`): `PermissionPrompt` (when
    `permissions().length > 0`), `QuestionPrompt` (when questions pending),
    `SubagentFooter` (when `session().parentID`).
  - **Composer** via `pluginRuntime.Slot name="session_prompt"` → `<Prompt>`
    (`:1598-1626`). The composer's `right` slot shows the queue hint / plugin slot
    (`:1616-1622`).
- **Sidebar** (`:1631-1650`): shown when `sidebarVisible()`; wide terminals render it
  as a docked column, narrow terminals as a full-screen `overlay` with a dimmed
  backdrop (`:1636-1648`).

### 2.2 View-state plumbing already in the session route

- `const dimensions = useTerminalDimensions()` (`:260`).
- `const wide = createMemo(() => dimensions().width > 120)` (`:275`).
- `const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")`
  (`:261`) — the **canonical persisted UI-preference pattern** Focus mode mirrors.
- `const [sidebarOpen, setSidebarOpen] = createSignal(false)` (`:262`).
- `const sidebarVisible = createMemo(() => { if (sidebarOpen()) return true; if (sidebar() === "auto" && wide()) return true; return false })` (`:276-279`).
- `const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)` (`:290`) — the **width contract** Focus mode inherits for free (hiding the sidebar already widens the transcript).
- `session.sidebar.toggle` command (`:133`, `:717`), bound to `<leader>b`
  (`config/keybind.ts:86`, `sidebar_toggle`). The toggle is a command dispatched
  through the keymap, not a raw keybinding.

### 2.3 Header chrome (`routes/session/header-strip.tsx`)

`SessionHeaderStrip` (61 lines) renders, left-to-right:
- `title` (`textMuted` truncation at 48 chars, `:16-20`).
- `· agent · model` when an agent is set (`:39-48`), using `theme.primary` for the
  agent and `theme.text` for the model.
- `<CostUsageMeter sessionID>` when a model is present (`:49-51`) — the cost meter
  (note: the richer Context usage meter from T-CLI-0148 is **not yet shipped** in the
  TUI).
- `<CheckpointStatusIndicator>` gated by
  `Flag.OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE` (`:52-54`).
- Right side: `{sidebarShortcut} sidebar` hint (`:56-58`, `theme.textMuted`).

### 2.4 Status chrome (`routes/session/footer.tsx`)

`Footer` (111 lines) is the canonical bottom status bar: working directory
(`theme.textMuted`, `:55`) on the left; on the right a `Switch` showing
connect/welcome/status hints, LSP count (`theme.success`/`theme.textMuted`), MCP count
(`theme.success`/`theme.error`), pending permission count (`theme.warning`), and
`/status` `/usage` hints (`:57-107`). **Note:** `Footer` is currently **not mounted**
in the session route (no `<Footer` reference in `index.tsx`); it is the reference
implementation of bottom status chrome that Focus mode must be able to suppress.

### 2.5 Composer (`component/prompt/index.tsx`)

`Prompt` is a large, self-contained composer (1500+ lines). It owns: the textarea
(`:1396`), the agent/model/variant **meta line** (`:1469-1506`, `theme.primary` agent,
`theme.textMuted` separators, `theme.warning` variant), the placeholder, shell mode
(`!` → `store.mode = "shell"`, `:855`), queued-prompt flush (`:584-601`), history
(`:892-949`), stash (`:757-819`), paste/attachments, and the submit pipeline
(`:952-1174`). Focus mode keeps the composer **as-is**; only the surrounding frame is
removed.

### 2.6 Tool-detail and scrollbar toggles (already exist)

- `const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)`
  (`:268`) — the per-session "detailed view" of tool cards. `AssistantMessage` hides
  completed tools when `!showDetails()` (`:2036-2038`). This is the existing
  "detailed view" knob Focus mode complements.
- `session.toggle.scrollbar` (`:788`), `session.toggle.conceal`,
  `session.toggle.timestamps`, `session.toggle.thinking`,
  `session.toggle.generic_tool_output`, `session.toolcard.toggle` (`:134-141`,
  `:769-796`) — all command-dispatched, all independent of Focus mode.

### 2.7 Branding & palette

- Color source is the Ottili theme palette (`theme/index.ts`): `primary` (cyan),
  `secondary`, `accent`, `error`, `warning`, `success`, `info`, `text`, `textMuted`,
  `background`, `backgroundPanel`, `backgroundElement`, `backgroundMenu`, `border`,
  `borderSubtle`, and the `markdown*`/`syntax*` families. Claude Code is a
  layout/density reference only.
- The TUI still imports runtime from `@opencode-ai/{core,sdk,tui}` (package identity,
  not UX copy). The redesign must not (re)introduce OpenCode-branded user-facing
  strings; product family is Ottili ONE / Ottili Coder / LD3 / Ottili Cloud / Ottili
  AI.

---

## 3. Gaps

1. **No minimal/immersive surface.** The session view is always framed by sidebar +
   header + footer chrome. There is no way to drop into a pure transcript/composer
   view. Claude Code's focus mode is a first-class, toggleable minimal surface; the
   Ottili TUI has no equivalent.
2. **Chrome is identity, not optional.** `sidebarVisible()` defaults to `auto` and
   shows on every wide terminal (`:279`); the header strip renders agent·model·cost
   whenever the sidebar is hidden. The OpenCode-derived assumption is "more chrome by
   default"; there is no "less chrome on demand."
3. **No persisted focus preference.** Unlike `sidebar` (`kv.signal`, `:261`), there
   is no UI-preference signal for "minimal mode," so a user wanting a clean surface
   must re-hide chrome every session.
4. **Return-to-detail is multi-step.** Leaving the immersive surface today means
   re-opening the sidebar (`<leader>b`) and re-showing any hidden meta — never a
   single keystroke. The spec requires **rapid** return.
5. **Blocking prompts must survive minimal mode.** `PermissionPrompt` /
   `QuestionPrompt` / `SubagentFooter` are contextual and must remain visible even in
   Focus mode; current composition nests them inside the main column (`:1582-1597`),
   which is correct, but the spec must pin that contract so Focus mode never hides
   them.
6. **OpenCode UX assumption: "default maximal density."** The redesign makes a minimal
   surface a first-class, persisted, keyboard-toggleable mode — mirroring Claude
   Code's focus, not OpenCode's always-framed default.
7. **Width contract is already correct but unused for minimal mode.** `contentWidth`
   already subtracts only the sidebar (`:290`); hiding the sidebar in Focus mode
   auto-widens the transcript with zero new layout math. This is reused, not
   re-derived.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

Focus mode is a **view-state** of the existing session route, not a new route. When
engaged it removes chrome and keeps exactly two regions:

| Region | Kept in Focus mode | Color (Ottili token) |
| --- | --- | --- |
| Transcript `<scrollbox>` | **Kept** (full width) | `background` / `text` / `markdown*` |
| Composer `<Prompt>` | **Kept** (full width, incl. agent·model meta line) | `primary` agent, `textMuted` separators, `warning` variant |
| Header strip | **Removed** | — |
| Sidebar | **Removed** (forced, even on wide) | — |
| Footer / status chrome | **Removed** | — |
| Blocking prompts (permission/question/subagent) | **Kept** (must stay visible) | existing `warning`/`error` etc. |
| Focus indicator (1-line, bottom) | **Added** (text-only) | `info` |

The remaining surface is dense and quiet: just the conversation and the input. The
composer's existing agent·model meta line is **part of the minimal composer** and is
kept (it is not "frame chrome"); only the header strip above the transcript, the
sidebar, and the bottom status bar are suppressed.

### 4.2 Keyboard model

Reuse the existing command-dispatch pattern (no new global key registry):

- **`<leader>f` → `session.focus.toggle`** — the single keystroke to enter/exit Focus
  mode. Mirrors `session.sidebar.toggle` (`<leader>b`, `config/keybind.ts:86`). Add
  `focus_toggle: keybind("<leader>f", "Toggle focus mode")` to `config/keybind.ts`
  and register `session.focus.toggle` in `index.tsx` alongside `session.sidebar.toggle`
  (`:133`, `:717`).
- **Rapid return:** because the toggle is a global session command (`session.global`
  bindings, `:1393`), the same `<leader>f` exits Focus mode instantly and restores
  sidebar/header/footer per their own persisted state (`sidebar` kv signal,
  `showDetails`, etc.). No stacking, no modal to dismiss.
- **No `Esc` for exit.** `Esc` is reserved for dialogs and shell-mode exit
  (`prompt/index.tsx:868`); Focus mode uses its dedicated toggle to avoid colliding
  with those contracts.
- Documented in the command palette / which-key overlay, parallel to
  `session.bindingCommands` (`:122-151`).

### 4.3 Terminal-width behavior

Focus mode inherits the existing width contract with **no new math**:

- `contentWidth = dimensions().width - (sidebarVisible() ? 42 : 0) - 4` (`:290`).
  Because Focus mode forces `sidebarVisible()` false, the transcript automatically
  gains the 42 columns the sidebar would have consumed — at **every** width, including
  narrow terminals.
- Header hidden → no header truncation/segment logic needed.
- Narrow terminals (`< 80`, the `narrow()` gate used by `permission.tsx:466` /
  `:553`): Focus mode simply drops header/footer/sidebar; tool cards already collapse
  via existing narrow logic. No extra branch.
- The composer meta line already truncates the model label (`prompt/index.tsx`); it is
  unchanged.

| Width | Focus mode renders |
| --- | --- |
| ≥ 120 | transcript (full width) + composer + blocking prompts + 1-line `info` focus hint |
| 80–119 | same (sidebar would have shown docked; now hidden) |
| < 80 | same; tool cards collapse per existing narrow rules |

### 4.4 Accessibility

- Focus mode is **keyboard-toggleable** and the exit affordance is **text, not
  color-only**: a 1-line bottom hint `focus · <leader>f exit` in `theme.info`
  (§5.3). Color is never the only signal.
- The composer textarea remains focusable; `Prompt`'s own focus management
  (`prompt/index.tsx:656-666`) is untouched, so screen-reader/cursor behavior is
  unchanged.
- Hiding the header/footer removes **decorative** chrome only; all **actionable**
  state (permission requests, questions, subagent navigation) remains on screen and
  keyboard-reachable.
- The focus hint carries a spoken form, e.g. `aria-label="Focus mode. Press leader-f to
  return to the full view."` where OpenTUI supports it.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 One persisted UI-preference signal (reuse the `sidebar` pattern)

In `routes/session/index.tsx`, add a signal mirroring `sidebar` (`:261`):

```ts
// packages/tui/src/routes/session/index.tsx
const [focus, setFocus] = kv.signal<boolean>("focus_mode", false)   // reuse kv.tsx:40
const focused = () => focus()
function toggleFocus() {
  setFocus((prev) => !prev)
}
```

No backend/SDK change. No new `Part`/route field. Persisted in `kv.json` exactly like
`sidebar` (`context/kv.tsx:40-62`).

### 5.2 Fold Focus mode into the existing visibility memos

Extend `sidebarVisible` so Focus mode always wins (sidebar off):

```ts
const sidebarVisible = createMemo(() => {
  if (focused()) return false                 // Focus mode forces sidebar off
  if (sidebarOpen()) return true
  if (sidebar() === "auto" && wide()) return true
  return false
})
```

### 5.3 Wire the three chrome gates + the focus hint

1. **Header strip** — change its `Show` condition (`:1464`) from
   `session() && !sidebarVisible()` to `session() && !sidebarVisible() && !focused()`.
2. **Sidebar** — its `Show` (`:1631`) is `sidebarVisible()`; because §5.2 already
   returns `false` under Focus mode, no change is needed there, but the overlay-open
   effect (`:285-287`, `useSessionSidebarOpenRequest`) should be guarded so an inbound
   open request is ignored while `focused()` is true.
3. **Footer / status chrome** — wrap any mounted `Footer` (or equivalent status row)
   in `<Show when={!focused()}>`. (Today `Footer` is unmounted; the gate is specified
   so the future wiring of `footer.tsx` is Focus-aware by construction.)
4. **Focus hint** — a slim 1-line bottom strip inside the main column, rendered only
   when `focused()`:

   ```tsx
   <Show when={focused()}>
     <box flexDirection="row" flexShrink={0} paddingTop={1}>
       <text fg={theme.info}>focus</text>
       <text fg={theme.textMuted}> · {focusShortcut()} exit</text>
     </box>
   </Show>
   ```

   where `focusShortcut = useCommandShortcut("session.focus.toggle")` (parallel to
   `sidebarShortcut`, `:1436`).

5. **Blocking prompts stay** — `PermissionPrompt` / `QuestionPrompt` / `SubagentFooter`
   (`:1582-1597`) are **outside** the chrome gates and remain visible in Focus mode.
   The spec pins this: Focus mode never wraps them.

### 5.4 Command + keybind registration (reuse the command-dispatch path)

```ts
// config/keybind.ts  (parallel to sidebar_toggle, :86)
focus_toggle: keybind("<leader>f", "Toggle focus mode"),

// index.tsx command (parallel to session.sidebar.toggle, :133/:717)
"session.focus.toggle",
// ...
value: "session.focus.toggle",
title: focused() ? "Exit focus mode" : "Enter focus mode",
run: () => toggleFocus(),
```

Add `focus_toggle` → `"session.focus.toggle"` mapping in `keybind.ts` (parallel to
`sidebar_toggle: "session.sidebar.toggle"`, `:299`).

### 5.5 Reuse map (no reinvention)

| Need | Reuse from | Source |
| --- | --- | --- |
| Persisted UI pref | `kv.signal("sidebar", "auto")` | `index.tsx:261`, `context/kv.tsx:40` |
| Width recompute | `contentWidth` memo | `index.tsx:290` |
| Sidebar visibility memo | `sidebarVisible` | `index.tsx:276` |
| Command-dispatch toggle | `session.sidebar.toggle` | `index.tsx:133/717`, `keybind.ts:86/299` |
| Shortcut label | `useCommandShortcut` | `index.tsx:1436` |
| Blocking prompts (kept) | `PermissionPrompt`/`QuestionPrompt`/`SubagentFooter` | `index.tsx:1582-1597` |
| Theme tokens | `theme.info`, `theme.textMuted`, `theme.primary` | `theme/index.ts` |
| Focus-mode flag | `Flag.EVOLUTION_T_CLI_0204_…_ENABLED` | `packages/core/src/flag/flag.ts:79/93` |

### 5.6 Web app + desktop

- **Web**: the shared session view (`packages/app/src`) has its own sidebar/header/
  status chrome. Expose the same `focus_mode` preference (persisted in the web's
  existing settings store) and gate the same three regions. No new component — reuse
  the existing layout slots. Desktop inherits automatically (Electron wrapper around
  the web app).
- This is a **view-state only**; no SDK/route contract changes, so web and TUI stay
  wire-compatible.

---

## 6. Removing OpenCode UX Assumptions

- **Default maximal density → first-class minimal surface.** OpenCode/derived default
  shows sidebar-on-wide + full header + footer. The redesign makes Focus mode a
  persisted, keyboard-toggleable view that drops all that with one keystroke.
- **Chrome is a frame, not identity.** Treat sidebar/header/footer as optional
  overlays gated by a UI preference, exactly like the already-existing `sidebar` kv
  signal — not as the unavoidable default frame.
- **Rapid return is a contract, not a sequence.** A single command
  (`session.focus.toggle`) enters *and* exits; the existing `session.global` binding
  set guarantees it is always reachable.
- **Blocking prompts survive minimal mode.** Pin that permission/question/subagent
  prompts are never inside the chrome gates (they already aren't — `:1582-1597`).
- **No OpenCode-branded copy.** Product strings stay Ottili; Claude Code is a
  reference only. Runtime package names (`@opencode-ai/*`) are the fork's identity and
  left as-is (infra, not UX).
- **`models.dev` untouched.** Focus mode needs no model-limit data; the exclusion
  holds.

---

## 7. Feature Flag

Gate the Focus-mode wiring behind:

```ts
EVOLUTION_T_CLI_0204_TUI_REDESIGN_FOCUS_MODE__INTERACTIO_ENABLED = false
```

Add a getter to `packages/core/src/flag/flag.ts` mirroring the existing
`EVOLUTION_T_CLI_0185_…__ENABLED` (`:79`) / `EVOLUTION_T_CLI_0193_…__C_ENABLED`
(`:93`) style, defaulting to `false` and overridable by the env var. When **off**:

- `focused()` is forced `false` (the signal is ignored), so the session renders
  exactly as today — zero regression.
- `session.focus.toggle` is a documented no-op (or hidden from the palette).
- The composer/header/sidebar/footer behave identically to the current build.

Enable after staging validation.

---

## 8. Edge Cases / States

- **No active session (`session()` undefined):** header strip is already hidden
  (`:1464`); Focus mode is only meaningful with a session, and toggling it merely
  keeps the (already-hidden) sidebar hidden. Composer is absent, so nothing else
  changes.
- **Sidebar overlay open, then enter Focus mode:** `sidebarVisible()` returns `false`
  under `focused()` (§5.2) and the open-request effect is guarded (§5.3.2), so the
  overlay closes and cannot re-open until Focus mode exits.
- **Permission / question prompt pending:** rendered in the main column outside the
  chrome gates (`:1582-1597`) → stays visible and actionable in Focus mode. This is
  the pinned contract.
- **Subagent session (`parentID`):** `SubagentFooter` stays (`:1595-1597`).
- **`showDetails` independent:** Focus mode does not force tool details off; the
  existing `tool_details_visibility` kv signal (`:268`) is untouched. (Rapid return to
  "detailed views" refers to the full frame, not tool-card expansion.)
- **Session switch:** `focus_mode` is a global UI preference (like `sidebar`), so it
  persists across sessions by design — no per-session reset, no cross-session data
  leak (it carries no session data).
- **Narrow terminal (`< 80`):** Focus mode drops header/footer/sidebar; transcript
  gets the full width via `contentWidth` (`:290`); tool cards collapse per existing
  narrow rules. No new branch.
- **Loading / empty transcript:** placeholder + spinner render as today; Focus mode
  adds only the 1-line `info` hint.
- **Concurrent prompt while toggling:** toggling is a synchronous kv write; the next
  render reflects it. No async race (compare `sidebar` which is already kv-backed).
- **Flag off:** `focused()` forced false → identical to current build.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a unit test for the `focus_mode` kv signal
  toggle + a render test for `<SessionHeaderStrip>`/`Sidebar`/`Footer` visibility under
  `focused()` true/false; verify blocking prompts remain mounted in Focus mode; verify
  `contentWidth` widens when `focused()`).
- `bun run --cwd packages/ottili-coder typecheck` (the `flag.ts` getter addition).
- `bun run lint`
- `git diff --check`
- Manual: `tmux` TUI smoke at ≥120 / 80–119 / <80 cols; toggle `<leader>f`; confirm
  sidebar + header + footer vanish, transcript widens, composer + blocking prompts
  remain, the `info` focus hint shows, and `<leader>f` again restores the full frame;
  web/desktop mirror the preference.

---

## 10. Open Questions (for human review)

1. **Default on or off?** Recommend off (gated by flag, §7) but consider making
   `focus_mode` default `true` once validated, since Claude Code users expect a
   minimal default. Confirm product intent.
2. **Shortcut key.** `<leader>f` (recommended, parallel to `<leader>b`) vs a bare `f`.
   A bare `f` risks colliding with prompt-mode single-key handlers; `<leader>f` is
   safer. Confirm.
3. **Should Focus mode also collapse `showDetails` (tool cards)?** Recommend **no** —
   keep `tool_details_visibility` independent so "detailed view" of tools is a
   separate toggle; Focus mode owns only frame chrome. Confirm.
4. **Web/desktop parity timing.** Recommend shipping TUI Focus mode first and mirroring
   the same `focus_mode` preference in the web app in the same follow-up; confirm the
   web settings-store field name.
5. **Focus hint placement.** 1-line bottom strip (recommended, §5.3.4) vs a corner
   glyph. Confirm glyph render in target terminals; ASCII fallback if needed.
