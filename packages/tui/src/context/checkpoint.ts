import { createMemo, createResource, createSignal, type Accessor } from "solid-js"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { useClipboard } from "./clipboard"
import {
  classifyCheckpointError,
  parseCheckpointTimeline,
  redactText,
  type CheckpointTimelineContext,
  type CheckpointTimelineRaw,
  type CheckpointTimelineState,
} from "../component/checkpoint-timeline/model"

const CAIRN_DIR = "cairn"
const FILES = ["CHECKPOINT.md", "DECISIONS.md", "VALIDATION_LOG.md", "KNOWN_PROBLEMS.md"] as const

/**
 * Read the raw cairn files for a session from the local state directory.
 * ENOENT-style misses are treated as "no checkpoint yet" (not an error); only
 * genuine read failures surface as a classified error so the timeline can show
 * denied / offline / failure states instead of crashing.
 */
async function readCairnFiles(sessionID: string): Promise<CheckpointTimelineRaw> {
  const base = path.join(Global.Path.state, CAIRN_DIR, sessionID)
  const readOne = async (file: string): Promise<string | undefined> => {
    try {
      return await Bun.file(path.join(base, file)).text()
    } catch (error) {
      const message = String(error)
      if (/ENOENT|Could not open|No such file|does not exist/i.test(message)) return undefined
      throw error
    }
  }
  const [checkpoint, decisions, validations, knownProblems] = await Promise.all(
    FILES.map((file) => readOne(file)),
  )
  return { checkpoint, decisions, validations, knownProblems }
}

export interface CheckpointTimelineController {
  state: Accessor<CheckpointTimelineState>
  copyResume: () => void
}

/**
 * Lazy, session-keyed accessor for the checkpoint timeline. Reads the local cairn
 * files (the CLI runs in the same process as the state store), keeps the last
 * known data across refreshes so a failed re-fetch degrades to "stale" rather
 * than blanking, and exposes a clipboard copy of the current resume point.
 */
export function useCheckpointTimeline(sessionID: string): CheckpointTimelineController {
  const clipboard = useClipboard()

  const [last, setLast] = createSignal<CheckpointTimelineRaw | undefined>(undefined)
  const [degraded, setDegraded] = createSignal(false)

  const [resource] = createResource(
    () => sessionID,
    async (id) => {
      const raw = await readCairnFiles(id)
      setLast(raw)
      setDegraded(false)
      return raw
    },
  )

  const errorStatus = createMemo<CheckpointTimelineContext["error"]>(() => {
    if (!resource.error) return undefined
    const status = classifyCheckpointError(String(resource.error))
    return status === "offline" || status === "denied" ? undefined : String(resource.error)
  })

  const ctx = createMemo<CheckpointTimelineContext>(() => {
    const status = resource.error ? classifyCheckpointError(String(resource.error)) : undefined
    return {
      loading: resource.loading,
      error: errorStatus(),
      offline: status === "offline",
      denied: status === "denied",
      ...(degraded() ? { degraded: true } : {}),
    }
  })

  const state = createMemo(() =>
    parseCheckpointTimeline(
      last() ?? { checkpoint: undefined, decisions: undefined, validations: undefined, knownProblems: undefined },
      ctx(),
      {},
    ),
  )

  const copyResume = () => {
    const next = state().resume
    if (!next || !clipboard.write) return
    void clipboard.write(redactText(next)).then(
      () => {},
      () => {},
    )
  }

  return { state, copyResume }
}
