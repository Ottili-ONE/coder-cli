// Shared web/desktop code block surface for Ottili Coder.
//
// The web markdown (`markdown.tsx`) renders fenced blocks as `<pre>` elements
// and decorates them with a copy button. This module extends that surface with
// the redesigned shared vocabulary: a header carrying the language + line count
// and a wrap toggle. Colors come from the same `markdown-*` / `syntax-*` CSS
// custom properties used everywhere else (see `theme/resolve.ts`), so the TUI,
// web and desktop code blocks stay visually consistent.

export interface CodeBlockLabels {
  copy: string
  copied: string
  wrap: string
}

/** Resolve the fence language from a `<pre>`'s inner `<code>` class. */
export function getCodeLanguage(pre: HTMLPreElement): string | null {
  const code = pre.querySelector("code")
  const className = code?.className ?? ""
  const match = className.match(/language-([\w-]+)/)
  return match ? match[1]! : null
}

function countLines(text: string | null | undefined): number {
  if (!text) return 0
  const trimmed = text.replace(/\n+$/, "")
  if (trimmed === "") return 0
  return trimmed.split("\n").length
}

/**
 * Build the code-block header (language · line count · wrap toggle). The wrap
 * toggle flips `data-wrap` on the `<pre>` and the inline `white-space` so the
 * block wraps within its container instead of overflowing horizontally.
 */
export function createCodeBlockHeader(pre: HTMLPreElement, labels: CodeBlockLabels): HTMLDivElement {
  const header = document.createElement("div")
  header.setAttribute("data-component", "markdown-code-header")

  const lang = document.createElement("span")
  lang.setAttribute("data-slot", "markdown-code-lang")
  lang.textContent = getCodeLanguage(pre) ?? "text"

  const count = document.createElement("span")
  count.setAttribute("data-slot", "markdown-code-count")
  const lines = countLines(pre.textContent)
  count.textContent = `${lines} line${lines === 1 ? "" : "s"}`

  const wrap = document.createElement("button")
  wrap.type = "button"
  wrap.setAttribute("data-component", "icon-button")
  wrap.setAttribute("data-size", "small")
  wrap.setAttribute("data-slot", "markdown-wrap-button")
  wrap.setAttribute("aria-label", labels.wrap)
  wrap.setAttribute("data-tooltip", labels.wrap)
  wrap.textContent = labels.wrap
  wrap.addEventListener("click", () => {
    const on = pre.getAttribute("data-wrap") === "true"
    const next = !on
    pre.setAttribute("data-wrap", next ? "true" : "false")
    pre.style.whiteSpace = next ? "pre-wrap" : "pre"
    wrap.setAttribute("data-active", next ? "true" : "false")
  })

  header.append(lang, count, wrap)
  return header
}
