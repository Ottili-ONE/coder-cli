import { expect, test } from "bun:test"
import { RGBA, type TerminalColors } from "@opentui/core"
import {
  OTILI_BRAND_THEME,
  OTILI_BRAND_LIGHT_THEME,
  capabilitiesFromPalette,
  detectCapabilities,
  hasTheme,
  resolveActiveTheme,
  resolveTheme,
  resolveThemeName,
} from "@/cli/cmd/run/theme-engine"
import { allThemes } from "@/cli/cmd/run/theme-engine"

function rgbaHex(color: { toInts: () => [number, number, number, number] }) {
  const [r, g, b] = color.toInts()
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

function terminalColors(input: {
  size?: number
  background?: string | null
  foreground?: string | null
} = {}): TerminalColors {
  const size = input.size ?? 256
  return {
    palette: Array.from({ length: size }, (_, index) => `#${index.toString(16).padStart(2, "0").repeat(3)}`),
    defaultBackground: input.background ?? "#1a1b26",
    defaultForeground: input.foreground ?? "#c0caf5",
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

// ── Ottili palette variants ───────────────────────────────────────────────────

test("Ottili brand dark variant resolves to the orange primary on a dark surface", () => {
  const dark = resolveTheme(OTILI_BRAND_THEME, "dark")

  expect(rgbaHex(dark.primary)).toBe("#f97316")
  expect(rgbaHex(dark.background)).toBe("#0d0a08")
  expect(rgbaHex(dark.text)).toBe("#eae6e1")
  expect(dark.thinkingOpacity).toBe(0.55)
  expect(dark._hasSelectedListItemText).toBe(true)
  expect(rgbaHex(dark.selectedListItemText)).toBe(rgbaHex(dark.background))
})

test("Ottili brand light variant keeps the orange primary while inverting the surface", () => {
  const light = resolveTheme(OTILI_BRAND_LIGHT_THEME, "light")
  const dark = resolveTheme(OTILI_BRAND_THEME, "dark")

  // Brand identity (orange primary) survives the mode flip.
  expect(rgbaHex(light.primary)).toBe(rgbaHex(dark.primary))
  expect(rgbaHex(light.primary)).toBe("#f97316")
  // The surface inverts from a near-black dark to a near-white light background.
  expect(rgbaHex(light.background)).toBe("#faf9f7")
  expect(rgbaHex(light.background)).not.toBe(rgbaHex(dark.background))
  expect(light.thinkingOpacity).toBe(0.55)
})

test("dark and light brand variants produce distinct readable diff backgrounds", () => {
  const dark = resolveTheme(OTILI_BRAND_THEME, "dark")
  const light = resolveTheme(OTILI_BRAND_LIGHT_THEME, "light")

  expect(rgbaHex(dark.diffAddedBg)).toBe("#1a241c")
  expect(rgbaHex(light.diffAddedBg)).toBe("#dcefe1")
  // Light diff tint is brighter than the dark one on every channel.
  const [dr, dg, db] = dark.diffAddedBg.toInts()
  const [lr, lg, lb] = light.diffAddedBg.toInts()
  expect(lr).toBeGreaterThan(dr)
  expect(lg).toBeGreaterThan(dg)
  expect(lb).toBeGreaterThan(db)
})

// ── Terminal capability detection ─────────────────────────────────────────────

test("capabilitiesFromPalette derives color depth from palette length", () => {
  expect(capabilitiesFromPalette(terminalColors({ size: 256 })).colorDepth).toBe("truecolor")
  expect(capabilitiesFromPalette(terminalColors({ size: 88 })).colorDepth).toBe("256")
  expect(capabilitiesFromPalette(terminalColors({ size: 16 })).colorDepth).toBe("256")
  expect(capabilitiesFromPalette(terminalColors({ size: 8 })).colorDepth).toBe("16")
  expect(capabilitiesFromPalette(terminalColors({ size: 0 })).colorDepth).toBe("unknown")
  expect(capabilitiesFromPalette({ palette: undefined } as TerminalColors).colorDepth).toBe("unknown")
})

test("capabilitiesFromPalette reports OSC 10/11 query presence", () => {
  const both = capabilitiesFromPalette(terminalColors({ background: "#101010", foreground: "#eeeeee" }))
  expect(both.backgroundQuery).toBe(true)
  expect(both.foregroundQuery).toBe(true)

  const none = capabilitiesFromPalette(terminalColors({ background: null, foreground: null }))
  expect(none.backgroundQuery).toBe(false)
  expect(none.foregroundQuery).toBe(false)

  const onlyBg = capabilitiesFromPalette(terminalColors({ background: "#101010", foreground: null }))
  expect(onlyBg.backgroundQuery).toBe(true)
  expect(onlyBg.foregroundQuery).toBe(false)
})

test("detectCapabilities classifies a truecolor terminal", async () => {
  const caps = await detectCapabilities({ getPalette: async () => terminalColors({ size: 256 }) })
  expect(caps).toEqual({
    colorDepth: "truecolor",
    backgroundQuery: true,
    foregroundQuery: true,
  })
})

test("detectCapabilities fails safe to all-unknown when the query throws", async () => {
  const caps = await detectCapabilities({
    getPalette: async () => {
      throw new Error("palette query timed out")
    },
  })
  expect(caps).toEqual({
    colorDepth: "unknown",
    backgroundQuery: false,
    foregroundQuery: false,
  })
})

// ── Explicit override resolution ──────────────────────────────────────────────

test("resolveThemeName aliases the ottili-coder brand identity", () => {
  expect(resolveThemeName("ottili-coder")).toBe("ottiliCoder")
  expect(resolveThemeName("dracula")).toBe("dracula")
  expect(hasTheme("ottili-coder")).toBe(true)
})

test("explicit override wins over the adaptive brand default", () => {
  const overridden = resolveActiveTheme({ override: "dracula" })
  const brand = resolveActiveTheme({})

  // A different named variant must not silently collapse to the brand palette.
  expect(rgbaHex(overridden.primary)).not.toBe(rgbaHex(brand.primary))
  // And it must equal resolving that named theme directly in dark mode.
  expect(rgbaHex(overridden.primary)).toBe(rgbaHex(resolveTheme(allThemes()["dracula"]!, "dark").primary))
})

test("ottili-coder override resolves the bundled Ottili Coder theme", () => {
  const themed = resolveActiveTheme({ override: "ottili-coder" })
  const bundled = resolveTheme(allThemes()[resolveThemeName("ottili-coder")]!, "dark")
  expect(rgbaHex(themed.primary)).toBe(rgbaHex(bundled.primary))
  expect(rgbaHex(themed.primary)).toBe("#f97316")
})

// ── State transitions & dark/light mode ──────────────────────────────────────

test("mode transitions flip the brand surface without explicit override", () => {
  const dark = resolveActiveTheme({ mode: "dark" })
  const light = resolveActiveTheme({ mode: "light" })
  expect(rgbaHex(dark.background)).toBe("#0d0a08")
  expect(rgbaHex(light.background)).toBe("#faf9f7")
})

test("override mode is honored on a named variant", () => {
  const light = resolveActiveTheme({ override: "ottili-coder", mode: "light" })
  const dark = resolveActiveTheme({ override: "ottili-coder", mode: "dark" })
  expect(rgbaHex(light.background)).not.toBe(rgbaHex(dark.background))
})

// ── Failure path ─────────────────────────────────────────────────────────────

test("unknown override degrades gracefully to the brand default", () => {
  const missing = resolveActiveTheme({ override: "no-such-theme-9f3c2a" })
  const brand = resolveActiveTheme({})
  expect(rgbaHex(missing.primary)).toBe(rgbaHex(brand.primary))
  expect(rgbaHex(missing.background)).toBe("#0d0a08")
  expect(missing).toBeInstanceOf(Object)
})
