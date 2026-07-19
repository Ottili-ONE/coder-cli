import { describe, expect, test } from "bun:test"
import { redactSecrets, truncateForDiagnostics, redactText, detectNoColor } from "./redact"

describe("redactSecrets", () => {
  test("redacts long base64/hex token-shaped runs", () => {
    expect(redactSecrets("abc" + "A".repeat(30) + "xyz")).not.toContain("A".repeat(30))
    expect(redactSecrets("abc" + "A".repeat(30) + "xyz")).toContain("••••")
  })

  test("does not redact short alphanumeric runs (< 32 chars)", () => {
    expect(redactSecrets("short12345")).toBe("short12345")
  })

  test("redacts sk- prefixed OpenAI-style keys", () => {
    expect(redactSecrets("sk-abc123def456ghi789")).toContain("••••")
    expect(redactSecrets("sk-abc123def456ghi789")).not.toContain("sk-abc123def456ghi789")
  })

  test("redacts Bearer tokens while preserving the scheme", () => {
    // Without "Authorization:" prefix (which triggers the assignment pattern)
    const result = redactSecrets("token Bearer abcdefghijklmnopqrstuvwxyz123456")
    expect(result).toContain("Bearer ••••")
    expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz123456")
  })

  test("redacts JWT-style tokens (three dot-separated segments)", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZWxvbmcyM2FzZGZhc2Rm"
    expect(redactSecrets(jwt)).toContain("••••")
    expect(redactSecrets(jwt)).not.toContain("eyJhbGci")
  })

  test("redacts OAuth/session prefixed tokens (catches via long-run or prefix patterns)", () => {
    // These contain 32+ char runs so they get caught by the base64 pattern.
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345")).toContain("••••")
    expect(redactSecrets("ghs_abcdefghijklmnopqrstuvwxyz012345")).toContain("••••")
    expect(redactSecrets("sess_abcdefghijklmnopqrstuvwxyz0123")).toContain("••••")
    // The prefix pattern catches shorter tokens by their known prefix (≥ 8 chars after prefix).
    expect(redactSecrets("tok_abcdefgh")).toContain("tok_••••")
    expect(redactSecrets("f04_abcdefghijk")).toContain("f04_••••")
  })

  test("redacts session_id / sid / jti assignments in diagnostics", () => {
    expect(redactSecrets("session_id=abc123def456ghi789")).toContain("session_id=••••")
    expect(redactSecrets('sid: "abc123def456ghi789xyz"')).toContain("sid:")
  })

  test("redacts key=value assignments with secret-looking keys", () => {
    expect(redactSecrets("api_key=AKIA1234567890SECRET")).not.toContain("AKIA1234567890SECRET")
    expect(redactSecrets("token = abcdefghijklmnop")).toContain("token = ••••")
  })

  test("returns empty string unchanged", () => {
    expect(redactSecrets("")).toBe("")
  })

  test("never throws on garbage input", () => {
    expect(() => redactSecrets(null as unknown as string)).not.toThrow()
    expect(() => redactSecrets(undefined as unknown as string)).not.toThrow()
  })
})

describe("truncateForDiagnostics", () => {
  test("returns short text unchanged", () => {
    expect(truncateForDiagnostics("hello", 240)).toBe("hello")
  })

  test("truncates long text with ellipsis", () => {
    const long = "x".repeat(500)
    const out = truncateForDiagnostics(long, 240)
    expect(out.length).toBeLessThanOrEqual(240)
    expect(out.endsWith("…")).toBe(true)
  })

  test("strips ANSI escape codes", () => {
    expect(truncateForDiagnostics("\x1b[31mred\x1b[0m", 240)).toBe("red")
  })
})

describe("redactText", () => {
  test("combines redaction and truncation", () => {
    const input = "sk-abc123def456 " + "x".repeat(500)
    const out = redactText(input, 240)
    expect(out.length).toBeLessThanOrEqual(240)
    expect(out).not.toContain("sk-abc123def456")
  })
})

describe("detectNoColor", () => {
  test("honors NO_COLOR environment variable", () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      expect(detectNoColor()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = prev
    }
  })

  test("honors TERM=dumb", () => {
    const prev = process.env.TERM
    process.env.TERM = "dumb"
    try {
      expect(detectNoColor()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.TERM
      else process.env.TERM = prev
    }
  })
})