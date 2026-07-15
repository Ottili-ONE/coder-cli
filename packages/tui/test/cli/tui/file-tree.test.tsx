/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { FileTree, type FileTreeProps } from "../../../src/component/file-tree/FileTree"
import { buildFileTree, type FileTreeItem } from "../../../src/component/file-tree/file-tree-core"

function withTheme(component: () => JSX.Element) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider>{component()}</ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

function Bridge(props: Partial<FileTreeProps>) {
  const { theme } = useTheme()
  const { theme: _theme, ...rest } = props
  return <FileTree theme={theme} {...(rest as FileTreeProps)} />
}

async function renderFrame(component: () => JSX.Element, width = 40, height = 12) {
  const app = await testRender(() => withTheme(component), { width, height })
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = app.captureCharFrame()
      if (frame.trim().length > 0) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

const file = (path: string, extra: Partial<FileTreeItem> = {}): FileTreeItem => ({
  path,
  status: extra.status,
  ignored: extra.ignored,
  staged: extra.staged,
  kind: extra.kind,
})

describe("FileTree hardening", () => {
  test("loading stays quiet but intentional (no parent strings)", async () => {
    const frame = await renderFrame(() => (
      <Bridge width={32} items={[]} loading={true} error={undefined} />
    ))
    expect(frame).not.toContain("Loading diff...")
    expect(frame).not.toContain("No files")
    expect(frame).toContain("loading")
  })

  test("empty state is actionable and labeled", async () => {
    const frame = await renderFrame(() => (
      <Bridge width={32} items={[]} loading={false} error={undefined} />
    ))
    expect(frame).toContain("No files")
  })

  test("empty state reports no matches when searching", async () => {
    const frame = await renderFrame(() => (
      <Bridge width={32} items={[file("src/a.ts")]} loading={false} error={undefined} search="zzz" />
    ))
    expect(frame).toContain("No matches")
  })

  test("populated state paints the file rows", async () => {
    const frame = await renderFrame(() => (
      <Bridge
        width={32}
        items={[file("src/config/tui.ts"), file("README.md")]}
        loading={false}
        error={undefined}
      />
    ))
    expect(frame).toContain("src")
    expect(frame).toContain("README.md")
  })

  test("offline state is rendered and labeled", async () => {
    const frame = await renderFrame(() => (
      <Bridge width={32} items={[]} loading={false} error={undefined} connected={false} />
    ))
    expect(frame).toContain("offline")
    expect(frame).not.toContain("No files")
  })

  test("denied state is rendered and labeled", async () => {
    const frame = await renderFrame(() => (
      <Bridge width={32} items={[]} loading={false} error={undefined} permitted={false} />
    ))
    expect(frame).toContain("denied")
  })

  test("failure state redacts the error message", async () => {
    const frame = await renderFrame(() => (
      <Bridge
        width={32}
        items={[]}
        loading={false}
        error={new Error("Bearer sk-live-secret-token")}
      />
    ))
    expect(frame).toContain("failed to load")
    expect(frame).not.toContain("sk-live")
    expect(frame).not.toContain("No files")
  })

  test("degraded state shows rows with a degraded banner", async () => {
    const frame = await renderFrame(() => (
      <Bridge
        width={32}
        items={[file("src/a.ts"), file("src/b.ts")]}
        loading={false}
        error={undefined}
        partial={true}
      />
    ))
    expect(frame).toContain("degraded")
    expect(frame).toContain("src")
  })

  test("long-content caps rows and offers a reveal hint", async () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`src/file-${i}.ts`))
    const frame = await renderFrame(() => (
      <Bridge width={32} items={many} loading={false} error={undefined} renderBudget={200} />
    ))
    expect(frame).toContain("more")
    expect(frame).toContain("reveal")
  })

  test("long-content reveals everything when showAll is set", async () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`src/file-${i}.ts`))
    const capped = await renderFrame(() => (
      <Bridge width={32} items={many} loading={false} error={undefined} renderBudget={200} showAll={false} />
    ))
    const revealed = await renderFrame(() => (
      <Bridge width={32} items={many} loading={false} error={undefined} renderBudget={200} showAll={true} />
    ))
    expect(capped).toContain("more")
    expect(revealed).not.toContain("more")
  })

  test("focus is marked with a text glyph on no-color terminals", async () => {
    const items = [file("src/config/tui.ts"), file("README.md")]
    const tree = buildFileTree(items)
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!

    const color = await renderFrame(() => (
      <Bridge
        width={32}
        items={items}
        loading={false}
        error={undefined}
        focused={true}
        highlightedNode={src.id}
        colorLevel={3}
      />
    ))
    const noColor = await renderFrame(() => (
      <Bridge
        width={32}
        items={items}
        loading={false}
        error={undefined}
        focused={true}
        highlightedNode={src.id}
        colorLevel={0}
      />
    ))
    // Color mode conveys focus via background; no-color mode uses a text marker.
    expect(noColor).toContain("› ")
    expect(color).not.toContain("› ")
  })

  test("narrow terminals truncate long names without dumping the full path", async () => {
    const longName = "very-long-filename-that-exceeds-the-available-width.ts"
    const frame = await renderFrame(() => (
      <Bridge width={24} items={[file(`src/${longName}`)]} loading={false} error={undefined} />
    ))
    expect(frame).not.toContain(longName)
    expect(frame).toContain("src")
  })
})
