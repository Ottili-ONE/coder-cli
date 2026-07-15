import { Effect, Schema } from "effect"
import { SessionID, MessageID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"

export const Event = {
  Start: EventV2.define({
    type: "deploy.start",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      correlationID: Schema.String,
      target: Schema.String,
      environment: Schema.String,
    },
  }),
  Progress: EventV2.define({
    type: "deploy.progress",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      correlationID: Schema.String,
      phase: Schema.String,
      attempt: Schema.Number,
    },
  }),
  Complete: EventV2.define({
    type: "deploy.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      correlationID: Schema.String,
      deploymentID: Schema.optional(Schema.String),
      durationMs: Schema.optional(Schema.Number),
    },
  }),
  Error: EventV2.define({
    type: "deploy.error",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      correlationID: Schema.String,
      error: Schema.String,
      attempt: Schema.optional(Schema.Number),
    },
  }),
  Cancelled: EventV2.define({
    type: "deploy.cancelled",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      correlationID: Schema.String,
    },
  }),
}

export * as DeployEvent from "./event"
