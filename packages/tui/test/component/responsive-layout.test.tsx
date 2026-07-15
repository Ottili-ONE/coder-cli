/** @jsxImportSource @opentui/solid */
// Responsive terminal layout — interaction & regression tests (T-CLI-0215).
//
// These tests exercise the reactive `useResponsiveLayout` hook through the
// real opentui renderer so they assert visible / semantic layout output at
// genuine terminal dimensions (narrow SSH terminals up to wide local
// terminals), plus the resize behavior opentui drives on SIGWINCH. They are
// deterministic: no timing sleeps, every assertion is a function of the
// explicit width/height and focus/sidebar inputs.
//
// The redesign tiering only activates when the T-CLI-0212 feature flag is on,
// so the whole file enables it through the documented env gate.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { useResponsiveLayout } from "../../src/component/responsive-layout/index"
import type { ResponsiveLayoutState } from "../../src/component/responsive-layout/model"

const FLAG = "EVOLUTION_T_CLI_0212_TUI_REDESIGN_RESPONSIVE_TERMINAL_LAY_ENABLED"

beforeAll(() => {
  process.env[FLAG] = "true"
})
afterAll(() => {
  delete process.env[FLAG]
})

// Captures the live layout state of the hook plus renders a compact human
// readable summary so we assert both the semantic object and the visible text.
async function mountHarness(params: {
  width: number
  height: number
  parentID?: boolean
  focused?: boolean
  sidebarOpen?: boolean
  sidebarAuto?: boolean
  compactMode?: boolean
}) {
  let layout: ResponsiveLayoutState | undefined
  function Harness() {
    const resolved = useResponsiveLayout({
      parentID: params.parentID ?? false,
      focused: params.focused ?? false,
      sidebarOpen: params.sidebarOpen ?? false,
      sidebarAuto: params.sidebarAuto ?? true,
      compactMode: params.compactMode ?? false,
    })
    layout = resolved()
    return (
      <box>
        <text>{`tier=${layout.tier}`}</text>
        <text>{`sidebar=${layout.sidebarMode}`}</text>
        <text>{`header=${layout.headerDensity}`}</text>
        <text>{`padding=${layout.contentPadding}`}</text>
        <text>{`diff=${layout.toolDiffView}`}</text>
        <text>{`autoCompact=${layout.autoCompact}`}</text>
      </box>
    )
  }
  const app = await testRender(() => <Harness />, { width: params.width, height: params.height })
  return { app, getLayout: () => layout! }
}

describe("useResponsiveLayout — visible tiers at real terminal widths", () => {
  test("narrow SSH terminal (50 cols) degrades to a usable condensed layout", async () => {
    const { app, getLayout } = await mountHarness({ width: 50, height: 24 })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.tier).toBe("narrow")
      expect(s.sidebarMode).toBe("hidden")
      expect(s.headerDensity).toBe("condensed")
      expect(s.contentPadding).toBe(1)
      expect(s.autoCompact).toBe(true)
      const frame = app.captureCharFrame()
      expect(frame).toContain("tier=narrow")
      expect(frame).toContain("sidebar=hidden")
      expect(frame).toContain("header=condensed")
      expect(frame).toContain("padding=1")
    } finally {
      app.renderer.destroy()
    }
  })

  test("standard terminal (110 cols) keeps the docked sidebar and full padding", async () => {
    const { app, getLayout } = await mountHarness({ width: 110, height: 30 })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.tier).toBe("standard")
      expect(s.sidebarMode).toBe("docked")
      expect(s.sidebarWidth).toBe(42)
      expect(s.headerDensity).toBe("full")
      expect(s.contentPadding).toBe(2)
      const frame = app.captureCharFrame()
      expect(frame).toContain("tier=standard")
      expect(frame).toContain("sidebar=docked")
      expect(frame).toContain("padding=2")
    } finally {
      app.renderer.destroy()
    }
  })

  test("wide local terminal (200 cols) enables split diff view", async () => {
    const { app, getLayout } = await mountHarness({ width: 200, height: 50 })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.tier).toBe("wide")
      expect(s.sidebarMode).toBe("docked")
      expect(s.toolDiffView).toBe("split")
      expect(app.captureCharFrame()).toContain("diff=split")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("useResponsiveLayout — resize behavior (SIGWINCH)", () => {
  test("growing a narrow terminal across the breakpoints re-tiers the layout", async () => {
    const { app, getLayout } = await mountHarness({ width: 50, height: 24 })
    try {
      await app.renderOnce()
      expect(getLayout().tier).toBe("narrow")

      app.resize(110, 24)
      await app.flush()
      const standard = getLayout()
      expect(standard.tier).toBe("standard")
      expect(standard.sidebarMode).toBe("docked")

      app.resize(200, 24)
      await app.flush()
      const wide = getLayout()
      expect(wide.tier).toBe("wide")
      expect(wide.toolDiffView).toBe("split")
    } finally {
      app.renderer.destroy()
    }
  })

  test("shrinking a wide terminal collapses the header and hides the auto sidebar", async () => {
    const { app, getLayout } = await mountHarness({ width: 200, height: 50 })
    try {
      await app.renderOnce()
      expect(getLayout().headerDensity).toBe("full")

      app.resize(80, 50)
      await app.flush()
      const compact = getLayout()
      expect(compact.tier).toBe("compact")
      expect(compact.sidebarMode).toBe("hidden")
      expect(compact.headerDensity).toBe("condensed")
      expect(compact.autoCompact).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("a manually opened sidebar overlays instead of stealing width when shrunk", async () => {
    const { app, getLayout } = await mountHarness({ width: 200, height: 50, sidebarOpen: true })
    try {
      await app.renderOnce()
      expect(getLayout().sidebarMode).toBe("docked")

      app.resize(80, 50)
      await app.flush()
      const overlay = getLayout()
      expect(overlay.tier).toBe("compact")
      expect(overlay.sidebarMode).toBe("overlay")
      expect(overlay.sidebarWidth).toBe(0)
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("useResponsiveLayout — focus behavior regression", () => {
  test("focus mode hides the sidebar and minimizes the header at any width", async () => {
    const { app, getLayout } = await mountHarness({ width: 200, height: 50, focused: true })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.sidebarMode).toBe("hidden")
      expect(s.headerDensity).toBe("minimal")
      const frame = app.captureCharFrame()
      expect(frame).toContain("sidebar=hidden")
      expect(frame).toContain("header=minimal")
    } finally {
      app.renderer.destroy()
    }
  })

  test("focus mode wins over an explicitly opened sidebar (conflict path)", async () => {
    const { app, getLayout } = await mountHarness({
      width: 200,
      height: 50,
      focused: true,
      sidebarOpen: true,
    })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.sidebarMode).toBe("hidden")
      expect(s.headerDensity).toBe("minimal")
    } finally {
      app.renderer.destroy()
    }
  })

  test("a parent session hides the sidebar regardless of auto/width", async () => {
    const { app, getLayout } = await mountHarness({ width: 200, height: 50, parentID: true })
    try {
      await app.renderOnce()
      expect(getLayout().sidebarMode).toBe("hidden")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("useResponsiveLayout — failure path (degenerate dimensions)", () => {
  test("an uninitialized zero-width terminal degrades safely without crashing", async () => {
    // opentui refuses a literal 0×0 surface, so the smallest legal probe is
    // width 1; the model must treat it as the narrow/usable floor.
    const { app, getLayout } = await mountHarness({ width: 1, height: 1 })
    try {
      await app.renderOnce()
      const s = getLayout()
      expect(s.tier).toBe("narrow")
      expect(s.sidebarMode).toBe("hidden")
      expect(s.contentPadding).toBe(1)
      expect(s.autoCompact).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })
})
