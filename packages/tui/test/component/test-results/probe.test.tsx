/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../../src/config"
import { TestResults } from "../../../src/component/test-results/index"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}
function tc(id: string, status: "passed" | "failed" | "skipped" | "todo", extra: Record<string, unknown> = {}) {
  return { id, name: `test ${id}`, status, ...extra } as never
}

test("probe A: full providers + renderOnce", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <TestResults tests={accessor([tc("a", "passed"), tc("b", "failed", { error: "boom" })])} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 120, height: 40 },
  )
  await app.renderOnce()
  const f = app.captureCharFrame()
  console.log("PROBE_A_LEN=" + f.length)
  console.log("PROBE_A:\n" + f.slice(0, 2000))
  app.renderer.destroy()
})

test("probe B: TestTuiContexts only (no theme) — expect throw", async () => {
  try {
    const app = await testRender(
      () => (
        <TestTuiContexts>
          <TestResults tests={accessor([tc("a", "passed")])} />
        </TestTuiContexts>
      ),
      { width: 120, height: 40 },
    )
    await app.renderOnce()
    console.log("PROBE_B:\n" + app.captureCharFrame().slice(0, 1000))
    app.renderer.destroy()
  } catch (e) {
    console.log("PROBE_B_THREW: " + (e as Error).message)
  }
})
