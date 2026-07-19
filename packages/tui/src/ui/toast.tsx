/** @jsxImportSource @opentui/solid */
import {
  createContext,
  useContext,
  type JSX,
  type ParentProps,
  Show,
  For,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { useRenderer, useKeyboard } from "@opentui/solid"
import { SplitBorder } from "./border"
import { TextAttributes, TextareaRenderable, InputRenderable } from "@opentui/core"
import { Flag } from "@opencode-ai/core/flag/flag"
import { useOttiliCoderKeymap } from "../keymap"
import {
  type ToastOptions,
  type ToastInput,
  type ToastAction,
  type ToastVariant,
  defaultDuration,
  toastID,
  enqueue,
  visibleToasts,
  MAX_VISIBLE_TOASTS,
} from "./toast-model"

const GLYPH: Record<ToastVariant, string> = {
  info: "",
  success: "✓",
  warning: "⚠",
  error: "✕",
}

// Activation key shown in the action affordance and bound by the toast keyboard
// layer. It only fires while a toast is visible and the prompt is not focused,
// so it never collides with prompt text input or keymap bindings.
const ACTION_KEY = "a"
const DISMISS_ALL_KEY = "]"

type ToastStore = {
  toasts: ToastOptions[]
}

function glyph(variant: ToastVariant): string {
  const g = GLYPH[variant]
  return g ? `${g} ` : ""
}

function layoutFor(width: number) {
  if (width >= 110) return { maxWidth: 60, stack: MAX_VISIBLE_TOASTS, actionLabel: true, compact: false }
  if (width >= 80) return { maxWidth: width - 6, stack: MAX_VISIBLE_TOASTS, actionLabel: true, compact: false }
  if (width >= 60) return { maxWidth: width - 4, stack: 2, actionLabel: false, compact: false }
  return { maxWidth: Math.max(8, width - 4), stack: 1, actionLabel: false, compact: true }
}

function renderAction(action: ToastAction, actionLabel: boolean): JSX.Element {
  const key = `[${ACTION_KEY}]`
  return (
    <text
      fg={actionLabel ? "text" : "textMuted"}
      attributes={TextAttributes.BOLD}
      flexShrink={0}
      onMouseUp={() => action.onClick?.()}
    >
      {actionLabel ? `  ${key} ${action.label}` : `  ${key}`}
    </text>
  )
}

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const keymap = useOttiliCoderKeymap()

  // Keyboard layer: only active while a toast is visible and the prompt is not
  // focused (guarded by the experimental flag so it can be disabled wholesale).
  useKeyboard((event) => {
    if (!Flag.OTTILI_CODER_EXPERIMENTAL_TUI_TOAST_REDESIGN) return
    const toasts = toast.current()
    if (toasts.length === 0) return
    const editor = renderer.currentFocusedEditor
    if (editor instanceof TextareaRenderable || editor instanceof InputRenderable) return

    if (event.name === ACTION_KEY) {
      const top = toasts[toasts.length - 1]!
      if (top.action) toast.activate(toastID(top))
      return
    }
    if (event.name === DISMISS_ALL_KEY) {
      toast.dismissAll()
      return
    }
    if (event.name === "escape") {
      toast.dismiss(toastID(toasts[toasts.length - 1]!))
    }
  })

  const width = () => dimensions().width
  const layout = () => layoutFor(width())
  const toastWindow = () => {
    const view = visibleToasts(toast.current())
    return { visible: view.visible.slice(-layout().stack), hidden: Math.max(0, view.hidden + (view.visible.length - layout().stack)) }
  }

  const ariaLiveText = () => {
    const last = toast.current().at(-1)
    if (!last) return ""
    return `${last.variant}: ${last.title ? `${last.title} — ` : ""}${last.message}`
  }

  return (
    <Show when={toast.current().length > 0}>
      <box
        aria-label={ariaLiveText()}
        position="absolute"
        top={2}
        right={2}
        flexDirection="column"
        alignItems="flex-end"
      >
        <For each={toastWindow().visible}>
          {(current) => (
            <Show
              when={!layout().compact}
              fallback={
                <text
                  fg={theme[current.variant]}
                  backgroundColor={theme.backgroundPanel}
                  marginBottom={1}
                  width={layout().maxWidth}
                >
                  {`${glyph(current.variant)}${truncate(current.message, layout().maxWidth)}`}
                </text>
              }
            >
              <box
                justifyContent="center"
                alignItems="flex-start"
                marginBottom={1}
                maxWidth={layout().maxWidth}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                borderColor={theme[current.variant]}
                border={["left", "right"]}
                customBorderChars={SplitBorder.customBorderChars}
              >
                <Show when={current.title}>
                  <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
                    {current.title}
                  </text>
                </Show>
                <box flexDirection="row" alignItems="center">
                  <text fg={theme[current.variant]} flexShrink={0}>
                    {glyph(current.variant)}
                  </text>
                  <text fg={theme.text} wrapMode="word" width="100%">
                    {current.message}
                  </text>
                  <Show when={current.action}>{renderAction(current.action!, layout().actionLabel)}</Show>
                </box>
              </box>
            </Show>
          )}
        </For>
        <Show when={toastWindow().hidden > 0}>
          <text fg={theme.textMuted} backgroundColor={theme.backgroundPanel} paddingLeft={2} paddingRight={2} marginBottom={1}>
            {`+${toastWindow().hidden} more`}
          </text>
        </Show>
      </box>
    </Show>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return ""
  return `${text.slice(0, max - 1)}…`
}

function init() {
  const [store, setStore] = createStore<ToastStore>({ toasts: [] })
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const keymap = useOttiliCoderKeymap()

  function clear(id: string) {
    const handle = timers.get(id)
    if (handle) clearTimeout(handle)
    timers.delete(id)
  }

  function dismiss(id: string) {
    clear(id)
    setStore("toasts", (list) => list.filter((toast) => toastID(toast) !== id))
  }

  function dismissAll() {
    for (const handle of timers.values()) clearTimeout(handle)
    timers.clear()
    setStore("toasts", [])
  }

  function activate(id: string) {
    const toast = store.toasts.find((candidate) => toastID(candidate) === id)
    if (!toast?.action) return
    if (toast.action.onClick) toast.action.onClick()
    else if (toast.action.command) keymap.dispatchCommand(toast.action.command)
  }

  const toast = {
    show(options: ToastInput) {
      const resolved: ToastOptions = {
        ...options,
        duration: options.duration ?? defaultDuration(options.variant),
      }
      const id = toastID(resolved)
      clear(id)
      setStore("toasts", (list) => enqueue(list, resolved))
      if (!resolved.sticky) {
        const handle = setTimeout(() => dismiss(id), resolved.duration).unref()
        timers.set(id, handle)
      }
    },
    dismiss,
    dismissAll,
    activate,
    error: (err: unknown) => {
      if (err instanceof Error)
        return toast.show({ variant: "error", message: err.message })
      toast.show({ variant: "error", message: "An unknown error has occurred" })
    },
    current(): ToastOptions[] {
      return store.toasts
    },
    get currentToast(): ToastOptions | null {
      return store.toasts[store.toasts.length - 1] ?? null
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
