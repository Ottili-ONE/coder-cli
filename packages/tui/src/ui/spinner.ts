import type { ColorInput } from "@opentui/core"
import { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"

// Ottili brand primary (theme step9). Used only when a caller omits a motion
// color, so any fallback stays on-palette instead of the old off-brand red.
export const DEFAULT_MOTION_COLOR = "#f97316"

/**
 * Derives a gradient of tail colors from a single bright color using alpha falloff.
 * Background-independent: inactive cells are dimmed via alpha, not a fixed dark color.
 */
export function deriveTrailColors(brightColor: ColorInput, steps: number = 6): RGBA[] {
  const baseRgba = brightColor instanceof RGBA ? brightColor : RGBA.fromHex(brightColor as string)

  const colors: RGBA[] = []

  for (let i = 0; i < steps; i++) {
    let alpha: number
    let brightnessFactor: number

    if (i === 0) {
      alpha = 1.0
      brightnessFactor = 1.0
    } else if (i === 1) {
      alpha = 0.9
      brightnessFactor = 1.15
    } else {
      alpha = Math.pow(0.65, i - 1)
      brightnessFactor = 1.0
    }

    const r = Math.min(1.0, baseRgba.r * brightnessFactor)
    const g = Math.min(1.0, baseRgba.g * brightnessFactor)
    const b = Math.min(1.0, baseRgba.b * brightnessFactor)

    colors.push(RGBA.fromValues(r, g, b, alpha))
  }

  return colors
}

/**
 * Derives the inactive/default color from a bright color using alpha.
 * Background-independent dimming via alpha falloff.
 */
export function deriveInactiveColor(brightColor: ColorInput, factor: number = 0.2): RGBA {
  const baseRgba = brightColor instanceof RGBA ? brightColor : RGBA.fromHex(brightColor as string)
  return RGBA.fromValues(baseRgba.r, baseRgba.g, baseRgba.b, factor)
}

interface MotionColorSet {
  colors: RGBA[]
  defaultColor: RGBA
  trail: number
  period: number
}

function resolveMotionColors(options: StreamingOptions): MotionColorSet {
  const width = Math.max(2, options.width ?? 10)
  const bright = options.color ?? DEFAULT_MOTION_COLOR
  const colors = options.colors
    ? options.colors.map((color) => (color instanceof RGBA ? color : RGBA.fromHex(color as string)))
    : deriveTrailColors(bright, options.trailSteps ?? 5)
  const defaultColor = deriveInactiveColor(bright, options.inactiveFactor ?? 0.18)
  const trail = Math.max(1, colors.length)
  const period = width + trail
  return { colors, defaultColor, trail, period }
}

export interface StreamingOptions {
  /** Number of cells in the streaming bar (default: 10). */
  width?: number
  /** Single color to derive the trail from (alternative to `colors`). */
  color?: ColorInput
  /** Explicit trail color array (alternative to deriving from `color`). */
  colors?: ColorInput[]
  /** Number of trail steps when deriving from a single color (default: 5). */
  trailSteps?: number
  /** Alpha factor for inactive cells (default: 0.18, range: 0-1). */
  inactiveFactor?: number
}

/**
 * Indeterminate streaming sweep: a bright head travels left→right leaving an
 * alpha-fading trail, then loops seamlessly. Conveys streaming/progress without
 * a number, and is stable across rapid state changes (the frame sequence is
 * fixed for a given width/trail, so re-renders never shift the animation).
 */
export function createStreamingFrames(options: StreamingOptions = {}): string[] {
  const width = Math.max(2, options.width ?? 10)
  const { trail, period } = resolveMotionColors(options)
  const head = "█"
  const idle = "·"

  return Array.from({ length: period }, (_, frameIndex) => {
    return Array.from({ length: width }, (_, cell) => {
      const dist = frameIndex - cell
      return dist >= 0 && dist < trail ? head : idle
    }).join("")
  })
}

/**
 * Color generator for {@link createStreamingFrames}. Colors each cell by its
 * distance behind the sweep head using the derived trail, so the visible glyph
 * at `frameIndex` always matches its color (no flicker or desync).
 */
export function createStreamingColors(options: StreamingOptions = {}): ColorGenerator {
  const width = Math.max(2, options.width ?? 10)
  const { colors, defaultColor, trail, period } = resolveMotionColors(options)

  return (_frameIndex, charIndex) => {
    const f = ((_frameIndex % period) + period) % period
    const dist = f - charIndex
    if (dist >= 0 && dist < trail) return colors[dist] ?? defaultColor
    return defaultColor
  }
}

// Legacy aliases retained so existing callers (prompt, footer) keep compiling
// after the motion redesign replaced the old Knight Rider scanner surface.
// `createFrames`/`createColors` now render the palette-driven streaming sweep.
export interface MotionOptions extends StreamingOptions {
  style?: "blocks" | "diamonds"
  holdStart?: number
  holdEnd?: number
}

export function createFrames(options: MotionOptions = {}): string[] {
  return createStreamingFrames(options)
}

export function createColors(options: MotionOptions = {}): ColorGenerator {
  return createStreamingColors(options)
}
