/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { ContextMeter, type ContextMeterColors } from "../../../src/component/context-meter/index"
import type {
  ContextMeterContext,
  ContextMeterMessage,
  ContextMeterProvider,
} from "../../../src/component/context-meter/model"
import { TestTuiContexts } from "../../fixture/tui-environment"

const mockColors = (): ContextMeterColors => ({
  primary: RGBA.fromValues(0, 200, 200),
  error: RGBA.fromValues(200, 0, 0),
  warning: RGBA.fromValues(200, 200, 0),
  success: RGBA.fromValues(0, 200, 0),
  info: RGBA.fromValues(0, 150, 200),
  text: RGBA.fromValues(200, 200, 200),
  textMuted: RGBA.fromValues(120, 120, 120),
  borderSubtle: RGBA.fromValues(80, 80, 80),
})

const assistant = (over: Partial<ContextMeterMessage> = {}): ContextMeterMessage => ({
  role: "assistant",
  providerID: "openai",
  modelID: "gpt-4.1",
  cost: 0.5,
  tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 10, write: 10 } },
  ...over,
})

const withLimit = (): ContextMeterProvider[] => [
  { id: "openai", name: "OpenAI", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 1000 } } } },
]

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

async function renderMeter(opts: {
  messages: ContextMeterMessage[]
  providers?: ContextMeterProvider[]
  ctx: ContextMeterContext
  width?: number
}) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ContextMeter
          messages={accessor(opts.messages)}
          providers={accessor(opts.providers ?? [])}
          ctx={accessor(opts.ctx)}
          colors={mockColors}
          width={opts.width ?? 120}
        />
      </TestTuiContexts>
    ),
    { width: opts.width ?? 120, height: 40 },
  )
  await app.renderOnce()
  return app
}

describe("ContextMeter — visible, accessible rendering", () => {
  test("loading state is announced in words, not only color", async () => {
    const app = await renderMeter({ messages: [], ctx: { isReady: false, loading: true } })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("↻")
      expect(frame).toContain("Loading context usage")
    } finally {
      app.renderer.destroy()
    }
  })

  test("empty state shows a plain status line", async () => {
    const app = await renderMeter({ messages: [], ctx: { isReady: true } })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("No context usage yet")
    } finally {
      app.renderer.destroy()
    }
  })

  test("populated state shows an ASCII bar (no-color fallback) and core facts", async () => {
    const app = await renderMeter({ messages: [assistant()], providers: withLimit(), ctx: { isReady: true } })
    try {
      const frame = app.captureCharFrame()
      // ASCII progress bar is the color-independent fallback.
      expect(frame).toContain("[")
      expect(frame).toContain("usage:")
      expect(frame).toContain("tokens")
      expect(frame).toContain("cache:")
      expect(frame).toContain("sources:")
    } finally {
      app.renderer.destroy()
    }
  })

  test("degraded state reports the unknown limit instead of a fake percentage", async () => {
    const app = await renderMeter({ messages: [assistant()], providers: [], ctx: { isReady: true } })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("limit unknown")
    } finally {
      app.renderer.destroy()
    }
  })

  test("failure state never leaks the redacted error text", async () => {
    const app = await renderMeter({
      messages: [],
      ctx: { isReady: true, error: "Bearer sk-abcd1234efgh5678 boom" },
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("unavailable")
      expect(frame).not.toContain("sk-abcd1234efgh5678")
    } finally {
      app.renderer.destroy()
    }
  })

  test("denied and offline states are each distinctly labelled", async () => {
    const denied = await renderMeter({ messages: [], ctx: { isReady: true, denied: true, error: "403" } })
    try {
      expect(denied.captureCharFrame()).toContain("access denied")
    } finally {
      denied.renderer.destroy()
    }
    const offline = await renderMeter({ messages: [assistant()], providers: withLimit(), ctx: { isReady: true, offline: true } })
    try {
      expect(offline.captureCharFrame()).toContain("offline")
    } finally {
      offline.renderer.destroy()
    }
  })

  test("long-content compacts the token count", async () => {
    const app = await renderMeter({
      messages: [assistant({ tokens: { input: 60_000, output: 60_000, reasoning: 0, cache: { read: 0, write: 0 } } })],
      providers: withLimit(),
      ctx: { isReady: true },
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("M tokens")
    } finally {
      app.renderer.destroy()
    }
  })

  test("narrow terminals drop the wide-only detail rows", async () => {
    const wide = await renderMeter({ messages: [assistant()], providers: withLimit(), ctx: { isReady: true }, width: 120 })
    const narrow = await renderMeter({ messages: [assistant()], providers: withLimit(), ctx: { isReady: true }, width: 40 })
    try {
      expect(wide.captureCharFrame()).toContain("compaction:")
      expect(narrow.captureCharFrame()).not.toContain("compaction:")
    } finally {
      wide.renderer.destroy()
      narrow.renderer.destroy()
    }
  })

  test("keyboard navigation moves focus without escaping the segment list", async () => {
    const app = await renderMeter({ messages: [assistant()], providers: withLimit(), ctx: { isReady: true } })
    try {
      const initial = app.captureCharFrame()
      const firstLine = initial.split("\n").find((l) => l.includes("usage:"))!
      expect(firstLine.startsWith("> ")).toBe(true)

      app.mockInput.pressArrow("down")
      await app.flush()
      const after = app.captureCharFrame()
      const usageLine = after.split("\n").find((l) => l.includes("usage:"))!
      const cacheLine = after.split("\n").find((l) => l.includes("cache:"))!
      expect(usageLine.startsWith("  ")).toBe(true)
      expect(cacheLine.startsWith("> ")).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })
})
