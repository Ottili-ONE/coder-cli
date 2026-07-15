import { Effect, Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID, MessageID } from "@/session/schema"
import { Command } from "@/command"
import { MessageV2 } from "@/session/message-v2"
import { ReviewState } from "./state"
import { ReviewEvent } from "./event"

const Severities = ["critical", "high", "medium", "low", "info"] as const

const ScopeSchema = Schema.Literals(["uncommitted", "commit", "branch", "pr"])

function resolveScope(arguments_: string): (typeof Severities)[number] extends never ? never : "uncommitted" | "commit" | "branch" | "pr" {
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
  scope: "uncommitted" | "commit" | "branch" | "pr"
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
  readonly review: (input: { sessionID: SessionID; messageID: MessageID; target: string; arguments: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/ReviewAssistant") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const message = yield* MessageV2.Service

    const active = yield* InstanceState.make<Record<string, ActiveReview>>(Effect.succeed({}))

    const key = (sessionID: SessionID, messageID: MessageID) => `${sessionID}:${messageID}`

    const publishStart = Effect.fn("ReviewAssistant.publishStart")(function* (review: ActiveReview) {
      yield* events.publish(ReviewEvent.Start, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        target: review.target,
        scope: review.scope,
      })
      yield* ReviewState.Service.write({
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
      const msg = yield* message.get({ sessionID: review.sessionID, messageID: review.messageID }).pipe(Effect.either)
      const text = msg.pipe(
        Effect.match({
          onLeft: () => "",
          onRight: (m) =>
            m.parts
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
        }),
      )
      const findings = parseFindings(text)
      const resultPath = yield* ReviewState.Service.path({ sessionID: review.sessionID }).pipe(Effect.orUndefined)
      yield* events.publish(ReviewEvent.Complete, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        ...(resultPath ? { resultPath } : {}),
        ...(findings.length ? { findings: findings.length } : {}),
      })
      yield* ReviewState.Service.write({
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
      yield* events.publish(ReviewEvent.Error, {
        sessionID: review.sessionID,
        messageID: review.messageID,
        error,
      })
      yield* ReviewState.Service.write({
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

    const unsubscribe = yield* events.listen((event) => {
      if (event.type === Command.Event.Executed.type) {
        const data = event.data as EventV2.Data<typeof Command.Event.Executed>
        if (data.name !== Command.Default.REVIEW) return Effect.void
        const scope = resolveScope(data.arguments)
        const target = data.arguments?.trim() || "uncommitted changes"
        return track({
          sessionID: data.sessionID,
          messageID: data.messageID,
          target,
          scope,
          startedAt: Date.now(),
        })
      }

      if (event.type === "message.updated") {
        const data = event.data as EventV2.Data<typeof EventV2.unknown> & {
          sessionID: SessionID
          info: { role: string; time?: { completed?: number }; error?: unknown }
        }
        if (data.info.role !== "assistant" || !data.info.time?.completed) return Effect.void
        return InstanceState.use(active, (map) => map[key(data.sessionID, data.info.id as MessageID)]).pipe(
          Effect.flatMap((review) =>
            review ? publishComplete(review) : Effect.void,
          ),
        )
      }

      if (event.type === "session.error") {
        const data = event.data as EventV2.Data<typeof EventV2.unknown> & { sessionID?: SessionID; error?: unknown }
        if (!data.sessionID || !data.error) return Effect.void
        const review = yield* InstanceState.use(active, (map) =>
          Object.values(map).find((review) => review.sessionID === data.sessionID),
        )
        if (!review) return Effect.void
        const error = typeof data.error === "string" ? data.error : JSON.stringify(data.error)
        return publishError(review, error)
      }

      if (event.type === "permission.asked") {
        const data = event.data as EventV2.Data<typeof EventV2.unknown> & {
          sessionID?: SessionID
          id?: string
          permission?: string
          patterns?: string[]
        }
        if (!data.sessionID) return Effect.void
        const review = yield* InstanceState.use(active, (map) =>
          Object.values(map).find((review) => review.sessionID === data.sessionID),
        )
        if (!review) return Effect.void
        return events.publish(ReviewEvent.Approval, {
          sessionID: review.sessionID,
          messageID: review.messageID,
          tool: data.permission ?? "unknown",
          allowed: false,
        })
      }

      if (event.type === "permission.reply") {
        const data = event.data as EventV2.Data<typeof EventV2.unknown> & {
          sessionID?: SessionID
          requestID?: string
          reply?: string
        }
        if (!data.sessionID) return Effect.void
        const review = yield* InstanceState.use(active, (map) =>
          Object.values(map).find((review) => review.sessionID === data.sessionID),
        )
        if (!review) return Effect.void
        return events.publish(ReviewEvent.Approval, {
          sessionID: review.sessionID,
          messageID: review.messageID,
          tool: data.requestID ?? "unknown",
          allowed: data.reply === "always" || data.reply === "once",
        })
      }

      return Effect.void
    })

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

export * as ReviewAssistant from "."
