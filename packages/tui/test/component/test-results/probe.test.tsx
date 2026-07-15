/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../../src/config"
import { TestResults } from "../../../src/component/test-results/index"
import { AgentRoster } from "../../../src/component/agent-roster/index"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"

function accessor<T>(value: T): Accessor<T> { return () => value }
function tc(id: string, status: "passed" | "failed" | "skipped" | "todo", extra: Record<string, unknown> = {}) {
  return { id, name: `test ${id}`, status, ...extra } as never
}
const agent = () => ({ name: "general", description: "General purpose agent", mode: "primary", builtIn: true, permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" } } as never)

const errs: string[] = []
const origErr = console.error
console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); }

async function wrap(node: () => unknown) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>{node()}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 120, height: 40 },
  )
  await app.renderOnce()
  return app
}

test("compare", async () => {
  const ar = await wrap(() => <AgentRoster agents={accessor([agent()])} />)
  const tr = await wrap(() => <TestResults tests={accessor([tc("a","passed"), tc("b","failed",{error:"boom"})])} />)
  const arf = ar.captureCharFrame()
  const trf = tr.captureCharFrame()
  console.error = origErr
  console.log("AR_NONBLANK=" + (arf.replace(/\s/g, "").length > 0))
  console.log("AR_SAMPLE=" + arf.replace(/\n/g, "|").slice(0, 200))
  console.log("TR_NONBLANK=" + (trf.replace(/\s/g, "").length > 0))
  console.log("TR_SAMPLE=" + trf.replace(/\n/g, "|").slice(0, 200))
  console.log("ERRORS=" + JSON.stringify(errs.slice(0, 5)))
  ar.renderer.destroy()
  tr.renderer.destroy()
})
