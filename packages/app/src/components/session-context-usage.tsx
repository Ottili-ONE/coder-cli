import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Tooltip, type TooltipProps } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import {
  CONTEXT_METER_RENDER_BUDGET_MS,
  deriveContextMeterState,
  formatCompactNumber,
  truncateLabel,
  type ContextMeterState,
} from "@/components/session-context-usage-state"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: TooltipProps["placement"]
}

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  if (!args.view.reviewPanel.opened()) args.view.reviewPanel.open()
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const providers = useProviders()
  const { params, tabs, view } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  // Rapid token streams mutate the message array many times per second. Sample
  // the source at most once per render budget so the meter never thrashes the
  // layout while a large response is streaming in.
  const [sampledMessages, setSampledMessages] = createSignal(messages())
  let scheduled = false
  createEffect(() => {
    const next = messages()
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      setSampledMessages(next)
    }, CONTEXT_METER_RENDER_BUDGET_MS)
  })

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo<ReturnType<typeof getSessionContextMetrics> | undefined>(() => {
    try {
      return getSessionContextMetrics(sampledMessages(), [...providers.all().values()])
    } catch {
      return undefined
    }
  })
  const context = createMemo(() => metrics()?.context)
  const totalCost = createMemo(() => metrics()?.totalCost ?? 0)
  const cost = createMemo(() => usd().format(totalCost()))

  const [offline, setOffline] = createSignal(typeof navigator !== "undefined" ? !navigator.onLine : false)
  const trackConnection = () => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    onCleanup(() => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    })
  }
  trackConnection()

  const meter = createMemo<ContextMeterState>(() =>
    deriveContextMeterState({
      status: sync.status,
      providerReady: sync.data.provider_ready,
      messageCount: messages().length,
      context: context(),
      totalCost: totalCost(),
      offline: offline(),
      denied: false,
      error: metrics() === undefined && messages().length > 0,
    }),
  )

  const openContext = () => {
    if (!params.id) return

    if (tabState.activeTab() === "context") {
      tabs().close("context")
      return
    }
    openSessionContext({
      view: view(),
      layout,
      tabs: tabs(),
    })
  }

  const summary = createMemo(() => {
    const m = meter()
    const t = language.t
    switch (m.kind) {
      case "loading":
        return t("context.usage.state.loading")
      case "empty":
        return t("context.usage.state.empty")
      case "failure":
        return t("context.usage.state.failure")
      case "denied":
        return t("context.usage.state.denied")
      case "offline":
        return t("context.usage.state.offline")
      case "degraded":
        return t("context.usage.state.degraded")
      case "long-content":
        return `${t("context.usage.state.longContent")} ${m.usage ?? 0}%`
      case "populated":
        return `${m.usage ?? 0}% · ${formatCompactNumber(m.total, language.intl())} ${t("context.usage.tokens")} · ${cost()}`
    }
  })

  const circle = () => (
    <span
      role="img"
      aria-label={summary()}
      class="flex items-center justify-center"
    >
      <ProgressCircle
        size={16}
        strokeWidth={2}
        percentage={Math.max(0, Math.min(100, meter().usage ?? 0))}
        aria-hidden={true}
      />
    </span>
  )

  const indicator = () => (
    <span class="flex min-w-0 items-center gap-1" role="img" aria-label={summary()}>
      {circle()}
      <span class="tabular-nums text-text-invert-base text-xs" aria-hidden="true">
        {meter().usage === null ? "—" : `${meter().usage}%`}
      </span>
    </span>
  )

  const tooltipValue = () => {
    const m = meter()
    const t = language.t
    return (
      <div class="max-w-[16rem]">
        <Switch>
          <Match when={m.kind === "loading"}>
            <div class="text-text-invert-strong">{t("context.usage.state.loading")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.loadingHint")}</div>
          </Match>
          <Match when={m.kind === "empty"}>
            <div class="text-text-invert-strong">{t("context.usage.state.empty")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.emptyHint")}</div>
          </Match>
          <Match when={m.kind === "failure"}>
            <div class="text-text-invert-strong">{t("context.usage.state.failure")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.failureHint")}</div>
          </Match>
          <Match when={m.kind === "denied"}>
            <div class="text-text-invert-strong">{t("context.usage.state.denied")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.deniedHint")}</div>
          </Match>
          <Match when={m.kind === "offline"}>
            <div class="text-text-invert-strong">{t("context.usage.state.offline")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.offlineHint")}</div>
          </Match>
          <Match when={m.kind === "degraded"}>
            <div class="text-text-invert-strong">{t("context.usage.state.degraded")}</div>
            <div class="text-text-invert-base">{t("context.usage.state.degradedHint")}</div>
          </Match>
          <Match when={m.kind === "long-content" || m.kind === "populated"}>
            <Show when={context()}>
              {(ctx) => (
                <>
                  <div class="flex items-center gap-2">
                    <span class="text-text-invert-strong">{formatCompactNumber(ctx().total, language.intl())}</span>
                    <span class="text-text-invert-base">{t("context.usage.tokens")}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
                    <span class="text-text-invert-base">{t("context.usage.usage")}</span>
                  </div>
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-text-invert-strong" title={ctx().providerLabel}>
                      {truncateLabel(ctx().providerLabel)}
                    </span>
                    <span class="text-text-invert-base">·</span>
                    <span class="truncate text-text-invert-strong" title={ctx().modelLabel}>
                      {truncateLabel(ctx().modelLabel)}
                    </span>
                  </div>
                </>
              )}
            </Show>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{cost()}</span>
              <span class="text-text-invert-base">{t("context.usage.cost")}</span>
            </div>
            <Show when={m.kind === "long-content"}>
              <div class="text-text-invert-base">{t("context.usage.state.longContentHint")}</div>
            </Show>
          </Match>
        </Switch>
      </div>
    )
  }

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
        <Switch>
          <Match when={variant() === "indicator"}>{indicator()}</Match>
          <Match when={true}>
            <Button
              type="button"
              variant="ghost"
              class="size-6"
              onClick={openContext}
              aria-label={summary()}
              aria-busy={meter().kind === "loading"}
            >
              {circle()}
            </Button>
          </Match>
        </Switch>
      </Tooltip>
      <span class="sr-only" aria-live="polite">
        {summary()}
      </span>
    </Show>
  )
}
