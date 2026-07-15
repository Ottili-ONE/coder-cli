import { createEffect, createMemo, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  type ParityState,
  type ParitySurface,
  type PlatformCapabilities,
  resolveLayoutTier,
  desktopCapabilities,
  webCapabilities,
} from "@opencode-ai/ui/parity"
import { usePlatform, type Platform } from "@/context/platform"

// Map the existing real `Platform` object onto the host-agnostic capability
// contract. Desktop overrides only the capability flags (specs/tui/web-desktop-
// parity.md §6); the differentiation happens through the Platform the desktop
// host already supplies, so no second capability source is introduced.
function deriveCapabilities(platform: Platform): PlatformCapabilities {
  if (platform.platform === "desktop") {
    const base = desktopCapabilities()
    return {
      ...base,
      autoUpdate: base.autoUpdate && platform.updater !== undefined,
      wsl: base.wsl && platform.wslServers !== undefined,
      nativeFileDialog: base.nativeFileDialog && platform.openAttachmentPickerDialog !== undefined,
      nativeNotification: base.nativeNotification && platform.notify !== undefined,
    }
  }
  return webCapabilities()
}

const { use: useParityContext, provider: ParityContextProvider } = createSimpleContext({
  name: "Parity",
  init: (props: { value: ParitySurface }) => props.value,
})

// Web & Desktop implementation of the shared ParitySurface. Reuses the existing
// Platform + theme contexts and adds only the thin adapter layer (no new store).
export function ParityProvider(props: ParentProps) {
  const platform = usePlatform()
  const capabilities = createMemo<PlatformCapabilities>(() => deriveCapabilities(platform))
  const widths = createMemo(() =>
    resolveLayoutTier(typeof window !== "undefined" ? window.innerWidth : 120),
  )

  // Mirror the TUI layout tiers onto the document root so density decisions
  // match across hosts (closes G3). Reactive to resize; inert when the flag is
  // off so today's CSS breakpoints are untouched.
  createEffect(() => {
    if (!Flag.EVOLUTION_T_CLI_0245_TUI_REDESIGN_WEB_AND_DESKTOP_PARITY__ENABLED) return
    if (typeof document === "undefined") return
    document.documentElement.dataset.layoutTier = widths()
  })

  const surface: ParitySurface = {
    capabilities: capabilities(),
    widths: widths(),
    toast: (message, tone = "info") => {
      void platform.notify("Ottili Coder", `${tone}: ${message}`).catch(() => {})
    },
    navigate: () => {},
    commands: {},
  }

  return <ParityContextProvider value={surface}>{props.children}</ParityContextProvider>
}

export function useParity(): ParitySurface {
  return useParityContext()
}
