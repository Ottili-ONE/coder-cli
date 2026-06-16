import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { URL } from "node:url"

export type OAuthCallbackResult = {
  code: string
  state: string
}

type Pending = {
  resolve: (value: OAuthCallbackResult) => void
  reject: (error: Error) => void
}

const successPage = `<!DOCTYPE html>
<html lang="de">
  <head><meta charset="utf-8"><title>Ottili Coder</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.5;">
    <h1>Anmeldung erfolgreich</h1>
    <p>Du kannst dieses Fenster schließen und zum Terminal zurückkehren.</p>
  </body>
</html>`

const failurePage = (message: string) => `<!DOCTYPE html>
<html lang="de">
  <head><meta charset="utf-8"><title>Ottili Coder</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.5;">
    <h1>Anmeldung fehlgeschlagen</h1>
    <p>${message}</p>
  </body>
</html>`

export class OAuthCallbackServer {
  private server?: Server
  private pending?: Pending
  private timeout?: ReturnType<typeof setTimeout>

  constructor(
    private readonly options: {
      host?: string
      port: number
      path?: string
      timeoutMs?: number
    },
  ) {}

  async start(): Promise<string> {
    const host = this.options.host ?? "127.0.0.1"
    const path = this.options.path ?? "/callback"

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400)
        res.end(failurePage("Ungültige Anfrage."))
        return
      }

      const url = new URL(req.url, `http://${host}:${this.options.port}`)
      if (url.pathname !== path) {
        res.writeHead(404)
        res.end()
        return
      }

      const error = url.searchParams.get("error")
      const description = url.searchParams.get("error_description")
      if (error) {
        this.fail(new Error(description ?? error))
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(failurePage(description ?? error))
        return
      }

      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      if (!code || !state) {
        this.fail(new Error("OAuth callback missing code or state"))
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(failurePage("Fehlende OAuth-Parameter."))
        return
      }

      this.pending?.resolve({ code, state })
      this.pending = undefined
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(successPage)
      this.cleanup()
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject)
      this.server!.listen(this.options.port, host, () => resolve())
    })

    const address = this.server!.address()
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve OAuth callback server address")
    }

    return `http://${host}:${address.port}${path}`
  }

  waitForCallback(): Promise<OAuthCallbackResult> {
    const timeoutMs = this.options.timeoutMs ?? 120_000
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }
      this.timeout = setTimeout(() => {
        this.fail(new Error("OAuth callback timeout"))
      }, timeoutMs)
    })
  }

  private fail(error: Error) {
    this.pending?.reject(error)
    this.pending = undefined
    this.cleanup()
  }

  private cleanup() {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = undefined
    }
    setTimeout(() => {
      void this.close()
    }, 100)
  }

  async close() {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = undefined
    }
    if (!this.server) return
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve())
    })
    this.server = undefined
  }
}
