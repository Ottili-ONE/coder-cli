import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { InstanceStore } from "./instance-store"

/**
 * Standalone `InstanceStore` layer with the instance bootstrap dependency
 * resolved. `AppNodeBuilderV1.build` substitutes the unbound
 * `InstanceStore.bootstrapNode` with the real `InstanceBootstrap.node`, so the
 * dynamic import that used to break the dependency cycle is no longer needed.
 */
export const layer = AppNodeBuilderV1.build(InstanceStore.node)

export * as InstanceLayer from "./instance-layer"
