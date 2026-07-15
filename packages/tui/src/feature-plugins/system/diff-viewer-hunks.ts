import type { VcsFileDiff } from "@opencode-ai/sdk/v2"

export type ParsedPatch = {
  readonly prelude: readonly string[]
  readonly hunks: readonly string[]
}

export type HunkHeader = {
  readonly index: number
  readonly header: string
}

const HUNK_PREFIX = "@@"

export function isHunkHeader(line: string): boolean {
  return line.startsWith(HUNK_PREFIX)
}

export function parsePatchHunks(patch: string | undefined): ParsedPatch {
  if (!patch) return { prelude: [], hunks: [] }
  const lines = patch.split("\n")
  const firstHunk = lines.findIndex(isHunkHeader)
  if (firstHunk === -1) return { prelude: lines, hunks: [] }
  const prelude = lines.slice(0, firstHunk)
  const rest = lines.slice(firstHunk)
  const hunks: string[] = []
  let current: string[] = []
  for (const line of rest) {
    if (isHunkHeader(line) && current.length > 0) {
      hunks.push(current.join("\n"))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) hunks.push(current.join("\n"))
  return { prelude, hunks }
}

export function countHunks(patch: string | undefined): number {
  return parsePatchHunks(patch).hunks.length
}

export function hunkHeaders(patch: string | undefined): readonly HunkHeader[] {
  return parsePatchHunks(patch).hunks.map((hunk, index) => ({
    index,
    header: hunk.split("\n")[0] ?? "",
  }))
}

export function buildPatch(prelude: readonly string[], hunks: readonly string[]): string {
  if (hunks.length === 0) return ""
  return [...prelude, ...hunks].join("\n")
}

export function buildAcceptedPatch(
  patch: string | undefined,
  accepted: ReadonlySet<number>,
): string {
  const { prelude, hunks } = parsePatchHunks(patch)
  if (accepted.size === 0) return ""
  const selected = hunks.filter((_, index) => accepted.has(index))
  return buildPatch(prelude, selected)
}

export function diffHasAccepted(patch: string | undefined, accepted: ReadonlySet<number>): boolean {
  if (accepted.size === 0) return false
  const total = countHunks(patch)
  for (let index = 0; index < total; index++) {
    if (accepted.has(index)) return true
  }
  return false
}

export function diffAcceptsAll(
  patch: string | undefined,
  accepted: ReadonlySet<number>,
): boolean {
  const total = countHunks(patch)
  if (total === 0) return false
  if (accepted.size !== total) return false
  for (let index = 0; index < total; index++) {
    if (!accepted.has(index)) return false
  }
  return true
}

export function normalizeAccepted(
  patch: string | undefined,
  accepted: ReadonlySet<number>,
): Set<number> {
  const total = countHunks(patch)
  const next = new Set<number>()
  for (const index of accepted) {
    if (index >= 0 && index < total) next.add(index)
  }
  return next
}

export function patchFileName(file: VcsFileDiff): string {
  return file.file
}
