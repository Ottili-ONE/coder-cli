import { describe, expect, test } from "bun:test"

import { createBindingLookup } from "../src/tui"

describe("plugin.tui.createBindingLookup", () => {
  test("returns a no-op lookup for an undefined config", () => {
    const lookup = createBindingLookup(undefined)
    expect(typeof lookup.get).toBe("function")
    expect(typeof lookup.has).toBe("function")
    expect(lookup.has("command.palette.show")).toBe(false)
    expect(lookup.get("command.palette.show")).toEqual([])
  })

  test("exposes bindings declared in a command config", () => {
    // BindingConfig is a flat command -> binding(s) record per @opentui/keymap.
    const lookup = createBindingLookup({
      "demo.run": { keys: ["d", "r"] as any },
    } as any)

    expect(lookup.has("demo.run")).toBe(true)
    const found = lookup.get("demo.run")
    expect(Array.isArray(found)).toBe(true)
    expect(found.length).toBeGreaterThan(0)
    expect(lookup.has("demo.missing")).toBe(false)
    expect(lookup.get("demo.missing")).toEqual([])
  })
})
