/**
 * Tests for the attachment lifecycle model and utilities.
 *
 * These tests verify the full eight-state lifecycle (loading, empty, populated,
 * long-content, failure, denied, offline, degraded), accessibility semantics,
 * terminal fallbacks (narrow / no-color), render budgets, and sensitive data
 * redaction. They are pure-function tests that need no renderer or SDK.
 */
import { describe, expect, test } from "bun:test"
import type { FilePart } from "@opencode-ai/sdk/v2"

import {
  attachmentKind,
  mimeBadge,
  formatFileSize,
  estimateDataUrlBytes,
  truncateFilename,
  attachmentAccessibilityLabel,
  attachmentStatusLabel,
  attachmentStatusGlyph,
  attachmentSummary,
  attachmentAriaLabel,
  buildAttachmentState,
  deriveAttachmentStatus,
  truncateAttachmentSize,
  estimateAttachmentBytes,
  isAttachmentNarrow,
  ATTACHMENT_RENDER_BUDGET,
  ATTACHMENT_MAX_SIZE,
  ATTACHMENT_NARROW_WIDTH,
  type AttachmentStatus,
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

// ── Existing utility function tests ─────────────────────────────────────────

describe("attachmentKind", () => {
  test("classifies SVG mime", () => {
    expect(attachmentKind("image/svg+xml")).toBe("svg")
  })

  test("classifies image mimes", () => {
    expect(attachmentKind("image/png")).toBe("image")
    expect(attachmentKind("image/jpeg")).toBe("image")
    expect(attachmentKind("image/gif")).toBe("image")
  })

  test("classifies PDF mime", () => {
    expect(attachmentKind("application/pdf")).toBe("pdf")
  })

  test("falls back to file for unknown mimes", () => {
    expect(attachmentKind("text/plain")).toBe("file")
    expect(attachmentKind("application/json")).toBe("file")
    expect(attachmentKind("")).toBe("file")
  })
})

describe("mimeBadge", () => {
  test("returns known badges", () => {
    expect(mimeBadge("image/png")).toBe("img")
    expect(mimeBadge("application/pdf")).toBe("pdf")
    expect(mimeBadge("image/svg+xml")).toBe("svg")
    expect(mimeBadge("text/plain")).toBe("txt")
    expect(mimeBadge("application/x-directory")).toBe("dir")
  })

  test("falls back to img for unknown image types", () => {
    expect(mimeBadge("image/bmp")).toBe("img")
  })

  test("falls back to file for unknown non-image types", () => {
    expect(mimeBadge("application/octet-stream")).toBe("file")
  })
})

describe("formatFileSize", () => {
  test("formats bytes", () => expect(formatFileSize(0)).toBe("0 B"))
  test("formats bytes under 1KB", () => expect(formatFileSize(512)).toBe("512 B"))
  test("formats kilobytes", () => expect(formatFileSize(1024)).toBe("1.0 KB"))
  test("formats megabytes", () => expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB"))
  test("formats gigabytes", () => expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB"))
})

describe("estimateDataUrlBytes", () => {
  test("estimates base64 data URL bytes", () => {
    // "AAAA" in base64 = 3 bytes
    expect(estimateDataUrlBytes("data:text/plain;base64,AAAA")).toBe(3)
  })

  test("returns 0 for URLs without comma", () => {
    expect(estimateDataUrlBytes("data:text/plain")).toBe(0)
  })

  test("returns 0 for remote URLs", () => {
    expect(estimateDataUrlBytes("https://example.com/image.png")).toBe(0)
  })
})

describe("truncateFilename", () => {
  test("keeps short names unchanged", () => {
    expect(truncateFilename("photo.png", 24)).toBe("photo.png")
  })

  test("truncates long names preserving extension", () => {
    const result = truncateFilename("a-very-long-filename-that-exceeds-max.png", 24)
    expect(result.length).toBeLessThanOrEqual(25)
    expect(result.endsWith(".png")).toBe(true)
    expect(result).toContain("…")
  })

  test("truncates names without extension", () => {
    expect(truncateFilename("a-very-long-filename-without-extension", 10)).toBe("a-very-lo…")
  })

  test("handles very small maxLen", () => {
    expect(truncateFilename("test", 1)).toBe("…")
  })
})

describe("attachmentAccessibilityLabel", () => {
  test("includes kind, filename, and size", () => {
    const label = attachmentAccessibilityLabel({ mime: "image/png", filename: "photo.png" }, 1024)
    expect(label).toContain("image")
    expect(label).toContain("photo.png")
    expect(label).toContain("1.0 KB")
  })

  test("handles missing filename", () => {
    const label = attachmentAccessibilityLabel({ mime: "application/pdf" })
    expect(label).toContain("PDF document")
    expect(label).toContain("attachment")
  })

  test("handles missing size", () => {
    const label = attachmentAccessibilityLabel({ mime: "image/svg+xml", filename: "icon.svg" })
    expect(label).toContain("SVG image")
    expect(label).toContain("icon.svg")
    expect(label).not.toContain("KB")
  })

  test("redacts sensitive filenames", () => {
    const label = attachmentAccessibilityLabel({ mime: "text/plain", filename: "sk-secret-key-1234567890123456.txt" })
    expect(label).not.toContain("sk-secret-key-1234567890123456")
    expect(label).toContain("file:")
    // The actual filename is redacted, so the extension-based name is preserved
    expect(label).toContain(".txt")
  })
})

// ── New lifecycle model tests ───────────────────────────────────────────────

describe("deriveAttachmentStatus", () => {
  const ctx: AttachmentContext = {}

  test("loading wins over all other states", () => {
    expect(deriveAttachmentStatus({ ...ctx, loading: true, connected: false }, 5, 1000, 100)).toBe("loading")
    expect(deriveAttachmentStatus({ ...ctx, loading: true, permitted: false }, 5, 1000, 100)).toBe("loading")
    expect(deriveAttachmentStatus({ ...ctx, loading: true, error: "err" }, 5, 1000, 100)).toBe("loading")
  })

  test("offline wins after loading", () => {
    expect(deriveAttachmentStatus({ ...ctx, connected: false }, 5, 1000, 100)).toBe("offline")
  })

  test("denied wins after offline", () => {
    expect(deriveAttachmentStatus({ ...ctx, permitted: false }, 5, 1000, 100)).toBe("denied")
  })

  test("failure wins after denied", () => {
    expect(deriveAttachmentStatus({ ...ctx, error: "something broke" }, 5, 1000, 100)).toBe("failure")
  })

  test("empty when count is zero", () => {
    expect(deriveAttachmentStatus(ctx, 0, 1000, 0)).toBe("empty")
  })

  test("degraded when flagged", () => {
    expect(deriveAttachmentStatus({ ...ctx, degraded: true }, 3, 1000, 500)).toBe("degraded")
  })

  test("long-content when bytes exceed budget", () => {
    expect(deriveAttachmentStatus(ctx, 3, 1000, 2000)).toBe("long-content")
  })

  test("populated for happy path", () => {
    expect(deriveAttachmentStatus(ctx, 3, 1000, 500)).toBe("populated")
  })
})

describe("truncateAttachmentSize", () => {
  test("passes through under limit", () => {
    const result = truncateAttachmentSize(1000, 5000)
    expect(result.bytes).toBe(1000)
    expect(result.truncated).toBe(false)
    expect(result.dropped).toBe(0)
  })

  test("truncates over limit", () => {
    const result = truncateAttachmentSize(10000, 5000)
    expect(result.bytes).toBe(5000)
    expect(result.truncated).toBe(true)
    expect(result.dropped).toBe(5000)
  })

  test("uses default max when not provided", () => {
    const result = truncateAttachmentSize(ATTACHMENT_MAX_SIZE + 1)
    expect(result.truncated).toBe(true)
  })
})

describe("buildAttachmentState", () => {
  test("populated state with file parts", () => {
    const parts = [filePart()]
    const state = buildAttachmentState(parts)
    expect(state.status).toBe("populated")
    expect(state.count).toBe(1)
    expect(state.parts).toBe(parts)
    expect(state.truncated).toBe(false)
  })

  test("empty state with no parts", () => {
    const state = buildAttachmentState([])
    expect(state.status).toBe("empty")
    expect(state.count).toBe(0)
  })

  test("loading state", () => {
    const state = buildAttachmentState([], { loading: true })
    expect(state.status).toBe("loading")
    expect(state.context.loading).toBe(true)
  })

  test("offline state", () => {
    const state = buildAttachmentState([], { connected: false })
    expect(state.status).toBe("offline")
    expect(state.context.connected).toBe(false)
  })

  test("denied state", () => {
    const state = buildAttachmentState([], { permitted: false })
    expect(state.status).toBe("denied")
    expect(state.context.permitted).toBe(false)
  })

  test("failure state with error message", () => {
    const state = buildAttachmentState([], { error: "read failed" })
    expect(state.status).toBe("failure")
    expect(state.context.error).toBe("read failed")
  })

  test("degraded state", () => {
    const parts = [filePart()]
    const state = buildAttachmentState(parts, { degraded: true })
    expect(state.status).toBe("degraded")
  })

  test("long-content when data exceeds budget", () => {
    const largeBase64 = "a".repeat((ATTACHMENT_RENDER_BUDGET / 3) * 4 + 100)
    const parts = [filePart({ url: `data:image/png;base64,${largeBase64}` })]
    const state = buildAttachmentState(parts, {}, { renderBudget: ATTACHMENT_RENDER_BUDGET })
    expect(state.status).toBe("long-content")
  })

  test("sets redacted when filenames contain secrets", () => {
    const parts = [filePart({ filename: "sk-secret-key-1234567890123456.txt" })]
    const state = buildAttachmentState(parts)
    expect(state.redacted).toBe(true)
  })
})

describe("estimateAttachmentBytes", () => {
  test("estimates data URL parts", () => {
    const part = filePart({ url: "data:image/png;base64,AAAA" })
    expect(estimateAttachmentBytes(part)).toBe(3)
  })

  test("returns 0 for remote URLs", () => {
    const part = filePart({ url: "https://example.com/image.png" })
    expect(estimateAttachmentBytes(part)).toBe(0)
  })

  test("returns 0 for empty data URLs", () => {
    const part = filePart({ url: "data:," })
    expect(estimateAttachmentBytes(part)).toBe(0)
  })
})

// ── Status label and glyph tests ────────────────────────────────────────────

describe("attachmentStatusLabel", () => {
  const cases: [AttachmentStatus, string][] = [
    ["loading", "Loading"],
    ["empty", "Empty"],
    ["populated", "Ready"],
    ["long-content", "Large content"],
    ["failure", "Error"],
    ["denied", "Permission denied"],
    ["offline", "Offline"],
    ["degraded", "Degraded"],
  ]
  for (const [status, expected] of cases) {
    test(`${status} → "${expected}"`, () => {
      expect(attachmentStatusLabel(status)).toBe(expected)
    })
  }
})

describe("attachmentStatusGlyph", () => {
  test("produces colored glyphs when useColor=true", () => {
    expect(attachmentStatusGlyph("loading", true)).toBe("◐")
    expect(attachmentStatusGlyph("empty", true)).toBe("∅")
    expect(attachmentStatusGlyph("populated", true)).toBe("●")
    expect(attachmentStatusGlyph("failure", true)).toBe("✕")
    expect(attachmentStatusGlyph("denied", true)).toBe("⊘")
    expect(attachmentStatusGlyph("offline", true)).toBe("○")
  })

  test("produces bracketed text tags when useColor=false", () => {
    expect(attachmentStatusGlyph("loading", false)).toBe("[loading]")
    expect(attachmentStatusGlyph("empty", false)).toBe("[empty]")
    expect(attachmentStatusGlyph("populated", false)).toBe("[ready]")
    expect(attachmentStatusGlyph("failure", false)).toBe("[error]")
    expect(attachmentStatusGlyph("denied", false)).toBe("[denied]")
    expect(attachmentStatusGlyph("offline", false)).toBe("[offline]")
    expect(attachmentStatusGlyph("degraded", false)).toBe("[degraded]")
    expect(attachmentStatusGlyph("long-content", false)).toBe("[large]")
  })

  test("default case returns ready marker", () => {
    expect(attachmentStatusGlyph("populated", true)).toBe("●")
    expect(attachmentStatusGlyph("populated", false)).toBe("[ready]")
  })
})

// ── Summary and aria-label tests ────────────────────────────────────────────

describe("attachmentSummary", () => {
  test("loading summary", () => {
    const state = buildAttachmentState([], { loading: true })
    expect(attachmentSummary(state)).toBe("Attachments: loading…")
  })

  test("offline summary", () => {
    const state = buildAttachmentState([], { connected: false })
    expect(attachmentSummary(state)).toContain("offline")
  })

  test("denied summary", () => {
    const state = buildAttachmentState([], { permitted: false })
    expect(attachmentSummary(state)).toContain("permission denied")
  })

  test("failure summary redacts error", () => {
    const state = buildAttachmentState([], { error: "sk-secret-key-123456789012345" })
    const summary = attachmentSummary(state)
    expect(summary).not.toContain("sk-secret-key")
    expect(summary).toContain("failed")
  })

  test("empty summary", () => {
    const state = buildAttachmentState([])
    expect(attachmentSummary(state)).toBe("Attachments: none")
  })

  test("populated summary with count", () => {
    const state = buildAttachmentState([filePart(), filePart()])
    expect(attachmentSummary(state)).toBe("Attachments: 2 files")
  })

  test("populated summary singular", () => {
    const state = buildAttachmentState([filePart()])
    expect(attachmentSummary(state)).toBe("Attachments: 1 file")
  })

  test("degraded summary", () => {
    const state = buildAttachmentState([filePart()], { degraded: true })
    expect(attachmentSummary(state)).toContain("degraded")
  })
})

describe("attachmentAriaLabel", () => {
  test("redacts sensitive content", () => {
    const state = buildAttachmentState([filePart({ filename: "sk-secret-12345.txt" })])
    const label = attachmentAriaLabel(state)
    expect(label).not.toContain("sk-secret")
  })

  test("passes through clean content", () => {
    const state = buildAttachmentState([filePart()])
    const label = attachmentAriaLabel(state)
    expect(label).toContain("1 file")
  })
})

// ── Narrow terminal tests ───────────────────────────────────────────────────

describe("isAttachmentNarrow", () => {
  test("below threshold is narrow", () => {
    expect(isAttachmentNarrow(50, 60)).toBe(true)
  })

  test("at threshold is not narrow", () => {
    expect(isAttachmentNarrow(60, 60)).toBe(false)
  })

  test("above threshold is not narrow", () => {
    expect(isAttachmentNarrow(100, 60)).toBe(false)
  })

  test("uses default narrow width", () => {
    expect(isAttachmentNarrow(ATTACHMENT_NARROW_WIDTH)).toBe(false)
    expect(isAttachmentNarrow(ATTACHMENT_NARROW_WIDTH - 1)).toBe(true)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("attachment utils edge cases", () => {
  test("deriveAttachmentStatus with empty context and zero count/bytes", () => {
    expect(deriveAttachmentStatus({}, 0, 1000, 0)).toBe("empty")
  })

  test("estimateDataUrlBytes with empty base64", () => {
    expect(estimateDataUrlBytes("data:,")).toBe(0)
  })

  test("formatFileSize with zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B")
  })

  test("truncateFilename with empty string", () => {
    expect(truncateFilename("", 10)).toBe("")
  })

  test("attachmentAccessibilityLabel redacts filenames with tokens", () => {
    const label = attachmentAccessibilityLabel({ mime: "text/plain", filename: "sk-secret-key-1234567890123456.txt" })
    expect(label).not.toContain("sk-secret-key-1234567890123456")
    expect(label).toContain("file:")
  })

  test("buildAttachmentState with mixed valid and oversized parts", () => {
    const parts = [filePart()]
    const state = buildAttachmentState(parts, {}, { renderBudget: 0 })
    expect(state.status).toBe("long-content")
  })
})