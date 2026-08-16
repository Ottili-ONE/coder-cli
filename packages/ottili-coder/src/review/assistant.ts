import { Context, Effect, Layer, Option } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID, MessageID } from "@/session/schema"
import { Command } from "@/command"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { Permission } from "@/permission"
import { ReviewState } from "./state"
import { ReviewEvent } from "./event"

const Severities = ["critical", "high", "medium", "low", "info"] as const

type Scope = "uncommitted" | "commit" | "branch" | "pr"

function resolveScope(arguments_: string): Scope {
  const arg = (arguments_ ?? "").trim().toLowerCase()
  if (arg.startsWith("pr") || arg.includes("pull") || /^\d+$/.test(arg)) return "pr"
  if (arg.startsWith("commit") || /^[0-9a-f]{6,40}$/i.test(arg)) return "commit"
  if (arg.startsWith("branch")) return "branch"
  return "uncommitted"
}

interface ActiveReview {
  sessionID: SessionID
  messageID: MessageID
  target: string
  scope: Scope
  startedAt: number
}

const linePattern = new RegExp(
  `^(?:\\s*(?:[-*]\\s*)?)?\\*\\*(?<severity>${Severities.join("|")})\\*\\*\\s*` +
    "(?:(?<file>[^:]+?):(?<line>\\d+):?\\s*)?" +
    "(?::\\s*)?(?<message>.*)$",
  "i",
)

function parseFindings(text: string) {
  const findings: Array<{
    severity: (typeof Severities)[number]
    file?: string
    line?: number
    message: string
  }> = []
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.match(linePattern)
    if (!match?.groups) continue
    const severity = match.groups.severity.toLowerCase() as (typeof Severities)[number]
    if (!Severities.includes(severity)) continue
    const file = match.groups.file?.trim()
    const line = match.groups.line ? Number(match.groups.line) : undefined
    const message = match.groups.message?.trim()
    if (!message) continue
    findings.push({
      severity,
      ...(file ? { file } : {}),
      ...(line !== undefined ? { line } : {}),
      message,
    })
  }
  return findings
}

export interface Interface {
  readonly review: (input: {
    sessionID: SessionID
    messageID: MessageID
    target: string
    arguments: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/ReviewAssistant") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* ReviewState.Service
    const database = yield* Database.Service

    const active = yield* InstanceState.make<Record<string, ActiveReview>>(() => Effect.succeed({}))

    const key = (sessionID: SessionID, messageID: MessageID) => `${sessionID}:${messageID}`

    const publishStart = Effect.fn("ReviewAssistant.publishStart")(function* (review: ActiveReview) {
      yield* events.publish(ReviewEvent.Event.Start, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        target: review.target,
        scope: review.scope,
      })
      yield* state.write({
        sessionID: review.sessionID,
        review: {
          target: review.target,
          scope: review.scope,
          status: "running",
          startedAt: review.startedAt,
        },
      })
    })

    const publishComplete = Effect.fn("ReviewAssistant.publishComplete")(function* (review: ActiveReview) {
      const message = yield* MessageV2.get({ sessionID: review.sessionID, messageID: review.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.option,
      )
      const text = Option.match(message, {
        onNone: () => "",
        onSome: (found) =>
          found.parts
            .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
      })
      const findings = parseFindings(text)
      const resultPath = yield* state.path({ sessionID: review.sessionID })
      yield* events.publish(ReviewEvent.Event.Complete, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        ...(resultPath ? { resultPath } : {}),
        ...(findings.length ? { findings: findings.length } : {}),
      })
      yield* state.write({
        sessionID: review.sessionID,
        review: {
          target: review.target,
          scope: review.scope,
          status: "success",
          startedAt: review.startedAt,
          finishedAt: Date.now(),
          ...(resultPath ? { resultPath } : {}),
          ...(findings.length ? { findings } : {}),
        },
      })
    })

    const publishError = Effect.fn("ReviewAssistant.publishError")(function* (review: ActiveReview, error: string) {
      yield* events.publish(ReviewEvent.Event.Error, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        error,
      })
      yield* state.write({
        sessionID: review.sessionID,
        review: {
          target: review.target,
          scope: review.scope,
          status: "failed",
          startedAt: review.startedAt,
          finishedAt: Date.now(),
          error,
        },
      })
    })

    const track = Effect.fn("ReviewAssistant.track")(function* (review: ActiveReview) {
      yield* InstanceState.useEffect(active, (map) => {
        map[key(review.sessionID, review.messageID)] = review
        return Effect.void
      })
      yield* publishStart(review)
    })

    const findBySession = (sessionID: SessionID) =>
      InstanceState.use(active, (map) => Object.values(map).find((review) => review.sessionID === sessionID))

    const handle = (event: EventV2.Payload): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (event.type === Command.Event.Executed.type) {
          const data = event.data as EventV2.Data<typeof Command.Event.Executed>
          if (data.name !== Command.Default.REVIEW) return
          yield* track({
            sessionID: data.sessionID,
            messageID: data.messageID,
            target: data.arguments?.trim() || "uncommitted changes",
            scope: resolveScope(data.arguments),
            startedAt: Date.now(),
          })
          return
        }

        if (event.type === MessageV2.Event.Updated.type) {
          const data = event.data as EventV2.Data<typeof MessageV2.Event.Updated>
          if (data.info.role !== "assistant" || !data.info.time?.completed) return
          const review = yield* InstanceState.use(active, (map) => map[key(data.sessionID, data.info.id)])
          if (!review) return
          yield* publishComplete(review)
          return
        }

        if (event.type === Session.Event.Error.type) {
          const data = event.data as EventV2.Data<typeof Session.Event.Error>
          if (!data.sessionID || !data.error) return
          const review = yield* findBySession(data.sessionID)
          if (!review) return
          const error = typeof data.error === "string" ? data.error : JSON.stringify(data.error)
          yield* publishError(review, error)
          return
        }

        if (event.type === Permission.Event.Asked.type) {
          const data = event.data as EventV2.Data<typeof Permission.Event.Asked>
          if (!data.sessionID) return
          const review = yield* findBySession(data.sessionID)
          if (!review) return
          yield* events.publish(ReviewEvent.Event.Approval, {
            sessionID: review.sessionID,
            messageID: review.messageID,
            tool: data.permission ?? "unknown",
            allowed: false,
          })
          return
        }

        if (event.type === Permission.Event.Replied.type) {
          const data = event.data as EventV2.Data<typeof Permission.Event.Replied>
          if (!data.sessionID) return
          const review = yield* findBySession(data.sessionID)
          if (!review) return
          yield* events.publish(ReviewEvent.Event.Approval, {
            sessionID: review.sessionID,
            messageID: review.messageID,
            tool: data.requestID ?? "unknown",
            allowed: data.reply === "always" || data.reply === "once",
          })
        }
      })

    const unsubscribe = yield* events.listen(handle)

    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({
      review: ({ sessionID, messageID, target, arguments: arguments_ }) =>
        track({
          sessionID,
          messageID,
          target: target || arguments_?.trim() || "uncommitted changes",
          scope: resolveScope(arguments_ ?? ""),
          startedAt: Date.now(),
        }),
    })
  }),
)

export * as ReviewAssistant from "./assistant"
