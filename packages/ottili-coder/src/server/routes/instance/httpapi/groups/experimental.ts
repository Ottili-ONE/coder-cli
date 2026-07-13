import { AccountID, OrgID } from "@/account/schema"
import { MCP } from "@/mcp"

import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Worktree } from "@/worktree"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const ConsoleStateResponse = Schema.Struct({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optionalKey(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })

const ConsoleOrgOption = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
})

const ConsoleOrgList = Schema.Struct({
  orgs: Schema.Array(ConsoleOrgOption),
})

export const ConsoleSwitchPayload = Schema.Struct({
  accountID: AccountID,
  orgID: OrgID,
})

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: ProviderV2.ID,
  model: ModelV2.ID,
})

const WorktreeList = Schema.Array(Schema.String)
const WorktreeErrorName = Schema.Union([
  Schema.Literal("WorktreeNotGitError"),
  Schema.Literal("WorktreeNameGenerationFailedError"),
  Schema.Literal("WorktreeCreateFailedError"),
  Schema.Literal("WorktreeStartCommandFailedError"),
  Schema.Literal("WorktreeRemoveFailedError"),
  Schema.Literal("WorktreeResetFailedError"),
  Schema.Literal("WorktreeListFailedError"),
])
export class WorktreeApiError extends Schema.ErrorClass<WorktreeApiError>("WorktreeError")(
  {
    name: WorktreeErrorName,
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}
export const SessionListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

const AccountLoginPayload = Schema.Struct({
  authUrl: Schema.optionalKey(Schema.String),
})

const AccountLoginResponse = Schema.Struct({
  email: Schema.String,
})

const AccountStatusResponse = Schema.Struct({
  loggedIn: Schema.Boolean,
  email: Schema.optionalKey(Schema.String),
  orgName: Schema.optionalKey(Schema.String),
})

const AccountLogoutResponse = Schema.Struct({
  ok: Schema.Boolean,
})

const UsageLimitItemResponse = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  used: Schema.Number,
  limit: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  unlimited: Schema.Boolean,
  remaining: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  percent: Schema.Number,
  status: Schema.String,
})

const AccountUsageLimitsResponse = Schema.Struct({
  loggedIn: Schema.Boolean,
  planCode: Schema.optionalKey(Schema.String),
  planName: Schema.optionalKey(Schema.String),
  billingStatus: Schema.optionalKey(Schema.String),
  periodEnd: Schema.optionalKey(Schema.String),
  items: Schema.optionalKey(Schema.Array(UsageLimitItemResponse)),
  dashboardUrl: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
})

const CloudJob = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  objective: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(Schema.String),
  status: Schema.String,
  target_task_count: Schema.optionalKey(Schema.Number),
  current_phase: Schema.optionalKey(Schema.NullOr(Schema.String)),
  completion_pct: Schema.optionalKey(Schema.Number),
  repository_id: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  execution_backend: Schema.optionalKey(Schema.String),
  result_summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error_summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_by: Schema.optionalKey(Schema.String),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  started_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  completed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  task_counts: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  task_total: Schema.optionalKey(Schema.Number),
  artifacts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        type: Schema.String,
        title: Schema.String,
        payload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
        created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
}).annotate({ identifier: "CloudJob" })

const CloudEvent = Schema.Struct({
  id: Schema.Number,
  job_id: Schema.optionalKey(Schema.Number),
  task_id: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  event_type: Schema.String,
  message: Schema.String,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  created_at: Schema.NullOr(Schema.String),
}).annotate({ identifier: "CloudEvent" })

const CloudTaskRun = Schema.Struct({
  id: Schema.Number,
  attempt: Schema.Number,
  agent_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  provider_info: Schema.optionalKey(Schema.NullOr(Schema.String)),
  stdout: Schema.optionalKey(Schema.NullOr(Schema.String)),
  stderr: Schema.optionalKey(Schema.NullOr(Schema.String)),
  diff_text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  duration_seconds: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  tokens_used: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  cost_dollars: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  success: Schema.Boolean,
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "CloudTaskRun" })

const CloudTask = Schema.Struct({
  id: Schema.Number,
  job_id: Schema.Number,
  title: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  kind: Schema.String,
  status: Schema.String,
  order: Schema.optionalKey(Schema.Number),
  depends_on: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.Number))),
  assigned_agent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  prompt_text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  files_involved: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
  acceptance_criteria: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
  result_summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error_summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  diff_text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  files_changed: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
  retry_count: Schema.optionalKey(Schema.Number),
  max_retries: Schema.optionalKey(Schema.Number),
  started_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  completed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  runs: Schema.optionalKey(Schema.mutable(Schema.Array(CloudTaskRun))),
}).annotate({ identifier: "CloudTask" })

const CloudStatusResponse = Schema.Struct({
  configured: Schema.Boolean,
  url: Schema.optionalKey(Schema.String),
  company: Schema.optionalKey(Schema.String),
  dashboardUrl: Schema.String,
  activeJobs: Schema.optionalKey(NonNegativeInt),
})

const CloudConnectPayload = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  token: Schema.String,
  company: Schema.optionalKey(Schema.String),
})

const CloudConnectResponse = Schema.Struct({
  ok: Schema.Boolean,
  dashboardUrl: Schema.String,
})

const CloudDisconnectResponse = Schema.Struct({
  ok: Schema.Boolean,
})

const CloudJobList = Schema.Struct({
  jobs: Schema.Array(CloudJob),
})

const CloudEventList = Schema.Struct({
  events: Schema.Array(CloudEvent),
})

const CloudTaskList = Schema.Struct({
  tasks: Schema.Array(CloudTask),
})

const CloudJobEventsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  after_id: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})

const CloudCreatePayload = Schema.Struct({
  objective: Schema.String,
  title: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(Schema.Literals(["autonomous_build", "continuous_coding"])),
  target_task_count: Schema.optionalKey(Schema.Number),
  repository_id: Schema.optionalKey(Schema.Number),
  execution_target: Schema.optionalKey(Schema.Literals(["local", "github_agent"])),
  default_agent: Schema.optionalKey(Schema.String),
  auto_create_pr: Schema.optionalKey(Schema.Boolean),
})

const CloudDashboardUrlResponse = Schema.Struct({
  url: Schema.String,
})

export const ExperimentalPaths = {
  console: "/experimental/console",
  consoleOrgs: "/experimental/console/orgs",
  consoleSwitch: "/experimental/console/switch",
  accountLogin: "/experimental/account/login",
  accountStatus: "/experimental/account/status",
  accountLogout: "/experimental/account/logout",
  accountUsageLimits: "/experimental/account/usage-limits",
  cloudStatus: "/experimental/cloud/status",
  cloudConnect: "/experimental/cloud/connect",
  cloudDisconnect: "/experimental/cloud/disconnect",
  cloudJobs: "/experimental/cloud/jobs",
  cloudJob: "/experimental/cloud/jobs/:jobId",
  cloudJobCancel: "/experimental/cloud/jobs/:jobId/cancel",
  cloudJobEvents: "/experimental/cloud/jobs/:jobId/events",
  cloudJobTasks: "/experimental/cloud/jobs/:jobId/tasks",
  cloudTask: "/experimental/cloud/tasks/:taskId",
  cloudJobDashboard: "/experimental/cloud/jobs/:jobId/dashboard",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  sessionBackground: "/experimental/session/:sessionID/background",
  resource: "/experimental/resource",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("console", ExperimentalPaths.console, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleStateResponse, "Active Console provider metadata"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.get",
            summary: "Get active Console provider metadata",
            description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
          }),
        ),
        HttpApiEndpoint.get("consoleOrgs", ExperimentalPaths.consoleOrgs, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleOrgList, "Switchable Console orgs"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.listOrgs",
            summary: "List switchable Console orgs",
            description: "Get the available Console orgs across logged-in accounts, including the current active org.",
          }),
        ),
        HttpApiEndpoint.post("consoleSwitch", ExperimentalPaths.consoleSwitch, {
          query: WorkspaceRoutingQuery,
          payload: ConsoleSwitchPayload,
          success: described(Schema.Boolean, "Switch success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.switchOrg",
            summary: "Switch active Console org",
            description: "Persist a new active Console account/org selection for the current local Ottili Coder state.",
          }),
        ),
        HttpApiEndpoint.post("accountLogin", ExperimentalPaths.accountLogin, {
          query: WorkspaceRoutingQuery,
          payload: AccountLoginPayload,
          success: described(AccountLoginResponse, "Signed-in account email"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.account.login",
            summary: "Sign in with Ottili ONE",
            description: "Open the browser OAuth flow and persist the Ottili ONE account locally.",
          }),
        ),
        HttpApiEndpoint.get("accountStatus", ExperimentalPaths.accountStatus, {
          query: WorkspaceRoutingQuery,
          success: described(AccountStatusResponse, "Active account status"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.account.status",
            summary: "Get active account status",
            description: "Return whether an Ottili ONE account is signed in locally and its display metadata.",
          }),
        ),
        HttpApiEndpoint.post("accountLogout", ExperimentalPaths.accountLogout, {
          query: WorkspaceRoutingQuery,
          success: described(AccountLogoutResponse, "Logout success"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.account.logout",
            summary: "Sign out of Ottili ONE",
            description: "Remove the active local Ottili ONE account and clear linked provider credentials.",
          }),
        ),
        HttpApiEndpoint.get("accountUsageLimits", ExperimentalPaths.accountUsageLimits, {
          query: WorkspaceRoutingQuery,
          success: described(AccountUsageLimitsResponse, "Ottili ONE plan usage limits"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.account.usageLimits",
            summary: "Get Ottili ONE usage limits",
            description: "Return plan usage limits for the signed-in Ottili ONE account.",
          }),
        ),
        HttpApiEndpoint.get("cloudStatus", ExperimentalPaths.cloudStatus, {
          query: WorkspaceRoutingQuery,
          success: described(CloudStatusResponse, "Ottili Cloud connection status"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.status",
            summary: "Get Ottili Cloud status",
            description: "Return whether Ottili Coder Cloud is configured and how many jobs are active.",
          }),
        ),
        HttpApiEndpoint.post("cloudConnect", ExperimentalPaths.cloudConnect, {
          query: WorkspaceRoutingQuery,
          payload: CloudConnectPayload,
          success: described(CloudConnectResponse, "Cloud connect success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.connect",
            summary: "Connect Ottili Cloud",
            description: "Save the developer API key and optional company slug for Ottili Coder Cloud.",
          }),
        ),
        HttpApiEndpoint.post("cloudDisconnect", ExperimentalPaths.cloudDisconnect, {
          query: WorkspaceRoutingQuery,
          success: described(CloudDisconnectResponse, "Cloud disconnect success"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.disconnect",
            summary: "Disconnect Ottili Cloud",
            description: "Remove the saved Ottili Coder Cloud API key from local config.",
          }),
        ),
        HttpApiEndpoint.get("cloudJobs", ExperimentalPaths.cloudJobs, {
          query: WorkspaceRoutingQuery,
          success: described(CloudJobList, "Cloud jobs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.listJobs",
            summary: "List cloud jobs",
            description: "List recent Ottili Coder Cloud jobs for the connected workspace.",
          }),
        ),
        HttpApiEndpoint.get("cloudJob", ExperimentalPaths.cloudJob, {
          params: { jobId: Schema.NumberFromString },
          query: WorkspaceRoutingQuery,
          success: described(CloudJob, "Cloud job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.getJob",
            summary: "Get cloud job",
            description: "Fetch one Ottili Coder Cloud job by id.",
          }),
        ),
        HttpApiEndpoint.post("cloudCreateJob", ExperimentalPaths.cloudJobs, {
          query: WorkspaceRoutingQuery,
          payload: CloudCreatePayload,
          success: described(CloudJob, "Created cloud job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.createJob",
            summary: "Create cloud job",
            description: "Start a new autonomous Ottili Coder Cloud job.",
          }),
        ),
        HttpApiEndpoint.post("cloudJobCancel", ExperimentalPaths.cloudJobCancel, {
          params: { jobId: Schema.NumberFromString },
          query: WorkspaceRoutingQuery,
          success: described(CloudJob, "Cancelled cloud job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.cancelJob",
            summary: "Cancel cloud job",
            description: "Cancel a running Ottili Coder Cloud job.",
          }),
        ),
        HttpApiEndpoint.get("cloudJobEvents", ExperimentalPaths.cloudJobEvents, {
          params: { jobId: Schema.NumberFromString },
          query: CloudJobEventsQuery,
          success: described(CloudEventList, "Cloud job events"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.listJobEvents",
            summary: "List cloud job events",
            description:
              "Fetch the event stream for one Ottili Coder Cloud job. Pass after_id to poll incrementally.",
          }),
        ),
        HttpApiEndpoint.get("cloudJobTasks", ExperimentalPaths.cloudJobTasks, {
          params: { jobId: Schema.NumberFromString },
          query: WorkspaceRoutingQuery,
          success: described(CloudTaskList, "Cloud job tasks"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.listJobTasks",
            summary: "List cloud job tasks",
            description: "List the task graph for one Ottili Coder Cloud job, including status and assigned agent.",
          }),
        ),
        HttpApiEndpoint.get("cloudTask", ExperimentalPaths.cloudTask, {
          params: { taskId: Schema.NumberFromString },
          query: WorkspaceRoutingQuery,
          success: described(CloudTask, "Cloud task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.getTask",
            summary: "Get cloud task",
            description: "Fetch one Ottili Coder Cloud task by id, including its run history (attempts, cost, diff).",
          }),
        ),
        HttpApiEndpoint.get("cloudJobDashboard", ExperimentalPaths.cloudJobDashboard, {
          params: { jobId: Schema.NumberFromString },
          query: WorkspaceRoutingQuery,
          success: described(CloudDashboardUrlResponse, "Cloud job dashboard URL"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.dashboardUrl",
            summary: "Get cloud job dashboard URL",
            description: "Return the codehelm.ottili.one dashboard URL for a cloud job.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          query: WorkspaceRoutingQuery,
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          success: described(WorktreeList, "List of worktree directories"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          disableCodecs: true,
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Worktree.CreateInput],
          success: described(Worktree.Info, "Worktree created"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all Ottili Coder sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.post("sessionBackground", ExperimentalPaths.sessionBackground, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Backgrounded subagents"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.background",
            summary: "Background subagents",
            description:
              "Detach any synchronous subagents currently blocking the session and continue them in the background.",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi read-only routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "ottili-coder experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
