/**
 * Canonical OpenRouter application attribution for Ottili Coder.
 *
 * Every request sent to OpenRouter — chat completions, streaming, retries,
 * fallbacks, agent/executor turns, and MCP model calls — must carry these
 * headers so token usage, request history, and provider ranking stay assigned
 * to the Ottili Coder application.
 *
 * The HTTP-Referer must stay exactly `https://ottili.one/coder` (no trailing
 * slash, no migration to `coder.ottili.one`) so the existing OpenRouter App
 * ID continues to collect usage under this application.
 */

export const OPENROUTER_APP_URL = "https://ottili.one/coder"
export const OPENROUTER_APP_TITLE = "Ottili Coder"
export const OPENROUTER_APP_CATEGORIES = "cli-agent,cloud-agent,programming-app"

const envValue = (name: string, fallback: string): string => {
  const value = process.env[name]
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export interface OpenRouterAttributionOptions {
  /** Override the HTTP-Referer. Defaults to the canonical Ottili Coder URL. */
  readonly referer?: string
  /** Override the application title. Defaults to "Ottili Coder". */
  readonly title?: string
  /** Override the category list. Defaults to cli-agent,cloud-agent,programming-app. */
  readonly categories?: string
}

/**
 * Build the OpenRouter attribution headers for an outgoing request.
 *
 * Returns the canonical OpenRouter headers plus `X-Title` so the AI-SDK
 * provider (which reads `X-Title`) and OpenRouter's `X-OpenRouter-*` aliases
 * both attribute the request to Ottili Coder. Authentication, content type,
 * tracing, and request-specific headers are applied by the transport and are
 * never overwritten here.
 */
export const openRouterAttributionHeaders = (
  options: OpenRouterAttributionOptions = {},
): Record<string, string> => {
  const referer = options.referer ?? envValue("OPENROUTER_APP_URL", OPENROUTER_APP_URL)
  const title = options.title ?? envValue("OPENROUTER_APP_TITLE", OPENROUTER_APP_TITLE)
  const categories =
    options.categories ?? envValue("OPENROUTER_APP_CATEGORIES", OPENROUTER_APP_CATEGORIES)
  return {
    "HTTP-Referer": referer,
    "X-Title": title,
    "X-OpenRouter-Title": title,
    "X-OpenRouter-Categories": categories,
  }
}
