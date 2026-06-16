import { Account } from "@/account/account"
import { Auth } from "@/auth"
import { OttiliCloud } from "@/cloud/cloud"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConsoleSwitchPayload, SessionListQuery, ToolListQuery, WorktreeApiError } from "../groups/experimental"

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const auth = yield* Auth.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const loginAccount = Effect.fn("ExperimentalHttpApi.accountLogin")(function* (ctx: {
      payload: { authUrl?: string }
    }) {
      const result = yield* account.loginOttiliOne(ctx.payload.authUrl).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            new HttpApiError.BadRequest({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        ),
      )
      return { email: result.email }
    })

    const accountStatus = Effect.fn("ExperimentalHttpApi.accountStatus")(function* () {
      return yield* account.status().pipe(
        Effect.catch(() => Effect.succeed({ loggedIn: false as const })),
      )
    })

    const accountLogout = Effect.fn("ExperimentalHttpApi.accountLogout")(function* () {
      yield* account
        .logout()
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({}))))
      delete process.env.OTTILI_CODER_CONSOLE_TOKEN
      yield* auth.remove("ottili-coder").pipe(Effect.catch(() => Effect.void))
      return { ok: true }
    })

    const accountUsageLimits = Effect.fn("ExperimentalHttpApi.accountUsageLimits")(function* () {
      return yield* account.usageLimits().pipe(
        Effect.catch(() =>
          Effect.succeed({
            loggedIn: false as const,
          }),
        ),
      )
    })

    const cloudTry = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new HttpApiError.BadRequest({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      })

    const cloudStatus = Effect.fn("ExperimentalHttpApi.cloudStatus")(function* () {
      const config = OttiliCloud.resolveConfig()
      if (!config.token) {
        return { configured: false, dashboardUrl: config.dashboardUrl }
      }
      const jobs = yield* cloudTry(() => OttiliCloud.listJobs())
      const activeJobs = jobs.filter((job) => !OttiliCloud.isTerminal(job.status)).length
      return {
        configured: true,
        dashboardUrl: config.dashboardUrl,
        url: config.url,
        ...(config.company ? { company: config.company } : {}),
        activeJobs,
      }
    })

    const cloudConnect = Effect.fn("ExperimentalHttpApi.cloudConnect")(function* (ctx: {
      payload: { url?: string; token: string; company?: string }
    }) {
      const token = ctx.payload.token.trim()
      if (!token) return yield* Effect.fail(new HttpApiError.BadRequest({ message: "API key is required." }))

      const existing = OttiliCloud.loadConfigFile()
      const url = ctx.payload.url?.trim() || existing.url || "https://api.ottili.one"
      const company = ctx.payload.company?.trim() || existing.company
      OttiliCloud.saveConfigFile({ url, token, company: company || undefined })
      yield* cloudTry(() => OttiliCloud.listJobs())
      const config = OttiliCloud.resolveConfig()
      return { ok: true, dashboardUrl: config.dashboardUrl }
    })

    const cloudDisconnect = Effect.fn("ExperimentalHttpApi.cloudDisconnect")(function* () {
      OttiliCloud.disconnect()
      return { ok: true }
    })

    const cloudJobs = Effect.fn("ExperimentalHttpApi.cloudJobs")(function* () {
      const jobs = yield* cloudTry(() => OttiliCloud.listJobs())
      return { jobs }
    })

    const cloudJob = Effect.fn("ExperimentalHttpApi.cloudJob")(function* (ctx: { params: { jobId: number } }) {
      return yield* cloudTry(() => OttiliCloud.getJob(ctx.params.jobId))
    })

    const cloudCreateJob = Effect.fn("ExperimentalHttpApi.cloudCreateJob")(function* (ctx: {
      payload: {
        objective: string
        title?: string
        mode?: "autonomous_build" | "continuous_coding"
        target_task_count?: number
        repository_id?: number
        execution_target?: "local" | "github_agent"
        default_agent?: string
        auto_create_pr?: boolean
      }
    }) {
      const objective = ctx.payload.objective.trim()
      if (!objective) return yield* Effect.fail(new HttpApiError.BadRequest({ message: "Objective is required." }))
      const target =
        ctx.payload.execution_target ??
        (ctx.payload.repository_id !== undefined ? ("github_agent" as const) : undefined)
      return yield* cloudTry(() =>
        OttiliCloud.createJob({
          objective,
          title: ctx.payload.title,
          mode: ctx.payload.mode,
          target_task_count: ctx.payload.target_task_count,
          repository_id: ctx.payload.repository_id,
          execution_target: target,
          default_agent: ctx.payload.default_agent,
          auto_create_pr: ctx.payload.auto_create_pr,
        }),
      )
    })

    const cloudJobCancel = Effect.fn("ExperimentalHttpApi.cloudJobCancel")(function* (ctx: {
      params: { jobId: number }
    }) {
      return yield* cloudTry(() => OttiliCloud.jobAction(ctx.params.jobId, "cancel"))
    })

    const cloudJobEvents = Effect.fn("ExperimentalHttpApi.cloudJobEvents")(function* (ctx: {
      params: { jobId: number }
    }) {
      const events = yield* cloudTry(() => OttiliCloud.listJobEvents(ctx.params.jobId))
      return { events }
    })

    const cloudJobDashboard = Effect.fn("ExperimentalHttpApi.cloudJobDashboard")(function* (ctx: {
      params: { jobId: number }
    }) {
      return { url: OttiliCloud.dashboardJobUrl(ctx.params.jobId) }
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const all = yield* sessions.listGlobal({
        directory: ctx.query.directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return handlers
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("accountLogin", loginAccount)
      .handle("accountStatus", accountStatus)
      .handle("accountLogout", accountLogout)
      .handle("accountUsageLimits", accountUsageLimits)
      .handle("cloudStatus", cloudStatus)
      .handle("cloudConnect", cloudConnect)
      .handle("cloudDisconnect", cloudDisconnect)
      .handle("cloudJobs", cloudJobs)
      .handle("cloudJob", cloudJob)
      .handle("cloudCreateJob", cloudCreateJob)
      .handle("cloudJobCancel", cloudJobCancel)
      .handle("cloudJobEvents", cloudJobEvents)
      .handle("cloudJobDashboard", cloudJobDashboard)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("resource", resource)
  }),
)
