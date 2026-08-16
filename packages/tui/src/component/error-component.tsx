import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal } from "solid-js"
import { getScrollAcceleration } from "../util/scroll"
import { useClipboard } from "../context/clipboard"
import { useExit } from "../context/exit"
import { useTheme } from "../context/theme"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { CATEGORY_LABEL, SEVERITY_GLYPH, severityColor, type DegradedState } from "./error-state/model"
import { redactSecrets } from "../util/redact"

export function ErrorComponent(props: { error: Error; reset: () => void }) {
  const term = useTerminalDimensions()
  const exit = useExit()
  const clipboard = useClipboard()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      void exit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/Ottili-ONE/coder-cli/issues/new?template=bug-report.yml")

  const state: DegradedState = {
    id: "fatal",
    category: "unknown",
    severity: "error",
    title: "A fatal error occurred",
    message: redactSecrets(props.error.message || "Unknown error"),
    dismissible: false,
    createdAt: 0,
  }

  const safeMessage = redactSecrets(props.error.message || "")
  if (safeMessage) {
    issueURL.searchParams.set("title", `opentui: fatal: ${safeMessage}`)
  }

  const safeStack = redactSecrets(props.error.stack || "")
  if (safeStack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + safeStack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("ottili-coder-version", InstallationVersion)

  const accent = severityColor(state.severity, theme)

  const copyIssueURL = () => {
    void clipboard.write?.(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box aria-label={`Fatal error: ${state.message}`} flexDirection="column" gap={1} backgroundColor={theme.background}>
      <box
        flexDirection="column"
        gap={0}
        backgroundColor={theme.backgroundPanel}
        borderColor={accent}
        border={["left"]}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <text attributes={TextAttributes.BOLD} fg={accent}>
          {`${SEVERITY_GLYPH[state.severity]} ${CATEGORY_LABEL[state.category]}: ${state.title}`}
        </text>
        <text fg={theme.text} wrapMode="word">
          {state.message}
        </text>
      </box>
      <box flexDirection="row" gap={1} alignItems="center">
        <box onMouseUp={copyIssueURL} backgroundColor={theme.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.selectedListItemText}>
            Copy issue URL
          </text>
        </box>
        {copied() && <text fg={theme.success}>Successfully copied</text>}
        <box onMouseUp={props.reset} backgroundColor={theme.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.selectedListItemText}>
            Reset TUI
          </text>
        </box>
        <box onMouseUp={() => void exit()} backgroundColor={theme.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.selectedListItemText}>
            Exit
          </text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)} scrollAcceleration={getScrollAcceleration()}>
        <text fg={theme.textMuted}>{props.error.stack}</text>
      </scrollbox>
    </box>
  )
}
