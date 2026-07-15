import { describe, expect, it } from "bun:test"
import {
  createStreamingColors,
  createStreamingFrames,
  createColors,
  createFrames,
  DEFAULT_MOTION_COLOR,
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
    const first = gen(0, 0, 100, 10)
    const again = gen(0, 0, 100, 10)
    expect(first.r).toBe(again.r)
    expect(first.g).toBe(again.g)
    expect(first.b).toBe(again.b)
    // The inactive (default) color must be dim, not a full-brightness cell.
    const idle = gen(20, 0, 100, 10)
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
})
