import { describe, expect, test } from "bun:test"
import { OAuthCallbackServer } from "../../src/account/oauth-callback-server"

describe("OAuthCallbackServer", () => {
  test("captures code and state from callback", async () => {
    const server = new OAuthCallbackServer({ port: 0, timeoutMs: 5_000 })
    const redirectUri = await server.start()
    const wait = server.waitForCallback()

    const url = new URL(redirectUri)
    const port = Number(url.port)
    const response = await fetch(`${redirectUri}?code=abc123&state=xyz789`)
    expect(response.status).toBe(200)

    await expect(wait).resolves.toEqual({ code: "abc123", state: "xyz789" })
    await server.close()
    expect(port).toBeGreaterThan(0)
  })
})
