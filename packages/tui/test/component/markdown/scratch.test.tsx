/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { MarkdownView } from "../../../src/component/markdown/index"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

async function renderMarkdown(width: number, content: string, props: Record<string, unknown> = {}, height = 40) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <MarkdownView content={content} {...props} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  await app.renderOnce()
  return app
}

test("scratch: inspect frames", async () => {
  const table = `| Name | Role | Status |
| --- | --- | --- |
| Alice | Engineer | active |
| Bob | Designer | idle |`
  const app = await renderMarkdown(120, table)
  const frame = app.captureCharFrame()
  console.log("TABLE_FRAME_START")
  console.log(frame)
  console.log("TABLE_FRAME_END")
  app.renderer.destroy()

  const callout = `> [!WARNING]\n> Something dangerous happened.\n> Be careful.`
  const app2 = await renderMarkdown(120, callout)
  console.log("CALLOUT_START")
  console.log(app2.captureCharFrame())
  console.log("CALLOUT_END")
  app2.renderer.destroy()

  const list = `- one\n- two\n- three`
  const app3 = await renderMarkdown(120, list)
  console.log("LIST_START")
  console.log(app3.captureCharFrame())
  console.log("LIST_END")
  app3.renderer.destroy()
})
