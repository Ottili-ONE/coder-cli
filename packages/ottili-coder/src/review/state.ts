import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"

const FindingSchema = Schema.Struct({
  severity: Schema.Literals(["critical", "high", "medium", "low", "info"]),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  message: Schema.String,
})
export type Finding = Schema.Schema.Type<typeof FindingSchema>

const ReviewSchema = Schema.Struct({
  target: Schema.String,
  scope: Schema.Literals(["uncommitted", "commit", "branch", "pr"]),
  status: Schema.Literals(["queued", "running", "success", "failed"]),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  resultPath: Schema.optional(Schema.String),
  findings: Schema.optional(Schema.Array(FindingSchema)),
  approved: Schema.optional(Schema.Boolean),
})
export type Review = Schema.Schema.Type<typeof ReviewSchema>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ReviewState.NotFound", {
  sessionID: Schema.String,
}) {}

export interface Interface {
  readonly write: (input: { sessionID: string; review: Review; slug?: string }) => Effect.Effect<{ path: string }>
  readonly read: (input: { sessionID: string }) => Effect.Effect<Review, NotFoundError>
  readonly path: (input: { sessionID: string; slug?: string }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/ReviewState") {}

const reviewPath = (sessionID: string, slug?: string) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const info = yield* Session.Service
    const session = yield* info.get(sessionID)
    const created = session.time?.created ?? Date.now()
    const usedSlug = slug ?? session.slug ?? sessionID
    return Session.review({ slug: usedSlug, time: { created } }, instance)
  })

const readReview = (file: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) => cause,
    })
    return yield* Schema.decodeUnknown(ReviewSchema)(JSON.parse(text)).pipe(
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
        return yield* reviewPath(sessionID, slug)
      })

    return Service.of({
      path: ({ sessionID, slug }) => resolvePath(sessionID, slug),
      write: ({ sessionID, review, slug }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID, slug)
          yield* Effect.tryPromise({
            try: () => Bun.write(target, JSON.stringify(review, null, 2)),
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
          return yield* readReview(target)
        }),
    })
  }),
)

export * as ReviewState from "./state"
