import { test, expect } from "bun:test"
import {
  redactUrl,
  redactHeaders,
  isLikelySecret,
  DEFAULT_RESOURCE_LIMITS,
} from "../src/browser"

test("redacts secrets in query strings", () => {
  const out = redactUrl("https://example.com/login?token=abc123secret&next=/home")
  expect(out).toContain("token=%3Credacted%3E")
  expect(out).not.toContain("abc123secret")
  expect(out).toContain("next=")
})

test("redacts bearer tokens in urls", () => {
  const out = redactUrl("https://api.example.com/v1?auth=Bearer%20eyJhbGci")
  expect(out).toContain("redacted")
  expect(out).not.toContain("eyJhbGci")
})

test("leaves safe urls untouched", () => {
  expect(redactUrl("https://example.com/page")).toBe("https://example.com/page")
})

test("redacts secret header values by key", () => {
  const out = redactHeaders({ authorization: "Bearer x", "content-type": "application/json" })
  expect(out?.authorization).toBe("<redacted>")
  expect(out?.["content-type"]).toBe("application/json")
})

test("flags long random tokens as secrets", () => {
  expect(isLikelySecret("Bearer " + "a".repeat(40))).toBe(true)
  expect(isLikelySecret("hello world")).toBe(false)
})

test("resource limits are bounded by default", () => {
  expect(DEFAULT_RESOURCE_LIMITS.maxSessionMs).toBeGreaterThan(0)
  expect(DEFAULT_RESOURCE_LIMITS.maxArtifacts).toBeGreaterThan(0)
})
