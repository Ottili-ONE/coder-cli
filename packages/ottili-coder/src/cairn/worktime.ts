import { Context, Effect, Layer, Schema } from "effect"
import { SessionMemory } from "./session-memory"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export class WorktimeError extends Schema.TaggedErrorClass<WorktimeError>()("WorktimeError", {
  message: Schema.String,
}) {}

export const WorktimeStatus = Schema.Literals(["CONTINUE", "BUDGET_REACHED", "STOPPED", "NOT_STARTED"])
export type WorktimeStatus = Schema.Schema.Type<typeof WorktimeStatus>

export interface WorktimeState {
  readonly started_at: string
  readonly budget_seconds: number
  readonly label: string | undefined
  readonly stopped: boolean
}

export interface WorktimeInfo {
  readonly status: WorktimeStatus
  readonly elapsedSeconds: number
  readonly remainingSeconds: number
  readonly label: string | undefined
}

export interface Interface {
  readonly start: (sessionId: string, budget: { hours?: number; minutes?: number; label?: string }) => Effect.Effect<WorktimeState>
  readonly status: (sessionId: string) => Effect.Effect<WorktimeInfo>
  readonly extend: (sessionId: string, budget: { hours?: number; minutes?: number }) => Effect.Effect<WorktimeState | undefined>
  readonly stop: (sessionId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CairnWorktime") {}

function toSeconds(budget: { hours?: number; minutes?: number }): number {
  return (budget.hours ?? 0) * 3600 + (budget.minutes ?? 0) * 60
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service

    const loadState = Effect.fn("CairnWorktime.loadState")(function* (sessionId: string) {
      const content = yield* memory.read(sessionId, "WORKTIME.json")
      if (!content) return undefined
      return JSON.parse(content) as WorktimeState
    })

    const saveState = Effect.fn("CairnWorktime.saveState")(function* (sessionId: string, state: WorktimeState) {
      yield* memory.write(sessionId, "WORKTIME.json", JSON.stringify(state, null, 2))
    })

    return Service.of({
      start: Effect.fn("CairnWorktime.start")(function* (
        sessionId: string,
        budget: { hours?: number; minutes?: number; label?: string },
      ) {
        const existing = yield* loadState(sessionId)
        if (existing && !existing.stopped) return existing

        const state: WorktimeState = {
          started_at: new Date().toISOString(),
          budget_seconds: toSeconds(budget),
          label: budget.label,
          stopped: false,
        }
        yield* saveState(sessionId, state)
        return state
      }),

      status: Effect.fn("CairnWorktime.status")(function* (sessionId: string) {
        const state = yield* loadState(sessionId)
        if (!state) {
          return {
            status: "NOT_STARTED" as const,
            elapsedSeconds: 0,
            remainingSeconds: 0,
            label: undefined,
          }
        }
        if (state.stopped) {
          return {
            status: "STOPPED" as const,
            elapsedSeconds: 0,
            remainingSeconds: 0,
            label: state.label,
          }
        }
        const now = Date.now()
        const started = Date.parse(state.started_at)
        const elapsed = Math.max(0, Math.floor((now - started) / 1000))
        const remaining = Math.max(0, state.budget_seconds - elapsed)
        return {
          status: remaining > 0 ? ("CONTINUE" as const) : ("BUDGET_REACHED" as const),
          elapsedSeconds: elapsed,
          remainingSeconds: remaining,
          label: state.label,
        }
      }),

      extend: Effect.fn("CairnWorktime.extend")(function* (
        sessionId: string,
        budget: { hours?: number; minutes?: number },
      ) {
        const state = yield* loadState(sessionId)
        if (!state) return undefined
        const updated: WorktimeState = {
          ...state,
          budget_seconds: state.budget_seconds + toSeconds(budget),
          stopped: false,
        }
        yield* saveState(sessionId, updated)
        return updated
      }),

      stop: Effect.fn("CairnWorktime.stop")(function* (sessionId: string) {
        const state = yield* loadState(sessionId)
        if (!state) return
        yield* saveState(sessionId, { ...state, stopped: true })
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionMemory.defaultLayer))

export const node = LayerNode.make(layer, [SessionMemory.node])

export * as Worktime from "./worktime"
