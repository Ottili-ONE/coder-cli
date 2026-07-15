# TUI Redesign — Code Block Renderer

## Task

- **Task ID**: `c91e0b19-5728-4838-81ce-0eb7f255cb0c`
- **Title**: T-CLI-0192 — TUI redesign: Code block renderer — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI chat + shared web app + desktop wrapper)
- **Depends on**: T-CLI-0055 (redesign scaffolding), T-CLI-0188 (markdown renderer)
- **Status**: Specification (design + component/state architecture). No production source changed by this task; this spec designs the reusable `CodeBlockView` surface, the keyboard/copy/select/wrap/execute model, the terminal-width contract, and the cross-surface token vocabulary. The actual renderer is implemented in the follow-up gated by the flag in §7.

---

## 1. Goal

Define the exact interaction model for the **Code block renderer** in Ottili Coder's
TUI: syntax highlighting, line selection, copy, wrapping, and execution affordances.
Map the current components and state, remove obsolete OpenCode UX assumptions, and
design the **smallest reusable Ottili Coder component/state architecture**.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`, `packages/ui/src/theme/resolve.ts`,
`packages/ottili-coder/src/cli/cmd/run/theme.ts`). No pixel-copy of proprietary
artwork or brand assets.

The renderer must be a **single reusable component** shared by every surface that
paints a fenced code block: the TUI chat (both the shipped opentui `<markdown>`
path and the planned `component/markdown` path), the web app, and the desktop
wrapper. Today each surface re-implements code blocks differently (or not at all in
the TUI), so this spec makes the component and its color/state contract identical
everywhere.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 TUI hand-rolled markdown renderer (`component/markdown`) — the planned path

- A fenced block is parsed into `{ type: "code"; lang: string | null; value: string }`
  (`packages/tui/src/component/markdown/model.ts:39`). The fence opener is parsed by
  `isFence` (`model.ts:165-169`) and the body gathered in `parseMarkdown`
  (`model.ts:234-250`); `lang` is captured and stored.
- It is painted by `renderBlock`'s `case "code"`
  (`packages/tui/src/component/markdown/index.tsx:156-173`):
  ```tsx
  case "code":
    return (
      <box flexDirection="column" backgroundColor={theme.backgroundPanel}
           borderColor={theme.markdownCodeBlock} border={["left"]}
           paddingLeft={1} paddingTop={0} paddingBottom={0}
           marginTop={0} marginBottom={0}>
        <text fg={theme.markdownCode} wrapMode="none">
          {concealText(block.value, conceal)}
        </text>
      </box>
    )
  ```
- **Gaps in this path**: `block.lang` is **captured but never used or displayed**
  (`index.tsx:169` renders only `block.value`). There is **no syntax highlighting**
  (a single `theme.markdownCode` color for the whole block), **no line-number
  gutter**, **no header** (language / line count / affordances), **no copy**
  affordance, **no line selection**, **no wrap toggle**, and **no execution**
  affordance. `wrapMode="none"` means long lines overflow horizontally with no
  scroll policy. This component is the redesign target but is **not yet wired into
  the chat** (see §2.2).

### 2.2 TUI chat path — the only shipped terminal renderer today

- Assistant prose is rendered by `TextPart`
  (`packages/tui/src/routes/session/index.tsx:1989`), which wraps the third-party
  `<markdown>` Solid element from `@opentui/solid` (bound to `MarkdownRenderable` in
  `@opentui/core`). It passes `syntaxStyle={syntax()}` where `syntax` is
  `createSyntaxStyleMemo(() => generateSubtleSyntax(theme))`
  (`index.tsx:1908, 1996`).
- Fenced code is therefore painted by the engine's `createCodeRenderable` /
  `createMarkdownCodeRenderable` (`node_modules/@opentui/core/renderables/Markdown.d.ts`),
  which applies a **tree-sitter highlight** from the engine's `SyntaxStyle`.
- **Gaps in this path**:
  1. **No code-block copy in the TUI** (T-CLI-0188 Gap 5). The web app has a copy
     button (`packages/ui/src/components/markdown.tsx:96-140`); the TUI does not.
  2. Highlight colors come from the engine's `SyntaxStyle`, **not** from the Ottili
     `theme.syntax*` tokens (T-CLI-0188 Gap 4/6 for code). Ottili cannot retune code
     color from one place.
  3. No line-number gutter, no language header, no line selection, no wrap toggle, no
     execution affordance.

### 2.3 Reusable TUI code infrastructure that already exists (reuse, do not reinvent)

The TUI already ships a dependency-free, fully Ottili-palette-controlled tokenizer
and line/gutter/selection model in
`packages/tui/src/component/file-preview/file-preview-core.ts`:

- `tokenizeLine` (`:396`) / `tokenizeFile` (`:483`): map a line of source into stable
  token kinds `comment|keyword|function|variable|string|number|type|operator|
  punctuation|plain` (`:21-31`), coloured with `theme.syntax*`.
- `splitFileLines` (`:176`), `gutterWidth` (`:186`), `formatGutter` (`:190`): gutter
  math identical to what a code block needs.
- `highlightFamily` (`:195`): maps a language id to a highlighter family
  (python/rust/go/shell/sql/yaml/json/markdown/c). Unknown → `"c"` fallback (`:218`).
- `languageFromFile` (`:585`) → `filetype(path)`: language inference.
- `FilePreviewSelection` (`:500`) / `normalizeSelection` (`:505`) / `lineInSelection`
  (`:513`): a 1-based line-range selection model ready to reuse for copy-of-selection.
- `FILE_PREVIEW_NARROW_WIDTH_DEFAULT` (`:66`) / `isFilePreviewNarrow` (`:68`): the
  existing narrow-terminal threshold the code block should share.

`FilePreview.tsx:66-89` (`tokenColor`) maps each token kind to the Ottili
`theme.syntax*` palette — the **canonical** code-color source the renderer must adopt.

### 2.4 Clipboard + keybind plumbing already present

- `useClipboard()` (`packages/tui/src/context/clipboard.tsx`) exposes
  `write(text)` — the copy primitive the code block reuses.
- Existing keybind precedents for this kind of surface
  (`packages/tui/src/config/keybind.ts`):
  - `messages_copy` (`<leader>y`, "Copy message", `:151`)
  - `messages_toggle_conceal` (`<leader>h`, "Toggle code block concealment in
    messages", `:154`) — note the existing product language already calls these
    "code block" affordances.
  - `app_toggle_diffwrap` ("Toggle diff wrapping", `:54`) — the established pattern
    for a per-surface wrap toggle.

### 2.5 Web / desktop renderers (parallel)

- **Web** (`packages/ui/src/components/markdown.tsx`): `marked` → `DOMPurify` →
  `morphdom`. `ensureCodeWrapper` (`:122-140`) wraps each fenced `<pre>` in
  `[data-component="markdown-code"]` and appends a `createCopyButton`
  (`:96-119`, `data-slot="markdown-copy-button"`, `aria-label`/`data-tooltip`,
  click copies `code.textContent`). **It has copy but no language header, no gutter,
  no selection, no wrap toggle.**
- **Desktop** (`packages/desktop/src/main/markdown.ts`): `marked` with a custom
  `renderer.link` (external links). Inherits the web component.
- **Web/desktop color source** (`packages/ui/src/theme/resolve.ts:364-377` markdown
  tokens, `:344-353` syntax tokens): all derived from the Ottili palette seeds
  `primary/accent/success/warning/error/info/interactive/neutral+ink`
  (e.g. `markdown-code = content(colors.success, success)`,
  `markdown-code-block = text-base`). These are the **canonical color source** across
  surfaces.

### 2.6 Branding & palette

- Color source is the Ottili theme palette (§2.3, §2.5). Claude Code is a
  layout/density reference only.
- The TUI still imports runtime from `@opencode-ai/{core,sdk,tui}` (package names are
  the fork's identity, not UX copy). The redesign must not (re)introduce
  OpenCode-branded user-facing strings; product family is Ottili ONE / Ottili Coder /
  LD3 / Ottili Cloud / Ottili AI.

---

## 3. Gaps (consolidated)

1. **`lang` parsed but discarded.** Both TUI paths capture the fence language and
   then ignore it — no header, no tokenizer-family selection, no execution
   eligibility. (§2.1, §2.2)
2. **No syntax highlighting in the planned TUI renderer.** `component/markdown`
   paints the whole block in one `theme.markdownCode` color. (§2.1)
3. **No code-block copy in the TUI.** Web has it; the TUI does not. (§2.2, T-CLI-0188
   Gap 5)
4. **Highlight colors not Ottili-controlled.** The shipped `<markdown>` path colors
   code from the engine `SyntaxStyle`, bypassing `theme.syntax*`. (§2.2, T-CLI-0188
   Gap 4/6 for code)
5. **No line-number gutter / line selection.** Users cannot reference or copy a line
   range, common in Claude Code. (§2.1, §2.2)
6. **No wrap policy.** `wrapMode="none"` overflows with no horizontal-scroll
   contract for narrow terminals. (§2.1)
7. **No execution affordance.** Runnable blocks (shell) have no "run" affordance; an
   expected Claude Code-like interaction is missing. (§2.1, §2.2)
8. **Inconsistent cross-surface code blocks.** Web has copy + no header/gutter;
   desktop inherits web; TUI has neither. No shared component or token vocabulary.
   (§2.1–§2.5)
9. **OpenCode UX assumption: "a code block is a static, read-only text dump."** The
   redesign treats a code block as an interactive, navigable surface (copy / select
   / wrap / execute) — mirroring how `FilePreview` already treats a file.
10. **OpenCode data assumption: "language is cosmetic."** The redesign makes language
    drive the tokenizer family, the header label, and execution eligibility.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

A code block is a bordered panel with a one-line **header** above a
**gutter + body** region:

| Region | Treatment | Color (Ottili token) |
| --- | --- | --- |
| Header bar | 1 line: `lang` (left) · `N lines` + affordance hints (right) | `textMuted` meta, `markdownCodeBlock` accent rule |
| Border | left rule + panel bg | `markdownCodeBlock` + `backgroundPanel` |
| Line-number gutter | right-aligned, dim | `textMuted` (selected → `selectedForeground`) |
| Body token | syntax-highlighted | `syntax*` palette (`tokenColor`, FilePreview.tsx:66) |
| Affordance hints | `c` copy · `w` wrap · `e` run (when eligible) | `info`/`success` |
| Selection band | highlighted line range | `selectedListItemText`/`backgroundMenu` |

The header is **always rendered** (even a one-line block) so the language and line
count are scannable — Claude Code density — while the gutter/affordances keep it
visibly Ottili (Ottili palette, not proprietary artwork).

### 4.2 Keyboard model (when a code block holds focus in the active message)

Reuse the existing TUI focus/selection system (no new global registry):

- `c` → **copy block** to clipboard via `useClipboard().write(block.value)`; toast
  "Code copied" (`success`). Mirrors web `createCopyButton`.
- `C` (shift) → **copy selection** (the focused line range) if a selection exists;
  otherwise copies the whole block.
- `w` → **toggle wrap** (`wrapMode` `none` ↔ `word`). Reuses the `app_toggle_diffwrap`
  precedent for a per-surface wrap toggle.
- `Enter` / `e` → **execute** (only when `executionAvailable(lang)` is true; see
  §4.5). Routes the block through the existing permission/tool flow — never silent
  auto-run.
- `Shift+↑` / `Shift+↓` → **extend line selection** from the anchor (uses
  `FilePreviewSelection` / `normalizeSelection` / `lineInSelection`).
- `g` / `G` → move focus to first / last line of the block.
- Focus moves **between code blocks** via the existing `session.message.next/
  previous` navigation; the first code block in a message receives focus when its
  message is focused.
- All accelerators are registered in the command palette / which-key overlay, parallel
  to `session.bindingCommands` (`index.tsx:122-151`).

### 4.3 Terminal-width behavior

Share `isFilePreviewNarrow(width)` (`:68`) and the existing `wide =
dimensions().width > 120` gate (`index.tsx:273`):

| Element | ≥ 100 cols | 60–99 | < 60 |
| --- | --- | --- | --- |
| Header | `lang` + `N lines` + hints | `lang` + `N lines` | `lang` only (hints hidden) |
| Gutter | shown | shown | hidden (or collapsed padding) |
| Body | wrap off, `←/→` scroll | wrap off, `←/→` scroll | wrap **on** by default (no H-scroll fatigue) |
| Border | left rule | left rule | left rule |

- Truncation order: drop affordance hints first, then gutter padding; **never** clip
  the header language label or the body's first column.
- `useTerminalDimensions()` is the source; the surrounding `<box paddingLeft={3}>`
  already supplies `contentWidth` (T-CLI-0188 §4.3).
- Wrap default is **off** on wide terminals (Claude Code keeps code un-wrapped and
  scrolls); on `< 60` it flips to **on** for readability.

### 4.4 Accessibility

- The header carries a spoken form, e.g. `aria-label="Code block, <lang>, N lines,
  c to copy"`. Color is never the only signal: the language **word** and the
  `N lines` count are text.
- Affordance hints are text (`c`/`w`/`e`), not icon-only.
- Selection is keyboard-reachable (§4.2) and reflected in the gutter (selected lines
  use `selectedForeground`).
- Respect `ctx.conceal()` / `concealCode`: secret-shaped content is redacted via the
  existing `redactSensitive` before painting; the header still shows language/count.

### 4.5 Execution affordance (policy, safe by default)

A code block is **execution-eligible** only when its language is an explicitly
allowed runnable family. Define a pure predicate:

```ts
// execution eligibility — allow-list, never auto-run
const RUNNABLE = new Set(["shell", "bash", "sh", "shellscript", "zsh"])
export function executionAvailable(language: string | null | undefined): boolean {
  if (!language) return false
  return RUNNABLE.has(highlightFamily(language))
}
```

- When `executionAvailable` is true, the header shows a `▷ run` hint and `e`/`Enter`
  is enabled.
- Activation **never executes directly**. It opens the existing permission prompt
  (reuse the `permission` footer flow, `FooterView` union in
  `packages/ottili-coder/src/cli/cmd/run/types.ts`) pre-filled with the block as the
  command, so the user approves exactly as for any protected action. This keeps the
  OpenCode-era "protected action" contract intact and avoids silent command runs.
- For non-runnable languages (ts, py, go, …) no `run` hint is shown and `e` is a
  no-op — no false affordance.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 One shared `CodeBlockView`

A single new component, framework-agnostic model + Solid view, reusing existing
infrastructure:

```
packages/tui/src/component/code-block/
  state.ts        // pure state derivation (no engine/Solid imports)
  CodeBlockView.tsx  // Solid view, reuses file-preview-core tokenizer
  index.tsx       // public re-export
```

```ts
// packages/tui/src/component/code-block/state.ts  (pure)
import type { Theme } from "../../theme"
import {
  tokenizeFile, splitFileLines, gutterWidth, formatGutter,
  languageFromFile, highlightFamily, normalizeSelection, lineInSelection,
  type FilePreviewSelection, type FilePreviewToken[],
} from "../file-preview/file-preview-core"
import { redactSensitive } from "../agent-roster/model"

export type CodeBlockStatus = "populated" | "empty"
export interface CodeBlockState {
  status: CodeBlockStatus
  language: string | null
  family: string                 // highlightFamily(language)
  lines: string[]
  tokens: FilePreviewToken[][]
  lineCount: number
  gutterWidth: number
  wrap: boolean
  selection: FilePreviewSelection | null
  executionAvailable: boolean
}

export function buildCodeBlockState(input: {
  code: string
  language: string | null
  wrap: boolean
  selection: FilePreviewSelection | null
  conceal?: boolean
}): CodeBlockState {
  const lines = splitFileLines(input.conceal ? redactSensitive(input.code).text : input.code)
  const family = highlightFamily(input.language ?? undefined)
  const status: CodeBlockStatus = lines.length === 1 && lines[0] === "" ? "empty" : "populated"
  return {
    status,
    language: input.language,
    family,
    lines,
    tokens: tokenizeFile(lines, input.language ?? undefined),
    lineCount: lines.length,
    gutterWidth: gutterWidth(lines.length),
    wrap: input.wrap,
    selection: normalizeSelection(input.selection),
    executionAvailable: RUNNABLE.has(family),
  }
}

// formatGutter + lineInSelection are re-exported unchanged from file-preview-core.
```

```tsx
// packages/tui/src/component/code-block/CodeBlockView.tsx  (view)
/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from "solid-js"
import { useTheme, selectedForeground } from "../../context/theme"
import { useClipboard } from "../../context/clipboard"
import { useTerminalDimensions } from "@opentui/solid"
import { buildCodeBlockState, isFilePreviewNarrow, type CodeBlockProps } from "./state"

export function CodeBlockView(props: CodeBlockProps) {
  const { theme } = useTheme()
  const clipboard = useClipboard()
  const dims = useTerminalDimensions()
  const state = createMemo(() => buildCodeBlockState({
    code: props.code, language: props.language ?? null,
    wrap: props.wrap ?? false, selection: props.selection ?? null, conceal: props.conceal,
  }))
  const narrow = () => isFilePreviewNarrow(dims().width)
  const showGutter = () => !narrow() && state().lineCount > 0
  const copy = () => clipboard.write?.(props.code)
  // header: language (left) · "N lines" + "c copy · w wrap · e run"(right when wide)
  // body: For each line -> [gutter][tokenized text colored via theme.syntax*]
  // selection band via lineInSelection(state().selection, i+1) -> selectedForeground
  // execution hint shown only when state().executionAvailable
}
```

### 5.2 Reuse map (no reinvention)

| Need | Reuse from | Source |
| --- | --- | --- |
| Tokenize → palette colors | `tokenizeFile` + `tokenColor` logic | `file-preview-core.ts:483`, `FilePreview.tsx:66` |
| Gutter math | `gutterWidth`, `formatGutter`, `splitFileLines` | `file-preview-core.ts:176,186,190` |
| Language → family | `highlightFamily`, `languageFromFile` | `file-preview-core.ts:195,585` |
| Line selection | `FilePreviewSelection`, `normalizeSelection`, `lineInSelection` | `file-preview-core.ts:500,505,513` |
| Narrow threshold | `isFilePreviewNarrow` | `file-preview-core.ts:68` |
| Copy | `useClipboard().write` | `context/clipboard.tsx` |
| Theme tokens | `theme.syntax*`, `markdownCodeBlock`, `textMuted`, `backgroundPanel`, `selectedForeground` | `theme/index.ts:67-89`, `context/theme.tsx` |
| Wrap-toggle precedent | `app_toggle_diffwrap` | `config/keybind.ts:54` |
| Execute → permission | `FooterView` permission union | `ottili-coder/src/cli/cmd/run/types.ts` |

### 5.3 How it plugs into the two TUI markdown paths

1. **Shipped `<markdown>` path** (chat, `index.tsx:1989`): add a `renderNode`
   interceptor (T-CLI-0188 §5.3) that, on a fenced-code token, returns a
   `CodeBlockRenderable` built from `CodeBlockView`. This re-tokenizes with
   `file-preview-core` so **Ottili `theme.syntax*` controls color** (resolves Gap 4),
   and adds the header/copy/select/wrap/run chrome. All other nodes use
   `context.defaultRender()` — additive only.
2. **Planned `component/markdown` path**: replace `case "code"`
   (`index.tsx:156-173`) with `<CodeBlockView code={block.value} language={block.lang}
   .../>`, finally using the captured `lang`.

### 5.4 Backend / SDK dependency

**None.** Content + language + width + theme + interaction are all client-side.
`FilePreview`/`file-preview-core` already prove this is unit-testable with zero
engine/network access. No new `Part`/SDK field is required; `TextPart.type ===
"text"` already carries `part.text`.

### 5.5 Web app + desktop (shared token vocabulary)

Add a `CodeBlock` web component (`packages/ui/src/components/code-block.tsx`) that
wraps the existing `ensureCodeWrapper` copy button and additionally renders the
**language header** + **line-count** + **wrap toggle** + (web-only) **run** affordance,
using the same `markdown-*` / `syntax-*` CSS vars from `resolve.ts:364-377,344-353`.
Desktop inherits automatically. Define one token vocabulary across all three
surfaces:

| Token | TUI (`theme`) | Web (`resolve.ts`) |
| --- | --- | --- |
| `code-block-border` | `markdownCodeBlock` | `markdown-code-block` |
| `code-block-header` | `textMuted` | `text-weak` |
| `code-block-gutter` | `textMuted` | `text-weak` |
| `code-block-selection` | `selectedForeground` / `backgroundMenu` | `selected` |
| `code-block-token-*` | `syntax*` | `syntax-*` |

This is the **only** cross-surface change: align names, not engines.

---

## 6. Removing OpenCode UX Assumptions

- **A code block is interactive, not a dump.** Add copy / line-select / wrap / run
  (Gap 9); mirror `FilePreview`'s file-as-surface model.
- **Language is functional, not decorative.** Drive tokenizer family, header label,
  and execution eligibility from `lang` (Gap 1, 10).
- **One color source for code.** Route TUI highlight through `theme.syntax*` via
  `file-preview-core` + `renderNode`, so Ottili controls code color from a single
  place instead of the engine `SyntaxStyle` (Gap 4).
- **Copy is cross-surface.** TUI gets copy (Gap 3), mirroring web `createCopyButton`;
  reuse `useClipboard`.
- **No OpenCode-branded copy.** Product strings stay Ottili; Claude Code is a
  reference only. Runtime package names (`@opencode-ai/*`) are the fork's identity
  and left as-is (infra, not UX).
- Keep `Part`/`TextPart` wire-compatible; extend the **renderer wrapper**, not the
  session message contract.

---

## 7. Feature Flag

Gate the new `CodeBlockView` + header/copy/select/wrap/run behind:

```ts
EVOLUTION_T_CLI_0192_TUI_REDESIGN_CODE_BLOCK_RENDERER__INT_ENABLED = false
```

Use the existing `Flag` mechanism (`@opencode-ai/core/flag/flag`, already imported
across the TUI, e.g. `Flag.OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE` at
`index.tsx:1167`). Default `false`; enable after staging validation. When off:

- The shipped `<markdown>` path renders engine-default code (no header/copy/select/
  wrap/run) — zero regression.
- The planned `component/markdown` `case "code"` falls back to the current bordered
  `<text>` (`index.tsx:156-173`).

---

## 8. Edge Cases / States

- **Empty block** (` ``` ``` `): `buildCodeBlockState` returns `status:"empty"`;
  render a bordered box with an `(empty)` header, no crash.
- **Unknown language**: `highlightFamily` → `"c"` (file-preview-core:218); header
  shows the raw `lang` label; no execution affordance (not in `RUNNABLE`).
- **Conceal on**: `redactSensitive` scrubs secret-shaped text before tokenizing
  (state.ts); header still shows language/count.
- **Narrow terminal (< 60)**: gutter hidden, wrap on by default, header condenses to
  language only (§4.3).
- **Streaming mid-block**: `streaming` keeps the trailing block unstable (engine
  semantics, `Markdown.d.ts`); copy/select/run are disabled until the block
  finalizes on turn completion.
- **Selection out of range**: `normalizeSelection` returns `null` → no band.
- **Copy while streaming**: copies the current snapshot (`props.code`).
- **Concurrent session switch**: `CodeBlockView` holds only component-local signals
  derived from its props; no global code state, so no cross-session leakage.
- **No theme / fallback palette**: token colors fall back to `theme.text`
  (`tokenColor`, FilePreview.tsx:87).

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a `CodeBlockView` render test covering:
  empty block, plain block, block with language + highlight, line selection band,
  wrap on/off, narrow-terminal gutter collapse; and unit tests for
  `buildCodeBlockState`, `executionAvailable`, and `highlightFamily` reuse).
- `bun run --cwd packages/ottili-coder typecheck` (no backend change expected; guard).
- `bun run lint`
- `git diff --check`
- Manual: `tmux` TUI smoke at ≥100 / 60–99 / <60 cols; verify header language/count,
  gutter, copy toast, wrap toggle, run affordance only on shell blocks, and web/
  desktop header/copy parity.

---

## 10. Open Questions (for human review)

1. **Execute scope**: route the block to the prompt (user sends it as a message) vs
   open the permission prompt pre-filled (recommended, reuses protected-action
   contract) vs disabled by default. Recommend permission-prompt pre-fill.
2. **Highlight source for the shipped `<markdown>` path**: re-tokenize with
   `file-preview-core` for an Ottili-controlled palette (recommended, resolves Gap 4)
   vs keep engine tree-sitter `SyntaxStyle`. The planned `component/markdown` path
   uses `file-preview-core` directly regardless.
3. **Selection granularity**: line-range only (recommended, matches `FilePreview`) vs
   char-range.
4. **Cross-surface run affordance**: web/desktop `run` is web-only and may require a
   backend bridge; confirm whether T-CLI-0192 ships TUI-run only and defers web/desktop
   run to a later task.
5. **Glyph set** for the run hint (`▷`) / selection: confirm render in target
   terminals; ASCII fallback if needed (matches the context-meter glyph decision,
   T-CLI-0148 §10.3).
