import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Process } from "@/util/process"
import { Hooks } from "@/hooks"

function version(): string {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json")
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "unknown"
  } catch {
    return "unknown"
  }
}

async function run(cmd: string[]): Promise<string | undefined> {
  try {
    const out = await Process.text(cmd, { nothrow: true, timeout: 5000 })
    return out.code === 0 ? out.text.trim() : undefined
  } catch {
    return undefined
  }
}

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "OPENROUTER_API_KEY",
  "OTTILI_CODER_API_KEY",
  "XAI_API_KEY",
]

export async function report(cwd: string): Promise<string> {
  const lines: string[] = ["# Ottili Coder doctor", ""]

  lines.push(`- **version**: ${version()}`)
  lines.push(`- **runtime**: bun ${process.versions.bun ?? "n/a"} / node ${process.versions.node}`)
  lines.push(`- **platform**: ${process.platform} ${process.arch}`)
  lines.push(`- **cwd**: ${cwd}`)

  const gitVersion = await run(["git", "--version"])
  lines.push(`- **git**: ${gitVersion ?? "not found"}`)
  if (gitVersion) {
    const root = await run(["git", "rev-parse", "--show-toplevel"])
    lines.push(`  - **repo root**: ${root ?? "(not a git repository)"}`)
  }

  const hooks = Hooks.list(cwd)
  const hookEvents = Object.keys(hooks).filter((k) => (hooks as Record<string, unknown>)[k])
  lines.push(`- **hooks**: ${hookEvents.length ? hookEvents.join(", ") : "none configured"}`)

  const providers = PROVIDER_ENV.filter((name) => process.env[name]).map((name) => name.replace(/_API_KEY$/, ""))
  lines.push(`- **provider keys present**: ${providers.length ? providers.join(", ") : "none"}`)

  lines.push("")
  lines.push("If a tool or provider is unavailable, set the relevant API key in your environment,")
  lines.push("or configure it via `ottiliCoder.json` / your account.")
  return lines.join("\n")
}
