import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "../cmd/cmd"
import { CliError } from "../effect-cmd"
import { Browser } from "@/browser"

const toCli = (e: unknown) =>
  new CliError({ message: e instanceof Error ? e.message : String(e) })

const sharedOptions = <T>(yargs: Argv<T>) =>
  yargs
    .option("headless", { type: "boolean", default: true, describe: "run the browser headless (default: true)" })
    .option("browser", { type: "string", choices: ["chromium", "firefox", "webkit"], default: "chromium", describe: "browser engine" })
    .option("session", { type: "string", describe: "stable session id for idempotent reruns" })
    .option("output-dir", { type: "string", describe: "directory for screenshots/traces (default: cwd)" })
    .option("timeout", { type: "number", describe: "per-step timeout in ms" })
    .option("json", { type: "boolean", describe: "emit versioned JSON" })

export const BrowserLaunchCommand = effectCmd({
  command: "launch <target>",
  describe: "launch a browser against a URL and keep it ready for inspection",
  builder: (yargs) =>
    sharedOptions(
      yargs.positional("target", { type: "string", demandOption: true, describe: "URL to open" }),
    ),
  handler: Effect.fn("Cli.browser.launch")(function* (args) {
    const report = yield* Browser.runSession({
      cwd: process.cwd(),
      target: args.target,
      headless: args.headless,
      browser: args.browser,
      sessionId: args.session,
      outputDir: args.outputDir,
      timeoutMs: args.timeout,
      signal: AbortSignal.timeout(args.timeout ?? 300_000),
    }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Launched ${report.browser} (headless=${report.headless}) → ${report.target}`)
    console.log(`Session: ${report.sessionId}`)
    for (const a of report.artifacts) console.log(`  📸 ${a.path}`)
  }),
})

export const BrowserScreenshotCommand = effectCmd({
  command: "screenshot <target>",
  describe: "capture a screenshot of a URL with deterministic cleanup",
  builder: (yargs) =>
    sharedOptions(
      yargs.positional("target", { type: "string", demandOption: true, describe: "URL to capture" }),
    ),
  handler: Effect.fn("Cli.browser.screenshot")(function* (args) {
    const report = yield* Browser.runSession({
      cwd: process.cwd(),
      target: args.target,
      headless: args.headless,
      browser: args.browser,
      sessionId: args.session,
      outputDir: args.outputDir,
      timeoutMs: args.timeout,
      signal: AbortSignal.timeout(args.timeout ?? 300_000),
    }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Captured ${report.artifacts.length} artifact(s) for ${report.target}`)
    for (const a of report.artifacts) console.log(`  ${a.kind}: ${a.path}`)
  }),
})

export const BrowserTestCommand = effectCmd({
  command: "test <target>",
  describe: "launch, inspect and test a web app; capture console/network and clean up",
  builder: (yargs) =>
    sharedOptions(
      yargs.positional("target", { type: "string", demandOption: true, describe: "URL under test" }),
    ).option("capture-console", { type: "boolean", default: true, describe: "capture console output" })
      .option("capture-network", { type: "boolean", default: true, describe: "capture network traffic" }),
  handler: Effect.fn("Cli.browser.test")(function* (args) {
    const report = yield* Browser.runSession({
      cwd: process.cwd(),
      target: args.target,
      headless: args.headless,
      browser: args.browser,
      sessionId: args.session,
      outputDir: args.outputDir,
      timeoutMs: args.timeout,
      captureConsole: args.captureConsole,
      captureNetwork: args.captureNetwork,
      signal: AbortSignal.timeout(args.timeout ?? 300_000),
    }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Status:  ${report.status} (exit ${report.exitCode})`)
    console.log(`Console: ${report.console.length} message(s)`)
    console.log(`Network: ${report.network.length} request(s)`)
    for (const a of report.artifacts) console.log(`  ${a.kind}: ${a.path}`)
  }),
})

export const BrowserStateCommand = effectCmd({
  command: "state <session>",
  describe: "show the persisted state of a browser session",
  builder: (yargs) =>
    yargs.positional("session", { type: "string", demandOption: true, describe: "session id" })
      .option("json", { type: "boolean", describe: "emit JSON" }),
  handler: Effect.fn("Cli.browser.state")(function* (args) {
    const state = yield* Browser.loadState(process.cwd(), args.session).pipe(Effect.mapError(toCli))
    if (!state) {
      console.log(`No persisted browser session "${args.session}" found for this directory.`)
      return
    }
    if (args.json) {
      console.log(JSON.stringify(state, null, 2))
      return
    }
    console.log(`Session: ${state.sessionId}`)
    console.log(`Target:  ${state.target}`)
    console.log(`Status:  ${state.status}`)
    console.log(`Console: ${state.console.length}, Network: ${state.network.length}, Artifacts: ${state.artifacts.length}`)
  }),
})

export const BrowserCommand = cmd({
  command: "browser",
  describe: "launch, inspect and test web apps with screenshots, console/network capture and cleanup",
  builder: (yargs) =>
    yargs
      .command(BrowserLaunchCommand)
      .command(BrowserScreenshotCommand)
      .command(BrowserTestCommand)
      .command(BrowserStateCommand)
      .demandCommand(),
  async handler() {},
})
