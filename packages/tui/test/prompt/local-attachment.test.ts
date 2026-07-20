import { describe, expect, test } from "bun:test"
import {
  readLocalAttachmentWith,
  readLocalAttachmentClassified,
  MAX_LOCAL_ATTACHMENT_BYTES,
} from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"

function files(input: { mime: string; text?: string; bytes?: Uint8Array }): LocalFiles {
  return {
    mime: async () => input.mime,
    readText: async () => input.text ?? "",
    readBytes: async () => input.bytes ?? new Uint8Array(),
  }
}

describe("prompt local attachments", () => {
  test("reads SVG attachments as text", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")).toEqual({
      type: "text",
      mime: "image/svg+xml",
      content: "<svg />",
    })
  })

  test("reads image and PDF attachments as bytes", async () => {
    const content = new Uint8Array([1, 2, 3])
    expect(await readLocalAttachmentWith(files({ mime: "application/pdf", bytes: content }), "/tmp/file.pdf")).toEqual({
      type: "binary",
      mime: "application/pdf",
      content,
    })
  })

  test("ignores unsupported and unreadable local files", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "text/plain" }), "/tmp/file.txt")).toBeUndefined()
    expect(
      await readLocalAttachmentWith(
        {
          ...files({ mime: "image/png" }),
          readBytes: async () => Promise.reject(new Error("missing")),
        },
        "/tmp/missing.png",
      ),
    ).toBeUndefined()
  })
})

describe("readLocalAttachmentClassified", () => {
  test("reads SVG attachments as ok", async () => {
    const result = await readLocalAttachmentClassified(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.attachment.type).toBe("text")
      expect(result.attachment.content).toBe("<svg />")
    }
  })

  test("reads image attachments as ok", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const result = await readLocalAttachmentClassified(files({ mime: "image/png", bytes }), "/tmp/photo.png")
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.attachment.type).toBe("binary")
      expect(result.attachment.content).toEqual(bytes)
    }
  })

  test("returns denied on EACCES", async () => {
    const denied = {
      ...files({ mime: "image/png" }),
      readBytes: async () => Promise.reject(Object.assign(new Error("Permission denied"), { code: "EACCES" })),
    }
    const result = await readLocalAttachmentClassified(denied, "/tmp/secret.png")
    expect(result.kind).toBe("denied")
  })

  test("returns denied on EPERM", async () => {
    const denied = {
      ...files({ mime: "application/pdf" }),
      readBytes: async () => Promise.reject(Object.assign(new Error("Operation not permitted"), { code: "EPERM" })),
    }
    const result = await readLocalAttachmentClassified(denied, "/tmp/protected.pdf")
    expect(result.kind).toBe("denied")
  })

  test("returns failure on ENOENT", async () => {
    const missing = {
      ...files({ mime: "image/png" }),
      readBytes: async () => Promise.reject(Object.assign(new Error("File not found"), { code: "ENOENT" })),
    }
    const result = await readLocalAttachmentClassified(missing, "/tmp/missing.png")
    expect(result.kind).toBe("failure")
  })

  test("returns offline on network errors", async () => {
    const offline = {
      ...files({ mime: "image/png" }),
      readBytes: async () => Promise.reject(Object.assign(new Error("Network unreachable"), { code: "ENETUNREACH" })),
    }
    const result = await readLocalAttachmentClassified(offline, "/tmp/remote.png")
    expect(result.kind).toBe("offline")
  })

  test("returns empty for unsupported mime types", async () => {
    const result = await readLocalAttachmentClassified(files({ mime: "text/plain", text: "hello" }), "/tmp/file.txt")
    expect(result.kind).toBe("empty")
  })

  test("returns failure for oversized SVGs", async () => {
    const huge = "x".repeat(MAX_LOCAL_ATTACHMENT_BYTES + 1)
    const result = await readLocalAttachmentClassified(files({ mime: "image/svg+xml", text: huge }), "/tmp/huge.svg")
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.reason).toContain("maximum attachment size")
  })

  test("returns failure for oversized images", async () => {
    const huge = new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES + 1)
    const result = await readLocalAttachmentClassified(files({ mime: "image/png", bytes: huge }), "/tmp/huge.png")
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.reason).toContain("maximum attachment size")
  })

  test("returns denied on SVG permission error", async () => {
    const denied = {
      ...files({ mime: "image/svg+xml" }),
      readText: async () => Promise.reject(Object.assign(new Error("Permission denied"), { code: "EACCES" })),
    }
    const result = await readLocalAttachmentClassified(denied, "/tmp/icon.svg")
    expect(result.kind).toBe("denied")
  })

  test("returns mime lookup failure as failure", async () => {
    const bad = {
      ...files({ mime: "image/png" }),
      mime: async () => Promise.reject(Object.assign(new Error("File not found"), { code: "ENOENT" })),
    }
    const result = await readLocalAttachmentClassified(bad, "/tmp/nonexistent.png")
    expect(result.kind).toBe("failure")
  })
})