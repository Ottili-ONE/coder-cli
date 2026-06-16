import { createMemo } from "solid-js"
import { useSync } from "../context/sync"

export function useConnected() {
  const sync = useSync()
  return createMemo(() => {
    if (sync.data.account_status.loggedIn) return true
    return sync.data.provider.some(
      (provider) =>
        provider.id !== "ottili-coder" || Object.values(provider.models).some((model) => model.cost?.input !== 0),
    )
  })
}
