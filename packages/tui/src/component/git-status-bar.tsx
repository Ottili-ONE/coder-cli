import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogGitStatus } from "./dialog-git-status"

type GitInfo = NonNullable<TuiPluginApi["state"]["vcs"]>

const REFRESH_MS = 5000

export function GitStatusBar(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const directory = () => props.api.state.path.directory

  const [live, setLive] = createSignal<GitInfo | undefined>(undefined)

  const refresh = () => {
    const dir = directory()
    if (!dir) return
    void props.api.client.vcs
      .get({ directory: dir })
      .then((x) => setLive((x.data ?? undefined) as GitInfo | undefined))
      .catch(() => {})
  }

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })

  const info = createMemo(() => live() ?? props.api.state.vcs)

  const open = () => props.api.ui.dialog.replace(() => <DialogGitStatus />)

  return (
    <Show when={info()}>
      {(data) => (
        <box
          flexDirection="row"
          gap={1}
          alignItems="center"
          flexShrink={0}
          onMouseDown={open}
        >
          <text fg={theme().primary} attributes={TextAttributes.BOLD}>
            ⎇ {data().branch ?? "HEAD"}
          </text>

          <Show when={data().dirty}>
            {(dirty) => (
              <>
                <Show when={dirty().added > 0}>
                  <text fg={theme().success}>✚{dirty().added}</text>
                </Show>
                <Show when={dirty().modified > 0}>
                  <text fg={theme().warning}>◆{dirty().modified}</text>
                </Show>
                <Show when={dirty().deleted > 0}>
                  <text fg={theme().error}>−{dirty().deleted}</text>
                </Show>
                <Show when={dirty().untracked > 0}>
                  <text fg={theme().info}>?{dirty().untracked}</text>
                </Show>
              </>
            )}
          </Show>

          <Show when={(data().ahead ?? 0) > 0 || (data().behind ?? 0) > 0}>
            <text fg={(data().behind ?? 0) > 0 ? theme().warning : theme().info}>
              ↑{data().ahead ?? 0} ↓{data().behind ?? 0}
            </text>
          </Show>

          <Show when={data().conflict && data().conflict > 0}>
            <text fg={theme().error} attributes={TextAttributes.BOLD}>
              ⚠{data().conflict}
            </text>
          </Show>

          <Show when={data().worktree && data().worktree > 1}>
            <text fg={theme().primary}>⑂{data().worktree}</text>
          </Show>
        </box>
      )}
    </Show>
  )
}
