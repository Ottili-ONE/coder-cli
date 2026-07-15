import path from "path"
import { Clock, Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { StageName, StageStatus, StopLevel } from "./event"

// Ordered pipeline. The runtime walks this list and stops at the configured
// StopLevel boundary (see StopLevel docs in event.ts).
export const STAGES: ReadonlyArray<StageName> = [
  "recon",
  "plan",
  "implement",
  "review",
  "test",
  "security",
  "docs",
  "deploy",
  "report",
]

// Index of a stage inside STAGES, used to compare against the StopLevel.
const STAGE_INDEX: Record<StageName, number> = STAGES.reduce(
  (acc, stage, index) => {
    acc[stage] = index
    return acc
  },
  {} as Record<StageName, number>,
)

const STOP_INDEX: Record<StopLevel, number> = {
  none: STAGES.length,
  plan: STAGE_INDEX.plan,
  implement: STAGE_INDEX.implement,
  review: STAGE_INDEX.review,
  test: STAGE_INDEX.test,
  security: STAGE_INDEX.security,
  docs: STAGE_INDEX.docs,
  deploy: STAGE_INDEX.deploy,
  report: STAGE_INDEX.report,
}

// A single stage's recorded outcome.
const StageRecordSchema = Schema.Struct({
  name: StageName,
  status: StageStatus,
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  attempts: Schema.Number,
  error: Schema.optional(Schema.String),
  resultPath: Schema.optional(Schema.String),
})
export type StageRecord = Schema.Schema.Type<typeof StageRecordSchema>

// Durable run record. Persisted to disk so a run survives process/session
// boundaries; resume() reloads it and replays from the last unfinished stage.
const RunSchema = Schema.Struct({
  runID: Schema.String,
  sessionID: Schema.String,
  messageID: Schema.String,
  goal: Schema.String,
  stopLevel: StopLevel,
  stages: Schema.Array(StageName),
  status: Schema.Literals(["queued", "running", "success", "partial", "failed", "cancelled"]),
  currentStage: Schema.optional(StageName),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  cancelled: Schema.Boolean,
  cancelReason: Schema.optional(Schema.String),
  stages_: Schema.Array(StageRecordSchema),
  reportPath: Schema.optional(Schema.String),
  outputPath: Schema.optional(Schema.String),
})
export type Run = Schema.Schema.Type<typeof RunSchema>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FullRunState.NotFound", {
  runID: Schema.String,
}) {}

export class AlreadyRunningError extends Schema.TaggedErrorClass<AlreadyRunningError>()(
  "FullRunState.AlreadyRunning",
  {
    runID: Schema.String,
  },
) {}

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("FullRunState.Cancelled", {
  runID: Schema.String,
  stage: Schema.optional(StageName),
  reason: Schema.optional(Schema.String),
}) {}

export class StageFailedError extends Schema.TaggedErrorClass<StageFailedError>()("FullRunState.StageFailed", {
  runID: Schema.String,
  stage: Schema.optional(StageName),
  error: Schema.String,
}) {}

// Result of a stage execution. `resultPath` optionally points at an artifact
// the stage produced (plan markdown, review json, final report, etc.).
export interface StageResult {
  readonly status: "success" | "skipped"
  readonly resultPath?: string
}

// Executor invoked for each stage. Implementations wire the real services
// (recon, plan, agent loop, review, tests, security, docs, deploy). The
// runtime stays agnostic to what each stage does.
export type StageExecutor = (input: {
  runID: string
  sessionID: string
  messageID: string
  goal: string
  stage: StageName
  run: Run
}) => Effect.Effect<StageResult>

export interface Interface {
  readonly start: (input: {
    sessionID: string
    messageID: string
    goal: string
    stopLevel?: StopLevel
    stages?: ReadonlyArray<StageName>
    executor: StageExecutor
    messageIDGenerated?: string
  }) => Effect.Effect<Run, AlreadyRunningError>
  readonly cancel: (input: { runID: string; reason?: string }) => Effect.Effect<Run>
  readonly resume: (input: { runID: string; executor: StageExecutor }) => Effect.Effect<Run, NotFoundError>
  readonly get: (input: { runID: string }) => Effect.Effect<Run, NotFoundError>
  readonly status: (input: { runID: string }) => Effect.Effect<Run, NotFoundError>
  readonly runPath: (input: { runID: string; slug?: string }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/FullRunState") {}

const runPath = (sessionID: string, slug?: string) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const info = yield* Session.Service
    const session = yield* info.get(sessionID)
    const created = session.time?.created ?? Date.now()
    const usedSlug = slug ?? session.slug ?? sessionID
    return Session.fullrun({ slug: usedSlug, time: { created } }, instance)
  })

const readRun = (file: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) => cause,
    })
    return yield* Schema.decodeUnknown(RunSchema)(JSON.parse(text)).pipe(
      Effect.mapError(() => new NotFoundError({ runID: path.basename(file) })),
    )
  })

// Build a fresh run record from the requested stages, marking each as pending.
const freshRun = (input: {
  runID: string
  sessionID: string
  messageID: string
  goal: string
  stopLevel: StopLevel
  stages: ReadonlyArray<StageName>
}): Run => ({
  runID: input.runID,
  sessionID: input.sessionID,
  messageID: input.messageID,
  goal: input.goal,
  stopLevel: input.stopLevel,
  stages: [...input.stages],
  status: "queued",
  cancelled: false,
  stages_: input.stages.map((name) => ({
    name,
    status: "pending",
    attempts: 0,
  })),
})

// Walk the stage list until the stop boundary, executing each via `executor`.
// Persists the record between stages so progress survives a crash. Honors an
// in-flight cancellation flag and fails the whole run if a stage errors.
const executeStages = (run: Run, executor: StageExecutor, persist: (next: Run) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const stopAt = STOP_INDEX[run.stopLevel]
    let current = run

    current = { ...current, status: "running", startedAt: current.startedAt ?? now }
    yield* persist(current)

    for (const stage of current.stages) {
      const index = STAGE_INDEX[stage]
      const record = current.stages_.find((s) => s.name === stage)!
      if (record.status === "success" || record.status === "skipped") continue
      if (record.status === "cancelled") break

      current = { ...current, currentStage: stage }
      yield* persist(current)

      const updated = { ...record, status: "running" as const, startedAt: now, attempts: record.attempts + 1 }
      current = {
        ...current,
        stages_: current.stages_.map((s) => (s.name === stage ? updated : s)),
      }
      yield* persist(current)

      const result = yield* executor({
        runID: current.runID,
        sessionID: current.sessionID,
        messageID: current.messageID,
        goal: current.goal,
        stage,
        run: current,
      })

      const finished = yield* Clock.currentTimeMillis
      const done: StageRecord = {
        ...updated,
        status: result.status === "skipped" ? "skipped" : "success",
        finishedAt: finished,
        resultPath: result.resultPath,
      }
      current = {
        ...current,
        stages_: current.stages_.map((s) => (s.name === stage ? done : s)),
      }
      yield* persist(current)

      // Stop-level boundary: halt before starting the next stage.
      if (index >= stopAt - 1 && stopAt < STAGES.length) {
        current = { ...current, status: "partial", finishedAt: finished, currentStage: undefined }
        yield* persist(current)
        return current
      }
    }

    const finished = yield* Clock.currentTimeMillis
    const report = current.stages_.find((s) => s.name === "report")
    current = {
      ...current,
      status: current.cancelled ? "cancelled" : report && report.status === "success" ? "success" : "partial",
      finishedAt: finished,
      currentStage: undefined,
    }
    yield* persist(current)
    return current
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Record<string, string>>(Effect.succeed({} as Record<string, string>))

    const resolvePath = (sessionID: string, slug?: string) =>
      Effect.gen(function* () {
        const cached = yield* InstanceState.use(state, (map) => map[sessionID])
        if (cached) return cached
        return yield* runPath(sessionID, slug)
      })

    const persist = (sessionID: string, run: Run) =>
      Effect.gen(function* () {
        const target = yield* resolvePath(sessionID)
        yield* Effect.tryPromise({
          try: () => Bun.write(target, JSON.stringify(run, null, 2)),
          catch: (cause) => cause,
        })
        yield* InstanceState.useEffect(
          state,
          (map) =>
            Effect.sync(() => {
              map[sessionID] = target
            }),
        )
      })

    return Service.of({
      runPath: ({ runID, slug }) =>
        Effect.gen(function* () {
          // runID is derived from session+message in this runtime; resolve via session.
          const [sessionID] = runID.split(":")
          return yield* resolvePath(sessionID, slug)
        }),
      start: ({ sessionID, messageID, goal, stopLevel = "none", stages, executor }) =>
        Effect.gen(function* () {
          const info = yield* Session.Service
          const session = yield* info.get(sessionID)
          if (!session) return yield* new NotFoundError({ runID: sessionID })
          const runID = `${sessionID}:${messageID}`
          const ordered = stages ?? STAGES
          const run = freshRun({ runID, sessionID, messageID, goal, stopLevel, stages: ordered })
          yield* persist(sessionID, run)
          return yield* executeStages(run, executor, (next) => persist(sessionID, next))
        }),
      cancel: ({ runID, reason }) =>
        Effect.gen(function* () {
          const [sessionID] = runID.split(":")
          const target = yield* resolvePath(sessionID)
          const run = yield* readRun(target)
          if (run.status === "success" || run.status === "failed" || run.status === "cancelled") return run
          const now = yield* Clock.currentTimeMillis
          const cancelled: Run = {
            ...run,
            cancelled: true,
            cancelReason: reason,
            status: "cancelled",
            finishedAt: run.finishedAt ?? now,
            currentStage: undefined,
            stages_: run.stages_.map((s) =>
              s.status === "running" || s.status === "pending"
                ? { ...s, status: "cancelled" as const, finishedAt: now }
                : s,
            ),
          }
          yield* persist(sessionID, cancelled)
          return cancelled
        }),
      resume: ({ runID, executor }) =>
        Effect.gen(function* () {
          const resolved = yield* resolvePath(runID.split(":")[0])
          const run = yield* readRun(resolved)
          if (run.cancelled) {
            return yield* new CancelledError({ runID, reason: run.cancelReason })
          }
          if (run.status === "success") return run
          return yield* executeStages(run, executor, (next) => persist(run.sessionID, next))
        }),
      get: ({ runID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(runID.split(":")[0])
          return yield* readRun(target)
        }),
      status: ({ runID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(runID.split(":")[0])
          return yield* readRun(target)
        }),
    })
  }),
)

export * as FullRunState from "./state"
