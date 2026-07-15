import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { computeFocusChrome, computeSidebarVisible } from "./focus"

// Focus mode visibility contract (specs/tui/focus-mode.md §5.2–§5.3, §8).
// The session route derives its chrome from these two pure functions, so the
// tests assert *semantic* visible output (which regions are shown) rather than
// implementation trivia. No timers: every case is a pure function evaluation.

const FLAG = "EVOLUTION_T_CLI_0205_TUI_REDESIGN_FOCUS_MODE__CORE_IMPLE_ENABLED"

type SidebarParams = Parameters<typeof computeSidebarVisible>[0]
type ChromeParams = Parameters<typeof computeFocusChrome>[0]

// The single source of truth for the visible chrome set in the session route.
// Mirrors routes/session/index.tsx: sidebarVisible memo -> chrome memo.
function visibleChrome(p: SidebarParams & Pick<ChromeParams, "sessionExists">) {
  const sidebarVisible = computeSidebarVisible(p)
  const chrome = computeFocusChrome({
    focused: p.focused,
    sessionExists: p.sessionExists,
    sidebarVisible,
  })
  return {
    sidebar: sidebarVisible,
    header: chrome.headerVisible,
    focusHint: chrome.focusHintVisible,
  }
}

// Content-width contract reused from routes/session/index.tsx:290. When the
// sidebar is hidden the transcript gains the 42 columns it would have consumed.
function contentWidth(width: number, p: SidebarParams) {
  const sidebarVisible = computeSidebarVisible(p)
  return width - (sidebarVisible ? 42 : 0) - 4
}

const WIDE = { parentID: false, focused: false, sidebarOpen: false, sidebarAuto: true, wide: true }
const NARROW = { ...WIDE, wide: false }

describe("focus mode sidebar visibility is a strict override", () => {
  test("focus mode hides the sidebar even on a wide terminal with auto sidebar", () => {
    expect(computeSidebarVisible({ ...WIDE, focused: true })).toBe(false)
  })

  test("focus mode hides the sidebar even when it was explicitly opened", () => {
    expect(computeSidebarVisible({ ...WIDE, focused: true, sidebarOpen: true })).toBe(false)
  })

  test("focus mode wins over an open sidebar overlay request", () => {
    const open = computeSidebarVisible({ parentID: false, focused: true, sidebarOpen: true, sidebarAuto: true, wide: true })
    expect(open).toBe(false)
  })

  test("a subagent (parentID) session never shows a sidebar, focused or not", () => {
    expect(computeSidebarVisible({ ...WIDE, parentID: true, focused: false })).toBe(false)
    expect(computeSidebarVisible({ ...WIDE, parentID: true, focused: true })).toBe(false)
  })

  test("standard width with auto sidebar shows it when not focused", () => {
    expect(computeSidebarVisible(WIDE)).toBe(true)
  })

  test("narrow width hides the auto sidebar until explicitly opened", () => {
    expect(computeSidebarVisible(NARROW)).toBe(false)
    expect(computeSidebarVisible({ ...NARROW, sidebarOpen: true })).toBe(true)
  })
})

describe("focus mode chrome: header drops, focus hint appears", () => {
  test("detailed view (session, no sidebar, not focused) shows the header and no hint", () => {
    const chrome = visibleChrome({
      parentID: false,
      focused: false,
      sidebarOpen: false,
      sidebarAuto: false,
      wide: false,
      sessionExists: true,
    })
    expect(chrome).toEqual({ sidebar: false, header: true, focusHint: false })
  })

  test("focused with an active session hides the header and shows the focus hint", () => {
    const chrome = visibleChrome({ ...WIDE, focused: true, sessionExists: true })
    expect(chrome).toEqual({ sidebar: false, header: false, focusHint: true })
  })

  test("an open sidebar suppresses the header even when not focused (baseline contract)", () => {
    const chrome = visibleChrome({ ...WIDE, focused: false, sessionExists: true })
    expect(chrome.sidebar).toBe(true)
    expect(chrome.header).toBe(false)
    expect(chrome.focusHint).toBe(false)
  })

  test("edge: focusing with no active session shows the hint but never a header", () => {
    const chrome = visibleChrome({ ...WIDE, focused: true, sessionExists: false })
    expect(chrome.header).toBe(false)
    expect(chrome.focusHint).toBe(true)
  })

  test("edge: no session and not focused renders a fully bare surface", () => {
    const chrome = visibleChrome({ ...WIDE, focused: false, sessionExists: false })
    expect(chrome).toEqual({ sidebar: false, header: false, focusHint: false })
  })
})

describe("focus mode keyboard toggle is a pure state transition", () => {
  // session.focus.toggle runs setFocus(prev => !prev); the route computes
  // focused() = focus() && flag. The toggle must flip exactly the header and
  // focus-hint regions and nothing else.
  function at(focused: boolean) {
    return visibleChrome({ ...WIDE, focused, sessionExists: true })
  }

  test("entering focus from the detailed view drops the header and reveals the hint", () => {
    const detailed = at(false)
    const focused = at(true)
    expect(detailed.header).toBe(true)
    expect(detailed.focusHint).toBe(false)
    expect(focused.header).toBe(false)
    expect(focused.focusHint).toBe(true)
    // The sidebar was already hidden in the detailed view; focus does not reopen it.
    expect(focused.sidebar).toBe(false)
  })

  test("exiting focus restores the detailed view exactly", () => {
    const focused = at(true)
    const detailed = at(false)
    expect(focused.focusHint).toBe(true)
    expect(detailed.focusHint).toBe(false)
    expect(detailed.sidebar).toBe(true)
  })

  test("repeated toggles alternate the hint and converge to the start state", () => {
    const baseline = at(false)
    const afterOne = at(!false)
    const afterTwo = at(!!false)
    expect(afterOne.focusHint).toBe(true)
    expect(afterTwo.focusHint).toBe(false)
    expect(afterTwo).toEqual(baseline)
  })
})

describe("focus mode honors narrow and standard terminal dimensions", () => {
  // contentWidth = width - (sidebarVisible ? 42 : 0) - 4. Focus mode forces the
  // sidebar off, so the transcript reclaims the 42 columns at every width.
  test("standard width (≥120): focus mode widens the transcript by 42 columns", () => {
    const detailed = contentWidth(120, WIDE)
    const focused = contentWidth(120, { ...WIDE, focused: true })
    expect(focused - detailed).toBe(42)
    expect(focused).toBe(120 - 4)
  })

  test("narrow width (<80): focus mode still grants full transcript width", () => {
    const detailed = contentWidth(40, NARROW)
    const focused = contentWidth(40, { ...NARROW, focused: true })
    expect(focused - detailed).toBe(42)
    expect(focused).toBe(40 - 4)
  })

  test("focus mode yields identical content width at 80, 120 and 200 columns", () => {
    const widths = [80, 120, 200]
    const focusedWidths = widths.map((w) => contentWidth(w, { ...WIDE, focused: true }))
    expect(focusedWidths).toEqual(widths.map((w) => w - 4))
  })
})

describe("focus mode is stable across streaming transcript updates", () => {
  // Streaming only changes message content, which these functions never read.
  // Chrome must stay fixed while the assistant streams, so the surface neither
  // flickers open a header nor drops the focus hint mid-response.
  test("chrome is invariant while messages stream in", () => {
    const base = { ...WIDE, focused: true, sessionExists: true }
    for (const messages of [0, 1, 5, 42, 1000]) {
      // `messages` models streaming progress; the visibility contract ignores it.
      expect(visibleChrome({ ...base })).toEqual({ sidebar: false, header: false, focusHint: true })
    }
  })

  test("functions are pure and deterministic for identical inputs", () => {
    const sidebar = computeSidebarVisible(WIDE)
    const chrome = computeFocusChrome({ focused: true, sessionExists: true, sidebarVisible: false })
    expect(computeSidebarVisible(WIDE)).toEqual(sidebar)
    expect(
      computeFocusChrome({ focused: true, sessionExists: true, sidebarVisible: false }),
    ).toEqual(chrome)
  })
})

describe("focus mode failure path: the feature flag gates engagement", () => {
  // The session route computes focused() = focus() && flag. When the flag is off,
  // focused() is forced false, so the session renders exactly as today (zero
  // regression) and focus mode cannot engage. Test the gate directly, mirroring
  // the route's `focused()` derivation.
  const saved = process.env[FLAG]
  // Mirror routes/session/index.tsx: focused() = focus() && flag.
  const routeFocused = (signal: boolean) =>
    signal && Flag.EVOLUTION_T_CLI_0205_TUI_REDESIGN_FOCUS_MODE__CORE_IMPLE_ENABLED

  beforeEach(() => {
    delete process.env[FLAG]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved
  })

  test("flag is off by default: focus mode cannot engage", () => {
    expect(Flag.EVOLUTION_T_CLI_0205_TUI_REDESIGN_FOCUS_MODE__CORE_IMPLE_ENABLED).toBe(false)
    expect(routeFocused(true)).toBe(false)
  })

  test("flag on enables the focus-mode engagement gate", () => {
    process.env[FLAG] = "true"
    expect(Flag.EVOLUTION_T_CLI_0205_TUI_REDESIGN_FOCUS_MODE__CORE_IMPLE_ENABLED).toBe(true)
    expect(routeFocused(true)).toBe(true)
  })

  test("flag explicitly disabled forces focus off even if requested", () => {
    process.env[FLAG] = "false"
    expect(Flag.EVOLUTION_T_CLI_0205_TUI_REDESIGN_FOCUS_MODE__CORE_IMPLE_ENABLED).toBe(false)
    expect(routeFocused(true)).toBe(false)
  })

  test("with the flag off the visible chrome never leaves the detailed view", () => {
    process.env[FLAG] = "false"
    const effectiveFocused = routeFocused(true)
    expect(effectiveFocused).toBe(false)
    // The effective (gated) focused state keeps the detailed view intact.
    const chrome = visibleChrome({ ...WIDE, focused: effectiveFocused, sessionExists: true })
    expect(chrome.focusHint).toBe(false)
    expect(chrome.sidebar).toBe(true)
  })
})
