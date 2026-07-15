import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { SessionMessage } from "@opencode-ai/sdk/v2"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useConnected } from "./use-connected"
import {
  costUsageState,
  formatCost,
  formatTokens,
  type RawStep,
} from "./cost-usage/model"
import {
  fetchUsageLimits,
  summarizeUsageLimits,
  usageBar as limitBar,
  usageLimitTone,
} from "../util/usage-limits-api"
import { DialogAccountLogin } from "./dialog-account-login"

const MAX_STEPS = 16

function stepToneColor(tone: "success" | "warning" | "error" | "info", theme: ReturnType<typeof useTheme>["theme"]) {
  if (tone === "error") return theme.error
  if (tone === "warning") return theme.warning
  return theme.primary
}

function mapMessages(messages: SessionMessage[]): RawStep[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    provider: "providerID" in m ? (m.providerID as string) : undefined,
    model: "modelID" in m ? (m.modelID as string) : undefined,
    cost: "cost" in m ? (m.cost as number | undefined) : undefined,
    tokens: "tokens" in m ? (m.tokens as { input: number; output: number; reasoning: number; cache: { read: number; write: number } }) : undefined,
    time: "time" in m && m.time && typeof m.time === "object" ? (m.time as { created?: number }).created : undefined,
  }))
}

/** Compact, always-visible cost and usage meter for the session header. */
export function CostUsageMeter(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const width = createMemo(() => dimensions().width)

  const [limits] = createResource(() => fetchUsageLimits(sdk))

  const state = createMemo(() =>
    costUsageState(
      session()?.cost,
      session()?.tokens,
      mapMessages(messages()),
      limits() ?? null,
      { isReady: true },
      { width: width() },
    ),
  )

  const open = () => dialog.replace(() => <DialogCostUsage sessionID={props.sessionID} />)

  return (
    <Show when={state().status !== "empty"}>
      <box
        flexDirection="row"
        gap={1}
        alignItems="center"
        flexShrink={0}
        onMouseDown={open}
        title={state().ariaLabel}
      >
        <text fg={theme.textMuted}>cost</text>
        <text fg={theme.text}>{state().shortText}</text>
        <Show when={state().barPercent != null}>
          <text fg={stepToneColor(state().tone, theme)}>
            {state().bar} {state().barPercent}%
          </text>
        </Show>
      </box>
    </Show>
  )
}

/** Full detail dialog: actual cost, token usage, plan limits, per-step breakdown. */
export function DialogCostUsage(props: { sessionID?: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const connected = useConnected()

  const account = createMemo(() => sync.data.account_status)
  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [limits] = createResource(() => fetchUsageLimits(sdk))
  const snapshot = createMemo(() => {
    const value = limits()
    if (!value || value.loggedIn !== true) return undefined
    return value
  })
  const summary = createMemo(() => summarizeUsageLimits(snapshot()?.items ?? []))

  const steps = createMemo(() => {
    const data = costUsageState(
      session()?.cost,
      session()?.tokens,
      mapMessages(messages()),
      limits() ?? null,
      { isReady: true },
    )
    return data.data?.steps ?? []
  })

  const cost = createMemo(() => session()?.cost ?? 0)
  const tokens = createMemo(() => session()?.tokens)
  const tokenTotal = createMemo(() => {
    const t = tokens()
    if (!t) return 0
    return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cost &amp; Usage
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box gap={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Session cost
        </text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {formatCost(cost())}
        </text>
        <Show when={tokens()}>
          {(t) => (
            <text fg={theme.textMuted}>
              {formatTokens(t().input)} in · {formatTokens(t().output)} out · {formatTokens(t().reasoning)} reasoning ·
              cache {formatTokens(t().cache.read)}/{formatTokens(t().cache.write)}
            </text>
          )}
        </Show>
        <text fg={theme.textMuted}>{formatTokens(tokenTotal())} tokens total</text>
      </box>

      <Show when={!limits.loading && snapshot()}>
        {(value) => (
          <box gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Plan limits
            </text>
            <text fg={theme.primary}>{value().planName ?? value().planCode ?? "Company plan"}</text>
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
                          {item.unlimited
                            ? `${item.used.toLocaleString()} / ∞`
                            : item.limit == null
                              ? `${item.used.toLocaleString()}`
                              : `${item.used.toLocaleString()} / ${item.limit.toLocaleString()}`}
                        </text>
                      </box>
                      <Show when={!item.unlimited}>
                        <text fg={barColor}>
                          {limitBar(item.percent)} {item.percent}%
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

      <Show when={!limits.loading && !snapshot()}>
        <box gap={1}>
          <text fg={theme.textMuted}>Plan limits require an Ottili ONE account.</text>
          <Show when={!connected()}>
            <text fg={theme.textMuted}>
              Connect a provider with <span style={{ fg: theme.primary }}>/connect</span> first — free models work
              out of the box.
            </text>
          </Show>
          <Show when={!account().loggedIn}>
            <text
              fg={theme.primary}
              onMouseUp={() => dialog.replace(() => <DialogAccountLogin />)}
            >
              /login to unlock plan limits and billing
            </text>
          </Show>
        </box>
      </Show>

      <Show when={limits.loading}>
        <text fg={theme.textMuted}>Loading plan usage…</text>
      </Show>

      <box gap={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Per-step breakdown
        </text>
        <Show
          when={steps().length > 0}
          fallback={<text fg={theme.textMuted}>No billed steps recorded for this session yet.</text>}
        >
          <For each={steps().slice(0, MAX_STEPS)}>
            {(step) => (
              <box flexDirection="row" justifyContent="space-between" gap={2}>
                <text fg={theme.textMuted}>
                  #{step.index} {step.model ?? step.provider ?? step.role}
                </text>
                <text fg={theme.text}>
                  {formatCost(step.cost)} · {formatTokens(step.tokens.total)} tok
                </text>
              </box>
            )}
          </For>
          <Show when={steps().length > MAX_STEPS}>
            <text fg={theme.textMuted}>and {steps().length - MAX_STEPS} more steps…</text>
          </Show>
        </Show>
      </box>
    </box>
  )
}
