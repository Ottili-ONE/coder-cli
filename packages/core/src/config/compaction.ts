export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional).annotate({
    description:
      "Maximum number of recent tokens to preserve verbatim after compaction (maps to v1 preserve_recent_tokens)",
  }),
  turns: NonNegativeInt.pipe(Schema.optional).annotate({
    description:
      "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (maps to v1 tail_turns; default 2)",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable automatic compaction when context is full (default: true)",
  }),
  prune: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable pruning of old tool outputs to reclaim context space (default: false)",
  }),
  tail_turns: NonNegativeInt.pipe(Schema.optional).annotate({
    description:
      "Number of recent user turns to keep verbatim during compaction (default: 2). Prefer keep.turns; this is the legacy flat alias.",
  }),
  keep: Keep.pipe(Schema.optional),
  buffer: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Token buffer reserved for compaction so overflow is avoided during the summarize step (maps to v1 reserved)",
  }),
}) {}
