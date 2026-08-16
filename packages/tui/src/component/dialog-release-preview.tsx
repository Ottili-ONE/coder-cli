/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onMount, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { useTheme } from "../context/theme"
import { MarkdownView } from "./markdown"
import { Spinner } from "./spinner"
import { useTerminalDimensions } from "@opentui/solid"

/**
 * Walk up to six directories from `cwd` for the newest `RELEASE_NOTES_*.md`.
 * Returns the bundled fallback string when none is found — never fabricates
 * content (spec §3.2 / §9). Pure-ish: only touches the local filesystem.
 */
export async function readReleaseNotes(cwd: string): Promise<string> {
  let dir = cwd
  for (let i = 0; i < 6; i++) {
    try {
      const match = (await readdir(dir))
        .filter((f) => f.startsWith("RELEASE_NOTES_") && f.endsWith(".md"))
        .sort()
        .reverse()[0]
      if (match) return await readFile(path.join(dir, match), "utf8")
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return "No release notes found for this installation."
}

export type DialogReleasePreviewProps = {
  cwd: string
}

/**
 * Changelog preview dialog for the update banner's `[c]` action. Renders the
 * bundled `RELEASE_NOTES_*.md` through the Ottili markdown renderer with
 * `conceal` on so any secret-shaped text in the notes is redacted from the
 * visual output (spec §9 sensitive-data requirement).
 */
export function DialogReleasePreview(props: DialogReleasePreviewProps) {
  const { theme } = useTheme()
  const term = useTerminalDimensions()
  const [notes, setNotes] = createSignal<string | undefined>(undefined)
  const [failed, setFailed] = createSignal(false)

  onMount(() => {
    readReleaseNotes(props.cwd)
      .then(setNotes)
      .catch(() => setFailed(true))
  })

  const content = createMemo(() => notes() ?? (failed() ? "Could not read release notes." : ""))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Release notes
      </text>
      <Show
        when={notes() !== undefined}
        fallback={
          <box flexDirection="row" gap={1} alignItems="center">
            <Spinner />
            <text fg={theme.textMuted}>Loading release notes…</text>
          </box>
        }
      >
        <box flexDirection="column" gap={1}>
          <MarkdownView content={content()} conceal indent={2} streaming={false} />
        </box>
      </Show>
      <text fg={theme.textMuted}>esc to close</text>
    </box>
  )
}
