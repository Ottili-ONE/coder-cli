import { Effect } from "effect"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { effectCmd, fail, CliError } from "../effect-cmd"
import { OttiliCloud, type CloudJob, type CloudJobStatus, type CloudMode, type CloudTask } from "@/cloud/cloud"

/** Wrap a cloud call so any failure becomes a clean, user-visible CLI error. */
function guard<T>(run: () => Promise<T>) {
  return Effect.tryPromise({
    try: run,
    catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
  })
}

const STATUS_STYLE: Record<string, string> = {
  completed: UI.Style.TEXT_SUCCESS,
  passed: UI.Style.TEXT_SUCCESS,
  running: UI.Style.TEXT_INFO,
  planning: UI.Style.TEXT_INFO,
  validating: UI.Style.TEXT_INFO,
  queued: UI.Style.TEXT_WARNING,
  paused: UI.Style.TEXT_WARNING,
  draft: UI.Style.TEXT_DIM,
  failed: UI.Style.TEXT_DANGER,
  cancelled: UI.Style.TEXT_DIM,
}

function paintStatus(status: string): string {
  const style = STATUS_STYLE[status] ?? UI.Style.TEXT_NORMAL
  return `${style}${status}${UI.Style.TEXT_NORMAL}`
}

function dim(text: string): string {
  return `${UI.Style.TEXT_DIM}${text}${UI.Style.TEXT_NORMAL}`
}

function bold(text: string): string {
  return `${UI.Style.TEXT_NORMAL_BOLD}${text}${UI.Style.TEXT_NORMAL}`
}

function jobLine(job: CloudJob): string {
  const id = `#${job.id}`.padEnd(6)
  const status = paintStatus(job.status).padEnd(status_pad(job.status))
  const pct = `${Math.round(job.completion_pct ?? 0)}%`.padStart(4)
  return `${dim(id)} ${status} ${pct}  ${job.title}`
}

// padEnd on a colored string overcounts width because of escape codes; correct it.
function status_pad(status: string): number {
  const visible = status.length
  const styled = paintStatus(status).length
  return styled - visible + 12
}

function printJobDetail(job: CloudJob) {
  UI.println(bold(`Ottili Coder job #${job.id}`) + "  " + paintStatus(job.status))
  UI.println(dim("title    ") + job.title)
  UI.println(dim("mode     ") + job.mode + dim("   backend ") + job.execution_backend)
  UI.println(dim("progress ") + `${Math.round(job.completion_pct ?? 0)}%` + (job.current_phase ? dim("   phase ") + job.current_phase : ""))
  const budget = Number(job.settings?.["credit_budget_credits"])
  const estimate = job.settings?.["credit_estimate"]
  const recommended =
    estimate &&
    typeof estimate === "object" &&
    "recommended_budget" in estimate &&
    typeof estimate.recommended_budget === "number"
      ? estimate.recommended_budget
      : undefined
  if (Number.isFinite(budget)) {
    UI.println(dim("credits  ") + `${budget}` + (typeof recommended === "number" ? dim("   estimate ") + `${recommended}` : ""))
  }
  if (job.task_counts && Object.keys(job.task_counts).length) {
    const counts = Object.entries(job.task_counts)
      .map(([k, v]) => `${k}:${v}`)
      .join("  ")
    UI.println(dim("tasks    ") + counts)
  }
  if (job.result_summary) UI.println(dim("result   ") + job.result_summary)
  if (job.error_summary) UI.println(UI.Style.TEXT_DANGER + "error    " + UI.Style.TEXT_NORMAL + job.error_summary)
  for (const artifact of job.artifacts ?? []) {
    const url = (artifact.payload?.["url"] ?? artifact.payload?.["html_url"]) as string | undefined
    UI.println(dim(`${artifact.type.padEnd(9)}`) + (url ? `${artifact.title}  ${UI.Style.TEXT_INFO}${url}${UI.Style.TEXT_NORMAL}` : artifact.title))
  }
}

// ── cloud login ──────────────────────────────────────────────────────────────

const CloudLoginCommand = effectCmd({
  command: "login",
  describe: "connect this CLI to your Ottili Coder Cloud workspace",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("url", { type: "string", describe: "Unified API base URL (default https://api.ottili.one)" })
      .option("token", { type: "string", describe: "developer/service API key (ott_...)" })
      .option("company", { type: "string", describe: "company slug for the workspace context" }),
  handler: (args) =>
    Effect.gen(function* () {
      const existing = OttiliCloud.loadConfigFile()
      const url =
        (args.url as string | undefined) ||
        (yield* guard(() => UI.input(`Unified API URL [${existing.url ?? "https://api.ottili.one"}]: `))) ||
        existing.url ||
        "https://api.ottili.one"
      const token =
        (args.token as string | undefined) ||
        (yield* guard(() => UI.input("API key (ott_...): "))) ||
        existing.token
      if (!token) return yield* fail("An API key is required to connect to Ottili Coder Cloud.")
      const company =
        (args.company as string | undefined) ||
        (yield* guard(() => UI.input(`Company slug${existing.company ? ` [${existing.company}]` : " (optional)"}: `))) ||
        existing.company
      const file = yield* guard(async () => OttiliCloud.saveConfigFile({ url, token, company: company || undefined }))
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Connected." + UI.Style.TEXT_NORMAL + " Saved to " + dim(file))
      UI.println(dim("Try: ") + "ottili-coder cloud run \"add a health endpoint\" --watch")
    }),
})

// ── cloud run ──────────────────────────────────────────────────────────────

const CloudRunCommand = effectCmd({
  command: "run [objective..]",
  describe: "start a new cloud Ottili Coder job",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("objective", { type: "string", array: true, describe: "what the job should accomplish" })
      .option("mode", {
        type: "string",
        choices: ["autonomous_build", "continuous_coding"],
        default: "autonomous_build",
        describe: "build a feature vs. continuous small fixes",
      })
      .option("tasks", { type: "number", describe: "target number of tasks (autonomous_build)" })
      .option("budget", { type: "number", describe: "reserve a specific AI credit budget for this run" })
      .option("model", { type: "string", describe: "requested model, e.g. ottili-auto or openai/gpt-5.4-mini" })
      .option("repo", { type: "number", describe: "connected repository id (enables GitHub sandbox)" })
      .option("target", { type: "string", choices: ["local", "github_agent"], describe: "execution target" })
      .option("agent", { type: "string", describe: "preferred coding agent" })
      .option("pr", { type: "boolean", describe: "open a pull request when finished" })
      .option("title", { type: "string", describe: "job title (defaults to the objective)" })
      .option("watch", { type: "boolean", describe: "stream progress until the job finishes" })
      .option("json", { type: "boolean", describe: "print the created job as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const parts = (args.objective as string[] | undefined) ?? []
      const objective = parts.join(" ").trim()
      if (!objective) return yield* fail('Provide an objective, e.g. ottili-coder cloud run "add OAuth login"')

      const target = (args.target as "local" | "github_agent" | undefined) ?? (args.repo ? "github_agent" : undefined)
      const job = yield* guard(() =>
        OttiliCloud.createJob({
          objective,
          title: args.title as string | undefined,
          mode: args.mode as CloudMode,
          target_task_count: args.tasks as number | undefined,
          model: args.model as string | undefined,
          repository_id: args.repo as number | undefined,
          execution_target: target,
          default_agent: args.agent as string | undefined,
          auto_create_pr: args.pr as boolean | undefined,
          run_budget_credits: args.budget as number | undefined,
        }),
      )

      if (args.json) {
        UI.println(JSON.stringify(job, null, 2))
        return
      }
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Job created  " + UI.Style.TEXT_NORMAL + dim(`#${job.id}`))
      printJobDetail(job)
      UI.println(dim("dashboard ") + UI.Style.TEXT_INFO + OttiliCloud.dashboardJobUrl(job.id) + UI.Style.TEXT_NORMAL)
      if (args.watch) {
        UI.empty()
        yield* watchJob(job.id)
      } else {
        UI.println(dim("Watch with: ") + `ottili-coder cloud watch ${job.id}`)
      }
    }),
})

// ── cloud list ──────────────────────────────────────────────────────────────

const CloudListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list recent cloud Ottili Coder jobs",
  instance: false,
  builder: (yargs) => yargs.option("json", { type: "boolean", describe: "print jobs as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const jobs = yield* guard(() => OttiliCloud.listJobs())
      if (args.json) {
        UI.println(JSON.stringify(jobs, null, 2))
        return
      }
      if (!jobs.length) {
        UI.println(dim("No jobs yet. Start one with ") + 'ottili-coder cloud run "..."')
        return
      }
      for (const job of jobs) UI.println(jobLine(job))
    }),
})

// ── cloud balance ───────────────────────────────────────────────────────────

const CloudBalanceCommand = effectCmd({
  command: "balance",
  describe: "show the shared Ottili ONE AI credit balance for this company",
  instance: false,
  builder: (yargs) => yargs.option("json", { type: "boolean", describe: "print the balance as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const balance = yield* guard(() => OttiliCloud.getCreditBalance())
      if (args.json) {
        UI.println(JSON.stringify(balance, null, 2))
        return
      }
      const available =
        typeof balance.current_balance === "number"
          ? balance.current_balance
          : typeof balance.available_credits === "number"
            ? balance.available_credits
            : 0
      UI.println(bold("Ottili ONE AI credits"))
      UI.println(dim("available ") + `${available}`)
      if (typeof balance.included_remaining === "number") UI.println(dim("included  ") + `${balance.included_remaining}`)
      if (typeof balance.recharge_remaining === "number") UI.println(dim("recharge  ") + `${balance.recharge_remaining}`)
      if (balance.plan_code) UI.println(dim("plan      ") + balance.plan_code)
      if (balance.credit_mode) UI.println(dim("mode      ") + balance.credit_mode)
      if (balance.hard_cap_status) UI.println(dim("cap       ") + balance.hard_cap_status)
      if (balance.current_period_end) UI.println(dim("period    ") + balance.current_period_end)
    }),
})

// ── cloud estimate ──────────────────────────────────────────────────────────

const CloudEstimateCommand = effectCmd({
  command: "estimate",
  describe: "estimate the AI credits a cloud Ottili Coder run will reserve",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("mode", {
        type: "string",
        choices: ["autonomous_build", "continuous_coding"],
        default: "autonomous_build",
        describe: "build a feature vs. continuous small fixes",
      })
      .option("tasks", { type: "number", describe: "target number of tasks" })
      .option("model", { type: "string", describe: "requested model, e.g. ottili-auto or openai/gpt-5.4-mini" })
      .option("json", { type: "boolean", describe: "print the estimate as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const estimate = yield* guard(() =>
        OttiliCloud.estimateCredits({
          mode: args.mode as CloudMode,
          target_task_count: args.tasks as number | undefined,
          model: args.model as string | undefined,
        }),
      )
      if (args.json) {
        UI.println(JSON.stringify(estimate, null, 2))
        return
      }
      UI.println(bold("Ottili Coder credit estimate"))
      UI.println(dim("workspace ") + estimate.workspace_slug)
      UI.println(dim("surface   ") + estimate.surface)
      UI.println(dim("model     ") + estimate.resolved_model)
      UI.println(dim("tier      ") + estimate.tier + dim("   metered ") + `${estimate.metered}`)
      UI.println(dim("budget    ") + `${estimate.estimate.recommended_budget ?? 0}`)
      UI.println(
        dim("range     ") +
          `${estimate.estimate.estimated_min_credits ?? 0} - ${estimate.estimate.estimated_max_credits ?? 0}`,
      )
      if (typeof estimate.estimate.current_balance === "number") {
        UI.println(dim("balance   ") + `${estimate.estimate.current_balance}`)
      }
      for (const warning of estimate.estimate.warnings ?? []) UI.println(dim("note      ") + warning)
    }),
})

// ── cloud models ────────────────────────────────────────────────────────────

const CloudModelsCommand = effectCmd({
  command: "models",
  describe: "list the managed AI models available for Ottili Coder cloud runs",
  instance: false,
  builder: (yargs) => yargs.option("json", { type: "boolean", describe: "print models as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const models = yield* guard(() => OttiliCloud.listCreditModels())
      if (args.json) {
        UI.println(JSON.stringify(models, null, 2))
        return
      }
      if (!models.length) {
        UI.println(dim("No managed models were returned."))
        return
      }
      for (const model of models) {
        const provider = model.provider_name ? `${model.provider_name}/` : ""
        const tier = model.model_class ? dim(`  (${model.model_class})`) : ""
        UI.println(`${provider}${model.public_model_name}${tier}`)
      }
    }),
})

// ── cloud status ─────────────────────────────────────────────────────────────

const CloudStatusCommand = effectCmd({
  command: "status <id>",
  describe: "show one cloud Ottili Coder job",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", { type: "number", demandOption: true, describe: "job id" })
      .option("json", { type: "boolean", describe: "print the job as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const job = yield* guard(() => OttiliCloud.getJob(args.id as number))
      if (args.json) {
        UI.println(JSON.stringify(job, null, 2))
        return
      }
      printJobDetail(job)
    }),
})

// ── cloud tasks ──────────────────────────────────────────────────────────────

function taskLine(task: CloudTask): string {
  const id = `#${task.id}`.padEnd(6)
  const status = paintStatus(task.status).padEnd(status_pad(task.status))
  const agent = task.assigned_agent ? "  " + dim(`[${task.assigned_agent}]`) : ""
  return `${dim(id)} ${status} ${dim(task.kind.padEnd(9))} ${task.title}${agent}`
}

const CloudTasksCommand = effectCmd({
  command: "tasks <jobId>",
  describe: "list tasks for a cloud Ottili Coder job",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("jobId", { type: "number", demandOption: true, describe: "job id" })
      .option("json", { type: "boolean", describe: "print tasks as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const tasks = yield* guard(() => OttiliCloud.listJobTasks(args.jobId as number))
      if (args.json) {
        UI.println(JSON.stringify(tasks, null, 2))
        return
      }
      if (!tasks.length) {
        UI.println(dim("No tasks yet."))
        return
      }
      for (const task of tasks) UI.println(taskLine(task))
    }),
})

// ── cloud task ───────────────────────────────────────────────────────────────

const CloudTaskCommand = effectCmd({
  command: "task <id>",
  describe: "show one cloud Ottili Coder task, including its run history",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", { type: "number", demandOption: true, describe: "task id" })
      .option("json", { type: "boolean", describe: "print the task as JSON" }),
  handler: (args) =>
    Effect.gen(function* () {
      const task = yield* guard(() => OttiliCloud.getTask(args.id as number))
      if (args.json) {
        UI.println(JSON.stringify(task, null, 2))
        return
      }
      UI.println(bold(`Task #${task.id}`) + "  " + paintStatus(task.status))
      UI.println(dim("title    ") + task.title)
      UI.println(
        dim("kind     ") + task.kind + (task.assigned_agent ? dim("   agent ") + task.assigned_agent : ""),
      )
      if (task.depends_on.length) {
        UI.println(dim("depends  ") + task.depends_on.map((id) => `#${id}`).join(", "))
      }
      if (task.files_changed.length) UI.println(dim("files    ") + task.files_changed.join(", "))
      if (task.result_summary) UI.println(dim("result   ") + task.result_summary)
      if (task.error_summary) {
        UI.println(UI.Style.TEXT_DANGER + "error    " + UI.Style.TEXT_NORMAL + task.error_summary)
      }
      for (const run of task.runs ?? []) {
        const outcome = run.success
          ? UI.Style.TEXT_SUCCESS + "ok" + UI.Style.TEXT_NORMAL
          : UI.Style.TEXT_DANGER + "failed" + UI.Style.TEXT_NORMAL
        const cost = typeof run.cost_dollars === "number" ? `  $${run.cost_dollars.toFixed(4)}` : ""
        const tokens = typeof run.tokens_used === "number" ? `  ${run.tokens_used} tok` : ""
        UI.println(dim(`attempt ${run.attempt} `) + outcome + dim(`  ${run.agent_type ?? ""}`) + cost + tokens)
      }
    }),
})

// ── cloud watch ──────────────────────────────────────────────────────────────

function watchJob(jobId: number) {
  return Effect.gen(function* () {
    let lastEventId = 0
    let lastStatus: CloudJobStatus | "" = ""
    UI.println(dim(`Watching job #${jobId} — Ctrl+C to stop`))
    for (;;) {
      const job = yield* guard(() => OttiliCloud.getJob(jobId))
      const events = yield* guard(() => OttiliCloud.listJobEvents(jobId, { afterId: lastEventId }).catch(() => []))
      for (const event of events) {
        UI.println(dim(new Date(event.created_at ?? Date.now()).toLocaleTimeString()) + "  " + event.message)
        lastEventId = Math.max(lastEventId, event.id)
      }
      if (job.status !== lastStatus) {
        UI.println(dim("status → ") + paintStatus(job.status) + dim(`   ${Math.round(job.completion_pct ?? 0)}%`))
        lastStatus = job.status
      }
      if (OttiliCloud.isTerminal(job.status)) {
        UI.empty()
        printJobDetail(job)
        return
      }
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5000)))
    }
  })
}

const CloudWatchCommand = effectCmd({
  command: "watch <id>",
  describe: "stream a cloud Ottili Coder job until it finishes",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "number", demandOption: true, describe: "job id" }),
  handler: (args) => watchJob(args.id as number),
})

// ── cloud cancel ─────────────────────────────────────────────────────────────

const CloudCancelCommand = effectCmd({
  command: "cancel <id>",
  describe: "cancel a running cloud Ottili Coder job",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "number", demandOption: true, describe: "job id" }),
  handler: (args) =>
    Effect.gen(function* () {
      const job = yield* guard(() => OttiliCloud.jobAction(args.id as number, "cancel"))
      UI.println(dim(`#${job.id} `) + "→ " + paintStatus(job.status))
    }),
})

// ── cloud open ───────────────────────────────────────────────────────────────

const CloudOpenCommand = effectCmd({
  command: "open [id]",
  describe: "print (and try to open) the dashboard URL for a job",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "number", describe: "job id (optional)" }),
  handler: (args) =>
    Effect.gen(function* () {
      const url = OttiliCloud.dashboardJobUrl(args.id as number | undefined)
      UI.println(url)
      yield* guard(async () => {
        const { Process } = await import("@/util/process")
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
        await Process.run([opener, url], { nothrow: true }).catch(() => undefined)
      }).pipe(Effect.catch(() => Effect.void))
    }),
})

export const CloudCommand = cmd({
  command: "cloud",
  aliases: ["task"],
  describe: "drive cloud Ottili Coder jobs (the codehelm.ottili.one engine) from the terminal",
  builder: (yargs) =>
    yargs
      .command(CloudRunCommand)
      .command(CloudBalanceCommand)
      .command(CloudEstimateCommand)
      .command(CloudModelsCommand)
      .command(CloudListCommand)
      .command(CloudStatusCommand)
      .command(CloudTasksCommand)
      .command(CloudTaskCommand)
      .command(CloudWatchCommand)
      .command(CloudCancelCommand)
      .command(CloudOpenCommand)
      .command(CloudLoginCommand)
      .demandCommand(),
  async handler() {},
})
