import stripAnsi from "strip-ansi"

/**
 * Shared secret redaction + diagnostics truncation for the Ottili Coder TUI.
 *
 * Centralized so every visual surface (session transcript, compact mode, build
 * validation, file tree, context meter) redacts credentials through one
 * conservative matcher instead of re-implementing it per component. Detection
 * targets token-shaped runs and `key = value` assignments with a secret-looking
 * key; it never throws and never leaks the original when a secret is present.
 */

/** Marker substituted for redacted secrets in visual output and diagnostics. */
export const REDACTION_MARKER = "••••"

/** Maximum length of a diagnostic string before it is truncated for display. */
export const DIAGNOSTIC_MAX = 240

// `key = value` / `key: value` assignments whose key signals a secret.
const ASSIGNMENT_RE =
  /\b(api[_-]?key|apikey|token|secret|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth)\b(\s*[:=]\s*["']?)[^\s"',}{]+/gi

/** Redact secret-shaped runs from a single string. Total and side-effect free. */
export function redactSecrets(input: string): string {
  if (!input) return input
  let text = input
  // Long token-shaped runs (base64/hex, ≥ 32 chars). Normal words stay intact.
  text = text.replace(/[A-Za-z0-9+/_=-]{32,}/g, () => REDACTION_MARKER)
  // OpenAI-style secret keys.
  text = text.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, () => REDACTION_MARKER)
  // Bearer tokens: keep the scheme, redact the credential.
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, (match) => {
    return `${match.split(/\s+/)[0]} ${REDACTION_MARKER}`
  })
  // JWT-style tokens (header.payload.signature — any base64url-encoded segment ≥ 20 chars).
  text = text.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, () => REDACTION_MARKER)
  // OAuth session / refresh tokens that start with a known prefix.
  text = text.replace(/\b(gh[osu]_|ghp_|ghr_|github_pat_|ya29\.|eyJ|tok_|f04_|sess_)[A-Za-z0-9_-]{8,}/g, (_match, prefix: string) => `${prefix}${REDACTION_MARKER}`)
  // session_id / sid = value assignments (common in diagnostics).
  text = text.replace(/\b(session[_-]?id|sid|jti)\b(\s*[:=]\s*["']?)[A-Za-z0-9_-]{8,}/gi, (_match, key: string, sep: string) => `${key}${sep}${REDACTION_MARKER}`)
  // key = value assignments with a secret-looking key.
  text = text.replace(ASSIGNMENT_RE, (_match, key: string, sep: string) => `${key}${sep}${REDACTION_MARKER}`)
  return text
}

/** Strip ANSI + tabs and bound a diagnostic string for safe on-screen display. */
export function truncateForDiagnostics(text: string, max = DIAGNOSTIC_MAX): string {
  const cleaned = stripAnsi(text ?? "").replace(/\t/g, "  ").trim()
  if (cleaned.length <= max) return cleaned
  return cleaned.slice(0, max - 1) + "…"
}

/** Redact secrets and bound length for visual output and diagnostics. */
export function redactText(text: string, max = DIAGNOSTIC_MAX): string {
  return redactSecrets(truncateForDiagnostics(text, max))
}

/** True when the environment cannot render color (NO_COLOR or a dumb terminal). */
export function detectNoColor(): boolean {
  if (typeof process !== "undefined" && process.env.NO_COLOR) return true
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return true
  return false
}
