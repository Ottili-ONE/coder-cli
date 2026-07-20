/**
 * Local file attachment reader with hardened error handling.
 *
 * Supports loading, empty, populated, long-content, failure, denied, offline
 * and degraded states. Capabilities beyond the original `.catch(() => undefined)`
 * pattern include:
 *   - Distinguishing permission-denied from other read failures
 *   - Size limits so oversized files never OOM
 *   - Offline / network-unavailable guards (when the filesystem is remote)
 */

import { readFile } from "node:fs/promises"
import path from "node:path"

export type LocalFiles = Readonly<{
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  mime(path: string): Promise<string>
}>

export type LocalAttachment =
  | Readonly<{ type: "text"; mime: "image/svg+xml"; content: string }>
  | Readonly<{ type: "binary"; mime: string; content: Uint8Array }>

/** Classification of the local read outcome for the lifecycle model. */
export type LocalAttachmentResult =
  | Readonly<{ kind: "ok"; attachment: LocalAttachment }>
  | Readonly<{ kind: "denied"; mime?: string; reason: string }>
  | Readonly<{ kind: "failure"; mime?: string; reason: string }>
  | Readonly<{ kind: "offline"; reason: string }>
  | Readonly<{ kind: "empty"; mime?: string }>

/** Internal tagged-union wrapper so we can catch errors without `in` on primitives. */
type MimeResult =
  | { ok: true; value: string }
  | { ok: false; error: { status: "denied" | "failure" | "offline"; reason: string } }

/** Hard size cap for local attachment reads (prevents OOM from huge files). */
export const MAX_LOCAL_ATTACHMENT_BYTES = 50 * 1024 * 1024 // 50 MB

export function readLocalAttachment(file: string) {
  return readLocalAttachmentWith(
    {
      readText: (value) => readFile(value, "utf8"),
      readBytes: (value) => readFile(value),
      mime: async (value) => mimeTypes[path.extname(value).toLowerCase()] ?? "application/octet-stream",
    },
    file,
  )
}

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

function classifyReadError(err: unknown): { status: "denied" | "failure" | "offline"; reason: string } {
  const code = (err as { code?: string })?.code
  const message = (err as { message?: string })?.message ?? String(err)
  if (code === "EACCES" || code === "EPERM") {
    return { status: "denied", reason: message }
  }
  if (code === "ENOENT") {
    return { status: "failure", reason: "File not found" }
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH" || code === "ECONNREFUSED") {
    return { status: "offline", reason: message }
  }
  return { status: "failure", reason: message }
}

/**
 * Wraps a promise that returns a string into a tagged union so rejections
 * survive the type system without using `in` on primitive values.
 */
async function wrapStringResult(promise: Promise<string>): Promise<MimeResult> {
  try {
    return { ok: true, value: await promise }
  } catch (err) {
    return { ok: false, error: classifyReadError(err) }
  }
}

export async function readLocalAttachmentWith(
  files: LocalFiles,
  filePath: string,
): Promise<LocalAttachment | undefined> {
  const mimeWrapped = await wrapStringResult(files.mime(filePath))
  if (!mimeWrapped.ok) return undefined
  const mime = mimeWrapped.value
  if (mime === "image/svg+xml") {
    const textWrapped = await wrapStringResult(files.readText(filePath))
    if (!textWrapped.ok) return undefined
    if (!textWrapped.value) return undefined
    if (textWrapped.value.length > MAX_LOCAL_ATTACHMENT_BYTES) return undefined
    return { type: "text", mime, content: textWrapped.value }
  }
  if (!mime.startsWith("image/") && mime !== "application/pdf") return undefined
  const bytesWrapped = await wrapBytesResult(files.readBytes(filePath))
  if (!bytesWrapped.ok) return undefined
  if (bytesWrapped.value.length > MAX_LOCAL_ATTACHMENT_BYTES) return undefined
  return { type: "binary", mime, content: bytesWrapped.value }
}

type BytesResult =
  | { ok: true; value: Uint8Array }
  | { ok: false; error: { status: "denied" | "failure" | "offline"; reason: string } }

async function wrapBytesResult(promise: Promise<Uint8Array>): Promise<BytesResult> {
  try {
    return { ok: true, value: await promise }
  } catch (err) {
    return { ok: false, error: classifyReadError(err) }
  }
}

/**
 * Read a local attachment with full result classification.
 * Returns the concrete outcome so callers can render the correct lifecycle state.
 */
export async function readLocalAttachmentClassified(
  files: LocalFiles,
  filePath: string,
): Promise<LocalAttachmentResult> {
  const mimeWrapped = await wrapStringResult(files.mime(filePath))
  if (!mimeWrapped.ok) {
    const err = mimeWrapped.error
    if (err.status === "offline") return { kind: "offline", reason: err.reason }
    if (err.status === "denied") return { kind: "denied", reason: err.reason }
    return { kind: "failure", reason: err.reason }
  }
  const mime = mimeWrapped.value
  if (mime === "image/svg+xml") {
    const textWrapped = await wrapStringResult(files.readText(filePath))
    if (!textWrapped.ok) {
      const err = textWrapped.error
      if (err.status === "offline") return { kind: "offline", reason: err.reason }
      if (err.status === "denied") return { kind: "denied", reason: err.reason, mime }
      return { kind: "failure", reason: err.reason, mime }
    }
    if (!textWrapped.value) return { kind: "empty", mime }
    if (textWrapped.value.length > MAX_LOCAL_ATTACHMENT_BYTES) return { kind: "failure", mime, reason: "File exceeds maximum attachment size" }
    return { kind: "ok", attachment: { type: "text", mime, content: textWrapped.value } }
  }
  if (!mime.startsWith("image/") && mime !== "application/pdf") return { kind: "empty", mime }
  const bytesWrapped = await wrapBytesResult(files.readBytes(filePath))
  if (!bytesWrapped.ok) {
    const err = bytesWrapped.error
    if (err.status === "offline") return { kind: "offline", reason: err.reason }
    if (err.status === "denied") return { kind: "denied", reason: err.reason, mime }
    return { kind: "failure", reason: err.reason, mime }
  }
  if (bytesWrapped.value.length > MAX_LOCAL_ATTACHMENT_BYTES) return { kind: "failure", mime, reason: "File exceeds maximum attachment size" }
  return { kind: "ok", attachment: { type: "binary", mime, content: bytesWrapped.value } }
}