import { TextAttributes } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { getCloudJob, isCloudJobTerminal, listCloudJobEvents, type CloudEvent, type CloudJob } from "../util/cloud-api"
import { cloudStatusColor } from "../util/cloud-theme"

function formatTime(value: string | null) {
  if (!value) return "--:--:--"
  try {
    return new Date(value).toLocaleTimeString()
  } catch {
    return value
  }
}

export function DialogCloudWatch(props: { jobId: number }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [job, setJob] = createSignal<CloudJob | undefined>()
  const [events, setEvents] = createSignal<CloudEvent[]>([])
  const [error, setError] = createSignal<string>()

  createEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const [nextJob, nextEvents] = await Promise.all([
          getCloudJob(sdk, props.jobId),
          listCloudJobEvents(sdk, props.jobId).catch(() => [] as CloudEvent[]),
        ])
        if (cancelled) return
        setJob(nextJob)
        setEvents(nextEvents)
        setError(undefined)
        if (isCloudJobTerminal(nextJob.status)) return false
        return true
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        return true
      }
    }

    void poll()
    const timer = setInterval(() => {
      void poll().then((keepGoing) => {
        if (keepGoing === false) clearInterval(timer)
      })
    }, 5000)

    onCleanup(() => {
      cancelled = true
      clearInterval(timer)
    })
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cloud job #{props.jobId}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
      <Show when={job()}>
        {(current) => (
          <box gap={1}>
            <text fg={theme.text}>
              <span style={{ fg: cloudStatusColor(current().status, theme), attributes: TextAttributes.BOLD }}>
                {current().status}
              </span>
              {"  "}
              <span style={{ fg: theme.textMuted }}>{Math.round(current().completion_pct ?? 0)}%</span>
              {current().current_phase ? (
                <span style={{ fg: theme.textMuted }}> · {current().current_phase}</span>
              ) : (
                ""
              )}
            </text>
            <text fg={theme.text}>{current().title}</text>
            <Show when={current().result_summary}>
              <text fg={theme.success}>{current().result_summary}</text>
            </Show>
            <Show when={current().error_summary}>
              <text fg={theme.error}>{current().error_summary}</text>
            </Show>
          </box>
        )}
      </Show>
      <box gap={0} maxHeight={12} overflow="hidden">
        <For each={events()}>
          {(event) => (
            <text fg={theme.textMuted}>
              {formatTime(event.created_at)}  {event.message}
            </text>
          )}
        </For>
      </box>
      <text fg={theme.textMuted}>Updates every 5s · Ctrl+C closes this view</text>
    </box>
  )
}
