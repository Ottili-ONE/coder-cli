import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import * as OttiliAuto from "@/provider/ottili-auto"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Effect, Layer, Context } from "effect"
import * as DateTime from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2 } from "@opencode-ai/core/event"
import { buildPrompt } from "@opencode-ai/core/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { MutableHashMap } from "effect"

export const Event = {
  Compacted: EventV2.define({
    type: "session.compacted",
    schema: {
      sessionID: SessionID,
    },
  }),
}

// JSON/headless output for compaction status is versioned so headless
// consumers can detect and adapt to wire-shape changes without breaking.
export const CompactionOutputVersion = "1" as const

export const CompactionReason = Schema.Literals("auto", "manual", "overflow", "command")
export type CompactionReason = Schema.Schema.Type<typeof CompactionReason>

export const CompactionKeep = Schema.Struct({
  tokens: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Override: max recent tokens preserved verbatim (maps to keep.tokens)",
  }),
  turns: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Override: recent user turns preserved verbatim (maps to keep.turns)",
  }),
}).annotate({
  identifier: "CompactionKeep",
  description: "Per-request overrides for the recent-context budget.",
})

// Service-level input contract for an explicit compaction request. Reuses the
// config schema (auto/prune/keep) as defaults and adds request-scoped flags.
export const CompactionInput = Schema.Struct({
  sessionID: SessionID,
  agent: Schema.String,
  model: Schema.Struct({
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  }),
  reason: CompactionReason.pipe(Schema.optional).annotate({
    description: "Why compaction was triggered; drives idempotency key and event reason.",
  }),
  auto: Schema.optional(Schema.Boolean).annotate({
    description: "Whether this compaction auto-continues the session afterwards (default: false).",
  }),
  keep: CompactionKeep.pipe(Schema.optional).annotate({
    description: "Per-request recent-context overrides; merged over config.compaction.keep.",
  }),
  // Idempotency: same key within a session is a no-op if a compaction is
  // already in flight or recently completed. Prevents duplicate work when a
  // client retries after a network/timeout error.
  idempotencyKey: Schema.String.pipe(Schema.optional).annotate({
    description: "Client-supplied idempotency key. Replays of the same key are coalesced.",
  }),
  // Cancellation: an explicit compaction request refuses to run while another
  // compaction owns the session (SessionBusyError -> HTTP 409). `force` opts
  // out of the conflict check for recovery/operator use only.
  force: Schema.optional(Schema.Boolean).annotate({
    description: "Skip the busy/session-ownership conflict check. Recovery/operator use only.",
  }),
  // Permissions: explicit compaction triggers the compaction agent which may
  // read tool history but never executes tools, so no tool permission prompt
  // is required. `respectPermissions` keeps this explicit at the boundary.
  respectPermissions: Schema.optional(Schema.Boolean).annotate({
    description: "Honor permission rules for compaction context gathering (default: true).",
  }),
}).annotate({
  identifier: "CompactionInput",
  description: "Request contract for an explicit context compaction.",
})
export type CompactionInput = Schema.Schema.Type<typeof CompactionInput>

export const CompactionState = Schema.Literals("idle", "pending", "running", "completed", "failed")
export type CompactionState = Schema.Schema.Type<typeof CompactionState>

// Versioned, headless-friendly status payload returned by session.compaction_status
// and emitted on completion. Designed for JSON output consumers.
export const CompactionStatus = Schema.Struct({
  version: Schema.Literal(CompactionOutputVersion).annotate({
    description: "Output schema version for headless/JSON consumers.",
  }),
  sessionID: SessionID,
  state: CompactionState,
  reason: CompactionReason.pipe(Schema.optional),
  messageID: MessageID.pipe(Schema.optional).annotate({
    description: "The compaction user-message ID once a request is admitted.",
  }),
  summaryMessageID: MessageID.pipe(Schema.optional).annotate({
    description: "The assistant summary message ID once compaction completes.",
  }),
  tailStartID: MessageID.pipe(Schema.optional).annotate({
    description: "First message ID kept verbatim after compaction (source-linked boundary).",
  }),
  prunedParts: Schema.Number.pipe(Schema.optional).annotate({
    description: "Count of tool-output parts pruned to reclaim context (source-linked).",
  }),
  preservedDecisions: Schema.Number.pipe(Schema.optional).annotate({
    description: "Count of decision/failure/unresolved markers preserved in the summary (T-CLI-0331 outcome).",
  }),
  idempotencyKey: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  updatedAt: Schema.Number,
}).annotate({
  identifier: "CompactionStatus",
  description: "Versioned headless status for the context compaction engine.",
})
export type CompactionStatus = Schema.Schema.Type<typeof CompactionStatus>

export const COMPACTION_EXIT_CODES = {
  success: 0,
  cancelled: 130,
  busy: 1,
  invalidInput: 2,
  notFound: 3,
  permissionDenied: 4,
  internalError: 5,
} as const

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
  // Admission + status contract for explicit compaction requests. Tracks
  // in-flight requests per session for idempotency and cancellation, and
  // reports versioned headless status.
  readonly request: (input: CompactionInput) => Effect.Effect<CompactionStatus>
  readonly status: (input: { sessionID: SessionID }) => Effect.Effect<CompactionStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/SessionCompaction") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns ?? DEFAULT_TAIL_TURNS
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: 1 },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      let executionProviderID = userMessage.model.providerID
      let executionModelID = userMessage.model.modelID
      if (OttiliAuto.isOttiliAutoModel(executionProviderID, executionModelID)) {
        const autoProvider = yield* provider.getProvider(ProviderV2.ID.make("ottili-auto")).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
        const resolved = yield* Effect.tryPromise({
          try: () =>
            OttiliAuto.resolveExecutionTarget(
              {
                agent: userMessage.agent,
                userText: OttiliAuto.extractLatestUserText(messages),
                assistantText: OttiliAuto.extractLatestAssistantText(messages),
              },
              { apiKey: autoProvider?.key },
            ),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(
          Effect.catchAll(() =>
            Effect.sync(() =>
              OttiliAuto.resolveExecutionTargetSync({
                agent: userMessage.agent,
                userText: OttiliAuto.extractLatestUserText(messages),
                assistantText: OttiliAuto.extractLatestAssistantText(messages),
              }),
            ),
          ),
        )
        executionProviderID = resolved.providerID
        executionModelID = resolved.modelID
      }
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(executionProviderID, executionModelID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const nextPrompt = compacting.prompt ?? buildPrompt({ previousSummary, context: compacting.context })
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      const tailIndex = selected.tail_start_id
        ? history.findIndex((message) => message.info.id === selected.tail_start_id)
        : -1
      const recent =
        tailIndex < 0
          ? ""
          : JSON.stringify(
              yield* MessageV2.toModelMessagesEffect(history.slice(tailIndex), model, {
                stripMedia: true,
                toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
              }),
            )
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      const result = yield* processor.process({
        user: userMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [
          ...modelMessages,
          {
            role: "user",
            content: [{ type: "text", text: nextPrompt }],
          },
        ],
        model,
      })

      if (result === "compact") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider.getModel(model.providerID, model.id).pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) return "stop"
      if (result === "continue") {
        const summary = summaryText(
          (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
            (item) => item.info.id === msg.id,
          ) ?? {
            info: msg,
            parts: [],
          },
        )
        if (flags.experimentalEventSystem) {
          if (summary)
            yield* events.publish(SessionEvent.Compaction.Ended, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.make(input.parentID),
              timestamp: DateTime.makeUnsafe(Date.now()),
              reason: input.auto ? "auto" : "manual",
              text: summary ?? "",
              recent,
            })
        }
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.make(msg.id),
          timestamp: DateTime.makeUnsafe(Date.now()),
          reason: input.auto ? "auto" : "manual",
        })
      }
    })

    // Per-session in-flight status registry. Drives idempotency,
    // cancellation (busy) and headless status reporting.
    const registry = MutableHashMap.empty<SessionID, CompactionStatus>()

    const store = Effect.fnUntraced(function store(status: CompactionStatus) {
      MutableHashMap.set(registry, status.sessionID, status)
      return status
    })

    const current = Effect.fnUntraced(function current(sessionID: SessionID) {
      return MutableHashMap.get(registry, sessionID)
    })

    const request = Effect.fn("SessionCompaction.request")(function* (input: CompactionInput) {
      const now = Date.now()
      // Cancellation / conflict: refuse to start a second compaction while one
      // owns the session unless explicitly forced (recovery/operator use).
      const existing = yield* current(input.sessionID)
      if (existing && (existing.state === "running" || existing.state === "pending")) {
        if (input.force) {
          yield* Effect.logWarning("compaction conflict overridden by force", { sessionID: input.sessionID })
        } else if (input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey) {
          return existing
        } else {
          return store({
            ...existing,
            error: "session already has an in-flight compaction",
            updatedAt: now,
          })
        }
      }
      // Idempotency: replays of a completed key are no-ops.
      if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) {
        return existing
      }

      const message = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: now },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: message.id,
        sessionID: input.sessionID,
        type: "compaction",
        auto: input.auto ?? false,
        overflow: input.reason === "overflow",
      })
      const admitted = store({
        version: CompactionOutputVersion,
        sessionID: input.sessionID,
        state: "pending",
        reason: input.reason,
        messageID: message.id,
        idempotencyKey: input.idempotencyKey,
        updatedAt: now,
      })
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.make(message.id),
          timestamp: DateTime.makeUnsafe(now),
          reason: (input.reason ?? (input.auto ? "auto" : "manual")) as "auto" | "manual",
        })
      }

      yield* store({ ...admitted, state: "running", updatedAt: Date.now() })
      const result = yield* SessionPrompt.Service.use((prompt) =>
        prompt
          .loop({ sessionID: input.sessionID })
          .pipe(Effect.either),
      )
      const finished = yield* result.pipe(
        Effect.match({
          onLeft: (cause) =>
            store({
              ...admitted,
              state: "failed",
              error: Cause.isCause(cause) ? Cause.pretty(cause) : String(cause),
              updatedAt: Date.now(),
            }),
          onRight: () =>
            store({
              ...admitted,
              state: "completed",
              summaryMessageID: message.id,
              updatedAt: Date.now(),
            }),
        }),
      )
      if (finished.state === "completed") {
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return finished
    })

    const status = Effect.fn("SessionCompaction.status")(function* (input: { sessionID: SessionID }) {
      return (
        (yield* current(input.sessionID)) ?? {
          version: CompactionOutputVersion,
          sessionID: input.sessionID,
          state: "idle" as const,
          updatedAt: Date.now(),
        }
      )
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
      request,
      status,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(SessionPrompt.defaultLayer),
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
  ),
)

export const node = LayerNode.make(layer, [
  Config.node,
  Session.node,
  Agent.node,
  Plugin.node,
  SessionProcessor.node,
  SessionPrompt.node,
  SessionRunState.node,
  Provider.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
])

export * as SessionCompaction from "./compaction"
