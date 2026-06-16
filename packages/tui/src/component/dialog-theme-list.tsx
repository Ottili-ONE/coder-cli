import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createMemo, onCleanup } from "solid-js"

const MODE_LIGHT = "__mode_light__"
const MODE_DARK = "__mode_dark__"

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
  const options = createMemo(() => [
    {
      title: theme.mode() === "light" ? "Light mode (active)" : "Switch to light mode",
      value: MODE_LIGHT,
    },
    {
      title: theme.mode() === "dark" ? "Dark mode (active)" : "Switch to dark mode",
      value: MODE_DARK,
    },
    ...themes(),
  ])
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = theme.selected
  const initialMode = theme.mode()

  onCleanup(() => {
    if (!confirmed) {
      theme.set(initial)
      theme.setMode(initialMode)
    }
  })

  const apply = (value: string) => {
    if (value === MODE_LIGHT) {
      theme.setMode("light")
      return
    }
    if (value === MODE_DARK) {
      theme.setMode("dark")
      return
    }
    theme.set(value)
  }

  return (
    <DialogSelect
      title="Themes"
      options={options()}
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
          theme.setMode(initialMode)
          return
        }

        const first = ref.filtered[0]
        if (first) apply(first.value)
      }}
    />
  )
}
