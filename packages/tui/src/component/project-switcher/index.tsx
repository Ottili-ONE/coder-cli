import { TextAttributes } from "@opentui/core"
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
import { useBindings } from "../keymap"
import { useTerminalDimensions } from "@opentui/solid"
import {
  buildProjectSwitcherState,
  classifyError,
  connectionGlyph,
  flattenWorktrees,
  hiddenWorktreeCount,
  lifecycleGlyph,
  NARROW_WIDTH_DEFAULT,
  projectSwitcherColorSupport,
  redactProjectSwitcherError,
  RENDER_BUDGET_DEFAULT,
  type ProjectSwitcherContext,
  type ProjectSwitcherStatus,
  type ProjectWorktree,
} from "./model"

function statusColor(status: ProjectSwitcherStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "offline" || status === "denied" || status === "failure") return theme.error
  if (status === "loading") return theme.textMuted
  if (status === "degraded") return theme.warning
  return theme.text
}

function connectionColor(status: ProjectWorktree["status"], theme: ReturnType<typeof useTheme>["theme"]) {
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
  const dimensions = useTerminalDimensions()

  const [deleting, setDeleting] = createSignal<string>()
  const [removing, setRemoving] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)
  const [errored, setErrored] = createSignal<string>()
  const [partial, setPartial] = createSignal(false)
  const [showAll, setShowAll] = createSignal(false)
  const [renderBudget, setRenderBudget] = createSignal(RENDER_BUDGET_DEFAULT)

  const useColor = () => projectSwitcherColorSupport().useColor
  const width = () => dimensions().width
  const narrow = () => width() < NARROW_WIDTH_DEFAULT

  const current = createMemo(() => {
    if (route.data.type === "session") return sync.session.get(route.data.sessionID)?.workspaceID
    return project.workspace.current()
  })

  // Classify the load error into the blocking lifecycle state it should surface
  // (offline / denied / failure) so the context can drive the model.
  const classified = createMemo(() => (errored() ? classifyError(errored()) : undefined))
  const context = createMemo<ProjectSwitcherContext>(() => ({
    loading: loading(),
    connected: !errored() || classified() !== "offline",
    permitted: !errored() || classified() !== "denied",
    partial: partial(),
    error: errored() && classified() === "failure" ? redactProjectSwitcherError(errored()!) : undefined,
  }))

  const state = createMemo(() =>
    buildProjectSwitcherState(
      {
        workspaces: project.workspace.list(),
        statuses: project.workspace.statuses(),
        currentID: current(),
        loading: loading(),
      },
      context(),
      { showAll: showAll(), renderBudget: renderBudget() },
    ),
  )

  const status = () => state().status
  const allWorktrees = createMemo(() => flattenWorktrees(state().model))

  const currentValue = createMemo(() => allWorktrees().find((w) => w.id === current()))

  const visibleWorktrees = createMemo(() => allWorktrees().slice(0, state().visibleWorktrees))

  const options = createMemo<DialogSelectOption<ProjectWorktree>[]>(() =>
    visibleWorktrees().map((wt) => {
      const title = narrow() && wt.branch ? wt.name : wt.branch ? `${wt.name} · ${wt.branch}` : wt.name
      const details = wt.directory ? [wt.directory] : undefined
      const footerParts = [wt.location === "cloud" ? "cloud" : "local"]
      if (!useColor()) footerParts.push(connectionGlyph(wt.status, false))
      const gutterTitle = !useColor() && wt.isCurrent ? `› ${title}` : title
      return {
        title: gutterTitle,
        value: wt,
        details,
        footer: footerParts.join(" · "),
        category: state().model.repositories.find((r) => r.worktrees.some((w) => w.id === wt.id))?.name ?? "",
        truncateTitle: narrow(),
        gutter: () => (
          <text fg={useColor() ? connectionColor(wt.status, theme) : theme.textMuted}>
            {connectionGlyph(wt.status, useColor())}
          </text>
        ),
      }
    }),
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
        message: redactProjectSwitcherError(errorMessage(result.error)),
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
    setPartial(false)
    const [syncRes, listRes] = await Promise.allSettled([
      sdk.client.experimental.workspace.syncList().catch(() => undefined),
      project.workspace.sync().catch((e) => e),
    ])
    const syncErr = syncRes.status === "rejected" ? errorMessage(syncRes.reason) : undefined
    const listErr = listRes.status === "rejected" ? errorMessage(listRes.reason) : undefined
    if (syncErr && listErr) {
      // Both sources failed: this is a hard, blocking failure.
      setErrored(syncErr)
      setPartial(false)
    } else if (syncErr || listErr) {
      // One source returned partial data: still usable, surfaced as degraded.
      setErrored(undefined)
      setPartial(true)
    } else {
      setErrored(undefined)
      setPartial(false)
    }
    setLoading(false)
  }

  const showList = createMemo(() => status() === "degraded" || status() === "long-content" || status() === "populated")
  const hidden = createMemo(() => hiddenWorktreeCount(state()))
  const canRetry = createMemo(
    () => status() === "offline" || status() === "denied" || status() === "failure" || state().context.partial,
  )

  return (
    <Show
      when={showList()}
      fallback={
        <StateView
          status={status()}
          summary={redactProjectSwitcherError(state().context.error ?? "")}
          canRetry={canRetry()}
          onRetry={() => void load()}
        />
      }
    >
      <box gap={1} paddingBottom={1} flexGrow={1}>
        <Show when={status() !== "populated"}>
          <box paddingLeft={4} paddingRight={4}>
            <text id="project-switcher-status" live fg={statusColor(status(), theme)} wrapMode="none">
              {`${lifecycleGlyph(status(), useColor())} ${lifecycleSummary(status(), state().totalWorktrees, state().renderBudget)}`}
            </text>
          </box>
        </Show>
        <DialogSelect<ProjectWorktree>
          title="Projects"
          options={options()}
          current={currentValue()}
          onSelect={(option) => void switchTo(option.value)}
          onFilter={() => setShowAll(false)}
          actions={[
            {
              command: "session.delete",
              title: "delete",
              onTrigger: (option) => void remove(option.value),
            },
          ]}
          footerHints={
            hidden() > 0 ? [{ title: "Show all", label: "a" }] : undefined
          }
          bindings={[
            {
              key: "a",
              desc: "Show all repositories",
              group: "Dialog",
              cmd: () => setShowAll((v) => !v),
            },
          ]}
        />
      </box>
    </Show>
  )
}

function lifecycleSummary(status: ProjectSwitcherStatus, count: number, budget: number): string {
  const noun = `${count} repositor${count === 1 ? "y" : "ies"}`
  if (status === "degraded") return `${noun} (degraded)`
  if (status === "long-content") return `${noun} (showing ${budget})`
  return noun
}

function StateView(props: {
  status: ProjectSwitcherStatus
  summary: string
  canRetry: boolean
  onRetry: () => void
}): JSX.Element {
  const dialog = useDialog()
  const { theme } = useTheme()
  const useColor = () => projectSwitcherColorSupport().useColor

  // Keep retry reachable from the keyboard so the blocked states are actionable
  // and focus is never trapped in a non-interactive view.
  useBindings(() => ({
    commands: [
      {
        name: "project.switcher.retry",
        title: "Retry",
        category: "Dialog",
        run: () => props.onRetry(),
      },
    ],
    bindings: props.canRetry
      ? [{ key: "r", desc: "Retry", group: "Dialog", cmd: () => props.onRetry() }]
      : [],
  }))

  const message = createMemo(() => {
    switch (props.status) {
      case "loading":
        return "Loading projects…"
      case "offline":
        return "Projects unavailable — offline"
      case "denied":
        return "Projects hidden — insufficient permission"
      case "failure":
        return props.summary ? `Failed to load projects — ${props.summary}` : "Failed to load projects"
      case "empty":
        return "No repositories yet. Create one with /workspace."
      default:
        return "No repositories"
    }
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
        <text id="project-switcher-status" live fg={statusColor(props.status, theme)} wrapMode="none">
          {`${lifecycleGlyph(props.status, useColor())} ${message()}`}
        </text>
      </box>
      <Show when={props.canRetry}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted} onMouseUp={() => props.onRetry()}>
            {`press r to retry · esc to close`}
          </text>
        </box>
      </Show>
    </box>
  )
}
