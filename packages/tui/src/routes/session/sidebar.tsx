import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { getScrollAcceleration } from "../../util/scroll"
import { BrandLabel } from "../../component/brand-label"
import { WorkspaceLabel } from "../../component/workspace-label"
import { SplitBorder } from "../../ui/border"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Spinner } from "../../component/spinner"
import { useLocal } from "../../context/local"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogSessionDeleteFailed } from "../../component/dialog-session-delete-failed"
import { openWorkspaceSelect, warpWorkspaceSession, type WorkspaceSelection } from "../../component/dialog-workspace-create"
import { errorMessage } from "../../util/error"
import {
  buildSidebar,
  flattenEntries,
  moveSelection,
  truncate,
  type SidebarEntry,
  type SidebarSession,
} from "./session-sidebar/model"
import {
  consumeSessionSidebarFocusSearch,
  requestSessionSidebarOpen,
  useSessionSidebarOpenRequest,
} from "./session-sidebar/controller"

export function Sidebar(props: { sessionID: string; overlay?: boolean; onClose?: () => void }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const session = createMemo(() => sync.session.get(props.sessionID))

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const [query, setQuery] = createSignal("")
  const [searchMode, setSearchMode] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [selectedID, setSelectedID] = createSignal<string | undefined>(props.sessionID)

  const openRequest = useSessionSidebarOpenRequest()

  const sessions = createMemo<SidebarSession[]>(() =>
    sync.data.session.map((x) => ({
      id: x.id,
      title: x.title,
      parentID: x.parentID,
      directory: x.directory,
      path: x.path,
      workspaceID: x.workspaceID,
      time: { updated: x.time.updated, archived: x.time.archived ?? null },
    })),
  )

  const slotByID = createMemo(() => new Map(local.session.slots().map((id, i) => [id, i + 1])))

  const model = createMemo(() =>
    buildSidebar({
      sessions: sessions(),
      pinnedIDs: local.session.pinned(),
      slotByID: slotByID(),
      currentID: props.sessionID,
      statuses: sync.data.session_status,
      projectMainDir: project.data.project.mainDir,
      query: query(),
    }),
  )

  const entries = createMemo(() => flattenEntries(model()))

  // Keep the selection valid as the list changes (search, archive, refresh).
  createEffect(() => {
    const list = entries()
    const current = selectedID()
    if (!list.length) {
      if (current !== undefined) setSelectedID(undefined)
      return
    }
    if (!list.some((x) => x.id === current)) setSelectedID(list[0].id)
  })

  // Open request from `session.list` focuses the sidebar and optionally search.
  createEffect(
    on(openRequest, () => {
      setFocused(true)
      if (focusSearchRequest() > 0) setSearchMode(true)
    }),
  )

  function openSelected() {
    const id = selectedID()
    if (!id) return
    setFocused(false)
    if (id !== props.sessionID) route.navigate({ type: "session", sessionID: id })
  }

  function togglePinSelected() {
    const id = selectedID()
    if (id) local.session.togglePin(id)
  }

  function renameSelected() {
    const id = selectedID()
    if (id) dialog.replace(() => <DialogSessionRename session={id} />)
  }

  async function archiveSelected() {
    const id = selectedID()
    if (!id) return
    const result = await sdk.client.session.update({ sessionID: id, time: { archived: Date.now() } })
    if (result.error) {
      toast.show({ variant: "error", title: "Failed to archive session", message: errorMessage(result.error) })
      return
    }
    await sync.session.refresh()
    toast.show({ variant: "info", message: "Session archived" })
  }

  function recover(message: string, id: string) {
    const target = sync.data.session.find((x) => x.id === id)
    const workspaceID = target?.workspaceID
    if (!workspaceID) {
      toast.show({ variant: "error", title: "Failed to delete session", message })
      return
    }
    const workspace = project.workspace.get(workspaceID)
    const list = () => {
      dialog.clear()
      void sync.session.refresh()
    }
    const warp = async (selection: WorkspaceSelection) => {
      const nextWorkspaceID = await (async () => {
        if (selection.type === "none") return null
        if (selection.type === "existing") return selection.workspaceID
        const result = await sdk.client.experimental.workspace.create({
          type: selection.workspaceType,
          branch: null,
        })
        if (result.error || !result.data) {
          toast.show({ variant: "error", title: "Failed to create workspace", message: errorMessage(result.error) })
          return
        }
        await project.workspace.sync()
        return result.data.id
      })()
      if (nextWorkspaceID === undefined) return
      await warpWorkspaceSession({
        dialog,
        sdk,
        sync,
        project,
        toast,
        sourceWorkspaceID: workspaceID,
        workspaceID: nextWorkspaceID,
        sessionID: id,
        copyChanges: false,
        done: list,
      })
    }
    dialog.replace(() => (
      <DialogSessionDeleteFailed
        session={target.title}
        workspace={workspace?.name ?? workspaceID}
        onDone={list}
        onDelete={async () => {
          const result = await sdk.client.experimental.workspace.remove({ id: workspaceID })
          if (result.error) {
            toast.show({ variant: "error", title: "Failed to delete workspace", message: errorMessage(result.error) })
            return false
          }
          await project.workspace.sync()
          await sync.session.refresh()
          if (id === props.sessionID) route.navigate({ type: "home" })
          return true
        }}
        onRestore={() => {
          void openWorkspaceSelect({
            dialog,
            sdk,
            sync,
            project,
            toast,
            onSelect: (selection) => void warp(selection),
          })
          return false
        }}
      />
    ))
  }

  async function deleteSelected() {
    const id = selectedID()
    if (!id) return
    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete session?",
      "This permanently removes the session and all of its messages. This cannot be undone.",
      "delete",
    )
    if (confirmed !== true) return
    try {
      const result = await sdk.client.session.delete({ sessionID: id })
      if (result.error) {
        recover(errorMessage(result.error), id)
        return
      }
    } catch (err) {
      recover(errorMessage(err), id)
      return
    }
    if (id === props.sessionID) route.navigate({ type: "home" })
    await sync.session.refresh()
  }

  useKeyboard((event) => {
    if (!focused()) return
    if (searchMode()) {
      if (event.name === "escape") {
        setSearchMode(false)
        event.preventDefault()
        return
      }
      if (event.name === "return" || event.name === "enter") {
        setSearchMode(false)
        event.preventDefault()
        return
      }
      if (event.name === "backspace") {
        setQuery((value) => value.slice(0, -1))
        event.preventDefault()
        return
      }
      if (event.name === "space") {
        setQuery((value) => value + " ")
        event.preventDefault()
        return
      }
      if (event.name.length === 1 && !event.ctrl && !event.option) {
        setQuery((value) => value + event.name)
        event.preventDefault()
        return
      }
    }
    switch (event.name) {
      case "up":
        setSelectedID(moveSelection(entries(), selectedID(), -1))
        event.preventDefault()
        break
      case "down":
        setSelectedID(moveSelection(entries(), selectedID(), 1))
        event.preventDefault()
        break
      case "return":
      case "enter":
        openSelected()
        event.preventDefault()
        break
      case "p":
        togglePinSelected()
        event.preventDefault()
        break
      case "r":
        renameSelected()
        event.preventDefault()
        break
      case "a":
        archiveSelected()
        event.preventDefault()
        break
      case "d":
        void deleteSelected()
        event.preventDefault()
        break
      case "/":
        setSearchMode(true)
        event.preventDefault()
        break
      case "escape":
        setFocused(false)
        if (props.overlay) props.onClose?.()
        event.preventDefault()
        break
    }
  })

  function gutterFor(entry: SidebarEntry) {
    if (entry.id === selectedID()) return "▸"
    if (entry.slot !== undefined) return String(entry.slot)
    if (entry.isPinned) return "★"
    return " "
  }

  return (
    <Show when={session()}>
      <box
        aria-label="session sidebar"
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
        border={props.overlay ? ["left"] : undefined}
        borderColor={props.overlay ? theme.borderSubtle : undefined}
        customBorderChars={props.overlay ? SplitBorder.customBorderChars : undefined}
        flexDirection="column"
      >
        <box
          flexShrink={0}
          flexDirection="row"
          gap={1}
          alignItems="center"
          paddingBottom={1}
          onMouseDown={() => setSearchMode(true)}
        >
          <text fg={theme.textMuted}>⌕</text>
          <Show
            when={searchMode() || query()}
            fallback={<text fg={theme.textMuted}>sessions</text>}
          >
            <text fg={searchMode() ? theme.primary : theme.text}>
              {searchMode() ? `${query()}` : query()}
            </text>
          </Show>
        </box>

        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <For each={model().pinned}>
            {(entry) => <SessionRow entry={entry} />}
          </For>
          <For each={model().groups}>
            {(group) => (
              <box flexShrink={0} flexDirection="column">
                <text
                  fg={theme.textMuted}
                  paddingTop={group.key === "Today" ? 0 : 1}
                >
                  {group.key}
                </text>
                <For each={group.entries}>{(entry) => <SessionRow entry={entry} />}</For>
              </box>
            )}
          </For>
          <Show when={entries().length === 0 && model().isSearching}>
            <text fg={theme.textMuted}>No matches</text>
          </Show>
          <Show when={entries().length === 0 && !model().isSearching}>
            <text fg={theme.textMuted}>No sessions yet</text>
          </Show>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1} paddingRight={1}>
          <pluginRuntime.Slot
            name="sidebar_title"
            mode="single_winner"
            session_id={props.sessionID}
            title={session()!.title}
            share_url={session()!.share?.url}
          >
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session()!.title}</b>
              </text>
              <Show when={session()!.workspaceID}>
                <text fg={theme.textMuted}>
                  <Show
                    when={workspace()}
                    fallback={
                      <WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />
                    }
                  >
                    {(item) => (
                      <WorkspaceLabel
                        type={item().type}
                        name={item().name}
                        status={project.workspace.status(item().id) ?? "error"}
                        icon
                      />
                    )}
                  </Show>
                </text>
              </Show>
              <Show when={session()!.share?.url}>
                <text fg={theme.textMuted}>{session()!.share!.url}</text>
              </Show>
            </box>
          </pluginRuntime.Slot>
        </box>

        <box flexShrink={0} maxHeight={Math.max(8, Math.floor(dimensions().height * 0.3))} overflow="hidden">
          <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
        </box>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <BrandLabel fg={theme.text} muted={theme.textMuted} version={InstallationVersion} />
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )

  function workspace() {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }

  function SessionRow(props: { entry: SidebarEntry }) {
    const entry = props.entry
    const isSelected = createMemo(() => entry.id === selectedID())
    return (
      <box
        flexShrink={0}
        flexDirection="row"
        gap={1}
        alignItems="center"
        backgroundColor={isSelected() ? theme.backgroundElement : undefined}
        onMouseDown={() => {
          setSelectedID(entry.id)
          openSelected()
        }}
      >
        <text fg={isSelected() ? theme.primary : theme.textMuted} flexShrink={0}>
          {gutterFor(entry)}
        </text>
        <text fg={isSelected() ? theme.selectedListItemText : theme.text} flexGrow={1} flexShrink={1}>
          {truncate(entry.title, 26)}
        </text>
        <Show when={entry.resume === "busy"}>
          <Spinner />
        </Show>
        <Show when={entry.resume === "retry"}>
          <text fg={theme.warning} flexShrink={0}>
            ↻
          </text>
        </Show>
        <Show when={entry.directory}>
          <text fg={theme.textMuted} flexShrink={0}>
            {truncate(entry.directory, 12)}
          </text>
        </Show>
      </box>
    )
  }
}
