import fs from "fs"
import path from "path"

export function loadOptionalEnvFiles(files: string[]) {
  for (const file of files) {
    loadEnvFile(file)
  }
}

export function loadEnvFile(filePath: string) {
  try {
    const text = fs.readFileSync(filePath, "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch {
    // optional env files
  }
}

export function resolveOpenRouterApiKey(explicit?: string) {
  const key = explicit?.trim() || process.env.OPENROUTER_API_KEY?.trim()
  return key || undefined
}

function walkUpKeysEnv(start: string, maxDepth = 8) {
  const files: string[] = []
  let current = path.resolve(start)
  for (let depth = 0; depth < maxDepth; depth++) {
    files.push(path.join(current, "keys/.env"))
    files.push(path.join(current, ".env"))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return files
}

export function defaultEnvFileCandidates(input: { directory: string; worktree: string }) {
  const files: string[] = []
  const explicit = process.env.OTTILI_ENV_FILE?.trim()
  if (explicit) files.push(explicit)

  const roots = [input.directory, input.worktree, process.cwd()]
  for (const root of roots) {
    if (!root) continue
    files.push(...walkUpKeysEnv(root))
    files.push(path.join(root, "../keys/.env"))
    files.push(path.join(root, "repo/ottili_one_v1/keys/.env"))
    files.push(path.join(root, "../repo/ottili_one_v1/keys/.env"))
  }

  const home = process.env.HOME?.trim()
  if (home) {
    files.push(path.join(home, ".ottili/keys/.env"))
  }

  return [...new Set(files)]
}

export function bootstrapEnvFiles(input: { directory: string; worktree: string }) {
  loadOptionalEnvFiles(defaultEnvFileCandidates(input))
}
