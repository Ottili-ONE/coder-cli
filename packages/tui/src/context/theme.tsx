import { SyntaxStyle, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  generateSubtleSyntax,
  generateSyntax,
  generateSystem,
  hasTheme,
  isTheme,
  safeResolveTheme,
  resolveThemeName,
  selectedForeground,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  tint,
  upsertTheme,
  type ThemeJson,
} from "../theme"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useTuiConfig } from "../config"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { readFile } from "node:fs/promises"
import path from "node:path"

// Ottili Coder is dark-only. Light mode has been removed entirely so the TUI
// renders consistently on every terminal regardless of reported background.
const THEME_MODE = "dark" as const

export type ThemeSource = Readonly<{
  discover(): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

const themeSource: ThemeSource = {
  async discover() {
    const directories = [Global.Path.config]
    for (let current = process.cwd(); ; current = path.dirname(current)) {
      directories.push(path.join(current, ".ottili-coder"))
      if (path.dirname(current) === current) break
    }
    return discoverThemes(directories)
  },
  subscribeRefresh(refresh) {
    process.on("SIGUSR2", refresh)
    return () => process.off("SIGUSR2", refresh)
  },
}

export async function discoverThemes(directories: string[]) {
  const result: Record<string, unknown> = {}
  for (const directory of directories) {
    const files = await Glob.scan("themes/*.json", { cwd: directory, absolute: true, dot: true, symlink: true })
    for (const file of files) {
      result[path.basename(file, ".json")] = JSON.parse(await readFile(file, "utf8")) as unknown
    }
  }
  return result
}

export {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  auditContrast,
  classifyThemeState,
  compactTheme,
  contrastRatio,
  ensureReadable,
  generateSubtleSyntax,
  generateSyntax,
  generateSystem,
  hasTheme,
  isTheme,
  limitDepth,
  mapTheme,
  monochromeTheme,
  readableOn,
  redactThemeError,
  relativeLuminance,
  resolveTheme,
  resolveThemeCached,
  resolveThemeName,
  responsiveTheme,
  safeResolveTheme,
  sanitizeThemeSource,
  selectedForeground,
  tint,
  upsertTheme,
  type Theme,
  type ThemeJson,
  type ThemeLoadState,
  type SyntaxStyleOverrides,
} from "../theme"

const THEME_REFRESH_DELAYS = [250, 1000] as const

type State = {
  themes: Record<string, ThemeJson>
  active: string
  ready: boolean
}

const [store, setStore] = createStore<State>({
  themes: allThemes(),
  active: "ottili-coder",
  ready: false,
})

subscribeThemes((themes) => setStore("themes", themes))

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { source?: ThemeSource }) => {
    const renderer = useRenderer()
    const config = useTuiConfig()
    const kv = useKV()
    const themes = props.source ?? themeSource

    setStore(
      produce((draft) => {
        const active = config.theme ?? kv.get("theme", "ottili-coder")
        draft.active = typeof active === "string" ? active : "ottili-coder"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme
      if (theme) setStore("active", theme)
    })

    function syncCustomThemes() {
      return themes
        .discover()
        .then((themes) => {
          setCustomThemes(
            Object.entries(themes).reduce<Record<string, ThemeJson>>((result, [name, theme]) => {
              if (isTheme(theme)) result[name] = theme
              return result
            }, {}),
          )
        })
        .catch(() => setStore("active", "ottili-coder"))
    }

    onMount(() => {
      void Promise.allSettled([resolveSystemTheme(), syncCustomThemes()]).finally(() => {
        setStore("ready", true)
      })
    })

    let systemThemeSignature: string | undefined
    let hasResolvedSystemTheme = false
    function resolveSystemTheme() {
      return renderer
        .getPalette({ size: 16 })
        .then((colors: TerminalColors) => {
          if (!colors.palette[0]) {
            if (hasResolvedSystemTheme) return
            setSystemTheme(undefined)
            if (store.active === "system") setStore("active", "ottili-coder")
            return
          }
          const signature = JSON.stringify(colors)
          hasResolvedSystemTheme = true
          if (store.themes.system && systemThemeSignature === signature) return
          systemThemeSignature = signature
          setSystemTheme(generateSystem(colors, THEME_MODE))
        })
        .catch(() => {
          if (hasResolvedSystemTheme) return
          setSystemTheme(undefined)
          if (store.active === "system") setStore("active", "ottili-coder")
        })
    }

    let systemRefreshRunning = false
    let systemRefreshQueued = false
    function refreshSystemTheme() {
      if (systemRefreshRunning) {
        systemRefreshQueued = true
        return
      }

      systemRefreshRunning = true
      const retry = renderer.paletteDetectionStatus === "detecting"
      renderer.clearPaletteCache()
      void resolveSystemTheme().finally(() => {
        systemRefreshRunning = false
        if (!retry && !systemRefreshQueued) return
        systemRefreshQueued = false
        refreshSystemTheme()
      })
    }

    const handleThemeNotification = (sequence: string) => {
      if (sequence !== "\x1b[?997;1n" && sequence !== "\x1b[?997;2n") return false
      queueMicrotask(() => refreshSystemTheme())
      return false
    }
    renderer.prependInputHandler(handleThemeNotification)

    let themeRefreshTimeouts: ReturnType<typeof setTimeout>[] = []
    const refresh = () => {
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) =>
        setTimeout(() => {
          refreshSystemTheme()
          if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1]) void syncCustomThemes()
        }, delay),
      )
    }
    let unsubscribeRefresh: (() => void) | undefined
    unsubscribeRefresh = themes.subscribeRefresh?.(refresh)

    onCleanup(() => {
      renderer.removeInputHandler(handleThemeNotification)
      unsubscribeRefresh?.()
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts.length = 0
    })

    const values = createMemo(() => {
      const activeName = resolveThemeName(store.active)
      const active = store.themes[activeName]
      if (active) return safeResolveTheme(active, THEME_MODE)

      const saved = kv.get("theme")
      if (typeof saved === "string") {
        const theme = store.themes[resolveThemeName(saved)]
        if (theme) return safeResolveTheme(theme, THEME_MODE)
      }

      return safeResolveTheme(store.themes.ottiliCoder, THEME_MODE)
    })

    createEffect(() => renderer.setBackgroundColor(values().background))

    const syntax = createSyntaxStyleMemo(() => generateSyntax(values()))
    const subtleSyntax = createSyntaxStyleMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error Properties are forwarded to the current reactive value.
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all: allThemes,
      has: hasTheme,
      syntax,
      subtleSyntax,
      mode: () => THEME_MODE,
      locked: () => true,
      lock: () => {},
      unlock: () => {},
      setMode: () => {},
      set(theme: string) {
        if (!hasTheme(theme)) return false
        setStore("active", theme)
        kv.set("theme", theme)
        return true
      },
      get ready() {
        return store.ready
      },
    }
  },
})

export function createSyntaxStyleMemo(factory: () => SyntaxStyle) {
  const renderer = useRenderer()
  const retained = new Set<SyntaxStyle>()
  let current: SyntaxStyle | undefined

  const release = (style: SyntaxStyle) => {
    retained.add(style)
    void renderer
      .idle()
      .catch(() => {})
      .finally(() => {
        if (!retained.delete(style)) return
        style.destroy()
      })
  }

  onCleanup(() => {
    if (current) release(current)
  })

  return createMemo(() => {
    const previous = current
    current = factory()
    if (previous) release(previous)
    return current
  })
}
