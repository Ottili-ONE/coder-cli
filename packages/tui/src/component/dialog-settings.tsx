/** @jsxImportSource @opentui/solid */
import { For, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useTuiConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
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
 * permissions, MCP, hooks, Git, appearance, privacy, updates) and routes each
 * row to the canonical, already-real editor for that domain (the model picker,
 * MCP dialog, theme list, git status dialog, release preview, or the
 * ottiliCoder.json editor). It does not re-implement those editors, so there is
 * a single source of truth and no duplicated legacy view.
 *
 * The pure domain logic lives in `../ui/settings-model.ts`; this component only
 * assembles the injectable `SettingsSources` from live hooks and renders them
 * through the shared `DialogSelect` component (keyboard + mouse + filter).
 */
export function DialogSettings() {
  const theme = useTheme()
  const sync = useSync()
  const local = useLocal()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const renderer = useRenderer()
  const term = useTerminalDimensions()

  const cwd = typeof process.cwd === "function" ? process.cwd() : "."

  // One-shot sources that require filesystem / subprocess access. These are
  // read once on mount so rapid render cycles stay cheap and stable.
  const [git, setGit] = createSignal<SettingsSources["git"]>(null)
  const [hooks, setHooks] = createSignal<string[]>([])
  const [privacy, setPrivacy] = createSignal<SettingsSources["privacy"]>({
    telemetry: false,
    crashReports: false,
    clipboardHistory: true,
  })

  onMount(() => {
    // Git: read branch + working-tree dirtiness (real, local, cheap).
    try {
      const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd })
      const statusProc = Bun.spawnSync(["git", "status", "--porcelain"], { cwd })
      const branch = branchProc.stdout.toString().trim()
      const rootProc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd })
      const root = rootProc.stdout.toString().trim()
      if (branch && !branchProc.success === false) {
        setGit({
          available: true,
          branch,
          root: root || undefined,
          dirty: statusProc.stdout.toString().trim().length > 0,
        })
      } else {
        setGit({ available: false })
      }
    } catch {
      setGit({ available: false })
    }

    // ottiliCoder.json: hooks + privacy live here. Honest defaults if absent/unreadable.
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
    const permissionRules = (session?.permission ?? []) as SettingsSources["permissionRules"]
    const mcp = sync.data.mcp as unknown as Record<string, SettingsSources["mcp"][string]>
    const themeInfo = theme.all()
    const themeNames = Object.keys(themeInfo)

    return {
      version,
      cwd,
      model: currentModel ? { providerID: currentModel.providerID, modelID: currentModel.modelID } : null,
      favoriteModels: (local.model.favorite()?.length ?? 0),
      permissionRules,
      mcp,
      hooks: hooks(),
      git: git(),
      theme: { selected: theme.selected, count: themeNames.length, mode: "dark" },
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

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    data().sections.map((section) => {
      const color = colorFor(settingsStatusColorRole(section.status))
      return {
        title: section.title,
        value: section.id,
        category: "Settings",
        categoryView: <span style={{ fg: color }}>{settingsStatusGlyph(section.status)}</span>,
        description: section.note ?? `${section.rows.length} item(s)`,
        footer: settingsStatusGlyph(section.status, false),
        onSelect: () => openSection(section.id),
      } satisfies DialogSelectOption<string>
    }),
  )

  function openSection(id: string) {
    const section = data().sections.find((s) => s.id === id)
    if (!section) return
    dialog.replace(() => <SettingsSectionDetail section={section} onBack={() => dialog.replace(() => <DialogSettings />)} />)
  }

  return (
    <DialogSelect
      title="Settings"
      options={options()}
      skipFilter={false}
      onSelect={(option) => option.onSelect?.()}
    />
  )
}

/**
 * Detail view for a single settings section. Renders the real rows for that
 * domain and routes each actionable row to its canonical editor. This keeps the
 * single-source-of-truth contract: the hub never edits state itself, it opens
 * the real surface.
 */
function SettingsSectionDetail(props: {
  section: import("../ui/settings-model").SettingsSection
  onBack: () => void
}) {
  const dialog = useDialog()
  const renderer = useRenderer()
  const cwd = typeof process.cwd === "function" ? process.cwd() : "."
  const theme = useTheme()

  async function editConfig() {
    let value = "{}\n"
    try {
      value = await readFile(path.join(cwd, "ottiliCoder.json"), "utf8")
    } catch {}
    const result = await openEditor({ renderer, value, cwd })
    if (result !== undefined) {
      props.onBack()
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

  const sectionOptions = createMemo<DialogSelectOption<string>[]>(() =>
    props.section.rows.map((row) => {
      const color = row.status ? colorFor(row.status) : theme.text
      return {
        title: row.label,
        value: `${props.section.id}:${row.label}`,
        description: row.value,
        details: row.detail ? [row.detail] : undefined,
        footer: row.action ? (
          <span style={{ fg: theme.textMuted }}>{row.action.label}</span>
        ) : (
          <span style={{ fg: color }}>{row.status ? settingsStatusGlyph(row.status, false) : ""}</span>
        ),
        onSelect: () => {
          if (row.action) runAction(row.action.command)
        },
      } satisfies DialogSelectOption<string>
    }),
  )

  function colorFor(status: "ok" | "warn" | "error" | "unknown") {
    switch (settingsStatusColorRole(status)) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      default:
        return theme.textMuted
    }
  }

  return (
    <DialogSelect
      title={props.section.title}
      options={sectionOptions()}
      skipFilter={false}
      actions={[
        {
          command: "settings.back",
          title: "back",
          onTrigger: () => props.onBack(),
        },
      ]}
      onSelect={(option) => option.onSelect?.()}
    />
  )
}
