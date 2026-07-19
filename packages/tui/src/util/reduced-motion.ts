// Reduced-motion detection for the Ottili Coder TUI (T-CLI-0225).
//
// Cross-platform hook that detects user preference for reduced motion.
// In the TUI environment this is derived from terminal capabilities and an
// explicit config flag; on DOM-backed targets the CSS `prefers-reduced-motion`
// media query is used as the primary signal. Kept framework-agnostic so it
// can be imported by both the TUI and the web/desktop renderer.
//
// All animations, spinner frames, streaming indicators and transition effects
// in the component tree should short-circuit to static fallback when
// `reducedMotion()` is true — the label/message/state must never depend on
// motion alone for meaning (WCAG 2.2 Success Criterion 2.3.3).

const CSS_QUERY = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : undefined

/** Subscribe to changes in the user's motion preference (DOM only). */
export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  if (!CSS_QUERY) return () => {}
  const handler = () => fn(CSS_QUERY.matches)
  CSS_QUERY.addEventListener("change", handler)
  return () => CSS_QUERY.removeEventListener("change", handler)
}

/** Static snapshot of the reduced-motion preference. */
export function isReducedMotion(): boolean {
  if (CSS_QUERY?.matches) return true
  // TUI / server environments: respect the env var and the TUI config meant for
  // terminals that cannot render animated content.
  if (typeof process !== "undefined" && process.env.NO_COLOR) return true
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return true
  // Honor the explicit OTTILI_REDUCED_MOTION flag for power users and
  // accessibility testing.
  if (typeof process !== "undefined" && process.env.OTTILI_REDUCED_MOTION) return true
  return false
}

/** Solid.js reactive version: returns a signal that updates on media-query changes. */
import { createSignal, onCleanup } from "solid-js"

export function createReducedMotionSignal(): () => boolean {
  const [reduced, setReduced] = createSignal(isReducedMotion())
  const unsub = onReducedMotionChange(setReduced)
  onCleanup(unsub)
  return reduced
}