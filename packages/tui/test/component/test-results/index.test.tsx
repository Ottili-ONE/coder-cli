/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../../src/config"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"
import { TestResults } from "../../../src/component/test-results/index"
import type { TestCaseInput } from "../../../src/component/test-results/model"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

function tc(id: string, status: TestCaseInput["status"], extra: Partial<TestCaseInput> = {}): TestCaseInput {
  return { id, name: `test ${id}`, status, ...extra }
}

async function renderResults(width: number, props: Parameters<typeof TestResults>[0], height = 40) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <TestResults {...props} />
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

test("renders the empty state with an accessible label", async () => {
  const app = await renderResults(120, { tests: accessor([]) })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Test results:")
    expect(frame).toContain("no tests")
    expect(frame).toContain("No tests found")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the loading state", async () => {
  const app = await renderResults(120, { tests: accessor([]), loading: accessor(true) })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("loading")
    expect(frame).toContain("Loading test results")
  } finally {
    app.renderer.destroy()
  }
})

test("renders populated results with counts and redacted failures", async () => {
  const app = await renderResults(120, {
    tests: accessor([
      tc("a", "passed", { durationMs: 12 }),
      tc("b", "failed", { error: "AssertionError: expected true bearer-secret-token-abcdefghij" }),
      tc("c", "skipped"),
    ]),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("3 tests")
    expect(frame).toContain("1 passed")
    expect(frame).toContain("1 failed")
    expect(frame).toContain("1 skipped")
    // Secret in the failure is redacted in the visual output.
    expect(frame).not.toContain("bearer-secret-token")
    expect(frame).toContain("••••")
    // Status labels are present so color is never the only cue.
    expect(frame).toContain("passed")
    expect(frame).toContain("failed")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the offline state", async () => {
  const app = await renderResults(120, { tests: accessor([]), connected: accessor(false) })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("offline")
    expect(frame).toContain("Test results unavailable")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the denied state", async () => {
  const app = await renderResults(120, { tests: accessor([]), permitted: accessor(false) })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("permission")
    expect(frame).toContain("Test results hidden")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the failure state and redacts the harness error", async () => {
  const app = await renderResults(120, {
    tests: accessor([]),
    error: accessor("discovery failed: api_key = supersecretvalue123"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Test run failed")
    expect(frame).not.toContain("supersecretvalue123")
    expect(frame).toContain("••••")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the degraded state when the run is partial", async () => {
  const app = await renderResults(120, {
    tests: accessor([tc("a", "passed"), tc("b", "failed")]),
    partial: accessor(true),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("partial")
    expect(frame).toContain("Some suites did not run")
    // Rows still render under the degraded banner.
    expect(frame).toContain("test a")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the long-content budget hint", async () => {
  const many = Array.from({ length: 250 }, (_, i) => tc(`t${i}`, "passed"))
  const app = await renderResults(120, { tests: accessor(many), renderBudget: 200 })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("more")
    expect(frame).toContain("press e to expand")
    // Only the budgeted slice is painted, not all 250.
    expect(frame).not.toContain("test t249")
  } finally {
    app.renderer.destroy()
  }
})

test("narrow terminals stay usable and drop secondary columns", async () => {
  const app = await renderResults(40, {
    tests: accessor([tc("a", "passed", { file: "packages/foo/very/long/path.test.ts", durationMs: 42 })]),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("test a")
    // No duration column in narrow mode.
    expect(frame).not.toContain("42ms")
  } finally {
    app.renderer.destroy()
  }
})

test("shows a running hint while streaming results", async () => {
  const app = await renderResults(120, {
    tests: accessor([tc("a", "passed")]),
    running: accessor(true),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("running")
  } finally {
    app.renderer.destroy()
  }
})
