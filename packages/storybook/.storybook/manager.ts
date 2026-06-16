import { addons, types } from "storybook/manager-api"
import { ThemeTool } from "./theme-tool"

addons.register("ottili-coder/theme-toggle", () => {
  addons.add("ottili-coder/theme-toggle/tool", {
    type: types.TOOL,
    title: "Theme",
    match: ({ viewMode }) => viewMode === "story" || viewMode === "docs",
    render: ThemeTool,
  })
})
