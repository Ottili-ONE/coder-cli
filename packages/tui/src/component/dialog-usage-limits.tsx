import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { DialogAccountLogin } from "./dialog-account-login"
import { DialogProvider as DialogProviderList } from "./dialog-provider"
import { fetchUsageLimits, summarizeUsageLimits, usageBar, usageLimitTone } from "../util/usage-limits-api"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { SetupHintRow } from "./setup-actions"

function formatLimitValue(item: { used: number; limit: number | null; unlimited: boolean }) {
  if (item.unlimited) return `${item.used.toLocaleString()} / ∞`
  if (item.limit == null) return `${item.used.toLocaleString()}`
  return `${item.used.toLocaleString()} / ${item.limit.toLocaleString()}`
}

function statusLabel(status: string | undefined) {
  if (status === "exceeded") return "Limit reached"
  if (status === "warning") return "Near limit"
  return "Healthy"
}

export function DialogUsageLimits() {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const connected = useConnected()
  const account = createMemo(() => sync.data.account_status)
  const [data] = createResource(() => fetchUsageLimits(sdk))
  const snapshot = createMemo(() => {
    const value = data()
    if (!value || value.loggedIn !== true) return undefined
    return value
  })
  const summary = createMemo(() => summarizeUsageLimits(snapshot()?.items ?? []))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage Limits
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={data.loading}>
        <text fg={theme.textMuted}>Loading plan usage…</text>
      </Show>

      <Show when={!data.loading && data()?.loggedIn === false}>
        <text fg={theme.text}>Plan usage requires an Ottili ONE account.</text>
        <Show when={!connected()}>
          <text fg={theme.textMuted}>
            Connect an AI provider first with <span style={{ fg: theme.primary }}>/connect</span> — free models work
            out of the box, premium models need a provider.
          </text>
        </Show>
        <box gap={1}>
          <SetupHintRow
            needsConnect={!connected()}
            needsLogin={!account().loggedIn}
            onConnect={() => dialog.replace(() => <DialogProviderList />)}
            onLogin={() => dialog.replace(() => <DialogAccountLogin />)}
          />
          <text fg={theme.textMuted}>Or run /login after /connect to unlock plan limits and billing.</text>
        </box>
      </Show>

      <Show when={snapshot()}>
        {(value) => (
          <box gap={1}>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              {value().planName ?? value().planCode ?? "Company plan"}
            </text>
            <Show when={value().billingStatus}>
              <text fg={theme.textMuted}>
                Billing: {value().billingStatus}
                {value().periodEnd ? ` · period ends ${new Date(value().periodEnd!).toLocaleDateString()}` : ""}
              </text>
            </Show>
            <Show when={value().message}>
              <text fg={theme.warning}>{value().message}</text>
            </Show>
            <Show when={summary().finite > 0}>
              <text fg={theme.textMuted}>
                {summary().ok} healthy · {summary().warning} near limit · {summary().exceeded} exceeded
                {summary().finite > 0 ? ` · avg ${summary().avgPercent}%` : ""}
              </text>
            </Show>
            <Show
              when={(value().items ?? []).length > 0}
              fallback={<text fg={theme.textMuted}>No usage limits returned for this plan yet.</text>}
            >
              <For each={value().items ?? []}>
                {(item) => {
                  const tone = usageLimitTone(item.status)
                  const barColor =
                    tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.primary
                  return (
                    <box gap={0}>
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.text} attributes={TextAttributes.BOLD}>
                          {item.label}
                        </text>
                        <text
                          fg={tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.textMuted}
                        >
                          {statusLabel(item.status)}
                        </text>
                      </box>
                      <text fg={theme.text}>{formatLimitValue(item)}</text>
                      <Show when={!item.unlimited}>
                        <text fg={barColor}>
                          {usageBar(item.percent)} {item.percent}%
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </Show>
            <Show when={value().dashboardUrl}>
              <text fg={theme.textMuted}>Full overview: {value().dashboardUrl}</text>
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}
