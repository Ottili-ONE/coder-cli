import { describe, expect, test } from "bun:test"
import { parsePluginSpecifier, readV1Plugin, resolvePluginId, isDeprecatedPlugin } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@opencode-ai/acme")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@opencode-ai/acme@1.0.0")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/ottili-coder/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/ottili-coder/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@opencode-ai/acme@git+https://github.com/ottili-coder/acme.git")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "git+https://github.com/ottili-coder/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/ottili-coder/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/ottili-coder/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@opencode-ai/acme@git+ssh://git@github.com/ottili-coder/acme.git")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "git+ssh://git@github.com/ottili-coder/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/ottili-coder/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/ottili-coder/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@opencode-ai/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@opencode-ai/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@opencode-ai/acme@1.0.0")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@opencode-ai/acme")).toEqual({
      pkg: "@opencode-ai/acme",
      version: "latest",
    })
  })
})

describe("readV1Plugin", () => {
  test("returns the server plugin object in strict mode", () => {
    const plugin = readV1Plugin({ default: { id: "demo", server: () => ({}) } }, "demo", "server")
    expect(plugin).toBeDefined()
    expect(typeof plugin!.server).toBe("function")
  })

  test("returns the tui plugin object in tui mode", () => {
    const plugin = readV1Plugin({ default: { id: "demo", tui: () => ({}) } }, "demo", "tui")
    expect(plugin).toBeDefined()
    expect(typeof plugin!.tui).toBe("function")
  })

  test("detects a plugin without throwing in detect mode", () => {
    const plugin = readV1Plugin({ default: { id: "demo", server: () => ({}) } }, "demo", "server", "detect")
    expect(plugin).toBeDefined()
    expect(typeof plugin!.server).toBe("function")
  })

  test("returns undefined for a non-plugin module in detect mode", () => {
    const plugin = readV1Plugin({ default: { unrelated: true } }, "demo", "server", "detect")
    expect(plugin).toBeUndefined()
  })

  test("rejects a module that exports neither server nor tui in strict mode", () => {
    expect(() => readV1Plugin({ default: { id: "demo" } }, "demo", "server")).toThrow()
  })

  test("rejects a module exporting both server and tui", () => {
    expect(() =>
      readV1Plugin({ default: { id: "demo", server: () => ({}), tui: () => ({}) } }, "demo", "server"),
    ).toThrow()
  })

  test("rejects a server plugin requested as tui", () => {
    expect(() => readV1Plugin({ default: { id: "demo", server: () => ({}) } }, "demo", "tui")).toThrow()
  })

  test("rejects a non-function server export", () => {
    expect(() => readV1Plugin({ default: { id: "demo", server: 123 } }, "demo", "server")).toThrow()
  })

  test("rejects a default export that is not an object", () => {
    expect(() => readV1Plugin({ default: 42 }, "demo", "server")).toThrow()
  })
})

describe("resolvePluginId", () => {
  test("uses the explicit id for file plugins", async () => {
    const id = await resolvePluginId("file", "file:///tmp/plugin.ts", "file:///tmp/plugin.ts", "my-plugin")
    expect(id).toBe("my-plugin")
  })

  test("requires an id from file plugins", async () => {
    await expect(resolvePluginId("file", "file:///tmp/plugin.ts", "file:///tmp/plugin.ts", undefined)).rejects.toThrow()
  })

  test("falls back to the npm package name when no id is given", async () => {
    const id = await resolvePluginId("npm", "acme-plugin", "/x/acme-plugin", undefined, {
      dir: "/x/acme-plugin",
      pkg: "acme-plugin",
      json: { name: "acme-plugin" },
    })
    expect(id).toBe("acme-plugin")
  })

  test("prefers an explicit id over the npm package name", async () => {
    const id = await resolvePluginId("npm", "acme-plugin", "/x/acme-plugin", "override", {
      dir: "/x/acme-plugin",
      pkg: "acme-plugin",
      json: { name: "acme-plugin" },
    })
    expect(id).toBe("override")
  })

  test("rejects a nameless npm package", async () => {
    await expect(
      resolvePluginId("npm", "acme-plugin", "/x/acme-plugin", undefined, {
        dir: "/x/acme-plugin",
        pkg: "acme-plugin",
        json: {},
      }),
    ).rejects.toThrow()
  })
})

describe("isDeprecatedPlugin", () => {
  test("flags built-in auth packages as deprecated", () => {
    expect(isDeprecatedPlugin("ottili-coder-openai-codex-auth")).toBe(true)
    expect(isDeprecatedPlugin("ottili-coder-copilot-auth")).toBe(true)
  })

  test("does not flag ordinary plugins as deprecated", () => {
    expect(isDeprecatedPlugin("acme-plugin")).toBe(false)
    expect(isDeprecatedPlugin("some-ottili-coder-openai-codex-auth-suffix")).toBe(false)
  })
})
