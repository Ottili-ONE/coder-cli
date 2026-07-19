import { describe, expect, it } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  createStreamingColors,
  createStreamingFrames,
  createColors,
  createFrames,
  DEFAULT_MOTION_COLOR,
  MIN_STREAM_WIDTH,
  deriveTrailColors,
  deriveInactiveColor,
} from "./spinner"

describe("motion streaming feedback", () => {
  it("streaming frames share a fixed width and a non-zero loop period", () => {
    const width = 10
    const frames = createStreamingFrames({ width, color: "#f97316" })
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) expect(frame.length).toBe(width)
  })

  it("streaming color generator is stable for a fixed frame/char and on-palette", () => {
    const gen = createStreamingColors({ width: 10, color: "#f97316" })
    const first = gen(0, 0, 100, 10) as RGBA
    const again = gen(0, 0, 100, 10) as RGBA
    expect(first).toBeInstanceOf(RGBA)
    expect(first.r).toBe(again.r)
    expect(first.g).toBe(again.g)
    expect(first.b).toBe(again.b)
    // The inactive (default) color must be dim, not a full-brightness cell.
    const idle = gen(20, 0, 100, 10) as RGBA
    expect(idle).toBeInstanceOf(RGBA)
    expect(idle.a).toBeLessThan(1)
  })

  it("default motion color is the Ottili palette primary, not off-brand red", () => {
    expect(DEFAULT_MOTION_COLOR.toLowerCase()).not.toBe("#ff0000")
    expect(DEFAULT_MOTION_COLOR).toBe("#f97316")
  })

  it("legacy createFrames/createColors compile and stay palette-driven", () => {
    const frames = createFrames({ width: 6, color: "#a77fc4" })
    expect(frames.every((frame) => frame.length === 6)).toBe(true)
    const gen = createColors({ width: 6, color: "#a77fc4" })
    expect(typeof gen).toBe("function")
  })

  it("minimal mode produces pulse frames for narrow terminals", () => {
    const frames = createStreamingFrames({ width: 2, minimal: true })
    expect(frames.length).toBeGreaterThanOrEqual(4)
    for (const frame of frames) expect(frame.length).toBe(1)
    // Pulse characters are single-width.
    expect(frames.every((f) => f.length === 1)).toBe(true)
  })

  it("color generator returns dim inactive color for additive mode", () => {
    const gen = createStreamingColors({ width: 8, color: "#f97316", additive: true })
    const active = gen(0, 0, 100, 8) as RGBA
    const far = gen(20, 0, 100, 8) as RGBA
    expect(active).toBeInstanceOf(RGBA)
    expect(far).toBeInstanceOf(RGBA)
    // Additive mode inactive alpha is higher than default.
    const defaultGen = createStreamingColors({ width: 8, color: "#f97316" })
    const defaultFar = defaultGen(20, 0, 100, 8) as RGBA
    expect(far.a).toBeGreaterThan(defaultFar.a)
  })

  it("MIN_STREAM_WIDTH is defined and greater than 1", () => {
    expect(MIN_STREAM_WIDTH).toBeGreaterThanOrEqual(2)
  })
})

describe("motion streaming — resize and narrow-terminal behavior", () => {
  it("width below MIN_STREAM_WIDTH automatically engages minimal mode", () => {
    const frames = createStreamingFrames({ width: 2 })
    // Below MIN_STREAM_WIDTH (4), automatically uses minimal mode with 1-char pulse frames.
    for (const frame of frames) expect(frame.length).toBe(1)
    expect(frames.length).toBeGreaterThanOrEqual(4)
  })

  it("explicit width=20 produces frames of exactly 20 chars", () => {
    const frames = createStreamingFrames({ width: 20, color: "#f97316" })
    for (const frame of frames) expect(frame.length).toBe(20)
  })

  it("width=1 with minimal=false still yields at least 1-char frames", () => {
    const frames = createStreamingFrames({ width: 1, minimal: false })
    for (const frame of frames) expect(frame.length).toBeGreaterThanOrEqual(1)
  })

  it("standard terminal width (80) and wide (120) produce proportional frames", () => {
    const standard = createStreamingFrames({ width: 80, color: "#f97316" })
    const wide = createStreamingFrames({ width: 120, color: "#f97316" })
    for (const frame of standard) expect(frame.length).toBe(80)
    for (const frame of wide) expect(frame.length).toBe(120)
  })
})

describe("motion streaming — failure and edge-case paths", () => {
  it("empty color input is handled without throwing", () => {
    expect(() => createStreamingFrames({ width: 10 })).not.toThrow()
    const frames = createStreamingFrames({ width: 10 })
    expect(frames.length).toBeGreaterThan(0)
  })

  it("single-step trail does not underflow", () => {
    const colors = deriveTrailColors("#f97316", 1)
    expect(colors.length).toBe(1)
    expect(colors[0].a).toBe(1.0)
  })

  it("zero-step trail returns empty array (caller handles gracefully)", () => {
    const colors = deriveTrailColors("#f97316", 0)
    expect(colors.length).toBe(0)
  })

  it("inactive factor of 0 yields zero-alpha", () => {
    const inactive = deriveInactiveColor("#f97316", 0)
    expect(inactive.a).toBe(0)
  })

  it("inactive factor of 1 yields full-alpha dim", () => {
    const inactive = deriveInactiveColor("#f97316", 1)
    expect(inactive.a).toBe(1)
  })

  it("color generator never returns an out-of-range char index", () => {
    const gen = createStreamingColors({ width: 10, color: "#f97316" })
    // charIndex beyond width should still return a valid RGBA.
    const result = gen(5, 99, 100, 10) as RGBA
    expect(result).toBeInstanceOf(RGBA)
    expect(result.a).toBeLessThanOrEqual(1)
  })

  it("color generator with explicit colors array is deterministic", () => {
    const hexColors = ["#ff0000", "#00ff00", "#0000ff"]
    const gen = createStreamingColors({ width: 10, colors: hexColors })
    const first = gen(0, 0, 100, 10) as RGBA
    const again = gen(0, 0, 100, 10) as RGBA
    expect(first.r).toBe(again.r)
    expect(first.g).toBe(again.g)
    expect(first.b).toBe(again.b)
  })
})
