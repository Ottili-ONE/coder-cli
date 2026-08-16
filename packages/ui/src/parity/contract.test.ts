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

describe("parity state surface", () => {
  it("renders hidden with an empty view", () => {
    const view = parityStateView({ status: "hidden" })
    expect(view.status).toBe("hidden")
    expect(view.title).toBe("")
    expect(view.actions).toEqual([])
    expect(view.ariaLabel).toBe("")
  })

  it("renders loading and empty without color-only signals", () => {
    const loading = parityStateView({ status: "loading" })
    expect(loading.glyph).toBe("↻")
    expect(loading.title).toBe("Loading…")
    expect(loading.colorRole).toBe("info")
    expect(loading.ariaLabel).toBe("Loading.")

    const empty = parityStateView({ status: "empty" })
    expect(empty.glyph).toBe("✓")
    expect(empty.colorRole).toBe("success")
    expect(empty.ariaLabel).toBe("Nothing here yet.")
  })

  it("renders populated and long-content with actions and a word title", () => {
    const populated = parityStateView({
      status: "populated",
      title: "3 sessions",
      actions: [{ key: "o", label: "open", command: "openSession" }],
    })
    expect(populated.glyph).toBe("●")
    expect(populated.title).toBe("3 sessions")
    expect(populated.actions.map((a) => a.key)).toEqual(["o"])
    expect(populated.ariaLabel).toBe("3 sessions")

    const long = parityStateView({
      status: "long-content",
      title: "History",
      detail: "x".repeat(300),
    })
    expect(long.status).toBe("long-content")
    expect(long.detail.length).toBeLessThanOrEqual(MAX_PARITY_DETAIL_LEN)
    expect(long.ariaLabel).toContain("long content")
  })

  it("renders failure with retry + dismiss and a11y label", () => {
    const failure = parityStateView({ status: "failure", error: "boom", retry: true })
    expect(failure.glyph).toBe("✕")
    expect(failure.colorRole).toBe("error")
    expect(failure.actions.map((a) => a.command)).toEqual(["retry", "dismiss"])
    expect(failure.ariaLabel).toBe("Something went wrong: boom.")
  })

  it("renders denied, offline and degraded as actionable warnings", () => {
    expect(parityStateView({ status: "denied", resource: "clipboard" }).title).toContain("clipboard")
    const offline = parityStateView({ status: "offline" })
    expect(offline.colorRole).toBe("warning")
    expect(offline.ariaLabel).toBe("You are offline.")
    expect(parityStateView({ status: "degraded", detail: "slow" }).title).toBe("Limited functionality")
  })

  it("drops the hint on narrow terminals", () => {
    const wide = parityStateView({ status: "populated", title: "t", actions: [{ key: "o", label: "open", command: "openSession" }] }, { width: 200 })
    const narrow = parityStateView({ status: "populated", title: "t", actions: [{ key: "o", label: "open", command: "openSession" }] }, { width: 50 })
    expect(wide.hint.length).toBeGreaterThan(0)
    expect(narrow.hint).toBe("")
  })

  it("caps title and detail to the render budget", () => {
    const view = parityStateView({ status: "populated", title: "x".repeat(300), detail: "y".repeat(900) })
    expect(view.title.length).toBeLessThanOrEqual(MAX_PARITY_TITLE_LEN)
    expect(view.detail.length).toBeLessThanOrEqual(MAX_PARITY_DETAIL_LEN)
  })
})

describe("parity redaction", () => {
  it("masks token-shaped runs and secret assignments", () => {
    const long = redactParityText("key=" + "a".repeat(40))
    expect(long.redacted).toBe(true)
    expect(long.text).toContain("••••")

    const sk = redactParityText("token sk-1234567890abc")
    expect(sk.text).toContain("••••")

    const bearer = redactParityText("Authorization: Bearer secretvalue123")
    expect(bearer.text).toContain("••••")
    expect(bearer.text).not.toContain("secretvalue123")
  })

  it("leaves ordinary text untouched", () => {
    const plain = redactParityText("Ottili Coder is up to date")
    expect(plain.redacted).toBe(false)
    expect(plain.text).toBe("Ottili Coder is up to date")
  })

  it("never leaks secrets in any state's aria label", () => {
    const secret = "token=" + "z".repeat(50)
    const failure = parityStateView({ status: "failure", error: secret, retry: false })
    expect(failure.ariaLabel).not.toContain("z")
    expect(failure.detail).toContain("••••")
  })
})

describe("parity state coalescing", () => {
  it("commits leading + trailing, latest value wins, flush forces pending", () => {
    const seen: string[] = []
    const queue = createParityStateQueue((s) => seen.push(s.status))

    queue.push({ status: "loading" })
    queue.push({ status: "populated", title: "a" })
    queue.push({ status: "populated", title: "b" })

    // leading committed synchronously, trailing buffered
    expect(seen).toEqual(["loading"])
    queue.flush()
    expect(seen).toEqual(["loading", "populated"])
  })

  it("announces the latest state via live region", () => {
    expect(latestParityAriaLabel([{ status: "loading" }, { status: "offline" }])).toBe("You are offline.")
    expect(latestParityAriaLabel([])).toBe("")
  })
})
