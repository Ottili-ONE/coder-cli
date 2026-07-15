import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"

const BuildSchema = Schema.Struct({
  goal: Schema.String,
  steps: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.Literals(["queued", "running", "success", "failed"]),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  resultPath: Schema.optional(Schema.String),
})
export type Build = Schema.Schema.Type<typeof BuildSchema>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("BuildState.NotFound", {
  sessionID: Schema.String,
}) {}

export interface Interface {
  readonly write: (input: { sessionID: string; build: Build; slug?: string }) => Effect.Effect<{ path: string }>
  readonly read: (input: { sessionID: string }) => Effect.Effect<Build, NotFoundError>
  readonly path: (input: { sessionID: string; slug?: string }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/BuildState") {}

const buildPath = (sessionID: string, slug?: string) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const info = yield* Session.Service
    const session = yield* info.get(sessionID)
    const created = session.time?.created ?? Date.now()
    const usedSlug = slug ?? session.slug ?? sessionID
    return Session.build({ slug: usedSlug, time: { created } }, instance)
  })

const readBuild = (file: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) => cause,
    })
    return yield* Schema.decodeUnknown(BuildSchema)(JSON.parse(text)).pipe(
      Effect.mapError(() => new NotFoundError({ sessionID: "unknown" })),
    )
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Record<string, string>>(Effect.succeed({} as Record<string, string>))

    const resolvePath = (sessionID: string, slug?: string) =>
      Effect.gen(function* () {
        const cached = yield* InstanceState.use(state, (map) => map[sessionID])
        if (cached) return cached
        return yield* buildPath(sessionID, slug)
      })

    return Service.of({
      path: ({ sessionID, slug }) => resolvePath(sessionID, slug),
      write: ({ sessionID, build, slug }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID, slug)
          yield* Effect.tryPromise({
            try: () => Bun.write(target, JSON.stringify(build, null, 2)),
            catch: (cause) => cause,
          })
          yield* InstanceState.useEffect(
            state,
            (map) =>
              Effect.sync(() => {
                map[sessionID] = target
              }),
          )
          return { path: target }
        }),
      read: ({ sessionID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID)
          return yield* readBuild(target)
        }),
    })
  }),
)

export * as BuildState from "./state"
