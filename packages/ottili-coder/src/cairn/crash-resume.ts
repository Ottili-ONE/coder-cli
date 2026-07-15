import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Clock } from "effect"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class CheckpointNotFoundError extends Schema.TaggedErrorClass<CheckpointNotFoundError>()(
  "CrashResumeCheckpointNotFound",
  {
    message: Schema.String,
    sessionId: Schema.String,
  },
) {}

export class CheckpointCorruptError extends Schema.TaggedErrorClass<CheckpointCorruptError>()(
  "CrashResumeCheckpointCorrupt",
  {
    message: Schema.String,
    sessionId: Schema.String,
    cause: Schema.optional(Schema.String),
  },
) {}

export class CrashResumeError extends Schema.TaggedErrorClass<CrashResumeError>()("CrashResumeError", {
  message: Schema.String,
}) {}

// A captured tool result. Stored duck-typed because tool outputs vary widely;
// only the stable envelope is typed so resume never needs to re-run the tool.
export class ToolResult extends Schema.Class<ToolResult>("CrashResumeToolResult")({
  tool: Schema.String,
  callId: Schema.String,
  status: Schema.Literals("ok", "error", "cancelled"),
  summary: Schema.String,
  durationMs: Schema.optional(Schema.Number),
  recordedAt: Schema.String,
}) {}

export class FileEdit extends Schema.Class<FileEdit>("CrashResumeFileEdit")({
  path: Schema.String,
  kind: Schema.Literals("create", "update", "delete", "rename"),
  description: Schema.String,
  recordedAt: Schema.String,
}) {}

export class ValidationRun extends Schema.Class<ValidationRun>("CrashResumeValidationRun")({
  command: Schema.String,
  status: Schema.Literals("pass", "fail", "skip", "timeout"),
  summary: Schema.String,
  recordedAt: Schema.String,
}) {}

export class Milestone extends Schema.Class<Milestone>("CrashResumeMilestone")({
  title: Schema.String,
  status: Schema.Literals("pending", "in_progress", "completed", "blocked"),
  notes: Schema.optional(Schema.String),
}) {}

// Durable snapshot — the unit of crash recovery. Everything needed to resume
// without replaying external effects lives here as plain data.
export class CheckpointSnapshot extends Schema.Class<CheckpointSnapshot>("CrashResumeCheckpointSnapshot")({
  schemaVersion: Schema.Literal("1"),
  sessionId: Schema.String,
  mode: Schema.String,
  goal: Schema.String,
  sequence: Schema.Number,
  milestones: Schema.Array(Milestone),
  currentMilestone: Schema.optional(Schema.String),
  nextAction: Schema.optional(Schema.String),
  toolResults: Schema.Array(ToolResult),
  edits: Schema.Array(FileEdit),
  validations: Schema.Array(ValidationRun),
  blockers: Schema.Array(Schema.String),
  recordedAt: Schema.String,
}) {}

export type CheckpointSnapshotType = Schema.Schema.Type<typeof CheckpointSnapshot>

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly capture: (
    input: CheckpointSnapshotType,
  ) => Effect.Effect<void, CheckpointCorruptError | CrashResumeError>
  readonly read: (sessionId: string) => Effect.Effect<CheckpointSnapshotType | undefined, CheckpointCorruptError>
  readonly heartbeat: (sessionId: string) => Effect.Effect<void, CrashResumeError>
  readonly clearHeartbeat: (sessionId: string) => Effect.Effect<void, CrashResumeError>
  readonly detectInterrupted: (
    sessionId: string,
  ) => Effect.Effect<boolean, CrashResumeError>
  readonly resume: (
    sessionId: string,
  ) => Effect.Effect<CheckpointSnapshotType, CheckpointNotFoundError | CheckpointCorruptError>
  readonly list: () => Effect.Effect<string[], CrashResumeError>
}

export class Service extends Context.Service<Service, Interface>()("@ottili-coder/CrashResume") {}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const CAIRN_DIR_NAME = "cairn"
const SNAPSHOT_FILE = "CHECKPOINT_SNAPSHOT.json"
const HEARTBEAT_FILE = "CHECKPOINT_HEARTBEAT.json"
const STALE_HEARTBEAT_MS = 1000 * 60 * 10

function cairnDir(sessionId: string): string {
  return path.join(Global.Path.state, CAIRN_DIR_NAME, sessionId)
}

function snapshotPath(sessionId: string): string {
  return path.join(cairnDir(sessionId), SNAPSHOT_FILE)
}

function heartbeatPath(sessionId: string): string {
  return path.join(cairnDir(sessionId), HEARTBEAT_FILE)
}

// Atomic write: serialize to a temp file then rename so a crash mid-write can
// never leave a half-written snapshot behind.
function atomicWriteString(fp: string, content: string): Effect.Effect<void, CrashResumeError> {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const dir = path.dirname(fp)
    yield* fs.ensureDir(dir).pipe(
      Effect.mapError((e) => new CrashResumeError({ message: `ensureDir failed: ${String(e)}` })),
    )
    const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`
    yield* fs.writeWithDirs(tmp, content).pipe(
      Effect.mapError((e) => new CrashResumeError({ message: `write failed: ${String(e)}` })),
    )
    yield* fs.rename(tmp, fp).pipe(
      Effect.mapError((e) => new CrashResumeError({ message: `rename failed: ${String(e)}` })),
    )
  })
}

function readJsonSafe<T>(
  fp: string,
): Effect.Effect<T | undefined, CrashResumeError> {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const raw = yield* fs.readFileStringSafe(fp).pipe(
      Effect.mapError((e) => new CrashResumeError({ message: `read failed: ${String(e)}` })),
    )
    if (!raw) return undefined
    return yield* Effect.try({
      try: () => JSON.parse(raw) as T,
      catch: (e) => new CrashResumeError({ message: `parse failed: ${String(e)}` }),
    })
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const capture = Effect.fn("CrashResume.capture")(function* (input: CheckpointSnapshotType) {
      const fp = snapshotPath(input.sessionId)
      const encoded = yield* Schema.encode(CheckpointSnapshot)(input).pipe(
        Effect.mapError((e) => new CheckpointCorruptError({ message: `encode failed: ${String(e)}`, sessionId: input.sessionId })),
      )
      yield* atomicWriteString(fp, encoded)
    })

    const read = Effect.fn("CrashResume.read")(function* (sessionId: string) {
      const fp = snapshotPath(sessionId)
      const raw = yield* fs.readFileStringSafe(fp).pipe(
        Effect.mapError((e) => new CrashResumeError({ message: `read failed: ${String(e)}` })),
      )
      if (!raw) return undefined
      return yield* Schema.decode(CheckpointSnapshot)(raw).pipe(
        Effect.mapError((e) =>
          new CheckpointCorruptError({ message: `decode failed`, sessionId, cause: String(e) }),
        ),
      )
    })

    const heartbeat = Effect.fn("CrashResume.heartbeat")(function* (sessionId: string) {
      const now = yield* Clock.currentTimeMillis
      const fp = heartbeatPath(sessionId)
      yield* atomicWriteString(fp, JSON.stringify({ sessionId, at: new Date(now).toISOString() }))
    })

    const clearHeartbeat = Effect.fn("CrashResume.clearHeartbeat")(function* (sessionId: string) {
      const fp = heartbeatPath(sessionId)
      yield* fs.remove(fp).pipe(Effect.catch(() => Effect.void))
    })

    const detectInterrupted = Effect.fn("CrashResume.detectInterrupted")(function* (sessionId: string) {
      const fp = heartbeatPath(sessionId)
      const raw = yield* fs.readFileStringSafe(fp).pipe(
        Effect.mapError((e) => new CrashResumeError({ message: `heartbeat read failed: ${String(e)}` })),
      )
      if (!raw) return false
      const parsed = yield* readJsonSafe<{ at: string }>(fp).pipe(
        Effect.mapError((e) => new CrashResumeError({ message: `heartbeat parse failed: ${String(e)}` })),
      )
      if (!parsed?.at) return false
      const at = new Date(parsed.at).getTime()
      const now = yield* Clock.currentTimeMillis
      return now - at > STALE_HEARTBEAT_MS
    })

    const resume = Effect.fn("CrashResume.resume")(function* (sessionId: string) {
      const snapshot = yield* read(sessionId)
      if (!snapshot) {
        return yield* new CheckpointNotFoundError({ message: `no checkpoint for session`, sessionId })
      }
      return snapshot
    })

    const list = Effect.fn("CrashResume.list")(function* () {
      const base = path.join(Global.Path.state, CAIRN_DIR_NAME)
      const hasBase = yield* fs.existsSafe(base)
      if (!hasBase) return []
      const entries = yield* fs.readDirectoryEntries(base).pipe(
        Effect.mapError((e) => new CrashResumeError({ message: `list failed: ${String(e)}` })),
      )
      return entries.filter((entry) => entry.type === "directory").map((entry) => entry.name)
    })

    return Service.of({ capture, read, heartbeat, clearHeartbeat, detectInterrupted, resume, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as CrashResume from "./crash-resume"
