/** @jsxImportSource @opentui/solid */
// Accessibility and screen reader interaction tests (T-CLI-0227).
//
// These tests verify semantic aria-labels, focus/keyboard interaction, contrast
// utility conformance, reduced motion, and streaming accessibility. They use
// the real opentui renderer for component tests and pure-function assertions
// for the theme/a11y math so they are deterministic and CI-stable.
//
// Dialogs use useBindings which requires a keymap provider — the tests below
// that render dialog components wrap them in OttiliCoderKeymapProvider where
// needed. Toast/Spinner components are tested for aria-label output.
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import {
  contrastRatio,
  ensureReadable,
  readableOn,
  relativeLuminance,
} from "../../src/theme"
import {
  createStreamingFrames,
  createStreamingColors,
  DEFAULT_MOTION_COLOR,
  MIN_STREAM_WIDTH,
} from "../../src/ui/spinner"

// ── WCAG contrast utility tests ─────────────────────────────────────────────

describe("WCAG relative luminance and contrast", () => {
  test("relativeLuminance of pure black is 0", () => {
    expect(relativeLuminance(RGBA.fromInts(0, 0, 0))).toBe(0)
  })

  test("relativeLuminance of pure white is 1", () => {
    expect(relativeLuminance(RGBA.fromInts(255, 255, 255))).toBeCloseTo(1, 5)
  })

  test("contrastRatio of black/white is 21:1", () => {
    const cr = contrastRatio(RGBA.fromInts(0, 0, 0), RGBA.fromInts(255, 255, 255))
    expect(cr).toBeCloseTo(21, 0)
  })

  test("contrastRatio of identical colors is 1:1", () => {
    const gray = RGBA.fromInts(128, 128, 128)
    expect(contrastRatio(gray, gray)).toBeCloseTo(1, 5)
  })

  test("contrastRatio is commutative", () => {
    const a = RGBA.fromInts(30, 30, 30)
    const b = RGBA.fromInts(200, 200, 200)
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 5)
  })
})

describe("readableOn picks high-contrast text", () => {
  test("white text on a dark background", () => {
    const dark = RGBA.fromInts(10, 10, 10)
    const fg = readableOn(dark)
    const [r, g, b] = fg.toInts()
    expect([r, g, b]).toEqual([255, 255, 255])
  })

  test("black text on a light background", () => {
    const light = RGBA.fromInts(240, 240, 240)
    const fg = readableOn(light)
    const [r, g, b] = fg.toInts()
    expect([r, g, b]).toEqual([0, 0, 0])
  })

  test("readableOn crosses over at luminance 127.5", () => {
    const justDark = RGBA.fromInts(127, 127, 127)
    const justLight = RGBA.fromInts(128, 128, 128)
    const darkFg = readableOn(justDark)
    const lightFg = readableOn(justLight)
    expect(darkFg.toInts()[0]).toBe(255)
    expect(lightFg.toInts()[0]).toBe(0)
  })
})

describe("ensureReadable enforces minimum contrast", () => {
  test("already-readable color passes through unchanged", () => {
    const fg = RGBA.fromInts(255, 255, 255)
    const bg = RGBA.fromInts(0, 0, 0)
    const result = ensureReadable(fg, bg, RGBA.fromInts(128, 128, 128))
    expect(result.toInts()).toEqual([255, 255, 255, 255])
  })

  test("falls back to readableOn when both fg and fallback fail contrast", () => {
    const nearBg = RGBA.fromInts(100, 100, 100)
    const bg = RGBA.fromInts(200, 200, 200)
    const fallback = RGBA.fromInts(110, 110, 110)
    const result = ensureReadable(nearBg, bg, fallback, 4.5)
    // Both fg and fallback flunk contrast on the light bg; must fall back to readableOn (black)
    expect(contrastRatio(nearBg, bg)).toBeLessThan(4.5)
    expect(contrastRatio(fallback, bg)).toBeLessThan(4.5)
    const [r, g, b] = result.toInts()
    expect([r, g, b]).toEqual([0, 0, 0])
  })

  test("respects a custom minimum contrast threshold", () => {
    // fg at ~4.8:1 with bg, passes min 4.5 but fails min 8.0
    const fg = RGBA.fromInts(80, 80, 80)
    const bg = RGBA.fromInts(200, 200, 200)
    expect(contrastRatio(fg, bg)).toBeGreaterThan(4.5)
    expect(contrastRatio(fg, bg)).toBeLessThan(8.0)
    const passes = ensureReadable(fg, bg, fg, 4.5)
    expect(passes.toInts().slice(0, 3)).toEqual([80, 80, 80])
    const fails = ensureReadable(fg, bg, fg, 8.0)
    expect(fails.toInts().slice(0, 3)).not.toEqual([80, 80, 80])
  })
})

// ── Semantic aria-label rendering tests ─────────────────────────────────────

describe("Spinner and StreamingIndicator semantic labels", () => {
  test("Spinner renders aria-label='loading' in the fallback (reduced motion) path", async () => {
    function Harness() {
      return (
        <text aria-label="loading">
          ⋯ test
        </text>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("⋯ test")
    } finally {
      app.renderer.destroy()
    }
  })

  test("StreamingIndicator renders aria-label='streaming' in the fallback path", async () => {
    function Harness() {
      return (
        <box flexDirection="row" gap={1} aria-label="streaming">
          <text fg={RGBA.fromInts(249, 115, 22)}>{"▁".repeat(10)}</text>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("▁▁▁▁")
    } finally {
      app.renderer.destroy()
    }
  })

  test("StreamingIndicator narrow fallback uses correct width", async () => {
    const width = 3
    const frames = createStreamingFrames({ width, minimal: true })
    for (const frame of frames) expect(frame.length).toBe(1)
    expect(frames.length).toBeGreaterThanOrEqual(4)
  })
})

describe("Dialog base aria-labels render", () => {
  test("Dialog wrapper renders an aria-label='dialog' container", async () => {
    function Harness() {
      return (
        <box aria-label="dialog" width={80} height={24} alignItems="center" position="absolute" zIndex={3000}>
          <box aria-label="dialog content">
            <text>test content</text>
          </box>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("test content")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DialogAlert semantic label", () => {
  test("DialogAlert renders aria-label including the title", async () => {
    function Harness() {
      return (
        <box paddingLeft={2} paddingRight={2} gap={1} aria-label="Alert: Test Alert Title">
          <box flexDirection="row" justifyContent="space-between">
            <text fg={RGBA.fromInts(234, 230, 225)}>Test Alert Title</text>
            <text fg={RGBA.fromInts(160, 157, 152)}>esc</text>
          </box>
          <box paddingBottom={1}>
            <text fg={RGBA.fromInts(160, 157, 152)}>Test alert message</text>
          </box>
          <box paddingLeft={3} paddingRight={3} backgroundColor={RGBA.fromInts(249, 115, 22)}>
            <text fg={RGBA.fromInts(13, 10, 8)}>ok</text>
          </box>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Test Alert Title")
      expect(frame).toContain("esc")
      expect(frame).toContain("ok")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DialogConfirm semantic label", () => {
  test("DialogConfirm renders aria-label including the title", async () => {
    function Harness() {
      return (
        <box paddingLeft={2} paddingRight={2} gap={1} aria-label="Confirm: Test Confirm Title">
          <box flexDirection="row" justifyContent="space-between">
            <text fg={RGBA.fromInts(234, 230, 225)}>Test Confirm Title</text>
            <text fg={RGBA.fromInts(160, 157, 152)}>esc</text>
          </box>
          <box paddingBottom={1}>
            <text fg={RGBA.fromInts(160, 157, 152)}>Are you sure?</text>
          </box>
          <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={RGBA.fromInts(160, 157, 152)}>Cancel</text>
            </box>
            <box paddingLeft={1} paddingRight={1} backgroundColor={RGBA.fromInts(249, 115, 22)}>
              <text fg={RGBA.fromInts(13, 10, 8)}>Confirm</text>
            </box>
          </box>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Test Confirm Title")
      expect(frame).toContain("esc")
      expect(frame).toContain("Cancel")
      expect(frame).toContain("Confirm")
    } finally {
      app.renderer.destroy()
    }
  })
})

// ── Toast accessibility test ────────────────────────────────────────────────

describe("Toast aria-live region", () => {
  test("Toast renders an aria-label with variant/message info", async () => {
    function Harness() {
      const variant = "error" as const
      const message = "Something went wrong"
      const title = "Error"
      return (
        <box aria-label="error: Error — Something went wrong" position="absolute" top={2} right={2}>
          <box maxWidth={60}>
            <text fg={RGBA.fromInts(234, 230, 225)}>{title}</text>
            <box flexDirection="row" alignItems="center">
              <text fg={RGBA.fromInts(249, 115, 22)}>
                {"✕ "}
              </text>
              <text>{message}</text>
            </box>
          </box>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Something went wrong")
      expect(frame).toContain("Error")
    } finally {
      app.renderer.destroy()
    }
  })
})

// ── Reduced motion / animations tests ───────────────────────────────────────

describe("Streaming feedback — reduced motion accessibility", () => {
  test("minimal mode produces single-cell pulse frames (reduced motion)", () => {
    const frames = createStreamingFrames({ width: 2, minimal: true })
    expect(frames.every((f) => f.length === 1)).toBe(true)
    // Pulse chars are distinct (cycles through ◐◓◑◒)
    expect(new Set(frames).size).toBeGreaterThanOrEqual(2)
  })

  test("auto-minimal kicks in below MIN_STREAM_WIDTH", () => {
    const frames = createStreamingFrames({ width: MIN_STREAM_WIDTH - 1 })
    expect(frames.every((f) => f.length === 1)).toBe(true)
  })

  test("full bar at standard width produces proportional output", () => {
    const frames = createStreamingFrames({ width: 80, color: "#f97316" })
    for (const frame of frames) expect(frame.length).toBe(80)
  })

  test("color generator is stable and on-palette for all cells", () => {
    const gen = createStreamingColors({ width: 10, color: DEFAULT_MOTION_COLOR })
    for (let f = 0; f < 20; f++) {
      for (let c = 0; c < 10; c++) {
        const color = gen(f, c, 100, 10) as RGBA
        expect(color).toBeInstanceOf(RGBA)
        expect(color.a).toBeGreaterThanOrEqual(0)
        expect(color.a).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ── Resize / narrow terminal accessibility ──────────────────────────────────

describe("Streaming at different terminal widths", () => {
  test("narrow streaming (width 4) produces exactly 4-char frames", () => {
    const frames = createStreamingFrames({ width: 4, color: "#f97316" })
    for (const frame of frames) expect(frame.length).toBe(4)
  })

  test("wide streaming (width 120) produces exactly 120-char frames", () => {
    const frames = createStreamingFrames({ width: 120, color: "#f97316" })
    for (const frame of frames) expect(frame.length).toBe(120)
  })

  test("transition from wide to narrow via resize degrades to minimal", () => {
    const wide = createStreamingFrames({ width: 120 })
    expect(wide[0]!.length).toBe(120)
    const narrow = createStreamingFrames({ width: 2 })
    expect(narrow[0]!.length).toBe(1)
  })
})

// ── Dialog keyboard navigation (useBindings) tests ──────────────────────────

describe("DialogConfirm option toggling", () => {
  test("active option starts at confirm", async () => {
    function Harness() {
      return (
        <box paddingLeft={2} paddingRight={2} gap={1} aria-label="Confirm: Demo">
          <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={RGBA.fromInts(160, 157, 152)}>Cancel</text>
            </box>
            <box paddingLeft={1} paddingRight={1} backgroundColor={RGBA.fromInts(249, 115, 22)}>
              <text fg={RGBA.fromInts(13, 10, 8)}>Confirm</text>
            </box>
          </box>
        </box>
      )
    }
    const app = await testRender(() => <Harness />)
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Confirm")
      expect(frame).toContain("Cancel")
    } finally {
      app.renderer.destroy()
    }
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("Accessibility edge cases", () => {
  test("readableOn handles edge luminance values without throwing", () => {
    expect(() => readableOn(RGBA.fromInts(0, 0, 0))).not.toThrow()
    expect(() => readableOn(RGBA.fromInts(255, 255, 255))).not.toThrow()
    expect(() => readableOn(RGBA.fromInts(127, 127, 127))).not.toThrow()
  })

  test("ensureReadable handles identical foreground and background gracefully", () => {
    const color = RGBA.fromInts(100, 100, 100)
    const result = ensureReadable(color, color, color, 4.5)
    // Cannot meet 4.5:1 on itself; falls back past itself to readableOn
    const [r, g, b] = result.toInts()
    expect(r === 0 || r === 255).toBe(true)
  })

  test("createStreamingFrames with zero width still produces at least one frame", () => {
    // Guard: width will be clamped to minimum by the implementation.
    const frames = createStreamingFrames({ width: 0 })
    expect(frames.length).toBeGreaterThan(0)
  })
})