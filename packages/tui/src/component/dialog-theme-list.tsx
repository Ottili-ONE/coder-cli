import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createMemo, onCleanup } from "solid-js"

export function DialogThemeList() {
  const theme = useTheme()
  const dialog = useDialog()
  const themes = createMemo(() =>
    Object.keys(theme.all())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({
        title: value,
        value,
      })),
  )
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = theme.selected

  onCleanup(() => {
    if (!confirmed) theme.set(initial)
  })

  const apply = (value: string) => {
    theme.set(value)
  }

  return (
    <DialogSelect
      title="Themes"
      options={themes()}
      current={initial}
      onMove={(opt) => {
        apply(opt.value)
      }}
      onSelect={(opt) => {
        apply(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          theme.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) apply(first.value)
      }}
    />
  )
}
