import { describe, expect, test } from "bun:test"
import {
  decodeJwtPayload,
  isOttiliOneAccountUrl,
  isOttiliOneAuthUrl,
  orgFromAccessToken,
  ottiliOneAuthUrl,
  ottiliOneServiceUrl,
  resolveOttiliOneAuthUrl,
  resolveOttiliOnePlatformUrl,
} from "../../src/account/ottili-one"

describe("ottili one auth helpers", () => {
  test("resolveOttiliOneAuthUrl normalizes trailing slashes", () => {
    expect(resolveOttiliOneAuthUrl("https://api.ottili.one/api/v1/auth/")).toBe("https://api.ottili.one/api/v1/auth")
  })

  test("isOttiliOneAuthUrl detects auth service URLs", () => {
    expect(isOttiliOneAuthUrl("https://api.ottili.one/api/v1/auth")).toBe(true)
    expect(isOttiliOneAuthUrl("http://127.0.0.1:8010/api/v1/auth")).toBe(true)
    expect(isOttiliOneAuthUrl("https://console.ottili.one/coder")).toBe(false)
  })

  test("ottiliOneServiceUrl strips auth path", () => {
    expect(ottiliOneServiceUrl("https://api.ottili.one/api/v1/auth")).toBe("https://api.ottili.one")
    expect(ottiliOneServiceUrl("https://api.ottili.one")).toBe("https://api.ottili.one")
  })

  test("resolveOttiliOnePlatformUrl maps local auth to unified API", () => {
    expect(resolveOttiliOnePlatformUrl("http://127.0.0.1:8010")).toBe("http://127.0.0.1:8100")
    expect(resolveOttiliOnePlatformUrl("https://api.ottili.one/api/v1/auth")).toBe("https://api.ottili.one")
  })

  test("ottiliOneAuthUrl derives auth path from service URL", () => {
    expect(ottiliOneAuthUrl("https://api.ottili.one")).toBe("https://api.ottili.one/api/v1/auth")
    expect(ottiliOneAuthUrl("http://127.0.0.1:8010")).toBe("http://127.0.0.1:8010/api/v1/auth")
  })

  test("isOttiliOneAccountUrl detects service and auth URLs", () => {
    expect(isOttiliOneAccountUrl("https://api.ottili.one/api/v1/auth")).toBe(true)
    expect(isOttiliOneAccountUrl("https://api.ottili.one")).toBe(true)
    expect(isOttiliOneAccountUrl("http://127.0.0.1:8010")).toBe(true)
    expect(isOttiliOneAccountUrl("https://console.ottili.one/coder")).toBe(false)
  })

  test("decodeJwtPayload extracts company id", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(JSON.stringify({ cid: "42", sub: "7" })).toString("base64url")
    const token = `${header}.${payload}.`
    expect(orgFromAccessToken(token)).toEqual({ id: "42", name: "Company 42" })
    expect(decodeJwtPayload(token).sub).toBe("7")
  })
})
