# TUI Redesign — Notifications and Toasts

## Task

- **Task ID**: `294f80b5-c361-4657-9c9c-5224a67d36a5`
- **Title**: T-CLI-0176 — TUI redesign: Notifications and toasts — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI overlay + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the toast store/stack and the `TuiToast`/`tui.toast.show` action extension are documented dependencies for the implementation follow-up.

---

## 1. Goal

Define the exact interaction model for **Notifications and toasts** in Ottili Coder:
non-blocking **success**, **warning**, **retry** and **action** messages. Map the current
components and state, remove obsolete OpenCode UX assumptions, and design the smallest
reusable Ottili Coder component/state architecture.

This task intentionally separates two concepts that upstream OpenCode conflates under the
word "notification":

- **In-terminal toasts** — transient, non-blocking cards for operation results
  (success / warning / info / error) and actionable messages (retry / undo / view).
- **OS attention notifications** — desktop notifications + sounds, fired only when the
  window is blurred and the agent needs the user (question / permission / session done).

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme/index.ts`, `packages/ottili-coder/src/cli/cmd/run/theme.ts`).
No pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 In-terminal toast (the only shipped in-window surface)

- Single-file component `packages/tui/src/ui/toast.tsx`. A SolidJS context
  (`ToastProvider` / `useToast`, `toast.tsx:91-101`) wraps the app
  (`app.tsx:284-334`), and `<Toast />` is mounted in `routes/home.tsx:93` and
  `routes/session/index.tsx:1614`.
- The store holds **exactly one** toast: `currentToast: null as ToastOptions | null`
  (`toast.tsx:54-56`). `toast.show()` overwrites it directly
  (`setStore("currentToast", toastOptions)`, `toast.tsx:63`) and resets the single timer
  (`toast.tsx:64-67`). **There is no queue and no stacking** — a second `show()` within the
  duration silently destroys the first.
- `Toast` renders one `<box>` fixed at `top={2} right={2}` with
  `maxWidth={Math.min(60, dimensions().width - 6)}` (`toast.tsx:21-48`). Left/right border
  uses `theme[current().variant]`; background `theme.backgroundPanel`; optional bold `title`;
  wrapped `message`. No action button, no glyph, no dismiss key.
- Variants: `info | success | warning | error` (`toast.tsx:7-12`), default duration `5000ms`
  (`toast.tsx:62`). `toast.error(err)` maps `Error` → `variant: "error"` (`toast.tsx:69-79`).
- A weaker **duplicate** toast type exists in `packages/tui/src/util/selection.ts:3-6`
  (`{ show, error }` only — no variant, no title), used by clipboard copy
  (`selection.ts:39`, `dialog.tsx:189`, `app.tsx:437`). Two unrelated toast concepts coexist.

### 2.2 Plugin API surface

- `api.ui.toast(input: TuiToast)` (`packages/plugin/src/tui.ts:622`, inside
  `TuiPluginApi.ui`, `tui.ts:614-624`). The runtime adapter forwards it to the store
  (`packages/tui/src/plugin/adapters.tsx:269-276`).
- `TuiToast` shape (`tui.ts:226-231`): `{ variant?, title?, message, duration? }`.
  **No `action` / no `retry`.** Toasts are purely passive read-only messages today.

### 2.3 Wire contract (core → TUI)

- Event `tui.toast.show` (`packages/ottili-coder/src/server/tui-event.ts:36-46`):
  `{ title?, message, variant: "info"|"success"|"warning"|"error", duration?: PositiveInt }`
  with `DEFAULT_TOAST_DURATION = 5000` (`tui-event.ts:6,42`). Consumed in
  `app.tsx:1027-1035` (workspace-scoped) and re-emitted from session events
  (e.g. `session.deleted` → `app.tsx:1048`, `session.error` → `app.tsx:1061`).
- HTTP `showToast` endpoint (`packages/ottili-coder/src/server/routes/instance/httpapi/groups/tui.ts:140-150`)
  takes `TuiEvent.ToastShow.data` as payload — so any change to the event schema
  automatically flows to the endpoint.

### 2.4 OS attention notifications (the "blur-window" surface)

- `packages/tui/src/attention.ts` — `createTuiAttention` plays sounds and triggers an OS
  notification (`renderer.triggerNotification`, `attention.ts:185-188`) **only when
  blurred**: `focusSkip` (`attention.ts:107-112`) suppresses the OS notification when the
  window is focused. Title defaults to `"Ottili Coder"` (`attention.ts:41`).
- `packages/tui/src/feature-plugins/system/notifications.ts` — the *only* producer of
  attention events. It routes `question.asked` / `permission.asked` / `session.status`
  (done) / `session.error` exclusively to `api.attention.notify` (`notifications.ts:12-17,
  35-86`). It dedupes via `Set`s (`notifications.ts:30-33`) but emits **no in-terminal
  toast**. Consequence: when the window is **focused**, a background session done / subagent
  error / session error produces *no in-window feedback* — the user only sees the footer
  blocker (permission/question) or nothing (background done/error).

### 2.5 Branding & palette

- Ottili branding is already in place (toast copy, `DEFAULT_TITLE = "Ottili Coder"`).
- TUI theme semantic tokens (`packages/tui/src/theme/index.ts:37-92`): `info`/`success`/
  `warning`/`error` (`:43-44`), `backgroundPanel` (`:49`), `text`/`textMuted` (`:45-46`),
  `border`/`borderActive` (`:52-53`). Toasts already key off these tokens
  (`toast.tsx:35,44`). The redesign keeps this palette as the only color source.

---

## 3. Gaps

1. **Single-toast store, no stacking.** `currentToast` is singular (`toast.tsx:54-56`); new
   `show()` overwrites and resets the timer (`toast.tsx:63-67`). Rapid results (e.g.
   "Copied to clipboard" + "Saved config") collide; the first is lost. There is no queue,
   no count, no LIFO/FIFO.
2. **No actions, no retry.** `TuiToast` (`tui.ts:226-231`) and `ToastShow`
   (`tui-event.ts:36-46`) carry only `{title?, message, variant, duration?}`. The task asks
   for **retry** and **action** messages; today the only actionable surface is a blocking
   `Dialog`. There is no non-blocking in-terminal action affordance.
3. **No keyboard model.** `Toast` is a passive `<Show>` box (`toast.tsx:21`); there is no key
   handler to dismiss or activate. Toasts disappear only by timer. `Esc` is owned by
   dialogs/prompt, not toasts.
4. **"Retry" is a behavior, not a color.** Variant set is info/success/warning/error
   (`toast.tsx:10`). Retry must be modeled as an **action** on a warning/error toast, with
   color reinforced by a glyph + label (never color-alone) to satisfy accessibility.
5. **Cross-process actions cannot carry callbacks.** `tui.toast.show` and the HTTP
   `showToast` endpoint serialize across the core→TUI boundary; a function `onClick` cannot
   travel. Cross-process toasts need a **`command`** (a registered keymap command or a
   route) the TUI executes, while in-process plugin toasts may keep an `onClick`. The
   architecture must separate the two instead of pretending one shape fits both.
6. **Duplicate toast types.** `util/selection.ts:3-6` defines a weaker `Toast` (`show`/`error`
   only). It should be unified under the single `useToast` model.
7. **Focused-window blind spot.** `notifications.ts` emits OS notifies only; when focused,
   background session-done / subagent-error / session-error get no in-window toast. The
   in-terminal toast should be the **primary** surface; OS notify stays **supplementary**
   for the blurred window.
8. **Implicit, lossy width behavior.** `maxWidth={Math.min(60, width-6)}` (`toast.tsx:29`)
   silently shrinks below 66 cols with no documented truncation/fallback; `top={2} right={2}`
   can overlap top chrome; no stacking layout at any width.
9. **No dedupe / no id.** Repeated identical toasts each spawn fresh; `notifications.ts`
   already dedupes via `Set`s (`notifications.ts:30-33`) but the toast surface has no dedupe
   key.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A toast is a small, transient, **non-blocking** card. Each carries:

- a **glyph** (Ottili palette color, reinforced by a non-color symbol),
- an optional **title** (bold),
- a **message** (word-wrapped),
- an optional **action**: a single inline key + label, e.g. `[r] Retry`, `[u] Undo`,
  `[v] View`.

Stacking: up to **3** toasts, newest on top, each independently timed; a `+N` count when
more are pending.

| Variant | Palette token (`theme`) | Glyph (non-color signal) | Default duration |
| --- | --- | --- | --- |
| `info` | `info` (cyan) | (none) | 5000ms |
| `success` | `success` (green) | `✓` | 5000ms |
| `warning` | `warning` (yellow) | `⚠` | 8000ms |
| `error` | `error` (red) | `✕` | 8000ms |

Color is **never the only signal**: the glyph, the title text, and (when present) the action
label all convey state without color. This matches the approval-center risk-glyph rule
(`specs/tui/approval-center.md:202-207`).

### 4.2 Interaction

- **Show**: `toast.show({ variant, title?, message, duration?, sticky?, action? })`.
  - `duration` defaults per variant (5000 info/success, 8000 warning/error); override via `duration`.
  - `sticky: true` ⇒ ignore the timer until dismissed or acted (recommended when `action` is present).
- **Action** (`ToastAction`): `{ label, command?, onClick? }`.
  - In-process (plugin/runtime) → `onClick()` runs directly.
  - Cross-process (event / HTTP) → `command` is a registered keymap command or a route the
    TUI executes (see §5.3). `onClick` is never serialized.
  - Activation: when a toast is visible, a dedicated toast key-layer is active (it does **not**
    steal the prompt's keys). `[a]` activates the top toast's action; `Enter` activates when
    the toast is focused/hovered; the action label shows its key (`[r] Retry`).
- **Dismiss**:
  - `Esc` dismisses the top toast **only if** no dialog/prompt has captured `Esc` — the toast
    owns a transient layer that yields to dialogs.
  - `]` dismisses **all** toasts.
  - Timer auto-dismisses non-sticky toasts; independent per toast.
- **No focus theft**: toasts are overlay-only. They never move the prompt caret or block the
  agent loop. This is the core distinction from the blocking `Dialog`/permission footer.

### 4.3 Terminal-width behavior

| Width | Rendered |
| --- | --- |
| ≥ 110 | stacked column, top-right, `maxWidth = 60`, up to 3 visible + `+N` count |
| 80–109 | stacked column, `maxWidth = width - 6`, up to 3 visible |
| 60–79 | single column, `maxWidth = width - 4`, drop the action's label text (keep glyph + key), stack reduced to 2 |
| < 60 | one compact tinted **strip** at top: `⚠ <message truncated to width-4>`; no title, no border box; action shown only as a trailing key if present |

Truncation is right-to-left: drop the title first, then the action label, then the stack
(keep 1), preserving the glyph + message last. Layout uses OpenTUI flex with `flexShrink={0}`
on the action key and a `flexGrow` spacer before it.

### 4.4 Accessibility

- Each toast is a focusable overlay region with an `aria-label` combining variant + title +
  message + (action label), e.g. `"Error: Session error. Press a to retry"`.
- Color is reinforced by the glyph (`✓ ⚠ ✕`) and the text title/label — never color-alone.
- The action keeps a mouse `onMouseUp` handler (mirror `footer.permission.tsx:53-58`) plus the
  keyboard `a` / `Enter` path.
- When `Flag.OTTILI_CODER_DISABLE_MOUSE` is set (`packages/core/src/flag/flag.ts:30`), hide
  hover affordances and rely on keyboard only.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Unified pure toast model (framework-agnostic, one source of truth)

```ts
// packages/tui/src/ui/toast.ts  (NEW — pure model, split from toast.tsx)
export type ToastVariant = "info" | "success" | "warning" | "error"

export type ToastAction = {
  label: string
  // Wire-safe (core→TUI event / HTTP): a keymap command or route the TUI executes.
  command?: string
  // In-process only (plugin/runtime): a direct callback. NEVER serialized.
  onClick?: () => void
}

export type ToastOptions = {
  id?: string // dedupe key; defaults to a stable hash of (title|message|variant)
  variant: ToastVariant
  title?: string
  message: string
  duration?: number // ms; default per variant (see DEFAULTS)
  sticky?: boolean // if true, ignore duration until dismissed/acted
  action?: ToastAction
}

export const DEFAULT_TOAST_DURATION = 5000
export const ERROR_TOAST_DURATION = 8000
export const MAX_VISIBLE_TOASTS = 3

export function defaultDuration(variant: ToastVariant): number {
  return variant === "warning" || variant === "error" ? ERROR_TOAST_DURATION : DEFAULT_TOAST_DURATION
}

export function toastID(options: ToastOptions): string {
  return options.id ?? `${options.variant}:${options.title ?? ""}:${options.message}`
}

// Keep at most MAX_VISIBLE_TOASTS; newest last; dedupe by id (collapse repeats).
export function enqueue(list: ToastOptions[], next: ToastOptions): ToastOptions[] {
  const id = toastID(next)
  const without = list.filter((t) => toastID(t) !== id)
  return [...without, next].slice(-MAX_VISIBLE_TOASTS)
}
```

- `ToastOptions` **replaces** both the `ToastOptions` in `toast.tsx:7-12` and the ad-hoc
  `Toast` type in `util/selection.ts:3-6`. `selection.ts` imports `useToast`'s `Toast`
  type instead of declaring its own.

### 5.2 TUI store + view (replace the singular store)

```ts
// packages/tui/src/ui/toast.tsx  (init())
const [store, setStore] = createStore<{ toasts: ToastOptions[] }>({ toasts: [] })
let timers = new Map<string, NodeJS.Timeout>()

function show(options: ToastInput) {
  const toast = { duration: defaultDuration(options.variant), ...options }
  const id = toastID(toast)
  setStore("toasts", (list) => enqueue(list, toast))
  if (!toast.sticky) {
    const handle = setTimeout(() => dismiss(id), toast.duration).unref()
    timers.set(id, handle)
  }
}
function dismiss(id: string) {
  timers.get(id)?.close?.()
  timers.delete(id)
  setStore("toasts", (list) => list.filter((t) => toastID(t) !== id))
}
function dismissAll() {
  for (const h of timers.values()) h.close?.()
  timers.clear()
  setStore("toasts", [])
}
function activate(id: string) {
  const toast = store.toasts.find((t) => toastID(t) === id)
  if (!toast?.action) return
  if (toast.action.onClick) toast.action.onClick()
  else if (toast.action.command) keymap.dispatchCommand(toast.action.command)
}

const toast = {
  show, dismiss, dismissAll, activate,
  error: (err: unknown) => show(err instanceof Error
    ? { variant: "error", message: err.message }
    : { variant: "error", message: "An unknown error has occurred" }),
  current: () => store.toasts,
}
```

- `<Toast />` renders `For` over `toast.current()` (newest on top), applying §4.1 glyph +
  §4.3 width tiers. A `+N` badge shows when `current().length > MAX_VISIBLE_TOASTS`.
- `useToast()` returns `{ show, error, current, dismiss, dismissAll, activate }` — a
  superset of today's `{ show, error, currentToast }`, so existing callers
  (`app.tsx`, `routes/session`, `dialog-*.tsx`, `selection.ts`) keep working.

### 5.3 Wire contract extension (core → TUI)

```ts
// packages/ottili-coder/src/server/tui-event.ts — ToastShow schema gains:
//   action?: { label: string; command: string }   // wire-safe only (no onClick)
//
// packages/plugin/src/tui.ts — TuiToast gains:
//   action?: { label: string; command?: string; onClick?: () => void }
//
// packages/tui/src/plugin/adapters.tsx:269 — forward action → store.show
```

The HTTP `showToast` endpoint (`tui.ts:140`) inherits the new payload automatically via
`TuiEvent.ToastShow.data` — **no handler change**. Cross-process callers MUST supply
`action.command` (never `onClick`).

### 5.4 In-terminal surfacing of background/session events (closes gap #7)

Extend `app.tsx` `session.error`/`session.deleted` handlers (and, optionally, the
`feature-plugins/system/notifications.ts` session-done path) to **also** `toast.show(...)`
(non-blocking, in-window) alongside the existing OS `attention.notify` (blur-only). This gives
focused-window feedback without removing the blur OS notify. No new SDK event is required.

### 5.5 Web app + desktop

- Web (`packages/app`): mirror the pure `toast.ts` model (or import it once extracted to a
  shared package) into a `<SessionToastStack>` rendered in the composer region. Keep the
  existing per-dock toasts; the stack is an additive container. Desktop inherits the web
  wrapper unchanged; the Electron OS `showNotification` (`packages/desktop/src/main/ipc.ts:187`)
  remains the desktop-specific supplement for blurred windows.

---

## 6. Removing OpenCode UX Assumptions

- **Two-layer model, explicit.** In-terminal **toasts** are the primary surface for
  success/warning/info/error + retry/action. OS **attention notifications** are
  *supplementary*, fired only when the window is blurred (`attention.ts:107-112`). Today
  `notifications.ts` treats OS notify as the only surface for session/permission events; the
  redesign makes the in-terminal toast primary and the OS notify a blur-only fallback.
- **Retry is an action, not a variant.** Stop implying that "retry"/"action" need a new color;
  model them as `ToastAction` on a warning/error toast, with glyph + label as the signal
  (mirrors the approval-center risk-glyph rule).
- **Stack, don't clobber.** Replace the singular `currentToast` (`toast.tsx:54-56`) with a
  queue; stop assuming only one transient message can exist at a time.
- **No OpenCode-branded copy.** Branding is already Ottili; color stays the Ottili theme
  palette. **Keep the upstream SDK wire contract** (`@opencode-ai/sdk/v2`,
  `@opencode-ai/plugin/tui` import paths) untouched — renaming the upstream SDK package is a
  separate, higher-risk migration and is explicitly out of scope here (see approval-center
  §6).

---

## 7. Feature Flag

Gate the new store/stack/action rendering behind the existing `Flag` mechanism
(`packages/core/src/flag/flag.ts`):

```ts
// packages/core/src/flag/flag.ts — add to the Flag object (mirrors experimental getters, :54-65)
get OTTILI_CODER_EXPERIMENTAL_TUI_TOAST_REDESIGN() {
  return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_TUI_TOAST_REDESIGN")
},
```

Default `false` (env-unset → `enabledByExperimental` returns the global experimental flag or
`false`). Enable after staging validation. When off, behavior is **identical to today**: the
store keeps `currentToast`-compatible `show`/`error`/`current` and renders a single toast.
The MEE feature-flag name `EVOLUTION_T_CLI_0176_TUI_REDESIGN_NOTIFICATIONS_AND_TOAST_ENABLED`
maps to this env var.

---

## 8. Edge Cases / States

- **Empty message**: skip the toast (mirror `attention.ts` `empty_message` skip, `attention.ts:176`).
- **`action` with only `command`** (cross-process): keymap/route executes; `onClick` undefined is fine.
- **`action` with only `onClick`** (in-process): runs; never serialized over the wire.
- **Null/undefined action**: render a plain toast, no action key.
- **More than 3 toasts**: stack to `MAX_VISIBLE_TOASTS` (3); show `+N` count badge.
- **Rapid identical toasts**: `enqueue` dedupes by `toastID` (`id` or stable hash) — no repeats.
- **Width < 60**: compact tinted strip, no title/border, action shown as trailing key only.
- **Sticky + action**: stays until dismissed/acted; recommended for retry/undo.
- **Loading state**: toasts are post-hoc results; loading uses the existing spinner component
  (`packages/tui/src/component/spinner.tsx`), not a toast.
- **Concurrent sessions / subagents**: toast is a global overlay (matches current behavior);
  no per-session routing. Background subagent done/error now also surfaces in-window (§5.4).
- **Mouse disabled** (`Flag.OTTILI_CODER_DISABLE_MOUSE`): hide hover affordances; keyboard `a`/`]` only.
- **Action key collision**: the toast key-layer is active only while a toast is visible, so
  `a` does not conflict with prompt/keymap bindings in the normal layer.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/ottili-coder typecheck`
- Add pure-model unit tests (`packages/tui/test/ui/toast.test.ts`): `defaultDuration`,
  `toastID`, `enqueue` truncation to `MAX_VISIBLE_TOASTS`, dedupe, and action serialization
  (command-only vs onClick-only). Keep existing `toast`/`selection`/`dialog-*` callers green.
- Add a render test (`packages/tui/test/ui/toast.render.test.tsx`): 0 / 1 / 3 toasts, the four
  width tiers (§4.3), action activation via `a`, dismiss via `Esc`/`]`, sticky behavior.
- `bun run --cwd packages/tui test` (toast surface).
- `bun run typecheck` (turbo) and `bun run lint` (oxlint).
- `git diff --check`.
- Manual: `tmux` TUI smoke at the four widths with success / warning / retry(action) / action
  toasts, plus a background subagent error while focused; web `<SessionToastStack>`; desktop
  inherits.

---

## 10. Open Questions (for human review)

1. Should **background session-done** also get an in-terminal toast (not just the blurred OS
   notify)? Recommend **yes** (non-blocking, §5.4).
2. Sticky vs timed for action toasts: recommend **sticky-by-default when `action` is present**,
   auto-dismiss when no action.
3. `MAX_VISIBLE_TOASTS = 3` — enough for dense sessions, or 4? Recommend 3 to protect density.
4. Activation key `a`: safe because the toast layer is active only while a toast is visible;
   confirm no keymap collision in `packages/tui/src/keymap.tsx` before implementation.
5. Should cross-process `action.command` be a bare keymap command or a typed route
   (`{ type: "session", sessionID }`)? Recommend keymap command for uniformity with
   `tui.command.execute` (`tui-event.ts:10-35`); route-navigation actions can wrap a command.
