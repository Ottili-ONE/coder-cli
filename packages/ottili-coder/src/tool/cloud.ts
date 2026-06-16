import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { OttiliCloud, type CloudJob } from "@/cloud/cloud"

const DESCRIPTION = `Start and inspect HOSTED autonomous Ottili Coder jobs (the cloud engine behind codehelm.ottili.one).

Use this when the user wants a larger piece of work handed off to run on its own in the cloud — it decomposes the objective into many tasks and works through them, optionally opening a pull request. This does NOT edit the local working copy; it dispatches a job to the Ottili Coder control plane.

Actions:
- "create": launch a new job. Requires "objective". Optional: "mode" (autonomous_build = build a feature, continuous_coding = ongoing small fixes), "target_task_count", "repository_id" (a connected repo; enables the GitHub sandbox), "auto_create_pr".
- "status": show one job. Requires "job_id".
- "list": list recent jobs.

Prefer the normal local editing tools for direct, immediate changes; use this only for autonomous/long-running cloud work.`

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "status", "list"]).annotate({
    description: "What to do: create a job, get one job's status, or list recent jobs",
  }),
  objective: Schema.optional(Schema.String).annotate({
    description: "For create: what the job should accomplish",
  }),
  mode: Schema.optional(Schema.Literals(["autonomous_build", "continuous_coding"])).annotate({
    description: "For create: autonomous_build (default) or continuous_coding",
  }),
  target_task_count: Schema.optional(Schema.Number).annotate({
    description: "For create (autonomous_build): target number of tasks",
  }),
  repository_id: Schema.optional(Schema.Number).annotate({
    description: "For create: a connected repository id (enables the GitHub sandbox + PR)",
  }),
  auto_create_pr: Schema.optional(Schema.Boolean).annotate({
    description: "For create: open a pull request when the job finishes",
  }),
  job_id: Schema.optional(Schema.Number).annotate({
    description: "For status: the job id to inspect",
  }),
})

type Metadata = {
  jobId?: number
  status?: string
}

function summarize(job: CloudJob): string {
  const lines = [
    `Job #${job.id} — ${job.title}`,
    `status: ${job.status}  (${Math.round(job.completion_pct ?? 0)}%)`,
    `mode: ${job.mode}  backend: ${job.execution_backend}`,
  ]
  if (job.current_phase) lines.push(`phase: ${job.current_phase}`)
  if (job.task_counts && Object.keys(job.task_counts).length) {
    lines.push("tasks: " + Object.entries(job.task_counts).map(([k, v]) => `${k}:${v}`).join("  "))
  }
  if (job.result_summary) lines.push(`result: ${job.result_summary}`)
  if (job.error_summary) lines.push(`error: ${job.error_summary}`)
  for (const artifact of job.artifacts ?? []) {
    const url = (artifact.payload?.["url"] ?? artifact.payload?.["html_url"]) as string | undefined
    if (url) lines.push(`${artifact.type}: ${url}`)
  }
  lines.push(`dashboard: ${OttiliCloud.dashboardJobUrl(job.id)}`)
  return lines.join("\n")
}

export const OttiliCloudTool = Tool.define<typeof Parameters, Metadata, never>(
  "ottili_coder",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        if (!OttiliCloud.isConfigured()) {
          return {
            title: "Ottili Coder Cloud not configured",
            output:
              "Ottili Coder Cloud is not connected. Ask the user to run `ottili-coder cloud login` or set OTTILI_CODER_CLOUD_TOKEN.",
            metadata: {},
          }
        }

        if (params.action === "list") {
          const listed = yield* Effect.tryPromise({
            try: () => OttiliCloud.listJobs(),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
          }).pipe(
            Effect.map((jobs) => ({ ok: true as const, jobs })),
            Effect.catch((e: Error) => Effect.succeed({ ok: false as const, error: e.message })),
          )
          if (!listed.ok) {
            return { title: "list failed", output: listed.error, metadata: {} }
          }
          const output = listed.jobs.length
            ? listed.jobs
                .map((j) => `#${j.id} [${j.status}] ${Math.round(j.completion_pct ?? 0)}% — ${j.title}`)
                .join("\n")
            : "No jobs yet."
          return { title: `${listed.jobs.length} jobs`, output, metadata: {} }
        }

        if (params.action === "status") {
          if (params.job_id === undefined) {
            return { title: "missing job_id", output: 'The "status" action requires "job_id".', metadata: {} }
          }
          const jobId = params.job_id
          const got = yield* Effect.tryPromise({
            try: () => OttiliCloud.getJob(jobId),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
          }).pipe(
            Effect.map((job) => ({ ok: true as const, job })),
            Effect.catch((e: Error) => Effect.succeed({ ok: false as const, error: e.message })),
          )
          if (!got.ok) {
            return { title: "status failed", output: got.error, metadata: {} }
          }
          return {
            title: `Job #${got.job.id} ${got.job.status}`,
            output: summarize(got.job),
            metadata: { jobId: got.job.id, status: got.job.status },
          }
        }

        // action === "create"
        if (!params.objective || !params.objective.trim()) {
          return { title: "missing objective", output: 'The "create" action requires an "objective".', metadata: {} }
        }
        const objective = params.objective
        yield* ctx.ask({
          permission: "ottili-cloud",
          patterns: ["create"],
          always: ["*"],
          metadata: { objective, mode: params.mode ?? "autonomous_build" },
        })
        const target = params.repository_id !== undefined ? ("github_agent" as const) : undefined
        const created = yield* Effect.tryPromise({
          try: () =>
            OttiliCloud.createJob({
              objective,
              mode: params.mode,
              target_task_count: params.target_task_count,
              repository_id: params.repository_id,
              auto_create_pr: params.auto_create_pr,
              execution_target: target,
            }),
          catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
        }).pipe(
          Effect.map((job) => ({ ok: true as const, job })),
          Effect.catch((e: Error) => Effect.succeed({ ok: false as const, error: e.message })),
        )
        if (!created.ok) {
          return { title: "create failed", output: created.error, metadata: {} }
        }
        const job = created.job
        return {
          title: `Created job #${job.id}`,
          output: ["Started a cloud Ottili Coder job.", summarize(job)].join("\n"),
          metadata: { jobId: job.id, status: job.status },
        }
      }),
  } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>),
)
