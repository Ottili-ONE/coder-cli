import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "../cmd/cmd"
import { CliError } from "../effect-cmd"
import { CIDebugger } from "@/ci-debugger"

const toCli = (e: unknown) =>
  new CliError({ message: e instanceof Error ? e.message : String(e) })

export const CIDebuggerDiscoverCommand = effectCmd({
  command: "discover [sha]",
  describe: "list CI checks and report the failed ones",
  builder: (yargs) =>
    yargs
      .positional("sha", { type: "string", describe: "commit SHA to inspect (default: HEAD)" })
      .option("json", { type: "boolean", describe: "emit JSON" }),
  handler: Effect.fn("Cli.ci-debugger.discover")(function* (args) {
    const report = yield* CIDebugger.debugCI({ cwd: process.cwd(), sha: args.sha }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Provider: ${report.provider}`)
    console.log(`Commit:   ${report.headSha}`)
    console.log(`Checks:   ${report.discovered.length} discovered, ${report.failed.length} failed`)
    for (const run of report.failed) {
      console.log(`  ✗ ${run.name}${run.url ? ` ${run.url}` : ""}`)
    }
  }),
})

export const CIDebuggerRootCauseCommand = effectCmd({
  command: "root-cause [sha]",
  describe: "fetch failed-check logs and identify root causes",
  builder: (yargs) =>
    yargs
      .positional("sha", { type: "string", describe: "commit SHA to inspect (default: HEAD)" })
      .option("json", { type: "boolean", describe: "emit JSON" }),
  handler: Effect.fn("Cli.ci-debugger.root-cause")(function* (args) {
    const report = yield* CIDebugger.debugCI({ cwd: process.cwd(), sha: args.sha }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify(report.rootCauses, null, 2))
      return
    }
    if (report.rootCauses.length === 0) {
      console.log("No root causes classified.")
      return
    }
    for (const cause of report.rootCauses) {
      console.log(`[${cause.category}] ${cause.summary}`)
      if (cause.detail) console.log(`    ${cause.detail.split("\n").join("\n    ")}`)
      if (cause.suggestion) console.log(`    → ${cause.suggestion}`)
    }
  }),
})

export const CIDebuggerRerunCommand = effectCmd({
  command: "rerun [sha]",
  describe: "patch (optional) and rerun only the failed checks",
  builder: (yargs) =>
    yargs
      .positional("sha", { type: "string", describe: "commit SHA to inspect (default: HEAD)" })
      .option("patch", { type: "string", describe: "path to a git patch to apply before rerunning" })
      .option("json", { type: "boolean", describe: "emit JSON" }),
  handler: Effect.fn("Cli.ci-debugger.rerun")(function* (args) {
    const report = yield* CIDebugger.debugCI({
      cwd: process.cwd(),
      sha: args.sha,
      patchPath: args.patch,
      rerun: true,
    }).pipe(Effect.mapError(toCli))
    if (args.json) {
      console.log(JSON.stringify({ reran: report.reran }, null, 2))
      return
    }
    if (report.reran.length === 0) {
      console.log("No checks were rerun.")
      return
    }
    console.log(`Reran ${report.reran.length} check(s):`)
    for (const name of report.reran) console.log(`  ↻ ${name}`)
  }),
})

export const CIDebuggerStateCommand = effectCmd({
  command: "state",
  describe: "show the last persisted CI-debugger session",
  handler: Effect.fn("Cli.ci-debugger.state")(function* () {
    const state = yield* CIDebugger.loadState(process.cwd()).pipe(Effect.mapError(toCli))
    if (!state) {
      console.log("No persisted CI-debugger session found for this directory.")
      return
    }
    console.log(`Commit:     ${state.headSha}`)
    console.log(`Updated:    ${new Date(state.updatedAt).toISOString()}`)
    console.log(`Failed:     ${state.failed.length}`)
    console.log(`RootCauses: ${state.rootCauses.length}`)
    console.log(`Reran:      ${state.reran.length ? state.reran.join(", ") : "none"}`)
  }),
})

export const CIDebuggerCommand = cmd({
  command: "ci-debugger",
  describe: "discover failed CI checks, get logs, find root cause, rerun only what failed",
  builder: (yargs) =>
    yargs
      .command(CIDebuggerDiscoverCommand)
      .command(CIDebuggerRootCauseCommand)
      .command(CIDebuggerRerunCommand)
      .command(CIDebuggerStateCommand)
      .demandCommand(),
  async handler() {},
})
