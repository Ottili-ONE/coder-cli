import { TextAttributes } from "@opentui/core"
import type { Workspace } from "@opencode-ai/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useProject } from "../context/project"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { createMemo, createSignal, onMount, Show, type JSX } from "solid-js"
import { errorMessage } from "../util/error"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import {
  buildProjectSwitcher,
  flattenWorktrees,
  type ProjectWorktree,
  type WorkspaceConnectionStatus,
} from "./model"

function statusColor(status: WorkspaceConnectionStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "connected") return theme.success
  if (status === "connecting") return theme.warning
  if (status === "error" || status === "disconnected") return theme.error
  return theme.textMuted
}

/** Redesigned Project switcher: repositories, worktrees, local/cloud state and fast switching. */
export function DialogProjectSwitcher() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const project = useProject()
  const { theme } = useTheme()

  const [deleting, setDeleting] = createSignal<string>()
  const [removing, setRemoving] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)
  const [errored, setErrored] = createSignal<string>()

  const current = createMemo(() => {
    if (route.data.type === "session") return sync.session.get(route.data.sessionID)?.workspaceID
    return project.workspace.current()
  })

  const model = createMemo(() =>
    buildProjectSwitcher({
      workspaces: project.workspace.list(),
      statuses: project.workspace.statuses(),
      currentID: current(),
      loading: loading(),
    }),
  )

  const currentValue = createMemo(() => flattenWorktrees(model()).find((w) => w.id === current()))

  const options = createMemo<DialogSelectOption<ProjectWorktree>[]>(() =>
    flattenWorktrees(model()).map((wt) => ({
      title: wt.branch ? `${wt.name} · ${wt.branch}` : wt.name,
      value: wt,
      details: wt.directory ? [wt.directory] : undefined,
      footer: wt.location === "cloud" ? "cloud" : "local",
      category: model().repositories.find((r) => r.worktrees.some((w) => w.id === wt.id))?.name ?? "",
      gutter: () => <text fg={statusColor(wt.status, theme)}>●</text>,
    })),
  )

  async function switchTo(worktree: ProjectWorktree) {
    if (worktree.id === current()) {
      dialog.clear()
      return
    }
    project.workspace.set(worktree.id)
    await sync.bootstrap({ fatal: false }).catch(() => undefined)
    if (route.data.type === "session") route.navigate({ type: "home" })
    dialog.clear()
  }

  async function remove(worktree: ProjectWorktree) {
    if (removing()) return
    if (deleting() !== worktree.id) {
      setDeleting(worktree.id)
      return
    }

    setDeleting(undefined)
    setRemoving(worktree.id)
    const result = await sdk.client.experimental.workspace.remove({ id: worktree.id }).catch((err) => ({
      error: err,
    }))
    if (result?.error) {
      setRemoving(undefined)
      toast.show({
        variant: "error",
        title: "Failed to delete workspace",
        message: errorMessage(result.error),
      })
      return
    }

    if (current() === worktree.id) {
      project.workspace.set(undefined)
      route.navigate({ type: "home" })
    }
    await project.workspace.sync()
    await sync.bootstrap({ fatal: false }).catch(() => undefined)
    setRemoving(undefined)
  }

  onMount(() => {
    dialog.setSize("large")
    void load()
  })

  async function load() {
    setLoading(true)
    setErrored(undefined)
    const [syncRes, listRes] = await Promise.allSettled([
      sdk.client.experimental.workspace.syncList().catch(() => undefined),
      project.workspace.sync().catch((e) => e),
    ])
    if (syncRes.status === "rejected") setErrored(errorMessage(syncRes.reason))
    else if (listRes.status === "rejected") setErrored(errorMessage(listRes.reason))
    setLoading(false)
  }

  return (
    <Show when={model().status === "ready"} fallback={<StateView status={model().status} error={errored()} />}>
      <DialogSelect<ProjectWorktree>
        title="Projects"
        options={options()}
        current={currentValue()}
        onSelect={(option) => void switchTo(option.value)}
        actions={[
          {
            command: "session.delete",
            title: "delete",
            onTrigger: (option) => void remove(option.value),
          },
        ]}
      />
    </Show>
  )
}

function StateView(props: { status: "loading" | "empty"; error?: string }): JSX.Element {
  const dialog = useDialog()
  const { theme } = useTheme()

  const message = createMemo(() => {
    if (props.error) return props.error
    if (props.status === "loading") return "Loading projects…"
    return "No repositories yet. Create one with /workspace."
  })

  return (
    <box gap={1} paddingBottom={1} flexGrow={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Projects
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>{message()}</text>
      </box>
    </box>
  )
}
