import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  CompactionInput,
  CompactionStatus,
  CompactionReason,
  CompactionState,
  CompactionKeep,
  CompactionOutputVersion,
} from "@/session/compaction"

// T-CLI-0331: Context compaction engine — contract and command design.
// These tests pin the schema-boundary contract so the CLI command, flags,
// config, events and headless output stay versioned and well-formed.

describe("compaction contract schemas", () => {
  test("CompactionReason enumerates trigger sources", () => {
    for (const reason of ["auto", "manual", "overflow", "command"] as const) {
      expect(Schema.decodeUnknownSync(CompactionReason)(reason)).toBe(reason)
    }
    expect(() => Schema.decodeUnknownSync(CompactionReason)("bogus")).toThrow()
  })

  test("CompactionState enumerates lifecycle states", () => {
    for (const state of ["idle", "pending", "running", "completed", "failed"] as const) {
      expect(Schema.decodeUnknownSync(CompactionState)(state)).toBe(state)
    }
  })

  test("CompactionKeep overrides map to config.compaction.keep", () => {
    const decoded = Schema.decodeUnknownSync(CompactionKeep)({ tokens: 4000, turns: 3 })
    expect(decoded).toEqual({ tokens: 4000, turns: 3 })
  })

  test("CompactionInput carries request-scoped flags (idempotency, force, permissions)", () => {
    const input = {
      sessionID: "session-1",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-4" },
      reason: "command",
      auto: false,
      keep: { turns: 2 },
      idempotencyKey: "key-abc",
      force: false,
      respectPermissions: true,
    }
    const decoded = Schema.decodeUnknownSync(CompactionInput)(input)
    expect(decoded.idempotencyKey).toBe("key-abc")
    expect(decoded.force).toBe(false)
    expect(decoded.keep?.turns).toBe(2)
  })

  test("CompactionStatus is versioned for headless/JSON consumers", () => {
    const status = {
      version: CompactionOutputVersion,
      sessionID: "session-1",
      state: "completed",
      reason: "command",
      messageID: "m1",
      summaryMessageID: "m2",
      tailStartID: "m3",
      prunedParts: 4,
      preservedDecisions: 2,
      idempotencyKey: "key-abc",
      updatedAt: 123,
    }
    const decoded = Schema.decodeUnknownSync(CompactionStatus)(status)
    expect(decoded.version).toBe("1")
    expect(decoded.state).toBe("completed")
    expect(decoded.prunedParts).toBe(4)
    expect(decoded.preservedDecisions).toBe(2)
    // Unknown versions are rejected so headless consumers fail loudly.
    expect(() => Schema.decodeUnknownSync(CompactionStatus)({ ...status, version: "2" })).toThrow()
  })

  test("CompactionStatus round-trips through JSON encode/decode", () => {
    const status = {
      version: CompactionOutputVersion,
      sessionID: "session-1",
      state: "idle" as const,
      updatedAt: 1,
    }
    const encoded = Schema.encodeSync(CompactionStatus)(status)
    const decoded = Schema.decodeSync(CompactionStatus)(encoded)
    expect(decoded).toEqual(status)
  })
})
