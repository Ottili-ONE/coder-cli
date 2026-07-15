import { describe, expect, test } from "bun:test"
import {
  ERROR_MAX,
  NARROW_WIDTH_DEFAULT,
  actionFor,
  buildSegments,
  deriveStatus,
  focusIndexForKind,
  gitStatusState,
  isNarrowTerminal,
  mergeStatus,
  moveFocus,
  parseGitError,
  redactError,
  type GitBarContext,
  type GitRepoStatus,
} from "../../../src/component/git-status/model"

function status(over: Partial<GitRepoStatus> = {}): GitRepoStatus {
  return { branch: "main", ...over }
}

function ctx(over: Partial<GitBarContext> = {}): GitBarContext {
  return { isGit: true, loading: false, ...over }
}

describe("deriveStatus classifies the whole bar lifecycle", () => {
  test("not-git when the directory is not a repository", () => {
    expect(deriveStatus(ctx({ isGit: false }), status())).toBe("not-git")
  })
  test("error wins over everything else", () => {
    expect(deriveStatus(ctx({ error: "boom" }), status({ dirty: true, conflicts: 2 }))).toBe("error")
  })
  test("syncing while a refresh is in flight", () => {
    expect(deriveStatus(ctx({ loading: true }), status({ dirty: true }))).toBe("syncing")
  })
  test("conflict takes priority over a dirty tree", () => {
    expect(deriveStatus(ctx(), status({ dirty: true, conflicts: 1 }))).toBe("conflict")
  })
  test("dirty when the tree has changes but no conflicts", () => {
    expect(deriveStatus(ctx(), status({ dirty: true }))).toBe("dirty")
  })
  test("clean for an untouched tree", () => {
    expect(deriveStatus(ctx(), status())).toBe("clean")
  })
})

describe("buildSegments projects every git indicator", () => {
  test("branch segment is always present", () => {
    const segments = buildSegments(status())
    expect(segments[0].kind).toBe("branch")
    expect(segments[0].label).toBe("main")
    expect(segments[0].glyph).toBe("⎇")
  })
  test("detached HEAD shows a dedicated label", () => {
    expect(buildSegments(status({ detached: true, branch: undefined }))[0].label).toBe("detached")
  })
  test("dirty segment appears with a change count", () => {
    const segments = buildSegments(status({ dirty: true, modified: 3, untracked: 2 }))
    const dirty = segments.find((s) => s.kind === "dirty")
    expect(dirty).toBeDefined()
    expect(dirty!.label).toBe("dirty 5")
  })
  test("sync segment renders ahead/behind detail and is wide-only", () => {
    const segments = buildSegments(status({ ahead: 2, behind: 1 }))
    const sync = segments.find((s) => s.kind === "sync")
    expect(sync).toBeDefined()
    expect(sync!.detail).toBe("↑2 ↓1")
    expect(sync!.wideOnly).toBe(true)
  })
  test("worktree segment appears only in a worktree", () => {
    const segments = buildSegments(status({ worktree: true, worktreePath: "feature" }))
    const wt = segments.find((s) => s.kind === "worktree")
    expect(wt).toBeDefined()
    expect(wt!.label).toBe("worktree feature")
    expect(wt!.wideOnly).toBe(true)
  })
  test("conflict segment shows the unresolved count", () => {
    const segments = buildSegments(status({ conflicts: 3 }))
    const conflict = segments.find((s) => s.kind === "conflict")
    expect(conflict).toBeDefined()
    expect(conflict!.detail).toBe("3")
  })
  test("clean tree with no divergence produces only the branch segment", () => {
    const segments = buildSegments(status())
    expect(segments.map((s) => s.kind)).toEqual(["branch"])
  })
})

describe("segment visibility responds to terminal width", () => {
  test("standard width keeps wide-only segments", () => {
    const state = gitStatusState(status({ ahead: 1, worktree: true }), ctx(), { width: 120 })
    const kinds = state.segments.map((s) => s.kind)
    expect(kinds).toContain("sync")
    expect(kinds).toContain("worktree")
    expect(state.narrow).toBe(false)
  })
  test("narrow width drops wide-only segments but keeps branch and conflict", () => {
    const state = gitStatusState(status({ ahead: 1, worktree: true, conflicts: 1 }), ctx(), { width: 40 })
    const kinds = state.segments.map((s) => s.kind)
    expect(kinds).toContain("branch")
    expect(kinds).toContain("conflict")
    expect(kinds).not.toContain("sync")
    expect(kinds).not.toContain("worktree")
    expect(state.narrow).toBe(true)
  })
  test("isNarrowTerminal uses the default threshold", () => {
    expect(isNarrowTerminal(NARROW_WIDTH_DEFAULT - 1)).toBe(true)
    expect(isNarrowTerminal(NARROW_WIDTH_DEFAULT)).toBe(false)
  })
})

describe("keyboard focus navigation", () => {
  const full = status({ dirty: true, ahead: 1, worktree: true, conflicts: 1 })

  test("starts focused on the first segment", () => {
    const state = gitStatusState(full, ctx(), { width: 120 })
    expect(state.focusIndex).toBe(0)
    expect(state.focusedKind).toBe("branch")
  })
  test("right/left move the focus and clamp at the ends", () => {
    let state = gitStatusState(full, ctx(), { width: 120 })
    state = { ...state, focusIndex: moveFocus(state, 1) }
    expect(state.focusedKind).toBe("dirty")
    state = { ...state, focusIndex: moveFocus(state, 1) }
    expect(state.focusedKind).toBe("sync")
    // Move past the end clamps to the last segment.
    state = { ...state, focusIndex: moveFocus(state, 1) }
    state = { ...state, focusIndex: moveFocus(state, 1) }
    state = { ...state, focusIndex: moveFocus(state, 1) }
    expect(state.focusedKind).toBe("conflict")
    // Move before the start clamps to the first segment.
    state = { ...state, focusIndex: moveFocus(state, -1) }
    state = { ...state, focusIndex: moveFocus(state, -1) }
    state = { ...state, focusIndex: moveFocus(state, -1) }
    expect(state.focusedKind).toBe("branch")
  })
  test("focusIndexForKind jumps straight to a segment", () => {
    const state = gitStatusState(full, ctx(), { width: 120 })
    expect(focusIndexForKind(state, "worktree")).toBe(state.segments.findIndex((s) => s.kind === "worktree"))
  })
  test("focus survives a narrow resize that hides wide-only segments", () => {
    const wide = gitStatusState(full, ctx(), { width: 120 })
    // Focus the worktree segment (wide-only) then narrow: focus coalesces to branch.
    const focusedWorktree = { ...wide, focusIndex: focusIndexForKind(wide, "worktree") }
    const narrowed = gitStatusState(full, ctx(), { width: 40, focusIndex: focusedWorktree.focusIndex })
    expect(narrowed.focusedKind).toBe("branch")
  })
})

describe("activation actions map focus to intent", () => {
  test("each focusable segment emits the right action", () => {
    expect(actionFor("branch")).toEqual({ type: "branch" })
    expect(actionFor("dirty")).toEqual({ type: "changes" })
    expect(actionFor("sync")).toEqual({ type: "sync" })
    expect(actionFor("worktree")).toEqual({ type: "worktree" })
    expect(actionFor("conflict")).toEqual({ type: "resolve" })
  })
  test("no action when nothing is focused", () => {
    expect(actionFor(null)).toBeNull()
  })
})

describe("streaming updates reconcile partial status", () => {
  test("merging a partial update preserves omitted fields", () => {
    const prev = status({ dirty: true, modified: 2, ahead: 1, behind: 0 })
    const next = mergeStatus(prev, { dirty: false })
    expect(next.dirty).toBe(false)
    expect(next.modified).toBe(2)
    expect(next.ahead).toBe(1)
  })
  test("a streaming refresh marks the bar stale and syncing", () => {
    const state = gitStatusState(status({ dirty: true }), ctx({ loading: true }), { width: 120 })
    expect(state.status).toBe("syncing")
    expect(state.stale).toBe(true)
  })
  test("the bar returns to clean once the refresh lands", () => {
    const streaming = gitStatusState(status({ dirty: true }), ctx({ loading: true }), { width: 120 })
    const settled = gitStatusState(status({ dirty: false }), ctx({ loading: false }), { width: 120 })
    expect(streaming.status).toBe("syncing")
    expect(settled.status).toBe("clean")
    expect(settled.stale).toBe(false)
  })
})

describe("failure path redacts and classifies git errors", () => {
  test("not-a-repo is classified to a friendly message", () => {
    expect(parseGitError("fatal: not a git repository (or any of the parent directories)")).toBe(
      "not a git repository",
    )
  })
  test("dubious ownership is surfaced safely", () => {
    expect(parseGitError("fatal: detected dubious ownership in repository")).toContain("dubious")
  })
  test("unknown errors fall through to the redacted original", () => {
    const msg = parseGitError("fatal: unexpected thing token = sk-abcdefghijklmnopqrstuvwxyz")
    expect(msg).not.toContain("sk-")
    expect(msg!.length).toBeLessThanOrEqual(ERROR_MAX)
  })
  test("secrets are redacted and bounded", () => {
    const redacted = redactError("Bearer secret-token-abcdefghijklmnopqrstuvwxyz-extra")
    expect(redacted).not.toContain("secret-token")
    expect(redacted.length).toBeLessThanOrEqual(ERROR_MAX)
  })
  test("error status produces a safe summary and suppresses segments", () => {
    const state = gitStatusState(status({ dirty: true }), ctx({ error: "git crashed" }), { width: 120 })
    expect(state.status).toBe("error")
    expect(state.summaryText).toContain("Git status unavailable")
    expect(state.segments).toEqual([])
  })
})

describe("summary text is semantic, not implementation trivia", () => {
  test("clean tree", () => {
    expect(gitStatusState(status(), ctx(), { width: 120 }).summaryText).toBe("Git — main · clean")
  })
  test("clean tree with divergence", () => {
    expect(gitStatusState(status({ ahead: 2, behind: 1 }), ctx(), { width: 120 }).summaryText).toBe(
      "Git — main · clean · ↑2 ↓1",
    )
  })
  test("dirty tree", () => {
    expect(gitStatusState(status({ dirty: true }), ctx(), { width: 120 }).summaryText).toBe(
      "Git — main · dirty",
    )
  })
  test("conflict tree", () => {
    expect(gitStatusState(status({ conflicts: 2 }), ctx(), { width: 120 }).summaryText).toBe(
      "Git — main · 2 conflicts",
    )
  })
  test("detached head", () => {
    expect(gitStatusState(status({ detached: true, branch: undefined }), ctx(), { width: 120 }).summaryText).toBe(
      "Git — detached HEAD · clean",
    )
  })
})
