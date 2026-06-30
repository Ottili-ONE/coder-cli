import { Context, Effect, Layer, Schema } from "effect"
import { SessionMemory } from "./session-memory"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export class CheckpointError extends Schema.TaggedErrorClass<CheckpointError>()("CheckpointError", {
  message: Schema.String,
}) {}

export interface Milestone {
  readonly title: string
  readonly status: "pending" | "in_progress" | "completed" | "blocked"
  readonly notes?: string
}

export interface CheckpointState {
  readonly mode: string
  readonly goal: string
  readonly milestones: Milestone[]
  readonly currentMilestone: string | undefined
  readonly nextAction: string | undefined
  readonly blockers: string[]
  readonly lastUpdated: string
}

export interface Interface {
  readonly read: (sessionId: string) => Effect.Effect<CheckpointState | undefined>
  readonly write: (sessionId: string, state: CheckpointState) => Effect.Effect<void>
  readonly updateMilestone: (sessionId: string, title: string, update: Partial<Milestone>) => Effect.Effect<void>
  readonly addMilestone: (sessionId: string, milestone: Milestone) => Effect.Effect<void>
  readonly appendValidation: (sessionId: string, command: string, result: string) => Effect.Effect<void>
  readonly appendDecision: (sessionId: string, decision: string, rationale: string) => Effect.Effect<void>
  readonly appendKnownProblem: (sessionId: string, problem: string, severity: string, unblock: string) => Effect.Effect<void>
  readonly setNextAction: (sessionId: string, action: string) => Effect.Effect<void>
  readonly recoveryHint: (sessionId: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CairnCheckpoint") {}

function nowIso(): string {
  return new Date().toISOString()
}

export function serializeCheckpoint(state: CheckpointState): string {
  const lines: string[] = [
    `# Checkpoint`,
    "",
    `**Last updated:** ${state.lastUpdated}`,
    `**Mode:** ${state.mode}`,
    `**Goal:** ${state.goal}`,
    "",
    "## Milestones",
  ]

  for (const m of state.milestones) {
    const checkbox = m.status === "completed" ? "[x]" : "[ ]"
    lines.push(`- ${checkbox} **${m.title}** — ${m.status}${m.notes ? ` — ${m.notes}` : ""}`)
  }

  lines.push("", "## Current Milestone")
  lines.push(state.currentMilestone ?? "_(none)_")

  lines.push("", "## Next Action")
  lines.push(state.nextAction ?? "_(none)_")

  lines.push("", "## Blockers")
  if (state.blockers.length === 0) {
    lines.push("_(none)_")
  } else {
    for (const b of state.blockers) lines.push(`- ${b}`)
  }

  return lines.join("\n") + "\n"
}

export function parseCheckpoint(content: string): CheckpointState | undefined {
  const lines = content.split("\n")
  let mode = "build"
  let goal = ""
  let currentMilestone: string | undefined
  let nextAction: string | undefined
  const milestones: Milestone[] = []
  const blockers: string[] = []
  let section = ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("## ")) {
      section = trimmed.slice(3).toLowerCase()
      continue
    }
    if (trimmed.startsWith("**Mode:**")) {
      mode = trimmed.slice(9).trim()
      continue
    }
    if (trimmed.startsWith("**Goal:**")) {
      goal = trimmed.slice(9).trim()
      continue
    }
    if (section === "milestones" && trimmed.startsWith("- [")) {
      const completed = trimmed.startsWith("- [x]")
      const rest = trimmed.slice(completed ? 6 : 5)
      const dashIdx = rest.indexOf("—")
      if (dashIdx > 0) {
        const title = rest.slice(0, dashIdx).replace(/\*\*/g, "").trim()
        const afterDash = rest.slice(dashIdx + 1).trim()
        const notesIdx = afterDash.indexOf(" — ")
        const status = notesIdx > 0 ? afterDash.slice(0, notesIdx).trim() : afterDash.trim()
        const notes = notesIdx > 0 ? afterDash.slice(notesIdx + 3).trim() : undefined
        milestones.push({
          title,
          status: completed ? "completed" : status === "in_progress" ? "in_progress" : status === "blocked" ? "blocked" : "pending",
          notes,
        })
      }
      continue
    }
    if (section === "current milestone" && trimmed && !trimmed.startsWith("_(")) {
      currentMilestone = trimmed
      continue
    }
    if (section === "next action" && trimmed && !trimmed.startsWith("_(")) {
      nextAction = trimmed
      continue
    }
    if (section === "blockers" && trimmed.startsWith("- ")) {
      blockers.push(trimmed.slice(2))
      continue
    }
  }

  if (!goal && milestones.length === 0) return undefined

  return {
    mode,
    goal,
    milestones,
    currentMilestone,
    nextAction,
    blockers,
    lastUpdated: nowIso(),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service

    const read = Effect.fn("CairnCheckpoint.read")(function* (sessionId: string) {
      const content = yield* memory.read(sessionId, "CHECKPOINT.md")
      if (!content) return undefined
      return parseCheckpoint(content)
    })

    const write = Effect.fn("CairnCheckpoint.write")(function* (sessionId: string, state: CheckpointState) {
      const updated = { ...state, lastUpdated: nowIso() }
      yield* memory.write(sessionId, "CHECKPOINT.md", serializeCheckpoint(updated))
    })

    return Service.of({
      read,
      write,

      updateMilestone: Effect.fn("CairnCheckpoint.updateMilestone")(function* (
        sessionId: string,
        title: string,
        update: Partial<Milestone>,
      ) {
        const state = yield* read(sessionId)
        if (!state) return
        const milestones = state.milestones.map((m: Milestone) =>
          m.title === title ? { ...m, ...update } : m,
        )
        yield* write(sessionId, { ...state, milestones })
      }),

      addMilestone: Effect.fn("CairnCheckpoint.addMilestone")(function* (
        sessionId: string,
        milestone: Milestone,
      ) {
        const state = (yield* read(sessionId)) ?? {
          mode: "build",
          goal: "",
          milestones: [],
          currentMilestone: undefined,
          nextAction: undefined,
          blockers: [],
          lastUpdated: nowIso(),
        }
        yield* write(sessionId, {
          ...state,
          milestones: [...state.milestones, milestone],
        })
      }),

      appendValidation: Effect.fn("CairnCheckpoint.appendValidation")(function* (
        sessionId: string,
        command: string,
        result: string,
      ) {
        const block = `\n## ${nowIso()}\n**Command:** \`${command}\`\n**Result:**\n\`\`\`\n${result}\n\`\`\`\n`
        yield* memory.append(sessionId, "VALIDATION_LOG.md", block)
      }),

      appendDecision: Effect.fn("CairnCheckpoint.appendDecision")(function* (
        sessionId: string,
        decision: string,
        rationale: string,
      ) {
        const block = `\n## ${nowIso()}\n**Decision:** ${decision}\n**Rationale:** ${rationale}\n`
        yield* memory.append(sessionId, "DECISIONS.md", block)
      }),

      appendKnownProblem: Effect.fn("CairnCheckpoint.appendKnownProblem")(function* (
        sessionId: string,
        problem: string,
        severity: string,
        unblock: string,
      ) {
        const block = `\n## ${nowIso()}\n**Severity:** ${severity}\n**Problem:** ${problem}\n**Unblock:** ${unblock}\n`
        yield* memory.append(sessionId, "KNOWN_PROBLEMS.md", block)
      }),

      setNextAction: Effect.fn("CairnCheckpoint.setNextAction")(function* (sessionId: string, action: string) {
        const state = yield* read(sessionId)
        if (!state) return
        yield* write(sessionId, { ...state, nextAction: action })
      }),

      recoveryHint: Effect.fn("CairnCheckpoint.recoveryHint")(function* (sessionId: string) {
        const state = yield* read(sessionId)
        if (!state) return undefined
        const completed = state.milestones.filter((m) => m.status === "completed").map((m) => m.title)
        const remaining = state.milestones.filter((m) => m.status !== "completed").map((m) => m.title)
        const lines = [
          "[CAIRN RECOVERY — context was compacted, reconstructing state]",
          `Goal: ${state.goal}`,
          `Mode: ${state.mode}`,
          completed.length > 0 ? `Completed: ${completed.join(", ")}` : "Completed: (none)",
          remaining.length > 0 ? `Remaining: ${remaining.join(", ")}` : "Remaining: (none)",
        ]
        if (state.currentMilestone) lines.push(`Current milestone: ${state.currentMilestone}`)
        if (state.nextAction) lines.push(`Next action: ${state.nextAction}`)
        if (state.blockers.length > 0) lines.push(`Blockers: ${state.blockers.join("; ")}`)
        lines.push("Re-read CHECKPOINT.md for full detail. Continue from next action.")
        return lines.join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionMemory.defaultLayer))

export const node = LayerNode.make(layer, [SessionMemory.node])

export * as Checkpoint from "./checkpoint"
