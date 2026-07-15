import { createSignal } from "solid-js"

// Global, reactive state for the redesigned tool-call cards.
// Expansion and error-expansion are keyed by tool part id so mouse and
// keyboard interactions can drive the same card without threading signals
// through the session context.

const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
const [errorExpanded, setErrorExpanded] = createSignal<Record<string, boolean>>({})
const [activeCard, setActiveCard] = createSignal<string | null>(null)

// Ordered registry of mounted card ids (insertion order). Used as a fallback
// target when no card is actively focused via the mouse.
const registry: string[] = []

export function registerToolCard(id: string) {
  if (!registry.includes(id)) registry.push(id)
}

export function lastToolCard() {
  return registry[registry.length - 1] ?? null
}

export function getExpanded(id: string): boolean | undefined {
  return expanded()[id]
}

export function setExpanded(id: string, value: boolean) {
  setExpanded((prev) => ({ ...prev, [id]: value }))
}

export function toggleExpanded(id: string) {
  setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
}

export function getErrorExpanded(id: string): boolean {
  return errorExpanded()[id] ?? false
}

export function toggleErrorExpanded(id: string) {
  setErrorExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
}

export function activeToolCard(): string | null {
  return activeCard()
}

export function setActiveToolCard(id: string | null) {
  setActiveCard(id)
}

export function toggleActiveOrLastToolCard() {
  const id = activeToolCard() ?? lastToolCard()
  if (!id) return
  toggleExpanded(id)
}
