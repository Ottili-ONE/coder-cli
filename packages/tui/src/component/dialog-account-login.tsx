import { onMount } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"
import { useTheme } from "../context/theme"

export function DialogAccountLogin() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  onMount(() => {
    void (async () => {
      toast.show({
        title: "Sign in with Ottili",
        message: "Opening your browser…",
        variant: "info",
      })

      try {
        const response = await sdk.fetch(`${sdk.url}/experimental/account/login`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })

        if (!response.ok) {
          const text = await response.text()
          try {
            const parsed = JSON.parse(text) as { message?: string; error?: string }
            throw new Error(parsed.message ?? parsed.error ?? (text || `HTTP ${response.status}`))
          } catch (error) {
            if (error instanceof Error && error.message !== text) throw error
            throw new Error(text || `HTTP ${response.status}`)
          }
        }

        const data = (await response.json()) as { email?: string }
        await sdk.client.instance.dispose()
        toast.show({
          title: "Signed in",
          message: data.email ? `Logged in as ${data.email}` : "Ottili ONE account connected",
          variant: "success",
        })
      } catch (error) {
        toast.show({
          title: "Sign in failed",
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
        <text fg={theme.text}>Waiting for browser sign in…</text>
      </box>
      <text fg={theme.textMuted}>Complete the login in your browser, then return here.</text>
    </box>
  )
}
