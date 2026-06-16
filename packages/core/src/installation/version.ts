declare global {
  const OTTILI_CODER_VERSION: string
  const OTTILI_CODER_CHANNEL: string
}

export const InstallationVersion = typeof OTTILI_CODER_VERSION === "string" ? OTTILI_CODER_VERSION : "local"
export const InstallationChannel = typeof OTTILI_CODER_CHANNEL === "string" ? OTTILI_CODER_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
