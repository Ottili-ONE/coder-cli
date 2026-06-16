import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

export const OTTILI_AUTO_PROVIDER_ID = ProviderV2.ID.make("ottili-auto")
export const OTTILI_AUTO_MODEL_ID = ModelV2.ID.make("auto")

export const OTTILI_AUTO_ROUTER_MODEL = "meta-llama/llama-3.1-8b-instruct"
export const OTTILI_AUTO_ROUTER_BASE_URL = "https://openrouter.ai/api/v1"
export const OTTILI_AUTO_ROUTER_TIMEOUT_MS = 4_000

export type OttiliAutoTarget = {
  key: string
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
  label: string
  summary: string
}

export const OTTILI_AUTO_TARGETS: Record<string, OttiliAutoTarget> = {
  "gpt-5.5": {
    key: "gpt-5.5",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("gpt-5.5"),
    label: "GPT 5.5",
    summary: "Backend, long-running work, large refactors — not for frontend/UI",
  },
  "gpt-5.4-mini": {
    key: "gpt-5.4-mini",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("gpt-5.4-mini"),
    label: "GPT 5.4 Mini",
    summary: "Default for general coding, small/medium tasks, quick fixes",
  },
  "claude-sonnet-4-6": {
    key: "claude-sonnet-4-6",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("claude-sonnet-4-6"),
    label: "Claude Sonnet 4.6",
    summary: "Frontend, UI, React, CSS, design systems",
  },
  "claude-opus-4-8": {
    key: "claude-opus-4-8",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("claude-opus-4-8"),
    label: "Claude Opus 4.8",
    summary: "Backend, architecture, general complex coding",
  },
  "kimi-k2.6": {
    key: "kimi-k2.6",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("kimi-k2.6"),
    label: "Kimi K2.6",
    summary: "Small coding tasks and scripts",
  },
  "deepseek-v4-pro": {
    key: "deepseek-v4-pro",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("deepseek-v4-pro"),
    label: "DeepSeek V4 Pro",
    summary: "Small tasks, utilities, compact changes",
  },
  "gemini-3.1-pro": {
    key: "gemini-3.1-pro",
    providerID: ProviderV2.ID.make("ottili-coder"),
    modelID: ModelV2.ID.make("gemini-3.1-pro"),
    label: "Gemini 3.1 Pro",
    summary: "Ask/explore mode, large context questions and codebase exploration",
  },
}

export const OTTILI_AUTO_MODEL_ALIASES: Record<string, keyof typeof OTTILI_AUTO_TARGETS> = {
  "kimi-k2.7": "kimi-k2.6",
  "kimi-k2.7-code": "kimi-k2.6",
  "kimi-k2.5": "kimi-k2.6",
  "gemini-3.5-high": "gemini-3.1-pro",
  "gemini-3.5-flash": "gemini-3.1-pro",
  "gpt-5.4mini": "gpt-5.4-mini",
  "claude-4.6-sonnet": "claude-sonnet-4-6",
  "claude-4.8-opus": "claude-opus-4-8",
  "claude-opus-4.6": "claude-opus-4-8",
  "claude-opus-4-7": "claude-opus-4-8",
  "deepseek-v4": "deepseek-v4-pro",
}

export const OTTILI_AUTO_DEFAULT_TARGET = OTTILI_AUTO_TARGETS["gpt-5.4-mini"]
