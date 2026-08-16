# TUI Redesign — Motion and Streaming Feedback

## Task

- **Task ID**: `7bf69d6e-da8f-43ce-90fc-b9b48a0ac312`
- **Title**: T-CLI-0220 — TUI redesign: Motion and streaming feedback — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the reusable state model and component sketches in §5 are the concrete, implementable architecture referenced by the follow-up implementation task.

---

## 1. Goal

Define the exact interaction model for **Motion and streaming feedback** in Ottili
Coder: subtle spinners, progress, streaming text, and state transitions that never
flicker. Map current components and state, remove obsolete OpenCode UX assumptions,
and design the smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`). No pixel-copy of proprietary artwork or brand assets.

**Scope of this task**: specify the model, the component/state boundary, the keyboard
contract, and the terminal-width contract. The actual wiring into the session route is
a follow-up behind the feature flag in §7.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Spinner atom

- `Spinner` (`packages/tui/src/component/spinner.tsx`) is the only shared motion atom.
  It renders an OpenTUI `<spinner>` element with `SPINNER_FRAMES`
  (`["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]`, braille, 10 frames) at `interval={80}`
  and `color={props.color ?? theme.textMuted}` (spinner.tsx:8-23).
- Motion is gated by the **global `animations_enabled` KV key** (default `true`):
  when disabled, `Spinner` falls back to a static `⋯` glyph and the `<spinner>` is not
  mounted (spinner.tsx:15). The same key gates the prompt retry spinner
  (prompt/index.tsx:1546-1547) and is toggled from the command palette
  (app.tsx:947-950). This is the existing single source of truth for "is motion on".
- The `<spinner>` element itself is provided by `opentui-spinner/solid` and animates on
  its own render-frame loop, so a mounted spinner does **not** depend on Solid reactive
  re-renders to advance. This is the only place flicker is structurally avoided today.

### 2.2 Knight-Rider scanner (misuses the palette)

- `ui/spinner.ts` (`packages/tui/src/ui/spinner.ts`) builds an elaborate bidirectional
  "Knight Rider" scanner. Its default color is **hardcoded OpenCode red**, not the
  Ottili palette: `RGBA.fromHex("#ff0000")`, `"#ff5555"`, `"#dd0000"`, `"#aa0000"`,
  `"#770000"`, `"#440000"` and a default inactive `#330000` (spinner.ts:282-293,
  336-355). There is no consumer of `createFrames`/`createColors` anywhere in `src/`
  (grep finds only the definition). It is dead, off-palette code.

### 2.3 "Go" upsell background pulse (obsolete OpenCode branding)

- `BgPulse` (`packages/tui/src/component/bg-pulse.tsx`) mounts a `GoUpsellArtRenderable`
  that paints an animated background behind the retry-action dialog
  (dialog-retry-action.tsx:7,83). The painter (`bg-pulse-render.ts`) imports
  `export const go` from `../logo` (logo.ts:16) — the OpenCode **"Go"** wordmark — and
  emits rings from the estimated "GO center" (bg-pulse-render.ts:9-30, `PHASE_OFFSET`,
  `LOGO_REACH`). On mount it **mutates the global renderer frame rate to 30fps**
  (`renderer.targetFps = 30; renderer.maxFps = 30`) and restores it on cleanup
  (bg-pulse.tsx:77-87). This is both an obsolete OpenCode brand surface and a global
  flicker/perf hazard (see §3.4).
- The "Go" naming also survives in the account dialog: an `ottili-coder-go` provider
  panel advertising "Ottili Coder Go is a $10 per month subscription…"
  (dialog-provider.tsx:395-399) and in session KV keys
  `GO_UPSELL_FREE_TIER_*` / `GO_UPSELL_ACCOUNT_RATE_LIMIT_*` (index.tsx:110-113). "Go"
  is **not** in the current product family (Ottili ONE, Ottili Coder, LD3, Ottili Cloud,
  Ottili AI), so this is leftover OpenCode product identity.

### 2.4 Streaming text (markdown) — the anti-flicker pattern that exists

- Assistant / reasoning text streams through the markdown surface. The state module
  `component/markdown/state.ts` already implements the **leading+trailing throttle**
  that prevents per-keystroke reparse flicker: `createMarkdownThrottle(commit, 120ms)`
  commits the first push immediately (snappy), buffers subsequent pushes within
  `MARKDOWN_COMMIT_INTERVAL_MS = 120`, and flushes one trailing commit with the latest
  value (state.ts:73-74, 259-309). This is the canonical "stream without flicker"
  primitive and is the model the rest of the spec reuses.
- The markdown surface classifies eight states
  `loading | empty | populated | long-content | failure | denied | offline | degraded`
  (state.ts:24-32) and truncates runaway streams at `MARKDOWN_MAX_LEN = 50000` before
  parsing so a rapid stream can never OOM the renderer (state.ts:67-109). A
  non-color-only status glyph + label backs every state (state.ts:142-213), e.g.
  `loading → ◐` / `[loading]`.

### 2.5 Reasoning (thinking) feedback

- `context/thinking.ts` drives the `Thinking`/`ReasoningHeader` feedback. While a
  reasoning summary is streaming, `SessionHeaderStrip`/session route render
  `<Spinner>Thinking…</Spinner>` (index.tsx:2089-2119). The spinner color is the
  `warning` semantic token at `theme.thinkingOpacity = 0.55` (ottiliCoder.json:42,
  index.tsx:2112) — already on-palette and already using a reduced-opacity treatment
  consistent with "subtle" motion.

### 2.6 Progress / task + usage meters

- `TaskQueue` model (`component/task-queue/model.ts`) is the closest thing to progress
  today: each `Task` carries `progress: number` (0-100) and a `status` enum
  `queued | running | retrying | completed | failed | blocked | cancelled` with
  `STATUS_ICON` glyphs (model.ts:10-81). `applyStream` nudges progress forward on each
  chunk but the math is crude and unbounded-feeling (`Math.min(100, progress + … % 25 || 4)`,
  model.ts:206-212). There is **no visual progress bar** component bound to it yet.
- `CostUsage` meter (`component/cost-usage/model.ts`) already computes a tone from the
  Ottili palette only (`usageTone`: `info`/`warning`/`error`, model.ts:291-297) and a
  block-glyph `usageBar(percent, width)` (model.ts:167-172). This is the palette-correct
  progress primitive the redesign reuses.

### 2.7 Terminal output streaming (logs / tool output)

- `TerminalOutput` (`component/terminal-output/index.tsx` +
  `component/terminal-output/model.ts`) streams raw lines with a lifecycle
  `empty → streaming → complete → failure` (model.ts:37-43, 125-130). It is
  ANSI-safe, foldable (head 8 / tail 4, `FOLD_HEAD_DEFAULT`/`FOLD_TAIL_DEFAULT`),
  searchable, and exposes a `terminalSummary` live-region label (model.ts:246-260).
  Lines are mapped line-by-line with `<For>` (index.tsx:198-223); there is no spinner on
  the streaming pane itself — emptiness is shown with "No output yet" (index.tsx:231-235).

### 2.8 Startup / transient loading

- `StartupLoading` (`component/startup-loading.tsx`) is the only place with explicit
  **anti-flicker transition timing**: it suppresses the spinner for the first 500ms
  (`wait` timer) and holds it for at least 3000ms after ready (`hold` timer) so a brief
  flash of spinner never appears/disappears (startup-loading.tsx:13-47). This is the
  transition-smoothing pattern the spec generalizes into a reusable `useMotionHold`.

### 2.9 Palette (the only color source)

Ottili semantic tokens (`packages/tui/src/theme/assets/ottiliCoder.json`):

| Token | Hex | Use for motion |
| --- | --- | --- |
| `primary` | `#f97316` | active/primary spinner, primary progress |
| `info` | `#3b82f6` (cyan-blue) | neutral streaming, "connected" |
| `success` | `#7fd88f` | done/completed |
| `warning` | `#f5a742` | in-progress caution, thinking (at `thinkingOpacity`) |
| `error` | `#e06c75` | failure |
| `accent` | `#a77fc4` | secondary accent |
| `textMuted` | `#eae6e1`→`step11 #7d7670` | idle/disabled motion |
| `background*` | `step1`–`step4` | track/rail behind progress |

There is **no dedicated `motion`/`spinner` color token**; motion currently borrows
`textMuted` (default) or `warning` (thinking). The redesign keeps these and adds a
single opt-in `motionSubtle` opacity convention (§4.1) rather than new hues.

---

## 3. Gaps

1. **No shared motion/streaming state model.** Spinner, startup-hold, markdown-throttle,
   task-queue progress, and terminal-output lifecycle are five separate, un-coordinated
   implementations. There is no single `MotionPhase` concept the whole TUI agrees on.
2. **Dead, off-palette scanner.** `ui/spinner.ts` Knight-Rider hardcodes OpenCode red
   and has zero consumers (§2.2). It violates "Ottili colors remain the palette source."
3. **Obsolete OpenCode "Go" branding in motion.** `BgPulse`/`GoUpsellArt` paints the
   OpenCode "Go" wordmark as an animated background and mutates the global renderer to
   30fps (§2.3). Both the brand and the global frame-rate side effect are wrong.
4. **Global frame-rate side effect = flicker/perf hazard.** BgPulse changing
   `renderer.targetFps`/`maxFps` on mount and restoring on cleanup can cause the rest of
   the TUI to visibly speed up/slow down and can race with other live renderables. No
   component should own the global frame rate.
5. **No progress-bar component.** Task-queue `progress` and cost `usageBar` exist as data
   but there is no shared `<ProgressBar>` atom; progress is shown as text/percent only.
6. **OpenCode UX assumption: motion is brand-LED.** The most prominent animated surface
   today is an OpenCode "Go" upsell, not a useful status signal. Claude Code shows
   subtle, information-carrying motion (token spinners, inline progress). Removing the
   upsell and promoting useful motion inverts that assumption.
7. **No reduced-motion consistency.** `animations_enabled` gates spinners but not the
   markdown throttle, startup-hold, or any future animated progress; there is no single
   `prefersReducedMotion`/animation decision the whole TUI reads.
8. **No terminal-width contract for motion.** Streaming panes and spinners do not declare
   a width-adaptive contract (the rest of the redesign does via
   `responsive-layout`, model.ts:22-39); motion can overflow or look sparse on narrow
   terminals.
9. **No keyboard contract for motion.** Spinners/progress are non-interactive (correct),
   but the streaming panes (terminal-output, markdown) lack a documented motion-related
   key contract (e.g. pause/resume scroll, copy streaming line).

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

Motion is **information-carrying and subtle**, never decorative. Three tiers:

- **Tier A — Inline status (most common).** A braille spinner + one short label beside a
  streaming/working surface: `⠋ Thinking`, `⠋ Running: npm test`, `⠋ Streaming`. Color =
  the surface's semantic tone (`info` default, `warning` for reasoning, `primary` for
  the active agent). Reduced opacity (`motionSubtle = 0.85`) on the spinner glyph so it
  reads as *background activity*, not foreground text.
- **Tier B — Determinate progress.** When a quantity is known (task % , plan usage, file
  count), render a `<ProgressBar>` with a block-glyph fill in the tone color over a
  `backgroundElement` track. No spinner alongside a determinate bar.
- **Tier C — Ambient/celebratory.** A one-shot, quiet success pulse on `completed`
  (e.g. `✓` fades in then settles) — bounded, never loops. This replaces the looping
  "Go" background.

All motion has a **static, non-color fallback** (the existing `⋯` / bracketed-label
pattern) when `animations_enabled` is false, so state is never conveyed by motion alone.

4.1a **Color = Ottili palette only** (no new hues):

| Phase | Token | Opacity |
| --- | --- | --- |
| idle / queued | `textMuted` | 1.0 |
| streaming / running | `info` | `motionSubtle` (0.85) |
| reasoning / caution | `warning` | `thinkingOpacity` (0.55) |
| active agent | `primary` | `motionSubtle` |
| completed | `success` | 1.0 (one-shot) |
| failed / error | `error` | 1.0 |
| progress fill | tone of the metric (`info`/`warning`/`error` via `usageTone`) | 1.0 |
| progress track | `backgroundElement` | 1.0 |

### 4.2 State machine (the single `MotionPhase`)

One shared, pure state machine replaces the five ad-hoc ones:

```ts
// packages/tui/src/component/motion/model.ts (proposed, pure, testable)
export type MotionPhase =
  | "idle"
  | "queued"
  | "connecting"
  | "streaming"
  | "running"      // determinate work with progress
  | "reasoning"
  | "completed"
  | "failed"

export interface MotionState {
  phase: MotionPhase
  label: string                       // "Thinking", "Running: npm test", …
  progress: number | null             // 0..100 when phase === "running"
  tone: "info" | "warning" | "primary" | "success" | "error" | "idle"
  spinner: boolean                    // render a spinner (phase is indeterminate)
  visible: boolean                    // after hold/debounce (anti-flicker)
}
```

Transitions (pure, total — never throws):

```ts
export function deriveMotionState(
  input: { phase: MotionPhase; label?: string; progress?: number | null; ready?: boolean },
  opts: { animationsEnabled: boolean; holdMs?: number },
): MotionState
```

The phase→tone and phase→spinner mapping is a single lookup table (the "smallest
reusable" piece). `visible` is computed by the `useMotionHold` hook (§5.3) so a
sub-`holdMs` flash is suppressed.

### 4.3 Streaming without flicker (reuse the markdown throttle)

- **Text streaming** continues to flow through `createMarkdownThrottle` (120ms
  leading+trailing). No change to the proven primitive; it is promoted to the shared
  `motion` module (§5.1) so tool-output / terminal-output streaming can use the same
  coalescing instead of re-parsing per chunk.
- **Determinate progress** commits on every `applyStream` but the *visual* bar is
  throttled to the same 120ms budget (one trailing commit) so a fast stream of progress
  updates never thrashes the renderer.
- **State transitions** are debounced/held by `useMotionHold` (§5.3), generalizing
  `StartupLoading`'s 500ms-suppress / 3000ms-hold into a reusable hook.

### 4.4 Interaction

- Spinners and progress bars are **non-interactive** (Tier A/B): no focus, no keybinding.
  They live inside the surface they describe (header strip, tool card, task row).
- Tier C success pulse is non-interactive and auto-settles.
- The streaming surfaces keep their existing keys (terminal-output: `↑/↓` move, `space`
  fold, `y` copy, `/` search — index.tsx:149-173; markdown: scroll). No new motion keys
  are added; motion does not steal focus.

### 4.5 Terminal-width behavior

Motion adapts to the existing `responsive-layout` tiers
(`RESPONSIVE_BREAKPOINTS`: narrow 60 / compact 100 / standard 120 / wide 120,
model.ts:22-27):

| Width | Spinner/label | Progress bar |
| --- | --- | --- |
| ≥ 100 | `⠋ Label` (braille + text) | full `████░░ 62%` |
| 60–99 | `⠋ Label` (drop long sub-label) | `██░ 62%` (bar + %) |
| 40–59 | `⠋` only (glyph, no label) | `62%` (numeric) |
| < 40 | `⋯` static fallback (animations off or too narrow) | `62%` numeric |

Truncation is right-to-left: drop sub-label → drop bar → keep `%`/glyph last. On narrow
terminals the spinner uses the 10-frame braille set (compact, monochrome-friendly); the
block-based Knight-Rider set is **removed** (§6). Layout uses OpenTUI flex with
`flexShrink={0}` on the motion cluster so it never reflows the transcript.

### 4.6 Accessibility

- Every animated surface has a static spoken form via the existing `summary`/`ariaLabel`
  pattern (terminal-output `terminalSummary`, markdown `markdownAriaLabel`). Motion is
  never the only signal: a glyph/percent/label always carries the meaning.
- `animations_enabled = false` (and a future `prefers-reduced-motion` bridge) forces the
  static fallback everywhere through the single `MotionState.visible`/`spinner` decision
  in §4.2 — one switch, whole TUI.
- Color is never the only signal: tone is paired with a glyph (`⠋`/`✓`/`✕`) and text.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Shared pure model (one source of truth, no engine deps)

New file `packages/tui/src/component/motion/model.ts`, mirroring the existing
`terminal-output/model.ts` and `cost-usage/model.ts` pure-module pattern (framework-free,
unit-testable, snapshot-free):

```ts
export type MotionPhase =
  | "idle" | "queued" | "connecting" | "streaming"
  | "running" | "reasoning" | "completed" | "failed"

export type MotionTone = "idle" | "info" | "warning" | "primary" | "success" | "error"

export interface MotionState {
  phase: MotionPhase
  label: string
  progress: number | null
  tone: MotionTone
  spinner: boolean
  visible: boolean
}

export const MOTION_SUBTLE_OPACITY = 0.85

// Single phase → (tone, spinner?) table — the smallest reusable decision.
export const MOTION_PHASE_TONE: Record<MotionPhase, { tone: MotionTone; spinner: boolean }> = {
  idle:       { tone: "idle",     spinner: false },
  queued:     { tone: "idle",     spinner: false },
  connecting: { tone: "info",     spinner: true  },
  streaming:  { tone: "info",     spinner: true  },
  running:    { tone: "primary",  spinner: false },
  reasoning:  { tone: "warning",  spinner: true  },
  completed:  { tone: "success",  spinner: false },
  failed:     { tone: "error",    spinner: false },
}

export function deriveMotionState(
  input: { phase: MotionPhase; label?: string; progress?: number | null },
  opts: { animationsEnabled: boolean },
): MotionState

// Promote the proven markdown throttle into the shared module:
export function createMotionThrottle<T>(commit: (v: T) => void, intervalMs?: number)
```

`createMotionThrottle` is literally `createMarkdownThrottle` lifted and renamed
(state.ts:272-309) so text and progress streaming share one coalescing primitive.

### 5.2 Components (small, reusable)

1. **`<ProgressBar api percent tone />`**
   (`packages/tui/src/component/progress-bar.tsx`): block-glyph fill using
   `usageBar`-style glyphs over a `backgroundElement` track, tone from `MotionTone` →
   `useTheme()` token. Width-adaptive per §4.5. Reused by task-queue rows, cost meter,
   and any determinate streaming.
2. **`<MotionStatus api phase label? progress? />`**
   (`packages/tui/src/component/motion-status.tsx`): the Tier A/B renderer. Reads
   `deriveMotionState`, renders `Spinner` (reusing `component/spinner.tsx`) when
   `spinner`, else `<ProgressBar>` when `progress != null`, else a static glyph. Color
   via `useTheme()` + `MOTION_PHASE_TONE`. `visible` gated by `useMotionHold`.
3. **`<StartupLoading>`** is **generalized**, not replaced: its 500ms-suppress /
   3000ms-hold logic moves into `useMotionHold` (§5.3); `StartupLoading` becomes a thin
   caller. No behavior change for the existing startup screen.
4. **`BgPulse` is removed** (§6). The retry-action dialog keeps its content; the animated
   "Go" background is dropped.

### 5.3 Hooks

```ts
// packages/tui/src/component/motion/use-motion-hold.ts
// Generalizes StartupLoading's timers (startup-loading.tsx:13-47) into a reusable
// anti-flicker hold: suppress < holdMs, then keep visible >= minVisibleMs.
export function useMotionHold(active: () => boolean, opts?: { holdMs?: number; minVisibleMs?: number }): Accessor<boolean>

// packages/tui/src/component/motion/use-animations.ts
// Single decision point for reduced motion. Today: kv "animations_enabled".
// Tomorrow: bridge to a terminal `prefers-reduced-motion` capability.
export function useAnimations(): Accessor<boolean>
```

`useAnimations()` is the one hook every motion component calls, replacing the five
scattered `kv.get("animations_enabled", true)` reads (spinner.tsx:15, prompt/index.tsx:176,
1546, app.tsx:947, index.tsx:286) so the reduced-motion contract is enforced in one place.

### 5.4 Web app + desktop

- Web already has `ProgressCircle` (context-usage.tsx) and a token spinner; the shared
  `MotionPhase` vocabulary is adopted as a TypeScript type the web can import
  (mirroring how `getContextUsage` is shared). Desktop inherits automatically (Electron
  wraps the web app). No web behavior change is required for this spec.

---

## 6. Removing OpenCode UX Assumptions

- **Delete `BgPulse` / `GoUpsellArt`.** `component/bg-pulse.tsx`,
  `component/bg-pulse-render.ts`, and the `go` export in `logo.ts` are OpenCode "Go"
  brand surfaces. Removing them also removes the global `renderer.targetFps = 30` side
  effect (bg-pulse.tsx:77-87) — the flicker/perf hazard in §3.4. The retry-action dialog
  keeps its body; it simply no longer paints an animated "Go" background.
- **Rename / drop the "Go" upsell.** The `ottili-coder-go` provider panel
  (dialog-provider.tsx:395-399) and the `GO_UPSELL_*` KV keys (index.tsx:110-113) are
  OpenCode "Go" product identity. Replace with the Ottili Cloud / Ottili ONE account
  framing already used elsewhere, or remove. "Go" is not in the current product family.
- **Delete `ui/spinner.ts` Knight-Rider scanner.** Dead (zero consumers) and hardcodes
  OpenCode red. Its `deriveTrailColors`/`deriveInactiveColor` helpers are unused off
  -palette code; remove the file. If a richer scanner is ever wanted, it must be built
  from Ottili semantic tokens, not hardcoded hex.
- **Motion is information, not branding.** Promote useful, subtle, palette-correct motion
  (spinners, progress) to first-class status signals, replacing the brand-LED "Go"
  background as the most prominent animated surface.
- **Keep `SessionV2Info.tokens` / `AssistantMessage.tokens` wire-compatible.** No session
  message contract change; only presentation/state is restructured.
- **Keep OpenTUI `<spinner>` and `opentui-spinner`.** These are engine utilities, not
  OpenCode branding; the braille `SPINNER_FRAMES` set is kept.

---

## 7. Feature Flag

Gate the new `<MotionStatus>` / `<ProgressBar>` adoption, `useMotionHold`, and the
`BgPulse` removal behind a single flag so the session renders **exactly as today** when
off (zero regression):

```ts
// packages/core/src/flag/flag.ts (add alongside the other EVOLUTION_T_CLI_* flags)
// Motion and streaming feedback redesign (T-CLI-0220): shared MotionPhase state
// model, ProgressBar + MotionStatus atoms, useMotionHold, and removal of the
// OpenCode "Go" upsell background. Off until staging validation passes; when off
// the TUI keeps Spinner + StartupLoading + markdown throttle unchanged.
get EVOLUTION_T_CLI_0220_TUI_REDESIGN_MOTION_AND_STREAMING_FE_ENABLED() {
  return truthy("EVOLUTION_T_CLI_0220_TUI_REDESIGN_MOTION_AND_STREAMING_FE_ENABLED")
}
```

Default `false`; enable after staging validation. The flag is read in `SessionHeaderStrip`
/ tool-card / task-queue render sites; when off, those sites render the existing
`Spinner`/`StartupLoading` exactly as today. The deleted `BgPulse` is referenced only by
`dialog-retry-action.tsx`, which falls back to a static panel when the flag is off.

---

## 8. Edge Cases / States

- **`animations_enabled = false`** (or reduced-motion): every surface renders its static
  fallback (`⋯` / bracketed label / numeric `%`); `useAnimations()` forces
  `MotionState.spinner = false` and `visible` still respected (§4.6).
- **Sub-`holdMs` flash:** `useMotionHold` suppresses a spinner that would show for less
  than `holdMs` (default 500) and holds a completed state for `minVisibleMs` (default
  3000) so transitions never flicker in/out (generalizes startup-loading.tsx:13-47).
- **Rapid stream:** `createMotionThrottle` (120ms) coalesces text + progress commits;
  latest value wins; never reparses per chunk (state.ts:259-309).
- **Runaway stream:** markdown keeps `MARKDOWN_MAX_LEN = 50000` truncation so a long/
  rapid stream cannot OOM the renderer (state.ts:67-109).
- **Determinate with unknown total:** `progress = null` → render Tier A spinner, not a
  bar (phase `streaming`/`connecting`).
- **Failure mid-stream:** phase `failed` → `error` tone, static `✕`, no spinner; keep
  last-known progress (do not blank).
- **Narrow terminal (< 40 cols):** glyph-only / numeric-only fallback (§4.5); never
  overflow the transcript.
- **Concurrent surfaces:** each `MotionStatus` is keyed by its own surface id (tool part
  id, task id, session id); no shared global frame-rate state (the BgPulse hazard is
  gone).

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add unit tests for `deriveMotionState`,
  `MOTION_PHASE_TONE`, `createMotionThrottle` reuse, and `useMotionHold` timing; add a
  render test for `<MotionStatus>` + `<ProgressBar>` covering full / compact / minimal
  widths and idle / streaming / running / completed / failed / animations-off states).
- `bun run --cwd packages/ottili-coder typecheck` (flag addition in core/flag/flag.ts).
- `bun run lint`
- `git diff --check`
- Manual: `tmux` TUI smoke at 3 widths (≥100 / 60–99 / <40) with `animations_enabled`
  on and off; confirm no global frame-rate change when a dialog opens (BgPulse removed);
  desktop web app inherits.

---

## 10. Open Questions (for human review)

1. Should `useAnimations()` also bridge a terminal `prefers-reduced-motion` capability
   when OpenTUI exposes one, or stay KV-only for now? Recommend KV-only until the
   capability exists.
2. Default `holdMs`/`minVisibleMs` for `useMotionHold`: keep `StartupLoading`'s 500/3000,
   or shorten to 250/1200 for snappier Claude-Code-like feel? Recommend 300/1500.
3. Is the `ottili-coder-go` panel replaced with an Ottili Cloud framing or fully removed?
   Recommend Ottili Cloud framing to preserve the upsell intent without the "Go" brand.
4. Knight-Rider `ui/spinner.ts` deletion — confirm no hidden consumer in plugins/themes
   before removing (grep shows none in `src/`).
