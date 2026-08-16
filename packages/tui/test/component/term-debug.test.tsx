/** @jsxImportSource @opentui/solid */
import { test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TerminalOutput } from "../../src/component/terminal-output/index"
import { createSignal, type Accessor } from "solid-js"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

test("debug flush vs renderOnce", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <TerminalOutput lines={accessor(["hello world"])} complete={accessor(true)} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 120, height: 40 },
  )
  await app.renderOnce()
  const once = app.captureCharFrame()
  console.log("RENDER_ONCE_LEN", once.length)
  console.log("RENDER_ONCE_SNIP", JSON.stringify(once.slice(0, 200)))
  await app.flush()
  const spanFrame = app.captureSpans()
  const allText = spanFrame.lines
    .flatMap((line) => line.spans.map((span) => span.text))
    .join("")
  console.log("SPAN_TEXT", JSON.stringify(allText.slice(0, 400)))
  console.log("HAS_HELLO", allText.includes("hello world"))
  app.renderer.destroy()
})
