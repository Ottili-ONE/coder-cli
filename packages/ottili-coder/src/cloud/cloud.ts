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
  settings?: Record<string, unknown>
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

export interface CloudTaskRun {
  id: number
  attempt: number
  agent_type: string | null
  provider_info: string | null
  stdout: string | null
  stderr: string | null
  diff_text: string | null
  duration_seconds: number | null
  tokens_used: number | null
  cost_dollars: number | null
  success: boolean
  created_at: string | null
}

export interface CloudTask {
  id: number
  job_id: number
  title: string
  description: string | null
  kind: string
  status: string
  order: number
  depends_on: number[]
  assigned_agent: string | null
  prompt_text: string | null
  files_involved: string[]
  acceptance_criteria: string[]
  result_summary: string | null
  error_summary: string | null
  diff_text: string | null
  files_changed: string[]
  retry_count: number
  max_retries: number
  started_at: string | null
  completed_at: string | null
  created_at: string | null
  updated_at: string | null
  /** Only present on the single-task detail endpoint (``getTask``). */
  runs?: CloudTaskRun[]
}

export interface CloudEvent {
  id: number
  job_id: number
  task_id: number | null
  event_type: string
  message: string
  metadata: Record<string, unknown>
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

export interface CloudCreditBalance {
  company_id?: number | string
  plan_code?: string
  credit_mode?: string
  included_monthly_credits?: number
  included_remaining?: number
  recharge_credits_total?: number
  recharge_remaining?: number
  current_balance?: number
  available_credits?: number
  current_period_start?: string | null
  current_period_end?: string | null
  auto_recharge_enabled?: boolean
  auto_recharge_threshold?: number
  auto_recharge_package?: string | null
  hard_cap_status?: string
}

export interface CloudCreditEstimateSummary {
  company_id?: number | string
  plan_code?: string
  surface?: string
  public_model_name?: string
  provider_name?: string
  provider_model_name?: string
  estimated_min_credits?: number
  estimated_max_credits?: number
  recommended_budget?: number
  current_balance?: number
  warnings?: string[]
}

export interface CloudCreditEstimate {
  workspace_slug: string
  metered: boolean
  resolved_model: string
  tier: string
  surface: string
  estimate: CloudCreditEstimateSummary
}

export interface CloudModelRegistryEntry {
  public_model_name: string
  provider_name?: string
  provider_model_name?: string
  model_class?: string
  default_multiplier?: number
  allowed_plans?: string[]
  supports_coding?: boolean
  supports_long_context?: boolean
  supports_tool_use?: boolean
}

export interface CreateCloudJobInput {
  title?: string
  objective: string
  mode?: CloudMode
  target_task_count?: number
  model?: string
  default_agent?: string
  validation_commands?: string[]
  approval_required?: boolean
  use_llm?: boolean
  allow_write?: boolean
  repository_id?: number
  auto_create_pr?: boolean
  execution_target?: CloudExecutionTarget
  run_budget_credits?: number
}

export interface EstimateCloudCreditsInput {
  mode?: CloudMode
  target_task_count?: number
  model?: string
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

function actionUrl(config: CloudConfig, action: string, query?: Record<string, string | number>): string {
  const normalized = action.replace(/^\/+/, "")
  const base = `${config.url}/api/v1/developer/modules/${MODULE_SLUG}/actions/${normalized}`
  if (!query || Object.keys(query).length === 0) return base
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  return `${base}?${params.toString()}`
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
  options: { body?: Record<string, unknown>; query?: Record<string, string | number>; signal?: AbortSignal } = {},
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
    res = await fetch(actionUrl(config, action, options.query), init)
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
  if (input.model) body["model"] = input.model
  if (input.default_agent) body["default_agent"] = input.default_agent
  if (input.validation_commands) body["validation_commands"] = input.validation_commands
  if (input.approval_required !== undefined) body["approval_required"] = input.approval_required
  if (input.use_llm !== undefined) body["use_llm"] = input.use_llm
  if (input.allow_write !== undefined) body["allow_write"] = input.allow_write
  if (input.repository_id !== undefined) body["repository_id"] = input.repository_id
  if (input.auto_create_pr !== undefined) body["auto_create_pr"] = input.auto_create_pr
  if (input.execution_target) body["execution_target"] = input.execution_target
  if (input.run_budget_credits !== undefined) body["run_budget_credits"] = input.run_budget_credits
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

/** Fetch one task, including its run history (attempts, cost, diff per attempt). */
export function getTask(taskId: number, signal?: AbortSignal): Promise<CloudTask> {
  return request<CloudTask>("GET", `coder/tasks/${taskId}`, { signal })
}

export interface ListJobEventsOptions {
  /** Only return events with id greater than this — for incremental polling. */
  afterId?: number
  /** Max events to return (server default 200, max 1000). */
  limit?: number
  signal?: AbortSignal
}

export async function listJobEvents(
  jobId: number,
  options: ListJobEventsOptions = {},
): Promise<CloudEvent[]> {
  const query: Record<string, string | number> = {}
  if (options.afterId !== undefined) query["after_id"] = options.afterId
  if (options.limit !== undefined) query["limit"] = options.limit
  const res = await request<{ events?: CloudEvent[] } | CloudEvent[]>("GET", `coder/jobs/${jobId}/events`, {
    query,
    signal: options.signal,
  })
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

export async function getCreditBalance(signal?: AbortSignal): Promise<CloudCreditBalance> {
  return request<CloudCreditBalance>("GET", "coder/credits/balance", { signal })
}

export async function estimateCredits(
  input: EstimateCloudCreditsInput,
  signal?: AbortSignal,
): Promise<CloudCreditEstimate> {
  const body: Record<string, unknown> = {
    mode: input.mode ?? "autonomous_build",
  }
  if (input.target_task_count !== undefined) body["target_task_count"] = input.target_task_count
  if (input.model) body["model"] = input.model
  return request<CloudCreditEstimate>("POST", "coder/credits/estimate", { body, signal })
}

export async function listCreditModels(signal?: AbortSignal): Promise<CloudModelRegistryEntry[]> {
  const res = await request<{ models?: CloudModelRegistryEntry[] } | CloudModelRegistryEntry[]>(
    "GET",
    "coder/credits/models",
    { signal },
  )
  if (Array.isArray(res)) return res
  return res?.models ?? []
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
