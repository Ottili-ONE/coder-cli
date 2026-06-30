import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const CAIRN_DIR_NAME = "cairn"

const CHECKPOINT_FILES = [
  "CHECKPOINT.md",
  "VALIDATION_LOG.md",
  "KNOWN_PROBLEMS.md",
  "DECISIONS.md",
  "NEXT_ACTIONS.md",
  "HINTS.md",
  "WORKTIME.json",
] as const

export type CheckpointFile = (typeof CHECKPOINT_FILES)[number]

export class SessionMemoryError extends Schema.TaggedErrorClass<SessionMemoryError>()("SessionMemoryError", {
  message: Schema.String,
  path: Schema.optional(Schema.String),
}) {}

export interface SessionMemoryDir {
  readonly sessionId: string
  readonly dir: string
  readonly files: Record<CheckpointFile, string>
}

export interface Interface {
  readonly resolve: (sessionId: string) => Effect.Effect<SessionMemoryDir>
  readonly ensure: (sessionId: string) => Effect.Effect<SessionMemoryDir>
  readonly read: (sessionId: string, file: CheckpointFile) => Effect.Effect<string | undefined>
  readonly write: (sessionId: string, file: CheckpointFile, content: string) => Effect.Effect<void>
  readonly append: (sessionId: string, file: CheckpointFile, content: string) => Effect.Effect<void>
  readonly exists: (sessionId: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<SessionMemoryDir[]>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CairnSessionMemory") {}

function sessionDir(sessionId: string): string {
  return path.join(Global.Path.state, CAIRN_DIR_NAME, sessionId)
}

function filePath(sessionId: string, file: CheckpointFile): string {
  return path.join(sessionDir(sessionId), file)
}

function resolveFiles(sessionId: string): Record<CheckpointFile, string> {
  return Object.fromEntries(
    CHECKPOINT_FILES.map((file) => [file, filePath(sessionId, file)] as const),
  ) as Record<CheckpointFile, string>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return Service.of({
      resolve: Effect.fn("CairnSessionMemory.resolve")(function* (sessionId: string) {
        return {
          sessionId,
          dir: sessionDir(sessionId),
          files: resolveFiles(sessionId),
        }
      }),

      ensure: Effect.fn("CairnSessionMemory.ensure")(function* (sessionId: string) {
        const dir = sessionDir(sessionId)
        yield* fs.ensureDir(dir).pipe(Effect.catch(() => Effect.void))
        return {
          sessionId,
          dir,
          files: resolveFiles(sessionId),
        }
      }),

      read: Effect.fn("CairnSessionMemory.read")(function* (sessionId: string, file: CheckpointFile) {
        return yield* fs.readFileStringSafe(filePath(sessionId, file)).pipe(Effect.catch(() => Effect.succeed(undefined)))
      }),

      write: Effect.fn("CairnSessionMemory.write")(function* (
        sessionId: string,
        file: CheckpointFile,
        content: string,
      ) {
        yield* fs.writeWithDirs(filePath(sessionId, file), content).pipe(Effect.catch(() => Effect.void))
      }),

      append: Effect.fn("CairnSessionMemory.append")(function* (
        sessionId: string,
        file: CheckpointFile,
        content: string,
      ) {
        const fp = filePath(sessionId, file)
        const existing = (yield* fs.readFileStringSafe(fp).pipe(Effect.catch(() => Effect.succeed(undefined)))) ?? ""
        yield* fs.writeWithDirs(fp, existing + content).pipe(Effect.catch(() => Effect.void))
      }),

      exists: Effect.fn("CairnSessionMemory.exists")(function* (sessionId: string) {
        return yield* fs.existsSafe(sessionDir(sessionId))
      }),

      list: Effect.fn("CairnSessionMemory.list")(function* () {
        const base = path.join(Global.Path.state, CAIRN_DIR_NAME)
        const hasBase = yield* fs.existsSafe(base)
        if (!hasBase) return []
        const entries = yield* fs.readDirectoryEntries(base).pipe(Effect.catch(() => Effect.succeed([])))
        return entries
          .filter((entry) => entry.type === "directory")
          .map((entry) => ({
            sessionId: entry.name,
            dir: path.join(base, entry.name),
            files: resolveFiles(entry.name),
          }))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as SessionMemory from "./session-memory"
