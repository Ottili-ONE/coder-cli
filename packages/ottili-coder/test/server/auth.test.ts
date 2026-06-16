import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  OTTILI_CODER_SERVER_PASSWORD: Flag.OTTILI_CODER_SERVER_PASSWORD,
  OTTILI_CODER_SERVER_USERNAME: Flag.OTTILI_CODER_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OTTILI_CODER_SERVER_PASSWORD = original.OTTILI_CODER_SERVER_PASSWORD
  Flag.OTTILI_CODER_SERVER_USERNAME = original.OTTILI_CODER_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.OTTILI_CODER_SERVER_PASSWORD = undefined
    Flag.OTTILI_CODER_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the ottili-coder username", () => {
    Flag.OTTILI_CODER_SERVER_PASSWORD = "secret"
    Flag.OTTILI_CODER_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("ottiliCoder:secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    Flag.OTTILI_CODER_SERVER_PASSWORD = "secret"
    Flag.OTTILI_CODER_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.OTTILI_CODER_SERVER_PASSWORD = "secret"
    Flag.OTTILI_CODER_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "ottili-coder", password: Redacted.make("secret") }, config)).toBe(false)
  })
})
