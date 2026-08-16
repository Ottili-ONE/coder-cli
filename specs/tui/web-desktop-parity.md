# Web & Desktop Parity — Interaction Specification & Component Architecture

**Task**: T-CLI-0244 · **Layer**: coder-cli · **Category**: FRONTEND_REDESIGN
**Reference**: Claude Code interaction/layout only — no proprietary assets. Ottili brand palette is the source of truth.
**Depends on**: T-CLI-0212 (responsive terminal layout), T-CLI-0216 (theme engine).

This document is derived entirely from source inspection of:

- `packages/ui` — shared web kit (`components/`, `context/`, `theme/`, `hooks/`)
- `packages/app/src/app.tsx` — web app routes + provider composition
- `packages/desktop/src/main/{index,windows,menu,updater,ipc}.ts`, `packages/desktop/src/renderer/*` — Electron host
- `packages/tui/src/{routes/session/index.tsx, keymap.tsx, config/keybind.ts, component/responsive-layout/*, theme/*, context/*}`
- `packages/ui/src/theme/themes/ottiliCoder.json`, `packages/tui/src/theme/assets/ottiliCoder.json`
- `packages/core/src/flag/flag.ts`

---

## 1. Current behavior (from source, not guessed)

### 1.1 Three hosts, two codebases

- **Web (`packages/app`)** and **Desktop (`packages/desktop`, Electron)** are the *same* application. The desktop `BrowserWindow` loads the web app bundle via `win.loadURL(url)` / `rendererProtocol://<host>/<html>` (`packages/desktop/src/main/windows.ts:228,232`), served by `spawnLocalServer` / `resolveAppPath`. Desktop adds **only** platform-capability IPC (`menu.ts`, `updater.ts`, `ipc.ts`, `wsl/`). → Web↔Desktop parity is structurally solved at the app layer.
- **The TUI (`packages/tui`, OpenTUI)** is a *third, independent* codebase. It shares only the SDK (`@opencode-ai/sdk`), core flags, and the data model with the web/desktop side. Its components (`component/`: prompt, tool-card, sidebar, markdown, permission, question, checkpoint-timeline, context-meter, cost-usage, file-tree, terminal-output…), state (`context/`: data, sync, route, local, sdk, theme, kv, thinking, editor, clipboard), and renderer (`@opentui/core|solid|keymap`) are disjoint from `packages/ui`.
- **Shared web kit**: `packages/ui` provides the design system (button, dialog, list, tabs, markdown, code-block, session-turn, tool cards, toast, popover, select, resize-handle, scroll-view…), contexts (data, dialog, file, marked, i18n, worker-pool), and theming (`theme/themes/ottiliCoder.json`). It is consumed by both `packages/app` and (transitively) the desktop.

### 1.2 Palette is already shared at brand source

Both web (`packages/ui/src/theme/themes/ottiliCoder.json`) and TUI (`packages/tui/src/theme/assets/ottiliCoder.json`) carry the **identical** Ottili brand palette (primary `#f97316` orange, accent `#a77fc4` plum, text `#eae6e1`, etc.). → "Ottili colors remain the palette source" is already satisfied at the token level. **Gap**: the TUI `system` theme can still drift brand via ANSI-generated accents (theme-engine.md §1.1/G2); the web side must be audited for the same drift.

### 1.3 Terminal-width behavior (TUI only, precedent T-CLI-0212)

`packages/tui/src/component/responsive-layout/model.ts` defines `RESPONSIVE_BREAKPOINTS {narrow:60, compact:100, standard:120, wide:120}`, tiers `narrow|compact|standard|wide`, sidebar modes `docked|overlay|hidden`, header densities `full|condensed|minimal`, and `computeResponsiveLayout()` — gated by `Flag.EVOLUTION_T_CLI_0212_TUI_REDESIGN_RESPONSIVE_TERMINAL_LAY_ENABLED`. Web/desktop have **no equivalent named width-tier contract** (they rely on independent CSS breakpoints).

### 1.4 Keyboard model (per-host)

- TUI: `keymap.tsx` + `config/keybind.ts` define a mode stack (`OTTILI_CODER_BASE_MODE`, `OttiliCoderKeymapProvider`), leader key, command palette (`command.palette.show`), and per-command bindings.
- Web/desktop: keybindings live in `packages/app/src/components/settings-keybinds.tsx` + `@opencode-ai/ui` keybind primitives.
- **Gap**: there is no shared "command registry" between TUI and web — two sources of truth for the same actions (open settings, fork, theme, model switch).

### 1.5 State ownership

| Concern | Web/Desktop owner | TUI owner |
|---|---|---|
| Session/transcript | `packages/ui` data ctx + `packages/app` SDK hooks | `tui/context/data.tsx`, `sync.tsx` |
| Prompt/draft | `packages/app/context/prompt`, `tabs` | `tui/context/prompt.tsx`, `component/prompt` |
| Permission | `packages/app/context/permission` | `tui/routes/session/permission.tsx` |
| Settings | `packages/app/context/settings` | `tui/context/*` + `tui.json` |
| Theme | `packages/ui/theme` (ottiliCoder.json) | `tui/theme` (ottiliCoder.json) |
| Notify/toast | `packages/app/context/notification`, `ui/toast` | `tui/ui/toast`, `useToast` |
| Platform caps | `packages/desktop/main/*` IPC | terminal dimensions, `@opentui/keymap` |

---

## 2. Gaps & obsolete OpenCode UX assumptions

- **G1 — No shared interaction contract.** "Open session", "fork", "approve permission", "open settings", "switch model" are defined independently in TUI `keymap.tsx` and web `settings-keybinds.tsx` / `@opencode-ai/ui` keybind. Two command vocabularies for one product.
- **G2 — TUI brand drift (carried from T-CLI-0216).** `system` theme can use ANSI-generated accents; parity requires both surfaces to anchor brand to `ottiliCoder.json`.
- **G3 — No width-tier parity.** TUI has `computeResponsiveLayout` (T-CLI-0212); web/desktop lack an equivalent *named* tier contract, so density decisions diverge by accident.
- **G4 — Obsolete OpenCode identity.** Packages still named `@opencode-ai/tui|ui|core|sdk|plugin`; binary `bin/opencode`; pervasive `OpenCode` strings/comments across `packages/{app,desktop,tui}`. The UX mental model still assumes an upstream OpenCode product rather than Ottili Coder's three-host model. (Branding removal is a follow-up; this spec defines the *model* the replacement must satisfy.)
- **G5 — Platform capabilities not surfaced in the model.** Desktop contributes menus, auto-update, WSL sidecar, native file dialogs, native notifications, deep links, crash reporting; Web contributes browser a11y/responsive; TUI contributes terminal width, keyboard, ANSI. None are expressed as a first-class capability the shared interaction model can branch on.

---

## 3. Target interaction model

One product, three hosts, a single interaction vocabulary.

### 3.1 Shared Parity Contract (single source of truth)

Define a host-agnostic interaction vocabulary — `ParityCommand` (openSession, forkSession, approvePermission, openSettings, switchModel, toggleTheme, openCommandPalette, focusTranscript, attachFile…) — implemented by every host through a `ParitySurface` adapter:

```
ParitySurface = {
  commands: Record<ParityCommand, () => void>   // one registry, all hosts
  capabilities: PlatformCapabilities             // see §3.3
  widths: LayoutTier                            // see §5
  toast: (msg, tone) => void
  navigate: (route) => void
}
```

- Web & Desktop share one `ParitySurface` implementation (they already share `packages/ui` + `packages/app`); Desktop overrides only `capabilities` (menus, updater, WSL, native dialogs).
- The TUI implements the **same** `ParityCommand` set via `keymap.tsx` / `OttiliCoderKeymapProvider`; its `capabilities` differ (terminal width, keyboard-only, no OS menu).

### 3.2 State model (smallest reusable)

A single `ParitySessionModel` describing the durable, host-independent view of a session: `{ id, status, messages, draft, pendingPermission, model, contextUsage, checkpoints }`. Both `packages/ui` data context and `tui/context/data.tsx` already expose equivalents — the contract is to *name* them identically and route them through one `ParitySurface.commands` so behavior is identical across hosts.

**No new state store is introduced**; the architecture reuses `packages/ui` contexts (web/desktop) and `tui/context/*` (TUI) and adds only the thin `ParitySurface` adapter + `ParityCommand` registry. This is the "smallest reusable" boundary.

### 3.3 Platform capabilities (explicitly surfaced)

```
PlatformCapabilities = {
  host: "web" | "desktop" | "tui"
  osMenu: boolean              // desktop: app menu (menu.ts)
  autoUpdate: boolean          // desktop: updater.ts
  wsl: boolean                 // desktop: wsl/ sidecar
  nativeFileDialog: boolean    // desktop: ipc.ts showOpenDialog
  nativeNotification: boolean
  terminalWidth: boolean       // tui: useTerminalDimensions
  keyboardOnly: boolean        // tui
  browserA11y: boolean         // web
}
```

The shared UI branches on `capabilities`, never on `host` string literals scattered through components.

---

## 4. Information hierarchy (Claude-Code-like clarity, visibly Ottili)

Claude Code reference = high information density, single accent per region, clear status line, minimal chrome. Applied with the Ottili palette (from `ottiliCoder.json`):

| Region | Element | Color role | Density |
|---|---|---|---|
| Surface | app bg | `background` (#0d0a08) / `backgroundPanel` (#161311) | — |
| Primary accent | active selection, prompt caret, links, CTA | `primary` (#f97316) | high contrast |
| Secondary accent | agents, metadata, headings | `accent` (#a77fc4) | muted |
| Status chips | success/warning/error | `success`(#7fd88f)/`warning`(#f5a742)/`error`(#e06c75) | glyph + text |
| Body text | transcript | `text` (#eae6e1) | 1.0 |
| Muted | timestamps, hints, line numbers | `textMuted` (#7d7670) | 0.7 |
| Borders | panes, dividers, diff | `borderSubtle`(#3c3531)/`border`(#f97316) | hairline |
| Diff/syntax | reuse brand ramp | diff*/syntax* roles | — |

Clarity rule (from theme-engine.md §4): one accent per message kind; no gradient noise; diff/syntax roles reuse the brand semantic ramp. Remains visibly Ottili (orange primary, plum accent) — not a Claude Code copy. This hierarchy is the **identical** spec for TUI and web/desktop; only the primitive set differs (opentui renderable vs `@opencode-ai/ui` component).

---

## 5. Keyboard & terminal-width behavior

### 5.1 Keyboard (parity)

- Every `ParityCommand` has **one canonical binding** defined in a shared registry; per-host keymaps map to it. TUI keeps `OttiliCoderKeymapProvider` (`keymap.tsx`) + leader key + command palette (`command.palette.show`); web/desktop keep `@opencode-ai/ui` keybind + `settings-keybinds.tsx`. The registry guarantees the same action is reachable on every host (e.g., `toggleTheme` = `Shift+T` TUI / settings shortcut web).
- A11y: web/desktop use `role`/`aria-*` + focus traps (existing `@opencode-ai/ui` components); TUI uses `@opentui/keymap` focus + screen-reader passthrough. One "focus order" contract per surface.

### 5.2 Terminal-width (TUI) — reuse T-CLI-0212

- Adopt `computeResponsiveLayout` breakpoints: `narrow<60`, `compact<100`, `standard<120`, `wide≥120`. Sidebar `docked|overlay|hidden`, header `full|condensed|minimal`, diff `split|unified`, padding `1`(narrow/compact)/`2`(standard/wide). Gated by `EVOLUTION_T_CLI_0212_…_ENABLED`; flag-off = legacy behavior.
- Web/desktop: introduce a **named** CSS-tier mirror (`narrow|compact|standard|wide`) in `packages/ui` so density decisions match the TUI tiers instead of ad-hoc breakpoints (closes G3). Tiers named identically so a future responsive-parity test can assert both hosts pick the same tier at a given width.

---

## 6. Component / state architecture (smallest reusable)

```
┌──────────────────────────────────────────────────────────────┐
│  Parity Contract (NEW, tiny)                                  │
│   • ParityCommand         (registry of one product vocabulary)  │
│   • ParitySurface         (commands + capabilities + navigate)  │
│   • PlatformCapabilities  (host capability flags)               │
│   • ParitySessionModel    (named, host-independent view)        │
└───────┬───────────────────────────────┬──────────────────────┘
        │ implemented by                │ implemented by
┌───────▼────────────┐          ┌───────▼──────────────────────┐
│ Web/Desktop adapter │          │ TUI adapter                   │
│ (packages/app +    │          │ (packages/tui)                │
│  packages/ui)      │          │  keymap.tsx, context/*       │
│  app.tsx providers │          │  component/*, theme/*         │
│  + desktop/main/*  │          │  @opentui/*                  │
│    IPC overrides    │          │                               │
└───────┬────────────┘          └───────┬──────────────────────┘
        │ shares                       │ shares
┌───────▼────────────────────────────────▼──────────────────────┐
│  Shared brand + data: ottiliCoder.json (both ui & tui),       │
│  @opencode-ai/sdk (v2 session/message/tool types),           │
│  @opencode-ai/core flags                                      │
└───────────────────────────────────────────────────────────────┘
```

- **No new state store.** Reuse `packages/ui` contexts (web/desktop) and `tui/context/*` (TUI). The Parity Contract is an *adapter layer*, not a second source of state.
- **Concrete boundaries**
  - `ParityCommand` / `ParitySurface` / `PlatformCapabilities` / `ParitySessionModel`: declare once, import by all three hosts. TUI implements via `keymap.tsx` + `OttiliCoderKeymapProvider`; web/desktop via `packages/app/context/*` + `@opencode-ai/ui` keybind.
  - Desktop overrides ONLY `capabilities` (`osMenu`,`autoUpdate`,`wsl`,`nativeFileDialog`,`nativeNotification`) through `desktop/main/{menu,updater,ipc,wsl}`.
  - **Feature flag** (proposed, follows T-CLI-0212 convention): add to `packages/core/src/flag/flag.ts` immediately after the T-CLI-0212 getter (~line 146):

    ```ts
    get EVOLUTION_T_CLI_0244_TUI_REDESIGN_WEB_DESKTOP_PARITY_ENABLED() {
      return truthy("EVOLUTION_T_CLI_0244_TUI_REDESIGN_WEB_DESKTOP_PARITY_ENABLED")
    }
    ```

    Default false; gate the Parity Contract wiring + the web/desktop width-tier mirror behind it.
- **Obsolete-assumption removal (design-level):** the contract must NOT reference OpenCode product identity; capability flags replace host-name branching; brand anchors to `ottiliCoder.json` on both surfaces (closes G2). The actual `@opencode-ai/*` → `@ottili-coder/*` rename and string scrub is a separate follow-up (see NEXT_ACTIONS / KNOWN_PROBLEMS).

---

## 7. Acceptance-criteria trace

| Criterion | Where satisfied |
|---|---|
| Current behavior from source | §1 (files/lines cited: `windows.ts:228/232`, `keymap.tsx`, `responsive-layout/model.ts`, `ottiliCoder.json`, `app.tsx`) |
| Claude-Code-like clarity, visibly Ottili | §4 (orange/plum brand retained, density rules) |
| Ottili colors remain source | §1.2, §4 (ottiliCoder.json on both ui & tui) |
| Keyboard & terminal-width specified | §5 (ParityCommand registry + T-CLI-0212 tiers + named web/desktop mirror) |
| Concrete component/state boundaries | §6 (Parity Contract adapter, no new store, flag insertion point) |
