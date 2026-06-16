import { createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogPrompt } from "../ui/dialog-prompt"
import { createCloudJob } from "../util/cloud-api"
import { DialogCloudWatch } from "./dialog-cloud-watch"

export function DialogCloudRun() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)

  return (
    <DialogPrompt
      title="Start cloud job"
      placeholder="Describe what the cloud agent should build…"
      busy={busy()}
      busyText="Creating job…"
      description={() => (
        <text>
          Ottili Cloud runs autonomous coding jobs on codehelm.ottili.one — ideal for larger features that should run in the background while you keep working locally.
        </text>
      )}
      onConfirm={(value) => {
        const objective = value.trim()
        if (!objective) {
          toast.show({ title: "Missing objective", message: "Describe what the job should accomplish.", variant: "error" })
          return
        }
        void (async () => {
          setBusy(true)
          try {
            const job = await createCloudJob(sdk, { objective })
            toast.show({
              title: "Cloud job started",
              message: `#${job.id} — ${job.title}`,
              variant: "success",
            })
            dialog.replace(() => <DialogCloudWatch jobId={job.id} />)
          } catch (error) {
            toast.show({
              title: "Could not start job",
              message: error instanceof Error ? error.message : String(error),
              variant: "error",
            })
            setBusy(false)
          }
        })()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
