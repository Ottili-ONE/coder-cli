import { Effect, Schema } from "effect"
import { SessionID, MessageID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"

// A node in the planned task graph. Models a single unit of work the planner
// decomposed from the user goal, with its dependency edges and execution state.
export const TaskStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "running",
  "success",
  "failed",
  "skipped",
  "cancelled",
])
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

export const TaskNode = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  dependsOn: Schema.Array(Schema.String),
  status: TaskStatus,
  agent: Schema.optional(Schema.String),
  resultPath: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export type TaskNode = Schema.Schema.Type<typeof TaskNode>

// Versioned envelope for headless / JSON output (schema boundary).
// Bump the MAJOR on breaking changes to the `graph` payload shape.
export const OutputVersion = Schema.Literals(["1"])
export type OutputVersion = Schema.Schema.Type<typeof OutputVersion>

export const Event = {
  // Emitted when the planner finishes decomposing the goal into a graph and
  // the graph is ready for review / approval.
  Plan: EventV2.define({
    type: "taskgraph.plan",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      goal: Schema.String,
      tasks: Schema.Array(TaskNode),
      resume: Schema.optional(Schema.Boolean),
    },
  }),
  // Emitted whenever a node transitions state (approval, start, completion…).
  TaskUpdate: EventV2.define({
    type: "taskgraph.task.update",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      task: TaskNode,
    },
  }),
  // Emitted when one or more nodes need human approval before execution.
  ApprovalRequested: EventV2.define({
    type: "taskgraph.approval.requested",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      taskIDs: Schema.Array(Schema.String),
      reason: Schema.optional(Schema.String),
    },
  }),
  // Emitted when an approval decision is applied to a node.
  ApprovalResolved: EventV2.define({
    type: "taskgraph.approval.resolved",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      taskID: Schema.String,
      decision: Schema.Literals(["approved", "rejected"]),
    },
  }),
  // Emitted when the whole graph finishes (success, partial or failed).
  Complete: EventV2.define({
    type: "taskgraph.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      status: Schema.Literals(["success", "partial", "failed", "cancelled"]),
      resultPath: Schema.optional(Schema.String),
      outputPath: Schema.optional(Schema.String),
    },
  }),
  Error: EventV2.define({
    type: "taskgraph.error",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      graphID: Schema.String,
      taskID: Schema.optional(Schema.String),
      error: Schema.String,
    },
  }),
}

export * as TaskGraphEvent from "./event"
