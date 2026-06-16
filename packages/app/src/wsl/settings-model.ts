import type { WslOttiliCoderCheck, WslServerRuntime } from "./types"

export const wslRuntimeRetryable = (runtime: WslServerRuntime) =>
  runtime.kind === "failed" || runtime.kind === "stopped"

export async function enterWslOttiliCoderStep(
  distro: string,
  probe: (distro: string) => Promise<unknown>,
  select: (step: "ottili-coder") => void,
) {
  await probe(distro)
  select("ottili-coder")
}

export function wslOttiliCoderAction(check?: WslOttiliCoderCheck) {
  if (!check) return
  if (!check.resolvedPath) return "Install Ottili Coder"
  if (check.matchesDesktop === false) return "Update Ottili Coder"
}
