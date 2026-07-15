/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { TuiKeybind } from "../../config/keybind"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../../keymap"

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

test("session_compact default binding is the leader-c chord", () => {
  expect(TuiKeybind.defaultValue("session_compact")).toBe("<leader>c")
})

test("session_compact maps to the session.compact command", () => {
  expect(TuiKeybind.CommandMap.session_compact).toBe("session.compact")
})

test("session.compact resolves to a leader chord ending in 'c'", async () => {
  const sequences: string[][] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOttiliCoderKeymap(keymap, renderer, config)
    keymap.registerLayer({
      commands: [{ name: "session.compact", run() {} }],
      bindings: config.keybinds.gather("session", ["session.compact"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.compact"],
    })
    for (const binding of bindings.get("session.compact") ?? []) {
      sequences.push(binding.sequence.map((part) => part.stroke.name))
    }
    onCleanup(() => offKeymap())

    return (
      <OttiliCoderKeymapProvider keymap={keymap}>
        <box />
      </OttiliCoderKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    // The binding must exist and be a leader chord (leader + c).
    expect(sequences.length).toBeGreaterThan(0)
    for (const seq of sequences) {
      expect(seq.length).toBe(2)
      expect(seq[seq.length - 1]).toBe("c")
    }
  } finally {
    app.renderer.destroy()
  }
})

test("session_compact overrides are honoured by the resolved keymap", () => {
  // Default is the two-stroke leader chord "<leader>c" (leader + c).
  const defaults = TuiKeybind.parse({})
  const defaultConfig = createBindingLookup(TuiKeybind.toBindingConfig(defaults), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
  const defaultBindings = defaultConfig.gather("session", ["session.compact"])
  expect(defaultBindings.length).toBe(1)
  expect(typeof defaultBindings[0].key).toBe("string")
  expect(defaultBindings[0].key).toContain("leader")

  // An override replaces the leader chord with a single key stroke.
  const keybinds = TuiKeybind.parse({ session_compact: "ctrl+k" })
  const config = createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
  const bindings = config.gather("session", ["session.compact"])
  expect(bindings.length).toBe(1)
  expect(bindings[0].key).toBe("ctrl+k")
})
