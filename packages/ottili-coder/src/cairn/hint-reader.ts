import { Context, Effect, Layer, Schema } from "effect"
import { SessionMemory } from "./session-memory"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const Severity = Schema.Literals(["low", "medium", "high", "critical"])
export type Severity = Schema.Schema.Type<typeof Severity>

export class Hint extends Schema.Class<Hint>("CairnHint")({
  seq: Schema.Number,
  timestamp: Schema.String,
  severity: Severity,
  trigger: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly readNew: (sessionId: string) => Effect.Effect<Hint[]>
  readonly readAll: (sessionId: string) => Effect.Effect<Hint[]>
  readonly markRead: (sessionId: string, seq: number) => Effect.Effect<void>
  readonly markAllRead: (sessionId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CairnHintReader") {}

const HINT_HEADER = /^##\s+Hint\s+#(\d+)\s+—\s+(.+)$/i
const SEVERITY_LINE = /^\*\*Severity:\*\*\s*(\w+)/i
const TRIGGER_LINE = /^\*\*Trigger:\*\*\s*(.+)/i
const MESSAGE_PREFIX = /^\*\*Message:\*\*\s*/i

type MutableHint = {
  seq: number
  timestamp: string
  severity: "low" | "medium" | "high" | "critical"
  trigger: string
  messageLines: string[]
}

export function parseHints(content: string): Hint[] {
  const lines = content.split("\n")
  const hints: Hint[] = []
  let current: MutableHint | null = null

  const flush = (h: MutableHint) => {
    hints.push({
      seq: h.seq,
      timestamp: h.timestamp,
      severity: h.severity,
      trigger: h.trigger,
      message: h.messageLines.join("\n").trim(),
    })
  }

  for (const line of lines) {
    const headerMatch = line.match(HINT_HEADER)
    if (headerMatch) {
      if (current) flush(current)
      current = {
        seq: parseInt(headerMatch[1], 10),
        timestamp: headerMatch[2].trim(),
        severity: "low",
        trigger: "",
        messageLines: [],
      }
      continue
    }

    if (!current) continue

    const sevMatch = line.match(SEVERITY_LINE)
    if (sevMatch) {
      const sev = sevMatch[1].toLowerCase()
      if (sev === "low" || sev === "medium" || sev === "high" || sev === "critical") {
        current.severity = sev
      }
      continue
    }

    const trigMatch = line.match(TRIGGER_LINE)
    if (trigMatch) {
      current.trigger = trigMatch[1].trim()
      continue
    }

    const msgMatch = line.match(MESSAGE_PREFIX)
    if (msgMatch) {
      current.messageLines.push(line.slice(msgMatch[0].length))
      continue
    }

    if (current.severity && current.trigger) {
      current.messageLines.push(line)
    }
  }

  if (current && current.trigger) flush(current)

  return hints
}

export function formatHint(hint: Hint): string {
  return [
    `## Hint #${hint.seq} — ${hint.timestamp}`,
    `**Severity:** ${hint.severity}`,
    `**Trigger:** ${hint.trigger}`,
    `**Message:** ${hint.message}`,
    "",
  ].join("\n")
}

export function formatHintForInjection(hint: Hint): string {
  return `[CAIRN OBSERVATION — Severity: ${hint.severity}]\n${hint.message}`
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service
    const readPositions = new Map<string, number>()

    return Service.of({
      readNew: Effect.fn("CairnHintReader.readNew")(function* (sessionId: string) {
        const content = yield* memory.read(sessionId, "HINTS.md")
        if (!content) return []
        const all = parseHints(content)
        const lastRead = readPositions.get(sessionId) ?? 0
        return all.filter((hint) => hint.seq > lastRead)
      }),

      readAll: Effect.fn("CairnHintReader.readAll")(function* (sessionId: string) {
        const content = yield* memory.read(sessionId, "HINTS.md")
        if (!content) return []
        return parseHints(content)
      }),

      markRead: Effect.fn("CairnHintReader.markRead")(function* (sessionId: string, seq: number) {
        const current = readPositions.get(sessionId) ?? 0
        readPositions.set(sessionId, Math.max(current, seq))
      }),

      markAllRead: Effect.fn("CairnHintReader.markAllRead")(function* (sessionId: string) {
        const content = yield* memory.read(sessionId, "HINTS.md")
        if (!content) {
          readPositions.set(sessionId, 0)
          return
        }
        const all = parseHints(content)
        const maxSeq = all.reduce((max, hint) => Math.max(max, hint.seq), 0)
        readPositions.set(sessionId, maxSeq)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionMemory.defaultLayer))

export const node = LayerNode.make(layer, [SessionMemory.node])

export * as HintReader from "./hint-reader"
