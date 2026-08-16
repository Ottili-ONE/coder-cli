// Focus mode chrome decisions (T-CLI-0205). Kept pure so they can be
// unit-tested without mounting the full session route. Mirrors the inline
// visibility contracts from specs/tui/focus-mode.md §5.2–§5.3.
export function computeSidebarVisible(params: {
  parentID: boolean
  focused: boolean
  sidebarOpen: boolean
  sidebarAuto: boolean
  wide: boolean
}): boolean {
  if (params.parentID) return false
  if (params.focused) return false
  if (params.sidebarOpen) return true
  if (params.sidebarAuto && params.wide) return true
  return false
}

export function computeFocusChrome(params: {
  focused: boolean
  sessionExists: boolean
  sidebarVisible: boolean
}): { headerVisible: boolean; focusHintVisible: boolean } {
  return {
    headerVisible: params.sessionExists && !params.sidebarVisible && !params.focused,
    focusHintVisible: params.focused,
  }
}
