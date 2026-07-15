import { describe, expect, test } from "bun:test"
import {
  bannerTier,
  bannerViewModel,
  channelIsPreview,
  channelLabel,
  colorEnabled,
  compareVersions,
  createUpdateBannerQueue,
  dismissKey,
  isVersionGreater,
  releaseTypeOf,
  shouldShowBanner,
  withinBannerBudget,
  type UpdateBannerState,
  type UpdateChannel,
} from "../../../src/ui/update-banner-model"

function available(channel: UpdateChannel, target = "1.2.3", current = "1.2.0"): UpdateBannerState {
  return { status: "available", channel, target, current, releaseType: releaseTypeOf(current, target) }
}

describe("channelLabel maps the CLI taxonomy to a non-color word", () => {
  test("local → Dev, latest → Stable, beta → Beta, nightly → Nightly", () => {
    expect(channelLabel("local")).toBe("Dev")
    expect(channelLabel("latest")).toBe("Stable")
    expect(channelLabel("beta")).toBe("Beta")
    expect(channelLabel("nightly")).toBe("Nightly")
  })

  test("only stable is not a preview channel", () => {
    expect(channelIsPreview("local")).toBe(true)
    expect(channelIsPreview("beta")).toBe(true)
    expect(channelIsPreview("nightly")).toBe(true)
    expect(channelIsPreview("latest")).toBe(false)
  })
})

describe("version comparison drives visibility", () => {
  test("compareVersions orders major.minor.patch", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1)
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1)
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1)
    expect(compareVersions("1.2.0", "1.2.3")).toBe(-1)
  })

  test("isVersionGreater is strict", () => {
    expect(isVersionGreater("1.2.3", "1.2.2")).toBe(true)
    expect(isVersionGreater("1.2.2", "1.2.3")).toBe(false)
    expect(isVersionGreater("1.2.3", "1.2.3")).toBe(false)
  })

  test("releaseTypeOf classifies major/minor/patch", () => {
    expect(releaseTypeOf("1.2.0", "1.2.3")).toBe("patch")
    expect(releaseTypeOf("1.2.0", "1.3.0")).toBe("minor")
    expect(releaseTypeOf("1.2.0", "2.0.0")).toBe("major")
  })
})

describe("dismissKey scopes a skip to channel@target (closes G5)", () => {
  test("stable beta and stable latest are distinct dismiss keys", () => {
    expect(dismissKey("beta", "1.2.3")).toBe("beta@1.2.3")
    expect(dismissKey("latest", "1.2.3")).toBe("latest@1.2.3")
    expect(dismissKey("beta", "1.2.3")).not.toBe(dismissKey("latest", "1.2.3"))
  })
})

describe("shouldShowBanner encodes visibility rules", () => {
  test("newer target on an undisclosed channel is shown", () => {
    expect(
      shouldShowBanner({ current: "1.2.0", target: "1.2.3", channel: "beta", dismissed: [] }),
    ).toBe(true)
  })

  test("equal version is not shown (no same-version re-prompt)", () => {
    expect(
      shouldShowBanner({ current: "1.2.3", target: "1.2.3", channel: "beta", dismissed: [] }),
    ).toBe(false)
  })

  test("older target is not shown", () => {
    expect(
      shouldShowBanner({ current: "1.2.3", target: "1.2.0", channel: "beta", dismissed: [] }),
    ).toBe(false)
  })

  test("a dismissed channel@target is not shown", () => {
    expect(
      shouldShowBanner({
        current: "1.2.0",
        target: "1.2.3",
        channel: "beta",
        dismissed: ["beta@1.2.3"],
      }),
    ).toBe(false)
  })

  test("dismissal is scoped by channel: a stable skip does not hide a beta prompt at the same version", () => {
    expect(
      shouldShowBanner({
        current: "1.2.0",
        target: "1.2.3",
        channel: "beta",
        dismissed: ["latest@1.2.3"],
      }),
    ).toBe(true)
  })
})

describe("bannerViewModel — stable / beta / nightly visibility and color role", () => {
  test("stable (latest) shows Stable and the success color role", () => {
    const view = bannerViewModel(available("latest"))
    expect(view.title).toContain("Stable")
    expect(view.title).toContain("Update available · v1.2.3")
    expect(view.colorRole).toBe("success")
    expect(view.ariaLabel).toContain("channel Stable")
  })

  test("beta shows the Beta pill and the accent color role", () => {
    const view = bannerViewModel(available("beta"))
    expect(view.title).toContain("[Beta]")
    expect(view.colorRole).toBe("accent")
    expect(view.ariaLabel).toContain("channel Beta")
  })

  test("nightly shows the Nightly pill and the accent color role", () => {
    const view = bannerViewModel(available("nightly"))
    expect(view.title).toContain("[Nightly]")
    expect(view.colorRole).toBe("accent")
  })

  test("hidden renders nothing and exposes no actions", () => {
    const view = bannerViewModel({ status: "hidden" })
    expect(view.title).toBe("")
    expect(view.actions).toEqual([])
    expect(view.ariaLabel).toBe("")
  })
})

describe("bannerViewModel — keyboard hint and action list by width tier", () => {
  test("wide tier shows the full prose hint and all three actions", () => {
    const view = bannerViewModel(available("beta"), { width: 120 })
    expect(view.tier).toBe("wide")
    expect(view.hint).toContain("press [c] notes")
    expect(view.actions.map((a) => a.key)).toEqual(["c", "u", "d"])
  })

  test("standard tier keeps the compact [c] [u] [d] hint", () => {
    const view = bannerViewModel(available("beta"), { width: 90 })
    expect(view.tier).toBe("standard")
    expect(view.hint).toBe("[c] [u] [d]")
    expect(view.actions.map((a) => a.key)).toEqual(["c", "u", "d"])
  })

  test("narrow tier drops the changelog key but keeps update + dismiss", () => {
    const view = bannerViewModel(available("beta"), { width: 50 })
    expect(view.tier).toBe("narrow")
    expect(view.hint).toBe("")
    expect(view.actions.map((a) => a.key)).toEqual(["u", "d"])
  })

  test("minimal tier keeps only the update action (version + update last)", () => {
    const view = bannerViewModel(available("beta"), { width: 40 })
    expect(view.tier).toBe("minimal")
    expect(view.actions.map((a) => a.key)).toEqual(["u"])
  })
})

describe("bannerViewModel — failure path redacts and stays actionable", () => {
  test("failure shows the error (redacted) and a single dismiss action", () => {
    const view = bannerViewModel({ status: "failure", channel: "beta", error: "token=sk-live-abcdefghijklmnop" })
    expect(view.title).toContain("Update check failed")
    expect(view.detail).toContain("••••")
    expect(view.detail).not.toContain("sk-live")
    expect(view.actions.map((a) => a.key)).toEqual(["d"])
    expect(view.ariaLabel).toContain("Update check failed")
  })
})

describe("bannerViewModel — other lifecycle states paint meaningful copy", () => {
  test("loading / empty / denied / offline / installing each render a word, not just color", () => {
    expect(bannerViewModel({ status: "loading", channel: "beta" }).title).toContain("Checking for updates")
    expect(bannerViewModel({ status: "empty", channel: "beta", current: "1.2.3" }).title).toContain("up to date")
    expect(bannerViewModel({ status: "denied", channel: "beta" }).title).toContain("disabled")
    expect(bannerViewModel({ status: "offline", channel: "beta" }).title).toContain("Offline")
    expect(bannerViewModel({ status: "installing", channel: "beta", target: "1.2.3" }).title).toContain("Updating to v1.2.3")
  })

  test("long-content surfaces the detail line", () => {
    const view = bannerViewModel({
      status: "long-content",
      channel: "beta",
      target: "1.2.3",
      current: "1.2.0",
      releaseType: "minor",
      detail: "This release adds streaming feedback and a motion layer.",
    })
    expect(view.detail).toContain("streaming feedback")
  })
})

describe("terminal width tiers (spec §5.2)", () => {
  test("width breakpoints map to wide/standard/narrow/minimal", () => {
    expect(bannerTier(120)).toBe("wide")
    expect(bannerTier(110)).toBe("wide")
    expect(bannerTier(109)).toBe("standard")
    expect(bannerTier(80)).toBe("standard")
    expect(bannerTier(79)).toBe("narrow")
    expect(bannerTier(60)).toBe("narrow")
    expect(bannerTier(59)).toBe("minimal")
    expect(bannerTier(40)).toBe("minimal")
  })
})

describe("colorEnabled is deterministic for tests", () => {
  test("explicit level overrides detection", () => {
    expect(colorEnabled({ level: 0 })).toBe(false)
    expect(colorEnabled({ level: 1 })).toBe(true)
    expect(colorEnabled({ level: 1, noColor: true })).toBe(false)
  })
})

describe("withinBannerBudget caps noisy fields", () => {
  test("truncates a long target and a long error", () => {
    const longTarget = bannerViewModel({
      status: "available",
      channel: "beta",
      target: "1.2.3-".padEnd(300, "x"),
      current: "1.2.0",
      releaseType: "minor",
    })
    expect(longTarget.title.length).toBeLessThan(200)
    const longError = bannerViewModel({
      status: "failure",
      channel: "beta",
      error: "x".repeat(2000),
    })
    expect(longError.detail.length).toBeLessThanOrEqual(500)
  })
})

describe("createUpdateBannerQueue coalesces a burst without timing sleeps", () => {
  test("leading edge commits immediately; trailing push is flushed on demand", () => {
    const commits: UpdateBannerState[] = []
    const queue = createUpdateBannerQueue((s) => commits.push(s), 50)
    queue.push({ status: "loading", channel: "beta" })
    // Leading push commits synchronously.
    expect(commits.length).toBe(1)
    expect(commits[0]!.status).toBe("loading")
    // A second push inside the window is buffered, not committed yet.
    queue.push({ status: "hidden" })
    expect(commits.length).toBe(1)
    // Forcing the flush emits the latest buffered state.
    queue.flush()
    expect(commits.length).toBe(2)
    expect(commits[1]!.status).toBe("hidden")
  })
})
