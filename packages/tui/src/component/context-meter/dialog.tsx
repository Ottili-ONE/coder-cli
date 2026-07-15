/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import { Dialog } from "../ui/dialog"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import type { SessionMessage } from "@opencode-ai/sdk/v2/client"
import { ContextMeter, type ContextMeterColors } from "./index"
import {
  type ContextMeterContext,
  type ContextMeterMessage,
  type ContextMeterProvider,
} from "./model"

function mapMessage(msg: SessionMessage): ContextMeterMessage | undefined {
  if (msg.type !== "assistant") return undefined
  const tokens = msg.tokens
  if (!tokens) return undefined
  return {
    role: "assistant",
    providerID: msg.model.providerID,
    modelID: msg.model.id,
    cost: msg.cost ?? 0,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: { read: tokens.cache.read, write: tokens.cache.write },
    },
  }
}

// The TUI provider model does not expose per-model context limits, so the meter
// is rendered with an empty provider list. The model still derives a degraded
// (limit unknown) state and shows token/cache/cost from the message data.
export function DialogContextMeter(props: { sessionID: string; onClose: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()

  const messages = createMemo<ContextMeterMessage[]>(() =>
    (sync.data.message[props.sessionID] ?? [])
      .map(mapMessage)
      .filter((m): m is ContextMeterMessage => m !== undefined),
  )
  const providers = createMemo<ContextMeterProvider[]>(() => [])
  const ctx = createMemo<ContextMeterContext>(() => ({
    isReady: !!sync.data.message[props.sessionID],
  }))

  return (
    <Dialog onClose={props.onClose} size="large">
      <box padding={1} flexDirection="column">
        <ContextMeter messages={messages} providers={providers} ctx={ctx} colors={() => theme as unknown as ContextMeterColors} />
      </box>
    </Dialog>
  )
}
