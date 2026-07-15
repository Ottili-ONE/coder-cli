import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"
import { SplitBorder } from "../ui/border"
import { setPreLayoutSiblingMargin } from "../util/layout"
import {
  activeToolCard,
  getErrorExpanded,
  getExpanded,
  registerToolCard,
  setActiveToolCard,
  toggleErrorExpanded,
  toggleExpanded,
} from "./tool-call-store"
import type { ToolPart } from "@opencode-ai/sdk/v2"

const ICON_WIDTH = 2

function deniedError(error: string | undefined) {
  return (
    error?.includes("QuestionRejectedError") ||
    error?.includes("rejected permission") ||
    error?.includes("specified a rule") ||
    error?.includes("user dismissed")
  )
}

export function ToolCallCard(props: {
  part: ToolPart
  icon: string
  iconColor?: RGBA
  title: JSX.Element
  pending: string
  complete: unknown
  collapsible?: boolean
  spinner?: boolean
  subagent?: boolean
  statusText?: () => string | undefined
  separateAfter?: (id: string | undefined) => boolean
  onActivate?: () => void
  children?: JSX.Element
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  const status = createMemo(() => props.part.state.status)
  const error = createMemo(() =>
    props.part.state.status === "error" ? props.part.state.error : undefined,
  )
  const denied = createMemo(() => deniedError(error()))
  const failed = createMemo(() => Boolean(error() && !denied()))

  const expanded = createMemo(() => getExpanded(props.part.id) ?? Boolean(props.collapsible && props.complete))
  const showError = createMemo(() => getErrorExpanded(props.part.id))

  const accent = createMemo<RGBA>(() => {
    if (props.iconColor) return props.iconColor
    if (status() === "running") return theme.warning
    if (failed()) return theme.error
    if (status() === "error") return theme.textMuted
    if (status() === "completed") return theme.textMuted
    if (hover() && props.complete) return theme.text
    return theme.text
  })

  const clickable = createMemo(
    () => Boolean(props.collapsible && props.complete) || Boolean(props.onActivate) || failed(),
  )

  const cardId = () => `tool-card-${props.subagent ? "subagent-" : ""}${props.part.id}`

  const handleClick = () => {
    if (renderer.getSelection()?.getSelectedText()) return
    if (failed()) {
      toggleErrorExpanded(props.part.id)
      return
    }
    if (props.onActivate) {
      props.onActivate()
      return
    }
    if (props.collapsible && props.complete) {
      toggleExpanded(props.part.id)
    }
  }

  return (
    <box
      ref={(el: BoxRenderable) => {
        registerToolCard(props.part.id)
        setPreLayoutSiblingMargin(el, (previous) => {
          const previousInline = previous?.id.startsWith("tool-card-") ?? false
          const previousSubagent = previous?.id.startsWith("tool-card-subagent-") ?? false
          const currentSubagent = Boolean(props.subagent)
          return previous?.id.startsWith("text-") ||
            previous?.id.startsWith("tool-block-") ||
            (previousInline && previousSubagent !== currentSubagent) ||
            props.separateAfter?.(previous?.id)
            ? 1
            : 0
        })
      }}
      id={cardId()}
      border={["left"]}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      borderColor={accent()}
      backgroundColor={hover() && clickable() ? theme.backgroundMenu : undefined}
      customBorderChars={SplitBorder.customBorderChars}
      onMouseOver={() => {
        if (clickable()) {
          setHover(true)
          setActiveToolCard(props.part.id)
        }
      }}
      onMouseOut={() => setHover(false)}
      onMouseUp={handleClick}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <Show
          when={!props.spinner}
          fallback={
            <box width={ICON_WIDTH}>
              <Spinner color={accent()} />
            </box>
          }
        >
          <text
            width={ICON_WIDTH}
            fg={failed() ? theme.error : accent()}
            attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}
          >
            {props.icon}
          </text>
        </Show>
        <Show
          when={props.complete}
          fallback={
            <text
              fg={theme.textMuted}
              attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}
            >
              {"✻ " + props.pending}
            </text>
          }
        >
          <text
            flexGrow={1}
            fg={accent()}
            wrapMode="none"
            attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}
          >
            {props.title}
          </text>
        </Show>
        <Show when={props.collapsible && props.complete}>
          <text fg={theme.textMuted}>{expanded() ? "▾" : "▸"}</text>
        </Show>
        <Show when={props.statusText?.()}>
          <text fg={theme.textMuted}>{props.statusText?.()}</text>
        </Show>
      </box>
      <Show when={props.collapsible && props.complete && expanded()}>{props.children}</Show>
      <Show when={error()}>
        <box marginTop={1} paddingLeft={ICON_WIDTH}>
          <Show
            when={!denied()}
            fallback={
              <text fg={theme.textMuted} attributes={TextAttributes.STRIKETHROUGH}>
                {error()}
              </text>
            }
          >
            <text fg={theme.error}>{error()}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

export { activeToolCard }
