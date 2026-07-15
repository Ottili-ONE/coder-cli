# TUI Redesign — Markdown Renderer

## Task

- **Task ID**: `8c743e8a-9d77-4357-a257-4a6f6fddc48f`
- **Title**: T-CLI-0188 — TUI redesign: Markdown renderer — interaction specification and component architecture
- **Type**: `ux`
- **Layer**: coder-cli (TUI + shared web/desktop markdown)
- **Depends on**: T-CLI-0055
- **Status**: Specification (design + component/state architecture). No production source changed by this task; the renderer engine is the third-party `@opentui/core` `MarkdownRenderable`, and this spec designs the Ottili Coder wrapper, color wiring, callouts, keyboard model, and terminal-width contract around it.

---

## 1. Goal

Define the exact interaction model for the **Markdown renderer** in Ottili Coder's
TUI: headings, lists, tables, links, callouts, and terminal-width wrapping. Map the
current components and state, remove obsolete OpenCode UX assumptions, and design the
smallest reusable Ottili Coder component/state architecture.

Reference: Claude Code-like clarity/density (layout + information hierarchy only).
Source of truth for color: the existing Ottili theme palette
(`packages/tui/src/theme`). No pixel-copy of proprietary artwork or brand assets.

---

## 2. Current Behavior (read from source, not guessed)

### 2.1 TUI markdown path (the only terminal renderer)

- Assistant prose is rendered by `TextPart`
  (`packages/tui/src/routes/session/index.tsx:1989`), which wraps the third-party
  `<markdown>` Solid element from `@opentui/solid` (bound to `MarkdownRenderable` in
  `@opentui/core`, see `catalogue.d.ts:43`).
  ```tsx
  // index.tsx:1994-2004
  <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
    <markdown
      syntaxStyle={syntax()}
      streaming={true}
      internalBlockMode="top-level"
      content={props.part.text.trim()}
      tableOptions={{ style: "grid" }}
      conceal={ctx.conceal()}
      fg={theme.markdownText}
      bg={theme.background}
    />
  </box>
  ```
- `AssistantMessage` (`index.tsx:1771`) fans `message.parts` through `PART_MAPPING`
  (`index.tsx:1880`: `text → TextPart`, `tool → ToolPart`, `reasoning → ReasoningPart`).
  Each text part is rendered as its **own** `<markdown>` block with
  `internalBlockMode="top-level"` (one renderable per paragraph-ish block).
- Source of truth for content: `sync.data.part[message.id]` (an array of `Part`s,
  `TextPart.type === "text"`), streamed live. `streaming={true}` keeps the trailing
  block unstable until the turn completes. Width flows from the surrounding
  `<box paddingLeft={3}>`; the session provides `contentWidth =
  dimensions().width - (sidebarVisible ? 42 : 0) - 4` (`index.tsx:288`) via the
  `context().width` getter (`index.tsx:1443`). `useTerminalDimensions()`
  (`index.tsx:258`) is the raw source.
- `fg={theme.markdownText}` sets the **base body** color only. All other token colors
  (headings, links, emphasis, code, blockquote) come from `syntaxStyle={syntax()}`
  (a tree-sitter `SyntaxStyle` from `useTheme()`), **not** from the dedicated
  `theme.markdownHeading/Link/Strong/...` tokens — see §2.3 / Gap 6.

### 2.2 Opentui `MarkdownRenderable` capabilities (read from the engine `.d.ts`)

File: `node_modules/@opentui/core/renderables/Markdown.d.ts`. Driven by `marked` parse
+ tree-sitter highlight. The public surface (`MarkdownOptions`, lines 68-107):

- **Headings**: rendered as styled blocks (level conveyed by markdown highlight scope +
  `markdown-heading` color). No anchor IDs, no collapse.
- **Lists**: `createListRenderable` / `createListItemRenderable` /
  `applyListRenderable` — ordered + unordered, nested, with marker rendering
  (`applyListItemMarker`). Marker/enumerate colors come from syntax style.
- **Tables**: rich `MarkdownTableOptions` (lines 12-67): `style: "grid" | "columns"`,
  `widthMode: "content" | "full"`, `columnFitter`, `wrapMode: "none" | "char" | "word"`,
  `cellPadding`/`cellPaddingX`/`cellPaddingY`, `borders`, `outerBorder`, `borderStyle`,
  `borderColor` (defaults to conceal color), `selectable`. The TUI hard-codes
  `tableOptions={{ style: "grid" }}` and never sets `selectable`/`widthMode`.
- **Links**: `renderInlineToken` + `_linkifyMarkdownChunks` (auto-link bare URLs).
  Colors via syntax style (`markdown-link` / `markdown-link-text` scopes). **No
  keyboard focus/open affordance in the TUI** today (mouse hover/click is engine-level).
- **Blockquotes**: `createBlockquoteRenderable` with `getBlockquoteBorderColor`
  (`markdown-block-quote` scope). Plain `>` quotes only — **GitHub-style alerts
  (`> [!NOTE]`) are NOT special-cased**; they render as ordinary blockquotes.
- **Code**: `createCodeRenderable` + `createMarkdownCodeRenderable` (fenced blocks get
  tree-sitter highlight; `concealCode` hides fences). Inline code via
  `markdown-code` scope.
- **Horizontal rule**: `createHorizontalRuleRenderable` (`markdown-horizontal-rule`).
- **Images**: `markdown-image` / `markdown-image-text` scopes (alt text only in TUI).
- **`conceal`**: hides markdown syntax markers in prose (`index.tsx` passes
  `ctx.conceal()`).
- **`renderNode`** (lines 100-100, 108-115): the **extension point** — given a parsed
  `Token` + `RenderNodeContext`, return a custom `Renderable` (or `null` for default).
  This is how callouts and any Ottili-specific node styling are implemented without
  forking the engine.
- **`internalBlockMode`**: `"coalesced"` (default) vs `"top-level"` (TUI uses the latter
  — preserves one renderable per top-level block so the surrounding `id` box stays
  stable for scroll-to-message and selection).

### 2.3 Theme tokens (Ottili palette is the source)

- **TUI** (`packages/tui/src/theme/index.ts:67-80`) declares a full markdown token set:
  `markdownText, markdownHeading, markdownLink, markdownLinkText, markdownCode,
  markdownBlockQuote, markdownEmph, markdownStrong, markdownHorizontalRule,
  markdownListItem, markdownListEnumeration, markdownImage, markdownImageText,
  markdownCodeBlock`.
- **Web / desktop** (`packages/ui/src/theme/resolve.ts:364-377` and the non-compact
  fallback `:401-414`) define the **same vocabulary** as CSS custom properties
  (`markdown-heading`, `markdown-link`, `markdown-strong`, …), all derived from the
  Ottili palette seeds `primary / accent / success / warning / error / info /
  interactive / neutral+ink` (e.g. `markdown-heading = content(colors.primary, primary)`,
  `markdown-link = content(colors.interactive, interactive)`,
  `markdown-strong = content(colors.accent, accent)`). These are the **canonical color
  source** for the redesign.
- **Gap 6**: the TUI `<markdown>` only passes `fg={theme.markdownText}`; the other 13
  TUI markdown tokens are declared but **not wired** into the markdown element, because
  the engine colors those nodes from `syntaxStyle`. The redesign must reconcile this:
  either (a) feed the Ottili markdown tokens into the `SyntaxStyle` mapping, or
  (b) intercept the relevant tokens in `renderNode` and apply the theme tokens directly.
  Option (b) keeps the engine neutral and gives Ottili explicit control.

### 2.4 Web / desktop renderers (parallel, not terminal)

- **Web** (`packages/ui/src/components/markdown.tsx`): `marked` → `DOMPurify` →
  `morphdom`; adds a **copy button** to fenced code (`createCopyButton`,
  `ensureCodeWrapper`), auto-links bare URLs in inline code (`markCodeLinks`), and a
  streaming splitter (`markdown-stream.ts`). Theme via CSS vars above.
- **Desktop** (`packages/desktop/src/main/markdown.ts`): `marked` with a custom
  `renderer.link` that emits `class="external-link" target="_blank" rel="noopener
  noreferrer"`. (Electron renderer then uses the web component.)
- These two share the **color vocabulary** with the TUI but use HTML/CSS; full engine
  unification is out of scope. The redesign treats the opentui `<markdown>` as the
  single **TUI** renderer and aligns the *token vocabulary* across all three.

### 2.5 Data / state contract (SDK)

- Content lives in `Part` (`@opencode-ai/sdk/v2`, `TextPart.type === "text"`,
  `part.text`). No new SDK field is required for this spec.
- `conceal`, `streaming`, and `width` are local TUI concerns; `width` is already
  available via `useTerminalDimensions()` / `context().width`.
- No backend dependency: unlike the context-meter task (T-CLI-0148), the markdown
  renderer needs **no** new SDK/model enrichment.

### 2.6 Branding & palette

- Color source is the Ottili theme palette (§2.3). Claude Code is a layout/density
  reference only.
- The TUI still imports runtime from `@opencode-ai/{core,sdk,tui}` (package names are the
  fork's identity, not UX copy). The redesign must not (re)introduce OpenCode-branded
  **user-facing strings**; product family is Ottili ONE / Ottili Coder / LD3 / Ottili
  Cloud / Ottili AI.

---

## 3. Gaps

1. **No callouts / GitHub alerts.** `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
   `> [!WARNING]`, `> [!CAUTION]` render as plain blockquotes. Claude Code / GitHub
   render these as colored, titled boxes. This is the headline gap. Fixable via
   `renderNode` (intercept a blockquote whose first child is a `[!TYPE]` paragraph) or a
   `marked` extension — no engine fork.
2. **No link keyboard model.** Links render and are mouse-clickable (engine level), but
   the TUI has **no** keyboard focus ring, "open link" key, or "copy URL" key. Claude
   Code lets you tab/activate links. The TUI has `open` (desktop url) + `clipboardy`
   deps (`package.json:57,61`) ready to use.
3. **No table navigation / width policy.** `MarkdownTableOptions.selectable` exists but
   the TUI never enables it or defines a horizontal-scroll policy for narrow terminals.
   Wide tables overflow or wrap unpredictably.
4. **Markdown theme tokens are dead in the TUI.** 13 of 14 `theme.markdown*` tokens are
   declared but unused by the `<markdown>` element (it relies on `syntaxStyle`). Heading
   / link / strong colors are therefore engine-driven, not Ottili-tunable from one place.
5. **No code-block copy in TUI.** Web has a copy button (`markdown.tsx`); the TUI has
   none. Minor, but expected by users migrating from web/Claude Code.
6. **Heading density not specified.** The engine renders headings from syntax scope; we
   never pin the Ottili heading hierarchy (size/weight/color per level), so density can
   drift from the Claude Code-like target.
7. **OpenCode UX assumption: "markdown is a firehose of plain text."** Today every text
   part is its own top-level `<markdown>` with `streaming` and no structure-aware
   chrome (no callouts, no link affordances, no table policy). The redesign treats
   rendered markdown as a structured, navigable document surface — not raw text.
8. **OpenCode data assumption: links open via the engine only.** There is no Ottili
   policy for which links are safe to open, copy vs open, or how `file://` / relative
   paths behave. The redesign defines an explicit link policy.

---

## 4. Target Interaction Model

### 4.1 Information hierarchy (Claude Code-like, visibly Ottili)

Assistant prose is one continuous, structure-aware document. Visual grammar:

| Element | Treatment | Color (Ottili token) |
| --- | --- | --- |
| Heading H1 | bold, 1 blank line above, no rule | `markdownHeading` (primary) |
| Heading H2 | bold | `markdownHeading` |
| Heading H3–H6 | bold, slightly dimmer per level | `markdownHeading` → `text` |
| Body text | default wrap | `markdownText` |
| Emphasis / Strong | italic / bold | `markdownEmph` / `markdownStrong` (warning / accent) |
| Inline code | boxed chip | `markdownCode` (success) |
| Fenced code | block, tree-sitter highlight, copy key | `markdownCodeBlock` (text) + `border` |
| Unordered list | `•` marker, 2-space indent/level | `markdownListItem` (interactive) |
| Ordered list | `1.` enumeration | `markdownListEnumeration` (info) |
| Blockquote | left rule + tint | `markdownBlockQuote` (warning) |
| Callout | colored left rule + icon + title | accent per type (§4.1a) |
| Table | grid, header row tinted | `border` + `markdownLinkText` header |
| Link | underlined/colored text + focus ring | `markdownLink` / `markdownLinkText` |
| Horizontal rule | dim line | `markdownHorizontalRule` |

4.1a **Callout accent mapping** (Ottili palette only; no new hues):

| Type | Left-rule / icon color | Title color |
| --- | --- | --- |
| `NOTE` | `info` (cyan) | `info` |
| `TIP` | `success` (green) | `success` |
| `IMPORTANT` | `accent` (orange) | `accent` |
| `WARNING` | `warning` (yellow) | `warning` |
| `CAUTION` | `error` (red) | `error` |

Callouts are **collapsible** when longer than N lines (default 6) via a `[+]/[-]`
toggle, matching the existing `ReasoningPart` collapse pattern (`index.tsx:1888-1943`).

### 4.2 Interaction (keyboard-first)

- **Links**: `Tab` / `Shift+Tab` move a link **focus ring** within the active message
  (reuse the TUI focus/selection system). With a link focused:
  - `Enter` / `o` → open URL via `open` (external http/https) or `$EDITOR` for
    `file://` + relative paths resolved against `project.instance.directory()`.
  - `c` → copy URL to clipboard via `clipboardy` (toast: "Link copied").
  - Bare auto-linked URLs use the same model. `javascript:` and other non-http(s)/file
    schemes are **never** opened (security).
- **Code blocks**: `c` (when a code block is focused/hovered, or globally on the active
  message) copies the fenced block; mirrors web `createCopyButton`. Reuse
  `useClipboard()` (`packages/tui/src/context/clipboard`).
- **Callouts**: `[+]/[-]` toggle collapse (mouse `onMouseUp` parity with `ReasoningPart`).
- **Tables**: when `tableOptions.selectable` is enabled and a table is focused,
  `←/→/↑/↓` scroll horizontally / move rows; narrow tables expose horizontal scroll
  instead of clipping. (Implementation follow-up; spec defines the contract.)
- **Message-level**: existing `session.message.next/previous` (`index.tsx:914-926`) and
  `messages.copy` (`index.tsx:928`) continue to work; `messages.copy` already joins text
  parts — it must also strip callout `[!TYPE]` markers when copying (keep readable text).
- All accelerators are registered in the command palette / which-key overlay (parallel
  to the existing `session.bindingCommands`, `index.tsx:122-151`).

### 4.3 Terminal-width behavior

Width is `contentWidth()` (`index.tsx:288`) minus the `paddingLeft={3}` the markdown box
already applies. The renderer wraps to that width; the redesign pins the policy:

| Element | ≥ 100 cols | 60–99 | < 60 |
| --- | --- | --- | --- |
| Headings | full size, 1 blank line above | same | same (no shrink) |
| Lists | 2-space indent/level | same | same; deep nesting wraps marker |
| Tables | `style:"grid"`, `widthMode:"full"` when room, else `content` | `style:"grid"` `widthMode:"content"` | `style:"columns"` (borderless) + horizontal scroll |
| Code | full width, no wrap (`wrapMode:"none"`); `←/→` scroll | same | same |
| Callouts | icon + title + body | title + body | body only (icon optional) |

- Truncation order (right-to-left): drop table horizontal scroll chrome last; never clip
  a heading or a link target. Body text always wraps (`word`).
- `useTerminalDimensions()` is the source; `wide = dimensions().width > 120`
  (`index.tsx:273`) already gates the sidebar — reuse it to choose table `widthMode`.
- Tables default to `widthMode:"content"` and only expand to `"full"` when
  `ctx.width > 100`, preventing overflow on narrow terminals.

### 4.4 Accessibility

- Links and code blocks get an explicit spoken form via Solid `title`/`role` where
  OpenTUI supports it, e.g. `aria-label="Link to https://…, Enter to open"`.
- Color is never the only signal: callouts carry a **title word** (`NOTE`/`TIP`/…) and a
  `[+]/[-]` toggle; tables carry a header row; links carry a visible focus ring.
- All interactions are keyboard-reachable through the existing focus system; link/copy
  commands are documented in the command palette (no mouse required).
- Respect `ctx.conceal()` for markdown markers and `showDetails` parity for any
  code-block chrome.

---

## 5. Component / State Architecture (concrete, implementable)

### 5.1 Shared markdown color token map (one source of truth)

Extract the TUI ⇄ web token vocabulary so all three surfaces name colors identically.
Add a tiny pure module (no engine import):

```ts
// packages/tui/src/markdown/theme.ts  (new, framework-agnostic)
import type { Theme } from "../theme"

export type MarkdownToken =
  | "text" | "heading" | "link" | "linkText" | "code" | "codeBlock"
  | "blockquote" | "emph" | "strong" | "hr" | "listItem"
  | "listEnum" | "image" | "imageText"

// Maps the existing theme.markdown* fields. Web/desktop mirror these names as CSS vars.
export function markdownColor(theme: Theme, token: MarkdownToken): RGBA {
  switch (token) {
    case "text":      return theme.markdownText
    case "heading":   return theme.markdownHeading
    case "link":      return theme.markdownLink
    case "linkText":  return theme.markdownLinkText
    case "code":      return theme.markdownCode
    case "codeBlock": return theme.markdownCodeBlock
    case "blockquote":return theme.markdownBlockQuote
    case "emph":      return theme.markdownEmph
    case "strong":    return theme.markdownStrong
    case "hr":        return theme.markdownHorizontalRule
    case "listItem":  return theme.markdownListItem
    case "listEnum":  return theme.markdownListEnumeration
    case "image":     return theme.markdownImage
    case "imageText": return theme.markdownImageText
  }
}

export type CalloutKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"
export const CALLOUT_COLOR: Record<CalloutKind, keyof Theme> = {
  NOTE: "info", TIP: "success", IMPORTANT: "accent",
  WARNING: "warning", CAUTION: "error",
}
```

This kills Gap 4/6: the Ottili tokens become the single place that controls markdown
color, fed into `renderNode` (§5.3) rather than relying on engine `syntaxStyle`.

### 5.2 TUI state + hooks

Content already lives in `sync.data.part[message.id]`; this spec adds **component-local**
state only — no new sync store field.

```ts
// packages/tui/src/markdown/state.ts  (new)
export function useMarkdownState(partID: string) {
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const clipboard = useClipboard()
  const ctx = useSessionContext()            // existing session context (width, conceal)
  const [focusedLink, setFocusedLink] = createSignal<number>(-1)
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  return {
    width: () => ctx.width,
    wide: () => dimensions().width > 120,
    theme, syntax,
    focusedLink, setFocusedLink,
    collapsed, setCollapsed,
    copy: (text: string) => clipboard.write?.(text),
  }
}
```

Width/streaming/conceal come from existing context — no new backend.

### 5.3 Components (small, reusable)

1. **`<MarkdownView part />`** (`packages/tui/src/markdown/MarkdownView.tsx`, new):
   replaces the inline `<markdown>` in `TextPart` (`index.tsx:1994-2004`). Owns the
   `renderNode` callout interceptor, the theme-color map (§5.1), table `widthMode`
   policy (§4.3), and link/code keyboard handlers (§4.2). Keeps `streaming`,
   `internalBlockMode="top-level"`, `conceal`, `fg`, `syntaxStyle` as today.
   ```tsx
   <markdown
     syntaxStyle={syntax()}
     streaming
     internalBlockMode="top-level"
     content={part.text.trim()}
     fg={theme.markdownText}
     bg={theme.background}
     conceal={ctx.conceal()}
     tableOptions={{
       style: wide() ? "grid" : "columns",
       widthMode: ctx.width > 100 ? "full" : "content",
       wrapMode: "word",
       selectable: true,
     }}
     renderNode={createOttiliMarkdownRenderer({ theme, collapsed, onCopy })}
   />
   ```
2. **`createOttiliMarkdownRenderer`** (in `MarkdownView.tsx`): the `renderNode` factory.
   Intercepts a `blockquote` token whose first paragraph text matches
   `/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i` and returns a `CalloutRenderable`
   (left rule + icon + title + collapsible body, colored via `CALLOUT_COLOR`). All other
   tokens return `context.defaultRender()` (engine default) — no behavior change for
   headings/lists/tables/links. This is the **only** engine-touching change and it is
   purely additive.
3. **Link + code keyboard model**: `MarkdownView` registers `Enter/o` (open), `c` (copy
   URL or focused code block) against the focused link; uses `open` + `clipboardy` +
   `useClipboard()`. Mirrors `messages.copy` (`index.tsx:928`) for the whole message.
4. Reuse, do not duplicate: existing `useTheme()`, `useTerminalDimensions()`,
   `useClipboard()`, `ReasoningPart` collapse pattern (`index.tsx:1888`), and the session
   `context().width`/`conceal`. `TextPart` becomes a 3-line wrapper around `MarkdownView`.

### 5.4 Backend / SDK dependency

**None.** Unlike T-CLI-0148, the markdown renderer is fully local — content, width,
theme, and interaction are all available client-side. The `renderNode` hook in
`@opentui/core` already exists; no engine change is required.

### 5.5 Web app + desktop

- Align the **token vocabulary** only: web `markdown.tsx` / `resolve.ts` already use the
  same `markdown-*` CSS vars (§2.3). Add the **callout** rendering to the web component
  (parse `> [!TYPE]` → styled box) so TUI/web/desktop show identical callouts. Color
  source stays the Ottili palette. Desktop inherits automatically (Electron wraps web).
- No engine change; web uses its own `marked` pipeline, TUI uses opentui — both honor the
  same `markdown-*` tokens and callout grammar.

---

## 6. Removing OpenCode UX Assumptions

- **Markdown is a structured document, not a text firehose.** Stop rendering each text
  part as a bare streaming block with no chrome; add callouts, link affordances, and a
  table policy (Gap 7).
- **Links get an Ottili policy, not engine-default behavior.** Define open/copy/scheme
  rules (§4.2); never open non-http(s)/file schemes (Gap 8).
- **One color source.** Wire the 13 dead `theme.markdown*` tokens (Gap 4/6) through
  `markdownColor` + `renderNode` so Ottili controls markdown color from a single place,
  instead of inheriting engine `syntaxStyle` defaults.
- **No OpenCode-branded copy.** Product strings stay Ottili; Claude Code is a
  layout/density reference only. Runtime package names (`@opencode-ai/*`) are the fork's
  identity and are left as-is (infra, not UX).
- Keep `Part` / `TextPart` wire-compatible; extend the **renderer wrapper**, not the
  session message contract.

---

## 7. Feature Flag

Gate the new `MarkdownView` + callouts + link/code keyboard model behind:

```ts
EVOLUTION_T_CLI_0188_TUI_REDESIGN_MARKDOWN_RENDERER__INT_ENABLED = false
```

Use the existing `Flag` mechanism (`@opencode-ai/core/flag/flag`, already imported across
the TUI, e.g. `Flag.OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE` at `index.tsx:1167`).
Default `false`; enable after staging validation. When off, `TextPart` renders the
current inline `<markdown>` exactly as today (no callouts, no link focus) — zero
regression surface.

---

## 8. Edge Cases / States

- **Empty / whitespace-only part**: `TextPart` already guards `props.part.text.trim()`
  (`index.tsx:1993`); `MarkdownView` keeps the guard — renders nothing.
- **Streaming mid-block**: `streaming` stays `true` until the turn completes; trailing
  block remains unstable (engine semantics, `Markdown.d.ts:78-91`). Callout
  collapse/interception only finalizes on completion.
- **Malformed `> [!TYPE]`**: if the marker paragraph has no body, render as a plain
  single-line callout (title only), never throw.
- **Unsafe link** (`javascript:`, `data:`, relative without project dir): open is
  blocked; copy still allowed. No crash.
- **Narrow terminal (< 60)**: tables fall back to `style:"columns"` + horizontal scroll;
  headings/links never clip.
- **No theme / fallback palette**: `markdownColor` falls back to `theme.text` for any
  unset token (same as `resolve.ts:444-449` markdown-text fallback).
- **Concurrent session switch**: width/content come from the active `context()` +
  `part.id`; no global markdown state, so no cross-session leakage.
- **Copy while streaming**: `messages.copy` (`index.tsx:928`) and code-copy copy the
  current snapshot; callout `[!TYPE]` markers are stripped to keep copied text readable.

---

## 9. Validation Plan (for the implementation follow-up)

- `bun run --cwd packages/tui typecheck`
- `bun run --cwd packages/tui test` (add a render test for `<MarkdownView>` covering:
  plain prose, H1–H3, nested list, grid + columns table at wide/narrow, a `> [!WARNING]`
  callout collapsed/expanded, an auto-linked URL with focus + copy; and a unit test for
  `markdownColor` + the callout `[!TYPE]` parser).
- `bun run --cwd packages/ottili-coder typecheck` (no backend change expected; guard).
- `bun run lint`
- `git diff --check`
- Manual: `tmux` TUI smoke at ≥100 / 60–99 / <60 cols; verify callout colors match
  `CALLOUT_COLOR`, link open/copy, code copy, and `messages.copy` stripping `[!TYPE]`;
  web/desktop callout parity.

---

## 10. Open Questions (for human review)

1. Callout parser location: `renderNode` interception (keeps engine neutral, recommended)
   vs a `marked` extension shared with web/desktop. Recommend `renderNode` for TUI,
   parallel `marked` extension for web.
2. Table navigation depth: full `←/→/↑/↓` cell navigation vs horizontal-scroll-only on
   narrow. Recommend scroll-only first, cell nav as a later enhancement.
3. Link focus scope: per-message Tab cycle (recommended) vs global session-wide link
   registry. Confirm the focus-ring integrates with the existing selection system
   without conflicting with text selection.
4. Should `messages.copy` strip callout markers by default, or preserve them as Markdown?
   Recommend strip for readability (matches web copy button behavior).
5. Glyph set for callout icons / collapse `[+]/[-]`: confirm render in target terminals;
   ASCII fallback if needed (matches the context-meter glyph decision, T-CLI-0148 §10.3).
