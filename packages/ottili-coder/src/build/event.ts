import { Effect, Schema } from "effect"
import { SessionID, MessageID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"

export const Event = {
  Start: EventV2.define({
    type: "build.start",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      goal: Schema.String,
    },
  }),
  Complete: EventV2.define({
    type: "build.complete",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      resultPath: Schema.optional(Schema.String),
    },
  }),
  Error: EventV2.define({
    type: "build.error",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      error: Schema.String,
    },
  }),
}

export * as BuildEvent from "./event"
