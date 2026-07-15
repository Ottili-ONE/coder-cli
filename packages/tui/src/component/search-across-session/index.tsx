/** @jsxImportSource @opentui/solid */
import {
  createMemo,
  createSignal,
  For,
  Show,
  type Accessor,
  useKeyboard,
  useTerminalDimensions,
} from "@opentui/solid"
import {
  type SearchEntry,
  type SearchCategoryFilter,
  type SearchState,
  CATEGORY_FILTER_CYCLE,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  buildState,
  visibleEntries,
  categoryCounts,
  effectiveSelection,
  moveSelection,
  nextCategory,
  categoryFilterLabel,
  selectedEntry,
  truncate,
} from "./model"

export interface SearchAcrossSessionProps {
  entries: Accessor<SearchEntry[]>
  onSelect?: (entry: SearchEntry) => void
  onClose?: () => void
  /** Optional externally supplied error (e.g. index failed to build). */
  error?: Accessor<string | null>
}

function rowLine(entry: SearchEntry, selected: boolean, width: number): string {
  const prefix = selected ? "> " : "  "
  const icon = CATEGORY_ICON[entry.category]
  const narrow = width < 60
  const meta = entry.meta ? ` · ${entry.meta}` : ""
  const titleWidth = Math.max(6, width - prefix.length - icon.length - 1 - meta.length - 2)
  const title = truncate(entry.title, titleWidth)
  const head = `${prefix}${icon} ${title}${meta}`
  if (narrow) return head
  const body = entry.body.trim().length > 0 ? `   ${truncate(entry.body.replace(/\s+/g, " "), Math.max(4, width - 3))}` : ""
  return head + body
}

export function SearchAcrossSession(props: SearchAcrossSessionProps) {
  const [query, setQuery] = createSignal("")
  const [category, setCategory] = createSignal<SearchCategoryFilter>("all")
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [internalError, setInternalError] = createSignal<string | null>(null)
  const dims = useTerminalDimensions()
  const width = () => dims().width

  const error = () => props.error?.() ?? internalError()

  const state = createMemo<SearchState>(() =>
    buildState(props.entries(), {
      query: query(),
      category: category(),
      selectedId: selectedId(),
      error: error(),
    }),
  )

  const visible = createMemo(() => visibleEntries(state()))
  const counts = createMemo(() => categoryCounts(state().entries))
  const selected = createMemo(() => effectiveSelection(state()))

  // Keep the focus signal valid as the visible set changes (streaming, typing).
  createEffect(() => {
    const valid = effectiveSelection(state())
    if (valid !== selectedId()) setSelectedId(valid)
  })

  function clearErrorIfQuery() {
    if (query().length > 0) {
      setQuery("")
      setInternalError(null)
      return true
    }
    return false
  }

  useKeyboard((event) => {
    if (event.name === "escape") {
      if (clearErrorIfQuery()) return
      props.onClose?.()
      return
    }
    if (event.name === "backspace") {
      setQuery((q) => q.slice(0, -1))
      setInternalError(null)
      return
    }
    if (event.name === "return" || event.name === "enter") {
      const entry = selectedEntry(state())
      if (entry) props.onSelect?.(entry)
      else props.onClose?.()
      return
    }
    if (event.name === "up" || event.name === "k") {
      setSelectedId(moveSelection(state(), -1))
      return
    }
    if (event.name === "down" || event.name === "j") {
      setSelectedId(moveSelection(state(), 1))
      return
    }
    if (event.name === "tab" || event.name === "c") {
      setCategory(nextCategory(category()))
      return
    }
    // Printable input becomes part of the query.
    if (event.sequence && event.sequence.length === 1 && !event.ctrl && !event.meta) {
      setQuery((q) => (q + event.sequence).slice(0, 200))
      setInternalError(null)
    }
  })

  return (
    <box id="search-across-session" flexDirection="column" width={width()} selectable>
      <box flexDirection="column">
        <text id="search-header">{"Search across session"}</text>
        <text id="search-query">{`query: "${query()}"`}</text>
      </box>
      <box flexDirection="column">
        <text id="search-counts">
          {CATEGORY_FILTER_CYCLE.map(
            (filter) =>
              `${filter === "all" ? "All" : CATEGORY_LABEL[filter as Exclude<SearchCategoryFilter, "all">]} ${
                filter === "all"
                  ? state().entries.length
                  : counts()[filter as Exclude<SearchCategoryFilter, "all">]
              }`,
          ).join(" · ")}
        </text>
        <text id="search-filter">{`filter: ${categoryFilterLabel(category())}`}</text>
      </box>
      <Show when={error()} fallback={<></>}>
        <text id="search-error">{`⚠ ${error()}`}</text>
      </Show>
      <Show
        when={visible().length > 0}
        fallback={
          <text id="search-empty">
            {error() ? "Search failed — see error above." : "No results. Type to search the session."}
          </text>
        }
      >
        <box flexDirection="column">
          <For each={visible()}>
            {(entry) => (
              <text id={`search-row-${entry.id}`}>{rowLine(entry, selected() === entry.id, width())}</text>
            )}
          </For>
        </box>
      </Show>
      <text id="search-footer">
        {"↑/↓ navigate · type to filter · tab category · ⏎ open · esc close"}
      </text>
    </box>
  )
}
