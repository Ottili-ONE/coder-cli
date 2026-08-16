import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  DEFAULT_THEMES,
  auditContrast,
  classifyThemeState,
  compactTheme,
  contrastRatio,
  limitDepth,
  mapTheme,
  monochromeTheme,
  redactThemeError,
  relativeLuminance,
  responsiveTheme,
  resolveTheme,
  resolveThemeCached,
  safeResolveTheme,
  sanitizeThemeSource,
} from "../src/theme"

const DARK = resolveTheme(DEFAULT_THEMES.ottiliCoder, "dark")

test("resolveThemeCached returns an equivalent resolved theme", () => {
  const cached = resolveThemeCached(DEFAULT_THEMES.ottiliCoder, "dark")
  const direct = resolveTheme(DEFAULT_THEMES.ottiliCoder, "dark")
  expect(cached.primary.equals(direct.primary)).toBe(true)
  expect(cached.background.equals(direct.background)).toBe(true)
})

test("resolveThemeCached memoizes by theme identity and mode", () => {
  const first = resolveThemeCached(DEFAULT_THEMES.ottiliCoder, "dark")
  const second = resolveThemeCached(DEFAULT_THEMES.ottiliCoder, "dark")
  expect(first).toBe(second)
  const light = resolveThemeCached(DEFAULT_THEMES.ottiliCoder, "light")
  expect(light).not.toBe(first)
})

test("relativeLuminance and contrastRatio match WCAG references", () => {
  const white = RGBA.fromInts(255, 255, 255)
  const black = RGBA.fromInts(0, 0, 0)
  expect(relativeLuminance(white)).toBeCloseTo(1, 5)
  expect(relativeLuminance(black)).toBeCloseTo(0, 5)
  expect(contrastRatio(white, black)).toBeCloseTo(21, 1)
  expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
})

test("auditContrast reports nothing for the default theme", () => {
  expect(auditContrast(DARK)).toEqual([])
})

test("auditContrast reports low-contrast pairs", () => {
  const flat = mapTheme(DARK, () => RGBA.fromInts(10, 10, 10))
  const issues = auditContrast(flat)
  expect(issues.length).toBeGreaterThan(0)
  expect(issues.every((issue) => issue.ratio < issue.required)).toBe(true)
  expect(issues.find((issue) => issue.pair === "text/background")).toBeDefined()
})

test("monochromeTheme produces grayscale colors", () => {
  const mono = monochromeTheme(DARK)
  const [r, g, b] = mono.primary.toInts()
  expect(r).toBe(g)
  expect(g).toBe(b)
  const [tr, tg, tb] = mono.text.toInts()
  expect(tr).toBe(tg)
  expect(tg).toBe(tb)
})

test("limitDepth quantizes colors to the palette", () => {
  const depth = limitDepth(DARK, 2)
  for (const [r, g, b] of [depth.primary, depth.background, depth.error].map((c) => c.toInts())) {
    expect([0, 255]).toContain(r)
    expect([0, 255]).toContain(g)
    expect([0, 255]).toContain(b)
  }
})

test("limitDepth with default levels reduces distinct shades", () => {
  const depth = limitDepth(DARK, 6)
  const step = 255 / 5
  for (const channel of depth.primary.toInts().slice(0, 3)) {
    expect(Math.round(channel) % step).toBe(0)
  }
})

test("compactTheme collapses borders and diff backgrounds for narrow layouts", () => {
  const compact = compactTheme(DARK)
  expect(compact.border.equals(DARK.backgroundPanel)).toBe(true)
  expect(compact.borderSubtle.equals(DARK.backgroundPanel)).toBe(true)
  expect(compact.borderActive.equals(DARK.backgroundPanel)).toBe(true)
  expect(compact.diffAddedBg.a).toBe(0)
  expect(compact.diffRemovedBg.a).toBe(0)
})

test("responsiveTheme compacts only on narrow terminals", () => {
  expect(responsiveTheme(DARK, { width: 30 }).border.equals(DARK.backgroundPanel)).toBe(true)
  expect(responsiveTheme(DARK, { width: 80 })).toBe(DARK)
})

test("classifyThemeState maps every required state", () => {
  expect(classifyThemeState({ ready: false, themes: {} })).toBe("loading")
  expect(classifyThemeState({ ready: true, themes: {} })).toBe("empty")
  expect(classifyThemeState({ ready: true, themes: { a: {} }, active: "a" })).toBe("populated")
  expect(classifyThemeState({ ready: true, themes: { a: {} }, active: "missing" })).toBe("degraded")
  expect(classifyThemeState({ ready: true, themes: {}, error: new Error("boom") })).toBe("failure")
  expect(classifyThemeState({ ready: true, themes: {}, denied: true })).toBe("denied")
  expect(classifyThemeState({ ready: true, themes: {}, offline: true })).toBe("offline")
})

test("safeResolveTheme never throws on circular references", () => {
  const broken = structuredClone(DEFAULT_THEMES.ottiliCoder)
  broken.defs = { ...broken.defs, one: "two", two: "one" }
  broken.theme.primary = "one"
  const result = safeResolveTheme(broken, "dark")
  expect(result.primary).toBeDefined()
  expect(result._hasSelectedListItemText).toBeTypeOf("boolean")
})

test("safeResolveTheme falls back for undefined input", () => {
  expect(safeResolveTheme(undefined, "dark").primary).toBeDefined()
})

test("sanitizeThemeSource drops unknown fields that could carry secrets", () => {
  const dirty = {
    secret: "sk-abc123-token",
    theme: {
      primary: "#ff0000",
      injected: "should-not-survive",
    },
  }
  const clean = sanitizeThemeSource(dirty)
  expect(clean).toBeDefined()
  expect(JSON.stringify(clean)).not.toContain("sk-abc123-token")
  expect(JSON.stringify(clean)).not.toContain("should-not-survive")
  expect(clean!.theme.primary).toBe("#ff0000")
})

test("sanitizeThemeSource rejects non-theme input", () => {
  expect(sanitizeThemeSource({ defs: { a: "#fff" } })).toBeUndefined()
})

test("redactThemeError strips paths and stack traces and truncates", () => {
  const error = new Error("failed to read /home/user/.config/theme.json: permission denied\n  at readFile (fs.js:1:1)")
  const redacted = redactThemeError(error)
  expect(redacted).not.toContain("/home")
  expect(redacted).not.toContain("\n")
  expect(redacted).not.toContain("at readFile")
  const long = new Error("x".repeat(200))
  expect(redactThemeError(long).endsWith("...")).toBe(true)
  expect(redactThemeError("not an error")).toBe("unknown theme error")
})
