import type { CloudJobStatus } from "./cloud-api"

export function cloudStatusColor(status: string, theme: {
  success: string
  error: string
  warning: string
  info: string
  textMuted: string
  text: string
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
