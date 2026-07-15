import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { computeCompactChrome, computeCompactSpacing } from "./compact"

// Compact mode layout contract (specs/tui/compact-mode.md §5.2–§5.3, §8).
// The session route derives its density from these two pure functions, so the
// tests assert *semantic* visible output (which padding/header form is shown)
// rather than implementation trivia. No timers: every case is a pure function
// evaluation, which keeps the suite stable in CI.

const FLAG = "EVOLUTION_T_CLI_0209_TUI_REDESIGN_COMPACT_MODE__CORE_IMP_ENABLED"

// The single source of truth for the derived chrome + spacing the session
// route applies when Compact mode engages. Mirrors routes/session/index.tsx:
// spacing memo -> contentWidth; chrome memo -> headerCondensed.
function visibleDensity(p: { compact: boolean; headerVisible: boolean; sidebarVisible: boolean; width: number }) {
  const spacing = computeCompactSpacing({ compact: p.compact })
  const chrome = computeCompactChrome({ compact: p.compact, headerVisible: p.headerVisible })
  const contentWidth = p.width - (p.sidebarVisible ? 42 : 0) - spacing.paddingLeft - spacing.paddingRight
  return {
    spacing,
    headerCondensed: chrome.headerCondensed,
    contentWidth,
  }
}

// Compact mode does not gate the sidebar (unlike focus mode), so the sidebar
// visibility is modeled by the caller exactly as the route does.
const WIDE = { sidebarVisible: false, width: 200, headerVisible: true }
const NARROW = { ...WIDE, width: 60 }

describe("compact mode spacing is a strict high-density override", () => {
  test("compact mode tightens every padding axis vs the standard layout", () => {
    const standard = computeCompactSpacing({ compact: false })
    const compact = computeCompactSpacing({ compact: true })
    expect(compact.paddingLeft).toBeLessThan(standard.paddingLeft)
    expect(compact.paddingRight).toBeLessThan(standard.paddingRight)
    expect(compact.paddingBottom).toBeLessThan(standard.paddingBottom)
    expect(compact.messageGap).toBeLessThan(standard.messageGap)
    expect(compact.messagePaddingY).toBeLessThan(standard.messagePaddingY)
    expect(compact.messagePaddingX).toBeLessThan(standard.messagePaddingX)
  })

  test("standard layout keeps breathing room (paddingLeft 2, messageGap 1)", () => {
    const standard = computeCompactSpacing({ compact: false })
    expect(standard.paddingLeft).toBe(2)
    expect(standard.messageGap).toBe(1)
    expect(standard.messagePaddingY).toBe(1)
  })

  test("compact layout collapses to a single dense row (paddingLeft 1, messageGap 0)", () => {
    const compact = computeCompactSpacing({ compact: true })
    expect(compact.paddingLeft).toBe(1)
    expect(compact.messageGap).toBe(0)
    expect(compact.messagePaddingY).toBe(0)
    expect(compact.paddingBottom).toBe(0)
  })

  test("toggling compact flips the spacing set without touching anything else", () => {
    const detailed = computeCompactSpacing({ compact: false })
    const dense = computeCompactSpacing({ compact: true })
    expect(dense).not.toEqual(detailed)
    // The two states are the only two members of the density contract.
    expect(computeCompactSpacing({ compact: false })).toEqual(detailed)
    expect(computeCompactSpacing({ compact: true })).toEqual(dense)
  })
})

describe("compact mode chrome: header condenses, never hides", () => {
  test("compact mode over a visible header condenses it into one dense row", () => {
    const chrome = computeCompactChrome({ compact: true, headerVisible: true })
    expect(chrome.headerCondensed).toBe(true)
  })

  test("compact mode with no header does not invent a condensed header", () => {
    const chrome = computeCompactChrome({ compact: true, headerVisible: false })
    expect(chrome.headerCondensed).toBe(false)
  })

  test("standard (non-compact) mode never condenses the header", () => {
    expect(computeCompactChrome({ compact: false, headerVisible: true }).headerCondensed).toBe(false)
    expect(computeCompactChrome({ compact: false, headerVisible: false }).headerCondensed).toBe(false)
  })

  test("condensing is orthogonal to hiding: compact keeps the header visible, just dense", () => {
    // The route composes focus chrome (which may hide) with compact chrome
    // (which only condenses). A detailed view with the header shown yields a
    // condensed header, never a missing one.
    const detailed = visibleDensity({ ...WIDE, compact: false })
    const compact = visibleDensity({ ...WIDE, compact: true })
    expect(detailed.headerCondensed).toBe(false)
    expect(compact.headerCondensed).toBe(true)
  })
})

describe("compact mode state toggle is a pure transition", () => {
  // session.compact.toggle runs setCompactMode(prev => !prev); the route
  // computes compact() = compactMode() && flag. The toggle must flip exactly
  // the spacing density and the header condensation and nothing else.
  function at(compact: boolean) {
    return visibleDensity({ ...WIDE, compact, headerVisible: true })
  }

  test("entering compact tightens spacing and condenses the header", () => {
    const detailed = at(false)
    const compact = at(true)
    expect(detailed.spacing.paddingLeft).toBe(2)
    expect(compact.spacing.paddingLeft).toBe(1)
    expect(detailed.headerCondensed).toBe(false)
    expect(compact.headerCondensed).toBe(true)
  })

  test("exiting compact restores the detailed layout exactly", () => {
    const compact = at(true)
    const detailed = at(false)
    expect(compact.spacing.paddingLeft).toBe(1)
    expect(detailed.spacing.paddingLeft).toBe(2)
    expect(compact.headerCondensed).toBe(true)
    expect(detailed.headerCondensed).toBe(false)
  })

  test("repeated toggles alternate the density and converge to the start state", () => {
    const baseline = at(false)
    const afterOne = at(!false)
    const afterTwo = at(!!false)
    expect(afterOne.headerCondensed).toBe(true)
    expect(afterTwo.headerCondensed).toBe(false)
    expect(afterTwo).toEqual(baseline)
  })

  test("content width grows by exactly the padding the compact layout sheds", () => {
    const detailed = at(false)
    const compact = at(true)
    // Standard padding 2+2=4, compact padding 1+1=2 -> compact reclaims 2 cols.
    expect(compact.contentWidth - detailed.contentWidth).toBe(2)
  })
})

describe("compact mode honors narrow and standard terminal dimensions", () => {
  // contentWidth = width - (sidebarVisible ? 42 : 0) - paddingLeft - paddingRight.
  // Compact mode only changes the padding, so it grants the same 2 extra
  // columns at every terminal width, including small terminals.
  function gain(width: number, sidebarVisible: boolean) {
    const detailed = visibleDensity({ width, sidebarVisible, compact: false, headerVisible: true })
    const compact = visibleDensity({ width, sidebarVisible, compact: true, headerVisible: true })
    // Compact mode sheds padding, so it reclaims columns: compact > detailed.
    return compact.contentWidth - detailed.contentWidth
  }

  test("standard width (>=120): compact mode widens the transcript by 2 columns", () => {
    expect(gain(120, false)).toBe(2)
    expect(visibleDensity({ ...WIDE, compact: true }).contentWidth).toBe(200 - 1 - 1)
  })

  test("narrow width (<80): compact mode still grants the full 2-column gain", () => {
    expect(gain(60, false)).toBe(2)
    expect(gain(40, false)).toBe(2)
    expect(visibleDensity({ ...NARROW, compact: true }).contentWidth).toBe(60 - 1 - 1)
  })

  test("with the sidebar open compact still reclaims exactly 2 columns", () => {
    expect(gain(200, true)).toBe(2)
    expect(gain(80, true)).toBe(2)
  })

  test("compact yields a consistent density gain across 60, 80, 120 and 200 columns", () => {
    const widths = [60, 80, 120, 200]
    const gains = widths.map((w) => gain(w, false))
    expect(gains).toEqual([2, 2, 2, 2])
  })
})

describe("compact mode is stable across streaming transcript updates", () => {
  // Streaming only changes message content, which these functions never read.
  // Density and chrome must stay fixed while the assistant streams, so the
  // surface neither flickers open padding nor un-condenses the header.
  test("density and chrome are invariant while messages stream in", () => {
    const base = { compact: true, headerVisible: true, sidebarVisible: false, width: 120 }
    for (const messages of [0, 1, 5, 42, 1000]) {
      // `messages` models streaming progress; the layout contract ignores it.
      const d = visibleDensity(base)
      expect(d.spacing.paddingLeft).toBe(1)
      expect(d.headerCondensed).toBe(true)
      expect(d.contentWidth).toBe(120 - 1 - 1)
    }
  })

  test("functions are pure and deterministic for identical inputs", () => {
    const spacing = computeCompactSpacing({ compact: true })
    const chrome = computeCompactChrome({ compact: true, headerVisible: true })
    expect(computeCompactSpacing({ compact: true })).toEqual(spacing)
    expect(computeCompactChrome({ compact: true, headerVisible: true })).toEqual(chrome)
  })
})

describe("compact mode failure path: the feature flag gates engagement", () => {
  // The session route computes compact() = compactMode() && flag. When the flag
  // is off, compact() is forced false, so the session renders exactly as today
  // (zero regression) and Compact mode cannot engage. Test the gate directly,
  // mirroring the route's `compact()` derivation.
  const saved = process.env[FLAG]
  // Mirror routes/session/index.tsx: compact() = compactMode() && flag.
  const routeCompact = (signal: boolean) =>
    signal && Flag.EVOLUTION_T_CLI_0209_TUI_REDESIGN_COMPACT_MODE__CORE_IMP_ENABLED

  beforeEach(() => {
    delete process.env[FLAG]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved
  })

  test("flag is off by default: compact mode cannot engage", () => {
    expect(Flag.EVOLUTION_T_CLI_0209_TUI_REDESIGN_COMPACT_MODE__CORE_IMP_ENABLED).toBe(false)
    expect(routeCompact(true)).toBe(false)
  })

  test("flag on enables the compact-mode engagement gate", () => {
    process.env[FLAG] = "true"
    expect(Flag.EVOLUTION_T_CLI_0209_TUI_REDESIGN_COMPACT_MODE__CORE_IMP_ENABLED).toBe(true)
    expect(routeCompact(true)).toBe(true)
  })

  test("flag explicitly disabled forces compact off even if requested", () => {
    process.env[FLAG] = "false"
    expect(Flag.EVOLUTION_T_CLI_0209_TUI_REDESIGN_COMPACT_MODE__CORE_IMP_ENABLED).toBe(false)
    expect(routeCompact(true)).toBe(false)
  })

  test("with the flag off the visible density never leaves the detailed view", () => {
    process.env[FLAG] = "false"
    const effectiveCompact = routeCompact(true)
    expect(effectiveCompact).toBe(false)
    // The effective (gated) compact state keeps the detailed layout intact.
    const density = visibleDensity({ ...WIDE, compact: effectiveCompact, headerVisible: true })
    expect(density.headerCondensed).toBe(false)
    expect(density.spacing.paddingLeft).toBe(2)
    expect(density.contentWidth).toBe(200 - 2 - 2)
  })
})
