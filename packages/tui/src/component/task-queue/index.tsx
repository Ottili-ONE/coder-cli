/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import {
  type Task,
  type TaskQueueState,
  type FilterMode,
  type GroupBy,
  type TaskQueueAction,
  STATUS_ICON,
  PRIORITY_LABEL,
  buildState,
  visibleTaskIds,
  groupTasks,
  effectiveSelection,
  moveSelection,
  nextFilter,
  nextGroupBy,
  dependenciesMet,
  truncate,
} from "./model"

export interface TaskQueueProps {
  tasks: Accessor<Task[]>
  onAction?: (action: TaskQueueAction) => void
}

function buildBar(progress: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((progress / 100) * width)))
  return "[" + "=".repeat(filled) + "-".repeat(width - filled) + "]"
}

function lastStreamLine(stream: string): string {
  if (!stream) return ""
  const lines = stream.split("\n")
  return lines[lines.length - 1]
}

function rowLine(task: Task, tasks: Record<string, Task>, selected: boolean, width: number): string {
  const prefix = selected ? "> " : "  "
  const icon = STATUS_ICON[task.status]
  const narrow = width < 60
  const progressPart = narrow ? `${task.progress}%` : `${buildBar(task.progress)} ${task.progress}%`
  const metaParts: string[] = [PRIORITY_LABEL[task.priority], progressPart]
  if (task.attempts > 0) metaParts.push(`retry ${task.attempts}/${task.maxAttempts}`)
  const unmet = task.dependencies.filter((dep) => tasks[dep]?.status !== "completed")
  if (unmet.length > 0) metaParts.push(`needs:${unmet.join(",")}`)

  const meta = metaParts.join("  ")
  const overhead = prefix.length + 2 + 2 + meta.length
  const titleWidth = Math.max(6, width - overhead)
  const title = truncate(task.title, titleWidth).padEnd(titleWidth)
  return `${prefix}${icon} ${title}  ${meta}`
}

function groupHeader(key: string, count: number): string {
  return `▸ ${key} (${count})`
}

function streamLine(stream: string, width: number): string {
  return `    › ${truncate(lastStreamLine(stream), Math.max(4, width - 6))}`
}

function errorLine(error: string, width: number): string {
  return `    ⚠ ${truncate(error, Math.max(4, width - 6))}`
}

export function TaskQueue(props: TaskQueueProps) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<FilterMode>("all")
  const [groupBy, setGroupBy] = createSignal<GroupBy>("group")
  const dims = useTerminalDimensions()

  const state = createMemo<TaskQueueState>(() =>
    buildState(props.tasks(), {
      selectedId: selectedId(),
      filter: filter(),
      groupBy: groupBy(),
    }),
  )

  const visible = createMemo(() => visibleTaskIds(state()))
  const groups = createMemo(() => groupTasks(visible(), state()))
  const selected = createMemo(() => effectiveSelection(state()))
  const width = () => dims().width

  useKeyboard((event) => {
    switch (event.name) {
      case "up":
        setSelectedId(moveSelection(state(), -1))
        break
      case "down":
        setSelectedId(moveSelection(state(), 1))
        break
      case "f":
        setFilter(nextFilter(filter()))
        break
      case "g":
        setGroupBy(nextGroupBy(groupBy()))
        break
      case "r": {
        const id = selected()
        if (!id) break
        const task = state().tasks[id]
        const rejected = task.attempts >= task.maxAttempts
        const attempts = rejected ? task.attempts : task.attempts + 1
        props.onAction?.({ type: "retry", id, rejected, attempts })
        break
      }
      case "c": {
        const id = selected()
        if (id) props.onAction?.({ type: "cancel", id })
        break
      }
      case "return":
      case "enter": {
        const id = selected()
        if (id) props.onAction?.({ type: "select", id })
        break
      }
    }
  })

  const counts = createMemo(() => {
    const tasks = state().tasks
    const all = Object.values(tasks)
    return {
      total: all.length,
      active: all.filter((t) => t.status === "queued" || t.status === "running" || t.status === "retrying").length,
      failed: all.filter((t) => t.status === "failed").length,
      blocked: all.filter((t) => !dependenciesMet(t, tasks) && t.status !== "completed").length,
    }
  })

  return (
    <box flexDirection="column" width={width()}>
      <box flexDirection="column">
        <text id="task-queue-header">
          {`Task Queue — ${counts().total} tasks · ${counts().active} active · ${counts().failed} failed · ${counts().blocked} blocked`}
        </text>
        <text id="task-queue-filter">{`filter: ${filter()}   group: ${groupBy()}`}</text>
      </box>
      <box flexDirection="column">
        <For each={groups()}>
          {(group) => (
            <box flexDirection="column">
              <text id={`group-${group.key}`}>{groupHeader(group.key, group.items.length)}</text>
              <For each={group.items}>
                {(id) => {
                  const task = () => state().tasks[id]
                  const isSelected = () => selected() === id
                  return (
                    <box flexDirection="column">
                      <text id={`task-row-${id}`}>{rowLine(task(), state().tasks, isSelected(), width())}</text>
                      <Show when={(task().status === "running" || task().status === "retrying") && task().stream.length > 0}>
                        <text id={`task-stream-${id}`}>{streamLine(task().stream, width())}</text>
                      </Show>
                      <Show when={task().error}>
                        <text id={`task-error-${id}`}>{errorLine(task().error as string, width())}</text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </box>
          )}
        </For>
      </box>
      <text id="task-queue-footer">
        {"↑/↓ navigate · f filter · g group · r retry · c cancel · ⏎ focus"}
      </text>
    </box>
  )
}
