import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  CHECKPOINT_TIMELINE_MAX_EVENTS,
  classifyCheckpointError,
  checkpointStatusIsEventful,
  detectNoColor,
  filterEvents,
  formatEventLine,
  formatTime,
  glyphFor,
  moveFocus,
  nextFilter,
  parseCheckpointMd,
  parseCheckpointTimeline,
  parseDecisions,
  parseKnownProblems,
  parseValidations,
  redactError,
  redactText,
  renderIndicatorText,
  statusBanner,
  toggleExpanded,
  type CheckpointTimelineContext,
} from "./model"

const CHECKPOINT = `# Checkpoint

**Last updated:** 2026-07-14T13:49:00.000Z
**Mode:** build
**Goal:** Implement session recovery after compaction

## Milestones
- [x] **wire resume handler** — completed
- [ ] **add CHECKPOINT.md parser** — in_progress
- [ ] **fix flaky DB** — blocked — teardown race

## Current Milestone
wire resume handler

## Next Action
run integration tests

## Blockers
- (none)
`

const DECISIONS = `## 2026-07-14T13:05:00.000Z
**Decision:** cache recoveryHint at compaction boundary
**Rationale:** avoids re-deriving from markdown

## 2026-07-14T12:00:00.000Z
**Decision:** rotate the api token weekly
**Rationale:** secret SK1234567890abc leaked last quarter
`

const VALIDATIONS = `## 2026-07-14T13:51:00.000Z
**Command:** \`bun test\`
**Result:**
\`\`\`
PASS (1m12s)
\`\`\`
`

const KNOWN = `## 2026-07-14T13:22:00.000Z
**Severity:** high
**Problem:** flaky DB teardown
**Unblock:** retry with transaction
`

const fullArgs = { checkpoint: CHECKPOINT, decisions: DECISIONS, validations: VALIDATIONS, knownProblems: KNOWN }

describe("parseCheckpointMd", () => {
  test("reads goal, mode, milestones, nextAction", () => {
    const parsed = parseCheckpointMd(CHECKPOINT)!
    expect(parsed.goal).toBe("Implement session recovery after compaction")
    expect(parsed.mode).toBe("build")
    expect(parsed.nextAction).toBe("run integration tests")
    expect(parsed.milestones.length).toBe(3)
    expect(parsed.milestones[0]?.status).toBe("completed")
    expect(parsed.milestones[1]?.status).toBe("in_progress")
    expect(parsed.milestones[2]?.status).toBe("blocked")
    expect(parsed.milestones[2]?.notes).toBe("teardown race")
  })

  test("returns undefined when nothing to reconstruct", () => {
    expect(parseCheckpointMd("")).toBeUndefined()
    expect(parseCheckpointMd(undefined)).toBeUndefined()
  })
})

describe("append-log parsers", () => {
  test("parses decisions with rationale", () => {
    const events = parseDecisions(DECISIONS)
    expect(events.length).toBe(2)
    expect(events[0]?.title).toBe("cache recoveryHint at compaction boundary")
    expect(events[0]?.detail).toContain("re-deriving")
    expect(events[0]?.timestamp).toBe("2026-07-14T13:05:00.000Z")
  })

  test("parses fenced validation result and classifies pass", () => {
    const events = parseValidations(VALIDATIONS)
    expect(events.length).toBe(1)
    expect(events[0]?.title).toBe("bun test")
    expect(events[0]?.detail).toContain("PASS (1m12s)")
    expect(events[0]?.status).toBe("pass")
  })

  test("parses known problems with severity and unblock", () => {
    const events = parseKnownProblems(KNOWN)
    expect(events.length).toBe(1)
    expect(events[0]?.title).toBe("flaky DB teardown")
    expect(events[0]?.severity).toBe("high")
    expect(events[0]?.detail).toBe("retry with transaction")
  })
})

describe("parseCheckpointTimeline — merge & sort", () => {
  test("merges all sources and sorts newest-first", () => {
    const state = parseCheckpointTimeline(fullArgs)
    expect(state.exists).toBe(true)
    expect(state.events.length).toBe(7)
    // newest timestamped event first: validation at 13:51
    expect(state.events[0]?.kind).toBe("validation")
    // milestones (no timestamp) keep file order at the tail
    expect(state.events.at(-1)?.kind).toBe("milestone")
    expect(state.milestoneDone).toBe(1)
    expect(state.milestoneTotal).toBe(3)
    expect(state.decisionCount).toBe(2)
    expect(state.failureCount).toBe(1)
    expect(state.resume).toBe("run integration tests")
  })

  test("no files => empty", () => {
    const state = parseCheckpointTimeline({})
    expect(state.exists).toBe(false)
    expect(state.status).toBe("empty")
    expect(state.events.length).toBe(0)
  })

  test("redacts secrets from titles, details and summary", () => {
    const state = parseCheckpointTimeline(fullArgs)
    const leaked = state.events.find((e) => e.title.includes("SK1234567890abc"))
    expect(leaked).toBeUndefined()
    const rationale = state.events.find((e) => e.detail?.includes("token"))?.detail ?? ""
    expect(rationale).not.toContain("SK1234567890abc")
    expect(state.accessibleSummary).not.toContain("SK1234567890abc")
  })
})

describe("classifyCheckpointError", () => {
  test("maps connectivity failures to offiline", () => {
    expect(classifyCheckpointError("ECONNREFUSED connection refused")).toBe("offline")
    expect(classifyCheckpointError("request timed out")).toBe("offline")
  })
  test("maps auth failures to denied", () => {
    expect(classifyCheckpointError("403 forbidden")).toBe("denied")
    expect(classifyCheckpointError("permission denied")).toBe("denied")
  })
  test("maps anything else to failure", () => {
    expect(classifyCheckpointError("boom")).toBe("failure")
    expect(classifyCheckpointError(undefined)).toBeUndefined()
  })
})

describe("status derivation precedence", () => {
  const ctx = (over: Partial<CheckpointTimelineContext> = {}): CheckpointTimelineContext => ({
    loading: false,
    ...over,
  })

  test("denied beats offline beats failure", () => {
    expect(parseCheckpointTimeline(fullArgs, ctx({ denied: true })).status).toBe("denied")
    expect(parseCheckpointTimeline(fullArgs, ctx({ offline: true })).status).toBe("offline")
    expect(parseCheckpointTimeline(fullArgs, ctx({ error: "boom" })).status).toBe("failure")
  })

  test("loading shows loading when nothing exists, degraded when it does", () => {
    expect(parseCheckpointTimeline({}, ctx({ loading: true })).status).toBe("loading")
    expect(parseCheckpointTimeline(fullArgs, ctx({ loading: true })).status).toBe("degraded")
  })

  test("long-content when the event count exceeds the render budget", () => {
    const blocks: string[] = []
    for (let i = 0; i < CHECKPOINT_TIMELINE_MAX_EVENTS + 10; i++) {
      blocks.push(`## 2026-07-14T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:00:00.000Z\n**Decision:** d${i}\n**Rationale:** r`)
    }
    const state = parseCheckpointTimeline({ decisions: blocks.join("\n") })
    expect(state.status).toBe("long-content")
    expect(state.visible.length).toBe(CHECKPOINT_TIMELINE_MAX_EVENTS)
    expect(state.truncated).toBeGreaterThan(0)
  })
})

describe("indicator & event rendering (terminal fallbacks)", () => {
  test("indicator shows counts and resume at standard width, hides resume when minimal", () => {
    const state = parseCheckpointTimeline(fullArgs)
    const wide = renderIndicatorText(
      {
        milestoneDone: state.milestoneDone,
        milestoneTotal: state.milestoneTotal,
        decisionCount: state.decisionCount,
        failureCount: state.failureCount,
        resume: state.resume,
        exists: state.exists,
      },
      100,
    )
    expect(wide).toContain("✓ 1/3")
    expect(wide).toContain("2 decisions")
    expect(wide).toContain("1 failure")
    expect(wide).toContain("↩ resume: run integration tests")

    const minimal = renderIndicatorText(
      {
        milestoneDone: state.milestoneDone,
        milestoneTotal: state.milestoneTotal,
        decisionCount: state.decisionCount,
        failureCount: state.failureCount,
        resume: state.resume,
        exists: state.exists,
      },
      30,
    )
    expect(minimal).toBe("✓ 1/3")
  })

  test("no checkpoint renders the quiet badge", () => {
    expect(renderIndicatorText({ exists: false, milestoneDone: 0, milestoneTotal: 0, decisionCount: 0, failureCount: 0, resume: undefined }, 100)).toBe(
      "· no checkpoint",
    )
  })

  test("no-color terminals get ASCII glyph fallbacks", () => {
    const event = parseCheckpointTimeline(fullArgs).events.find((e) => e.kind === "decision")!
    expect(glyphFor(event, false)).toBe("◆")
    expect(glyphFor(event, true)).toBe("*")
    const completed = parseCheckpointTimeline(fullArgs).events.find((e) => e.status === "completed")!
    expect(glyphFor(completed, true)).toBe("[x]")
  })

  test("event line degrades right-to-left across width tiers", () => {
    const event = parseValidations(VALIDATIONS)[0]!
    const wide = formatEventLine(event, 100, { noColor: false })
    expect(wide).toContain("validation")
    expect(wide).toContain("13:51")
    const minimal = formatEventLine(event, 30, { noColor: true })
    expect(minimal.startsWith("~ ")).toBe(true)
  })
})

describe("formatTime", () => {
  test("renders relative time", () => {
    const now = Date.parse("2026-07-14T14:00:00.000Z")
    expect(formatTime("2026-07-14T13:51:00.000Z", now)).toBe("9m ago")
    expect(formatTime("2026-07-13T14:00:00.000Z", now)).toBe("1d ago")
  })
})

describe("focus & filter", () => {
  test("moveFocus clamps at ends, no wrap", () => {
    expect(moveFocus({ events: [1, 2, 3] } as never, 1)).toBe(2)
    expect(moveFocus({ events: [1, 2, 3] } as never, -1)).toBe(2)
    expect(moveFocus({ events: [] } as never, 1)).toBe(-1)
  })

  test("nextFilter cycles through kinds and back to all", () => {
    expect(nextFilter("all")).toBe("milestone")
    expect(nextFilter("resume")).toBe("all")
  })

  test("filterEvents keeps order", () => {
    const state = parseCheckpointTimeline(fullArgs)
    const onlyFailures = filterEvents(state, "failure")
    expect(onlyFailures.length).toBe(1)
    expect(onlyFailures[0]?.kind).toBe("failure")
  })

  test("toggleExpanded flips membership", () => {
    const set = toggleExpanded(new Set<string>(), "a")
    expect(set.has("a")).toBe(true)
    expect(toggleExpanded(set, "a").has("a")).toBe(false)
  })
})

describe("status helpers", () => {
  test("checkpointStatusIsEventful distinguishes banner vs list", () => {
    expect(checkpointStatusIsEventful("populated")).toBe(true)
    expect(checkpointStatusIsEventful("empty")).toBe(false)
    expect(checkpointStatusIsEventful("loading")).toBe(false)
  })

  test("statusBanner redacts error diagnostics", () => {
    const banner = statusBanner("failure", "cannot read /secret/api=SK1234567890abc")
    expect(banner).not.toContain("SK1234567890abc")
    expect(banner).toContain("unavailable")
  })
})

describe("secret redaction", () => {
  test("redactText masks secret-shaped material", () => {
    expect(redactText("token SK1234567890abc leaked")).toBe("token SK•••• leaked")
  })
  test("redactError bounds and redacts", () => {
    const long = "x".repeat(500)
    expect(redactError(long).length).toBeLessThanOrEqual(241)
  })
})

describe("detectNoColor", () => {
  const prev = process.env.NO_COLOR
  afterAll(() => {
    if (prev === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = prev
  })
  test("true under NO_COLOR", () => {
    process.env.NO_COLOR = "1"
    expect(detectNoColor()).toBe(true)
  })
  test("false when color is allowed", () => {
    delete process.env.NO_COLOR
    expect(detectNoColor()).toBe(false)
  })
})
