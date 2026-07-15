/** @jsxImportSource @opentui/solid */
import { testRender, useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { onCleanup, onMount, type JSX } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { SDKProvider } from "../../src/context/sdk"
import { ProjectProvider } from "../../src/context/project"
import { ExitProvider } from "../../src/context/exit"
import { SyncProvider } from "../../src/context/sync"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ToastProvider } from "../../src/ui/toast"
import { DialogProvider } from "../../src/ui/dialog"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../../src/keymap"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"
import {
  DegradedStateProvider,
  DegradedStates,
  DegradedStateView,
  useDegradedState,
} from "../../src/component/error-state/index"
import {
  CATEGORY_LABEL,
  type DegradedState,
  type ErrorCategory,
} from "../../src/component/error-state/model"

function makeState(over: Partial<DegradedState> = {}): DegradedState {
  return {
    id: "provider:down",
    category: "provider",
    severity: "error",
    title: "Provider request failed",
    message: "Bearer sk-live-abcdefghijklmnop rejected",
    dismissible: true,
    createdAt: 0,
    ...over,
  }
}

async function render(width: number, state: DegradedState) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <DegradedStateView state={state} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 40 },
  )
  await app.renderOnce()
  return app
}

test("paints severity word, category and title (never color-only)", async () => {
  const app = await render(120, makeState())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("ERROR")
    expect(frame).toContain("Provider")
    expect(frame).toContain("Provider request failed")
  } finally {
    app.renderer.destroy()
  }
})

test("redacts secrets from the painted message", async () => {
  const app = await render(120, makeState())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("••••")
    expect(frame).not.toContain("sk-live")
  } finally {
    app.renderer.destroy()
  }
})

test("stays usable on a narrow terminal", async () => {
  const app = await render(50, makeState())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Provider request failed")
    expect(frame).toContain("dismiss")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps long content within the render budget", async () => {
  const long = "START" + "x".repeat(2000) + "UNIQUETAIL"
  const app = await render(120, makeState({ message: long }))
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("START")
    expect(frame).not.toContain("UNIQUETAIL")
  } finally {
    app.renderer.destroy()
  }
})

test("offline / denied derived states remain actionable", async () => {
  const offline = makeState({
    id: "provider:disconnected",
    category: "network",
    severity: "warning",
    title: "No AI provider connected",
    message: "Connect a provider or sign in to Ottili to enable model requests.",
    actionLabel: "Connect",
    actionCommand: "connect",
    dismissible: false,
  })
  const app = await render(120, offline)
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("WARNING")
    expect(frame).toContain("Connect")
    // Non-dismissible states show no dismiss affordance.
    expect(frame).not.toContain("dismiss")
  } finally {
    app.renderer.destroy()
  }
})

// --- Presentational category coverage (meaningful output, not trivia) ---

test("renders Git, MCP, Tests and Server categories with their labels and ERROR severity", async () => {
  for (const cat of ["git", "mcp", "test", "server"] as const) {
    const app = await render(120, makeState({ id: `${cat}:1`, category: cat, severity: "error", title: `${cat} broke`, message: `${cat} detail message` }))
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("ERROR")
      expect(frame).toContain(CATEGORY_LABEL[cat])
      expect(frame).toContain(`${cat} broke`)
    } finally {
      app.renderer.destroy()
    }
  }
})

test("renders an info-severity state with the INFO word marker", async () => {
  const app = await render(120, makeState({ id: "provider:info", category: "provider", severity: "info", title: "Rate limit notice", message: "You are approaching your quota." }))
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("INFO")
    expect(frame).toContain("Provider")
    expect(frame).toContain("Rate limit notice")
  } finally {
    app.renderer.destroy()
  }
})

test("narrow terminal keeps every category label and message readable", async () => {
  for (const cat of ["provider", "network", "git", "mcp", "test", "server"] as const) {
    const app = await render(50, makeState({ id: `${cat}:n`, category: cat, severity: "error", title: `${cat} broke`, message: `${cat} detail message` }))
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain(CATEGORY_LABEL[cat])
      expect(frame).toContain(`${cat} detail message`)
    } finally {
      app.renderer.destroy()
    }
  }
})

// ---------------------------------------------------------------------------
// Aggregate panel (DegradedStates) — keyboard, focus, transitions, resize,
// streaming. Mounted inside the real provider stack so keyboard handlers,
// dialog resolution, clipboard and sync-derived state all behave like prod.
// ---------------------------------------------------------------------------

type Panel = { app: Awaited<ReturnType<typeof testRender>>; api: ReturnType<typeof useDegradedState>; writes: string[] }

function KeymapWrapper(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
  onCleanup(registerOttiliCoderKeymap(keymap, renderer, resolvedConfig))
  return <OttiliCoderKeymapProvider keymap={keymap}>{props.children}</OttiliCoderKeymapProvider>
}

function mountPanel(opts: { width?: number; height?: number; states?: DegradedState[] } = {}): Promise<Panel> {
  const writes: string[] = []
  const clipboard = { write: async (text: string) => { writes.push(text) } }
  let api!: ReturnType<typeof useDegradedState>
  let ready!: () => void
  const readyPromise = new Promise<void>((resolve) => { ready = resolve })

  function Probe(): JSX.Element {
    api = useDegradedState()
    onMount(() => {
      for (const state of opts.states ?? []) api.push(state)
      ready()
    })
    return <box />
  }

  const calls = createFetch((url) => {
    // Mark the account as signed in so the derived "no provider" network state
    // does not appear; we push our own network state deterministically.
    if (url.pathname === "/experimental/account/status") return json({ loggedIn: true, email: "test@ottili.one" })
    return undefined
  })
  const events = createEventSource()

  return testRender(() => (
    <TestTuiContexts>
      <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
        <KeymapWrapper>
          <ArgsProvider>
            <KVProvider>
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                <ProjectProvider>
                  <ExitProvider exit={() => {}}>
                    <SyncProvider>
                      <ThemeProvider>
                        <ClipboardProvider value={clipboard}>
                          <ToastProvider>
                            <DialogProvider>
                              <DegradedStateProvider>
                                <Probe />
                                <DegradedStates />
                              </DegradedStateProvider>
                            </DialogProvider>
                          </ToastProvider>
                        </ClipboardProvider>
                      </ThemeProvider>
                    </SyncProvider>
                  </ExitProvider>
                </ProjectProvider>
              </SDKProvider>
            </KVProvider>
          </ArgsProvider>
        </KeymapWrapper>
      </TuiConfigProvider>
    </TestTuiContexts>
  ), { width: opts.width ?? 120, height: opts.height ?? 40 }).then(async (app) => {
    await readyPromise
    await app.flush()
    return { app, api, writes }
  })
}

describe("DegradedStates panel — all categories render actionable output", () => {
  const all: ErrorCategory[] = ["provider", "network", "git", "mcp", "test", "server"]

  test("shows provider, network, git, mcp, test and server failures with severity words", async () => {
    const states: DegradedState[] = [
      makeState({ id: "provider:1", category: "provider", severity: "error", title: "Provider request failed", message: "401 Unauthorized from Anthropic" }),
      makeState({ id: "network:1", category: "network", severity: "warning", title: "Network unreachable", message: "Connection refused to api.ottili.one" }),
      makeState({ id: "git:1", category: "git", severity: "error", title: "Git operation failed", message: "fatal: not a git repository" }),
      makeState({ id: "mcp:1", category: "mcp", severity: "error", title: 'MCP server "fs" failed', message: "The MCP server stopped unexpectedly." }),
      makeState({ id: "test:1", category: "test", severity: "error", title: "Tests failed", message: "3 assertions failed in suite" }),
      makeState({ id: "server:1", category: "server", severity: "error", title: "Server error", message: "500 Internal Server Error from Ottili Cloud" }),
    ]
    const { app } = await mountPanel({ states })
    try {
      const frame = app.captureCharFrame()
      for (const cat of all) expect(frame).toContain(CATEGORY_LABEL[cat])
      expect(frame).toContain("ERROR")
      expect(frame).toContain("WARNING")
      expect(frame).toContain("401 Unauthorized from Anthropic")
      expect(frame).toContain("fatal: not a git repository")
      expect(frame).toContain("3 assertions failed in suite")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DegradedStates panel — keyboard navigation and focus", () => {
  function twoStates(): DegradedState[] {
    return [
      makeState({ id: "a", category: "provider", title: "Alpha Problem", message: "alpha-message" }),
      makeState({ id: "b", category: "git", title: "Beta Problem", message: "beta-message" }),
    ]
  }

  test("down/j and up/k move focus across states", async () => {
    const { app, writes } = await mountPanel({ states: twoStates() })
    try {
      // Focus starts on the first state; copy proves which one is focused.
      app.mockInput.pressKey("c")
      await app.flush()
      expect(writes.at(-1)).toContain("alpha-message")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("c")
      await app.flush()
      expect(writes.at(-1)).toContain("beta-message")

      app.mockInput.pressKey("k")
      await app.flush()
      app.mockInput.pressKey("c")
      await app.flush()
      expect(writes.at(-1)).toContain("alpha-message")
    } finally {
      app.renderer.destroy()
    }
  })

  test("navigation clamps at the first and last state", async () => {
    const { app, writes } = await mountPanel({ states: twoStates() })
    try {
      app.mockInput.pressArrow("up")
      await app.flush()
      app.mockInput.pressKey("c")
      await app.flush()
      expect(writes.at(-1)).toContain("alpha-message")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("c")
      await app.flush()
      expect(writes.at(-1)).toContain("beta-message")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DegradedStates panel — state transitions and dismissal", () => {
  function twoStates(): DegradedState[] {
    return [
      makeState({ id: "a", category: "provider", title: "Alpha Problem", message: "alpha-message" }),
      makeState({ id: "b", category: "git", title: "Beta Problem", message: "beta-message" }),
    ]
  }

  test("'d' dismisses the focused state and removes it from the panel", async () => {
    const { app } = await mountPanel({ states: twoStates() })
    try {
      expect(app.captureCharFrame()).toContain("Alpha Problem")
      app.mockInput.pressKey("d")
      await app.flush()
      const after = app.captureCharFrame()
      expect(after).not.toContain("Alpha Problem")
      expect(after).toContain("Beta Problem")
    } finally {
      app.renderer.destroy()
    }
  })

  test("escape also dismisses, and dismissing every state empties the panel", async () => {
    const { app } = await mountPanel({ states: twoStates() })
    try {
      app.mockInput.pressKey("escape")
      await app.flush()
      let frame = app.captureCharFrame()
      expect(frame).not.toContain("Alpha Problem")
      expect(frame).toContain("Beta Problem")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("d")
      await app.flush()
      frame = app.captureCharFrame()
      expect(frame).not.toContain("Beta Problem")
      // No actionable rows remain — category labels are gone too.
      expect(frame).not.toContain("Provider")
      expect(frame).not.toContain("Git")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DegradedStates panel — resize behavior", () => {
  test("remains complete and usable on narrow and standard widths", async () => {
    const states: DegradedState[] = [
      makeState({ id: "a", category: "provider", title: "Alpha Problem", message: "alpha-message content here" }),
      makeState({ id: "b", category: "git", title: "Beta Problem", message: "beta-message content here" }),
    ]
    const { app } = await mountPanel({ states, width: 120 })
    try {
      const wide = app.captureCharFrame()
      expect(wide).toContain("Alpha Problem")
      expect(wide).toContain("Beta Problem")
      expect(wide).toContain("dismiss")

      app.resize(50, 40)
      await app.flush()
      const narrow = app.captureCharFrame()
      expect(narrow).toContain("Alpha Problem")
      expect(narrow).toContain("Beta Problem")
      expect(narrow).toContain("dismiss")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DegradedStates panel — streaming updates and coalescing", () => {
  test("re-pushing the same id updates in place without a duplicate row", async () => {
    const { app, api } = await mountPanel({ states: [] })
    try {
      api.push(makeState({ id: "x", category: "provider", title: "Transient", message: "attempt 1" }))
      await app.flush()
      expect(app.captureCharFrame()).toContain("attempt 1")

      api.push(makeState({ id: "x", category: "provider", title: "Transient", message: "attempt 2" }))
      await app.flush()
      const frame = app.captureCharFrame()
      expect(frame).toContain("attempt 2")
      expect(frame).not.toContain("attempt 1")
      expect(frame.split("Transient").length - 1).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("caps the visible queue at MAX_DEGRADED_STATES, dropping the oldest", async () => {
    const states: DegradedState[] = Array.from({ length: 8 }, (_, i) =>
      makeState({ id: `s${i}`, category: "test", title: `Run ${i}`, message: `run ${i} failed` }),
    )
    const { app } = await mountPanel({ states })
    try {
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("Run 0")
      expect(frame).toContain("Run 7")
      let shown = 0
      for (let i = 0; i < 8; i++) if (frame.includes(`Run ${i}`)) shown++
      expect(shown).toBe(6)
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("DegradedStates panel — failure path classification", () => {
  test("a provider 401 surfaces as an ERROR with an actionable, redacted message", async () => {
    const states: DegradedState[] = [
      makeState({
        id: "provider:401",
        category: "provider",
        severity: "error",
        title: "Provider request failed",
        message: "Bearer sk-live-abcdefghijklmnop rejected: 401 Unauthorized",
      }),
    ]
    const { app } = await mountPanel({ states })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("ERROR")
      expect(frame).toContain("Provider")
      expect(frame).toContain("401 Unauthorized")
      expect(frame).toContain("••••")
      expect(frame).not.toContain("sk-live")
    } finally {
      app.renderer.destroy()
    }
  })
})
