/**
 * Lightweight cross-component controller for opening/focusing the Session sidebar.
 *
 * `session.list` (defined in `app.tsx`) lives outside the session route and has no
 * access to the local `sidebarOpen` signal, so it requests the open through this
 * module-level signal. The session route and the `Sidebar` component observe the
 * request and react (open the panel, focus it, focus search).
 */
import { createSignal } from "solid-js"

const [openRequest, setOpenRequest] = createSignal(0)
const [focusSearch, setFocusSearch] = createSignal(false)

/** Request the Session sidebar to open (and focus its list). */
export function requestSessionSidebarOpen(focusSearchFlag = false) {
  setOpenRequest((value) => value + 1)
  if (focusSearchFlag) setFocusSearch(true)
}

/** Read-only accessor for the open request counter (increments on each request). */
export function useSessionSidebarOpenRequest() {
  return openRequest
}

/** Consume the pending focus-search intent (returns true at most once per request). */
export function consumeSessionSidebarFocusSearch() {
  const value = focusSearch()
  setFocusSearch(false)
  return value
}
