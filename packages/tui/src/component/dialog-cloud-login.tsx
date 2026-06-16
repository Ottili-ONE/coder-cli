import { createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogPrompt } from "../ui/dialog-prompt"
import { connectCloud } from "../util/cloud-api"

export function DialogCloudLogin(props: { onConnected?: () => void }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)

  async function finish(token: string, company?: string) {
    setBusy(true)
    try {
      const result = await connectCloud(sdk, {
        token: token.trim(),
        ...(company?.trim() ? { company: company.trim() } : {}),
      })
      toast.show({
        title: "Cloud connected",
        message: `Dashboard: ${result.dashboardUrl}`,
        variant: "success",
      })
        props.onConnected?.()
        dialog.clear()
        await sdk.client.instance.dispose()
    } catch (error) {
      toast.show({
        title: "Cloud connect failed",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
      setBusy(false)
    }
  }

  return (
    <DialogPrompt
      title="Connect Ottili Cloud"
      placeholder="ott_..."
      busy={busy()}
      busyText="Verifying API key…"
      description={() => (
        <text>
          Paste your developer API key from codehelm.ottili.one. It is stored locally in ~/.config/ottili-coder/cloud.json.
        </text>
      )}
      onConfirm={(value) => {
        if (!value.trim()) {
          toast.show({ title: "Missing API key", message: "An ott_… key is required.", variant: "error" })
          return
        }
        void (async () => {
          const company = await DialogPrompt.show(dialog, "Company slug (optional)", {
            placeholder: "my-company",
            description: () => (
              <text>Only needed if your workspace uses multiple companies. Press submit with an empty field to skip.</text>
            ),
          })
          await finish(value, company ?? undefined)
        })()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
