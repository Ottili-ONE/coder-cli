export * as BackgroundJob from "./background-job"

import { Cause, Clock, Config, Context, Data, Deferred, Effect, Exit, Layer, Scope, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  /** Correlation id assigned at start; stable across retries of the same logical job. */
  correlation_id: string
  /** Number of times the job (or its segments) has been executed. 1 for the initial run. */
  attempt: number
  /** Wall-clock milliseconds the job ran before settling. Undefined while running. */
  duration_ms?: number
}

/** Tunable, process-wide bounds for the background job registry. */
export type Bounds = {
  /** Max concurrently running jobs. Starts beyond this are rejected. */
  readonly maxRunning: number
  /** Max pending work segments per job. Extends beyond this are rejected. */
  readonly maxPending: number
  /** Default per-segment run timeout in ms (0 disables). */
  readonly timeoutMs: number
  /** Hard cap on retained job records to bound memory. */
  readonly maxRetained: number
}

const defaultBounds: Bounds = {
  maxRunning: 64,
  maxPending: 16,
  timeoutMs: 0,
  maxRetained: 1024,
}

const boundsConfig = Config.all({
  maxRunning: Config.number("OTTILI_BACKGROUND_MAX_RUNNING").pipe(Config.withDefault(defaultBounds.maxRunning)),
  maxPending: Config.number("OTTILI_BACKGROUND_MAX_PENDING").pipe(Config.withDefault(defaultBounds.maxPending)),
  timeoutMs: Config.number("OTTILI_BACKGROUND_TIMEOUT_MS").pipe(Config.withDefault(defaultBounds.timeoutMs)),
  maxRetained: Config.number("OTTILI_BACKGROUND_MAX_RETAINED").pipe(Config.withDefault(defaultBounds.maxRetained)),
}).pipe(
  Config.map((raw) => ({
    maxRunning: Math.max(1, Math.floor(raw.maxRunning)),
    maxPending: Math.max(1, Math.floor(raw.maxPending)),
    timeoutMs: Math.max(0, Math.floor(raw.timeoutMs)),
    maxRetained: Math.max(1, Math.floor(raw.maxRetained)),
  })),
)

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  pending: number
  next: number
  output?: { sequence: number; text: string }
  tail: Deferred.Deferred<void>
  promoted: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
  correlationId: string
  startedAt: number
  timeoutMs: number
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
  bounds: Bounds
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
}

type PromoteResult = {
  info?: Info
  promoted?: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
}

type StartResult = { info: Info } | { info: Info; scope: Scope.Closeable; token: object; timeoutMs: number }

type ExtendResult =
  | { extended: false }
  | {
      extended: true
      previous: Deferred.Deferred<void>
      scope: Scope.Closeable
      tail: Deferred.Deferred<void>
      token: object
      sequence: number
      timeoutMs: number
    }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  onPromote?: Effect.Effect<void>
  run: Effect.Effect<string, unknown>
  /** Optional per-start run timeout in ms, overriding the configured default. */
  timeoutMs?: number
  /** Optional correlation id to group retries of one logical job. */
  correlationId?: string
}

export type ExtendInput = {
  id: string
  run: Effect.Effect<string, unknown>
  /** Optional per-extend run timeout in ms, overriding the configured default. */
  timeoutMs?: number
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/BackgroundJob") {}

export class BackgroundJobCapacityError extends Data.TaggedError("BackgroundJobCapacityError")<{
  readonly reason: "max_running" | "max_pending" | "max_retained"
  readonly detail: string
}> {}

/** Patterns that reveal credentials or tokens; matched case-insensitively. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ••••"],
  [/\b(token|secret|api[_-]?key|password|passwd|access[_-]?key|private[_-]?key)-[A-Za-z0-9_-]{6,}/gi, "$1-••••"],
  [/(sk|pk|rk|tk)-[A-Za-z0-9_-]{8,}/gi, (m) => `${m.slice(0, 6)}••••`],
  [
    /(token|secret|api[_-]?key|password|passwd|access[_-]?key|authorization|bearer)\s*[=:]\s*\S+/gi,
    (m) => (/[=:]\s*$/.test(m) ? m : m.replace(/\S+$/, "••••")),
  ],
  [/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "••••.••••.••••"],
]

/** Redacts credential-shaped substrings so logs/observations never leak secrets. */
export function redactSecrets(text: string | undefined): string | undefined {
  if (text === undefined || text === null) return text
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement as string)
  }
  return out
}

/** Deep-redacts known secret-bearing values in a metadata record without mutating the input. */
function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return metadata
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (/secret|token|password|apikey|api_key|credential|key/i.test(key) && typeof value === "string") {
      const redacted = redactSecrets(value)
      out[key] = redacted === undefined ? value : redacted
    } else {
      out[key] = value
    }
  }
  return out
}

function snapshot(job: Active): Info {
  const info = job.info
  return {
    ...info,
    title: redactSecrets(info.title),
    output: redactSecrets(info.output),
    error: redactSecrets(info.error),
    metadata: redactMetadata(info.metadata),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Applies a per-segment timeout that interrupts the work but keeps the job
 * record inspectable. A timed-out foreground segment is reported as an error
 * rather than silently cancelled so observers can distinguish the two.
 */
function withSegmentTimeout(scope: Scope.Scope, timeoutMs: number, run: Effect.Effect<string, unknown>) {
  if (timeoutMs <= 0) return run
  return run.pipe(
    Effect.timeoutFail({
      duration: timeoutMs,
      onTimeout: () => new Error(`background job segment exceeded ${timeoutMs}ms timeout`),
    }),
    Effect.ensuring(Effect.ignore),
  )
}

/**
 * Makes one scoped, process-local registry. Entries are intentionally not
 * durable: process restart or owner-scope closure loses status and interrupts
 * live work. Persisted observation, restart recovery, and remote workers need a
 * separate durable ownership slice rather than pretending this registry has
 * those semantics.
 */
export const make = Effect.gen(function* () {
  const bounds = yield* ConfigProvider.fromEnv().pipe(ConfigProvider.load(boundsConfig), Effect.orElseSucceed(() => defaultBounds))
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
    bounds,
  }

  const countRunning = (jobs: Map<string, Active>) => {
    let n = 0
    for (const job of jobs.values()) if (job.info.status === "running") n++
    return n
  }

  const settle = Effect.fn("BackgroundJob.settle")(function* (
    id: string,
    token: object,
    sequence: number,
    exit: Exit.Exit<string, unknown>,
  ) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.token !== token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const pending = job.pending - 1
      const output =
        Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
          ? { sequence, text: exit.value }
          : job.output
      if (Exit.isSuccess(exit) && pending > 0) {
        return [{}, new Map(jobs).set(id, { ...job, pending, output })]
      }
      const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
        ? "completed"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "cancelled"
          : "error"
      const duration_ms = completed_at - job.startedAt
      const next = {
        ...job,
        onPromote: undefined,
        pending: 0,
        output,
        info: {
          ...job.info,
          status,
          completed_at,
          duration_ms,
          ...(output ? { output: output.text } : {}),
          ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
        },
      }
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    if (result.info) {
      yield* Effect.logInfo("background job settled").pipe(
        Effect.annotateLogs({
          id,
          correlation_id: result.info.correlation_id,
          type: result.info.type,
          status: result.info.status,
          attempt: result.info.attempt,
          duration_ms: result.info.duration_ms ?? 0,
          error: result.info.error ? "present" : "none",
        }),
        Effect.ignore,
      )
    }
    return result.info
  })

  const fork = Effect.fn("BackgroundJob.fork")(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    sequence: number,
    run: Effect.Effect<string, unknown>,
    timeoutMs: number,
  ) {
    return yield* withSegmentTimeout(scope, timeoutMs, run).pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => settle(id, token, sequence, Exit.succeed(output)),
        onFailure: (cause) => settle(id, token, sequence, Exit.failCause(cause)),
      }),
      Effect.asVoid,
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
    return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
      .map(snapshot)
      .toSorted((a, b) => a.started_at - b.started_at)
  })

  const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return
    return snapshot(job)
  })

  const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? Identifier.ascending("job")
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const promoted = yield* Deferred.make<Info>()
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartResult, Map<string, Active>]
            }
            if (existing && existing.info.status !== "running" && input.id === undefined) {
              // auto-id collisions on a finished job: regenerate to avoid overwrite
            }
            if (countRunning(jobs) >= state.bounds.maxRunning) {
              return [
                { error: new BackgroundJobCapacityError({ reason: "max_running", detail: `max ${state.bounds.maxRunning} running` }) } as unknown as StartResult,
                jobs,
              ] as readonly [StartResult, Map<string, Active>]
            }
            if (jobs.size >= state.bounds.maxRetained) {
              return [
                { error: new BackgroundJobCapacityError({ reason: "max_retained", detail: `max ${state.bounds.maxRetained} retained` }) } as unknown as StartResult,
                jobs,
              ] as readonly [StartResult, Map<string, Active>]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const token = {}
            const correlationId = input.correlationId ?? id
            const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : state.bounds.timeoutMs
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
                correlation_id: correlationId,
                attempt: 1,
              },
              done,
              scope,
              token,
              pending: 1,
              next: 1,
              tail,
              promoted,
              onPromote: input.onPromote,
              correlationId,
              startedAt: started_at,
              timeoutMs,
            }
            return [{ info: snapshot(job), scope, token, timeoutMs }, new Map(jobs).set(id, job)] as readonly [
              StartResult,
              Map<string, Active>,
            ]
          }),
        )
        if ("error" in result && result.error) return yield* Effect.fail(result.error)
        if ("scope" in result) {
          yield* Effect.logInfo("background job started").pipe(
            Effect.annotateLogs({
              id,
              correlation_id: result.info.correlation_id,
              type: result.info.type,
              attempt: result.info.attempt,
            }),
            Effect.ignore,
          )
          yield* fork(
            result.scope,
            id,
            result.token,
            0,
            restore(input.run).pipe(Effect.ensuring(Deferred.succeed(tail, undefined))),
            result.timeoutMs,
          )
        }
        return result.info
      }),
    )
  })

  const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [ExtendResult, Map<string, Active>] => {
            const job = jobs.get(input.id)
            if (!job || job.info.status !== "running") return [{ extended: false }, jobs]
            if (job.pending >= state.bounds.maxPending) {
              return [{ extended: false }, jobs]
            }
            const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : job.timeoutMs
            return [
              { extended: true, previous: job.tail, scope: job.scope, tail, token: job.token, sequence: job.next, timeoutMs },
              new Map(jobs).set(input.id, {
                ...job,
                pending: job.pending + 1,
                next: job.next + 1,
                tail,
                info: { ...job.info, attempt: job.info.attempt + 1 },
              }),
            ]
          },
        )
        if (!result.extended) return false
        yield* fork(
          result.scope,
          input.id,
          result.token,
          result.sequence,
          Deferred.await(result.previous).pipe(
            Effect.andThen(restore(input.run)),
            Effect.ensuring(Deferred.succeed(result.tail, undefined)),
          ),
          result.timeoutMs,
        )
        return true
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
    if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
    if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
    const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
    if (info._tag === "Some") return { info: info.value, timedOut: false }
    return { info: snapshot(job), timedOut: true }
  })

  const waitForPromotion: Interface["waitForPromotion"] = Effect.fn("BackgroundJob.waitForPromotion")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job || job.info.status !== "running") return yield* Effect.never
    if (job.info.metadata?.background === true) return snapshot(job)
    return yield* Deferred.await(job.promoted)
  })

  const promote: Interface["promote"] = Effect.fn("BackgroundJob.promote")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs) {
        const job = jobs.get(id)
        if (!job || job.info.status !== "running") return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
        if (job.info.metadata?.background === true)
          return [{ info: snapshot(job) }, jobs] as readonly [PromoteResult, Map<string, Active>]
        const next = {
          ...job,
          onPromote: undefined,
          info: {
            ...job.info,
            metadata: { ...job.info.metadata, background: true },
          },
        }
        return [
          { info: snapshot(next), onPromote: job.onPromote, promoted: job.promoted },
          new Map(jobs).set(id, next),
        ] as readonly [PromoteResult, Map<string, Active>]
      }),
    )
    if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
    if (result.onPromote) yield* result.onPromote.pipe(Effect.ignore)
    return result.info
  })

  const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const duration_ms = completed_at - job.startedAt
      const next = {
        ...job,
        onPromote: undefined,
        pending: 0,
        info: {
          ...job.info,
          status: "cancelled" as const,
          completed_at,
          duration_ms,
        },
      }
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    if (result.info) {
      yield* Effect.logInfo("background job cancelled").pipe(
        Effect.annotateLogs({ id, correlation_id: result.info.correlation_id, type: result.info.type, attempt: result.info.attempt }),
        Effect.ignore,
      )
    }
    return result.info
  })

  return Service.of({ list, get, start, extend, wait, waitForPromotion, promote, cancel })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer
