/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { describe, expect, test } from "bun:test"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { DialogSelect, type DialogSelectOption } from "../../../src/ui/dialog-select"
import { DialogProvider, Dialog } from "../../../src/ui/dialog"
import { ThemeProvider } from "../../../src/context/theme"
import { ToastProvider } from "../../../src/ui/toast"
import { KVProvider } from "../../../src/context/kv"
import { TuiConfigProvider } from "../../../src/config"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../../../src/keymap"

describe("debug", () => {
  test("render dialog select minimal", async () => {
    const options: DialogSelectOption<string>[] = [
      { title: "alpha", value: "a" },
      { title: "beta", value: "b" },
    ]
    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
      const off = registerOttiliCoderKeymap(keymap, renderer, resolvedConfig)
      onCleanup(off)
      return (
        <TestTuiContexts>
          <OttiliCoderKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={resolvedConfig}>
              <KVProvider>
                <ThemeProvider>
                  <ToastProvider>
                    <DialogProvider>
                      <Dialog size="large" onClose={() => {}}>
                        <DialogSelect<string>
                          title="Projects"
                          options={options}
                          renderFilter={false}
                          onSelect={() => {}}
                        />
                      </Dialog>
                    </DialogProvider>
                  </ToastProvider>
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OttiliCoderKeymapProvider>
        </TestTuiContexts>
      )
    }
    const app = await testRender(() => <Harness />, { width: 120, height: 30, kittyKeyboard: true })
    await app.flush()
    const frame = app.captureCharFrame()
    console.log("FRAME_LEN", frame.length)
    console.log("HAS_ALPHA", frame.includes("alpha"))
    console.log("SLICE", JSON.stringify(frame.slice(0, 400)))
    app.renderer.destroy()
    expect(true).toBe(true)
  })
})
