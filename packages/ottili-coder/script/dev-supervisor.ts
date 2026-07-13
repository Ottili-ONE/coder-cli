#!/usr/bin/env bun
import os from "node:os"

// `bun run dev` intermittently aborts on startup with SIGABRT. This is a
// nondeterministic Bun 1.3.x native-runtime crash confirmed via gdb (abort()
// fires from a fixed address inside Bun's own stripped text segment, on a
// background worker thread) — it reproduces with useThread on or off, with
// or without any terminal replying to opentui's startup capability queries,
// and with the latest bun.sh/install build, so it cannot be worked around at
// the application level. See .agents/runtime/2026-07-13_sigabrt-fix/KNOWN_PROBLEMS.md
// for the full investigation.
//
// Crash probability scales with how much the native renderer has to paint on
// its first frame (user-observed: starting at a tall terminal size fails
// almost every time; starting at a short one and growing it after startup is
// reliable). This supervisor automates that: it shrinks the terminal to a
// few rows before each launch, restores the real size shortly after, and — as
// a safety net for whatever fraction still aborts — restarts on SIGABRT.

const MAX_ATTEMPTS = 15
const STARTUP_ROWS = 10
const STARTUP_SETTLE_MS = 2500
const args = process.argv.slice(2)
const entry = new URL("../src/index.ts", import.meta.url).pathname
const cwd = new URL("..", import.meta.url).pathname

const originalCols = process.stdout.columns
const originalRows = process.stdout.rows
const canResize = process.stdout.isTTY && originalCols !== undefined && originalRows !== undefined && originalRows > STARTUP_ROWS

function resizeTerminal(cols: number, rows: number) {
  if (!canResize) return
  try {
    Bun.spawnSync({ cmd: ["stty", "cols", String(cols), "rows", String(rows)], stdio: ["inherit", "ignore", "ignore"] })
  } catch {
    // stty unavailable or the tty went away — startup-size mitigation is best-effort,
    // the SIGABRT retry loop below still covers this case.
  }
}

let current: ReturnType<typeof Bun.spawn> | undefined

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (originalCols !== undefined && originalRows !== undefined) resizeTerminal(originalCols, originalRows)
    current?.kill(signal)
  })
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  if (originalCols !== undefined) resizeTerminal(originalCols, STARTUP_ROWS)

  current = Bun.spawn({
    cmd: [process.execPath, "run", "--conditions=browser", entry, ...args],
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  })

  const growTimer =
    canResize && originalCols !== undefined && originalRows !== undefined
      ? setTimeout(() => resizeTerminal(originalCols, originalRows), STARTUP_SETTLE_MS)
      : undefined
  growTimer?.unref()

  const exitCode = await current.exited
  const signal = current.signalCode

  if (growTimer) clearTimeout(growTimer)
  if (originalCols !== undefined && originalRows !== undefined) resizeTerminal(originalCols, originalRows)

  if (signal !== "SIGABRT") {
    const signalExitCode = signal ? 128 + (os.constants.signals[signal as keyof typeof os.constants.signals] ?? 0) : undefined
    process.exit(signalExitCode ?? exitCode ?? 0)
  }

  if (attempt === MAX_ATTEMPTS) {
    process.stderr.write(
      `\nottili-coder: startup aborted (SIGABRT) ${MAX_ATTEMPTS} times in a row — giving up.\n` +
        "This is a known nondeterministic Bun native-runtime crash, not an application bug.\n",
    )
    process.exit(134)
  }

  process.stderr.write(
    `ottili-coder: startup hit a known Bun native-runtime SIGABRT (attempt ${attempt}/${MAX_ATTEMPTS}) — restarting...\n`,
  )
}
