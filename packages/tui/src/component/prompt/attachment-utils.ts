/**
 * Attachment utilities and lifecycle model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering or SDK dependencies so the
 * attachment logic can be unit tested in isolation and reused by the Solid
 * component in the session route and prompt bar.
 *
 * The model is the single source of truth for the redesigned attachment surface.
 * It owns the full lifecycle of states an attachment can be in:
 *
 *   loading      — content is still being fetched/streamed
 *   empty        — loaded successfully but has no content
 *   populated    — normal, fully presentable attachment
 *   long-content — content exceeds the render budget and is folded
 *   failure      — the fetch/read failed (message is redacted before display)
 *   denied       — access was refused (permission error)
 *   offline      — could not be fetched because the host is offline
 *   degraded     — shown at reduced fidelity (no-color/limited terminal)
 *
 * plus accessibility semantics, terminal fallbacks (narrow / no-color), the
 * performance-safe render budget and sensitive data redaction.
 */

import type { RGBA } from "@opentui/core"
import type { FilePart } from "@opencode-ai/sdk/v2"
import { redactSensitive, isNarrow, NARROW_WIDTH_DEFAULT } from "../agent-roster/model"

export type AttachmentKind = "image" | "pdf" | "svg" | "file"

export function attachmentKind(mime: string): AttachmentKind {
  if (mime === "image/svg+xml") return "svg"
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  return "file"
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "image/avif": "img",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

export function mimeBadge(mime: string): string {
  return MIME_BADGE[mime] ?? (mime.startsWith("image/") ? "img" : "file")
}

export function mimeColor(
  mime: string,
  theme: { accent: RGBA; primary: RGBA; secondary: RGBA; info: RGBA },
): RGBA {
  if (mime.startsWith("image/")) return theme.accent
  if (mime === "application/pdf") return theme.primary
  if (mime === "image/svg+xml") return theme.info
  return theme.secondary
}

// ---------------------------------------------------------------------------
// Lifecycle state model
//
// Follows the same pattern as markdown/state.ts, file-tree-core.ts, and the
// agent roster model — every lifecycle state is intentionally rendered and
// actionable; focus is never lost or trapped during updates; narrow terminals
// and no-color terminals remain usable; large data stays within the defined
// render budget; sensitive data is redacted from visual output and diagnostics.
// ---------------------------------------------------------------------------

/** The eight intentionally-rendered attachment states required by the redesign. */
export type AttachmentStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

/** Environmental context that decides which top-level state an attachment is in. */
export interface AttachmentContext {
  /** Content is being fetched or streamed and not yet presentable. */
  loading?: boolean
  /** A network is required to resolve linked/embedded attachment content. */
  connected?: boolean
  /** The caller is allowed to view this content. */
  permitted?: boolean
  /** A render/load failure message (surfaced in the failure state). */
  error?: string | null
  /** Render in reduced-fidelity mode (e.g. no color). */
  degraded?: boolean
}

/** Derivable, memoizable attachment state consumed by the component. */
export interface AttachmentState {
  status: AttachmentStatus
  context: Required<AttachmentContext>
  /** The underlying file parts. */
  parts: readonly FilePart[]
  /** Total count of parts. */
  count: number
  /** Maximum bytes allowed before the content is flagged as long. */
  renderBudget: number
  /** Terminal width below which attachments get a compact layout. */
  narrowWidth: number
  /** True when any part exceeded the size safety cap. */
  truncated: boolean
  /** Total bytes dropped by size capping. */
  droppedBytes: number
  /** True when any part contained redactable secrets. */
  redacted: boolean
}

/** Default render budget (bytes) for attachment data before flagging as long-content. */
export const ATTACHMENT_RENDER_BUDGET = 5 * 1024 * 1024 // 5 MB

/** Hard safety cap per attachment part; content beyond this is excluded from the size budget. */
export const ATTACHMENT_MAX_SIZE = 50 * 1024 * 1024 // 50 MB

/** Terminal width at or below which attachments use a compact layout. */
export const ATTACHMENT_NARROW_WIDTH = NARROW_WIDTH_DEFAULT

/** Marker substituted for redacted secrets in attachment output and diagnostics. */
export const ATTACHMENT_REDACTION_MARKER = "••••"

/**
 * Estimate the byte size of an attachment part from its URL.
 * Data URLs are measured directly; remote URLs return 0 (unknown).
 */
export function estimateAttachmentBytes(part: FilePart): number {
  if (part.url.startsWith("data:")) return estimateDataUrlBytes(part.url)
  return 0
}

/**
 * Classify the top-level attachment state. Order matters: transient/blocking
 * states win over presentational ones so the user always sees the most
 * actionable message.
 */
export function deriveAttachmentStatus(
  context: AttachmentContext,
  count: number,
  budget: number,
  totalBytes: number,
): AttachmentStatus {
  if (context.loading === true) return "loading"
  if (context.connected === false) return "offline"
  if (context.permitted === false) return "denied"
  if (context.error) return "failure"
  if (count === 0) return "empty"
  if (context.degraded === true) return "degraded"
  if (totalBytes > budget) return "long-content"
  return "populated"
}

/**
 * Cap oversized attachment data to the hard safety limit so a very large
 * attachment can never OOM the renderer. Pure: never mutates the input.
 */
export function truncateAttachmentSize(
  totalBytes: number,
  max: number = ATTACHMENT_MAX_SIZE,
): { bytes: number; truncated: boolean; dropped: number } {
  if (totalBytes <= max) return { bytes: totalBytes, truncated: false, dropped: 0 }
  return {
    bytes: max,
    truncated: true,
    dropped: totalBytes - max,
  }
}

/**
 * Build the full derivable attachment state from file parts and context.
 * Sizes are first capped by the safety budget, then classified. Pure.
 */
export function buildAttachmentState(
  parts: readonly FilePart[],
  ctx: Partial<AttachmentContext> = {},
  overrides: { renderBudget?: number; narrowWidth?: number } = {},
): AttachmentState {
  const context: Required<AttachmentContext> = {
    loading: ctx.loading ?? false,
    connected: ctx.connected ?? true,
    permitted: ctx.permitted ?? true,
    error: ctx.error ?? null,
    degraded: ctx.degraded ?? false,
  }
  const budget = overrides.renderBudget ?? ATTACHMENT_RENDER_BUDGET
  const count = parts.length
  const totalBytes = parts.reduce((sum, part) => sum + estimateAttachmentBytes(part), 0)
  const safe = truncateAttachmentSize(totalBytes)
  const status = deriveAttachmentStatus(context, count, budget, safe.bytes)
  const redacted = parts.some((part) => {
    if (part.filename) return redactSensitive(part.filename).redacted
    return false
  }) || redactSensitive(JSON.stringify(parts.map((p) => ({ mime: p.mime, filename: p.filename })))).redacted
  return {
    status,
    context,
    parts,
    count,
    renderBudget: budget,
    narrowWidth: overrides.narrowWidth ?? ATTACHMENT_NARROW_WIDTH,
    truncated: safe.truncated,
    droppedBytes: safe.dropped,
    redacted,
  }
}

/**
 * Short textual status label, always rendered so state is never color-only.
 * Follows WCAG SC 1.4.1: meaning is never conveyed by color alone.
 */
export function attachmentStatusLabel(status: AttachmentStatus): string {
  switch (status) {
    case "loading":
      return "Loading"
    case "empty":
      return "Empty"
    case "populated":
      return "Ready"
    case "long-content":
      return "Large content"
    case "failure":
      return "Error"
    case "denied":
      return "Permission denied"
    case "offline":
      return "Offline"
    case "degraded":
      return "Degraded"
    default:
      return "Ready"
  }
}

/**
 * Compact status marker for attachment state. Uses a colored glyph when color
 * is available, otherwise a bracketed text tag so meaning never depends on
 * color alone (WCAG SC 1.4.1).
 */
export function attachmentStatusGlyph(status: AttachmentStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "loading":
        return "◐"
      case "empty":
        return "∅"
      case "populated":
        return "●"
      case "long-content":
        return "▤"
      case "failure":
        return "✕"
      case "denied":
        return "⊘"
      case "offline":
        return "○"
      case "degraded":
        return "△"
      default:
        return "●"
    }
  }
  switch (status) {
    case "loading":
      return "[loading]"
    case "empty":
      return "[empty]"
    case "populated":
      return "[ready]"
    case "long-content":
      return "[large]"
    case "failure":
      return "[error]"
    case "denied":
      return "[denied]"
    case "offline":
      return "[offline]"
    case "degraded":
      return "[degraded]"
    default:
      return "[ready]"
  }
}

/**
 * Single-line summary used as the accessible live-region label and header.
 * Sensitive data is always redacted before display.
 */
export function attachmentSummary(state: AttachmentState): string {
  switch (state.status) {
    case "loading":
      return "Attachments: loading…"
    case "offline":
      return "Attachments: offline — content unavailable"
    case "denied":
      return "Attachments: permission denied"
    case "failure":
      return `Attachments: failed to load — ${redactSensitive(state.context.error ?? "unknown error").text}`
    case "empty":
      return "Attachments: none"
    case "degraded":
      return "Attachments: rendered in degraded mode"
    case "long-content": {
      const shown = state.droppedBytes > 0 ? `(${state.count} parts, ${state.droppedBytes} bytes truncated)` : `(${state.count} parts)`
      return `Attachments: large content ${shown}`
    }
    case "populated":
    default:
      return `Attachments: ${state.count} ${state.count === 1 ? "file" : "files"}`
  }
}

/**
 * Self-contained, redacted screen-reader label for the current attachment state.
 */
export function attachmentAriaLabel(state: AttachmentState): string {
  return redactSensitive(attachmentSummary(state)).text
}

/**
 * Is the available width too small for the side-by-side attachment layout?
 */
export function isAttachmentNarrow(width: number, narrowWidth = ATTACHMENT_NARROW_WIDTH): boolean {
  return isNarrow(width, narrowWidth)
}

/**
 * Redact sensitive data from a filename for safe display.
 */
export function redactAttachmentFilename(name: string): string {
  return redactSensitive(name).text
}

// ---------------------------------------------------------------------------
// Original utility functions preserved below
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function estimateDataUrlBytes(url: string): number {
  const comma = url.indexOf(",")
  if (comma === -1) return 0
  const base64 = url.slice(comma + 1)
  return Math.round((base64.length * 3) / 4)
}

export function truncateFilename(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name
  const ext = name.lastIndexOf(".")
  if (ext > 0 && name.length - ext <= 8) {
    const stem = name.slice(0, Math.max(0, maxLen - (name.length - ext) - 1))
    return `${stem}…${name.slice(ext)}`
  }
  return name.slice(0, Math.max(0, maxLen - 1)) + "…"
}

export function attachmentAccessibilityLabel(
  part: { mime: string; filename?: string },
  size?: number,
): string {
  const kindLabels: Record<string, string> = {
    image: "image",
    svg: "SVG image",
    pdf: "PDF document",
    file: "file",
  }
  const kind = attachmentKind(part.mime)
  const label = kindLabels[kind]
  const name = redactSensitive(part.filename ?? "attachment").text
  const sizeStr = size !== undefined ? `, ${formatFileSize(size)}` : ""
  return `${label}: ${name}${sizeStr}`
}

export function isDataUrl(url: string): boolean {
  return url.startsWith("data:")
}