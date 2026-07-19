/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import type { ConflictFile, ConflictSide, ConflictAction } from "./model"

export interface ConflictRegionAction {
  type: "accept" | "close" | "focus-list"
  side?: ConflictSide
  regionIndex?: number
}

export interface ConflictPreviewProps {
  file: ConflictFile
  focusRegion: number
  width: number
  height: number
  focusZone: "list" | "regions"
  onAction?: (action: ConflictRegionAction) => void
}

export function ConflictPreview(props: ConflictPreviewProps) {
  const { theme } = useTheme()

  const file = () => props.file
  const isBinary = () => file().binary
  const conflictRegions = () => file().conflictRegions ?? 0
  const allResolved = () => file().resolution !== undefined
  const resolvedText = () => {
    const f = file()
    if (!f.resolution) return undefined
    return `Resolved: ${f.resolution}`
  }

  if (isBinary()) {
    return (
      <box
        id="preview-binary"
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        border={["top"]}
        borderColor={theme.border}
      >
        <text fg={theme.warning} attributes={TextAttributes.BOLD}>
          {file().path}
        </text>
        <text fg={theme.textMuted}>Binary file — resolve to a side</text>
      </box>
    )
  }

  if (allResolved()) {
    return (
      <box
        id="preview-resolved"
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        border={["top"]}
        borderColor={theme.border}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {file().path}
        </text>
        <text fg={theme.success}>{resolvedText()}</text>
      </box>
    )
  }

  if (conflictRegions() === 0) {
    return (
      <box
        id="preview-no-conflicts"
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        border={["top"]}
        borderColor={theme.border}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {file().path}
        </text>
        <text fg={theme.textMuted}>No conflict regions in this file</text>
      </box>
    )
  }

  const regionCount = conflictRegions()
  const additions = file().additions ?? 0
  const deletions = file().deletions ?? 0

  return (
    <box
      id="preview-regions"
      flexDirection="column"
      gap={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      border={["top"]}
      borderColor={theme.border}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text id="preview-file-path" fg={theme.text} attributes={TextAttributes.BOLD}>
          {file().path}
        </text>
        <text id="preview-status" fg={conflictRegions() > 0 ? theme.warning : theme.textMuted}>
          {conflictRegions()} conflict region{conflictRegions() === 1 ? "" : "s"}
        </text>
      </box>

      <Show when={additions > 0 || deletions > 0}>
        <box flexDirection="row" gap={1} paddingTop={0}>
          <Show when={additions > 0}>
            <text fg={theme.success}>+{additions}</text>
          </Show>
          <Show when={deletions > 0}>
            <text fg={theme.error}>−{deletions}</text>
          </Show>
        </box>
      </Show>

      <box id="preview-region-list" flexDirection="column" gap={0}>
        <For each={Array.from({ length: Math.min(regionCount, 10) })}>
          {(_reg, idx) => {
            const regionIndex = idx()
            const isFocused = () => props.focusZone === "regions" && regionIndex === props.focusRegion
            return (
              <box
                id={`preview-region-${regionIndex}`}
                flexDirection="column"
                gap={0}
                paddingLeft={1}
                paddingTop={0}
                paddingBottom={0}
                backgroundColor={isFocused() ? theme.backgroundElement : undefined}
                border={["top"]}
                borderColor={theme.borderSubtle}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Region {regionIndex + 1}</text>
                  <text fg={theme.textMuted}>[ ]</text>
                </box>
                <box flexDirection="row" gap={1} paddingLeft={1}>
                  <text fg={theme.diffRemoved} wrapMode="char">
                    {"<<<<<<< ours"}
                  </text>
                </box>
                <box flexDirection="row" gap={1} paddingLeft={1}>
                  <text fg={theme.textMuted} wrapMode="char">
                    {"======="}
                  </text>
                </box>
                <box flexDirection="row" gap={1} paddingLeft={1}>
                  <text fg={theme.diffAdded} wrapMode="char">
                    {">>>>>>> theirs"}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
        <Show when={regionCount > 10}>
          <text fg={theme.textMuted} paddingLeft={1}>
            ...{regionCount - 10} more region{regionCount - 10 === 1 ? "" : "s"} (scroll to view all)
          </text>
        </Show>
      </box>

      {/* File-level action bar */}
      <box id="preview-actions" flexDirection="row" gap={1} paddingTop={1}>
        <text
          fg={theme.primary}
          attributes={TextAttributes.BOLD}
          onMouseUp={() => props.onAction?.({ type: "accept", side: "ours" })}
        >
          [o]urs
        </text>
        <text
          fg={theme.primary}
          attributes={TextAttributes.BOLD}
          onMouseUp={() => props.onAction?.({ type: "accept", side: "theirs" })}
        >
          [t]heirs
        </text>
        <text
          fg={theme.primary}
          attributes={TextAttributes.BOLD}
          onMouseUp={() => props.onAction?.({ type: "accept", side: "union" })}
        >
          [u]nion
        </text>
        <text
          fg={theme.textMuted}
          onMouseUp={() => props.onAction?.({ type: "accept", side: "manual" })}
        >
          [m]anual
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onAction?.({ type: "close" })}>
          [esc] close
        </text>
      </box>
    </box>
  )
}

export default ConflictPreview