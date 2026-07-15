import { describe, expect, test } from "bun:test"
import {
  buildGeneralSection,
  buildMcpSection,
  buildModelsSection,
  buildUpdatesSection,
  collectSettings,
  overallSettingsStatus,
  redactSettingsText,
  settingsCounts,
  settingsStatusGlyph,
  settingsStatusWord,
  settingsTier,
  settingsViewModel,
  withinSettingsBudget,
  worstSettingsStatus,
  type SettingsSources,
} from "../../../src/ui/settings-model"

function baseSources(overrides: Partial<SettingsSources> = {}): SettingsSources {
  return {
    version: "1.2.3",
    cwd: "/home/user/project",
    model: { providerID: "openai", modelID: "gpt-4o" },
    favoriteModels: 2,
    permissionRules: [{ action: "read", permission: "allow", pattern: "**" }],
    mcp: { serverA: { status: "connected", enabled: true } },
    hooks: ["pre-commit"],
    git: { available: true, branch: "main", root: "/home/user/project", dirty: false },
    theme: { selected: "ottili-dark", count: 5, mode: "dark" },
    tui: { mouse: true, attentionSound: true, scrollAcceleration: false, diffStyle: "auto" },
    privacy: { telemetry: false, crashReports: true, clipboardHistory: true },
    update: { status: "empty", channel: "latest" },
    ...overrides,
  }
}

describe("collectSettings assembles the nine real domains", () => {
  test("sections appear in the canonical order", () => {
    const ids = collectSettings(baseSources()).sections.map((s) => s.id)
    expect(ids).toEqual([
      "general",
      "models",
      "permissions",
      "mcp",
      "hooks",
      "git",
      "appearance",
      "privacy",
      "updates",
    ])
  })

  test("every section has a non-empty title", () => {
    for (const section of collectSettings(baseSources()).sections) {
      expect(section.title.length).toBeGreaterThan(0)
    }
  })
})

describe("section status rollups", () => {
  test("worstSettingsStatus ranks error > warn > unknown > ok", () => {
    expect(worstSettingsStatus(["ok", "ok"])).toBe("ok")
    expect(worstSettingsStatus(["ok", "warn"])).toBe("warn")
    expect(worstSettingsStatus(["warn", "unknown"])).toBe("warn")
    expect(worstSettingsStatus(["unknown", "error"])).toBe("error")
  })

  test("models section warns when no model is selected", () => {
    const section = buildModelsSection(baseSources({ model: null }))
    expect(section.status).toBe("warn")
    expect(section.rows[0]?.value).toBe("not selected")
  })

  test("mcp section surfaces error for failed servers and ok for connected", () => {
    const section = buildMcpSection({
      good: { status: "connected", enabled: true },
      bad: { status: "failed", enabled: true },
    })
    expect(section.status).toBe("error")
    const bad = section.rows.find((r) => r.label === "bad")
    expect(bad?.status).toBe("error")
  })

  test("mcp section reports an honest note when none configured", () => {
    const section = buildMcpSection({})
    expect(section.rows).toHaveLength(0)
    expect(section.note).toMatch(/no mcp/i)
  })
})

describe("git and hooks honest fallbacks", () => {
  test("git section warns when not a repository", () => {
    const section = buildGeneralSection(baseSources())
    expect(section.status).toBe("ok")
    const git = collectSettings(baseSources({ git: null })).sections.find((s) => s.id === "git")
    expect(git?.status).toBe("warn")
    expect(git?.note).toMatch(/not a git/i)
  })

  test("hooks section notes when none configured", () => {
    const hooks = collectSettings(baseSources({ hooks: [] })).sections.find((s) => s.id === "hooks")
    expect(hooks?.rows).toHaveLength(0)
    expect(hooks?.note).toMatch(/no hooks/i)
  })
})

describe("updates section maps update state to a status", () => {
  test("available update is ok", () => {
    const section = buildUpdatesSection({ status: "available", channel: "beta", target: "2.0.0" })
    expect(section.status).toBe("ok")
    expect(section.rows.find((r) => r.label === "Status")?.value).toContain("2.0.0")
  })
  test("failure is error", () => {
    expect(buildUpdatesSection({ status: "failure" }).status).toBe("error")
  })
})

describe("overall + counts", () => {
  test("overall status is the worst across sections", () => {
    const data = collectSettings(baseSources({ mcp: { bad: { status: "failed", enabled: true } } }))
    expect(overallSettingsStatus(data)).toBe("error")
    const counts = settingsCounts(data)
    expect(counts.error).toBeGreaterThanOrEqual(1)
  })
})

describe("presentation helpers", () => {
  test("settingsTier picks width tiers", () => {
    expect(settingsTier(120)).toBe("wide")
    expect(settingsTier(90)).toBe("standard")
    expect(settingsTier(70)).toBe("narrow")
    expect(settingsTier(40)).toBe("minimal")
  })

  test("glyph and word never rely on color alone", () => {
    expect(settingsStatusGlyph("ok")).toBe("●")
    expect(settingsStatusGlyph("ok", false)).toBe("[ok]")
    expect(settingsStatusWord("error")).toBe("error")
  })

  test("view model carries an accessible label and section order", () => {
    const view = settingsViewModel(collectSettings(baseSources()), { width: 120 })
    expect(view.tier).toBe("wide")
    expect(view.sections).toHaveLength(9)
    expect(view.ariaLabel).toMatch(/settings/i)
  })
})

describe("redaction + budget", () => {
  test("secrets are redacted", () => {
    const out = redactSettingsText("token sk-abcdef1234567890secret")
    expect(out.redacted).toBe(true)
    expect(out.text).not.toContain("sk-abcdef")
  })

  test("values are capped to a budget", () => {
    expect(withinSettingsBudget("a".repeat(50), 10)).toHaveLength(10)
  })
})
