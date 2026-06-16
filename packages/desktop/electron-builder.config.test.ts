import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/ottili-coder-desktop.desktop"

const channels = [
  { channel: "dev", appId: "ai.ottiliCoder.desktop.dev" },
  { channel: "beta", appId: "ai.ottiliCoder.desktop.beta" },
  { channel: "prod", appId: "ai.ottiliCoder.desktop" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OTTILI_CODER_CHANNEL
    process.env.OTTILI_CODER_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OTTILI_CODER_CHANNEL
    else process.env.OTTILI_CODER_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
  })
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OTTILI_CODER_CHANNEL
  process.env.OTTILI_CODER_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OTTILI_CODER_CHANNEL
  else process.env.OTTILI_CODER_CHANNEL = previous

  expect(config.deb?.fpm?.[0]).toEndWith(`${legacyDesktopEntry}=/usr/share/applications/ottili-coder-desktop.desktop`)
  expect(config.rpm?.fpm?.[0]).toEndWith(`${legacyDesktopEntry}=/usr/share/applications/ottili-coder-desktop.desktop`)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/Ottili Coder/ai.ottiliCoder.desktop %U")
  expect(desktop).toContain("Icon=ai.ottiliCoder.desktop")
  expect(desktop).toContain("StartupWMClass=ai.ottiliCoder.desktop")
  expect(desktop).toContain("NoDisplay=true")
})
