import type { RGBA } from "@opentui/core"
import type { CloudJobStatus } from "./cloud-api"

export function cloudStatusColor(status: string, theme: {
  success: RGBA
  error: RGBA
  warning: RGBA
  info: RGBA
  textMuted: RGBA
  text: RGBA
}) {
  switch (status) {
    case "completed":
    case "passed":
      return theme.success
    case "failed":
      return theme.error
    case "running":
    case "planning":
    case "validating":
      return theme.info
    case "queued":
    case "paused":
      return theme.warning
    case "cancelled":
    case "draft":
      return theme.textMuted
    default:
      return theme.text
  }
}

export function isActiveCloudStatus(status: CloudJobStatus): boolean {
  return !["completed", "failed", "cancelled"].includes(status)
}
