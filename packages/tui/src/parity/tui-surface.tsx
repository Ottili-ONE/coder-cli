/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  type ParityState,
  type ParitySurface,
  type PlatformCapabilities,
  resolveLayoutTier,
  tuiCapabilities,
} from "@opencode-ai/ui/parity"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useOttiliCoderKeymap } from "../keymap"

// TUI implementation of the shared ParitySurface (specs/tui/web-desktop-parity.md
// §3.1/§6). The TUI reuses its existing keymap + theme context and only adapts
// them to the single product vocabulary; it introduces no new state store.
export function useTuiParitySurface(): ParitySurface {
  const themeCtx = useTheme()
  const toast = useToast()
  const keymap = useOttiliCoderKeymap()
  const dimensions = useTerminalDimensions()

  const capabilities = createMemo<PlatformCapabilities>(() => {
    const base = tuiCapabilities()
    // Mouse is the one TUI capability that can be toggled at runtime.
    return { ...base, nativeNotification: false }
  })

  const widths = createMemo(() => resolveLayoutTier(dimensions().width))

  // The TUI derives its current lifecycle state from connectivity: when the
  // host has no network the parity strip announces `offline`; otherwise it is
  // `populated` (a live session surface). The web/desktop hosts override this
  // with richer connection/session signals. All states stay renderable.
  const state = createMemo<ParityState>(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { status: "offline" }
    }
    return { status: "populated", title: "Ottili Coder" }
  })

  return {
    capabilities: capabilities(),
    widths: widths(),
    state: state(),
    toast: (message, tone = "info") => {
      const prefix = tone === "error" ? "error" : tone === "warning" ? "warn" : tone === "success" ? "ok" : "info"
      toast(`${prefix}: ${message}`)
    },
    navigate: () => {},
    commands: {
      openCommandPalette: () => keymap.dispatchCommand("command.palette.show"),
      toggleTheme: () => {
        const names = Object.keys(themeCtx.all())
        if (names.length === 0) return
        const current = themeCtx.selected
        const next = names[(names.indexOf(current) + 1) % names.length] ?? names[0]
        themeCtx.set(next)
      },
      openSession: () => keymap.dispatchCommand("session.new"),
      forkSession: () => keymap.dispatchCommand("session.fork"),
    },
  }
}

// Compact, always-legible capability line. Surfaces the host + the
// platform-specific capabilities the shared model exposes, rendered with the
// Ottili palette so it reads like the rest of the chrome. Stable during
// streaming because every value is derived from memos, not from render state.
export function ParityStatusBar(props: { surface: ParitySurface }) {
  const caps = () => props.surface.capabilities
  const chip = (label: string, on: boolean, color: string) => (
    <text fg={on ? color : caps().host === "tui" ? "#5a524c" : color}>
      {on ? "●" : "○"} {label}
    </text>
  )

  return (
    <Show when={Flag.EVOLUTION_T_CLI_0245_TUI_REDESIGN_WEB_AND_DESKTOP_PARITY__ENABLED}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={caps().host === "tui" ? "#f97316" : "#a77fc4"} attributes={TextAttributes.BOLD}>
          {caps().host.toUpperCase()}
        </text>
        {chip("kbd", caps().keyboardOnly, "#a77fc4")}
        {chip("term", caps().terminalWidth, "#f97316")}
        {chip("menu", caps().osMenu, "#7fd88f")}
        {chip("update", caps().autoUpdate, "#7fd88f")}
        {chip("wsl", caps().wsl, "#f5a742")}
        {chip("dialog", caps().nativeFileDialog, "#f5a742")}
        {chip("notify", caps().nativeNotification, "#7fd88f")}
        {chip("a11y", caps().browserA11y, "#7fd88f")}
        <text fg="#7d7670">{props.surface.widths}</text>
      </box>
    </Show>
  )
}
