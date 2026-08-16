import { describe, expect, test } from "bun:test"
import {
  RESPONSIVE_BREAKPOINTS,
  SIDEBAR_DOCKED_WIDTH,
  computeResponsiveLayout,
  resolveLayoutTier,
  type ResponsiveLayoutInput,
} from "./model"

function input(overrides: Partial<ResponsiveLayoutInput> = {}): ResponsiveLayoutInput {
  return {
    width: 200,
    height: 50,
    parentID: false,
    focused: false,
    sidebarOpen: false,
    sidebarAuto: true,
    compactMode: false,
    redesignEnabled: true,
    ...overrides,
  }
}

describe("resolveLayoutTier", () => {
  test("classifies below narrow as narrow", () => {
    expect(resolveLayoutTier(40)).toBe("narrow")
    expect(resolveLayoutTier(RESPONSIVE_BREAKPOINTS.narrow - 1)).toBe("narrow")
  })
  test("classifies 60-99 as compact", () => {
    expect(resolveLayoutTier(60)).toBe("compact")
    expect(resolveLayoutTier(99)).toBe("compact")
  })
  test("classifies 100-119 as standard", () => {
    expect(resolveLayoutTier(100)).toBe("standard")
    expect(resolveLayoutTier(119)).toBe("standard")
  })
  test("classifies >= 120 as wide", () => {
    expect(resolveLayoutTier(120)).toBe("wide")
    expect(resolveLayoutTier(240)).toBe("wide")
  })
})

describe("computeResponsiveLayout — legacy (flag off)", () => {
  test("reproduces the historical >120 docked-sidebar gate", () => {
    const wide = computeResponsiveLayout(input({ width: 200, redesignEnabled: false }))
    expect(wide.sidebarMode).toBe("docked")
    expect(wide.toolDiffView).toBe("split")
    expect(wide.sidebarWidth).toBe(SIDEBAR_DOCKED_WIDTH)
    expect(wide.contentPadding).toBe(2)

    // Auto sidebar is hidden below the wide gate (matches computeSidebarVisible).
    const autoNarrow = computeResponsiveLayout(input({ width: 80, redesignEnabled: false }))
    expect(autoNarrow.sidebarMode).toBe("hidden")
    expect(autoNarrow.toolDiffView).toBe("unified")

    // A manually opened sidebar overlays on a narrow terminal.
    const openedNarrow = computeResponsiveLayout(input({ width: 80, sidebarOpen: true, redesignEnabled: false }))
    expect(openedNarrow.sidebarMode).toBe("overlay")
  })
  test("legacy hides sidebar under parent or focus", () => {
    expect(computeResponsiveLayout(input({ width: 200, parentID: true, redesignEnabled: false })).sidebarMode).toBe(
      "hidden",
    )
    expect(computeResponsiveLayout(input({ width: 200, focused: true, redesignEnabled: false })).sidebarMode).toBe(
      "hidden",
    )
  })
})

describe("computeResponsiveLayout — redesign (flag on)", () => {
  test("wide + auto sidebar docks", () => {
    const s = computeResponsiveLayout(input({ width: 200 }))
    expect(s.tier).toBe("wide")
    expect(s.sidebarMode).toBe("docked")
    expect(s.headerDensity).toBe("full")
    expect(s.toolDiffView).toBe("split")
  })
  test("standard + auto sidebar still docks (preserves current >=120 behavior)", () => {
    const s = computeResponsiveLayout(input({ width: 110 }))
    expect(s.tier).toBe("standard")
    expect(s.sidebarMode).toBe("docked")
    expect(s.contentPadding).toBe(2)
  })
  test("compact tier hides the auto sidebar but overlays it when opened, and condenses the header", () => {
    const auto = computeResponsiveLayout(input({ width: 80 }))
    expect(auto.tier).toBe("compact")
    expect(auto.sidebarMode).toBe("hidden")
    expect(auto.headerDensity).toBe("condensed")
    expect(auto.autoCompact).toBe(true)
    expect(auto.contentPadding).toBe(1)
    expect(auto.toolDiffView).toBe("unified")

    const opened = computeResponsiveLayout(input({ width: 80, sidebarOpen: true }))
    expect(opened.sidebarMode).toBe("overlay")
  })
  test("narrow tier tightens padding to the floor and keeps the auto sidebar hidden", () => {
    const s = computeResponsiveLayout(input({ width: 50 }))
    expect(s.tier).toBe("narrow")
    expect(s.sidebarMode).toBe("hidden")
    expect(s.contentPadding).toBe(1)
  })
  test("explicit sidebarOpen docks on wide/standard, overlays on compact/narrow", () => {
    expect(computeResponsiveLayout(input({ width: 200, sidebarOpen: true })).sidebarMode).toBe("docked")
    expect(computeResponsiveLayout(input({ width: 110, sidebarOpen: true })).sidebarMode).toBe("docked")
    expect(computeResponsiveLayout(input({ width: 80, sidebarOpen: true })).sidebarMode).toBe("overlay")
    expect(computeResponsiveLayout(input({ width: 50, sidebarOpen: true })).sidebarMode).toBe("overlay")
  })
  test("focus mode hides sidebar and minimizes the header", () => {
    const s = computeResponsiveLayout(input({ width: 200, focused: true }))
    expect(s.sidebarMode).toBe("hidden")
    expect(s.headerDensity).toBe("minimal")
  })
  test("parent session hides the sidebar", () => {
    expect(computeResponsiveLayout(input({ width: 200, parentID: true })).sidebarMode).toBe("hidden")
  })
  test("manual compact_mode suppresses autoCompact", () => {
    expect(computeResponsiveLayout(input({ width: 80, compactMode: true })).autoCompact).toBe(false)
  })
  test("docked width is reported only when docked", () => {
    expect(computeResponsiveLayout(input({ width: 200 })).sidebarWidth).toBe(SIDEBAR_DOCKED_WIDTH)
    expect(computeResponsiveLayout(input({ width: 80 })).sidebarWidth).toBe(0)
  })
})
