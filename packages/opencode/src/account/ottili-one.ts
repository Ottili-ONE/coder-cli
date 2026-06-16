import { randomBytes } from "node:crypto"
import open from "open"
import { OAuthCallbackServer } from "./oauth-callback-server"
import { normalizeServerUrl } from "./url"

export const OTTILI_ONE_CLIENT_ID = "ottili-coder"
export const OTTILI_ONE_CALLBACK_PORT = 19877
export const defaultOttiliOneAuthUrl = "https://api.ottili.one/api/v1/auth"
export const localOttiliOneAuthUrl = "http://127.0.0.1:8010/api/v1/auth"

export const resolveOttiliOneAuthUrl = (input?: string) => {
  const raw = input?.trim() || process.env.OTTILI_AUTH_URL?.trim() || defaultOttiliOneAuthUrl
  return normalizeServerUrl(raw)
}

export async function resolveOttiliOneAuthUrlAtLogin(input?: string): Promise<string> {
  if (input?.trim()) return resolveOttiliOneAuthUrl(input)
  if (process.env.OTTILI_AUTH_URL?.trim()) return resolveOttiliOneAuthUrl()

  // OAuth consent runs on dashboard.ottili.one and authorization codes are issued
  // by the production auth service. Auto-picking local :8010 breaks token exchange.
  return resolveOttiliOneAuthUrl()
}

export const isOttiliOneAuthUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.pathname.includes("/api/v1/auth")) return true
    if (parsed.hostname === "api.ottili.one" && parsed.pathname.startsWith("/api/v1/auth")) return true
    return parsed.port === "8010" && parsed.pathname.includes("/api/v1/auth")
  } catch {
    return false
  }
}

export const ottiliOneServiceUrl = (input: string) => {
  const normalized = normalizeServerUrl(input)
  if (isOttiliOneAuthUrl(normalized)) {
    const stripped = normalized.replace(/\/api\/v1\/auth$/, "")
    return stripped.length > 0 ? stripped : normalized
  }
  return normalized
}

export const defaultOttiliOnePlatformUrl = "https://api.ottili.one"

export const resolveOttiliOnePlatformUrl = (accountUrl: string) => {
  const explicit = process.env.OTTILI_PLATFORM_URL?.trim() || process.env.OTTILI_API_URL?.trim()
  if (explicit) return normalizeServerUrl(explicit)

  const service = ottiliOneServiceUrl(accountUrl)
  try {
    const parsed = new URL(service)
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"
    if (local && (parsed.port === "8010" || parsed.port === "")) {
      return normalizeServerUrl(`${parsed.protocol}//${parsed.hostname}:8100`)
    }
  } catch {
    return defaultOttiliOnePlatformUrl
  }

  return service
}

export const ottiliOneAuthUrl = (input: string) => {
  const normalized = normalizeServerUrl(input)
  if (isOttiliOneAuthUrl(normalized)) return normalized
  return `${ottiliOneServiceUrl(normalized)}/api/v1/auth`
}

export const isOttiliOneAccountUrl = (url: string) => {
  if (isOttiliOneAuthUrl(url)) return true
  try {
    const parsed = new URL(url)
    if (parsed.hostname === "api.ottili.one") return true
    return parsed.hostname === "127.0.0.1" && parsed.port === "8010"
  } catch {
    return false
  }
}

export const resolveOttiliOneAuthUrlFromAccount = (accountUrl: string) => ottiliOneAuthUrl(accountUrl)

export type OttiliOneTokenResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  user_id: number
}

export type OttiliOneUser = {
  user_id: number
  username: string
  email?: string | null
}

export type OttiliOneOrg = {
  id: string
  name: string
}

export type OttiliOneLoginResult = {
  authUrl: string
  user: OttiliOneUser
  accessToken: string
  refreshToken: string
  expiresAt: number
  org?: OttiliOneOrg
}

const randomState = () => randomBytes(16).toString("hex")

export const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const part = token.split(".")[1]
  if (!part) throw new Error("Invalid JWT")
  const json = Buffer.from(part, "base64url").toString("utf8")
  return JSON.parse(json) as Record<string, unknown>
}

export const orgFromAccessToken = (accessToken: string): OttiliOneOrg | undefined => {
  const payload = decodeJwtPayload(accessToken)
  const cid = payload.cid
  if (cid == null) return undefined
  const id = String(cid)
  return { id, name: `Company ${id}` }
}

export async function exchangeOttiliOneCode(input: {
  authUrl: string
  code: string
  redirectUri: string
  state: string
}): Promise<OttiliOneTokenResponse> {
  const response = await fetch(`${input.authUrl}/oauth/exchange-code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: OTTILI_ONE_CLIENT_ID,
      state: input.state,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  return (await response.json()) as OttiliOneTokenResponse
}

export async function refreshOttiliOneToken(input: {
  authUrl: string
  refreshToken: string
}): Promise<OttiliOneTokenResponse> {
  const response = await fetch(`${input.authUrl}/refresh`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: input.refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  return (await response.json()) as OttiliOneTokenResponse
}

export async function fetchOttiliOneUser(authUrl: string, accessToken: string): Promise<OttiliOneUser> {
  const response = await fetch(`${authUrl}/me`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to fetch user profile (${response.status}): ${text}`)
  }

  return (await response.json()) as OttiliOneUser
}

export async function loginOttiliOneViaBrowser(authUrlInput?: string): Promise<OttiliOneLoginResult> {
  const authUrl = await resolveOttiliOneAuthUrlAtLogin(authUrlInput)
  const state = randomState()
  const callback = new OAuthCallbackServer({
    port: OTTILI_ONE_CALLBACK_PORT,
    timeoutMs: 120_000,
  })

  const redirectUri = await callback.start()
  const callbackPromise = callback.waitForCallback()

  const params = new URLSearchParams({
    response_type: "code",
    client_id: OTTILI_ONE_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: "openid profile",
  })

  const authorizeUrl = `${authUrl}/oauth/authorize?${params.toString()}`
  await open(authorizeUrl, { wait: false }).catch(() => undefined)

  const result = await callbackPromise
  if (result.state !== state) {
    throw new Error("OAuth state mismatch")
  }

  const tokens = await exchangeOttiliOneCode({
    authUrl,
    code: result.code,
    redirectUri,
    state,
  })

  if (!tokens.refresh_token) {
    throw new Error("OAuth response did not include a refresh token")
  }

  const user = await fetchOttiliOneUser(authUrl, tokens.access_token)
  const org = orgFromAccessToken(tokens.access_token)

  return {
    authUrl,
    user,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    org,
  }
}
