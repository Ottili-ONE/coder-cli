import { Component, createMemo, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"
const sizeClass = "absolute top-0.5 right-0.5 px-1 py-0.5 bg-black/50 rounded text-[10px] text-white/70 leading-none"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function estimateDataUrlBytes(url: string): number {
  const comma = url.indexOf(",")
  if (comma === -1) return 0
  const base64 = url.slice(comma + 1)
  return Math.round((base64.length * 3) / 4)
}

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3" role="list" aria-label="Attached files">
        <For each={props.attachments}>
          {(attachment) => {
            const size = createMemo(() => estimateDataUrlBytes(attachment.dataUrl))
            return (
              <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
                <div class="relative group" role="listitem" aria-label={`${attachment.filename}, ${formatFileSize(size())}`}>
                  <Show
                    when={attachment.mime.startsWith("image/")}
                    fallback={
                      <div class={fallbackClass}>
                        <Icon name="folder" class="size-6 text-text-weak" />
                      </div>
                    }
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      class={imageClass}
                      onClick={() => props.onOpen(attachment)}
                    />
                  </Show>
                  <Show when={size() > 0}>
                    <span class={sizeClass}>{formatFileSize(size())}</span>
                  </Show>
                  <button
                    type="button"
                    onClick={() => props.onRemove(attachment.id)}
                    class={removeClass}
                    aria-label={props.removeLabel}
                  >
                    <Icon name="close" class="size-3 text-text-weak" />
                  </button>
                  <div class={nameClass}>
                    <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                  </div>
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
