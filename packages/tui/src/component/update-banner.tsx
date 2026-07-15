/** @jsxImportSource @opentui/solid */
import { Show, For, createMemo } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { RGBA, TextAttributes, InputRenderable, TextareaRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  bannerViewModel,
  colorEnabled,
  type BannerColorRole,
  type BannerAction,
  type UpdateBannerState,
} from "../ui/update-banner-model"

/** Callbacks the host wires to the banner's affordances. */
export type UpdateBannerActions = {
  onChangelog?: () => void
  onUpdate?: () => void
  onDismiss?: () => void
}

/**
 * Non-blocking top strip that surfaces update/release state. Renders above
 * `<DegradedStates />` so an available update is the highest-priority, always
 * visible surface until acted on or dismissed (spec §3.1).
 *
 * The banner owns a transient key layer (`[c]` notes · `[u]` update · `[d]`
 * dismiss) that is active only while visible, never steals the prompt's
 * bindings, and yields to any open dialog or focused editor. Focus is never
 * lost or trapped: the strip is presentational; only the safe-install confirm
 * dialog (opened via `[u]`) is modal, and it is dismissible with `esc`.
 */
export function UpdateBanner(props: { state: () => UpdateBannerState; actions?: UpdateBannerActions }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const term = useTerminalDimensions()

  const vm = createMemo(() =>
    bannerViewModel(props.state(), { width: term().width, useColor: colorEnabled() }),
  )

  function colorFor(role: BannerColorRole): RGBA {
    if (!colorEnabled()) return theme.text
    switch (role) {
      case "accent":
        return theme.accent
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      case "info":
        return theme.info
      default:
        return theme.text
    }
  }

  function run(command: BannerAction["command"]) {
    if (command === "changelog") props.actions?.onChangelog?.()
    else if (command === "update") props.actions?.onUpdate?.()
    else props.actions?.onDismiss?.()
  }

  useKeyboard((event) => {
    if (props.state().status === "hidden") return
    // Yield to an open dialog (e.g. the safe-install confirm) or the prompt.
    if (dialog.stack.length > 0) return
    const editor = renderer.currentFocusedEditor
    if (editor instanceof TextareaRenderable || editor instanceof InputRenderable) return
    const action = vm().actions.find((a) => a.key === event.name)
    if (action) {
      run(action.command)
      return
    }
    if (
      (event.name === "escape" || event.name === "d") &&
      vm().actions.some((a) => a.command === "dismiss")
    ) {
      props.actions?.onDismiss?.()
    }
  })

  return (
    <Show when={props.state().status !== "hidden"}>
      <box
        flexDirection="row"
        alignItems="center"
        gap={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
        borderColor={colorFor(vm().colorRole)}
        border={["bottom"]}
        title={vm().ariaLabel}
      >
        <text attributes={TextAttributes.BOLD} fg={colorFor(vm().colorRole)}>
          {vm().glyph}
        </text>
        <text fg={theme.text} wrapMode="word">
          {vm().title}
        </text>
        <Show when={vm().detail}>
          <text fg={theme.textMuted} wrapMode="word">
            {vm().detail}
          </text>
        </Show>
        <Show when={vm().hint}>
          <text fg={theme.textMuted}>{vm().hint}</text>
        </Show>
        <For each={vm().actions}>
          {(action) => (
            <box
              backgroundColor={theme.primary}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={Flag.OTTILI_CODER_DISABLE_MOUSE ? undefined : () => run(action.command)}
            >
              <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
                [{action.key}] {action.label}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
