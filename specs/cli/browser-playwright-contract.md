# T-CLI-0441 — Browser and Playwright Tools: Contract & Command Design

Status: implemented (feature flag `EVOLUTION_T_CLI_0441_FEATURE_BROWSER_AND_PLAYWRIGHT_TOOLS_ENABLED`, default off)
Layer: coder-cli
Scope: `packages/ottili-coder`, `packages/sdk/js`, `packages/sdk/python`

## Objective

Define the real command / config / event contract for the **Browser and Playwright
tools** so the CLI can launch, inspect and test web apps with screenshots,
console/network capture and deterministic cleanup. Interactive (TUI) and headless
(`--json`) use share one command surface.

## Design decisions

- Reuse the established `ci-debugger` / local-server contract shape: a core Effect
  service owns schemas + durable state; the CLI command and both SDKs are thin
  clients over `--json` output. No new process model.
- The browser engine is the built-in Playwright MCP server (`ConfigBuiltinMcp` /
  `ConfigBrowser`), kept enabled by default unless `OTTILI_CODER_DISABLE_PLAYWRIGHT=1`.
- Interactive and headless modes share flags; `--json` switches output to the
  versioned event/report schema.

## Commands (top-level `browser`)

| Subcommand        | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `launch <url>`    | launch the browser against a URL, ready for inspection        |
| `screenshot <url>`| capture a screenshot with deterministic cleanup                |
| `test <url>`      | launch + inspect + test: console/network capture + cleanup    |
| `state <session>` | show persisted state for a session id                          |

### Flags (shared)

- `--headless` (default `true`); `--no-headless` for interactive.
- `--browser <chromium|firefox|webkit>` (default `chromium`).
- `--session <id>` — stable id for **idempotent** reruns / recovery.
- `--output-dir <dir>` — artifact destination (default cwd).
- `--timeout <ms>` — per-step timeout (default 300000).
- `--capture-console` / `--capture-network` (default on; `--no-*` to disable).
- `--json` — emit versioned JSON.

## Config boundary (`src/config/browser.ts`)

Additive, non-schema config (no change to public `ConfigV1.Info`):

- `OTTILI_CODER_DISABLE_PLAYWRIGHT` — disable the built-in Playwright MCP.
- `OTTILI_CODER_BROWSER` — default engine (`chromium`|`firefox`|`webkit`).
- `OTTILI_CODER_BROWSER_HEADLESS` — `0` to default to headed.
- `OTTILI_CODER_BROWSER_TIMEOUT_MS` — default step timeout.

## Events & schema (versioned)

`BrowserEvent` carries `schemaVersion: "1.0"` plus `sessionId`, monotonic `seq`,
`type` (`launched|console|network|screenshot|navigation|assertion|cleanup|error|done`),
and optional `console`/`network`/`artifacts`/`exitCode` payloads. `BrowserReport`
is the terminal, versioned object emitted by `--json` and returned by the SDKs.

Schemas: `ConsoleMessage`, `NetworkEntry`, `Artifact`, `BrowserSession`,
`BrowserEvent`, `BrowserReport`, `BrowserError` (tagged, with `aborted`,
`launch-failed`, `screenshot-failed`, `cleanup-failed`, `invalid-target`, …).

## Permissions, cancellation, idempotency, recovery

- **Permissions**: inherits file/command permission model; launching a browser is a
  local, non-destructive operation. Screenshots/artifacts are written only under
  `--output-dir` (default cwd).
- **Cancellation**: every step threads an `AbortSignal` (`AbortSignal.timeout`).
  Aborting yields `BrowserError{kind:"aborted"}` and a `cancelled` report; the
  `finally` in `src/index.ts` kills hung subprocesses.
- **Idempotency**: `sessionId` reuses prior state. Re-running reloads persisted
  state and replays only missing work. Conflicting reuse (different target/mode)
  fails fast with `invalid-target` rather than corrupting prior state.
- **Recovery**: state is persisted to `Global.Path.cache/browser/<sessionId>.json`
  after each step; `browser state <session>` inspects it; a later process resumes.
- **Cleanup**: deterministic teardown via `playwright test clear-cache` runs before
  the report is finalized; failure there is surfaced as `cleanup-failed` (no silent
  leak).

## Exit codes

- `0` — session completed (even when page console has errors, by default).
- `1` — contract/usage error (bad target, conflicting reuse, launch/screenshot/
  cleanup failure, abort).
- Propagated non-zero from underlying tooling on unexpected defects.

## SDK surface

- JS (`packages/sdk/js/src/browser.ts`): `launch`, `screenshot`, `test`,
  `showState` returning `BrowserReport`.
- Python (`packages/sdk/python/.../browser.py`): `launch`, `screenshot`, `test`,
  `show_state` returning `BrowserReport` dataclasses.

## Migration notes

- No pre-existing `browser` subcommand — no conflict to migrate.
- Does not alter the `playwright` MCP config shape; `ConfigBrowser` is additive.
