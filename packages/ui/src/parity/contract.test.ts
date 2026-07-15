import { describe, expect, it } from "bun:test"
import {
  MAX_PARITY_DETAIL_LEN,
  MAX_PARITY_TITLE_LEN,
  PARITY_COMMANDS,
  createParityStateQueue,
  desktopCapabilities,
  latestParityAriaLabel,
  parityCommandSpec,
  parityStateView,
  redactParityText,
  resolveLayoutTier,
  tuiCapabilities,
  webCapabilities,
} from "./contract"

describe("resolveLayoutTier", () => {
  it("mirrors the TUI responsive tiers (specs/tui/responsive-terminal-layout)", () => {
    expect(resolveLayoutTier(0)).toBe("narrow")
    expect(resolveLayoutTier(59)).toBe("narrow")
    expect(resolveLayoutTier(60)).toBe("compact")
    expect(resolveLayoutTier(99)).toBe("compact")
    expect(resolveLayoutTier(100)).toBe("standard")
    expect(resolveLayoutTier(119)).toBe("standard")
    expect(resolveLayoutTier(120)).toBe("wide")
    expect(resolveLayoutTier(240)).toBe("wide")
  })
})

describe("platform capabilities", () => {
  it("tui is keyboard/terminal only", () => {
    const caps = tuiCapabilities()
    expect(caps.host).toBe("tui")
    expect(caps.terminalWidth).toBe(true)
    expect(caps.keyboardOnly).toBe(true)
    expect(caps.osMenu).toBe(false)
    expect(caps.nativeFileDialog).toBe(false)
  })

  it("web has browser a11y + notifications but no native dialog", () => {
    const caps = webCapabilities()
    expect(caps.host).toBe("web")
    expect(caps.browserA11y).toBe(true)
    expect(caps.nativeNotification).toBe(true)
    expect(caps.nativeFileDialog).toBe(false)
  })

  it("desktop surfaces os menu, update, wsl and native dialog", () => {
    const caps = desktopCapabilities()
    expect(caps.host).toBe("desktop")
    expect(caps.osMenu).toBe(true)
    expect(caps.autoUpdate).toBe(true)
    expect(caps.wsl).toBe(true)
    expect(caps.nativeFileDialog).toBe(true)
  })
})

describe("parity command registry", () => {
  it("enumerates one canonical entry per command", () => {
    expect(PARITY_COMMANDS.length).toBe(9)
    expect(parityCommandSpec("toggleTheme")?.label).toBe("Toggle theme")
    expect(parityCommandSpec("openCommandPalette")?.tuiBinding).toBe("Mod+Shift+P")
  })
})
