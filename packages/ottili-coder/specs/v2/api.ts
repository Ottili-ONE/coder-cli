// @ts-nocheck

import { OttiliCoder } from "@opencode-ai/core"
import { ReadTool } from "@opencode-ai/core/tools"

const ottiliCoder = OttiliCoder.make({})

ottiliCoder.tool.add(ReadTool)

ottiliCoder.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

ottiliCoder.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

ottiliCoder.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await ottiliCoder.session.create({
  agent: "build",
})

ottiliCoder.subscribe((event) => {
  console.log(event)
})

await ottiliCoder.session.prompt({
  sessionID,
  text: "hey what is up",
})

await ottiliCoder.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await ottiliCoder.session.wait()

console.log(await ottiliCoder.session.messages(sessionID))
