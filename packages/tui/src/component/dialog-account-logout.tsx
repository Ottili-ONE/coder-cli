import { onMount } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"
import { useTheme } from "../context/theme"

export function DialogAccountLogout() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  onMount(() => {
    void (async () => {
      try {
        const response = await sdk.fetch(`${sdk.url}/experimental/account/logout`, {
          method: "POST",
          headers: { Accept: "application/json" },
        })

        if (!response.ok) {
          const text = await response.text()
          throw new Error(text || `HTTP ${response.status}`)
        }

        await sdk.client.instance.dispose()

        toast.show({
          title: "Signed out",
          message: "Your Ottili account was disconnected",
          variant: "info",
        })
      } catch (error) {
        toast.show({
          title: "Sign out failed",
          message: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      } finally {
        dialog.clear()
      }
    })()
  })

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Spinner color={theme.primary} />
        <text fg={theme.text}>Signing out…</text>
      </box>
    </box>
  )
}
