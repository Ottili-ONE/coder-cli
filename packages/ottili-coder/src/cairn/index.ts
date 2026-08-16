import { Layer } from "effect"
import { SessionMemory } from "./session-memory"
import { HintReader } from "./hint-reader"
import { HintWriter } from "./hint-writer"
import { Worktime } from "./worktime"
import { Checkpoint } from "./checkpoint"
import { CrashResume } from "./crash-resume"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export { SessionMemory } from "./session-memory"
export { HintReader } from "./hint-reader"
export { HintWriter } from "./hint-writer"
export { Worktime } from "./worktime"
export { Checkpoint } from "./checkpoint"
export { CrashResume } from "./crash-resume"

// All sub-layers depend on SessionMemory.Service.
// The layer requires SessionMemory.Service from the outside.
export const layer = Layer.mergeAll(
  HintReader.layer,
  HintWriter.layer,
  Worktime.layer,
  Checkpoint.layer,
  CrashResume.layer,
)

// The node graph carries each sub-service's own dependency edges, so
// SessionMemory (and FSUtil beneath it) is resolved and memoized exactly once.
export const node = LayerNode.group([
  HintReader.node,
  HintWriter.node,
  Worktime.node,
  Checkpoint.node,
  CrashResume.node,
])

// defaultLayer compiles the graph into a self-contained layer.
export const defaultLayer = LayerNode.compile(node)

export * as Cairn from "."
