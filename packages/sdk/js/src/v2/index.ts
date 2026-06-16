export * from "./client.js"
export * from "./server.js"

import { createOttiliCoderClient } from "./client.js"
import { createOttiliCoderServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createOttiliCoder(options?: ServerOptions) {
  const server = await createOttiliCoderServer({
    ...options,
  })

  const client = createOttiliCoderClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
