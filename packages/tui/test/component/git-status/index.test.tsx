/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"
import { GitStatusBar, type GitStatusBarProps } from "../../../src/component/git-status/index"
import type { GitBarAction, GitRepoStatus } from "../../../src/component/git-status/model"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

function repo(over: Partial<GitRepoStatus> = {}): GitRepoStatus {
  return { branch: "main", ...over }
}

type Action = GitBarAction

async function renderBar(width: number, props: GitStatusBarProps) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <GitStatusBar {...props} />
      </TestTuiContexts>
    ),
    { width, height: 20 },
  )
  await app.renderOnce()
  return app
}

// --- Semantic render coverage (visible output, not implementation trivia) ---

describe("Git status bar — visible output", () => {
  test("renders branch, dirty state and ahead/behind divergence", async () => {
    const app = await renderBar(120, {
      status: accessor(repo({ dirty: true, modified: 2, ahead: 2, behind: 1 })),
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("⎇ main")
      expect(frame).toContain("dirty")
      expect(frame).toContain("↑2")
      expect(frame).toContain("↓1")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders a conflict indicator with the unresolved count", async () => {
    const app = await renderBar(120, { status: accessor(repo({ conflicts: 3 })) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("⚠")
      expect(frame).toContain("conflict")
      expect(frame).toContain("3")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders a worktree indicator when in a worktree", async () => {
    const app = await renderBar(120, { status: accessor(repo({ worktree: true, worktreePath: "feature" })) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("⚑")
      expect(frame).toContain("worktree")
      expect(frame).toContain("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders a detached HEAD without a branch crash", async () => {
    const app = await renderBar(120, { status: accessor(repo({ detached: true, branch: undefined })) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("detached")
    } finally {
      app.renderer.destroy()
    }
  })

  test("shows 'not a git repository' outside a repo", async () => {
    const app = await renderBar(120, { status: accessor(repo()), isGit: accessor(false) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("not a git repository")
    } finally {
      app.renderer.destroy()
    }
  })

  test("failure path: surfaces the git error and hides segments", async () => {
    const app = await renderBar(120, {
      status: accessor(repo({ dirty: true })),
      error: accessor("fatal: not a git repository (or any of the parent directories)"),
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("Git status unavailable")
      expect(frame).toContain("not a git repository")
      expect(frame).not.toContain("⎇ main")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Keyboard navigation & focus regression coverage ---

describe("Git status bar — keyboard navigation", () => {
  test("arrow keys move focus between segments", async () => {
    const app = await renderBar(120, {
      status: accessor(repo({ dirty: true, ahead: 1, worktree: true, conflicts: 1 })),
    })
    try {
      const initial = app.captureCharFrame()
      expect(initial).toContain("> ⎇ main")
      expect(initial).not.toContain("> ●")

      app.mockInput.pressArrow("right")
      await app.flush()
      const afterRight = app.captureCharFrame()
      expect(afterRight).toContain("> ● dirty")
      expect(afterRight).not.toContain("> ⎇ main")

      app.mockInput.pressArrow("left")
      await app.flush()
      const afterLeft = app.captureCharFrame()
      expect(afterLeft).toContain("> ⎇ main")
    } finally {
      app.renderer.destroy()
    }
  })

  test("navigation clamps at the first and last segment", async () => {
    const app = await renderBar(120, {
      status: accessor(repo({ dirty: true, ahead: 1 })),
    })
    try {
      app.mockInput.pressArrow("left")
      await app.flush()
      expect(app.captureCharFrame()).toContain("> ⎇ main")

      app.mockInput.pressArrow("right")
      await app.flush()
      app.mockInput.pressArrow("right")
      await app.flush()
      app.mockInput.pressArrow("right")
      await app.flush()
      // Only branch + dirty + sync exist; extra rights clamp on sync.
      expect(app.captureCharFrame()).toContain("↑1")
    } finally {
      app.renderer.destroy()
    }
  })

  test("enter emits the action for the focused segment", async () => {
    let action: Action | undefined
    const app = await renderBar(120, {
      status: accessor(repo({ dirty: true })),
      onAction: (a) => (action = a),
    })
    try {
      // Branch is focused first.
      app.mockInput.pressEnter()
      await app.flush()
      expect(action).toEqual({ type: "branch" })

      app.mockInput.pressArrow("right")
      await app.flush()
      app.mockInput.pressEnter()
      await app.flush()
      expect(action).toEqual({ type: "changes" })
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- State transitions via streaming ---

describe("Git status bar — streaming updates", () => {
  test("re-rendering with a new status shows the latest divergence", async () => {
    const [status, setStatus] = createSignal<GitRepoStatus>(repo({ dirty: false }))
    const app = await renderBar(120, { status })
    try {
      const clean = app.captureCharFrame()
      expect(clean).toContain("clean")
      expect(clean).not.toContain("↑")

      setStatus(repo({ dirty: true, ahead: 3, behind: 2 }))
      await app.flush()
      const dirty = app.captureCharFrame()
      expect(dirty).toContain("dirty")
      expect(dirty).toContain("↑3")
      expect(dirty).toContain("↓2")
    } finally {
      app.renderer.destroy()
    }
  })

  test("a refresh shows the syncing state, then settles", async () => {
    const [loading, setLoading] = createSignal(false)
    const app = await renderBar(120, { status: accessor(repo({ dirty: true })), loading })
    try {
      expect(app.captureCharFrame()).not.toContain("syncing")

      setLoading(true)
      await app.flush()
      expect(app.captureCharFrame()).toContain("syncing")

      setLoading(false)
      await app.flush()
      expect(app.captureCharFrame()).not.toContain("syncing")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Terminal dimensions: narrow vs standard ---

describe("Git status bar — terminal dimensions", () => {
  test("standard width keeps the ahead/behind and worktree segments", async () => {
    const app = await renderBar(120, { status: accessor(repo({ ahead: 1, worktree: true })) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("↑1")
      expect(frame).toContain("worktree")
    } finally {
      app.renderer.destroy()
    }
  })

  test("narrow width collapses to branch plus conflict only", async () => {
    const app = await renderBar(40, {
      status: accessor(repo({ ahead: 1, worktree: true, conflicts: 1 })),
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("⎇ main")
      expect(frame).toContain("⚠")
      expect(frame).not.toContain("↑1")
      expect(frame).not.toContain("worktree")
    } finally {
      app.renderer.destroy()
    }
  })

  test("resize from standard to narrow drops wide-only segments", async () => {
    const app = await renderBar(120, { status: accessor(repo({ ahead: 1, worktree: true })) })
    try {
      expect(app.captureCharFrame()).toContain("↑1")

      app.resize(40, 20)
      await app.flush()
      const resized = app.captureCharFrame()
      expect(resized).toContain("⎇ main")
      expect(resized).not.toContain("↑1")
      expect(resized).not.toContain("worktree")
    } finally {
      app.renderer.destroy()
    }
  })
})
