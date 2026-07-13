import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Hooks } from "../src/hooks"

let tmp: string
let originalHome: string | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ottili-hooks-"))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeProjectHook(config: unknown) {
  const dir = path.join(tmp, ".ottili-coder")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify(config))
}

describe("Hooks", () => {
  test("PreToolUse blocks via exit code 2", async () => {
    writeProjectHook({
      PreToolUse: [{ matcher: "Write", hooks: [{ command: "node -e \"process.stderr.write('nope'); process.exit(2)\"" }] }],
    })
    const result = await Hooks.preToolUse({
      tool: "Write",
      toolInput: { path: "a.txt" },
      sessionID: "s1",
      callID: "c1",
      cwd: tmp,
    })
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toContain("nope")
  })

  test("PreToolUse does not block a non-matching tool", async () => {
    writeProjectHook({
      PreToolUse: [{ matcher: "Write", hooks: [{ command: "node -e \"process.exit(2)\"" }] }],
    })
    const result = await Hooks.preToolUse({
      tool: "Bash",
      toolInput: {},
      sessionID: "s1",
      callID: "c1",
      cwd: tmp,
    })
    expect(result.blocked).toBe(false)
  })

  test("pipe matcher (|) selects multiple tools", async () => {
    writeProjectHook({
      PreToolUse: [{ matcher: "Edit|Write", hooks: [{ command: "node -e \"process.exit(2)\"" }] }],
    })
    const edit = await Hooks.preToolUse({ tool: "Edit", toolInput: {}, sessionID: "s", callID: "c", cwd: tmp })
    const bash = await Hooks.preToolUse({ tool: "Bash", toolInput: {}, sessionID: "s", callID: "c", cwd: tmp })
    expect(edit.blocked).toBe(true)
    expect(bash.blocked).toBe(false)
  })

  test("regex matcher works", async () => {
    writeProjectHook({
      PreToolUse: [{ matcher: "W.*", hooks: [{ command: "node -e \"process.exit(2)\"" }] }],
    })
    const r = await Hooks.preToolUse({ tool: "Write", toolInput: {}, sessionID: "s", callID: "c", cwd: tmp })
    expect(r.blocked).toBe(true)
  })

  test("PreToolUse block via JSON decision", async () => {
    writeProjectHook({
      PreToolUse: [{ hooks: [{ command: "node -e \"console.log(JSON.stringify({decision:'block',reason:'denied'}))\" " }] }],
    })
    const r = await Hooks.preToolUse({ tool: "Bash", toolInput: {}, sessionID: "s", callID: "c", cwd: tmp })
    expect(r.blocked).toBe(true)
    expect(r.blockReason).toContain("denied")
  })

  test("PreToolUse updatedInput and additionalContext", async () => {
    writeProjectHook({
      PreToolUse: [
        {
          hooks: [
            {
              command:
                "node -e \"console.log(JSON.stringify({updatedInput:{path:'rewritten.txt'},additionalContext:'be careful'}))\" ",
            },
          ],
        },
      ],
    })
    const r = await Hooks.preToolUse({
      tool: "Write",
      toolInput: { path: "a.txt" },
      sessionID: "s",
      callID: "c",
      cwd: tmp,
    })
    expect(r.blocked).toBe(false)
    expect(r.updatedInput).toEqual({ path: "rewritten.txt" })
    expect(r.additionalContext).toContain("be careful")
  })

  test("PostToolUse additionalContext", async () => {
    writeProjectHook({
      PostToolUse: [
        { hooks: [{ command: "node -e \"console.log(JSON.stringify({additionalContext:'post note'}))\" " }] },
      ],
    })
    const r = await Hooks.postToolUse({
      tool: "Read",
      toolInput: { path: "a.txt" },
      output: "file contents",
      sessionID: "s",
      callID: "c",
      cwd: tmp,
    })
    expect(r.additionalContext).toContain("post note")
  })

  test("invalid hook config is skipped, valid one still runs", async () => {
    writeProjectHook({
      PreToolUse: [{ hooks: [{ command: "node -e \"process.exit(2)\"" }] }],
      PostToolUse: "this is not a valid array",
    })
    const r = await Hooks.preToolUse({ tool: "Bash", toolInput: {}, sessionID: "s", callID: "c", cwd: tmp })
    expect(r.blocked).toBe(true)
  })

  test("load merges hooks found by walking up the directory tree", async () => {
    // parent project hook
    writeProjectHook({ PreToolUse: [{ matcher: "B", hooks: [{ command: "echo b" }] }] })
    // nested project hook
    const nested = path.join(tmp, "nested")
    const nestedDir = path.join(nested, ".ottili-coder")
    fs.mkdirSync(nestedDir, { recursive: true })
    fs.writeFileSync(
      path.join(nestedDir, "hooks.json"),
      JSON.stringify({ PreToolUse: [{ matcher: "A", hooks: [{ command: "echo a" }] }] }),
    )
    const cfg = Hooks.list(nested)
    expect(cfg.PreToolUse?.length).toBe(2)
  })
})
