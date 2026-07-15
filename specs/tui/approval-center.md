# TUI Redesign — Approval Center

## Task

- **Task ID**: `472cc9de-a1f3-4561-841c-db71ef490e44`
- **Title**: T-CLI-0168 — TUI redesign: Approval center — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI footer + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the SDK `PermissionRequest` enrichment for grouped effect preview is a documented dependency.

---

## 1. Goal

Define the exact interaction model for the **Approval center** in Ottili Coder: a
single, keyboard-first surface that shows **all pending protected actions** for the
current session (and its subagents), lets the user inspect each action's
**detail, diff/effect preview**, and take a **decision** (allow once / allow always /
reject) — with optional bulk triage.

Map the current components and state, remove obsolete OpenCode UX assumptions, and
design the smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`, `packages/ottili-coder/src/cli/cmd/run/theme.ts`). No
pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 CLI / TUI footer (the only shipped interactive approver)

- The footer is a **single-active-view** surface. `FooterView` is
  `{ type: "prompt" } | { type: "permission"; request } | { type: "question"; request }`
  (`packages/ottili-coder/src/cli/cmd/run/types.ts:173-177`). Only **one** permission
  is ever shown at a time.
- Selection is first-in-queue only. `pickSessionView` (`session-data.ts:243-248`)
  calls `pickBlockerView({ permission: data.permissions[0], … })`, which returns
  `{ type: "permission", request: data.permissions[0] }` (`session-data.ts:219-229`).
  The agent loop is **blocked** until that one request is answered.
- The permission queue itself holds **many**:
  `SessionData.permissions: PermissionRequest[]` (`session-data.ts`), populated on
  `permission.asked` (`session-data.ts:1056-1063`) via `enrichPermission`
  (`session-data.ts:314-336`), drained on `permission.replied`
  (`session-data.ts:1065-1072`). Multiple parallel tools/subagents queue but are
  shown **serialized**.
- The renderer is `RunPermissionBody`
  (`footer.permission.tsx:133-482`) driven by a pure three-stage state machine in
  `permission.shared.ts`:
  - `permission` → buttons **Allow once / Allow always / Reject**
    (`permission.shared.ts:80-90`, labels `permissionLabel` 137-143).
  - `always` → confirmation (`Confirm / Cancel`) showing `permissionAlwaysLines`
    (`permission.shared.ts:126-135`) — "allow `<permission>` until Ottili Coder is
    restarted" (or the listed patterns).
  - `reject` → text field (`RejectField`, `footer.permission.tsx:69-131`) with
    placeholder "Tell Ottili Coder what to do differently".
- **Diff/effect preview**: `permissionInfo` (`permission.shared.ts:92-124`) delegates
  to `toolPermissionInfo` (`tool.ts:1344`), which returns a `ToolPermissionInfo`
  (`tool.ts:68-74`) `{ icon, title, lines, diff?, file? }`. The body shows the diff
  via the shared `<diff view="unified">` component when present, else `lines`
  (`footer.permission.tsx:356-408`). `permEdit` carries a unified `diff` string
  (`tool.ts:922-932`); `permBash` shows `$ command` (`tool.ts:970-978`); read/glob/
  grep/list show path/pattern; `external_directory` and `doom_loop` are special-cased
  (`permission.shared.ts:100-117`).
- **Keyboard** (`footer.permission.tsx:215-258`): `tab` / `←` `h` / `→` `l` cycle the
  selected option; `return` confirms the selected option; `escape` rejects (or backs
  out of `always`/`reject`). While `submitting`, all nav keys are swallowed.
- **Height**: fixed `PERMISSION_ROWS = 12` (`footer.ts:103`); `applyHeight`
  (`footer.ts:696-722`) adds it to `base`.
- **Width**: `footerWidthPolicy(dims().width).dialog.narrow` (`footer.permission.tsx:144`,
  `footer.width`) flips the action bar / reject bar to a vertical stack when narrow.
- Subagents surface pending permissions as a **blocker tab** only: `ensureBlockerTab`
  sets the subagent tab description to "Pending permission" (`subagent-data.ts:434-473`),
  and `listSubagentPermissions` flattens them (`subagent-data.ts:645-646`) — but the
  footer still renders just the **main-session** `data.permissions[0]`, so a subagent
  approval blocks the whole footer without a dedicated view (`subagent-data.ts` +
  `stream.transport.ts:103-106`).

### 2.2 Web app (parallel single-request approver)

- `SessionPermissionDock` (`packages/app/src/pages/session/composer/session-permission-dock.tsx`)
  renders one pending request inside a `DockPrompt` in the composer region. Buttons:
  **deny / allow always / allow once** (i18n `ui.permission.*`, lines 37-50). Shows a
  tool description (`settings.permissions.tool.<name>.description`) and the raw
  `patterns` (lines 62-71). No diff/effect preview is rendered in the dock.
- Selection is again **one-at-a-time**: `sessionPermissionRequest` walks the session
  tree and returns the first pending request (`session-request-tree.ts:36-43`,
  `sessionTreeRequest` 3-34). `session-composer-state.ts:38-47` exposes it as a single
  `permissionRequest()` memo.
- Separate `PermissionProvider` (`packages/app/src/context/permission.tsx`) handles
  **directory-level auto-accept** (`enableAutoAccept`, `isAutoAcceptingDirectory`,
  `toggleAutoAcceptDirectory`) — the OpenCode "always allow in this directory" concept,
  persisted via `Persist.serverGlobal(..., "permission", ["permission.v3"])`.

### 2.3 Desktop

- `packages/desktop` has **no approval UI**. Only Electron renderer permissions
  (`clipboard-sanitized-write`, `notifications`) are granted at window creation
  (`windows.ts:356-365`). The desktop wrapper embeds the web app, so it inherits the
  web `SessionPermissionDock` unchanged.

### 2.4 Data contract (SDK)

- `PermissionRequest` (`node_modules/@opencode-ai/sdk/src/v2/gen/types.gen.ts:2537-2550`):
  `{ id, sessionID, permission: string, patterns: string[], metadata: Record<string,unknown>,
  always: string[], tool?: { messageID, callID } }`.
- `PermissionReply` (`types.ts:283` = `OttiliCoderClient["permission"]["reply"]` arg):
  `{ requestID, reply: "once" | "always" | "reject", message? }`
  (assembled by `permissionReply`, `permission.shared.ts:145-151`).
- `always: string[]` is the set of patterns granted for "allow always"; `["*"]` means
  every pattern of that tool (`permissionAlwaysLines`, `permission.shared.ts:127-129`).

### 2.5 Branding & palette

- Ottili branding is already in place in the permission UI ("Tell Ottili Coder what to
  do differently", `footer.permission.tsx:104`).
- TUI theme semantic tokens (`packages/tui/src/theme/index.ts:38-54`,
  `packages/ottili-coder/src/cli/cmd/run/theme.ts:407-439`): `primary`/`accent` = cyan,
  `error` = red, `warning` = yellow, `success` = green, `info` = cyan, `textMuted`,
  `border`/`borderSubtle`, `surface`, `pane`, `line`; diff tints `diffAdded` (green) /
  `diffRemoved` (red). The permission body already uses `warning` for the header glyph
  and `error` for the reject stage (`footer.permission.tsx:279`).

---

## 3. Gaps

1. **No centralized view of pending actions.** Both CLI and web render exactly one
   request at a time. A session with several queued tools or parallel subagents yields a
   serial, blocking experience; the user cannot see the *size* of the pending queue or
   triage it. This is the core gap the Approval center closes.
2. **No "center" surface.** There is no command, panel, or route to open a persistent
   list of pending protected actions. Approvals are only reachable when the agent blocks.
3. **Diff/effect preview is per-request and ephemeral.** You cannot open multiple pending
   diffs side by side, nor jump between them; the `<diff>` only shows for the single
   blocking request. Effect preview (e.g., bash `$ command`) is plain text, not grouped
   with file edits.
4. **Subagent approvals are second-class.** `ensureBlockerTab` marks a subagent tab
   "Pending permission" but the footer still only renders the main-session
   `permissions[0]`, so a subagent request blocks the footer with no dedicated detail.
5. **OpenCode UX assumption: approvals are modal blockers.** Today an approval *interrupts*
   the agent loop. Claude Code exposes a dedicated, dense approver you can open and triage.
   Treating the approver as a first-class, openable **center** (not just a blocking modal)
   removes this assumption.
6. **OpenCode UX assumption: one-at-a-time serialization.** The queue already holds many
   requests; only `permissions[0]` is used. The redesign surfaces the whole queue.
7. **Keyboard/width behavior is implicit.** Today it is a fixed 12-row modal with a
   narrow-stack fallback. The center needs an explicit, documented layout/keyboard
   contract (below).

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A single **Approval center** is reachable two ways:

- **Inline blocker** (default): when the agent is blocked on a protected action, the
  footer renders the center's **queue list + focused detail** instead of today's lone
  modal. This preserves current blocking behavior while adding triage.
- **On demand**: a `/approvals` slash command (parallel to `/cost`) and a status-bar
  entry open the same center as a non-blocking panel when there is at least one pending
  action.

Layout (≥ 110 cols), two columns:

```text
 Approvals — 3 pending                                  [a] allow  [A] always  [r] reject  [↵] focus
 ───────────────────────────────────────────────────────────────────────────────────────
 ▸ Edit  src/foo.ts                  ▏  → Edit ~/src/foo.ts
 ▸ Bash  "run migrations"            ▏  $ pnpm prune && pnpm migrate
 ▸ Read  config/secrets.json         ▏  Path: ~/config/secrets.json
                                   ▏
                                   ▏  ┌ diff (unified) ────────────────
                                   ▏  │ - old line
                                   ▏  │ + new line
```

Order and meaning:

| Region | Meaning | Source | When shown | Accent (Ottili) |
| --- | --- | --- | --- | --- |
| Header `Approvals — N pending` | count + label | `permissions.length` | always (or "No pending approvals") | `warning` when N>0 else `textMuted` |
| Queue list (left) | one row per pending action | `permissions[]` | always when N>0 | selected row `highlight`; risk `warning`/`error` |
| Row icon + title | tool + target | `permissionInfo().icon/title` | always | `text`; risk glyph `warning`/`error` |
| Detail (right) | focused action's title/lines/diff | `permissionInfo()` | always when N>0 | `text`; diff uses `diffAdded`/`diffRemoved` tints |
| Action bar | decision buttons | `permissionOptions()` | always | `primary` (once), `secondary` (always), `ghost` (reject) |
| Keyboard hints | `a/A/r/↵/j/k/…` | static | always | `textMuted` |

Two layers, matching Claude Code density:

- **List (persistent when open):** every pending action with icon, title, and a risk
  glyph; the focused row is highlighted; counts shown in the header.
- **Detail (focused row):** the same title/lines/diff the current modal shows, plus the
  `always` patterns and (when relevant) the tool description. Bulk actions operate on
  the focused row; an optional `shift+A` accepts *all* "safe" pending actions.

4.1a **Risk glyphs (Ottili palette only, color is never the only signal):**

- Default (read/glob/grep/list/lsp): neutral, no glyph, `textMuted` icon.
- Write/edit/apply_patch/web* : `△` `warning` (yellow) — modifies state.
- Bash / external_directory / doom_loop: `⚠` `error` (red) — executes or escalates.
- Color is reinforced by the glyph and the text title, never color-alone.

### 4.2 Interaction

- Opening (blocking): when `data.permissions.length > 0`, `pickBlockerView` returns a
  **center** view instead of a lone permission modal. The focused row is `permissions[0]`.
- Navigation in the center:
  - `j` / `↓` / `tab` → focus next pending action.
  - `k` / `↑` / `shift+tab` → focus previous pending action.
  - `↵` → move focus into the detail/decision for the focused row (equivalent to today's
    single modal); or, when a row is already focused and a decision key is pressed, act.
  - `a` → **Allow once** the focused row (`permissionRun` once path).
  - `A` → **Allow always** the focused row (enters the existing `always` confirm stage
    for that row).
  - `r` → **Reject** the focused row (enters the existing `reject` text stage).
  - `shift+A` (opt-in bulk) → allow *all* currently pending "safe" rows (read/glob/grep/
    list/lsp) in one reply batch; unsafe rows (write/bash/external) are left for explicit
    decision. Surface a confirm line before committing.
  - `Esc` → from a row's `always`/`reject` sub-stage, back to the list; from the list
    with no focused sub-stage, close the center (non-blocking mode) or, in blocking mode,
    leave the first pending action focused (do not auto-allow).
- After a decision, the row is removed from the queue (`permission.replied`); focus moves
  to the next pending row; when the queue empties, the view falls back to `prompt`
  (blocking) or closes (on-demand).
- Reuse, do not duplicate: the existing `permission.shared.ts` state machine,
  `permissionInfo`, `permissionRun/permissionReject/permissionAlwaysLines`, and the
  shared `<diff>` renderer. The center is a **container** around the existing
  `RunPermissionBody` detail pane, not a rewrite.

### 4.3 Terminal-width behavior

| Width | Rendered |
| --- | --- |
| ≥ 110 | two-column: queue list (left ~40%) + detail/diff (right) + action bar |
| 80–109 | stack: queue list on top, detail below, action bar at bottom |
| 60–79 | list only + focused row's one-line title; drop the inline diff (open detail on `↵`) |
| < 60 | header count + focused row title + action hints; drop the list (single-action fallback, identical to today's modal) |

Truncation is right-to-left: drop the inline diff first, then the list (keep focused
row), then the action hints, preserving header + focused title last. The action bar uses
the existing `footerWidthPolicy(...).dialog.narrow` stack fallback
(`footer.permission.tsx:144`). Layout uses OpenTUI flex with `flexShrink={0}` on the
action bar and a `flexGrow` spacer before keyboard hints.

### 4.4 Accessibility

- Each queue row is a focusable element with `role`/`title` carrying the spoken form,
  e.g. `aria-label="Bash, run migrations, awaiting approval"`, and a risk description
  ("executes a command").
- Color is never the only signal: the risk glyph (`△`/`⚠`), the title text, and the
  `N pending` count all convey state without color.
- The action bar buttons keep today's `onMouseOver`/`onMouseUp` handlers
  (`footer.permission.tsx:53-58`) so mouse users can hover/click; keyboard users use
  `j/k/a/A/r/↵/Esc`.
- Decision keys are documented in the command palette / which-key overlay alongside the
  new `/approvals` command.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Shared pure model (framework-agnostic, one source of truth)

The queue is already a `PermissionRequest[]`. Add a tiny selector that the center
consumes, so TUI and (later) web share one shape. Place it next to the existing pure
state machine:

```ts
// packages/ottili-coder/src/cli/cmd/run/permission-center.ts  (NEW, pure)
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { permissionInfo, type PermissionInfo } from "./permission.shared"
import type { PermissionReply } from "./types"

export type ApprovalRisk = "read" | "write" | "execute"

// Risk tiers the center uses for glyph + bulk-safety (§4.1a). Keep this list
// explicit; do not infer from free-text titles.
const SAFE_PERMISSIONS = new Set([
  "read", "glob", "grep", "list", "lsp", "webfetch", "websearch",
])

export function approvalRisk(permission: string): ApprovalRisk {
  if (permission === "bash" || permission === "external_directory" || permission === "doom_loop") {
    return "execute"
  }
  if (SAFE_PERMISSIONS.has(permission)) return "read"
  return "write"
}

export type ApprovalItem = {
  request: PermissionRequest
  info: PermissionInfo
  risk: ApprovalRisk
  // global index in the pending queue, stable across re-renders
  index: number
}

export function getApprovalQueue(permissions: PermissionRequest[]): ApprovalItem[] {
  return permissions.map((request, index) => ({
    request,
    info: permissionInfo(request),
    risk: approvalRisk(request.permission),
    index,
  }))
}

// Bulk "allow all safe" (§4.2). Returns one reply per safe row; unsafe rows are
// intentionally excluded so the caller can surface them for explicit decision.
export function approvalAllowAllSafe(permissions: PermissionRequest[]): PermissionReply[] {
  return permissions
    .filter((request) => approvalRisk(request.permission) === "read")
    .map((request) => ({ requestID: request.id, reply: "once" as const }))
}
```

- `permissionInfo`, `permissionRun`, `permissionReject`, `permissionAlwaysLines`,
  `permissionLabel` are **reused unchanged** from `permission.shared.ts` — the center
  only adds *queueing* and *risk* on top.
- No new SDK round-trips for the list itself; the existing `data.permissions[]` is the
  source of truth (`session-data.ts`).

### 5.2 TUI state + view

- `FooterView` gains one member (non-breaking union addition):
  `{ type: "approvals"; requests: PermissionRequest[]; focus: number }`
  (`types.ts:173-177`). `pickBlockerView` (`session-data.ts:219-229`) returns this when
  `data.permissions.length > 1` (or `=== 1` if we also want the list chrome for a single
  item — recommend: center for `>= 1`, falling back to today's `{ type: "permission" }`
  only when width `< 60`, per §4.3). Keep `{ type: "permission" }` for the narrow
  single-action path so existing tests still pass.
- `footer.view.tsx:781-787` adds a `<Match when={active().type === "approvals"}>` that
  renders a new `RunApprovalCenter` component, reusing `RunPermissionBody` for the
  focused row's detail pane.
- New component `RunApprovalCenter`
  (`packages/ottili-coder/src/cli/cmd/run/footer.approval-center.tsx`, NEW):
  - `createMemo(() => getApprovalQueue(props.requests))` for the list.
  - Renders the queue list (left) + `RunPermissionBody` detail (right) for
    `props.requests[focus]`; owns `focus` state and the `j/k/a/A/r/↵/Esc` keymap
    (§4.2), delegating each decision to the existing `permissionRun`/`permissionReject`.
  - Reuses `footerWidthPolicy` for the two-column → stacked → list-only → single
    fallback (§4.3) and the existing action-bar button renderer.
  - `applyHeight` (`footer.ts:696-722`) gains an `approvals` branch mirroring
    `permission` (`PERMISSION_ROWS` or a slightly taller `APPROVAL_ROWS` constant).

### 5.3 Web app + desktop

- Web: extend `session-composer-state.ts:38-47` to expose the **full** pending queue
  (`permissions[]`) instead of the first via `sessionPermissionRequest`. Render a
  `<SessionApprovalCenter>` that maps `getApprovalQueue` (mirror the pure model, or
  import it once the CLI model is extracted to a shared package) to a list of
  `SessionPermissionDock` rows plus a focused detail. Keep `SessionPermissionDock`
  as the per-row presentation. Desktop inherits automatically (web wrapper).
- No Electron renderer changes (`packages/desktop` is unaffected beyond inheriting the
  web center).

### 5.4 SDK dependency (documented, not implemented here)

Grouped **effect preview** for bash/batch would benefit from richer metadata
(`tool.metadata.effects` summarizing files-touched), but the current `PermissionRequest`
already carries enough (`patterns`, `metadata.input`, `tool`) for the center to show
title/lines/diff today. Enriching `metadata` with a structured `effects` summary is a
follow-up (T-CLI-0055-shaped) and is intentionally out of scope for this specification.

---

## 6. Removing OpenCode UX Assumptions

- **Approver is a first-class center, not a blocking modal only.** Promote the queue to
  an openable, triage-friendly surface (`/approvals`, status-bar entry) while keeping the
  blocking path for the agent loop.
- **Whole queue is visible.** Stop serializing on `permissions[0]`
  (`session-data.ts:245`); the center lists every pending action and lets the user decide
  in any order or bulk.
- **Subagent approvals are first-class.** The center's queue already flattens
  `listSubagentPermissions` (`subagent-data.ts:645-646`); render them with a subagent
  label instead of only a "Pending permission" blocker tab.
- **Risk is explicit, not implied.** Add the `approvalRisk` tier (§5.1) so write/execute
  actions are visibly distinct — Claude Code shows this density; OpenCode buried it in a
  single modal.
- **No OpenCode-branded copy.** Branding is already Ottili. Color stays the Ottili theme
  palette; Claude Code is a layout/density reference only. Keep the SDK wire contract
  (`@opencode-ai/sdk/v2` import path) untouched — renaming the upstream SDK package is a
  separate, higher-risk migration and is explicitly out of scope here.

---

## 7. Feature Flag

Gate the new center (new `FooterView` member, `/approvals` command, web center) behind:

```ts
EVOLUTION_T_CLI_0168_TUI_REDESIGN_APPROVAL_CENTER__INTER_ENABLED = false
```

Use the existing `Flag` mechanism already imported across the run/* tree. Default `false`;
enable after staging validation. When off, behavior is **identical to today**: single
`{ type: "permission" }` modal, web `SessionPermissionDock` unchanged.

---

## 8. Edge Cases / States

- **Empty queue** (`permissions.length === 0`): `/approvals` shows "No pending
  approvals" and closes on `Esc`; blocking path never enters the center.
- **Single pending action at width < 60**: render today's lone modal
  (`{ type: "permission" }`) — no list chrome (§4.3).
- **Action resolved while focused**: remove from queue, focus moves to `index` clamped to
  `[0, len-1]`; if queue empties, fall back to `prompt` (blocking) / close (on-demand).
- **Risk recomputed on metadata change**: `syncPermission` (`session-data.ts:342-360`)
  already re-enriches the active request; the center re-derives `approvalRisk` from the
  updated `permission` string, so a bash→edit transition updates the glyph.
- **Bulk allow-all-safe with zero safe rows**: `approvalAllowAllSafe` returns `[]`; the
  center shows "No safe actions to auto-approve" and keeps unsafe rows focused.
- **Concurrent sessions / subagents**: queue is per-`sessionID`
  (`PermissionRequest.sessionID`); the center is scoped to the active session and shows
  flattened subagent items labeled by subagent. Switching session resets `focus` to `0`.
- **Loading / error**: the list reads from already-resolved `data.permissions`; no async
  fetch in the center. If the SDK reply fails, `RunPermissionBody.submit` already resets
  `submitting` and keeps the row (`footer.permission.tsx:178-185`) — the center preserves
  that.
- **Very long titles/patterns**: wrap (`wrapMode="word"`) and truncate the queue row to
  the column width; full text remains in the detail pane.
- **`always === ["*"]`**: `permissionAlwaysLines` already renders the "until restarted"
  copy; the center shows it in the detail's always-confirm stage unchanged.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/ottili-coder typecheck`
- `bun run --cwd packages/ottili-coder test` (add unit tests for `getApprovalQueue`,
  `approvalRisk`, `approvalAllowAllSafe`, and a `RunApprovalCenter` render test covering
  ≥110 / 80–109 / 60–79 / <60 widths and empty / single / multi / bulk-safe states;
  keep existing `permission.shared` and `footer.permission` tests green).
- `bun run --cwd packages/app typecheck` (web center, if built in the same pass).
- `bun run typecheck` (turbo) and `bun run lint`.
- `./packages/sdk/js/script/build.ts && git diff --check` (only if the `metadata.effects`
  enrichment in §5.4 is taken; otherwise no SDK change).
- Manual: `tmux` TUI smoke at the four widths with 0/1/3 pending actions including a
  subagent request; web `SessionApprovalCenter` with a queued batch; desktop inherits.

---

## 10. Open Questions (for human review)

1. Should the center replace the lone modal at **width ≥ 60 even for a single action**,
   or keep the classic modal for `N == 1`? Recommend: center for `N >= 1` at width ≥ 60
   for consistency; modal only at width < 60.
2. Bulk `shift+A` scope: allow-all-safe only, or also a confirm-gated allow-all
   (including write/execute)? Recommend allow-all-safe without a confirm gate; everything
   else explicit.
3. Should the `/approvals` on-demand panel pause the agent loop while open (blocking) or
   let it run (non-blocking, decisions apply as they arrive)? Recommend non-blocking for
   the on-demand open; blocking only when the agent is itself waiting (today's behavior).
4. Subagent items in the center: flatten into the same list with a subagent tag, or a
   nested "Subagent ›" group? Recommend flat list with a subagent label for density.
5. SDK `metadata.effects` structured summary for richer grouped effect preview — adopt in
   a follow-up (§5.4) or defer entirely? Recommend defer; current `patterns`/diff suffice.
