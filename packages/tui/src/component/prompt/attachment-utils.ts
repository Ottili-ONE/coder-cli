import type { RGBA } from "@opentui/core"
import type { FilePart } from "@opencode-ai/sdk/v2"

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

export function mimeColor(mime: string, theme: { accent: RGBA; primary: RGBA; secondary: RGBA; info: RGBA; background: RGBA; backgroundPanel: RGBA; backgroundElement: RGBA; textMuted: RGBA; text: RGBA }): RGBA {
  if (mime.startsWith("image/")) return theme.accent
  if (mime === "application/pdf") return theme.primary
  if (mime === "image/svg+xml") return theme.info
  return theme.secondary
}

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
  const name = part.filename ?? "attachment"
  const sizeStr = size !== undefined ? `, ${formatFileSize(size)}` : ""
  return `${label}: ${name}${sizeStr}`
}

export function isDataUrl(url: string): boolean {
  return url.startsWith("data:")
}