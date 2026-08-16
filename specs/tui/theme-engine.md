# Theme Engine — Interaction Specification & Component Architecture

**Task**: T-CLI-0216 · **Layer**: coder-cli · **Category**: FRONTEND_REDESIGN
**Reference**: Claude Code interaction/layout only — no proprietary assets. Ottili brand palette is the source of truth.

This document is derived entirely from source inspection of:

- `packages/tui/src/theme/index.ts` (palette source + `generateSystem`)
- `packages/tui/src/theme/assets/ottiliCoder.json` (Ottili brand palette)
- `packages/tui/src/context/theme.tsx` (TUI theme provider / store)
- `packages/tui/src/component/dialog-theme-list.tsx` (theme picker)
- `packages/ottili-coder/src/cli/cmd/run/theme.ts` (`resolveRunTheme` run-view mapper)
- `packages/ottili-coder/src/cli/cmd/run/footer.ts` (run-view theme state)
- `packages/ottili-coder/src/config/tui-migrate.ts` (legacy `theme` key migration)

---

## 1. Current behavior (from source, not guessed)

### 1.1 Palette source
- The canonical Ottili brand palette is `packages/tui/src/theme/assets/ottiliCoder.json` — a dark theme with named `defs` (`step1..step12`, `secondary`, `accent`, `red`, `orange`, `green`, `cyan`, `yellow`) and a `theme` block mapping semantic roles (`primary`, `text`, `background`, diff/markdown/syntax roles) to those defs.
- `DEFAULT_THEMES` registers 38 built-in themes (incl. `ottiliCoder`, `claude`, `dracula`, …). The active TUI theme defaults to `"ottili-coder"` (`context/theme.tsx:96`).
- **`system` theme is generated, not branded.** `generateSystem(colors, mode)` (theme/index.ts:370) sets `primary: ansiColors.cyan`, `secondary: ansiColors.magenta`, `accent: ansiColors.cyan`, `error: ansiColors.red`, … deriving accents from the **terminal's ANSI palette**, not the Ottili palette. On a terminal whose ANSI cyan differs, the brand drifts. This is the primary obsolete OpenCode UX assumption.

### 1.2 Terminal capability detection
- `renderer.getPalette({ size })` queries terminal colors (OSC 10/11). `size` differs by caller: `context/theme.tsx` uses `16`, run `theme.ts` uses `256`.
- `renderer.paletteDetectionStatus` (`"detecting"` | …) gates retry loops.
- Theme-change notifications: `\x1b[?997;1n` / `\x1b[?997;2n` (context/theme.tsx:188) and `SIGUSR2` (theme.tsx:51, footer.ts:298).
- `terminalMode(colors)` (theme/index.ts:363) classifies dark/light from OSC 11 background.
- **No first-class capability type.** Color depth (truecolor / 256 / 16) is only implicit via `quantizeTheme`/`nearestIndexed`. There is no typed `ThemeCapabilities`.

### 1.3 Explicit override
- Selection: `config.theme` (from `tui.json`) → `kv.get("theme")` fallback (`context/theme.tsx:112`).
- UI: `dialog-theme-list.tsx` calls `theme.set(value)` (writes kv + store).
- Migration: `tui-migrate.ts` moves a legacy `theme` key out of `ottiliCoder.json` into `tui.json`. `config.ts:60` strips a stray `theme` key from merged config.
- **Gap**: the run view (`footer.ts` → `resolveRunTheme(this.renderer)`) never receives the selected theme name and always calls `generateSystem`. The override therefore does **not** apply to the interactive run footer/scrollback.

### 1.4 Component / state map
| Concern | Owner | State primitive | Refresh trigger |
|---|---|---|---|
| TUI app theme | `ThemeProvider` (`context/theme.tsx`) | Solid `createStore<{themes, active, ready}>` | OSC 997, SIGUSR2, mount |
| Run-view theme | `RunFooter` (`footer.ts`) | Solid `createSignal<RunTheme>` + `themes[]` array | OSC 997, SIGUSR2, `PALETTE`/`THEME_MODE` renderer events |
| Selected theme name | `kv` + `tui.json` | string | user action |

Two independent stores refresh in parallel — duplicated detection logic (`resolveSystemTheme` vs `handlePalette`/`handleThemeRefresh`).

---

## 2. Gaps & obsolete OpenCode assumptions

- **G1 — Run view ignores override** (§1.3). Highest-impact; breaks the "explicit override" promise for the main surface.
- **G2 — `system` drifts brand** (§1.1). Violates "Ottili colors remain the palette source."
- **G3 — Dark/light inconsistency.** `context/theme.tsx:34` is dark-only, but run `theme.ts` computes light (`mode()`, `generateSystem(..., pick)` from OSC 11) and is unit-tested for light. Mixed contract.
- **G4 — Duplicated theme state** (§1.4). Two stores, two refresh loops.
- **G5 — No typed capability model.** Color-depth gating is implicit.

---

## 3. Target interaction model

### 3.1 Single source of truth
- The Ottili brand palette (`ottiliCoder.json`) is the **only** source for brand role colors (`primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`, `text`, semantics).
- `system` becomes a **capability-adaptive surface theme**: it adapts *backgrounds/grays/borders* to the terminal background, but anchors brand accents to the Ottili palette. Terminal ANSI colors are used only as a *fallback* when truecolor/Ottili accents cannot be represented (G5).

### 3.2 Capability detection (typed)
```
ThemeCapabilities = {
  colorDepth: "truecolor" | "256" | "16" | "unknown"
  backgroundQuery: boolean   // OSC 11 defaultBackground present
  foregroundQuery: boolean   // OSC 10 defaultForeground present
}
```
Computed once per session by `detectCapabilities(renderer)`:
- `colorDepth` from palette length (`≥256`→truecolor, `≥16`→256, `≥1`→16).
- `backgroundQuery`/`foregroundQuery` from presence of `defaultBackground`/`defaultForeground`.

### 3.3 Resolution order (override wins)
```
resolveActiveTheme({ override, capabilities }) =
  override && hasTheme(override)  -> resolveTheme(allThemes()[override], "dark")
  else                           -> capabilityAdaptiveSystem(capabilities)  // Ottili-anchored
```
The run view calls `resolveRunTheme(renderer, override?)`; when `override` is set it resolves the named variant (Ottili-anchored), otherwise it keeps the current system path (no regression). This closes G1 without breaking existing light-mode tests.

---

## 4. Information hierarchy (Claude Code-like clarity, visibly Ottili)

| Layer | Element | Color role | Density |
|---|---|---|---|
| Background | app surface | `background` / `backgroundPanel` | — |
| Primary accent | active selection, prompts, links | `primary` (#f97316) | high contrast |
| Secondary accent | agents, metadata | `accent` (#a77fc4) | muted |
| Status | success/warning/error chips | `success`/`warning`/`error` | single glyph + text |
| Text | body | `text` (#eae6e1) | 1.0 |
| Muted | timestamps, hints | `textMuted` (#7d7670) | 0.7 |
| Borders | panes, dividers | `borderSubtle`/`border` | hairline |

Clarity rule: one accent per message kind; no gradient noise; diff/syntax roles reuse the brand semantic ramp. Remains visibly Ottili (orange `#f97316` primary, plum `#a77fc4` accent) — not a Claude Code copy.

---

## 5. Keyboard & terminal-width behavior

- **Invocation**: `/theme` command (or `Shift+T`) opens `DialogThemeList`. Arrow/↑↓ moves; live-preview applies via `theme.set` on move (existing behavior, `dialog-theme-list.tsx:34`).
- **Filter**: typing filters the variant list (existing `onFilter`). Enter confirms; Esc reverts to `initial` (existing `onCleanup` revert).
- **Width-responsive**: dialog width = `min(terminalCols - 4, 80)`. Below 40 cols, the variant list collapses to a single column and hides the live-swatch preview to preserve density. Re-layout on `SIGWINCH`.
- **Capability note**: on `< 256` color depth, the dialog marks truecolor-only variants with a `256`/`16` tag and previews them quantized (G5).

---

## 6. Component / state architecture (smallest reusable)

```
┌─────────────────────────────────────────────────────────┐
│  ottili-coder/src/cli/cmd/run/theme-engine.ts            │
│   • OttiliPalette  (brand source accessor)               │
│   • detectCapabilities(renderer): ThemeCapabilities      │
│   • resolveActiveTheme({override, capabilities}): Theme  │
│   • resolveRunThemeForVariant(renderer, name): RunTheme  │
└───────────────┬───────────────────────────┬─────────────┘
                │ uses                        │ uses
        ┌───────▼────────┐           ┌────────▼──────────┐
        │ tui/theme      │           │ run/theme.ts      │
        │ (palette src,  │           │ mapRunTheme(...)  │
        │  resolveTheme, │           │ RUN_THEME_FALLBACK│
        │  allThemes)    │           └───────────────────┘
        └────────────────┘
```

- **Single engine module** owns palette-source + capability + override logic (testable, pure except `detectCapabilities`).
- `run/theme.ts` keeps its `mapRunTheme` role-mapping (exported) and `resolveRunTheme(renderer, override?)` orchestrator.
- `ThemeProvider` remains the live store; the engine is the *resolver* it and the run view both call — removing G4's duplicated resolution logic over time (consolidation deferred per NEXT_ACTIONS).

### Concrete boundaries
- `theme-engine.ts` exports: `OTILI_BRAND_THEME`, `ThemeCapabilities`, `detectCapabilities`, `resolveActiveTheme`, `resolveRunThemeForVariant`.
- It must NOT own reactive state, refresh loops, or SolidJS context (those stay in `ThemeProvider`/footer).
- `resolveRunTheme(renderer)` with no override is byte-for-byte the prior system path.

---

## 7. Acceptance-criteria trace

| Criterion | Where satisfied |
|---|---|
| Current behavior from source | §1 (file/line cited) |
| Claude Code-like clarity, visibly Ottili | §4 (orange/plum brand retained) |
| Ottili colors remain source | §1.1, §3.1, `OTILI_BRAND_THEME` |
| Keyboard & terminal-width specified | §5 |
| Concrete component/state boundaries | §6 |
