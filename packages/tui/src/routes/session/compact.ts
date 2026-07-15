// Compact mode layout decisions (T-CLI-0209). High-density layout for small
// terminals and power users. Kept pure so they can be unit-tested without
// mounting the full session route. Mirrors the inline visibility/spacing
// contracts from specs/tui/compact-mode.md §5.2–§5.3.
export type CompactSpacing = {
  paddingLeft: number
  paddingRight: number
  paddingBottom: number
  messageGap: number
  messagePaddingY: number
  messagePaddingX: number
}

const STANDARD: CompactSpacing = {
  paddingLeft: 2,
  paddingRight: 2,
  paddingBottom: 1,
  messageGap: 1,
  messagePaddingY: 1,
  messagePaddingX: 2,
}

const COMPACT: CompactSpacing = {
  paddingLeft: 1,
  paddingRight: 1,
  paddingBottom: 0,
  messageGap: 0,
  messagePaddingY: 0,
  messagePaddingX: 1,
}

// Derive the transcript spacing for the current density. The decision is a
// pure function of the gated compact flag, so it never reads streaming
// content: the surface stays fixed while the assistant streams.
export function computeCompactSpacing(params: { compact: boolean }): CompactSpacing {
  return params.compact ? COMPACT : STANDARD
}

// Whether the header strip should render in its condensed single-line form.
// Compact mode keeps the header visible (unlike focus mode, which hides it)
// but collapses its border and vertical padding into one dense row.
export function computeCompactChrome(params: {
  compact: boolean
  headerVisible: boolean
}): { headerCondensed: boolean } {
  return {
    headerCondensed: params.compact && params.headerVisible,
  }
}
