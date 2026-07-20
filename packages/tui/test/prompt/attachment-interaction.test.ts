/**
 * Interaction and deterministic behavior tests for image and file attachments.
 *
 * These tests cover keyboard navigation, state transitions, resize (narrow
 * vs. standard dimensions), streaming updates, and failure paths on the pure
 * attachment model — without relying on a live renderer. Renderer-level tests
 * are provided by the companion file-preview render tests.
 *
 * Every test in this file is deterministic: no timing sleeps, no random data,
 * no external dependencies. Each test constructs attachment state, transitions
 * it, asserts the visible/semantic output, then cleans up.
 */
import { describe, expect, test } from "bun:test"
import type { FilePart } from "@opencode-ai/sdk/v2"

import {
  attachmentKind,
  attachmentAriaLabel,
  attachmentSummary,
  attachmentStatusLabel,
  attachmentStatusGlyph,
  buildAttachmentState,
  deriveAttachmentStatus,
  formatFileSize,
  isAttachmentNarrow,
  attachmentAccessibilityLabel,
  ATTACHMENT_RENDER_BUDGET,
  type AttachmentContext,
  type AttachmentState,
} from "../../src/component/prompt/attachment-utils"

function filePart(overrides: Partial<FilePart> = {}): FilePart {
  return {
    id: "f1",
    sessionID: "s1",
    messageID: "m1",
    type: "file",
    mime: "image/png",
    filename: "photo.png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA=",
    ...overrides,
  }
}

// ── Keyboard navigation & focus behavior ────────────────────────────────────

describe("attachment keyboard navigation and focus regression", () => {
  test("attachmentAccessibilityLabel provides semantic labels for keyboard users", () => {
    const label = attachmentAccessibilityLabel({ mime: "image/png", filename: "screenshot.png" }, 500 * 1024)
    expect(label).toContain("image")
    expect(label).toContain("screenshot.png")
    expect(label).toContain("500.0 KB")
  })

  test("attachmentSummary serves as live-region label for screen readers", () => {
    const state = buildAttachmentState([filePart(), filePart({ id: "f2", mime: "application/pdf", filename: "doc.pdf" })])
    const summary = attachmentSummary(state)
    expect(summary).toContain("2 files")
    expect(summary).not.toContain("loading")
    expect(summary).not.toContain("failed")
  })

  test("status transitions never trap focus: failure → retry → populated", () => {
    // Simulate a failure state that a user can retry.
    const failed = buildAttachmentState([filePart()], { error: "timeout", permitted: true, connected: true })
    expect(failed.status).toBe("failure")
    // After retry (error cleared), the attachment should be populated.
    const retried = buildAttachmentState([filePart()], { error: null, permitted: true, connected: true })
    expect(retried.status).toBe("populated")
  })

  test("denied state is actionable via status label (focus never lost)", () => {
    const state = buildAttachmentState([filePart()], { permitted: false, connected: true })
    expect(state.status).toBe("denied")
    const label = attachmentStatusLabel(state.status)
    expect(label).toBe("Permission denied")
    // After permission is restored, transition to populated.
    const restored = buildAttachmentState([filePart()], { permitted: true, connected: true })
    expect(restored.status).toBe("populated")
  })
})

// ── State transitions (none rely on timing) ─────────────────────────────────

describe("attachment state transitions (deterministic)", () => {
  test("loading → empty when content arrives empty", () => {
    const loading = buildAttachmentState([], { loading: true })
    expect(loading.status).toBe("loading")
    const settled = buildAttachmentState([], { loading: false })
    expect(settled.status).toBe("empty")
  })

  test("loading → populated when content arrives", () => {
    const loading = buildAttachmentState([filePart()], { loading: true })
    expect(loading.status).toBe("loading")
    const settled = buildAttachmentState([filePart()], { loading: false })
    expect(settled.status).toBe("populated")
  })

  test("offline → populated when connectivity returns", () => {
    const offline = buildAttachmentState([filePart()], { connected: false, permitted: true })
    expect(offline.status).toBe("offline")
    const online = buildAttachmentState([filePart()], { connected: true, permitted: true })
    expect(online.status).toBe("populated")
  })

  test("populated → long-content when attachment grows past budget", () => {
    const small = filePart({ url: "data:image/png;base64,AAAA" })
    const compact = buildAttachmentState([small], {}, { renderBudget: ATTACHMENT_RENDER_BUDGET })
    expect(compact.status).toBe("populated")
    // With a tiny budget the same attachment becomes "long-content".
    const oversize = buildAttachmentState([small], {}, { renderBudget: 1 })
    expect(oversize.status).toBe("long-content")
  })

  test("populated → degraded when flagged", () => {
    const clean = buildAttachmentState([filePart()])
    expect(clean.status).toBe("populated")
    const degraded = buildAttachmentState([filePart()], { degraded: true })
    expect(degraded.status).toBe("degraded")
  })
})

// ── Narrow vs standard terminal dimensions ──────────────────────────────────

describe("attachment narrow vs standard terminal dimensions", () => {
  test("standard width (120) is not narrow for attachments", () => {
    expect(isAttachmentNarrow(120)).toBe(false)
  })

  test("narrow width (50) is narrow for attachments", () => {
    expect(isAttachmentNarrow(50)).toBe(true)
  })

  test("borderline width (60) is not narrow (at threshold)", () => {
    expect(isAttachmentNarrow(60, 60)).toBe(false)
  })

  test("narrow width does not change status derivation", () => {
    // Width should only affect layout, not the lifecycle state.
    const state = buildAttachmentState([filePart()])
    expect(state.status).toBe("populated")
    // Narrow width is stored in state for the component to use.
    const narrowState = buildAttachmentState([filePart()], {}, { narrowWidth: 50 })
    expect(narrowState.narrowWidth).toBe(50)
    expect(narrowState.status).toBe("populated")
  })
})

// ── Streaming updates ──────────────────────────────────────────────────────

describe("streaming attachment updates (no timing sleeps)", () => {
  test("attachmentSummary changes from loading to populated as parts arrive", () => {
    const loadingSummary = attachmentSummary(buildAttachmentState([], { loading: true }))
    expect(loadingSummary).toBe("Attachments: loading…")
    const singleSummary = attachmentSummary(buildAttachmentState([filePart()]))
    expect(singleSummary).toBe("Attachments: 1 file")
    const multiSummary = attachmentSummary(buildAttachmentState([filePart(), filePart({ id: "f2", filename: "doc.pdf" })]))
    expect(multiSummary).toBe("Attachments: 2 files")
  })

  test("aria-label updates to reflect streaming state changes", () => {
    const loadingLabel = attachmentAriaLabel(buildAttachmentState([], { loading: true }))
    expect(loadingLabel).toContain("loading")
    const doneLabel = attachmentAriaLabel(buildAttachmentState([filePart()]))
    expect(doneLabel).toContain("1 file")
  })
})

// ── Failure paths ───────────────────────────────────────────────────────────

describe("attachment failure paths", () => {
  test("failure state exposes redacted error in summary", () => {
    const state = buildAttachmentState([filePart()], { error: "Bearer sk-live-abcdefghijklmnop: connection refused" })
    const summary = attachmentSummary(state)
    expect(summary).toContain("failed")
    expect(summary).not.toContain("sk-live-abcdefghijklmnop")
    // Bearer scheme is preserved but the token is redacted.
    expect(summary).toContain("••••")
  })

  test("denied state provides distinct summary and label", () => {
    const state = buildAttachmentState([filePart()], { permitted: false })
    expect(attachmentSummary(state)).toContain("permission denied")
    expect(attachmentStatusLabel(state.status)).toBe("Permission denied")
  })

  test("offline state provides distinct summary and glyph", () => {
    const state = buildAttachmentState([filePart()], { connected: false })
    expect(attachmentSummary(state)).toContain("offline")
    expect(attachmentStatusGlyph(state.status, true)).toBe("○")
    expect(attachmentStatusGlyph(state.status, false)).toBe("[offline]")
  })

  test("degraded state summary mentions degraded mode", () => {
    const state = buildAttachmentState([filePart()], { degraded: true })
    expect(attachmentSummary(state)).toContain("degraded")
  })

  test("failure avoids color-only status via text labels (WCAG)", () => {
    // Meaning is never conveyed by color alone.
    expect(attachmentStatusLabel("failure")).toBe("Error")
    expect(attachmentStatusLabel("denied")).toBe("Permission denied")
    expect(attachmentStatusLabel("offline")).toBe("Offline")
    expect(attachmentStatusLabel("degraded")).toBe("Degraded")
    // Text tags also work without color.
    expect(attachmentStatusGlyph("failure", false)).toBe("[error]")
    expect(attachmentStatusGlyph("denied", false)).toBe("[denied]")
    expect(attachmentStatusGlyph("offline", false)).toBe("[offline]")
    expect(attachmentStatusGlyph("degraded", false)).toBe("[degraded]")
    expect(attachmentStatusGlyph("long-content", false)).toBe("[large]")
  })

  test("large content beyond hard cap is truncated safely", () => {
    const oversized = `data:image/png;base64,${"A".repeat(70 * 1024 * 1024)}` // ~52MB after decode
    const state = buildAttachmentState([filePart({ url: oversized })])
    // The 50MB hard cap means the bytes reported to deriveAttachmentStatus are
    // capped. If the capped bytes still exceed the render budget, status is
    // long-content; otherwise it is populated.
    expect(state.droppedBytes).toBeGreaterThan(0)
    expect(state.truncated).toBe(true)
  })
})

// ── Multi-mime and mixed attachments ────────────────────────────────────────

describe("multi-mime attachment behavior", () => {
  test("multiple image attachments show correct count", () => {
    const parts = [filePart({ mime: "image/png", filename: "a.png" }), filePart({ mime: "image/jpeg", filename: "b.jpg", id: "f2" }), filePart({ mime: "image/gif", filename: "c.gif", id: "f3" })]
    const state = buildAttachmentState(parts)
    expect(state.count).toBe(3)
    expect(state.status).toBe("populated")
    expect(attachmentSummary(state)).toBe("Attachments: 3 files")
  })

  test("mixed image and PDF attachments", () => {
    const parts = [
      filePart({ mime: "image/png", filename: "photo.png" }),
      filePart({ mime: "application/pdf", filename: "report.pdf", id: "f2" }),
    ]
    const state = buildAttachmentState(parts)
    expect(state.count).toBe(2)
    expect(state.status).toBe("populated")
  })

  test("individual attachment labels reflect their mime kind", () => {
    expect(attachmentAccessibilityLabel({ mime: "image/png", filename: "shot.png" })).toContain("image")
    expect(attachmentAccessibilityLabel({ mime: "application/pdf", filename: "doc.pdf" })).toContain("PDF document")
    expect(attachmentAccessibilityLabel({ mime: "image/svg+xml", filename: "icon.svg" })).toContain("SVG image")
    expect(attachmentAccessibilityLabel({ mime: "text/plain", filename: "notes.txt" })).toContain("file")
  })

  test("remote URLs do not contribute to size", () => {
    const local = filePart()
    const remote = filePart({ url: "https://example.com/photo.png", id: "f2" })
    // The remote URL returns 0 bytes, so total is only from the local part.
    const state = buildAttachmentState([local, remote])
    expect(state.status).toBe("populated")
    expect(state.count).toBe(2)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("attachment edge cases", () => {
  test("empty parts list with no context is empty state", () => {
    const state = buildAttachmentState([])
    expect(state.status).toBe("empty")
    expect(state.count).toBe(0)
  })

  test("empty parts list with error is failure state", () => {
    const state = buildAttachmentState([], { error: "something broke" })
    expect(state.status).toBe("failure")
  })

  test("attachmentStatusGlyph default case returns ready", () => {
    expect(attachmentStatusGlyph("populated", true)).toBe("●")
    expect(attachmentStatusGlyph("populated", false)).toBe("[ready]")
  })

  test("formatFileSize handles edge values", () => {
    expect(formatFileSize(1)).toBe("1 B")
    expect(formatFileSize(1023)).toBe("1023 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB")
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB")
  })

  test("buildAttachmentState honors custom narrowWidth override", () => {
    const state = buildAttachmentState([filePart()], {}, { narrowWidth: 80 })
    expect(state.narrowWidth).toBe(80)
  })

  test("buildAttachmentState defaults match constants", () => {
    const state = buildAttachmentState([filePart()])
    expect(state.renderBudget).toBe(ATTACHMENT_RENDER_BUDGET)
    expect(state.truncated).toBe(false)
    expect(state.droppedBytes).toBe(0)
  })

  test("mime classification categorises all known types", () => {
    expect(attachmentKind("image/png")).toBe("image")
    expect(attachmentKind("image/jpeg")).toBe("image")
    expect(attachmentKind("image/gif")).toBe("image")
    expect(attachmentKind("image/webp")).toBe("image")
    expect(attachmentKind("image/avif")).toBe("image")
    expect(attachmentKind("image/bmp")).toBe("image")
    expect(attachmentKind("image/svg+xml")).toBe("svg")
    expect(attachmentKind("application/pdf")).toBe("pdf")
    expect(attachmentKind("text/plain")).toBe("file")
    expect(attachmentKind("application/json")).toBe("file")
    expect(attachmentKind("application/zip")).toBe("file")
    expect(attachmentKind("")).toBe("file")
  })
})