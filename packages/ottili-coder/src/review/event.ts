import { Effect, Schema } from "effect"
import { SessionID, MessageID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"

export const Event = {
  Start: EventV2.define({
    type: "review.start",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      target: Schema.String,
      scope: Schema.Literals(["uncommitted", "commit", "branch", "pr"]),
    },
  }),
  Complete: EventV2.define({
    type: "review.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      resultPath: Schema.optional(Schema.String),
      findings: Schema.optional(Schema.Number),
    },
  }),
  Approval: EventV2.define({
    type: "review.approval",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      tool: Schema.String,
      allowed: Schema.Boolean,
    },
  }),
  Error: EventV2.define({
    type: "review.error",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      error: Schema.String,
    },
  }),
}

export * as ReviewEvent from "./event"
