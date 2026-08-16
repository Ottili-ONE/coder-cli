/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { describe, expect, test } from "bun:test"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import {
  buildProjectSwitcher,
  flattenWorktrees,
  type ProjectWorktree,
  type WorkspaceConnectionStatus,
} from "../../../src/component/project-switcher/model"
import type { Workspace } from "@opencode-ai/sdk/v2"
import { DialogSelect, type DialogSelectOption } from "../../../src/ui/dialog-select"
import { useTheme } from "../../../src/context/theme"

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: over.id ?? "ws-default",
    type: over.type ?? "local",
    name: over.name ?? "main",
    projectID: over.projectID ?? "proj-default",
    timeUsed: over.timeUsed ?? 0,
    ...over,
  }
}

function statusColor(status: WorkspaceConnectionStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "connected") return theme.success
  if (status === "connecting") return theme.warning
  if (status === "error" || status === "disconnected") return theme.error
  return theme.textMuted
}

/** Build the exact option list the Project switcher feeds into DialogSelect. */
function toOptions(
  workspaces: Workspace[],
  statuses: Record<string, string | undefined>,
  currentID: string | undefined,
  theme: ReturnType<typeof useTheme>["theme"],
): DialogSelectOption<ProjectWorktree>[] {
  const model = buildProjectSwitcher({ workspaces, statuses, currentID })
  return flattenWorktrees(model).map((wt) => ({
    title: wt.branch ? `${wt.name} · ${wt.branch}` : wt.name,
    value: wt,
    details: wt.directory ? [wt.directory] : undefined,
    footer: wt.location === "cloud" ? "cloud" : "local",
    category: model.repositories.find((r) => r.worktrees.some((w) => w.id === wt.id))?.name ?? "",
    gutter: () => <text fg={statusColor(wt.status, theme)}>●</text>,
  }))
}

function SwitcherSelect(props: {
  workspaces: Workspace[]
  statuses?: Record<string, string | undefined>
  currentID?: string | undefined
  width?: number
  onSelect?: (value: ProjectWorktree) => void
}) {
  const { theme } = useTheme()
  const options = toOptions(props.workspaces, props.statuses ?? {}, props.currentID, theme)
  const current = options.find((o) => o.value.id === props.currentID)?.value
  return (
    <DialogSelect<ProjectWorktree>
      title="Projects"
      options={options}
      current={current}
      onSelect={(option) => props.onSelect?.(option.value)}
    />
  )
}

async function renderSelect(
  width: number,
  workspaces: Workspace[],
  opts: {
    statuses?: Record<string, string | undefined>
    currentID?: string | undefined
    onSelect?: (value: ProjectWorktree) => void
  } = {},
) {
  const [
    { DialogProvider },
    { ThemeProvider },
    { ToastProvider },
    { KVProvider },
    { TuiConfigProvider },
    { OttiliCoderKeymapProvider, registerOttiliCoderKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/context/theme"),
    import("../../../src/ui/toast"),
    import("../../../src/context/kv"),
    import("../../../src/config"),
    import("../../../src/keymap"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOttiliCoderKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)
    return (
      <TestTuiContexts>
        <OttiliCoderKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider>
                <ToastProvider>
                  <DialogProvider>
                    <SwitcherSelect
                      workspaces={workspaces}
                      statuses={opts.statuses}
                      currentID={opts.currentID}
                      onSelect={opts.onSelect}
                    />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OttiliCoderKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width, height: 30, kittyKeyboard: true })
  await app.flush()
  return app
}

// --- Visible output: repositories, worktrees, local/cloud, status ---

describe("Project switcher — visible output", () => {
  test("groups worktrees under repository headers with branch and location", async () => {
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "proj-alpha", name: "feat-a", branch: "feature/a", directory: "/repo/alpha" }),
      ws({ id: "b", projectID: "proj-alpha", name: "feat-b", directory: "/repo/alpha" }),
      ws({ id: "c", projectID: "proj-beta", name: "main", type: "remote", directory: "/repo/beta" }),
    ])
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("Projects")
      expect(frame).toContain("proj-alpha")
      expect(frame).toContain("proj-beta")
      expect(frame).toContain("feat-a · feature/a")
      expect(frame).toContain("local")
      expect(frame).toContain("cloud")
    } finally {
      app.renderer.destroy()
    }
  })

  test("surfaces a status dot per worktree", async () => {
    const app = await renderSelect(
      120,
      [ws({ id: "a", projectID: "p1", name: "main" }), ws({ id: "b", projectID: "p1", name: "dev" })],
      { statuses: { a: "connected", b: "disconnected" } },
    )
    try {
      const frame = app.captureCharFrame()
      // Two worktrees -> two status gutters plus the current marker.
      const dots = frame.split("●").length - 1
      expect(dots).toBeGreaterThanOrEqual(2)
    } finally {
      app.renderer.destroy()
    }
  })

  test("marks the current worktree", async () => {
    const app = await renderSelect(
      120,
      [ws({ id: "a", projectID: "p1", name: "main" }), ws({ id: "b", projectID: "p1", name: "dev" })],
      { currentID: "b" },
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("dev")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Keyboard navigation & focus ---

describe("Project switcher — keyboard navigation", () => {
  test("arrow down then enter selects the second worktree", async () => {
    const selected: ProjectWorktree[] = []
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "p1", name: "main" }),
      ws({ id: "b", projectID: "p1", name: "dev" }),
      ws({ id: "c", projectID: "p1", name: "hotfix" }),
    ], { onSelect: (v) => selected.push(v) })
    try {
      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressEnter()
      await app.flush()
      expect(selected.map((w) => w.id)).toEqual(["b"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("arrow up at the top wraps to the last worktree", async () => {
    const selected: ProjectWorktree[] = []
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "p1", name: "main" }),
      ws({ id: "b", projectID: "p1", name: "dev" }),
      ws({ id: "c", projectID: "p1", name: "hotfix" }),
    ], { onSelect: (v) => selected.push(v) })
    try {
      app.mockInput.pressArrow("up")
      await app.flush()
      app.mockInput.pressEnter()
      await app.flush()
      expect(selected.map((w) => w.id)).toEqual(["c"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("home and end jump to the first and last worktree", async () => {
    const selected: ProjectWorktree[] = []
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "p1", name: "main" }),
      ws({ id: "b", projectID: "p1", name: "dev" }),
      ws({ id: "c", projectID: "p1", name: "hotfix" }),
    ], { onSelect: (v) => selected.push(v) })
    try {
      app.mockInput.pressKey("end")
      await app.flush()
      app.mockInput.pressEnter()
      await app.flush()
      expect(selected.map((w) => w.id)).toEqual(["c"])

      selected.length = 0
      app.mockInput.pressKey("home")
      await app.flush()
      app.mockInput.pressEnter()
      await app.flush()
      expect(selected.map((w) => w.id)).toEqual(["a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("typing a query filters the visible list", async () => {
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "p1", name: "main" }),
      ws({ id: "b", projectID: "p1", name: "dev" }),
    ])
    try {
      app.mockInput.pressKey("d")
      app.mockInput.pressKey("e")
      app.mockInput.pressKey("v")
      await app.flush()
      const frame = app.captureCharFrame()
      expect(frame).toContain("dev")
      expect(frame).not.toContain("main")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Terminal dimensions: narrow vs standard ---

describe("Project switcher — terminal dimensions", () => {
  test("standard width keeps repository grouping and all worktrees", async () => {
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "proj-alpha", name: "feat-a", branch: "feature/a", directory: "/repo/alpha" }),
      ws({ id: "b", projectID: "proj-beta", name: "main", type: "remote", directory: "/repo/beta" }),
    ])
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("proj-alpha")
      expect(frame).toContain("proj-beta")
      expect(frame).toContain("feat-a · feature/a")
    } finally {
      app.renderer.destroy()
    }
  })

  test("narrow width still renders the repository and worktree content", async () => {
    const app = await renderSelect(40, [
      ws({ id: "a", projectID: "proj-alpha", name: "feat-a", branch: "feature/a", directory: "/repo/alpha" }),
      ws({ id: "b", projectID: "proj-beta", name: "main", type: "remote", directory: "/repo/beta" }),
    ])
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("proj-alpha")
      expect(frame).toContain("feat-a")
      expect(frame).toContain("main")
    } finally {
      app.renderer.destroy()
    }
  })

  test("resize from standard to narrow preserves the grouped content", async () => {
    const app = await renderSelect(120, [
      ws({ id: "a", projectID: "proj-alpha", name: "feat-a", branch: "feature/a", directory: "/repo/alpha" }),
      ws({ id: "b", projectID: "proj-beta", name: "main", type: "remote", directory: "/repo/beta" }),
    ])
    try {
      expect(app.captureCharFrame()).toContain("proj-alpha")
      app.resize(40, 30)
      await app.flush()
      const resized = app.captureCharFrame()
      expect(resized).toContain("proj-alpha")
      expect(resized).toContain("feat-a")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Streaming updates ---

describe("Project switcher — streaming updates", () => {
  test("re-rendering with new data reflects the updated worktrees", async () => {
    const [workspaces, setWorkspaces] = createSignal<Workspace[]>([
      ws({ id: "a", projectID: "p1", name: "main", directory: "/repo/one" }),
      ws({ id: "b", projectID: "p1", name: "dev", directory: "/repo/one" }),
    ])
    const [
      { DialogProvider },
      { ThemeProvider },
      { ToastProvider },
      { KVProvider },
      { TuiConfigProvider },
      { OttiliCoderKeymapProvider, registerOttiliCoderKeymap },
    ] = await Promise.all([
      import("../../../src/ui/dialog"),
      import("../../../src/context/theme"),
      import("../../../src/ui/toast"),
      import("../../../src/context/kv"),
      import("../../../src/config"),
      import("../../../src/keymap"),
    ])

    function Panel() {
      const { theme } = useTheme()
      const options = () => toOptions(workspaces(), {}, undefined, theme)
      return (
        <DialogSelect<ProjectWorktree>
          title="Projects"
          options={options()}
          onSelect={() => {}}
        />
      )
    }

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
      const off = registerOttiliCoderKeymap(keymap, renderer, resolvedConfig)
      onCleanup(off)
      return (
        <TestTuiContexts>
          <OttiliCoderKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={resolvedConfig}>
              <KVProvider>
                <ThemeProvider>
                  <ToastProvider>
                    <DialogProvider>
                      <Panel />
                    </DialogProvider>
                  </ToastProvider>
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OttiliCoderKeymapProvider>
        </TestTuiContexts>
      )
    }

    const app = await testRender(() => <Harness />, { width: 120, height: 30, kittyKeyboard: true })
    try {
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("main")

      setWorkspaces([ws({ id: "x", projectID: "p2", name: "renamed", directory: "/repo/two" })])
      await app.flush()
      const updated = app.captureCharFrame()
      expect(updated).toContain("renamed")
      expect(updated).not.toContain("main")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Failure path ---

describe("Project switcher — failure path", () => {
  test("an empty workspace list shows the no-results fallback", async () => {
    const app = await renderSelect(120, [])
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("No results found")
    } finally {
      app.renderer.destroy()
    }
  })

  test("a query with no match falls back to no results", async () => {
    const app = await renderSelect(120, [ws({ id: "a", projectID: "p1", name: "main" })])
    try {
      app.mockInput.pressKey("z")
      app.mockInput.pressKey("z")
      app.mockInput.pressKey("z")
      await app.flush()
      expect(app.captureCharFrame()).toContain("No results found")
    } finally {
      app.renderer.destroy()
    }
  })
})
