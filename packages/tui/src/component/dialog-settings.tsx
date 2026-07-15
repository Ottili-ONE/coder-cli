/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useTuiConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { useRenderer } from "@opentui/solid"
import { openEditor } from "../editor"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  collectSettings,
  settingsStatusColorRole,
  settingsStatusGlyph,
  type SettingsSources,
} from "../ui/settings-model"
import { DialogModel } from "./dialog-model"
import { DialogMcp } from "./dialog-mcp"
import { DialogThemeList } from "./dialog-theme-list"
import { DialogGitStatus } from "./dialog-git-status"
import { DialogReleasePreview } from "./dialog-release-preview"

/**
 * Redesigned Settings hub for the Ottili Coder TUI.
 *
 * Surfaces real application state across nine domains (general, models,
 * permissions, MCP, hooks, Git, appearance, privacy, updates) as a single
 * searchable, keyboard- and mouse-navigable list, and routes each actionable
 * row to the canonical, already-real editor for that domain (the model picker,
 * MCP dialog, theme list, git status dialog, release preview, or the
 * ottiliCoder.json editor). It does not re-implement those editors, so there is
 * a single source of truth and no duplicated legacy view.
 *
 * The pure domain logic lives in `../ui/settings-model.ts`; this component only
 * assembles the injectable `SettingsSources` from live hooks and renders them
 * through the shared `DialogSelect` component.
 */
export function DialogSettings() {
  const themeCtx = useTheme()
  const theme = themeCtx.theme
  const sync = useSync()
  const local = useLocal()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const renderer = useRenderer()

  const cwd = typeof process.cwd === "function" ? process.cwd() : "."

  // One-shot sources that require filesystem / subprocess access. Read once on
  // mount so rapid render cycles stay cheap and stable during streaming.
  const [git, setGit] = createSignal<SettingsSources["git"]>({ available: false })
  onMount(() => {
    try {
      const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd })
      const statusProc = Bun.spawnSync(["git", "status", "--porcelain"], { cwd })
      const rootProc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd })
      const branch = branchProc.stdout.toString().trim()
      if (branchProc.success && branch) {
        setGit({
          available: true,
          branch,
          root: rootProc.stdout.toString().trim() || undefined,
          dirty: statusProc.stdout.toString().trim().length > 0,
        })
      } else {
        setGit({ available: false })
      }
    } catch {
      setGit({ available: false })
    }
  })

  const [hooks, setHooks] = createSignal<string[]>([])
  const [privacy, setPrivacy] = createSignal<SettingsSources["privacy"]>({
    telemetry: false,
    crashReports: false,
    clipboardHistory: true,
  })

  // ottiliCoder.json: hooks + privacy live here. Read once; honest defaults if absent.
  onMount(() => {
    void (async () => {
      try {
        const raw = await readFile(path.join(cwd, "ottiliCoder.json"), "utf8")
        const cfg = JSON.parse(raw) as {
          hooks?: Record<string, unknown> | unknown[]
          privacy?: { telemetry?: boolean; crashReports?: boolean; clipboardHistory?: boolean }
        }
        const hookEntries = cfg.hooks
          ? Array.isArray(cfg.hooks)
            ? cfg.hooks.map((h, i) => (typeof h === "string" ? h : `hook ${i + 1}`))
            : Object.keys(cfg.hooks)
          : []
        setHooks(hookEntries)
        if (cfg.privacy) {
          setPrivacy({
            telemetry: cfg.privacy.telemetry ?? false,
            crashReports: cfg.privacy.crashReports ?? false,
            clipboardHistory: cfg.privacy.clipboardHistory ?? true,
          })
        }
      } catch {
        // No config file — leave honest defaults.
      }
    })()
  })

  const sources = createMemo<SettingsSources>(() => {
    const session = sync.data.session[0]
    const currentModel = local.model.current()
    const version = session?.version ?? "unknown"
    const permissionRules = (session?.permission ?? []) as unknown as SettingsSources["permissionRules"]
    const mcp = sync.data.mcp as unknown as Record<string, SettingsSources["mcp"][string]>
    const themeNames = Object.keys(themeCtx.all())

    return {
      version,
      cwd,
      model: currentModel ? { providerID: currentModel.providerID, modelID: currentModel.modelID } : null,
      favoriteModels: local.model.favorite()?.length ?? 0,
      permissionRules,
      mcp,
      hooks: hooks(),
      git: git(),
      theme: { selected: themeCtx.selected, count: themeNames.length, mode: "dark" },
      tui: {
        mouse: tuiConfig.mouse,
        attentionSound: tuiConfig.attention?.sound ?? true,
        scrollAcceleration: tuiConfig.scroll_acceleration?.enabled ?? false,
        diffStyle: tuiConfig.diff_style ?? "auto",
      },
      privacy: privacy(),
      update: { status: "unknown", channel: "latest" },
    }
  })

  const data = createMemo(() => collectSettings(sources()))

  const colorFor = (status: ReturnType<typeof settingsStatusColorRole>) => {
    switch (status) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      case "info":
      case "text":
      default:
        return theme.textMuted
    }
  }

  function runAction(command: string) {
    switch (command) {
      case "dialog.model":
        dialog.replace(() => <DialogModel />)
        return
      case "dialog.mcp":
        dialog.replace(() => <DialogMcp />)
        return
      case "dialog.theme":
        dialog.replace(() => <DialogThemeList />)
        return
      case "dialog.git":
        dialog.replace(() => <DialogGitStatus />)
        return
      case "dialog.release":
        dialog.replace(() => <DialogReleasePreview cwd={cwd} />)
        return
      case "dialog.permissions":
      case "dialog.config":
        void editConfig()
        return
    }
  }

  async function editConfig() {
    let value = "{}\n"
    try {
      value = await readFile(path.join(cwd, "ottiliCoder.json"), "utf8")
    } catch {}
    await openEditor({ renderer, value, cwd })
  }

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    data().sections.flatMap((section) => {
      const sectionColor = colorFor(settingsStatusColorRole(section.status))
      const rows: DialogSelectOption<string>[] = section.rows.map((row) => ({
        title: row.label,
        value: `${section.id}:${row.label}`,
        category: section.title,
        categoryView: <span style={{ fg: sectionColor }}>{settingsStatusGlyph(section.status)}</span>,
        description: row.value,
        details: row.detail ? [row.detail] : undefined,
        footer: row.action ? (
          <span style={{ fg: theme.textMuted }}>{row.action.label}</span>
        ) : (
          <span style={{ fg: colorFor(settingsStatusColorRole(row.status ?? "ok")) }}>
            {row.status ? settingsStatusGlyph(row.status, false) : ""}
          </span>
        ),
        onSelect: row.action ? () => runAction(row.action!.command) : undefined,
      }))
      // When a section has no rows, surface an honest note as a single entry.
      if (rows.length === 0) {
        return [
          {
            title: section.note ?? "Nothing configured",
            value: `section:${section.id}`,
            category: section.title,
            categoryView: <span style={{ fg: sectionColor }}>{settingsStatusGlyph(section.status)}</span>,
            description: "",
          },
        ]
      }
      return rows
    }),
  )

  return (
    <DialogSelect
      title="Settings"
      options={options()}
      skipFilter={false}
    />
  )
}
