/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { compactViewState, type CompactViewState } from "../../src/routes/session/compact-state"
import { CompactStatusLine, type CompactStatusColors } from "../../src/routes/session/compact-status-line"
import { TestTuiContexts } from "../fixture/tui-environment"

const colors: CompactStatusColors = {
  error: "#ff5555",
  warning: "#ffb86c",
  info: "#8be9fd",
  success: "#50fa7b",
  text: "#f8f8f2",
  textMuted: "#6272a4",
  borderSubtle: "#44475a",
}

async function renderState(state: CompactViewState) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <CompactStatusLine state={state} colors={colors} />
      </TestTuiContexts>
    ),
    { width: 120, height: 10 },
  )
  await app.renderOnce()
  return app
}

describe("CompactStatusLine — every state is rendered and actionable", () => {
  test("loading state is announced in words, not only color", async () => {
    const app = await renderState(compactViewState({ ctx: { isReady: false, loading: true }, data: emptyData() }))
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("↻")
      expect(frame).toContain("Loading session")
    } finally {
      app.renderer.destroy()
    }
  })

  test("empty state reads as actionable text", async () => {
    const app = await renderState(compactViewState({ ctx: { isReady: true }, data: emptyData() }))
    try {
      expect(app.captureCharFrame()).toContain("No messages yet")
    } finally {
      app.renderer.destroy()
    }
  })

  test("populated state reports the message count", async () => {
    const app = await renderState(
      compactViewState({ ctx: { isReady: true }, data: populated(4) }),
    )
    try {
      expect(app.captureCharFrame()).toContain("4 messages")
    } finally {
      app.renderer.destroy()
    }
  })

  test("offline and denied states are explicit", async () => {
    const offline = await renderState(compactViewState({ ctx: { isReady: true, offline: true }, data: emptyData() }))
    const denied = await renderState(compactViewState({ ctx: { isReady: true, denied: true }, data: emptyData() }))
    try {
      expect(offline.captureCharFrame()).toContain("offline")
      expect(denied.captureCharFrame()).toContain("access denied")
    } finally {
      offline.renderer.destroy()
      denied.renderer.destroy()
    }
  })

  test("failure state redacts secrets from the diagnostic", async () => {
    const app = await renderState(
      compactViewState({
        ctx: { isReady: true, error: "request failed: Bearer sk_live_abc123def456" },
        data: emptyData(),
      }),
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("sk_live_abc123def456")
      expect(frame).toContain("••••")
    } finally {
      app.renderer.destroy()
    }
  })

  test("stale (streaming) state appends an updating hint", async () => {
    const app = await renderState(
      compactViewState({ ctx: { isReady: true, loading: true }, data: populated(3) }),
    )
    try {
      expect(app.captureCharFrame()).toContain("updating")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("CompactStatusLine — terminal fallbacks", () => {
  test("no-color terminals use ASCII glyphs and keep the text signal", async () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    let app
    try {
      app = await renderState(
        compactViewState({ ctx: { isReady: false, loading: true }, data: emptyData(), opts: { noColor: true } }),
      )
      const frame = app.captureCharFrame()
      expect(frame).toContain("...")
      expect(frame).toContain("Loading session")
      expect(frame).not.toContain("↻")
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = prev
      app?.renderer.destroy()
    }
  })

  test("color terminals use the symbolic glyph", async () => {
    const app = await renderState(
      compactViewState({ ctx: { isReady: false, loading: true }, data: emptyData(), opts: { noColor: false } }),
    )
    try {
      expect(app.captureCharFrame()).toContain("↻")
    } finally {
      app.renderer.destroy()
    }
  })
})

function emptyData() {
  return { messageCount: 0, hasContent: false, longestMessageLength: 0, totalChars: 0, runningCount: 0 }
}

function populated(count: number) {
  return { messageCount: count, hasContent: true, longestMessageLength: 100, totalChars: count * 100, runningCount: 0 }
}
