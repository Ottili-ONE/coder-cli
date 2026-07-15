import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["OTTILI_CODER_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["OTTILI_CODER_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("OTTILI_CODER_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OTTILI_CODER_AUTO_HEAP_SNAPSHOT: truthy("OTTILI_CODER_AUTO_HEAP_SNAPSHOT"),
  OTTILI_CODER_GIT_BASH_PATH: process.env["OTTILI_CODER_GIT_BASH_PATH"],
  OTTILI_CODER_CONFIG: process.env["OTTILI_CODER_CONFIG"],
  OTTILI_CODER_CONFIG_CONTENT: process.env["OTTILI_CODER_CONFIG_CONTENT"],
  OTTILI_CODER_DISABLE_AUTOUPDATE: truthy("OTTILI_CODER_DISABLE_AUTOUPDATE"),
  OTTILI_CODER_ALWAYS_NOTIFY_UPDATE: truthy("OTTILI_CODER_ALWAYS_NOTIFY_UPDATE"),
  OTTILI_CODER_DISABLE_PRUNE: truthy("OTTILI_CODER_DISABLE_PRUNE"),
  OTTILI_CODER_DISABLE_TERMINAL_TITLE: truthy("OTTILI_CODER_DISABLE_TERMINAL_TITLE"),
  OTTILI_CODER_SHOW_TTFD: truthy("OTTILI_CODER_SHOW_TTFD"),
  OTTILI_CODER_DISABLE_AUTOCOMPACT: truthy("OTTILI_CODER_DISABLE_AUTOCOMPACT"),
  OTTILI_CODER_DISABLE_MODELS_FETCH: truthy("OTTILI_CODER_DISABLE_MODELS_FETCH"),
  OTTILI_CODER_DISABLE_MOUSE: truthy("OTTILI_CODER_DISABLE_MOUSE"),
  OTTILI_CODER_FAKE_VCS: process.env["OTTILI_CODER_FAKE_VCS"],
  OTTILI_CODER_SERVER_PASSWORD: process.env["OTTILI_CODER_SERVER_PASSWORD"],
  OTTILI_CODER_SERVER_USERNAME: process.env["OTTILI_CODER_SERVER_USERNAME"],
  OTTILI_CODER_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OTTILI_CODER_DISABLE_FFF"),

  // Experimental
  OTTILI_CODER_EXPERIMENTAL_FILEWATCHER: Config.boolean("OTTILI_CODER_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OTTILI_CODER_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OTTILI_CODER_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OTTILI_CODER_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OTTILI_CODER_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OTTILI_CODER_MODELS_URL: process.env["OTTILI_CODER_MODELS_URL"],
  OTTILI_CODER_MODELS_PATH: process.env["OTTILI_CODER_MODELS_PATH"],
  OTTILI_CODER_DB: process.env["OTTILI_CODER_DB"],

  OTTILI_CODER_WORKSPACE_ID: process.env["OTTILI_CODER_WORKSPACE_ID"],
  OTTILI_CODER_EXPERIMENTAL_WORKSPACES: enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_WORKSPACES"),

  // Checkpoint timeline (T-CLI-0166): surface Cairn checkpoint state as a
  // user-navigable timeline. Off until staged validation passes.
  get OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE() {
    return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE")
  },

  // Background jobs view (T-CLI-0173): unified local + cloud background jobs
  // surface. The redesigned cloud surface is always active; local
  // process-local background jobs are merged in only when this is enabled.
  get OTTILI_CODER_EXPERIMENTAL_BACKGROUND_JOBS() {
    return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_BACKGROUND_JOBS")
  },

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OTTILI_CODER_DISABLE_PROJECT_CONFIG() {
    return truthy("OTTILI_CODER_DISABLE_PROJECT_CONFIG")
  },
  get OTTILI_CODER_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OTTILI_CODER_EXPERIMENTAL_REFERENCES")
  },
  get OTTILI_CODER_TUI_CONFIG() {
    return process.env["OTTILI_CODER_TUI_CONFIG"]
  },
  get OTTILI_CODER_CONFIG_DIR() {
    return process.env["OTTILI_CODER_CONFIG_DIR"]
  },
  get OTTILI_CODER_PURE() {
    return truthy("OTTILI_CODER_PURE")
  },
  get OTTILI_CODER_PERMISSION() {
    return process.env["OTTILI_CODER_PERMISSION"]
  },
  get OTTILI_CODER_PLUGIN_META_FILE() {
    return process.env["OTTILI_CODER_PLUGIN_META_FILE"]
  },
  get OTTILI_CODER_CLIENT() {
    return process.env["OTTILI_CODER_CLIENT"] ?? "cli"
  },
}
