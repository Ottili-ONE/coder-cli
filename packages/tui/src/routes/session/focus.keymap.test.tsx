/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { TuiKeybind } from "../src/config/keybind"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../src/keymap"

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

test("focus_toggle default binding is the leader-f chord", () => {
  expect(TuiKeybind.defaultValue("focus_toggle")).toBe("<leader>f")
})

test("focus_toggle maps to the session.focus.toggle command", () => {
  expect(TuiKeybind.CommandMap.focus_toggle).toBe("session.focus.toggle")
})

test("session.focus.toggle resolves to a leader chord ending in 'f'", async () => {
  const sequences: string[][] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOttiliCoderKeymap(keymap, renderer, config)
    keymap.registerLayer({
      commands: [{ name: "session.focus.toggle", run() {} }],
      bindings: config.keybinds.gather("session", ["session.focus.toggle"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.focus.toggle"],
    })
    for (const binding of bindings.get("session.focus.toggle") ?? []) {
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
    // The binding must exist and be a leader chord (leader + f).
    expect(sequences.length).toBeGreaterThan(0)
    for (const seq of sequences) {
      expect(seq.length).toBe(2)
      expect(seq[seq.length - 1]).toBe("f")
    }
  } finally {
    app.renderer.destroy()
  }
})

test("focus_toggle overrides are honoured by the resolved keymap", () => {
  const keybinds = TuiKeybind.parse({ focus_toggle: "ctrl+f" })
  const config = createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
  const bindings = config.gather("session", ["session.focus.toggle"])
  // The override replaces the two-stroke leader chord with a single stroke.
  expect(bindings.length).toBe(1)
  expect(bindings[0].sequence.length).toBe(1)
})
