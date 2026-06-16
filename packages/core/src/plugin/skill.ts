/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { Effect } from "effect"
import { PluginV2 } from "../plugin"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOttiliCoderContent from "./skill/customize-ottili-coder.md" with { type: "text" }

export const CustomizeOttiliCoderContent = customizeOttiliCoderContent

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("skill"),
  effect: Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()

    yield* transform((editor) => {
      editor.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-ottili-coder",
            description:
              "Use ONLY when the user is editing or creating ottili-coder's own configuration: ottiliCoder.json, ottiliCoder.jsonc, files under .ottili-coder/, or files under ~/.config/ottili-coder/. Also use when creating or fixing ottili-coder agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring ottili-coder itself.",
            location: AbsolutePath.make("/builtin/customize-ottiliCoder.md"),
            content: CustomizeOttiliCoderContent,
          }),
        }),
      )
    })
  }),
})
