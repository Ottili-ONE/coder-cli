import type { useSDK } from "../context/sdk"

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

export type CloudJob = {
  id: number
  title: string
  objective: string
  mode: string
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
  artifacts?: {
    id: number
    type: string
    title: string
    payload: Record<string, unknown>
    created_at: string | null
  }[]
}

export type CloudEvent = {
  id: number
  kind: string
  message: string
  created_at: string | null
}

export type CloudStatus = {
  configured: boolean
  url?: string
  company?: string
  dashboardUrl: string
  activeJobs?: number
}

type Sdk = ReturnType<typeof useSDK>

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { message?: string; detail?: string | { message?: string } }
      if (typeof parsed.detail === "string") throw new Error(parsed.detail)
      if (parsed.detail && typeof parsed.detail === "object" && typeof parsed.detail.message === "string") {
        throw new Error(parsed.detail.message)
      }
      if (typeof parsed.message === "string") throw new Error(parsed.message)
    } catch (error) {
      if (error instanceof Error && error.message !== text) throw error
    }
    throw new Error(text || `HTTP ${response.status}`)
  }
  return JSON.parse(text) as T
}

export async function fetchCloudStatus(sdk: Sdk): Promise<CloudStatus> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/status`, {
    headers: { Accept: "application/json" },
  })
  return readJson(response)
}

export async function connectCloud(
  sdk: Sdk,
  input: { token: string; url?: string; company?: string },
): Promise<{ ok: boolean; dashboardUrl: string }> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/connect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  return readJson(response)
}

export async function disconnectCloud(sdk: Sdk): Promise<void> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/disconnect`, {
    method: "POST",
    headers: { Accept: "application/json" },
  })
  await readJson(response)
}

export async function listCloudJobs(sdk: Sdk): Promise<CloudJob[]> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs`, {
    headers: { Accept: "application/json" },
  })
  const data = await readJson<{ jobs: CloudJob[] }>(response)
  return data.jobs
}

export async function getCloudJob(sdk: Sdk, jobId: number): Promise<CloudJob> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs/${jobId}`, {
    headers: { Accept: "application/json" },
  })
  return readJson(response)
}

export async function createCloudJob(
  sdk: Sdk,
  input: {
    objective: string
    title?: string
    mode?: "autonomous_build" | "continuous_coding"
    auto_create_pr?: boolean
  },
): Promise<CloudJob> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  return readJson(response)
}

export async function cancelCloudJob(sdk: Sdk, jobId: number): Promise<CloudJob> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json" },
  })
  return readJson(response)
}

export async function listCloudJobEvents(sdk: Sdk, jobId: number): Promise<CloudEvent[]> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs/${jobId}/events`, {
    headers: { Accept: "application/json" },
  })
  const data = await readJson<{ events: CloudEvent[] }>(response)
  return data.events
}

export async function cloudJobDashboardUrl(sdk: Sdk, jobId: number): Promise<string> {
  const response = await sdk.fetch(`${sdk.url}/experimental/cloud/jobs/${jobId}/dashboard`, {
    headers: { Accept: "application/json" },
  })
  const data = await readJson<{ url: string }>(response)
  return data.url
}

const TERMINAL: CloudJobStatus[] = ["completed", "failed", "cancelled"]

export function isCloudJobTerminal(status: CloudJobStatus): boolean {
  return TERMINAL.includes(status)
}

export function formatCloudJobLine(job: CloudJob): string {
  const pct = `${Math.round(job.completion_pct ?? 0)}%`.padStart(4)
  return `#${job.id}  ${job.status.padEnd(11)} ${pct}  ${job.title}`
}
