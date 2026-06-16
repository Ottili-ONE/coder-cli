import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import {
  OTTILI_AUTO_DEFAULT_TARGET,
  OTTILI_AUTO_MODEL_ALIASES,
  OTTILI_AUTO_ROUTER_BASE_URL,
  OTTILI_AUTO_ROUTER_MODEL,
  OTTILI_AUTO_ROUTER_TIMEOUT_MS,
  OTTILI_AUTO_TARGETS,
  type OttiliAutoTarget,
} from "./constants"
import { bootstrapEnvFiles, defaultEnvFileCandidates, resolveOpenRouterApiKey } from "./env"

export type OttiliAutoRouteInput = {
  userText: string
  assistantText: string
  agent: string
}

export type OttiliAutoRouteOptions = {
  apiKey?: string
  timeoutMs?: number
}

export type OttiliAutoRouteDecision = {
  model: string
  reason: string
  confidence: number
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
  target: OttiliAutoTarget
  routerCost?: number
  routerUsage?: {
    input: number
    output: number
  }
  routerSource?: "openrouter" | "rules"
}

export const OTTILI_AUTO_ROUTER_INPUT_COST_PER_M = 0.02
export const OTTILI_AUTO_ROUTER_OUTPUT_COST_PER_M = 0.03

const FRONTEND_PATTERN =
  /\b(frontend|front-end|ui|ux|react|vue|svelte|css|tailwind|component|layout|design|figma|html|jsx|tsx|widget|dashboard ui|scss|styled|next\.js|vite)\b/i
const BACKEND_PATTERN =
  /\b(backend|back-end|api|server|database|migration|refactor|architecture|microservice|postgres|redis|queue|worker|infra|fastapi|django|express|graphql|sql|prisma|drizzle)\b/i
const SMALL_TASK_PATTERN =
  /\b(fix typo|rename|small|quick|tiny|one line|single file|minor|trivial|short|simple|typo|formatting|lint|prettier|eslint)\b/i
const TEST_PATTERN = /\b(test|tests|spec|unit test|integration test|pytest|jest|vitest|playwright|cypress)\b/i
const DEBUG_PATTERN = /\b(bug|debug|error|crash|exception|stack trace|fix|broken|fails|regression|500|404)\b/i
const DOCS_PATTERN = /\b(explain|document|docs|readme|comment|why|what is|how does|overview|summary)\b/i
const LARGE_TASK_PATTERN =
  /\b(large|big|major|rewrite|rebuild|multi-file|many files|whole module|entire service|full refactor|architecture)\b/i

export function isOttiliAutoModel(providerID: string, modelID: string) {
  return providerID === "ottili-auto" && modelID === "auto"
}

export function normalizeRouterModelKey(raw: string) {
  const cleaned = raw.trim().toLowerCase().replace(/^ottili-coder\//, "")
  const aliased = OTTILI_AUTO_MODEL_ALIASES[cleaned] ?? cleaned
  if (OTTILI_AUTO_TARGETS[aliased]) return aliased

  for (const key of Object.keys(OTTILI_AUTO_TARGETS)) {
    if (cleaned.includes(key)) return key
  }

  return undefined
}

export function targetToDecision(
  target: OttiliAutoTarget,
  reason: string,
  confidence: number,
  router?: Pick<OttiliAutoRouteDecision, "routerCost" | "routerUsage" | "routerSource">,
): OttiliAutoRouteDecision {
  return {
    model: target.key,
    reason,
    confidence,
    providerID: target.providerID,
    modelID: target.modelID,
    target,
    ...router,
  }
}

export function estimateRouterCost(inputTokens: number, outputTokens: number) {
  return (
    (inputTokens / 1_000_000) * OTTILI_AUTO_ROUTER_INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * OTTILI_AUTO_ROUTER_OUTPUT_COST_PER_M
  )
}

export function formatRouteAnnouncement(decision: OttiliAutoRouteDecision) {
  const pct = Math.round(decision.confidence * 100)
  const cost =
    decision.routerCost && decision.routerCost > 0
      ? ` · router ~$${decision.routerCost.toFixed(4)}`
      : ""
  const source = decision.routerSource === "rules" ? " · rules" : ""
  return `Ottili Auto → ${decision.target.label} (${pct}%) — ${decision.reason}${cost}${source}`
}

export function parseRouterJson(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed
  const start = fenced.indexOf("{")
  const end = fenced.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return undefined

  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as {
      model?: unknown
      reason?: unknown
      confidence?: unknown
    }
    const model = typeof parsed.model === "string" ? normalizeRouterModelKey(parsed.model) : undefined
    if (!model) return undefined
    const target = OTTILI_AUTO_TARGETS[model]
    if (!target) return undefined
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "Router selection"
    const confidenceRaw = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence)
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0.5
    return targetToDecision(target, reason, confidence, { routerSource: "openrouter" })
  } catch {
    return undefined
  }
}

export function buildRouterPrompt(input: OttiliAutoRouteInput) {
  const catalog = Object.values(OTTILI_AUTO_TARGETS)
    .map((item) => `- ${item.key}: ${item.summary}`)
    .join("\n")

  return [
    "You are Ottili Auto, a model router for Ottili Coder.",
    "Pick exactly one model key for the next coding turn.",
    "",
    "Available models:",
    catalog,
    "",
    "Routing rules:",
    "- ask agent or exploration/questions -> gemini-3.1-pro",
    "- frontend/UI/React/CSS -> claude-sonnet-4-6",
    "- backend/long refactors/large tasks (not frontend) -> gpt-5.5",
    "- small quick tasks -> gpt-5.4-mini, kimi-k2.6, or deepseek-v4-pro",
    "- general complex coding -> claude-opus-4-8",
    "- default when unsure -> gpt-5.4-mini",
    "",
    `Current agent: ${input.agent || "build"}`,
    "",
    "Respond ONLY with JSON:",
    '{"model":"<key>","reason":"...","confidence":0.0}',
    "",
    "Last assistant message:",
    input.assistantText || "(none)",
    "",
    "Latest user message:",
    input.userText || "(empty)",
  ].join("\n")
}

export function ruleBasedRoute(input: OttiliAutoRouteInput): OttiliAutoRouteDecision {
  const agent = input.agent.toLowerCase()
  const text = `${input.userText}\n${input.assistantText}`.toLowerCase()
  const userLen = input.userText.trim().length

  if (agent === "ask" || (DOCS_PATTERN.test(text) && !BACKEND_PATTERN.test(text) && !FRONTEND_PATTERN.test(text))) {
    return targetToDecision(
      OTTILI_AUTO_TARGETS["gemini-3.1-pro"],
      "Ask/exploration or documentation-style request",
      0.95,
      { routerSource: "rules" },
    )
  }

  if (FRONTEND_PATTERN.test(text) && !BACKEND_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["claude-sonnet-4-6"], "Frontend/UI task detected", 0.88, {
      routerSource: "rules",
    })
  }

  if (TEST_PATTERN.test(text) && !LARGE_TASK_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["kimi-k2.6"], "Test-focused task detected", 0.84, {
      routerSource: "rules",
    })
  }

  if (DEBUG_PATTERN.test(text) && SMALL_TASK_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["deepseek-v4-pro"], "Small bugfix/debug task detected", 0.83, {
      routerSource: "rules",
    })
  }

  if (SMALL_TASK_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["gpt-5.4-mini"], "Small task detected", 0.82, {
      routerSource: "rules",
    })
  }

  if (agent === "plan" || LARGE_TASK_PATTERN.test(text) || (BACKEND_PATTERN.test(text) && userLen > 280)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["gpt-5.5"], "Backend, planning, or large workload detected", 0.8, {
      routerSource: "rules",
    })
  }

  if (BACKEND_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["claude-opus-4-8"], "Backend/complex coding workload detected", 0.78, {
      routerSource: "rules",
    })
  }

  if (DEBUG_PATTERN.test(text)) {
    return targetToDecision(OTTILI_AUTO_TARGETS["deepseek-v4-pro"], "Debug/fix workload detected", 0.76, {
      routerSource: "rules",
    })
  }

  return targetToDecision(OTTILI_AUTO_DEFAULT_TARGET, "Default general coding route", 0.65, {
    routerSource: "rules",
  })
}

export async function routeWithLlama(
  input: OttiliAutoRouteInput,
  apiKey: string,
  timeoutMs = OTTILI_AUTO_ROUTER_TIMEOUT_MS,
) {
  const response = await fetch(`${OTTILI_AUTO_ROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ottili.one/coder/",
      "X-Title": "ottili-coder-auto-router",
    },
    body: JSON.stringify({
      model: OTTILI_AUTO_ROUTER_MODEL,
      temperature: 0,
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: buildRouterPrompt(input),
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter router failed: HTTP ${response.status}`)
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const content = body.choices?.[0]?.message?.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => (part?.type === "text" ? part.text ?? "" : ""))
            .join("\n")
            .trim()
        : ""

  const parsed = parseRouterJson(text)
  if (!parsed) throw new Error("Router returned invalid JSON")

  const inputTokens = Number(body.usage?.prompt_tokens ?? 0)
  const outputTokens = Number(body.usage?.completion_tokens ?? 0)
  if (inputTokens > 0 || outputTokens > 0) {
    return {
      ...parsed,
      routerUsage: { input: inputTokens, output: outputTokens },
      routerCost: estimateRouterCost(inputTokens, outputTokens),
      routerSource: "openrouter" as const,
    }
  }

  return parsed
}

export async function route(input: OttiliAutoRouteInput, options?: OttiliAutoRouteOptions) {
  bootstrapEnvFiles({
    directory: process.cwd(),
    worktree: process.cwd(),
  })

  if (process.env.OTTILI_AUTO_DISABLE_ROUTER === "1") return ruleBasedRoute(input)

  const apiKey = resolveOpenRouterApiKey(options?.apiKey)
  if (!apiKey) return ruleBasedRoute(input)

  try {
    return await routeWithLlama(input, apiKey, options?.timeoutMs)
  } catch {
    return ruleBasedRoute(input)
  }
}

export function extractLatestUserText(messages: SessionV1.WithParts[]) {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user) return ""
  return user.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function extractLatestAssistantText(messages: SessionV1.WithParts[]) {
  const assistant = messages.findLast((message) => message.info.role === "assistant")
  if (!assistant) return ""
  return assistant.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}
