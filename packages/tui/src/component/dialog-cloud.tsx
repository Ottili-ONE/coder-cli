import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import {
  disconnectCloud,
  fetchCloudStatus,
  listCloudJobs,
  type CloudJob,
} from "../util/cloud-api"
import { cloudStatusColor, isActiveCloudStatus } from "../util/cloud-theme"
import { DialogCloudLogin } from "./dialog-cloud-login"
import { DialogCloudRun } from "./dialog-cloud-run"
import { DialogCloudWatch } from "./dialog-cloud-watch"

function jobTitleView(job: CloudJob, theme: ReturnType<typeof useTheme>["theme"]) {
  return (
    <box flexDirection="row" gap={2}>
      <text fg={theme.textMuted}>#{job.id}</text>
      <text fg={cloudStatusColor(job.status, theme)} attributes={TextAttributes.BOLD}>
        {job.status}
      </text>
      <text fg={theme.text}>{job.title}</text>
      <text fg={theme.textMuted}>{Math.round(job.completion_pct ?? 0)}%</text>
    </box>
  )
}

export function DialogCloud() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  const [status, { refetch: refetchStatus }] = createResource(() => fetchCloudStatus(sdk))
  const [jobs, { refetch: refetchJobs }] = createResource(
    () => status()?.configured,
    async (configured) => {
      if (!configured) return []
      return listCloudJobs(sdk)
    },
  )

  const refresh = async () => {
    await refetchStatus()
    await refetchJobs()
  }

  const options = createMemo(() => {
    const listed = jobs()
    if (listed === undefined) {
      return [
        {
          title: "Loading jobs…",
          value: "loading" as const,
          onSelect: () => {},
        },
      ]
    }
    if (listed.length === 0) {
      return [
        {
          title: "No cloud jobs yet",
          description: "Start one with /cloud-run",
          value: "empty" as const,
          onSelect: () => {},
        },
      ]
    }
    return listed.map((job) => ({
      title: `#${job.id} ${job.title}`,
      titleView: jobTitleView(job, theme),
      value: job,
      description: `${job.status} · ${Math.round(job.completion_pct ?? 0)}%`,
      category: isActiveCloudStatus(job.status) ? "Active" : "Finished",
      onSelect: () => {
        dialog.replace(() => <DialogCloudWatch jobId={job.id} />)
      },
    }))
  })

  if (status() === undefined) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <text fg={theme.textMuted}>Loading Ottili Cloud…</text>
      </box>
    )
  }

  if (status()?.configured === false) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Ottili Cloud
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <text fg={theme.textMuted}>
          Connect your codehelm.ottili.one workspace to start autonomous cloud coding jobs from the terminal.
        </text>
        <text fg={theme.textMuted}>Dashboard: {status()?.dashboardUrl ?? "https://codehelm.ottili.one"}</text>
        <text
          fg={theme.primary}
          onMouseUp={() => {
            dialog.replace(() => (
              <DialogCloudLogin
                onConnected={() => {
                  void refresh()
                  dialog.replace(() => <DialogCloud />)
                }}
              />
            ))
          }}
        >
          Connect with API key →
        </text>
      </box>
    )
  }

  return (
    <DialogSelect<CloudJob | "loading" | "empty">
      title="Ottili Cloud"
      titleView={
        <box flexDirection="row" gap={2} alignItems="center">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Ottili Cloud
          </text>
          <Show when={status()?.company}>
            <text fg={theme.textMuted}>{status()?.company}</text>
          </Show>
          <Show when={(status()?.activeJobs ?? 0) > 0}>
            <text fg={theme.info}>{status()?.activeJobs} active</text>
          </Show>
        </box>
      }
      options={options()}
      flat
      skipFilter
      footerHints={[
        { title: "n", label: "new job", side: "left" },
        { title: "d", label: "disconnect", side: "right" },
      ]}
      actions={[
        {
          command: "cloud.new",
          title: "New cloud job",
          side: "left",
          onTrigger: () => dialog.replace(() => <DialogCloudRun />),
        },
        {
          command: "cloud.disconnect",
          title: "Disconnect",
          side: "right",
          onTrigger: () => {
            void (async () => {
              try {
                await disconnectCloud(sdk)
                toast.show({ title: "Cloud disconnected", message: "Ottili Cloud was disconnected.", variant: "info" })
                dialog.replace(() => <DialogCloud />)
                await refresh()
              } catch (error) {
                toast.show({
                  title: "Disconnect failed",
                  message: error instanceof Error ? error.message : String(error),
                  variant: "error",
                })
              }
            })()
          },
        },
      ]}
      onSelect={(option) => {
        if (option.value === "loading" || option.value === "empty") return
        const job = option.value as CloudJob
        dialog.replace(() => <DialogCloudWatch jobId={job.id} />)
      }}
      footer={
        <Show when={jobs()?.length}>
          <text fg={theme.textMuted}>enter watch · c cancel · o dashboard</text>
        </Show>
      }
    />
  )
}
