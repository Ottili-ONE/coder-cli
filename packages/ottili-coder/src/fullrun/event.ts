import { Effect, Schema } from "effect"
import { SessionID, MessageID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"

// Ordered pipeline stages for Full Run mode. A run chains these stages in
// order and stops at a configured boundary (see StopLevel in state.ts).
export const StageName = Schema.Literals([
  "recon",
  "plan",
  "implement",
  "review",
  "test",
  "security",
  "docs",
  "deploy",
  "report",
])
export type StageName = Schema.Schema.Type<typeof StageName>

// Stop-level control: where the run halts for human sign-off.
// - "none": run through every stage to the final report.
// - "plan": halt after planning so the plan can be approved before implementation.
// - "implement": halt after implementation, before review/test.
// - "review": halt after review, before security/docs/deploy.
// - "test": halt after tests pass, before security/docs/deploy.
// - "security": halt after security, before docs/deploy.
// - "docs": halt after docs, before deploy.
// - "deploy": halt after deploy, before the final report.
// - "report": halt immediately before producing the final report.
export const StopLevel = Schema.Literals([
  "none",
  "plan",
  "implement",
  "review",
  "test",
  "security",
  "docs",
  "deploy",
  "report",
])
export type StopLevel = Schema.Schema.Type<typeof StopLevel>

export const StageStatus = Schema.Literals([
  "pending",
  "running",
  "success",
  "failed",
  "skipped",
  "cancelled",
])
export type StageStatus = Schema.Schema.Type<typeof StageStatus>

// Versioned envelope for headless / JSON output (schema boundary).
// Bump MAJOR on breaking changes to the `run` payload shape.
export const OutputVersion = Schema.Literals(["1"])
export type OutputVersion = Schema.Schema.Type<typeof OutputVersion>

export const Event = {
  Start: EventV2.define({
    type: "fullrun.start",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      goal: Schema.String,
      stopLevel: StopLevel,
      stages: Schema.Array(StageName),
      resume: Schema.optional(Schema.Boolean),
    },
  }),
  StageStart: EventV2.define({
    type: "fullrun.stage.start",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      stage: StageName,
      index: Schema.Number,
    },
  }),
  StageComplete: EventV2.define({
    type: "fullrun.stage.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      stage: StageName,
      index: Schema.Number,
      status: StageStatus,
      resultPath: Schema.optional(Schema.String),
    },
  }),
  Cancel: EventV2.define({
    type: "fullrun.cancel",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      stage: Schema.optional(StageName),
      reason: Schema.optional(Schema.String),
    },
  }),
  Complete: EventV2.define({
    type: "fullrun.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      status: Schema.Literals(["success", "partial", "failed", "cancelled"]),
      stopLevel: StopLevel,
      reportPath: Schema.optional(Schema.String),
      outputPath: Schema.optional(Schema.String),
    },
  }),
  Error: EventV2.define({
    type: "fullrun.error",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      runID: Schema.String,
      stage: Schema.optional(StageName),
      error: Schema.String,
    },
  }),
}

export * as FullRunEvent from "./event"
