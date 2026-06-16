import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OTTILI_CODER_CHANNEL ?? "dev"}`

await $`cd ../ottili-coder && bun script/build-node.ts`
