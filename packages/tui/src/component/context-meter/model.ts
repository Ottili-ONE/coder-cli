/**
 * Context usage meter domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the meter logic can be unit tested in isolation and reused
 * by the Solid component in `./index.tsx`. Every transition is pure: it takes
 * inputs and returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The meter projects the last assistant turn's token accounting into a single
 * focusable panel — overall context usage, cache read/write, working memory,
 * the compaction threshold, and the context sources breakdown — with a derived
 * lifecycle status that the panel header renders. It mirrors the conventions of
 * the `git-status` and `task-queue` components: a `contextMeterState` entry
 * point, a derived `status`, visible/filtered selection, and a context object
 * that lifts harness concerns (loading / error) above the raw token data so the
 * same model serves live, streaming and failure states.
 */

import stripAnsi from "strip-ansi"

/** Whole-meter lifecycle derived from harness context + token data. */
export type ContextMeterStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

export interface ContextMeterProvider {
  id: string
  name?: string
  models: Record<string, ContextMeterModel | undefined>
}

export interface ContextMeterModel {
  name?: string
  limit: { context: number }
  /** Compaction threshold as a percentage of the context window (0..100). */
  compaction?: number
  /** Token budget reserved for working memory (optional). */
  memory?: number
}

export interface ContextMeterMessage {
  role: "assistant"
  providerID: string
  modelID: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type ContextSourceKey = "system" | "user" | "assistant" | "tool" | "other"

export interface ContextSource {
  key: ContextSourceKey
  label: string
  glyph: string
  tokens: number
  /** Percentage of the total context (0..100, rounded). */
  percent: number
  focusable: boolean
  wideOnly: boolean
}

/** Harness-level concerns lifted above the raw token data. */
export interface ContextMeterContext {
  /** Session/meter data is available to render. */
  isReady: boolean
  /** A refresh (streaming) is currently in flight. */
  loading?: boolean
  /** Harness-level error (session missing, provider lookup failed). Redacted on render. */
  error?: string
  /** The session/provider backend is unreachable. */
  offline?: boolean
  /** The caller is not permitted to read these metrics. */
  denied?: boolean
}

export const COMPACTION_DEFAULT_THRESHOLD = 80
export const NARROW_WIDTH_DEFAULT = 60
export const ERROR_MAX = 240
/** Token counts at/above this are rendered compactly and flagged as long-content. */
export const LONG_CONTENT_TOKENS = 100_000
/** Maximum cadence (ms) at which a live, streaming meter re-samples its source. */
export const RENDER_BUDGET_MS = 400

// --- input normalization ----------------------------------------------------

function redactSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(/\bsk-[A-Za-z0-9]{8,}/gi, "sk-••••")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/gi, "ghp_••••")
    .replace(/\bAKIA[0-9A-Z]{16}/g, "AKIA••••")
    .replace(/\bxox[baprs]-[0-9a-z-]+/gi, "xox-••••")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "eyJ••••")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ••••")
    .replace(/\b(token|secret|api[_-]?key|password)[=:]\S+/gi, "$1=••••")
}

function truncateError(text: string): string {
  const cleaned = stripAnsi(text ?? "").replace(/\t/g, "  ").trim()
  if (cleaned.length <= ERROR_MAX) return cleaned
  return cleaned.slice(0, ERROR_MAX - 1) + "…"
}

/** Redact and bound a harness error for safe display. */
export function redactError(text: string): string {
  return redactSecrets(truncateError(text))
}

/**
 * Map a raw error string to a friendly, redacted message. Unknown errors fall
 * through to the redacted original so the meter never throws.
 */
export function parseContextError(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = redactError(raw)
  if (/session not found|no such session|unknown session/i.test(text)) return "session not available"
  if (/provider not found|no such provider|unknown provider/i.test(text)) return "provider not available"
  if (/rate limit|429/i.test(text)) return "usage refresh rate limited"
  if (/forbidden|403|access denied|permission/i.test(text)) return "access denied"
  return text
}

// --- formatting & terminal fallbacks ---------------------------------------

/** Compact token counts so very large contexts stay within the render budget. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "0"
  if (value === 0) return "0"
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 1000)}K`
  return value.toLocaleString()
}

/** ASCII progress bar — the color-independent fallback for no-color terminals. */
export function buildMeterBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.max(0, Math.min(width, Math.round((clamped / 100) * width)))
  return "[" + "=".repeat(filled) + "-".repeat(width - filled) + "]"
}

/** True when the content is large enough to need compacted rendering. */
export function isLongContent(data: ContextMeterData): boolean {
  return (
    data.tokens.total > LONG_CONTENT_TOKENS ||
    data.providerLabel.length > 24 ||
    data.modelLabel.length > 24
  )
}

// --- token math -------------------------------------------------------------

const tokenTotal = (msg: ContextMeterMessage) =>
  msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write

function lastAssistantWithTokens(messages: ContextMeterMessage[]): ContextMeterMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
  return undefined
}

/**
 * Build a default context-sources breakdown from a single assistant message
 * when the caller does not supply an explicit (system/user/assistant/tool)
 * breakdown. The split reflects where the context tokens came from.
 */
export function buildDefaultSources(msg: ContextMeterMessage): ContextSource[] {
  const total = tokenTotal(msg)
  if (total <= 0) return []
  const parts: { key: ContextSourceKey; label: string; glyph: string; tokens: number }[] = [
    { key: "user", label: "prompt", glyph: "▤", tokens: msg.tokens.input },
    { key: "assistant", label: "completion", glyph: "✦", tokens: msg.tokens.output },
    { key: "assistant", label: "reasoning", glyph: "◇", tokens: msg.tokens.reasoning },
    { key: "tool", label: "cache read", glyph: "⊟", tokens: msg.tokens.cache.read },
    { key: "tool", label: "cache write", glyph: "⊞", tokens: msg.tokens.cache.write },
  ]
  return parts
    .filter((p) => p.tokens > 0)
    .map((p) => ({
      key: p.key,
      label: p.label,
      glyph: p.glyph,
      tokens: p.tokens,
      percent: Math.round((p.tokens / total) * 100),
      focusable: true,
      wideOnly: false,
    }))
}

// --- meter data assembly ----------------------------------------------------

export interface ContextMeterData {
  providerLabel: string
  modelLabel: string
  modelID: string | null
  limit: number | null
  compactionThreshold: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  /** Percentage of the context window used, or null when the limit is unknown. */
  usagePercent: number | null
  cacheRead: number
  cacheWrite: number
  /** Percentage of the total that was served from cache, or null with no total. */
  cacheSavedPercent: number | null
  memory: { used: number; budget: number | null; percent: number | null }
  compaction: { threshold: number; triggered: boolean }
  sources: ContextSource[]
  cost: number
}

export interface BuildContextMeterInput {
  messages: ContextMeterMessage[]
  providers: ContextMeterProvider[]
  sources?: ContextSource[]
  compactionThreshold?: number
}

export function buildContextMeter(input: BuildContextMeterInput): ContextMeterData {
  const message = lastAssistantWithTokens(input.messages)
  const provider = message ? input.providers.find((p) => p.id === message.providerID) : undefined
  const model = message && provider ? provider.models[message.modelID] : undefined
  const limit = model?.limit.context ?? null
  const total = message ? tokenTotal(message) : 0
  const usagePercent = limit ? Math.round((total / limit) * 100) : null
  const cacheRead = message?.tokens.cache.read ?? 0
  const cacheWrite = message?.tokens.cache.write ?? 0
  const cached = cacheRead + cacheWrite
  const cacheSavedPercent = total > 0 ? Math.round((cached / total) * 100) : null
  const compactionThreshold = input.compactionThreshold ?? model?.compaction ?? COMPACTION_DEFAULT_THRESHOLD
  const memoryBudget = model?.memory ?? null
  const memoryPercent = memoryBudget ? Math.round((total / memoryBudget) * 100) : null
  const sources = input.sources ?? (message ? buildDefaultSources(message) : [])

  return {
    providerLabel: provider?.name ?? message?.providerID ?? "",
    modelLabel: model?.name ?? message?.modelID ?? "",
    modelID: message?.modelID ?? null,
    limit,
    compactionThreshold,
    tokens: {
      input: message?.tokens.input ?? 0,
      output: message?.tokens.output ?? 0,
      reasoning: message?.tokens.reasoning ?? 0,
      cacheRead,
      cacheWrite,
      total,
    },
    usagePercent,
    cacheRead,
    cacheWrite,
    cacheSavedPercent,
    memory: { used: total, budget: memoryBudget, percent: memoryPercent },
    compaction: {
      threshold: compactionThreshold,
      triggered: usagePercent != null && usagePercent >= compactionThreshold,
    },
    sources,
    cost: message?.cost ?? 0,
  }
}

// --- segment projection -----------------------------------------------------

export type ContextMeterSegmentKind = "usage" | "cache" | "memory" | "compaction" | "sources"

export interface ContextSegment {
  readonly kind: ContextMeterSegmentKind
  readonly label: string
  readonly detail: string
  readonly focusable: boolean
  readonly wideOnly: boolean
}

function buildSegments(data: ContextMeterData, narrow: boolean, expanded: boolean): ContextSegment[] {
  const segments: ContextSegment[] = []

  segments.push({
    kind: "usage",
    label: "usage",
    detail:
      data.usagePercent != null
        ? `${formatTokens(data.tokens.total)} tokens · ${data.usagePercent}% of ${formatTokens(data.limit!)}`
        : `${formatTokens(data.tokens.total)} tokens · limit unknown`,
    focusable: true,
    wideOnly: false,
  })

  segments.push({
    kind: "cache",
    label: "cache",
    detail: `read ${formatTokens(data.cacheRead)} · write ${formatTokens(data.cacheWrite)}${
      data.cacheSavedPercent != null ? ` · ${data.cacheSavedPercent}% saved` : ""
    }`,
    focusable: true,
    wideOnly: false,
  })

  if (expanded) {
    segments.push({
      kind: "memory",
      label: "memory",
      detail:
        data.memory.budget != null
          ? `${formatTokens(data.memory.used)}/${formatTokens(data.memory.budget)} (${data.memory.percent}%)`
          : "budget unknown",
      focusable: true,
      wideOnly: true,
    })
    segments.push({
      kind: "compaction",
      label: "compaction",
      detail: `${data.compaction.threshold}% · ${data.compaction.triggered ? "triggered" : "ok"}`,
      focusable: true,
      wideOnly: true,
    })
  }

  segments.push({
    kind: "sources",
    label: "sources",
    detail: capSources(data.sources)
      .map((s) => `${s.label} ${s.percent}%`)
      .join(" · "),
    focusable: true,
    wideOnly: false,
  })

  return segments
}

// --- state construction -----------------------------------------------------

export interface ContextMeterOverrides {
  readonly focusIndex?: number
  readonly focusKind?: ContextMeterSegmentKind | null
  /** Actual terminal width. Wide-only segments are dropped below `narrowWidth`. */
  readonly width?: number
  readonly narrowWidth?: number
  /** Whether the detail rows (memory/compaction) are expanded. */
  readonly expanded?: boolean
  readonly compactionThreshold?: number
}

export interface ContextMeterState {
  readonly status: ContextMeterStatus
  readonly data: ContextMeterData | null
  readonly segments: ReadonlyArray<ContextSegment>
  readonly focusIndex: number
  readonly focusedKind: ContextMeterSegmentKind | null
  readonly narrow: boolean
  readonly expanded: boolean
  readonly stale: boolean
  readonly summaryText: string
  readonly meterText: string
  /** Full, screen-reader oriented description of the current state. */
  readonly accessibleSummary: string
}

export function isNarrowTerminal(width: number, narrowWidth: number = NARROW_WIDTH_DEFAULT): boolean {
  return width < narrowWidth
}

function summarize(status: ContextMeterStatus, ctx: ContextMeterContext, data: ContextMeterData | null): string {
  switch (status) {
    case "loading":
      return "Loading context usage…"
    case "empty":
      return "No context usage yet"
    case "failure":
      return `Context usage unavailable — ${parseContextError(ctx.error) ?? "unknown error"}`
    case "denied":
      return "Context usage — access denied"
    case "offline":
      return "Context usage — offline"
    case "degraded":
      return data
        ? `Context usage — ${data.modelLabel || data.modelID || "model"} · ${formatTokens(data.tokens.total)} tokens · limit unknown`
        : "Context usage — limit unknown"
    case "long-content":
    case "populated":
      return data ? meterLine(data, status) : "Context usage"
    default:
      return "Context usage"
  }
}

function meterLine(data: ContextMeterData, status: ContextMeterStatus): string {
  const model = data.modelLabel || data.modelID || "model"
  const usage = data.usagePercent != null ? `${data.usagePercent}% used` : "limit unknown"
  return `Context — ${model} · ${formatTokens(data.tokens.total)} tokens · ${usage}`
}

function accessibleSummary(status: ContextMeterStatus, ctx: ContextMeterContext, data: ContextMeterData | null): string {
  const base = summarize(status, ctx, data)
  if ((status === "populated" || status === "long-content" || status === "degraded") && data) {
    const parts = [
      `${formatTokens(data.tokens.total)} tokens`,
      data.usagePercent != null ? `${data.usagePercent} percent of context used` : "context limit unknown",
      data.cacheSavedPercent != null ? `${data.cacheSavedPercent} percent served from cache` : undefined,
      `cost ${data.cost.toFixed(4)} dollars`,
    ].filter(Boolean)
    return `${base}. ${parts.join(". ")}.`
  }
  return base
}

export function contextMeterState(
  messages: ContextMeterMessage[],
  providers: ContextMeterProvider[],
  ctx: ContextMeterContext,
  overrides: ContextMeterOverrides = {},
): ContextMeterState {
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const width = overrides.width ?? narrowWidth
  const narrow = isNarrowTerminal(width, narrowWidth)
  const expanded = overrides.expanded ?? true
  const data = buildContextMeter({
    messages,
    providers,
    compactionThreshold: overrides.compactionThreshold,
  })

  let status: ContextMeterStatus
  if (ctx.offline) status = "offline"
  else if (ctx.denied) status = "denied"
  else if (ctx.error) status = "failure"
  else if (ctx.loading && !ctx.isReady) status = "loading"
  else if (!ctx.isReady) status = "empty"
  else if (!lastAssistantWithTokens(messages)) status = "empty"
  else if (isLongContent(data)) status = "long-content"
  else if (data.limit == null) status = "degraded"
  else status = "populated"

  // Offline still carries the last-known metrics so the meter never blanks; the
  // other terminal states (failure/denied/empty) have no safe data to show.
  if (status === "offline") {
    return {
      status,
      data,
      segments: [],
      focusIndex: -1,
      focusedKind: null,
      narrow,
      expanded,
      stale: false,
      summaryText: summarize(status, ctx, data),
      meterText: summarize(status, ctx, data),
      accessibleSummary: accessibleSummary(status, ctx, data),
    }
  }

  if (status === "failure" || status === "denied" || status === "empty") {
    return {
      status,
      data: status === "empty" ? data : null,
      segments: [],
      focusIndex: -1,
      focusedKind: null,
      narrow,
      expanded,
      stale: false,
      summaryText: summarize(status, ctx, data),
      meterText: summarize(status, ctx, data),
      accessibleSummary: accessibleSummary(status, ctx, data),
    }
  }

  const segments = buildSegments(data, narrow, expanded).filter((s) => !s.wideOnly || !narrow)
  const focusable = segments.filter((s) => s.focusable)

  let focusIndex: number
  if (overrides.focusKind != null) {
    const idx = segments.findIndex((s) => s.kind === overrides.focusKind)
    focusIndex = idx >= 0 ? idx : 0
  } else if (overrides.focusIndex != null) {
    focusIndex = Math.min(Math.max(0, overrides.focusIndex), Math.max(0, segments.length - 1))
  } else {
    focusIndex = focusable.length > 0 ? 0 : -1
  }

  const focusedKind = focusIndex >= 0 && focusIndex < segments.length ? segments[focusIndex].kind : null
  const stale = !!ctx.loading && (status === "populated" || status === "degraded" || status === "long-content")

  return {
    status,
    data,
    segments,
    focusIndex,
    focusedKind,
    narrow,
    expanded,
    stale,
    summaryText: summarize(status, ctx, data),
    meterText: meterLine(data, status),
    accessibleSummary: accessibleSummary(status, ctx, data),
  }
}

// --- keyboard navigation & focus -------------------------------------------

/** Move the focus between segments. Clamps at the ends (no wrap). */
export function moveFocus(state: ContextMeterState, direction: 1 | -1): number {
  const count = state.segments.filter((s) => s.focusable).length
  if (count === 0) return -1
  if (state.focusIndex < 0) return direction === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, state.focusIndex + direction))
}

/** Index of a segment kind, or -1 when not present/focusable. */
export function focusIndexForKind(state: ContextMeterState, kind: ContextMeterSegmentKind): number {
  return state.segments.filter((s) => s.focusable).findIndex((s) => s.kind === kind)
}

/** Action emitted when the focused segment is activated (enter). */
export type ContextMeterAction =
  | { type: "usage" }
  | { type: "cache" }
  | { type: "memory" }
  | { type: "compaction" }
  | { type: "sources" }
  | { type: "toggle" }

export function actionFor(kind: ContextMeterSegmentKind | null): ContextMeterAction | null {
  switch (kind) {
    case "usage":
      return { type: "usage" }
    case "cache":
      return { type: "cache" }
    case "memory":
      return { type: "memory" }
    case "compaction":
      return { type: "compaction" }
    case "sources":
      return { type: "sources" }
    default:
      return null
  }
}

// --- performance + terminal hardening --------------------------------------

/**
 * Maximum number of context-source rows rendered before they are collapsed into
 * a single "other" segment. Cap avoids layout thrash when a response streams
 * many source fragments at once.
 */
export const CONTEXT_METER_MAX_SOURCES = 12

/** Minimum time between two meter rebuilds driven by a rapid update stream. */
export const CONTEXT_METER_RENDER_BUDGET_MS = 250

/** Block-meter glyphs used when the terminal advertises color support. */
export const BLOCK_FULL = "█"
export const BLOCK_EMPTY = "░"

/**
 * Render a single-line usage bar. When `noColor` is set (no-color / limited
 * palette terminals) it falls back to ASCII `#`/`_` so the meter stays legible
 * without any color or Unicode block glyphs. An unknown limit renders a neutral
 * placeholder that still carries "no data" meaning without color.
 */
export function renderUsageBar(
  percent: number | null,
  opts: { width?: number; narrow?: boolean; noColor?: boolean } = {},
): string {
  const width = opts.width ?? (opts.narrow ? 6 : 12)
  if (percent == null) return opts.noColor ? "[?]" : `${BLOCK_EMPTY.repeat(width)}`
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  const empty = Math.max(0, width - filled)
  if (opts.noColor) return "#".repeat(filled) + "_".repeat(empty)
  return BLOCK_FULL.repeat(filled) + BLOCK_EMPTY.repeat(empty)
}

/**
 * Collapse an oversized source list so the meter stays within its render budget
 * during large/rapid streams. The tail is merged into a single "other" segment
 * whose tokens/percent reflect the remainder, preserving the total.
 */
export function capSources(sources: ContextSource[], max: number = CONTEXT_METER_MAX_SOURCES): ContextSource[] {
  if (sources.length <= max) return sources
  const head = sources.slice(0, max)
  const rest = sources.slice(max)
  const total = sources.reduce((sum, s) => sum + s.tokens, 0)
  const otherTokens = rest.reduce((sum, s) => sum + s.tokens, 0)
  return [
    ...head,
    {
      key: "other",
      label: `+${rest.length} more`,
      glyph: "…",
      tokens: otherTokens,
      percent: total > 0 ? Math.round((otherTokens / total) * 100) : 0,
      focusable: true,
      wideOnly: false,
    },
  ]
}

/**
 * Detect a no-color / limited-palette terminal so the meter can swap block
 * glyphs for ASCII. Honors `NO_COLOR` (https://no-color.org) and the common
 * `TERM` fallbacks; defaults to color when the environment is undefined.
 */
export function detectNoColor(): boolean {
  if (typeof process === "undefined" || !process.env) return false
  if (process.env.NO_COLOR) return true
  const term = process.env.TERM ?? ""
  if (/^(dumb|unknown)$/i.test(term)) return true
  return false
}

/** Compact token counts for narrow terminals (e.g. 1234 -> 1.2k). */
export function compactTokens(value: number): string {
  if (!Number.isFinite(value)) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${value}`
}
