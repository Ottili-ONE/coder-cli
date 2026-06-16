interface ImportMetaEnv {
  readonly OTTILI_CODER_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:ottili-coder-server" {
  export namespace Server {
    export const listen: typeof import("../../../ottili-coder/dist/types/src/node").Server.listen
    export type Listener = import("../../../ottili-coder/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../ottili-coder/dist/types/src/node").Config.get
    export type Info = import("../../../ottili-coder/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../ottili-coder/dist/types/src/node").bootstrap
}
