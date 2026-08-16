# TUI Redesign — Context Usage Meter

## Task

- **Task ID**: `9027a852-2d3f-40ad-98bc-7da2f6d0a89e`
- **Title**: T-CLI-0148 — TUI redesign: Context usage meter — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the model context-limit enrichment is a documented dependency.

---

## 1. Goal

Define the exact interaction model for the **Context usage meter** in Ottili
Coder: tokens, cache, memory, compaction threshold, and context sources. Map
current components and state, remove obsolete OpenCode UX assumptions, and design
the smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`). No pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Web app meter (the only shipped meter today)

- `SessionContextUsage` (`packages/app/src/components/session-context-usage.tsx`)
  is a header **button** wrapping a 16px `ProgressCircle` with a hover **tooltip**
  (context-usage.tsx:75-102). Props `variant: "button" | "indicator"` (15-18);
  `indicator` renders the bare circle, `button` wraps it in a ghost `Button`
  (108-119). ARIA label `context.usage.view` (115).
- The tooltip shows three facts only: total tokens, usage %, and total cost
  (context-usage.tsx:81-102). It does **not** show cache read/write, reasoning, or
  context-source breakdown.
- Click opens the **Context tab** in the review panel
  (`openSessionContext`, context-usage.tsx:20-29, 61-73), populated by
  `SessionContextTab`.
- Placed in two spots: `message-timeline.tsx:1404`
  (`<SessionContextUsage placement="bottom" />`) and `session-side-panel.tsx:301`
  (`<SessionContextUsage variant="indicator" />`).

### 2.2 Web app metrics (pure computation)

- `getSessionContextMetrics(messages, providers)`
  (`packages/app/src/components/session/session-context-metrics.ts:80-82`):
  - `totalCost` = Σ `msg.cost` over assistant messages (51).
  - `context` is derived from the **last assistant message that has tokens**
    (`lastAssistantWithTokens`, 41-48). `usage = round(total / limit * 100)` where
    `limit = provider.models[modelID].limit.context` (57, 75).
  - Per-message fields: `input`, `output`, `reasoning`, `cacheRead`,
    `cacheWrite`, `total` (62-76). `usage` is `null` when no model limit is known.
- `estimateSessionContextBreakdown`
  (`packages/app/src/components/session/session-context-breakdown.ts:70-132`)
  estimates the **input-context source distribution** as
  `system | user | assistant | tool | other` (3). It char-counts message parts
  (`charsFromUserPart` 16-21, `charsFromAssistantPart` 23-33) at `~4 chars/token`
  (`estimateTokens` 12) and scales to the known input token count. `other` is the
  residual (system-prompt + tool-definition overhead).
- `createSessionContextFormatter(locale)`
  (`packages/app/src/components/session/session-context-format.ts:3-19`) wraps
  `Intl` for `number` / `percent` / `time` (returns `—` for null/undefined).

### 2.3 Web app detail tab

- `SessionContextTab` (`packages/app/src/components/session/session-context-tab.tsx`)
  renders: a 2-col **stats grid** (199-219, 280-284) with session/provider/model/
  limit/total/usage/input/output/reasoning/cache/cost/timestamps; a **horizontal
  breakdown bar** colored by CSS vars (`BREAKDOWN_COLOR`, 21-27, 286-315); the
  **system prompt** (317-326); and **raw messages** (328-337).
- i18n keys live in `packages/app/src/i18n/en.ts`: `context.usage.*` (452-455),
  `context.stats.*` (435-450), `context.breakdown.*` (424-430),
  `context.systemPrompt.title` (432), `context.rawMessages.title` (433).

### 2.4 TUI state (no meter, only a hidden command)

- `SessionHeaderStrip` (`packages/tui/src/routes/session/header-strip.tsx`) is the
  only session header. It renders `title · agent · model` on the left and a
  `sidebar` shortcut hint on the right (1-52). **There is no context usage meter.**
- The only TUI surface for this data is the `/cost` slash command
  (`packages/tui/src/routes/session/index.tsx:1126-1157`): a dialog showing
  `cost`, and `tokens` (input/output/reasoning) + `cache` (read/write). It is
  **hidden behind a command** and shows no percentage, no threshold, and no source
  breakdown.
- TUI state (`packages/tui/src/context/data.tsx`): `session.info` (39) carries
  `SessionV2Info` (session-total `tokens`), `session.message` (40) carries per
  message history; `location.model.list()` (526-534) returns `ModelV2Info`.

### 2.5 Data contract (SDK)

- `SessionV2Info.tokens` = **session totals**
  `{ input, output, reasoning, cache: { read, write } }`
  (`packages/sdk/js/src/v2/gen/types.gen.ts:3826-3834`).
- `AssistantMessage.tokens` = **per-message**
  `{ input, output, reasoning, cache: { read, write } }` (186-194).
- `ModelV2Info` (`2896+`) exposes `id`, `providerID`, `name`, `api`,
  `capabilities`, `request` — **but no `limit.context` / `limit.input`**. The web's
  `usage %` comes from a *richer* provider model (`Provider.Model.limit.context`)
  returned by the server sync store (`packages/app/src/hooks/use-providers.ts`),
  which the TUI SDK model type does **not** carry.
- Compaction threshold logic (`packages/ottili-coder/src/session/overflow.ts`):
  - `COMPACTION_BUFFER = 20_000` (8).
  - `usable(model) = limit.context - reserved`, where
    `reserved = cfg.compaction?.reserved ?? min(20000, maxOutputTokens)` (10-20).
  - `isOverflow` triggers auto-compaction when projected tokens `>= usable` (22-34).
  - `compaction.auto` / `compaction.prune` and `preserve_recent_tokens`
    (`compaction.ts:93`) are gated by `OTTILI_CODER_DISABLE_AUTOCOMPACT` /
    `OTTILI_CODER_DISABLE_PRUNE` (`config.ts:595-599`).

### 2.6 Branding & palette

- Ottili branding is already in place (`BrandLabel` renders `✻ Ottili Coder`).
- TUI theme semantic tokens (`packages/tui/src/theme/index.ts`): `primary` (cyan,
  411), `error` (red, 416), `warning` (yellow, 417), `success` (green, 418),
  `info` (cyan, 419), `textMuted` (423), `text`, `borderSubtle`. The web breakdown
  uses CSS vars `--syntax-info/-success/-property/-warning/-comment`
  (session-context-tab.tsx:21-27).

---

## 3. Gaps

1. **No TUI header meter.** Only a hidden `/cost` dialog. The TUI gives no
   at-a-glance context pressure signal during a session.
2. **TUI cannot compute a percentage.** `ModelV2Info` lacks `limit.context`, so the
   TUI has no denominator for `usage %` or the compaction threshold. This is the
   central blocker and is a backend/SDK dependency (§5.4).
3. **No compaction-threshold marker.** Neither TUI nor web shows *where* auto-
   compaction will fire. The threshold (`usable`) is computed server-side only.
4. **Cache / memory is second-class.** The web tooltip omits cache read/write and
   reasoning; the TUI `/cost` shows them but only on demand. "Memory" maps to the
   model's prompt-cache (`tokens.cache`): `cacheWrite` = memory stored this turn,
   `cacheRead` = memory hits reused. No dedicated long-term-memory token accounting
   exists in source today — cache is the memory axis.
5. **Context sources are web-only.** The `system/user/assistant/tool/other`
   breakdown lives only in the web detail tab; the TUI never renders it.
6. **OpenCode UX assumption: meter is a hidden hover button.** The web treats the
   meter as a tiny progress-circle you must hover; the TUI hides it behind `/cost`.
   Claude Code shows a persistent, dense meter. Treating the meter as an
   always-visible first-class header element removes this assumption.
7. **OpenCode data assumption: `usage = lastMessageTotal / limit`.** The current
   "%" is the *last turn's* token count over the window, not a projection of the
   *current* window fill. It is a reasonable proxy but should be labeled as such and
   eventually replaced by a live projected-context estimate (§4.1).

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A single persistent **Context usage meter** sits in the session header (TUI
`SessionHeaderStrip`, right side, before the `sidebar` hint). It is dense,
monochrome by default, with a color accent only as context pressure rises.

Full-density layout (≥ 100 cols):

```text
ctx 62% ▓▓▓▓▓▓░░░░ |↑ 123k/200k  $0.03  ⚡4k
```

Order and meaning:

| Segment | Meaning | Source | When shown | Accent (Ottili) |
| --- | --- | --- | --- | --- |
| `ctx` | label | fixed | always | `textMuted` |
| `62%` | window fill % | `projectedPct` (fallback `lastTurnPct`) | always (or `—`) | threshold color (§4.1a) |
| `▓▓▓▓▓░░` | block bar | `projectedPct` | ≥ 40 cols | threshold color |
| `\|↑` | compaction-threshold tick | `thresholdPct` | `auto !== false` & limit known | `warning` |
| `123k/200k` | `projected / limit` tokens | `projected`, `limit` | ≥ 60 cols | `text` |
| `$0.03` | session cost | `cost` | ≥ 60 cols | `textMuted` |
| `⚡4k` | cache written this turn (memory) | `cacheWrite` | > 0 & ≥ 80 cols | `success` |

Two layers of number, matching Claude Code density:

- **Header (persistent):** bar + % + threshold tick + compact token/cost/cache.
  No spinner, no "clean" badge when idle.
- **Detail (on demand):** opens `ContextUsageDialog` with the full breakdown
  (input/output/reasoning/cache read+write), provider/model, limit, usable
  threshold + %, context-source distribution bar (system/user/assistant/tool/
  other), and last-activity time.

4.1a **Threshold colors** (Ottili palette only):

- `usage < 70%` → `info` (cyan)
- `70% ≤ usage < 90%` → `warning` (yellow)
- `usage ≥ 90%` **or** `usage ≥ thresholdPct` → `error` (red)
- threshold tick `|↑` always `warning` so it is visible before the red zone.

### 4.2 Interaction

- The header meter is an **actionable control**: `Enter` / click opens
  `ContextUsageDialog`.
- Add a `/usage` slash command parallel to the existing `/cost`
  (`index.tsx:1126`); `/cost` is retained for parity. `/usage` opens the same
  dialog with the richer payload (cache + sources + threshold).
- Inside `ContextUsageDialog`: `c` copy summary to clipboard, `Esc` close
  (reuse existing dialog primitives). No write actions — the meter is read-only;
  compaction is triggered separately (`/compact`).
- Keyboard accelerators documented in the command palette / which-key overlay.

### 4.3 Terminal-width behavior

| Width | Rendered |
| --- | --- |
| ≥ 100 | full density (bar % tick `123k/200k` `$0.03` `⚡4k`) |
| 60–99 | `62% ▓▓▓░ 123k/200k` (drop `$cost`, `⚡cache`) |
| 40–59 | `62% ▓▓▓░` (bar + %, drop token count) |
| < 40 | `62%` (numeric only; drop bar) |

Truncation is right-to-left: drop `⚡cache`, then `$cost`, then `123k/200k`, then
bar, preserving `%` + label last. The bar renders with block glyphs
`█▉▊▋▌▍▎▏░`; if the terminal lacks them, fall back to `=`/`-`-style segments.
Layout uses OpenTUI flex with `flexShrink={0}` on the meter cluster and a
`flexGrow` spacer before the `sidebar` hint.

### 4.4 Accessibility

- The meter is a `<box>`/`<text>` with an explicit spoken form via Solid
  `title`/`role` (where OpenTUI supports it), e.g.
  `aria-label="Context 62% of 200k tokens, 4k cached, auto-compact at 90%"`.
- Color is never the only signal: the `|↑` tick, `%`, and token counts carry
  meaning without color.
- `Enter`/click target is keyboard-reachable through the existing focus system;
  `/usage` is documented in the command palette.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Shared pure model (framework-agnostic, one source of truth)

Extract the computation so **TUI and web share one `ContextUsage` shape**. Keep it
dependency-light: SDK types + `Intl` + a `ModelLimit` lookup. Place it where both
packages can import it (recommended: a new `packages/tui/src/context/context-usage.ts`
pure module; the web's existing `session-context-metrics.ts` /
`session-context-breakdown.ts` should be refactored to return the same shape in a
follow-up — no behavior change required for this spec).

```ts
export type ContextSourceKey = "system" | "user" | "assistant" | "tool" | "other"

export type ContextUsage = {
  provider: string
  model: string
  limit: number | undefined            // model.limit.context
  usable: number | undefined           // compaction threshold (limit - reserved)
  thresholdPct: number | null          // usable / limit * 100
  autoCompact: boolean                 // compaction.auto !== false

  // live projection of current window fill (preferred signal):
  projected: number | undefined
  projectedPct: number | null
  // fallback last-turn signal (current web behavior):
  lastTurnTotal: number
  lastTurnPct: number | null

  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
  lastActivity: number | undefined
  sources: Array<{ key: ContextSourceKey; tokens: number; pct: number }>
}

export function getContextUsage(args: {
  session: SessionV2Info
  messages: SessionMessage[]
  modelLimit: { context: number; input?: number } | undefined
  reserved: number
  autoCompact: boolean
}): ContextUsage
```

- `projected` = Σ of the `sources` estimate (reuse `estimateSessionContextBreakdown`
  from `session-context-breakdown.ts`, the same `~4 chars/token` heuristic), so the
  meter reflects the *current* window rather than only the last turn.
- `lastTurnPct` preserves today's behavior (`lastAssistantWithTokens` /
  `tokenTotal`) as a fallback when projection is unavailable.
- `usable`/`thresholdPct` mirror `overflow.usable()` (overflow.ts:10-20):
  `limit.context - min(reserved, maxOutputTokens)`.

### 5.2 TUI state + hook

In `packages/tui/src/context/data.tsx` store, no new field is required: the meter
reads `session.info[id]` (totals + cost), `session.message.list(id)` (per-message
+ parts for the source estimate), and `location.model.list()` (after the §5.4 SDK
enrichment). Add a thin selector:

```ts
// packages/tui/src/context/context-usage.ts
export function useContextUsage(sessionID: string) {
  const data = useData()
  const local = useLocal()
  return createMemo(() => {
    const session = data.session.get(sessionID)
    if (!session) return undefined
    const limit = /* modelLimit from location.model.list() via local.model.parsed() */
    return getContextUsage({
      session,
      messages: data.session.message.list(sessionID) ?? [],
      modelLimit: limit,
      reserved: COMPACTION_BUFFER,            // 20_000, overflow.ts:8
      autoCompact: !Flag.OTTILI_CODER_DISABLE_AUTOCOMPACT,
    })
  })
}
```

`reserved`/`maxOutputTokens` may need to be exposed (see §5.4); until then default
to `COMPACTION_BUFFER`.

### 5.3 Components (small, reusable)

1. **`<ContextUsageMeter api sessionID />`**
   (`packages/tui/src/component/context-usage-meter.tsx`): pure presentation of the
   bar + % + threshold tick + compact token/cost/cache per §4.1/§4.3. Registered
   into `SessionHeaderStrip` (header-strip.tsx:47-49), left of the `sidebar` hint.
   Color via `useTheme()` tokens — no new colors.
2. **`<ContextUsageDialog>`**
   (`packages/tui/src/component/context-usage-dialog.tsx`): detail view reusing
   existing dialog primitives; shows limit / usable / threshold%, last-turn
   breakdown (input/output/reasoning/cache read+write), cost, and the source
   distribution bar (system/user/assistant/tool/other) colored with theme tokens
   (`info`/`success`/`primary`/`warning`/`textMuted`).
3. **`/usage` slash command** in `index.tsx` (parallel to `/cost`, 1126) opening
   `ContextUsageDialog`.

Reuse, do not duplicate: existing dialog primitives, `BrandLabel`/`ThemeModeLabel`
adjacent atoms, `useTheme()` palette, and the web's `getContextUsage` model.

### 5.4 Backend / SDK dependency (documented, not implemented here)

The TUI cannot render `%` or the threshold until it knows `limit.context`.

- Enrich `ModelV2Info` (or the location model endpoint / session info) with
  `limit: { context: number; input?: number }` and `maxOutputTokens` (for the
  `reserved` cap). Regenerate the JS SDK (`./packages/sdk/js/script/build.ts`).
- Optionally surface `compaction` summary on `SessionV2Info`
  (`{ auto, prune, reserved, thresholdPct }`) computed server-side from `overflow.usable()`,
  so the TUI does not have to re-derive `reserved`/`maxOutputTokens`.
- This is the T-CLI-0055-shaped dependency and is intentionally out of scope for
  this specification task. The web meter already works (it gets limits from the
  server sync store) and is unaffected.

### 5.5 Web app + desktop

- Web: extend the `SessionContextUsage` tooltip with cache read/write, reasoning,
  and a `compaction at X%` note; reuse the shared `getContextUsage` model. Desktop
  inherits automatically (Electron wrapper around the web app).

---

## 6. Removing OpenCode UX Assumptions

- **Meter is first-class, not a hidden hover button.** Promote it to a persistent
  header element in the TUI and enrich the web tooltip; stop treating context
  pressure as something you must discover via hover or `/cost`.
- **`usage` is labeled correctly.** Distinguish "last-turn fill" (today) from
  "projected current window fill" (target). Do not present the last-turn proxy as
  the literal live window occupancy.
- **Model limits are a TUI concern.** The OpenCode-derived `ModelV2Info` omitted
  context limits from the TUI; the redesign makes them required for the meter.
- **No OpenCode-branded copy.** Branding is already Ottili. Source of color remains
  the Ottili theme palette; Claude Code is a layout/density reference only.
- Keep `SessionV2Info.tokens` / `AssistantMessage.tokens` wire-compatible; extend
  the *model* info, not the session message contract.

---

## 7. Feature Flag

Gate the new TUI meter + dialog + `/usage` command behind:

```ts
EVOLUTION_T_CLI_0148_TUI_REDESIGN_CONTEXT_USAGE_METER__I_ENABLED = false
```

Use the existing `Flag` mechanism (`@opencode-ai/core/flag/flag`, already imported
across the TUI). Default `false`; enable after staging validation. When off, TUI
behavior is identical to today (no meter; `/cost` only).

---

## 8. Edge Cases / States

- **No model limit known** (`limit` undefined / 0): `projectedPct`/`lastTurnPct` =
  `null`; render `—`, no threshold tick, no threshold color. (Web already returns
  `usage: null`, metrics.ts:75.)
- **Fresh session (no assistant messages):** `context` undefined; meter shows
  `0%` / empty bar; dialog shows "No activity yet".
- **Auto-compact disabled** (`OTTILI_CODER_DISABLE_AUTOCOMPACT`): threshold tick
  hidden; bar still shows usage; auto-compaction will not fire.
- **Loading** (before first `session.info` resolves): render nothing / `—`; never
  a spinner in the header.
- **Error fetching:** keep last-known `ContextUsage`; do not blank the meter.
- **Very large numbers:** `Intl.NumberFormat` (web) / locale formatter (TUI) — same
  as `createSessionContextFormatter`.
- **Long branch/model names in header:** truncate before width-based segment drop
  (§4.3 order).
- **Concurrent session switches:** `useContextUsage` keyed by `sessionID`; reset to
  `undefined` on switch to avoid stale cross-session data.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a render test for `<ContextUsageMeter>`
  covering full / compact / minimal widths and clean / near-threshold / over-
  threshold / no-limit states; add a unit test for `getContextUsage`).
- `bun run --cwd packages/ottili-coder typecheck` (backend `SessionV2Info`
  compaction summary, if added).
- `./packages/sdk/js/script/build.ts && git diff --check`
- `bun run lint`
- Manual: `tmux` TUI smoke at 3 widths; web header tooltip + context tab; desktop
  web app inherits.

---

## 10. Open Questions (for human review)

1. Should the header meter use the **projected** window fill or keep the **last-turn**
   proxy as primary? Recommend projected (sources estimate), last-turn as fallback.
2. Threshold tick position: derive client-side from `COMPACTION_BUFFER` (20k) or
   surface `thresholdPct` from the backend `SessionV2Info`? Recommend backend
   summary to also capture `maxOutputTokens`.
3. Glyph set (`▓ ░ |↑ ⚡`): confirm render in target terminals; ASCII fallback
   (`[=]` / `[!]`) if needed.
4. Should `/cost` be deprecated in favor of `/usage`, or kept as a parity alias?
