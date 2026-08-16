/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import { ConflictResolutionView } from "./index"
import {
  type ConflictFile,
  type ConflictType,
  makeConflict,
  normalizeConflictType,
} from "./model"

/** Minimum interval between manual refreshes (ms). Prevents rapid re-triggers. */
const REFRESH_THROTTLE_MS = 500

/** Read unmerged files and the in-progress operation from git. */
async function loadGitConflicts(dir: string): Promise<ConflictFile[]> {
  const run = async (args: string[]): Promise<string> => {
    const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    return (await new Response(proc.stdout).text()).trim()
  }

  let operation: ConflictType = "unknown"
  try {
    if ((await run(["rev-parse", "--git-path", "MERGE_HEAD"])).length > 0) operation = "merge"
  } catch {}
  if (operation === "unknown") {
    try {
      if ((await run(["rev-parse", "--git-path", "rebase-merge"])).length > 0) operation = "rebase"
    } catch {}
  }

  // Check each conflicted file for conflict region counts.
  const raw = await run(["diff", "--name-only", "--diff-filter=U"])
  if (!raw) return []

  const paths = raw.split("\n").filter(Boolean)
  const results: ConflictFile[] = []

  for (const p of paths) {
    let conflictRegions: number | undefined
    let additions: number | undefined
    let deletions: number | undefined

    try {
      const content = await Bun.file(`${dir}/${p}`).text()
      const markers = content.match(/<<<<<<< /g)
      conflictRegions = markers ? markers.length : 0

      const ourLines = content.match(/<<<<<<<.*?\n([\s\S]*?)======/g)
      if (ourLines) {
        additions = ourLines.reduce((sum, block) => {
          const lines = block.split("\n").length - 2
          return sum + Math.max(0, lines)
        }, 0)
      }

      const theirLines = content.match(/=======\n([\s\S]*?)>>>>>>>/g)
      if (theirLines) {
        deletions = theirLines.reduce((sum, block) => {
          const lines = block.split("\n").length - 1
          return sum + Math.max(0, lines)
        }, 0)
      }
    } catch {
      // Binary or unreadable file — no region stats available.
    }

    const file = makeConflict(p, operation, {
      conflictRegions,
      additions,
      deletions,
      binary: conflictRegions === undefined,
    })
    results.push(file)
  }

  return results
}

/** Classify a git-specific error into a friendly message. */
function classifyGitError(raw: string): string {
  const lower = raw.toLowerCase()
  if (/not a git repository/i.test(lower) || /fatal: not a git repository/i.test(lower)) {
    return "Not a git repository"
  }
  if (/detected dubious ownership/i.test(lower)) {
    return "Dubious repository ownership — verify the directory is safe"
  }
  if (/permission denied|access is denied|fatal: could not/i.test(lower)) {
    return "Git permission denied — check your access rights"
  }
  if (/could not resolve host|could not connect|connection refused|network is unreachable/i.test(lower)) {
    return "Network unreachable — check your connection"
  }
  if (/repository corrupt|bad object|index corrupt/i.test(lower)) {
    return "Git repository is corrupted — run git fsck"
  }
  return raw
}

export interface DialogConflictResolutionProps {
  /** Plugin API used to locate the working directory and load conflicts. */
  api?: TuiPluginApi
  /** Override the conflict loader (used by tests / non-git sources). */
  loadConflicts?: () => Promise<ConflictFile[]>
  /** Fired when the user continues or aborts the operation. */
  onResolve?: (action: "continue" | "abort") => void
  /** Auto-refresh interval in ms. 0 = no auto-refresh. Default: 0. */
  refreshInterval?: number
}

export function DialogConflictResolution(props: DialogConflictResolutionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [files, setFiles] = createSignal<ConflictFile[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [lastRefresh, setLastRefresh] = createSignal(0)

  const operation = createMemo<ConflictType>(
    () => files().find((f) => f.type !== "unknown")?.type ?? "unknown",
  )

  const load = () => {
    // Throttle rapid manual refreshes.
    const now = Date.now()
    if (now - lastRefresh() < REFRESH_THROTTLE_MS) return
    setLastRefresh(now)

    setLoading(true)
    setError(undefined)
    const loader =
      props.loadConflicts ??
      (props.api
        ? () => loadGitConflicts(props.api!.state.path.directory)
        : () => Promise.resolve<ConflictFile[]>([]))
    return loader()
      .then((list) => {
        setFiles(list.map((f) => ({ ...f, type: normalizeConflictType(f.type) })))
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setError(classifyGitError(message))
      })
      .finally(() => setLoading(false))
  }

  onMount(load)

  // Auto-refresh timer (capped to allow user to see current state between polls).
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  if (props.refreshInterval && props.refreshInterval > 0) {
    onMount(() => {
      refreshTimer = setInterval(load, props.refreshInterval)
    })
    onCleanup(() => {
      if (refreshTimer) clearInterval(refreshTimer)
    })
  }

  const handleRefresh = () => {
    load()
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        Conflict resolution
      </text>
      <Show when={!loading() && !error()} fallback={
        <Show when={error()} fallback={
          <text id="conflict-dialog-loading" fg={theme.textMuted}>
            Scanning for conflicts…
          </text>
        }>
          <box id="conflict-dialog-error" flexDirection="column" gap={1}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>Failed to load conflicts</text>
            <text fg={theme.textMuted} wrapMode="word">
              {error()}
            </text>
            <text fg={theme.textMuted} onMouseUp={handleRefresh}>
              [r]etry
            </text>
          </box>
        </Show>
      }>
        <ConflictResolutionView
          files={files}
          operation={operation}
          loading={loading}
          error={error}
          onRefresh={handleRefresh}
          onAction={(action) => {
            if (action.type === "continue") props.onResolve?.("continue")
            else if (action.type === "abort") {
              props.onResolve?.("abort")
              dialog.clear()
            }
          }}
        />
      </Show>
    </box>
  )
}

export default DialogConflictResolution