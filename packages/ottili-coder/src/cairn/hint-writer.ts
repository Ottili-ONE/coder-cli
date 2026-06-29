import { Context, Effect, Layer, Schema } from "effect"
import { SessionMemory } from "./session-memory"
import { Hint, formatHint, type Severity } from "./hint-reader"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export class HintWriteError extends Schema.TaggedErrorClass<HintWriteError>()("HintWriteError", {
  message: Schema.String,
}) {}

export interface WriteHintInput {
  readonly sessionId: string
  readonly severity: Severity
  readonly trigger: string
  readonly message: string
}

export interface Interface {
  readonly write: (input: WriteHintInput) => Effect.Effect<Hint>
  readonly nextSeq: (sessionId: string) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CairnHintWriter") {}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service

    const nextSeq = Effect.fn("CairnHintWriter.nextSeq")(function* (sessionId: string) {
      const content = yield* memory.read(sessionId, "HINTS.md")
      if (!content) return 1
      const lines = content.split("\n")
      let maxSeq = 0
      for (const line of lines) {
        const match = line.match(/^##\s+Hint\s+#(\d+)/i)
        if (match) {
          const seq = parseInt(match[1], 10)
          if (seq > maxSeq) maxSeq = seq
        }
      }
      return maxSeq + 1
    })

    return Service.of({
      nextSeq,
      write: Effect.fn("CairnHintWriter.write")(function* (input: WriteHintInput) {
        const seq = yield* nextSeq(input.sessionId)
        const hint: Hint = {
          seq,
          timestamp: nowIso(),
          severity: input.severity,
          trigger: input.trigger,
          message: input.message,
        }
        const block = formatHint(hint) + "\n"
        yield* memory.append(input.sessionId, "HINTS.md", block)
        return hint
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionMemory.defaultLayer))

export const node = LayerNode.make(layer, [SessionMemory.node])

export * as HintWriter from "./hint-writer"
