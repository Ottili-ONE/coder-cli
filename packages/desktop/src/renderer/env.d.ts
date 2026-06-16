import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OTTILI_CODER__?: {
      deepLinks?: string[]
    }
  }
}
