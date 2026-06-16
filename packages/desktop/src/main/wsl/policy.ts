import type { WslDistroProbe, WslOttiliCoderCheck, WslServerItem } from "../../preload/types"

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  ottiliCoderChecks: Record<string, WslOttiliCoderCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextOttiliCoderChecks = { ...ottiliCoderChecks }
  delete nextDistroProbes[distro]
  delete nextOttiliCoderChecks[distro]
  return { distroProbes: nextDistroProbes, ottiliCoderChecks: nextOttiliCoderChecks }
}

export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl", ...(distro ? ["-d", distro] : [])]
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}
