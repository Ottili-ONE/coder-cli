import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Auth } from "../../src/auth"
import { Workspace } from "../../src/control-plane/workspace"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Cairn } from "../../src/cairn"
import { EventV2Bridge } from "../../src/event-v2-bridge"

export const workspaceLayerWithRuntimeFlags = (overrides: Partial<RuntimeFlags.Info>) =>
  Workspace.layer.pipe(
    Layer.provide(LayerNode.compile(Auth.node)),
    Layer.provide(LayerNode.compile(Session.node)),
    Layer.provide(LayerNode.compile(SessionPrompt.node)),
    Layer.provide(LayerNode.compile(Cairn.node)),
    Layer.provide(LayerNode.compile(Project.node)),
    Layer.provide(LayerNode.compile(Vcs.node)),
    Layer.provide(LayerNode.compile(Database.node)),
    Layer.provide(LayerNode.compile(EventV2Bridge.node)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(LayerNode.compile(FSUtil.node)),
    Layer.provide(RuntimeFlags.layer(overrides)),
    Layer.provide(LayerNode.compile(InstanceStore.node)),
    Layer.provide(LayerNode.compile(InstanceBootstrap.node)),
  )
