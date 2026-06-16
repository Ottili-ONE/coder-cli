/**
 * Ottili Coder Cloud client.
 *
 * Talks to the hosted Ottili Coder control plane (the same engine that powers
 * the codehelm.ottili.one dashboard) so the CLI can drive autonomous cloud
 * coding jobs from the terminal. Requests go through the Unified API Developer
 * surface:
 *
 *   {base}/api/v1/developer/modules/codehelm/actions/coder/<action>
 *
 * authenticated with a developer/service API key (Bearer). This is a plain
 * `fetch`-based module with no Effect/runtime dependencies so it can be reused
 * from CLI commands and from the agent tool alike.
 */

import fs from "fs"
import os from "os"
import path from "path"

const DEFAULT_BASE_URL = "https://api.ottili.one"
const DEFAULT_DASHBOARD_URL = "https://codehelm.ottili.one"
const MODULE_SLUG = "codehelm"

export type CloudJobStatus =
  | "draft"
  | "queued"
  | "planning"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused"

export type CloudMode = "autonomous_build" | "continuous_coding"
export type CloudAction = "start" | "pause" | "resume" | "cancel" | "retry" | "approve"
export type CloudExecutionTarget = "local" | "github_agent"

export interface CloudJob {
  id: number
  title: string
  objective: string
  mode: CloudMode
  status: CloudJobStatus
  target_task_count: number
  current_phase: string | null
  completion_pct: number
  repository_id: number | null
  execution_backend: string
  result_summary: string | null
  error_summary: string | null
  created_by: string
  created_at: string | null
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
  task_counts?: Record<string, number>
  task_total?: number
  artifacts?: CloudArtifact[]
}

export interface CloudArtifact {
  id: number
  type: string
  title: string
  payload: Record<string, unknown>
  created_at: string | null
}

export interface CloudTask {
  id: number
  job_id: number
  sequence: number
  title: string
  kind: string
  status: string
  phase: string | null
}

export interface CloudEvent {
  id: number
  kind: string
  message: string
  created_at: string | null
}

export interface CloudAgentInfo {
  id: string
  name: string
  available: boolean
  description?: string
}

export interface CloudRepository {
  id: number
  full_name: string
  default_branch?: string
}

export interface CreateCloudJobInput {
  title?: string
  objective: string
  mode?: CloudMode
  target_task_count?: number
  default_agent?: string
  validation_commands?: string[]
  approval_required?: boolean
  use_llm?: boolean
  allow_write?: boolean
  repository_id?: number
  auto_create_pr?: boolean
  execution_target?: CloudExecutionTarget
}

export interface CloudConfig {
  url: string
  token?: string
  company?: string
  dashboardUrl: string
}

export interface CloudConfigFile {
  url?: string
  token?: string
  company?: string
  dashboardUrl?: string
}

/** Raised for any Ottili Coder Cloud failure; carries an HTTP status when known. */
export class CloudError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "CloudError"
    this.status = status
  }
}

function configDir(): string {
  const base = process.env["XDG_CONFIG_HOME"]?.trim() || path.join(os.homedir(), ".config")
  return path.join(base, "ottili-coder")
}

function configPath(): string {
  return path.join(configDir(), "cloud.json")
}

export function loadConfigFile(): CloudConfigFile {
  try {
    const raw = fs.readFileSync(configPath(), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as CloudConfigFile) : {}
  } catch {
    return {}
  }
}

export function saveConfigFile(update: CloudConfigFile): string {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  const merged = { ...loadConfigFile(), ...update }
  const file = configPath()
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 })
  // Tighten perms in case the file already existed with looser bits.
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best-effort on platforms without chmod semantics
  }
  return file
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

/** Resolve effective config: env vars override the on-disk config file. */
export function resolveConfig(): CloudConfig {
  const file = loadConfigFile()
  const url = process.env["OTTILI_CODER_CLOUD_URL"]?.trim() || file.url?.trim() || DEFAULT_BASE_URL
  const token = process.env["OTTILI_CODER_CLOUD_TOKEN"]?.trim() || file.token?.trim() || undefined
  const company = process.env["OTTILI_CODER_CLOUD_COMPANY"]?.trim() || file.company?.trim() || undefined
  const dashboardUrl =
    process.env["OTTILI_CODER_DASHBOARD_URL"]?.trim() || file.dashboardUrl?.trim() || DEFAULT_DASHBOARD_URL
  return { url: stripTrailingSlash(url), token, company, dashboardUrl: stripTrailingSlash(dashboardUrl) }
}

export function isConfigured(): boolean {
  return Boolean(resolveConfig().token)
}

export function disconnect(): string {
  const existing = loadConfigFile()
  saveConfigFile({
    url: existing.url,
    company: existing.company,
    dashboardUrl: existing.dashboardUrl,
  })
  return configPath()
}

function actionUrl(config: CloudConfig, action: string): string {
  const normalized = action.replace(/^\/+/, "")
  return `${config.url}/api/v1/developer/modules/${MODULE_SLUG}/actions/${normalized}`
}

/**
 * The Developer action endpoint returns the platform module-action envelope
 * ({ viewModel, ... }) on success, and may wrap that again in an API result
 * ({ ok, data }) depending on the gateway. Unwrap defensively to the payload.
 */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    if ("ok" in obj && "data" in obj && obj["data"] && typeof obj["data"] === "object") {
      return unwrap<T>(obj["data"])
    }
    if ("viewModel" in obj) {
      return obj["viewModel"] as T
    }
    if ("result" in obj && obj["result"] !== undefined) {
      return obj["result"] as T
    }
  }
  return payload as T
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    const detail = obj["detail"]
    if (typeof detail === "string") return detail
    if (detail && typeof detail === "object") {
      const rec = detail as Record<string, unknown>
      if (typeof rec["message"] === "string") return rec["message"] as string
      if (typeof rec["code"] === "string") return rec["code"] as string
    }
    if (typeof obj["message"] === "string") return obj["message"] as string
    if (typeof obj["error"] === "string") return obj["error"] as string
  }
  return `Ottili Coder Cloud request failed (HTTP ${status})`
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  action: string,
  options: { body?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<T> {
  const config = resolveConfig()
  if (!config.token) {
    throw new CloudError(
      "Ottili Coder Cloud is not configured. Run `ottili-coder cloud login` or set OTTILI_CODER_CLOUD_TOKEN.",
    )
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/json",
  }
  if (config.company) headers["X-Platform-Company"] = config.company
  const init: RequestInit = { method, headers }
  if (options.signal) init.signal = options.signal
  if (method !== "GET" && options.body !== undefined) {
    headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(actionUrl(config, action), init)
  } catch (e) {
    throw new CloudError(`Could not reach Ottili Coder Cloud at ${config.url}: ${(e as Error).message}`)
  }

  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CloudError(
        `Not authorized (HTTP ${res.status}). Check your API key and company with \`ottili-coder cloud login\`.`,
        res.status,
      )
    }
    throw new CloudError(errorMessage(payload, res.status), res.status)
  }
  return unwrap<T>(payload)
}

// ── Typed operations ────────────────────────────────────────────────────────

export function createJob(input: CreateCloudJobInput, signal?: AbortSignal): Promise<CloudJob> {
  const body: Record<string, unknown> = {
    title: input.title ?? input.objective.slice(0, 80),
    objective: input.objective,
    mode: input.mode ?? "autonomous_build",
  }
  if (input.target_task_count !== undefined) body["target_task_count"] = input.target_task_count
  if (input.default_agent) body["default_agent"] = input.default_agent
  if (input.validation_commands) body["validation_commands"] = input.validation_commands
  if (input.approval_required !== undefined) body["approval_required"] = input.approval_required
  if (input.use_llm !== undefined) body["use_llm"] = input.use_llm
  if (input.allow_write !== undefined) body["allow_write"] = input.allow_write
  if (input.repository_id !== undefined) body["repository_id"] = input.repository_id
  if (input.auto_create_pr !== undefined) body["auto_create_pr"] = input.auto_create_pr
  if (input.execution_target) body["execution_target"] = input.execution_target
  return request<CloudJob>("POST", "coder/jobs", { body, signal })
}

export async function listJobs(signal?: AbortSignal): Promise<CloudJob[]> {
  const res = await request<{ jobs?: CloudJob[] } | CloudJob[]>("GET", "coder/jobs", { signal })
  if (Array.isArray(res)) return res
  return res?.jobs ?? []
}

export function getJob(jobId: number, signal?: AbortSignal): Promise<CloudJob> {
  return request<CloudJob>("GET", `coder/jobs/${jobId}`, { signal })
}

export async function listJobTasks(jobId: number, signal?: AbortSignal): Promise<CloudTask[]> {
  const res = await request<{ tasks?: CloudTask[] } | CloudTask[]>("GET", `coder/jobs/${jobId}/tasks`, { signal })
  if (Array.isArray(res)) return res
  return res?.tasks ?? []
}

export async function listJobEvents(jobId: number, signal?: AbortSignal): Promise<CloudEvent[]> {
  const res = await request<{ events?: CloudEvent[] } | CloudEvent[]>("GET", `coder/jobs/${jobId}/events`, { signal })
  if (Array.isArray(res)) return res
  return res?.events ?? []
}

export function jobAction(jobId: number, action: CloudAction, signal?: AbortSignal): Promise<CloudJob> {
  return request<CloudJob>("POST", `coder/jobs/${jobId}/action`, { body: { action }, signal })
}

export async function listAgents(signal?: AbortSignal): Promise<CloudAgentInfo[]> {
  const res = await request<{ agents?: CloudAgentInfo[] } | CloudAgentInfo[]>("GET", "coder/agents", { signal })
  if (Array.isArray(res)) return res
  return res?.agents ?? []
}

export async function listRepositories(signal?: AbortSignal): Promise<CloudRepository[]> {
  const res = await request<{ repositories?: CloudRepository[] } | CloudRepository[]>("GET", "repositories", { signal })
  if (Array.isArray(res)) return res
  return res?.repositories ?? []
}

const TERMINAL: CloudJobStatus[] = ["completed", "failed", "cancelled"]

export function isTerminal(status: CloudJobStatus): boolean {
  return TERMINAL.includes(status)
}

/** Browser URL for a job (or the dashboard root) on the hosted dashboard. */
export function dashboardJobUrl(jobId?: number): string {
  const { dashboardUrl } = resolveConfig()
  return jobId ? `${dashboardUrl}/dashboard/coder/${jobId}` : `${dashboardUrl}/dashboard/coder`
}

export * as OttiliCloud from "./cloud"
