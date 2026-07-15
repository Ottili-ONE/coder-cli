import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { tool } from "../src/tool"

describe("plugin.tool", () => {
  test("returns the description, args and execute verbatim", () => {
    const execute = async () => "ok"
    const def = tool({
      description: "echo a value",
      args: { value: z.string() },
      execute,
    })

    expect(def.description).toBe("echo a value")
    expect(Object.keys(def.args)).toEqual(["value"])
    expect(def.execute).toBe(execute)
  })

  test("exposes the zod namespace for schema building", () => {
    expect(tool.schema).toBe(z)
    expect(tool.schema.object({ a: z.number() })).toBeInstanceOf(z.ZodObject)
  })

  test("accepts an empty args shape", () => {
    const def = tool({
      description: "no args",
      args: {},
      execute: async () => ({ output: "done" }),
    })

    expect(def.args).toEqual({})
  })

  test("execute receives validated args and context", async () => {
    const def = tool({
      description: "add",
      args: { a: z.number(), b: z.number() },
      execute: async (args, ctx) => {
        expect(args).toEqual({ a: 1, b: 2 })
        expect(ctx.directory).toBe("/work")
        return String(args.a + args.b)
      },
    })

    const result = await def.execute({ a: 1, b: 2 }, {
      sessionID: "s1",
      messageID: "m1",
      agent: "main",
      directory: "/work",
      worktree: "/work",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    })

    expect(result).toBe("3")
  })

  test("rejects invalid args before execute runs", () => {
    const def = tool({
      description: "needs number",
      args: { n: z.number() },
      execute: async () => "never",
    })

    // The args shape is carried as a zod schema; consumers parse it. We assert
    // the schema rejects a non-number so callers cannot pass bad input through.
    const parsed = def.args.n.safeParse("not-a-number")
    expect(parsed.success).toBe(false)
  })
})
