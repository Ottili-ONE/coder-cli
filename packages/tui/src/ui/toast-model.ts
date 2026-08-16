export type ToastVariant = "info" | "success" | "warning" | "error"

export type ToastAction = {
  label: string
  // Wire-safe (core→TUI event / HTTP): a keymap command or route the TUI executes.
  command?: string
  // In-process only (plugin/runtime): a direct callback. NEVER serialized.
  onClick?: () => void
}

export type ToastOptions = {
  // Dedupe key; defaults to a stable hash of (variant|title|message).
  id?: string
  variant: ToastVariant
  title?: string
  message: string
  // Duration in ms. Defaults per variant via defaultDuration().
  duration?: number
  // If true, ignore the timer until dismissed or acted upon. Recommended when
  // `action` is present.
  sticky?: boolean
  action?: ToastAction
}

export type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

export const DEFAULT_TOAST_DURATION = 5000
export const ERROR_TOAST_DURATION = 8000
export const MAX_VISIBLE_TOASTS = 3
export const MAX_TOASTS = 10

export function defaultDuration(variant: ToastVariant): number {
  return variant === "warning" || variant === "error" ? ERROR_TOAST_DURATION : DEFAULT_TOAST_DURATION
}

export function toastID(options: ToastOptions): string {
  return options.id ?? `${options.variant}:${options.title ?? ""}:${options.message}`
}

// Keep at most MAX_TOASTS toasts; newest last; dedupe by id (collapse repeats).
// A repeated toast (same id) replaces the earlier copy instead of stacking a
// duplicate. Storage is capped at MAX_TOASTS so a runaway producer cannot grow
// the list without bound; rendering shows the most recent MAX_VISIBLE_TOASTS.
export function enqueue(list: ToastOptions[], next: ToastOptions): ToastOptions[] {
  const id = toastID(next)
  const without = list.filter((toast) => toastID(toast) !== id)
  return [...without, next].slice(-MAX_TOASTS)
}

// The render window: the most recent MAX_VISIBLE_TOASTS toasts plus a count of
// how many older toasts remain hidden (the "+N" badge).
export function visibleToasts(list: ToastOptions[]): { visible: ToastOptions[]; hidden: number } {
  const hidden = Math.max(0, list.length - MAX_VISIBLE_TOASTS)
  return { visible: list.slice(hidden), hidden }
}
