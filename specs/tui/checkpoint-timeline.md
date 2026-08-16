# TUI Redesign — Checkpoint Timeline

## Task

- **Task ID**: `96880990-f430-47f9-ab11-35d4270399aa`
- **Title**: T-CLI-0164 — TUI redesign: Checkpoint timeline — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055 (redesign scaffolding)
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the cairn-data exposure is a documented dependency.

---

## 1. Goal

Define the exact interaction model for the **Checkpoint timeline** in Ottili
Coder: decisions, milestones, validations, failures, and resume points. Map
current components and state, remove obsolete OpenCode UX assumptions, and design
the smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`). No pixel-copy of proprietary artwork or brand assets.

The Checkpoint timeline is the **user-visible** surface for the Cairn execution
doctrine. Today Cairn checkpoints exist only as agent-written markdown on disk;
this spec makes them navigable, scannable, and actionable inside the TUI (and, by
shared contract, the web app / desktop).

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 Cairn checkpoint domain (`packages/ottili-coder/src/cairn/`)

- `Checkpoint.Service` (`checkpoint.ts:37`) is the single source of truth. Its
  `read`/`write` round-trip `CheckpointState` through `CHECKPOINT.md`
  (`checkpoint.ts:149-158`).
- `CheckpointState` (`checkpoint.ts:15-23`) is:
  ```ts
  { mode, goal,
    milestones: Milestone[],
    currentMilestone: string | undefined,
    nextAction: string | undefined,
    blockers: string[],
    lastUpdated: string }
  ```
- `Milestone` (`checkpoint.ts:9-13`):
  `{ title, status: "pending" | "in_progress" | "completed" | "blocked", notes? }`.
- `serializeCheckpoint` (`checkpoint.ts:43-73`) emits markdown: a header, a
  `## Milestones` list with `[x]`/`[ ]` checkboxes, then `## Current Milestone`,
  `## Next Action`, `## Blockers`. `parseCheckpoint` (`checkpoint.ts:75-142`)
  reads it back (best-effort: returns `undefined` when there is neither a goal
  nor any milestone).
- Append-only logs are written by the service into **separate** files
  (`checkpoint.ts:196-222`):
  - `appendValidation(sessionID, command, result)` → `VALIDATION_LOG.md` (a
    `## <ISO>` block with `**Command:**` + a fenced `result`).
  - `appendDecision(sessionID, decision, rationale)` → `DECISIONS.md`
    (`## <ISO>`, `**Decision:**`, `**Rationale:**`).
  - `appendKnownProblem(sessionID, problem, severity, unblock)` →
    `KNOWN_PROBLEMS.md` (`## <ISO>`, `**Severity:**`, `**Problem:**`,
    `**Unblock:**`).
- `updateMilestone` / `addMilestone` / `setNextAction` mutate `CHECKPOINT.md`.
- `recoveryHint(sessionID)` (`checkpoint.ts:230-247`) builds a
  `[CAIRN RECOVERY — context was compacted, reconstructing state]` summary from
  completed/remaining milestones, current milestone, next action, and blockers.

### 2.2 Persistence (`packages/ottili-coder/src/cairn/session-memory.ts`)

- Files live under `Global.Path.state/cairn/<sessionId>/`
  (`session-memory.ts:44-50`). `CHECKPOINT_FILES`
  (`session-memory.ts:9-17`) = `CHECKPOINT.md`, `VALIDATION_LOG.md`,
  `KNOWN_PROBLEMS.md`, `DECISIONS.md`, `NEXT_ACTIONS.md`, `HINTS.md`,
  `WORKTIME.json`.
- The store is `resolve` / `ensure` / `read` / `write` / `append` / `exists` /
  `list` (`session-memory.ts:32-40`). It is a **filesystem store only** — there
  is no HTTP route, no SDK client method, and no in-memory event that exposes any
  of these files. Grep across `packages` confirms **zero** consumers in
  `packages/tui`, `packages/app`, or `packages/desktop`.

### 2.3 Where it is actually used

- The doctrine instructs the **agent** to maintain `CHECKPOINT.md`
  (`cairn/doctrine.txt:27,87,93`; `session/execution-doctrine.txt:25,58,63`).
- The **only** runtime consumer is the prompt loop: after context compaction,
  `recoveryHint` is injected so the agent can reconstruct state
  (`packages/ottili-coder/src/session/prompt.ts:1365-1368`).
- **Net current behavior for the user:** there is **no** in-product view of
  Cairn checkpoints. A user who wants to see decisions/milestones/validations/
  failures/resume points must open the markdown files by hand under
  `~/.local/state/ottili-coder/cairn/<sessionId>/` (or the platform equivalent).
  The agent writes them; nothing renders them.

### 2.4 Existing TUI "timeline" (unrelated to Cairn)

- `packages/tui/src/routes/session/dialog-timeline.tsx` and
  `dialog-fork-from-timeline.tsx` are the **conversation / message timeline**
  (fork-from-history), not Cairn. The web app's `packages/app/e2e/.../
  session-timeline.*` tests exercise the same message timeline. None of these
  touch `CHECKPOINT.md` / `DECISIONS.md` / `VALIDATION_LOG.md` /
  `KNOWN_PROBLEMS.md`.
- The TUI's only session-health surfaces today are `SessionHeaderStrip`
  (`header-strip.tsx`) and the `/cost` + `/status` dialogs. None surface
  checkpoint state.

### 2.5 Branding & palette

- Branding is already Ottili (`BrandLabel` renders `✻ Ottili Coder`; `logo.ts` is
  Ottili block art). "Cairn" is Ottili's own execution-doctrine name, **not**
  OpenCode branding — it is retained.
- TUI theme semantic tokens (`packages/tui/src/theme/index.ts`): `primary`
  (cyan, 411), `secondary` (magenta, 412), `accent` (cyan, 413), `error` (red,
  416), `warning` (yellow, 417), `success` (green, 418), `info` (cyan, 419),
  `text`, `textMuted` (423), `borderSubtle`/`border`/`borderActive` (433-435),
  `backgroundPanel`/`backgroundElement`/`backgroundMenu` (428-430), plus markdown
  and syntax colors. **No new color is introduced anywhere in this spec.**

---

## 3. Gaps

1. **No user-facing checkpoint timeline exists.** Cairn checkpoints are an
   agent-only filesystem artifact; the user cannot see decisions, milestones,
   validations, failures, or resume points in-product.
2. **No data path to the TUI/app.** There is no HTTP endpoint, no SDK client
   method, and no event exposing the cairn files. The TUI cannot read them today.
3. **No resume-point visibility.** `nextAction` and the post-compaction
   `recoveryHint` are injected into the agent prompt only; the human never sees
   the current resume point at a glance.
4. **No failure/validation history UI.** `KNOWN_PROBLEMS.md` (severity +
   unblock) and `VALIDATION_LOG.md` (command + result) are invisible, so the
   user cannot review what was tried and what is still blocking.
5. **No milestone progress signal.** `milestones[]` completion has no header or
   status-line representation.
6. **OpenCode UX assumption: checkpoints are internal recovery scaffolding.**
   Upstream treated checkpoint files as private agent memory. The redesign
   promotes them to a first-class, human-navigable timeline — this assumption is
   removed by design.
7. **OpenCode data assumption: `CHECKPOINT.md` is the whole story.** Today the
   structured snapshot is the only first-class artifact; the append-only logs
   (decisions/validations/known-problems) carry the actual *timeline* and are
   treated as secondary. The redesign makes the append-only logs the spine of
   the timeline and `CHECKPOINT.md` the "current state" header.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

Two surfaces, both optional behind the feature flag (§7):

**(A) Compact status indicator** — a small, always-available signal in the
session sidebar footer (reusing the `home/sidebar` footer slot, same family as
the existing git-status / context-meter widgets). Full-density layout (≥ 80
cols):

```text
✓ 3/5 milestones · 2 decisions · 1 failure · ↩ resume: run integration tests
```

Order and meaning:

| Segment | Meaning | Source | When shown | Accent (Ottili palette) |
| --- | --- | --- | --- | --- |
| `✓ 3/5` | completed / total milestones | `checkpoint.milestones` | always (or `· 0` when none) | `success`; `warning` if any `blocked`/`in_progress` |
| `2 decisions` | count of `DECISIONS.md` entries | parsed log | ≥ 1 | `info` |
| `1 failure` | count of `KNOWN_PROBLEMS.md` entries | parsed log | ≥ 1 | `error` |
| `↩ resume: …` | current next action (truncated) | `checkpoint.nextAction` | present & ≥ 60 cols | `textMuted` |

When a session has **no** checkpoint yet, the indicator renders `· no checkpoint`
(`textMuted`) — never a "clean" badge, matching Claude Code density (no noise
when nothing to report).

**(B) Full `/checkpoint` dialog** — opens the chronological timeline. Layout:

```text
Goal: Implement session recovery after compaction
Mode: build · Updated: 2026-07-14 13:49

Current milestone: wire resume handler
Next action:      run integration tests
Blockers:         (none)

TIMELINE  (newest first)            f: filter · ↑/↓ move · ⏎ expand · c copy · Esc close
─────────────────────────────────────────────────────────────
⌁ 13:51  validation   bun test → PASS (1m12s)
✓ 13:40  milestone    "wire resume handler" → completed
⊘ 13:22  failure      severity high — flaky DB teardown (unblock: retry w/ txn)
◆ 13:05  decision     cache recoveryHint at compaction boundary
▸ 12:48  milestone    "add CHECKPOINT.md parser" → in_progress
↩ 12:30  resume       next action set: run integration tests
```

A **timeline event** is one row. Event kinds and their glyphs/accents:

| Kind | Glyph | Accent | Source |
| --- | --- | --- | --- |
| `milestone` (added / status change / completed / blocked) | `▸` running, `✓` completed, `⊘` blocked, `◆` added | `success` / `warning` / `error` | `CHECKPOINT.md` milestones |
| `decision` | `◆` | `info` | `DECISIONS.md` |
| `validation` | `⌁` | `success` (PASS) / `error` (FAIL) | `VALIDATION_LOG.md` |
| `failure` (known problem) | `⊘` | `error` (high) / `warning` (med/low) | `KNOWN_PROBLEMS.md` |
| `resume` | `↩` | `textMuted` | `CHECKPOINT.md` nextAction + post-compaction `recoveryHint` |

Color is **never** the only signal: every row carries a glyph + kind label +
text. The dialog header always shows goal / mode / current milestone / next
action / blockers regardless of width.

### 4.2 Interaction

- Add a `/checkpoint` slash command parallel to `/cost`
  (`routes/session/index.tsx:1136-1146`). `run` does
  `dialog.clear(); dialog.replace(() => <CheckpointTimelineDialog sessionID={route.sessionID} />)`
  — exactly the existing `DialogCostUsage` pattern. `/cost` is retained.
- Inside the dialog:
  - `↑`/`↓` (or `j`/`k`) move focus between timeline rows; the focused row is
    prefixed `> ` and highlighted with `theme.primary`.
  - `Enter` / `Space` expands/collapses the focused row's detail (full command,
    result fence, rationale, severity/unblock).
  - `f` toggles a type filter (cycle: all → milestones → decisions →
    validations → failures → resume → all), shown in the footer.
  - `c` copies the current **resume point** (`nextAction` + recovery hint) to the
    clipboard via the existing clipboard context (`context/clipboard.tsx`).
  - `Esc` closes (reuse existing `Dialog` `onClose={dialog.clear}`).
  - No write actions — the timeline is **read-only**; the agent owns the files.
- The compact indicator is an **actionable control**: `Enter` / click opens the
  same `CheckpointTimelineDialog`.
- Keyboard accelerators documented in the command palette / which-key overlay.

### 4.3 Terminal-width behavior

| Width | Rendered |
| --- | --- |
| ≥ 100 | full: header + timestamps (`HH:MM`) + kind + summary + inline detail on expand |
| 60–99 | drop absolute timestamps → relative (`12m ago`); keep kind + summary |
| 40–59 | drop relative time; glyph + one-line summary only |
| < 40 | indicator-only (counts in the sidebar); dialog still opens but renders single-column summaries |

Truncation is right-to-left: drop detail → time → kind-label (keep glyph +
summary last). The dialog uses OpenTUI flex with `flexShrink={0}` on the chrome
and a `flexGrow` spacer; long goal/next-action text wraps, never overflows.

### 4.4 Accessibility

- Each row is a `<text>` with an explicit spoken form via Solid `title`/`role`
  where OpenTUI supports it, e.g.
  `aria-label="13:51 validation, bun test, passed in 1 minute 12 seconds"`.
- Color is never the only signal: glyph + kind label + text carry meaning.
- `↑/↓`/`Enter`/`Esc`/`f`/`c` are keyboard-reachable; `/checkpoint` is in the
  command palette. A persistent `accessibleSummary` text (like
  `context-meter` `index.tsx:154-156`) states milestone counts, decision count,
  failure count, and the resume point for screen readers.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Shared pure model (framework-agnostic parsers + selectors)

Extract the parsing/selection so the TUI (and later the web app) share one
`CheckpointTimeline` shape. Place the TUI-local pure module at
`packages/tui/src/component/checkpoint-timeline/model.ts` (same split as the
recent `context-meter/model.ts` + `index.tsx` and `cost-usage/model.ts` +
`index.tsx`).

```ts
export type CheckpointEventKind =
  | "milestone" | "decision" | "validation" | "failure" | "resume"

export type CheckpointEvent = {
  id: string                      // stable: `${kind}:${index}:${timestamp}`
  kind: CheckpointEventKind
  timestamp: string | undefined  // ISO from the append-log header, or undefined
  title: string                  // human summary (milestone title / command / problem)
  detail: string | undefined     // full result / rationale / unblock / notes
  status?: "pass" | "fail" | "pending" | "in_progress" | "completed" | "blocked"
  severity?: "low" | "medium" | "high"
}

export type CheckpointTimelineState = {
  exists: boolean
  goal: string
  mode: string
  currentMilestone: string | undefined
  nextAction: string | undefined
  blockers: string[]
  lastUpdated: string | undefined
  events: CheckpointEvent[]       // newest-first
  status: "empty" | "populated" | "loading" | "degraded" | "failure"
  accessibleSummary: string
}

export function parseCheckpointTimeline(args: {
  checkpoint: string | undefined   // raw CHECKPOINT.md
  decisions: string | undefined    // raw DECISIONS.md
  validations: string | undefined  // raw VALIDATION_LOG.md
  knownProblems: string | undefined// raw KNOWN_PROBLEMS.md
}): CheckpointTimelineState
```

- Reuse `parseCheckpoint` (`checkpoint.ts:75`) for `CHECKPOINT.md`; add three
  small block parsers (each append-log file is `## <ISO>\n**Key:** value\n…`,
  symmetric with the writers at `checkpoint.ts:196-222`). Parse validation
  `result` to `pass`/`fail` by scanning for `FAIL`/non-zero exit cues; leave
  `status` undefined when ambiguous rather than guessing.
- `events` is built by merging milestones (one event per *status change* emitted
  by the agent, or one event per milestone when only the snapshot is available)
  + every decision/validation/failure row + a synthetic `resume` event from
  `nextAction` (and from the latest `recoveryHint` if surfaced by the backend).
  Sort newest-first by `timestamp`, falling back to file order.
- `accessibleSummary` mirrors the `context-meter` pattern
  (`context-meter/model.ts:455`): `"3 of 5 milestones complete, 2 decisions, 1 failure, resume: …"`.

### 5.2 TUI state + hook

No new field is required in the persistent store (`context/data.tsx`). The
timeline is **fetched lazily** when the dialog/indicator is shown, keeping the
session store free of cairn concerns:

```ts
// packages/tui/src/context/checkpoint.ts
export function useCheckpointTimeline(sessionID: string) {
  const sdk = useSDK()
  return createResource(
    () => sessionID,
    async (id) => (await sdk.client.cairn.get({ sessionID: id }, { throwOnError: true })).data,
  )
}
```

- `useCheckpointTimeline` is keyed by `sessionID`; on session switch the resource
  resets to `undefined` (no stale cross-session data).
- While loading → `status: "loading"`; on fetch error → `status: "degraded"` and
  keep last-known state (do not blank). See §8.

### 5.3 Components (small, reusable)

1. **`<CheckpointTimeline>`**
   (`packages/tui/src/component/checkpoint-timeline/index.tsx`): presentation
   only — follows the `ContextMeter` shape (`context-meter/index.tsx`):
   `useTerminalDimensions`, `useKeyboard` (↑/↓/Enter/Space/f/c/Esc), focus index,
   `useTheme()` palette tokens (no new colors), and an `accessibleSummary`
   `<text>`. Renders header + `For` over `state().events` with per-kind glyph/
   accent (`colorFor` switch like `context-meter/index.tsx:51-67`).
2. **`<CheckpointTimelineDialog>`**
   (`packages/tui/src/component/checkpoint-timeline/dialog.tsx`): wraps
   `<CheckpointTimeline>` in the existing `Dialog` (`ui/dialog.tsx`),
   `dialog.setSize("large")`, `onClose={dialog.clear}`; wires `useCheckpointTimeline`.
3. **`<CheckpointStatusIndicator>`**
   (`packages/tui/src/component/checkpoint-timeline/indicator.tsx`): the compact
   `✓ 3/5 · 2 decisions · 1 failure · ↩ resume` line for the sidebar footer;
   `Enter`/click opens the dialog.
4. **`/checkpoint` slash command** in `routes/session/index.tsx` (parallel to
   `/cost`, `index.tsx:1136-1146`), gated by the flag (§7), opening
   `CheckpointTimelineDialog`.

Reuse, do not duplicate: existing `Dialog` primitives, `useDialog`
(`ui/dialog.tsx`), `useTheme()` palette, the `clipboard` context
(`context/clipboard.tsx`), and the `context-meter` focus/a11y pattern.

### 5.4 Backend / SDK dependency (documented, not implemented here)

The TUI cannot render the timeline until it can read the cairn files.

- Add a read-only surface, e.g. `GET /instance/cairn/:session` returning
  `{ checkpoint, decisions, validations, knownProblems, nextActions, worktime }`
  (the raw file contents or parsed blocks), and a `sdk.client.cairn.get`
  client method. Regenerate the JS SDK:
  `./packages/sdk/js/script/build.ts`.
- Optionally emit a `cairn.updated` event when any `CHECKPOINT_FILES` entry
  changes, so the dialog can refresh live; until then poll on open + a
  low-frequency interval (gated by the flag).
- This is the **T-CLI-0055-shaped dependency** and is intentionally out of scope
  for this specification task. The agent's *writing* of checkpoints is untouched
  (wire-compatible `serializeCheckpoint`/`parseCheckpoint` preserved); only a
  read path is added.

### 5.5 Web app + desktop

- Fetch the same `sdk.client.cairn.get` payload in `packages/app`; add a
  **Checkpoint** tab/section in the session review panel (parallel to the
  existing Context tab), reusing the shared `parseCheckpointTimeline` model.
- Desktop inherits automatically (Electron wrapper around the web app).

---

## 6. Removing OpenCode UX Assumptions

- **Checkpoints are first-class, not private agent memory.** Promote them to a
  user-navigable timeline + status indicator; stop treating `CHECKPOINT.md` as
  something only the agent reads.
- **The append-only logs are the timeline spine.** `DECISIONS.md` /
  `VALIDATION_LOG.md` / `KNOWN_PROBLEMS.md` carry the *chronology*;
  `CHECKPOINT.md` is the "current state" header. Do not present the snapshot as
  the whole story.
- **Resume points are user-visible.** Surface `nextAction` + post-compaction
  `recoveryHint` as explicit `resume` events, not just injected prompt text.
- **No OpenCode-branded copy.** "Cairn" is Ottili's own doctrine name and is
  retained. Source of color remains the Ottili theme palette; Claude Code is a
  layout/density reference only.
- Keep `CheckpointState` / the cairn file format wire-compatible; extend the
  *read* path (SDK/HTTP), not the write contract.

---

## 7. Feature Flag

Gate the indicator + dialog + `/checkpoint` command behind:

```ts
EVOLUTION_T_CLI_0164_TUI_REDESIGN_CHECKPOINT_TIMELINE__I_ENABLED = false
```

Use the existing `Flag` mechanism (`@opencode-ai/core/flag/flag`, already
imported across the TUI — `app.tsx:5`, `ui/dialog.tsx:7`, `context/sdk.tsx:3`,
`component/prompt/index.tsx:17`). Default `false`; enable after staging
validation. When off, behavior is identical to today: no indicator, no
`/checkpoint` command, no dialog (Cairn checkpoints remain agent-only files).

---

## 8. Edge Cases / States

- **No checkpoint yet** (`CHECKPOINT.md` absent / `parseCheckpoint` → `undefined`):
  `exists = false`; indicator shows `· no checkpoint`; dialog shows
  "No checkpoint yet for this session". No crash.
- **Partial files** (e.g. only `DECISIONS.md` exists): merge whatever is present;
  missing files → empty arrays, no crash.
- **Loading** (fetch in flight): `status: "loading"`; render
  `↻ loading checkpoint…` skeleton; never a blocking spinner.
- **Error fetching:** `status: "degraded"`; keep last-known timeline; show
  `≈ stale` warning; do not blank.
- **Long goal / next-action text:** wrap/truncate with ellipsis; preserve
  focusability and the `accessibleSummary`.
- **Very long decision/validation detail:** collapsed by default with `▸`
  expand (see §4.2); cap initial render height.
- **Concurrent session switches:** `useCheckpointTimeline` keyed by `sessionID`;
  reset to `undefined` on switch to avoid stale cross-session data.
- **Terminal too narrow for detail:** degrade per §4.3 (drop time → kind →
  detail, keep glyph + summary).
- **Color-blind / no-color terminal:** glyphs + kind labels + text carry all
  meaning; `detectNoColor` (used by `context-meter/model.ts:8`) falls back
  gracefully.
- **Legacy sessions with no `cairn/` dir:** treat as "no checkpoint" (§ above).

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a render test for `<CheckpointTimeline>`
  covering full / compact / minimal widths and empty / loading / error / full
  states; add a unit test for `parseCheckpointTimeline` + the three append-log
  parsers, including partial-file and ambiguous-validation cases)
- `bun run --cwd packages/ottili-coder typecheck` (backend `cairn.get` route, if
  added)
- `./packages/sdk/js/script/build.ts && git diff --check`
- `bun run lint`
- Manual: `tmux` TUI smoke at 3 widths (open `/checkpoint`, filter, expand,
  copy); web Checkpoint tab; desktop web app inherits.

---

## 10. Open Questions (for human review)

1. Should "failures" be sourced **only** from `KNOWN_PROBLEMS.md`, or also fold
   in tool/command errors already in the message timeline? Recommend
   `KNOWN_PROBLEMS.md` + validation-result parsing for the first cut.
2. Should the timeline include **auto-generated** post-compaction `recoveryHint`
   as a `resume` event, or only the explicit `nextAction`? Recommend both,
   clearly labeled (e.g. `↩ resume (auto, after compaction)`).
3. Live refresh: new `cairn.updated` event vs low-frequency polling. Recommend
   the event when available, polling as the flag-gated fallback.
4. Glyph set (`✓ ▸ ⊘ ◆ ⌁ ↩`): confirm render in target terminals; ASCII
   fallback (`[x]`/`[ ]`/`!`/`*`/`` ` ``/`<-`) if needed.
5. Indicator placement: session **sidebar footer** (recommended, near other
   session meta) vs the session **header strip**. Recommend sidebar footer to
   avoid crowding the header.
6. Should `/cost` be kept as the parity alias once `/checkpoint` lands, or
   deprecated? Out of scope here; noted for the implementation follow-up.
