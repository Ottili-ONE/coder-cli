/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { KVProvider } from "../src/context/kv"
import { ThemeProvider } from "../src/context/theme"
import { TuiConfigProvider, resolve } from "../src/config"
import { AgentRoster, toRosterInput } from "../src/component/agent-roster/index"
import type { Agent } from "@opencode-ai/sdk/v2"
import {
  type RosterAgentInput,
  type RosterContext,
  buildState,
  colorSupport,
  deriveRosterStatus,
  effectiveSelection,
  hiddenAgentCount,
  isAgentDenied,
  isNarrow,
  moveSelection,
  normalizeAgent,
  redactSensitive,
  sanitizeForDiagnostics,
  statusGlyph,
  statusLabel,
  visibleAgents,
} from "../src/component/agent-roster/model"

function agent(overrides: Partial<RosterAgentInput> = {}): RosterAgentInput {
  return {
    name: "general",
    description: "General purpose agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    ...overrides,
  }
}

function context(overrides: Partial<RosterContext> = {}): RosterContext {
  return { connected: true, permitted: true, loading: false, partial: false, ...overrides }
}

const readyAgent = agent({ name: "general" })
const deniedAgent = agent({
  name: "locked",
  permission: { edit: "deny", bash: { "*": "deny" } },
})
const offlineAgent = agent({ name: "remote", permission: { edit: "allow", bash: { "*": "allow" } } })

test("deriveRosterStatus classifies every required state", () => {
  expect(deriveRosterStatus(context({ loading: true }), [], 50, false)).toBe("loading")
  expect(deriveRosterStatus(context({ connected: false }), [readyAgent], 50, false)).toBe("offline")
  expect(deriveRosterStatus(context({ permitted: false }), [readyAgent], 50, false)).toBe("denied")
  expect(deriveRosterStatus(context({ error: "boom" }), [readyAgent], 50, false)).toBe("failure")
  expect(deriveRosterStatus(context(), [], 50, false)).toBe("empty")
  expect(
    deriveRosterStatus(context({ partial: true }), [readyAgent], 50, false),
  ).toBe("degraded")
  const degraded = normalizeAgent(readyAgent, { connected: true, errored: true })
  expect(deriveRosterStatus(context(), [degraded], 50, false)).toBe("degraded")
  const many = Array.from({ length: 60 }, (_, i) => agent({ name: `a${i}` }))
  expect(deriveRosterStatus(context(), many, 50, false)).toBe("long-content")
  expect(deriveRosterStatus(context(), many, 50, true)).toBe("populated")
  expect(deriveRosterStatus(context(), [readyAgent], 50, false)).toBe("populated")
})

test("normalizeAgent redacts secrets and derives row status", () => {
  const withSecret = normalizeAgent(
    agent({ name: "secretive", description: "token = sk-abcdefghijklmnopqrstuvwxyz" }),
    { connected: true, errored: false },
  )
  expect(withSecret.redacted).toBe(true)
  expect(withSecret.description).not.toContain("sk-")
  expect(withSecret.status).toBe("ready")

  const off = normalizeAgent(offlineAgent, { connected: false, errored: false })
  expect(off.status).toBe("offline")

  const denied = normalizeAgent(deniedAgent, { connected: true, errored: false })
  expect(denied.status).toBe("denied")
  expect(denied.denied).toBe(true)

  const degraded = normalizeAgent(readyAgent, { connected: true, errored: true })
  expect(degraded.status).toBe("degraded")
})

test("isAgentDenied requires edit and all bash denied", () => {
  expect(isAgentDenied({ edit: "deny", bash: { "*": "deny" } })).toBe(true)
  expect(isAgentDenied({ edit: "deny", bash: { "*": "allow" } })).toBe(false)
  expect(isAgentDenied({ edit: "allow", bash: { "*": "deny" } })).toBe(false)
  expect(isAgentDenied({ edit: "ask", bash: { run: "deny" } })).toBe(false)
})

test("redactSensitive masks tokens, bearer creds and key=value secrets", () => {
  expect(redactSensitive("Bearer abcdefghijklmnopqrstuvwxyz").text).toContain("••••")
  expect(redactSensitive("api_key = supersecretvalue123").text).toContain("••••")
  expect(redactSensitive("password: hunter2pass").text).toContain("••••")
  expect(redactSensitive("sk-abcdefghijklmnopqrstuvwxyz").redacted).toBe(true)
  const clean = redactSensitive("just a normal description")
  expect(clean.redacted).toBe(false)
  expect(clean.text).toBe("just a normal description")
})

test("sanitizeForDiagnostics masks secret keys and string values", () => {
  const input = {
    name: "general",
    token: "abcdefghijklmnopqrstuvwxyz012345",
    nested: { api_key: "should-be-redacted", safe: "kept" },
    list: ["plain", "secret: abcdefghijklmnopqrstuvwxyz012345"],
  }
  const out = sanitizeForDiagnostics(input)
  expect(out.token).toBe("••••")
  expect((out.nested as Record<string, string>).api_key).toBe("••••")
  expect((out.nested as Record<string, string>).safe).toBe("kept")
  expect(out.name).toBe("general")
  expect((out.list as string[])[1]).toContain("••••")
})

test("render budget caps visible rows and reports hidden count", () => {
  const many = Array.from({ length: 120 }, (_, i) => agent({ name: `agent-${i}` }))
  const state = buildState(many, context(), { renderBudget: 50 })
  expect(visibleAgents(state)).toHaveLength(50)
  expect(hiddenAgentCount(state)).toBe(70)

  const expanded = buildState(many, context(), { renderBudget: 50, showAll: true })
  expect(visibleAgents(expanded)).toHaveLength(120)
  expect(hiddenAgentCount(expanded)).toBe(0)
})

test("search filters the roster without exceeding the budget", () => {
  const agents = [agent({ name: "build" }), agent({ name: "explore" }), agent({ name: "general" })]
  const state = buildState(agents, context(), { search: "e", renderBudget: 2 })
  expect(visibleAgents(state).map((a) => a.name).sort()).toEqual(["explore", "general"])
})

test("selection keeps focus valid when the list shrinks (no loss/trap)", () => {
  const a = agent({ name: "a" })
  const b = agent({ name: "b" })
  const c = agent({ name: "c" })
  const full = buildState([a, b, c], context(), { selectedName: "b" })
  expect(effectiveSelection(full)).toBe("b")

  // After "c" is removed, selection should fall back to a still-visible row.
  const shrunk = buildState([a, b], context(), { selectedName: "c" })
  expect(effectiveSelection(shrunk)).toBe("a")

  // After list becomes empty, selection is null (not trapped on a ghost).
  const empty = buildState([], context(), { selectedName: "b" })
  expect(effectiveSelection(empty)).toBeNull()
})

test("moveSelection clamps at the ends of the visible set", () => {
  const agents = [agent({ name: "a" }), agent({ name: "b" }), agent({ name: "c" })]
  const first = buildState(agents, context(), { selectedName: "a" })
  expect(moveSelection(first, -1)).toBe("a")
  const last = buildState(agents, context(), { selectedName: "c" })
  expect(moveSelection(last, 1)).toBe("c")
  const mid = buildState(agents, context(), { selectedName: "a" })
  expect(moveSelection(mid, 1)).toBe("b")
})

test("terminal fallbacks: color support and narrow width", () => {
  expect(colorSupport(0).useColor).toBe(false)
  expect(colorSupport(1).useColor).toBe(true)
  expect(colorSupport(3).useColor).toBe(true)
  expect(isNarrow(40)).toBe(true)
  expect(isNarrow(80)).toBe(false)
  // State is conveyed without color via a textual tag.
  expect(statusGlyph("ready", false)).toBe("[ok]")
  expect(statusGlyph("ready", true)).toBe("●")
  expect(statusLabel("denied")).toBe("denied")
})

test("toRosterInput maps the SDK Agent into the decoupled roster shape", () => {
  const sdkAgent = {
    name: "build",
    mode: "primary" as const,
    builtIn: true,
    permission: { edit: "allow" as const, bash: { "*": "allow" as const } },
  } satisfies Agent
  const mapped = toRosterInput(sdkAgent)
  expect(mapped.name).toBe("build")
  expect(mapped.permission.edit).toBe("allow")
})

// ---- Render tests: prove each state actually paints ----

async function renderRoster(width: number, props: Parameters<typeof AgentRoster>[0]) {
  const app = await testRender(
    () => (
      <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
        <KVProvider>
          <ThemeProvider>
            <AgentRoster {...props} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    ),
    { width, height: 40 },
  )
  await app.renderOnce()
  return app
}

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

test("renders the populated roster with status, markers and description", async () => {
  const app = await renderRoster(120, {
    agents: accessor([readyAgent, agent({ name: "explore", description: "Reads the codebase" })]),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Agent roster:")
    expect(frame).toContain("general")
    expect(frame).toContain("explore")
    expect(frame).toContain("ready")
    expect(frame).toContain("Reads the codebase")
    expect(frame).toContain("> ")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the empty state", async () => {
  const app = await renderRoster(120, { agents: accessor([]) })
  try {
    expect(app.captureCharFrame()).toContain("No agents available")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the loading state", async () => {
  const app = await renderRoster(120, { agents: accessor([]), loading: accessor(true) })
  try {
    expect(app.captureCharFrame()).toContain("Loading agents")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the offline, denied and failure states", async () => {
  const offline = await renderRoster(120, { agents: accessor([readyAgent]), connected: accessor(false) })
  try {
    expect(offline.captureCharFrame()).toContain("offline")
  } finally {
    offline.renderer.destroy()
  }

  const denied = await renderRoster(120, { agents: accessor([readyAgent]), permitted: accessor(false) })
  try {
    expect(denied.captureCharFrame()).toContain("permission denied")
  } finally {
    denied.renderer.destroy()
  }

  const failure = await renderRoster(120, {
    agents: accessor([readyAgent]),
    error: accessor("Bearer secret-token-should-be-redacted"),
  })
  try {
    const frame = failure.captureCharFrame()
    expect(frame).toContain("Failed to load agents")
    expect(frame).not.toContain("secret-token")
  } finally {
    failure.renderer.destroy()
  }
})

test("renders the degraded state with a warning banner", async () => {
  const app = await renderRoster(120, {
    agents: accessor([readyAgent, normalizeAgent(readyAgent, { connected: true, errored: true })]),
    partial: accessor(true),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("degraded")
    expect(frame).toContain("failed to load")
  } finally {
    app.renderer.destroy()
  }
})

test("long-content state shows a budget hint and collapses on narrow terminals", async () => {
  const many = Array.from({ length: 80 }, (_, i) => agent({ name: `agent-${i}` }))
  const wide = await renderRoster(120, { agents: accessor(many), renderBudget: 50 })
  try {
    const frame = wide.captureCharFrame()
    expect(frame).toContain("more")
    expect(frame).toContain("press e to expand")
  } finally {
    wide.renderer.destroy()
  }

  const narrowLong = await renderRoster(40, {
    agents: accessor([readyAgent, agent({ name: "explore", description: "This description must stay hidden on a narrow terminal" })]),
  })
  try {
    const frame = narrowLong.captureCharFrame()
    expect(frame).not.toContain("This description must stay hidden")
  } finally {
    narrowLong.renderer.destroy()
  }
})

test("no-color mode uses textual tags instead of relying on color", async () => {
  const app = await renderRoster(120, { agents: accessor([readyAgent]), colorLevel: 0 })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("[ok]")
  } finally {
    app.renderer.destroy()
  }
})

test("selection is retained and actionable via onSelect", async () => {
  let selected: string | undefined
  const app = await renderRoster(120, {
    agents: accessor([readyAgent, agent({ name: "explore" })]),
    onSelect: (name) => {
      selected = name
    },
  })
  try {
    app.mockInput.send("enter")
    await app.flush()
    expect(selected).toBe("general")
  } finally {
    app.renderer.destroy()
  }
})
