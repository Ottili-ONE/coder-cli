import { Layer } from "effect"
import { SessionMemory } from "./session-memory"
import { HintReader } from "./hint-reader"
import { HintWriter } from "./hint-writer"
import { Worktime } from "./worktime"
import { Checkpoint } from "./checkpoint"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export { SessionMemory } from "./session-memory"
export { HintReader } from "./hint-reader"
export { HintWriter } from "./hint-writer"
export { Worktime } from "./worktime"
export { Checkpoint } from "./checkpoint"

// All sub-layers depend on SessionMemory.Service.
// The layer requires SessionMemory.Service from the outside.
export const layer = Layer.mergeAll(
  HintReader.layer,
  HintWriter.layer,
  Worktime.layer,
  Checkpoint.layer,
)

// defaultLayer provides SessionMemory internally so it's self-contained.
// Provide SessionMemory.defaultLayer once to avoid duplicate service provisions.
export const defaultLayer = layer.pipe(Layer.provide(SessionMemory.defaultLayer))

export const node = LayerNode.make(layer, [SessionMemory.node])

export * as Cairn from "."
