/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import {
  TextAttributes,
  type BorderSides,
  type BoxRenderable,
  type DiffRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core"
import { LANGUAGE_EXTENSIONS } from "../../util/filetype"
import { useBindings, useCommandShortcut } from "../../keymap"
import { useTheme } from "../../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { DiffViewerFileTree } from "./diff-viewer-file-tree"
import { Panel, PanelGroup, Separator } from "./diff-viewer-ui"
import { DialogSelect } from "../../ui/dialog-select"
import { getScrollAcceleration } from "../../util/scroll"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  type FileTreeRow,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  setFileTreeDirectoryExpanded,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "./diff-viewer-file-tree-utils"
import { buildAcceptedPatch, countHunks, normalizeAccepted } from "./diff-viewer-hunks"

const ROUTE = "diff"
const MIN_SPLIT_WIDTH = 100
const FILE_TREE_WIDTH = 32
const PLAIN_TEXT_FILETYPE = "ottili-coder-plain-text"
const WORKING_TREE_DIFF_CONTEXT_LINES = 12
const KV_SHOW_FILE_TREE = "diff_viewer_show_file_tree"
const KV_SINGLE_PATCH = "diff_viewer_single_patch"
const KV_VIEW = "diff_viewer_view"
type DiffMode = "git" | "last-turn"
type DiffViewerFocus = "patches" | "files"
type DiffView = "split" | "unified"
type SelectedHunk = { readonly fileIndex: number; readonly hunkIndex: number; readonly scrollTop: number }

type DiffFile = {
  readonly file: string
  readonly patch?: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

const normalizeDiffs = (diffs: readonly (VcsFileDiff | SnapshotFileDiff)[]): DiffFile[] =>
  diffs.flatMap((item) =>
    item.file
      ? [
          {
            file: item.file,
            patch: item.patch,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status ?? "modified",
          } satisfies DiffFile,
        ]
      : [],
  )

function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function storedView(value: unknown): DiffView | undefined {
  if (value === "split" || value === "unified") return value
}

function DiffViewer(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions()
  const themeState = useTheme()
  const theme = () => props.api.theme.current
  const params = () =>
    ("params" in props.api.route.current ? props.api.route.current.params : undefined) as
      | {
          mode?: DiffMode
          sessionID?: string
          messageID?: string
          returnRoute?: TuiRouteCurrent
        }
      | undefined
  const mode = () => params()?.mode ?? "git"
  const diffInput = createMemo(() => {
    const sessionID = params()?.sessionID
    return {
      mode: mode(),
      sessionID,
      messageID: params()?.messageID,
      directory: sessionID ? props.api.state.session.get(sessionID)?.directory : undefined,
    }
  })
  const [diff, diffResource] = createResource(diffInput, async (input) => {
    if (input.mode === "last-turn") {
      const sessionID = input.sessionID
      if (!sessionID) return []
      const result = await props.api.client.session.diff(
        { sessionID, messageID: input.messageID },
        { throwOnError: true },
      )
      return normalizeDiffs(result.data ?? [])
    }

    const result = await props.api.client.vcs.diff(
      { directory: input.directory, mode: "git", context: WORKING_TREE_DIFF_CONTEXT_LINES },
      { throwOnError: true },
    )
    return normalizeDiffs(result.data ?? [])
  })
  const files = createMemo(() => diff() ?? [])
  const [focus, setFocus] = createSignal<DiffViewerFocus>("patches")
  const [fileTreeEnabled, setFileTreeEnabled] = createSignal(
    props.api.kv.get<boolean>(KV_SHOW_FILE_TREE, true) !== false,
  )
  const showFileTree = createMemo(() => showDiffViewerFileTree(fileTreeEnabled(), files().length))
  const [singlePatch, setSinglePatch] = createSignal(props.api.kv.get<boolean>(KV_SINGLE_PATCH, false) === true)
  const patchPaneWidth = createMemo(() => dimensions().width - (showFileTree() ? 33 : 0) - 4)
  const patchLeftBorder = createMemo<BorderSides[]>(() => (showFileTree() ? ["left"] : []))
  const splitAvailable = createMemo(() => patchPaneWidth() >= MIN_SPLIT_WIDTH)
  const defaultView = createMemo(() => {
    if (props.api.tuiConfig.diff_style === "stacked") return "unified"
    return splitAvailable() ? "split" : "unified"
  })
  const [viewOverride, setViewOverride] = createSignal<DiffView | undefined>(storedView(props.api.kv.get(KV_VIEW)))
  const view = createMemo(() => (splitAvailable() ? (viewOverride() ?? defaultView()) : "unified"))
  const fileTree = createMemo(() => buildFileTree(files()))
  const [expandedFileNodes, setExpandedFileNodes] = createSignal<ReadonlySet<number>>(new Set())
  const [highlightedFileNode, setHighlightedFileNode] = createSignal<number | undefined>()
  const [lastHighlightedFileNode, setLastHighlightedFileNode] = createSignal<number | undefined>()
  const [activePatchFileIndex, setActivePatchFileIndex] = createSignal<number | undefined>()
  const [selectedFileIndex, setSelectedFileIndex] = createSignal<number | undefined>()
  const [reviewedFileNames, setReviewedFileNames] = createSignal<ReadonlySet<string>>(new Set())
  const patchScrollAcceleration = createMemo(() => getScrollAcceleration(props.api.tuiConfig))
  const fileRows = createMemo(() => flattenFileTree(fileTree(), expandedFileNodes()))
  const patchFileIndexes = createMemo(() => orderedPatchFileIndexes(flattenFileTree(fileTree())))
  const focusRunner = (input: Record<DiffViewerFocus, () => void>) => () => input[focus()]()
  const switchFocusShortcut = useCommandShortcut("diff.switch_focus")
  const nextHunkShortcut = useCommandShortcut("diff.next_hunk")
  const previousHunkShortcut = useCommandShortcut("diff.previous_hunk")
  const nextFileShortcut = useCommandShortcut("diff.next_file")
  const previousFileShortcut = useCommandShortcut("diff.previous_file")
  const toggleFileTreeShortcut = useCommandShortcut("diff.toggle_file_tree")
  const singlePatchShortcut = useCommandShortcut("diff.single_patch")
  const switchSourceShortcut = useCommandShortcut("diff.switch_source")
  const toggleViewShortcut = useCommandShortcut("diff.toggle_view")
  const markReviewedShortcut = useCommandShortcut("diff.mark_reviewed")
  const helpShortcut = useCommandShortcut("diff.help")
  const acceptHunkShortcut = useCommandShortcut("diff.accept_hunk")
  const rejectHunkShortcut = useCommandShortcut("diff.reject_hunk")
  const acceptFileShortcut = useCommandShortcut("diff.accept_file")
  const rejectFileShortcut = useCommandShortcut("diff.reject_file")
  const applyShortcut = useCommandShortcut("diff.apply")
  const addCommentShortcut = useCommandShortcut("diff.add_comment")
  const toggleCommentsShortcut = useCommandShortcut("diff.toggle_comments")
  let scroll: ScrollBoxRenderable | undefined
  const patchNodeByFileIndex = new Map<number, BoxRenderable>()
  const diffNodeByFileIndex = new Map<number, DiffRenderable>()
  const [selectedHunk, setSelectedHunk] = createSignal<SelectedHunk | undefined>()
  const [pendingPatchScrollFileIndex, setPendingPatchScrollFileIndex] = createSignal<number | undefined>()
  const [patchFillerHeight, setPatchFillerHeight] = createSignal(0)
  const [acceptedHunks, setAcceptedHunks] = createSignal<ReadonlyMap<number, ReadonlySet<number>>>(new Map())
  const [rejectedHunks, setRejectedHunks] = createSignal<ReadonlyMap<number, ReadonlySet<number>>>(new Map())
  const [commentsByFile, setCommentsByFile] = createSignal<ReadonlyMap<string, readonly string[]>>(
    new Map(Object.entries(props.api.kv.get<Record<string, string[]>>("diff_viewer_comments", {}) ?? {})),
  )
  const [showComments, setShowComments] = createSignal(props.api.kv.get<boolean>("diff_viewer_show_comments", true) !== false)

  onCleanup(() => props.api.ui.dialog.clear())

  createEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
    setHighlightedFileNode(undefined)
    setLastHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedFileIndex(undefined)
    setSelectedHunk(undefined)
    setReviewedFileNames(new Set<string>())
    setAcceptedHunks(new Map())
    setRejectedHunks(new Map())
  })

  const ensureHighlightedFileNode = () => {
    const highlighted = highlightedFileNode()
    if (highlighted !== undefined && fileRows().some((row) => row.id === highlighted)) return
    const lastHighlighted = lastHighlightedFileNode()
    const next =
      lastHighlighted !== undefined && fileRows().some((row) => row.id === lastHighlighted)
        ? lastHighlighted
        : fileRows().find((row) => row.fileIndex !== undefined)?.id
    setHighlightedFileNode(next)
  }

  const setHighlighted = (node: number | undefined) => {
    setHighlightedFileNode(node)
    if (node !== undefined) setLastHighlightedFileNode(node)
  }

  const moveFileSelection = (offset: number) =>
    setHighlighted(moveFileTreeSelection(fileRows(), highlightedFileNode(), offset))

  const clearFileTreePatchState = () => {
    setHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedHunk(undefined)
  }

  const scrollPatchNodeToTop = (patchNode: BoxRenderable) => {
    requestAnimationFrame(() => {
      if (!scroll) return
      const scrollDelta = patchNode.y - scroll.viewport.y
      const contentY = scroll.scrollTop + scrollDelta
      const offset = contentY === 0 ? 0 : 1
      scroll.scrollBy(scrollDelta + offset)
    })
  }

  const revealFileTreeFile = (fileIndex: number) => {
    const selection = fileTreeFileSelection(fileTree(), fileIndex)
    if (!selection) return
    setExpandedFileNodes((expanded) => {
      const next = new Set(expanded)
      selection.expandedNodes.forEach((node) => next.add(node))
      return next
    })
    setHighlighted(selection.highlightedNode)
  }

  const selectPatchFile = (fileIndex: number) => {
    revealFileTreeFile(fileIndex)
    setActivePatchFileIndex(fileIndex)
    setSelectedFileIndex(fileIndex)
  }

  const scrollToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
    const patchNode = patchNodeByFileIndex.get(fileIndex)
    if (patchNode) scrollPatchNodeToTop(patchNode)
  }

  const jumpToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    setSelectedHunk(undefined)
    scrollToFileIndex(fileIndex)
  }

  const currentPatchFileIndex = () => {
    if (!scroll) return undefined
    const viewportContentY = scroll.scrollTop + 1
    const entries = patchFileIndexes()
      .map((fileIndex) => ({
        fileIndex,
        node: patchNodeByFileIndex.get(fileIndex),
      }))
      .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
      .map((entry) => ({
        ...entry,
        contentY: scroll!.scrollTop + entry.node.y - scroll!.viewport.y,
      }))
      .sort((left, right) => left.contentY - right.contentY)
    return entries.findLast((entry) => entry.contentY <= viewportContentY)?.fileIndex ?? entries[0]?.fileIndex
  }

  const jumpRelativePatchFile = (offset: number) => {
    setSelectedHunk(undefined)
    const next = movePatchFileIndex(patchFileIndexes(), selectedFileIndex() ?? activePatchFileIndex(), offset)
    if (singlePatch()) {
      if (next === undefined) return
      selectPatchFile(next)
      scrollSinglePatchToTop()
      return
    }
    scrollToFileIndex(next)
  }

  const jumpRelativeHunk = (offset: -1 | 1) => {
    const patchScroll = scroll
    if (!patchScroll) return
    const hunks = visiblePatchFiles()
      .flatMap((entry) => {
        const node = diffNodeByFileIndex.get(entry.fileIndex)
        if (!node || node.isDestroyed) return []
        const contentY = patchScroll.scrollTop + node.y - patchScroll.viewport.y
        return node.diff
          .split("\n")
          .flatMap((line, row) => (line.startsWith("@@") ? [row] : []))
          .map((row, hunkIndex) => ({
            fileIndex: entry.fileIndex,
            hunkIndex,
            contentY: contentY + row,
          }))
      })
      .sort((left, right) => left.contentY - right.contentY)
    const selected = selectedHunk()
    const selectedIndex =
      selected?.scrollTop === patchScroll.scrollTop
        ? hunks.findIndex((hunk) => hunk.fileIndex === selected.fileIndex && hunk.hunkIndex === selected.hunkIndex)
        : -1
    const next =
      selectedIndex !== -1
        ? hunks[selectedIndex + offset]
        : offset === 1
          ? hunks.find((hunk) => hunk.contentY > patchScroll.scrollTop)
          : hunks.findLast((hunk) => hunk.contentY < patchScroll.scrollTop)
    if (!next) return
    selectPatchFile(next.fileIndex)
    patchScroll.scrollTo(next.contentY)
    setSelectedHunk({ fileIndex: next.fileIndex, hunkIndex: next.hunkIndex, scrollTop: patchScroll.scrollTop })
  }

  const highlightedPatchFileIndex = () => fileRows().find((row) => row.id === highlightedFileNode())?.fileIndex
  const firstPatchFileIndex = () => fileRows().find((row) => row.fileIndex !== undefined)?.fileIndex
  const visiblePatchFiles = createMemo(() => {
    if (!singlePatch()) {
      return patchFileIndexes().flatMap((fileIndex) => {
        const file = files()[fileIndex]
        return file ? [{ file, fileIndex }] : []
      })
    }
    const fileIndex = singlePatchFileIndex(
      selectedFileIndex(),
      activePatchFileIndex(),
      currentPatchFileIndex(),
      firstPatchFileIndex(),
    )
    const file = fileIndex === undefined ? undefined : files()[fileIndex]
    return file && fileIndex !== undefined ? [{ file, fileIndex }] : []
  })

  const ensureHighlightedPatchFile = () => {
    const fileIndex = currentPatchFileIndex() ?? activePatchFileIndex() ?? firstPatchFileIndex()
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
  }

  const scrollToPatchFileIndexAfterRender = (fileIndex: number) => {
    setPendingPatchScrollFileIndex(fileIndex)
    requestAnimationFrame(() => {
      const patchNode = patchNodeByFileIndex.get(fileIndex)
      if (patchNode) scrollPatchNodeToTop(patchNode)
      requestAnimationFrame(() => {
        const patchNode = patchNodeByFileIndex.get(fileIndex)
        if (patchNode) scrollPatchNodeToTop(patchNode)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  const scrollSinglePatchToTop = () => {
    requestAnimationFrame(() => {
      scroll?.scrollTo(0)
      requestAnimationFrame(() => scroll?.scrollTo(0))
    })
  }

  const measurePatchFiller = () => {
    requestAnimationFrame(() => {
      if (!scroll) return
      const entries = visiblePatchFiles()
        .map((entry) => patchNodeByFileIndex.get(entry.fileIndex))
        .filter((node): node is BoxRenderable => Boolean(node))
      if (entries.length === 0) {
        setPatchFillerHeight(0)
        return
      }
      const contentHeight = Math.max(
        ...entries.map((node) => scroll!.scrollTop + node.y - scroll!.viewport.y + node.height),
      )
      setPatchFillerHeight(Math.max(0, scroll.viewport.height - contentHeight))
    })
  }

  const registerPatchNode = (fileIndex: number, element: BoxRenderable) => {
    patchNodeByFileIndex.set(fileIndex, element)
    measurePatchFiller()
    if (pendingPatchScrollFileIndex() !== fileIndex) return
    requestAnimationFrame(() => {
      scrollPatchNodeToTop(element)
      requestAnimationFrame(() => {
        scrollPatchNodeToTop(element)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  createEffect(() => {
    visiblePatchFiles()
    dimensions()
    view()
    measurePatchFiller()
  })

  const toggleSelectedFileTreeRow = () => {
    const highlighted = fileRows().find((row) => row.id === highlightedFileNode())
    if (highlighted?.fileIndex !== undefined) {
      jumpToFileIndex(highlighted.fileIndex)
      return
    }
    setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, highlightedFileNode()))
  }

  const clickFileTreeRow = (row: FileTreeRow) => {
    setFocus("files")
    setHighlighted(row.id)
    if (row.fileIndex !== undefined) {
      jumpToFileIndex(row.fileIndex)
      return
    }
    setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, row.id))
  }

  const toggleSelectedFileReviewed = () => {
    const fileIndex =
      focus() === "files"
        ? fileRows().find((row) => row.id === highlightedFileNode())?.fileIndex
        : (selectedFileIndex() ?? activePatchFileIndex() ?? currentPatchFileIndex())
    const file = fileIndex === undefined ? undefined : files()[fileIndex]?.file
    if (!file) return
    setReviewedFileNames((reviewed) => {
      const next = new Set(reviewed)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const currentFileIndex = () =>
    selectedFileIndex() ?? activePatchFileIndex() ?? currentPatchFileIndex() ?? firstPatchFileIndex()

  const acceptedFor = (fileIndex: number) => acceptedHunks().get(fileIndex) ?? new Set<number>()
  const rejectedFor = (fileIndex: number) => rejectedHunks().get(fileIndex) ?? new Set<number>()

  const applyDecision = (
    map: ReadonlyMap<number, ReadonlySet<number>>,
    fileIndex: number,
    hunkIndex: number,
    add: boolean,
  ): Map<number, ReadonlySet<number>> => {
    const next = new Map(map)
    const current = new Set(next.get(fileIndex) ?? [])
    if (add) current.add(hunkIndex)
    else current.delete(hunkIndex)
    if (current.size === 0) next.delete(fileIndex)
    else next.set(fileIndex, current)
    return next
  }

  const setHunkDecision = (fileIndex: number, hunkIndex: number, decision: "accept" | "reject") => {
    setAcceptedHunks((prev) => applyDecision(prev, fileIndex, hunkIndex, decision === "accept"))
    setRejectedHunks((prev) => applyDecision(prev, fileIndex, hunkIndex, decision === "reject"))
  }

  const setFileDecision = (fileIndex: number, decision: "accept" | "reject") => {
    const total = countHunks(files()[fileIndex]?.patch)
    const all = new Set(Array.from({ length: total }, (_, index) => index))
    if (decision === "accept") {
      setAcceptedHunks((prev) => new Map(prev).set(fileIndex, all))
      setRejectedHunks((prev) => {
        const next = new Map(prev)
        next.delete(fileIndex)
        return next
      })
      return
    }
    setRejectedHunks((prev) => new Map(prev).set(fileIndex, all))
    setAcceptedHunks((prev) => {
      const next = new Map(prev)
      next.delete(fileIndex)
      return next
    })
  }

  const hunkTarget = (fileIndex: number) => {
    const selected = selectedHunk()
    if (selected && selected.fileIndex === fileIndex) return selected.hunkIndex
    return 0
  }

  const applyAcceptedHunks = async () => {
    if (mode() !== "git") {
      props.api.ui.toast({
        title: "Apply unavailable",
        message: "Accept and reject hunks only applies to the working tree.",
        variant: "error",
      })
      return
    }
    const directory = diffInput().directory
    if (!directory) return
    let applied = 0
    for (const [fileIndex, accepted] of acceptedHunks()) {
      const patch = buildAcceptedPatch(files()[fileIndex]?.patch, accepted)
      if (!patch) continue
      const result = await props.api.client.vcs.apply({ directory, patch })
      if (result.error) {
        const message =
          (result.error as { data?: { message?: string }; message?: string })?.data?.message ??
          (result.error as { message?: string })?.message ??
          "The patch could not be applied."
        props.api.ui.toast({ title: "Apply failed", message: String(message), variant: "error" })
        return
      }
      applied++
    }
    if (applied === 0) {
      props.api.ui.toast({ title: "Nothing to apply", message: "No accepted hunks selected.", variant: "info" })
      return
    }
    setAcceptedHunks(new Map())
    setRejectedHunks(new Map())
    void diffResource.refetch()
    props.api.ui.toast({
      title: "Applied",
      message: `Applied ${applied} file${applied === 1 ? "" : "s"} with accepted hunks.`,
      variant: "success",
    })
  }

  const addComment = (file: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setCommentsByFile((prev) => {
      const next = new Map(prev)
      next.set(file, [...(next.get(file) ?? []), trimmed])
      return next
    })
  }

  const openCommentDialog = (file: string) => {
    props.api.ui.dialog.replace(() =>
      props.api.ui.DialogPrompt({
        title: `Comment — ${file}`,
        placeholder: "Add a comment for this file",
        onConfirm: (value: string) => {
          addComment(file, value)
          props.api.ui.dialog.clear()
        },
        onCancel: () => props.api.ui.dialog.clear(),
      }),
    )
  }

  createEffect(() => {
    const record: Record<string, string[]> = {}
    for (const [file, list] of commentsByFile()) record[file] = [...list]
    props.api.kv.set("diff_viewer_comments", record)
  })

  createEffect(() => {
    props.api.kv.set("diff_viewer_show_comments", showComments())
  })

  createEffect(() => {
    files()
    setAcceptedHunks((prev) => {
      const next = new Map<number, ReadonlySet<number>>()
      let changed = false
      for (const [fileIndex, accepted] of prev) {
        const normalized = normalizeAccepted(files()[fileIndex]?.patch, accepted)
        next.set(fileIndex, normalized)
        if (normalized.size !== accepted.size) changed = true
      }
      return changed ? next : prev
    })
  })

  const commands = [
    {
      name: "diff.close",
      title: "Close diff viewer",
      category: "VCS",
      run() {
        const returnRoute = params()?.returnRoute
        props.api.ui.dialog.clear()

        props.api.route.navigate(
          returnRoute?.name ?? "home",
          returnRoute && "params" in returnRoute ? returnRoute.params : undefined,
        )
      },
    },
    {
      name: "diff.down",
      title: "Move diff viewer down",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(1)
        },
        patches() {
          clearFileTreePatchState()
          scroll?.scrollBy(1)
        },
      }),
    },
    {
      name: "diff.up",
      title: "Move diff viewer up",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(-1)
        },
        patches() {
          clearFileTreePatchState()
          scroll?.scrollBy(-1)
        },
      }),
    },
    {
      name: "diff.page.down",
      title: "Page diff viewer down",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(8)
        },
        patches() {
          clearFileTreePatchState()
          if (scroll) scroll.scrollBy(scroll.height)
        },
      }),
    },
    {
      name: "diff.page.up",
      title: "Page diff viewer up",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(-8)
        },
        patches() {
          clearFileTreePatchState()
          if (scroll) scroll.scrollBy(-scroll.height)
        },
      }),
    },
    {
      name: "diff.toggle",
      title: "Toggle diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          toggleSelectedFileTreeRow()
        },
        patches() {},
      }),
    },
    {
      name: "diff.expand",
      title: "Expand diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          const highlighted = highlightedFileNode()
          if (highlighted !== undefined && expandedFileNodes().has(highlighted)) {
            setHighlighted(moveFileTreeSelectionToFirstChild(fileRows(), highlighted))
            return
          }
          setExpandedFileNodes((expanded) =>
            setFileTreeDirectoryExpanded(fileTree(), expanded, highlightedFileNode(), true),
          )
        },
        patches() {},
      }),
    },
    {
      name: "diff.expand_all",
      title: "Expand all diff viewer folders",
      category: "VCS",
      run: focusRunner({
        files() {
          setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
        },
        patches() {},
      }),
    },
    {
      name: "diff.collapse",
      title: "Collapse diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          const highlighted = highlightedFileNode()
          const node = highlighted === undefined ? undefined : fileTree().nodes[highlighted]
          if (node?.kind !== "directory" || !expandedFileNodes().has(node.id)) {
            setHighlighted(moveFileTreeSelectionToParent(fileRows(), highlighted))
            return
          }
          setExpandedFileNodes((expanded) =>
            setFileTreeDirectoryExpanded(fileTree(), expanded, highlightedFileNode(), false),
          )
        },
        patches() {},
      }),
    },
    {
      name: "diff.next_hunk",
      title: "Jump to next diff hunk",
      category: "VCS",
      run() {
        jumpRelativeHunk(1)
      },
    },
    {
      name: "diff.previous_hunk",
      title: "Jump to previous diff hunk",
      category: "VCS",
      run() {
        jumpRelativeHunk(-1)
      },
    },
    {
      name: "diff.next_file",
      title: "Jump to next diff file",
      category: "VCS",
      run() {
        jumpRelativePatchFile(1)
      },
    },
    {
      name: "diff.previous_file",
      title: "Jump to previous diff file",
      category: "VCS",
      run() {
        jumpRelativePatchFile(-1)
      },
    },
    {
      name: "diff.mark_reviewed",
      title: "Toggle selected diff file reviewed",
      category: "VCS",
      run() {
        toggleSelectedFileReviewed()
      },
    },
    {
      name: "diff.switch_focus",
      title: "Switch diff viewer focus",
      category: "VCS",
      run() {
        if (!showFileTree()) return
        setFocus((current) => {
          if (current === "files") return "patches"
          ensureHighlightedFileNode()
          return "files"
        })
      },
    },
    {
      name: "diff.toggle_file_tree",
      title: "Toggle diff viewer file tree",
      category: "VCS",
      run() {
        const next = !fileTreeEnabled()
        if (!next) setFocus("patches")
        setFileTreeEnabled(next)
        props.api.kv.set(KV_SHOW_FILE_TREE, next)
      },
    },
    {
      name: "diff.single_patch",
      title: "Toggle single patch view",
      category: "VCS",
      run() {
        setSelectedHunk(undefined)
        if (!singlePatch()) {
          ensureHighlightedPatchFile()
          setSinglePatch(true)
          props.api.kv.set(KV_SINGLE_PATCH, true)
          scrollSinglePatchToTop()
          return
        }
        const fileIndex =
          visiblePatchFiles()[0]?.fileIndex ??
          singlePatchFileIndex(
            selectedFileIndex(),
            activePatchFileIndex(),
            currentPatchFileIndex(),
            firstPatchFileIndex(),
          )
        if (fileIndex !== undefined) selectPatchFile(fileIndex)
        setSinglePatch(false)
        props.api.kv.set(KV_SINGLE_PATCH, false)
        if (fileIndex !== undefined) scrollToPatchFileIndexAfterRender(fileIndex)
      },
    },
    {
      name: "diff.switch_source",
      title: "Switch diff viewer source",
      category: "VCS",
      run() {
        openSwitchDiffDialog()
      },
    },
    {
      name: "diff.toggle_view",
      title: "Toggle diff viewer split or unified view",
      category: "VCS",
      run() {
        if (!splitAvailable()) return
        setSelectedHunk(undefined)
        const next = view() === "split" ? "unified" : "split"
        setViewOverride(next)
        props.api.kv.set(KV_VIEW, next)
      },
    },
    {
      name: "diff.help",
      title: "Show more diff viewer shortcuts",
      category: "VCS",
      run() {
        openHelpDialog()
      },
    },
    {
      name: "diff.accept_hunk",
      title: "Accept current diff hunk",
      category: "VCS",
      run() {
        const fileIndex = currentFileIndex()
        if (fileIndex === undefined) return
        setHunkDecision(fileIndex, hunkTarget(fileIndex), "accept")
      },
    },
    {
      name: "diff.reject_hunk",
      title: "Reject current diff hunk",
      category: "VCS",
      run() {
        const fileIndex = currentFileIndex()
        if (fileIndex === undefined) return
        setHunkDecision(fileIndex, hunkTarget(fileIndex), "reject")
      },
    },
    {
      name: "diff.accept_file",
      title: "Accept all hunks in current file",
      category: "VCS",
      run() {
        const fileIndex = currentFileIndex()
        if (fileIndex === undefined) return
        setFileDecision(fileIndex, "accept")
      },
    },
    {
      name: "diff.reject_file",
      title: "Reject all hunks in current file",
      category: "VCS",
      run() {
        const fileIndex = currentFileIndex()
        if (fileIndex === undefined) return
        setFileDecision(fileIndex, "reject")
      },
    },
    {
      name: "diff.apply",
      title: "Apply accepted hunks",
      category: "VCS",
      run() {
        void applyAcceptedHunks()
      },
    },
    {
      name: "diff.add_comment",
      title: "Comment on current file",
      category: "VCS",
      run() {
        const fileIndex = currentFileIndex()
        if (fileIndex === undefined) return
        const file = files()[fileIndex]?.file
        if (!file) return
        openCommentDialog(file)
      },
    },
    {
      name: "diff.toggle_comments",
      title: "Toggle comment visibility",
      category: "VCS",
      run() {
        setShowComments((value) => !value)
      },
    },
  ]

  const switchDiffOptions = createMemo(() => [
    {
      title: "Working tree",
      value: "git" as const,
      description: "Show current git changes",
    },
    {
      title: "Last turn",
      value: "last-turn" as const,
      description: "Show changes from the last assistant turn",
    },
  ])

  const openSwitchDiffDialog = () => {
    props.api.ui.dialog.replace(() => (
      <DialogSelect
        title="Switch source"
        skipFilter={true}
        renderFilter={false}
        current={mode()}
        options={switchDiffOptions().map((option) => ({
          ...option,
          onSelect(dialog) {
            dialog.clear()
            props.api.route.navigate(ROUTE, {
              mode: option.value,
              sessionID: params()?.sessionID,
              messageID: params()?.messageID,
              returnRoute: params()?.returnRoute,
            })
          },
        }))}
      />
    ))
  }

  const openHelpDialog = () => {
    props.api.ui.dialog.replace(() => <DiffViewerHelpDialog />)
    props.api.ui.dialog.setSize("large")
  }

  useBindings(() => ({
    commands,
    bindings: [
      { key: "j,down", cmd: "diff.down", desc: "Move diff viewer down" },
      { key: "k,up", cmd: "diff.up", desc: "Move diff viewer up" },
      { key: "pagedown,ctrl+f", cmd: "diff.page.down", desc: "Page diff viewer down" },
      { key: "pageup,ctrl+b", cmd: "diff.page.up", desc: "Page diff viewer up" },
      { key: "m", cmd: "diff.mark_reviewed", desc: "Mark selected file reviewed" },
      ...props.api.tuiConfig.keybinds.gather(
        "diff",
        commands.map((command) => command.name),
      ),
    ],
  }))

  return (
    <box position="absolute" zIndex={2500} left={0} top={0} width={dimensions().width} height={dimensions().height}>
      <PanelGroup axis="y" width="100%" height="100%">
        <Panel border="none" flexShrink={0} padding={0} paddingLeft={1}>
          <text fg={theme().text}>Diff </text>
          <text fg={theme().textMuted}>{mode() === "last-turn" ? "last turn" : "working tree"}</text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>
            {files().length} {files().length === 1 ? "file" : "files"}
          </text>
        </Panel>

        <box flexGrow={1} minHeight={0}>
          <Switch>
            <Match when={diff.loading}>
              <Separator axis="x" />
              <box flexGrow={1} paddingLeft={1}>
                <text fg={theme().textMuted}>Loading diff...</text>
              </box>
            </Match>
            <Match when={!diff.loading && files().length === 0}>
              <Separator axis="x" />
              <box flexGrow={1} paddingLeft={1}>
                <text fg={theme().textMuted}>No diff!</text>
              </box>
            </Match>
            <Match when={!diff.loading && diff.error}>
              <Separator axis="x" />
              <box flexGrow={1} paddingLeft={1}>
                <text fg={theme().error}>Failed to load diff</text>
              </box>
            </Match>
            <Match when={!diff.loading}>
              <PanelGroup axis="x">
                <Show when={showFileTree()}>
                  <DiffViewerFileTree
                    files={files()}
                    loading={diff.loading}
                    error={diff.error}
                    theme={theme()}
                    focused={focus() === "files"}
                    width={FILE_TREE_WIDTH}
                    highlightedNode={highlightedFileNode()}
                    selectedFileIndex={selectedFileIndex()}
                    reviewedFileNames={reviewedFileNames()}
                    expandedNodes={expandedFileNodes()}
                    onRowClick={clickFileTreeRow}
                  />
                </Show>

                <Panel flexGrow={1} minHeight={0} border="none">
                  <Separator axis="x" start={showFileTree() ? "edge-out" : undefined} />
                  <scrollbox
                    id="diff-viewer-patches"
                    ref={(element: ScrollBoxRenderable) => (scroll = element)}
                    flexGrow={1}
                    minHeight={0}
                    scrollAcceleration={patchScrollAcceleration()}
                    verticalScrollbarOptions={{ visible: false }}
                    horizontalScrollbarOptions={{ visible: false }}
                  >
                    <For each={visiblePatchFiles()}>
                      {(entry, index) => {
                        const reviewed = () => reviewedFileNames().has(entry.file.file)
                        return (
                          <box ref={(element: BoxRenderable) => registerPatchNode(entry.fileIndex, element)}>
                            {index() !== 0 ? <Separator axis="x" start={showFileTree() ? "edge" : undefined} /> : null}
                            <box
                              flexDirection="row"
                              gap={1}
                              flexShrink={0}
                              paddingLeft={1}
                              paddingRight={1}
                              border={patchLeftBorder()}
                              borderColor={theme().border}
                            >
                              <text fg={reviewed() ? theme().textMuted : theme().text}>{entry.file.file}</text>
                              <box flexGrow={1} />
                              <text fg={reviewed() ? theme().textMuted : theme().diffAdded}>
                                +{entry.file.additions}
                              </text>
        <text fg={reviewed() ? theme().textMuted : theme().diffRemoved}>
          -{entry.file.deletions}
        </text>
        <Show when={reviewed()}>
          <text fg={theme().textMuted}>✓</text>
        </Show>
        <Show when={(commentsByFile().get(entry.file.file) ?? []).length > 0}>
          <text fg={theme().textMuted} onMouseUp={() => openCommentDialog(entry.file.file)}>
            c{(commentsByFile().get(entry.file.file) ?? []).length}
          </text>
        </Show>
        <Show when={acceptedFor(entry.fileIndex).size > 0}>
          <text fg={theme().diffAdded}>a{acceptedFor(entry.fileIndex).size}</text>
        </Show>
        <Show when={rejectedFor(entry.fileIndex).size > 0}>
          <text fg={theme().diffRemoved}>r{rejectedFor(entry.fileIndex).size}</text>
        </Show>
      </box>
      <Show when={entry.file.patch}>
        <box
          flexDirection="row"
          gap={1}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          border={patchLeftBorder()}
          borderColor={theme().border}
        >
          <text
            fg={theme().diffAdded}
            onMouseUp={() => setHunkDecision(entry.fileIndex, hunkTarget(entry.fileIndex), "accept")}
          >
            {acceptHunkShortcut() ?? "a"} accept
          </text>
          <text
            fg={theme().diffRemoved}
            onMouseUp={() => setHunkDecision(entry.fileIndex, hunkTarget(entry.fileIndex), "reject")}
          >
            {rejectHunkShortcut() ?? "r"} reject
          </text>
          <text fg={theme().text} onMouseUp={() => setFileDecision(entry.fileIndex, "accept")}>
            {acceptFileShortcut() ?? "A"} all
          </text>
          <text fg={theme().text} onMouseUp={() => setFileDecision(entry.fileIndex, "reject")}>
            {rejectFileShortcut() ?? "R"} none
          </text>
          <Show when={acceptedFor(entry.fileIndex).size > 0}>
            <text fg={theme().text} onMouseUp={() => void applyAcceptedHunks()}>
              {applyShortcut() ?? "g"} apply
            </text>
          </Show>
          <text fg={theme().text} onMouseUp={() => openCommentDialog(entry.file.file)}>
            {addCommentShortcut() ?? "c"} comment
          </text>
        </box>
      </Show>
      <Separator axis="x" start={showFileTree() ? "edge" : undefined} />
                            <Show
                              when={entry.file.patch}
                              fallback={<text fg={theme().textMuted}>No patch available for this file.</text>}
                            >
                              {(patch) => (
                                <box border={patchLeftBorder()} borderColor={theme().border}>
                                  <diff
                                    id={`diff-viewer-patch-${entry.fileIndex}`}
                                    ref={(element: DiffRenderable) => diffNodeByFileIndex.set(entry.fileIndex, element)}
                                    diff={patch()}
                                    view={view()}
                                    filetype={reviewed() ? PLAIN_TEXT_FILETYPE : filetype(entry.file.file)}
                                    syntaxStyle={themeState.syntax()}
                                    showLineNumbers={true}
                                    width="100%"
                                    wrapMode="char"
                                    fg={reviewed() ? theme().textMuted : theme().text}
                                    addedBg={reviewed() ? theme().backgroundElement : theme().diffAddedBg}
                                    removedBg={reviewed() ? theme().backgroundElement : theme().diffRemovedBg}
                                    addedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightAdded}
                                    removedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightRemoved}
                                    lineNumberFg={theme().diffLineNumber}
                                    addedLineNumberBg={
                                      reviewed() ? theme().backgroundElement : theme().diffAddedLineNumberBg
                                    }
                                    removedLineNumberBg={
                                      reviewed() ? theme().backgroundElement : theme().diffRemovedLineNumberBg
                                    }
                                  />
                                  <Show
                                    when={showComments() && (commentsByFile().get(entry.file.file) ?? []).length > 0}
                                  >
                                    <box flexDirection="column" gap={0} paddingLeft={1} paddingRight={1}>
                                      <For each={commentsByFile().get(entry.file.file) ?? []}>
                                        {(comment) => (
                                          <text fg={theme().textMuted} wrapMode="char">
                                            ▸ {comment}
                                          </text>
                                        )}
                                      </For>
                                    </box>
                                  </Show>
                                </box>
                              )}
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                    <Show when={patchFillerHeight() > 0}>
                      <box height={patchFillerHeight()} border={patchLeftBorder()} borderColor={theme().border} />
                    </Show>
                  </scrollbox>
                  <Separator axis="x" start={showFileTree() ? "edge-in" : undefined} />
                </Panel>
              </PanelGroup>
            </Match>
          </Switch>
        </box>

        <Panel flexShrink={0} gap={2} paddingLeft={1} border="none">
          <Show when={switchFocusShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>focus file tree</span>
              </text>
            )}
          </Show>
          <Show when={nextFileShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>next file</span>
              </text>
            )}
          </Show>
          <Show when={nextHunkShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>next hunk</span>
              </text>
            )}
          </Show>
          <Show when={previousHunkShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>previous hunk</span>
              </text>
            )}
          </Show>
          <Show when={previousFileShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>previous file</span>
              </text>
            )}
          </Show>
          <Show when={switchSourceShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>switch source</span>
              </text>
            )}
          </Show>
          <Show when={markReviewedShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>mark reviewed</span>
              </text>
            )}
          </Show>
          <Show when={acceptHunkShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>accept hunk</span>
              </text>
            )}
          </Show>
          <Show when={rejectHunkShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>reject hunk</span>
              </text>
            )}
          </Show>
          <Show when={applyShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>apply accepted</span>
              </text>
            )}
          </Show>
          <Show when={helpShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>all</span>
              </text>
            )}
          </Show>
        </Panel>
      </PanelGroup>
    </box>
  )
}

function DiffViewerHelpDialog() {
  const { theme } = useTheme()
  const rows = [
    {
      shortcut: () => "q",
      action: "Close viewer",
      description: "Quit the diff viewer",
    },
    {
      shortcut: useCommandShortcut("diff.switch_focus"),
      action: "Focus file tree",
      description: "Move keyboard focus between the file tree and patch pane",
    },
    {
      shortcut: useCommandShortcut("diff.next_hunk"),
      action: "Next hunk",
      description: "Jump to the next diff hunk",
    },
    {
      shortcut: useCommandShortcut("diff.previous_hunk"),
      action: "Previous hunk",
      description: "Jump to the previous diff hunk",
    },
    {
      shortcut: useCommandShortcut("diff.next_file"),
      action: "Next file",
      description: "Select the next changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.previous_file"),
      action: "Previous file",
      description: "Select the previous changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_file_tree"),
      action: "Toggle file tree",
      description: "Show or hide the file tree sidebar",
    },
    {
      shortcut: useCommandShortcut("diff.single_patch"),
      action: "Toggle patches",
      description: "Switch between one selected patch and all patches",
    },
    {
      shortcut: useCommandShortcut("diff.switch_source"),
      action: "Switch source",
      description: "Choose working tree or last-turn changes",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_view"),
      action: "Toggle view",
      description: "Switch between split and unified diff layout",
    },
    {
      shortcut: useCommandShortcut("diff.expand_all"),
      action: "Expand all folders",
      description: "Open every folder in the file tree",
    },
    {
      shortcut: useCommandShortcut("diff.mark_reviewed"),
      action: "Mark reviewed",
      description: "Toggle reviewed state for the selected file",
    },
    {
      shortcut: useCommandShortcut("diff.accept_hunk"),
      action: "Accept hunk",
      description: "Accept the hunk under the cursor, or the first hunk",
    },
    {
      shortcut: useCommandShortcut("diff.reject_hunk"),
      action: "Reject hunk",
      description: "Reject the hunk under the cursor, or the first hunk",
    },
    {
      shortcut: useCommandShortcut("diff.accept_file"),
      action: "Accept file",
      description: "Accept every hunk in the current file",
    },
    {
      shortcut: useCommandShortcut("diff.reject_file"),
      action: "Reject file",
      description: "Reject every hunk in the current file",
    },
    {
      shortcut: useCommandShortcut("diff.apply"),
      action: "Apply accepted",
      description: "Apply accepted hunks to the working tree",
    },
    {
      shortcut: useCommandShortcut("diff.add_comment"),
      action: "Comment",
      description: "Add a comment to the current file",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_comments"),
      action: "Toggle comments",
      description: "Show or hide file comments",
    },
  ]

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Diff shortcuts
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box flexDirection="row">
        <text fg={theme.textMuted} width={5} wrapMode="none">
          Key
        </text>
        <text fg={theme.textMuted} width={22} wrapMode="none">
          Action
        </text>
        <text fg={theme.textMuted}>Description</text>
      </box>
      <For each={rows}>
        {(row) => (
          <box flexDirection="row">
            <text fg={theme.text} width={5} wrapMode="none">
              {row.shortcut() || "-"}
            </text>
            <text fg={theme.text} width={22} wrapMode="none">
              {row.action}
            </text>
            <text fg={theme.textMuted}>{row.description}</text>
          </box>
        )}
      </For>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: ROUTE,
      render: () => <DiffViewer api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "diff.open",
        title: "Open diff viewer",
        slashName: "diff",
        category: "VCS",
        namespace: "palette",
        run() {
          api.route.navigate(ROUTE, {
            mode: "git",
            sessionID: "params" in api.route.current ? api.route.current.params?.sessionID : undefined,
            returnRoute: api.route.current,
          })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

export default {
  id: "diff-viewer",
  tui,
}
