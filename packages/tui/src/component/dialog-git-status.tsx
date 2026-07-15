import { TextAttributes } from "@opentui/core"
import { For, Match, Show, Switch, createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"

type GitFile = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

const statusGlyph: Record<GitFile["status"], string> = {
  added: "✚",
  modified: "◆",
  deleted: "−",
}

export function DialogGitStatus() {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const vcs = createMemo(() => sync.data.vcs)
  const directory = createMemo(() => sync.path.directory)

  const [files, setFiles] = createSignal<GitFile[]>([])
  const [loading, setLoading] = createSignal(true)

  const refresh = () => {
    const dir = directory()
    if (!dir) {
      setLoading(false)
      return
    }
    setLoading(true)
    void sdk.client.vcs
      .status({ directory: dir })
      .then((x) => setFiles((x.data ?? []) as GitFile[]))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false))
  }

  onMount(refresh)

  const upstream = createMemo(() => {
    const info = vcs()
    if (!info) return undefined
    if (info.ahead === undefined && info.behind === undefined) return undefined
    return { ahead: info.ahead ?? 0, behind: info.behind ?? 0 }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Git
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={vcs()}
        fallback={
          <text fg={theme.textMuted} wrapMode="word">
            Not a git repository in this directory.
          </text>
        }
      >
        {(info) => (
          <box gap={1}>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                ⎇ {info().branch ?? "(detached)"}
              </text>
              <Show when={info().default_branch && info().default_branch !== info().branch}>
                <text fg={theme.textMuted}>default: {info().default_branch}</text>
              </Show>
            </box>

            <Show when={upstream()}>
              {(u) => (
                <box flexDirection="row" gap={1}>
                  <text
                    fg={u().ahead > 0 ? theme.info : theme.textMuted}
                    attributes={u().ahead > 0 ? TextAttributes.BOLD : undefined}
                  >
                    ↑ {u().ahead} ahead
                  </text>
                  <text
                    fg={u().behind > 0 ? theme.warning : theme.textMuted}
                    attributes={u().behind > 0 ? TextAttributes.BOLD : undefined}
                  >
                    ↓ {u().behind} behind
                  </text>
                </box>
              )}
            </Show>

            <Show when={info().conflict && info().conflict > 0}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                ⚠ {info().conflict} conflict{info().conflict === 1 ? "" : "s"}
              </text>
            </Show>

            <Show when={info().worktree && info().worktree > 1}>
              <text fg={theme.primary}>⑂ {info().worktree} worktrees</text>
            </Show>

            <Show when={info().dirty}>
              {(dirty) => (
                <box flexDirection="row" gap={2} flexWrap="wrap">
                  <Show when={dirty().added > 0}>
                    <text fg={theme.success}>✚ {dirty().added} added</text>
                  </Show>
                  <Show when={dirty().modified > 0}>
                    <text fg={theme.warning}>◆ {dirty().modified} modified</text>
                  </Show>
                  <Show when={dirty().deleted > 0}>
                    <text fg={theme.error}>− {dirty().deleted} deleted</text>
                  </Show>
                  <Show when={dirty().untracked > 0}>
                    <text fg={theme.info}>? {dirty().untracked} untracked</text>
                  </Show>
                </box>
              )}
            </Show>

            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Working tree</text>
              <Show when={loading()} fallback={<text fg={theme.textMuted}>·</text>}>
                <text fg={theme.textMuted}>…</text>
              </Show>
            </box>

            <For each={files()}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    fg={
                      item.status === "added"
                        ? theme.success
                        : item.status === "deleted"
                          ? theme.error
                          : theme.warning
                    }
                  >
                    {statusGlyph[item.status]}
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    {item.file}
                  </text>
                  <text fg={theme.textMuted}>
                    <Show when={item.additions > 0}>
                      <span style={{ fg: theme.success }}>+{item.additions}</span>
                    </Show>{" "}
                    <Show when={item.deletions > 0}>
                      <span style={{ fg: theme.error }}>−{item.deletions}</span>
                    </Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        )}
      </Show>
    </box>
  )
}
