import { describe, expect, it } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  createStreamingColors,
  createStreamingFrames,
  createColors,
  createFrames,
  DEFAULT_MOTION_COLOR,
  MIN_STREAM_WIDTH,
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
