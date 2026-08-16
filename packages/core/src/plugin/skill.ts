/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOttiliCoderContent from "./skill/customize-ottili-coder.md" with { type: "text" }

export const CustomizeOttiliCoderContent = customizeOttiliCoderContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
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
