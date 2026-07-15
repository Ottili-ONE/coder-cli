import { Effect, Redacted } from "effect"

const SENSITIVE_KEY = /(secret|token|api[_-]?key|password|passwd|pwd|credential|private[_-]?key|auth|authorization|bearer|session[_-]?id|cookie|otp|salt|signing)/i
const SENSITIVE_VALUE = /(Bearer\s+\S+|sk-[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+)/

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

export function isSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE.test(value)
}

export function redactValue(value: string): string {
  if (!value) return value
  if (isSensitiveValue(value)) return "[redacted]"
  return value
}

export function redactKey(key: string): string {
  return isSensitiveKey(key) ? "[redacted]" : key
}

export function redactRecord<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]"
      continue
    }
    if (typeof value === "string") {
      out[key] = redactValue(value)
      continue
    }
    if (value && typeof value === "object") {
      out[key] = redactRecord(value as Record<string, unknown>)
      continue
    }
    out[key] = value
  }
  return out
}

export function redactRedacted<A>(value: Redacted.Redacted<A>): string {
  return "[redacted]"
}

export function redactUnknown(input: unknown): unknown {
  if (input == null) return input
  if (typeof input === "string") return redactValue(input)
  if (Array.isArray(input)) return input.map(redactUnknown)
  if (typeof input === "object") return redactRecord(input as Record<string, unknown>)
  return input
}

export const redactEffect = <A>(value: A): Effect.Effect<A> => Effect.succeed(value)
