import { DeployAdapter, DeployError, DeployKind, DeployResult, type DeployRequest } from "./adapter"
import { Process } from "@/util/process"

/**
 * Local deployment target.
 *
 * Builds and runs the project command in-place on the local machine. This is
 * the reference adapter: it exercises the same typed-error and retry contract
 * as every other adapter without requiring remote credentials.
 */

const withRetry = async <T>(
  retries: number,
  run: () => Promise<T>,
  isRetryable: (e: unknown) => boolean,
): Promise<T> => {
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await run()
    } catch (e) {
      last = e
      if (attempt >= retries || !isRetryable(e)) throw e
    }
  }
  throw last
}

const retryableStatus = (code: number) => code === 0 || code === 124

export class LocalAdapter implements DeployAdapter {
  readonly kind: DeployKind = "local"
  private name = ""

  async resolve(name: string): Promise<void> {
    if (!name) throw new DeployError({ kind: "invalid-config", message: "Local target requires a non-empty name" })
    this.name = name
  }

  async deploy(req: DeployRequest): Promise<DeployResult> {
    if (!req.command) {
      throw new DeployError({
        kind: "invalid-config",
        message: "Local target requires a `command` to run the deployment",
      })
    }
    const deploymentId = `local-${this.name}-${Date.now()}`
    const retries = req.retries ?? 0
    try {
      const result = await withRetry(
        retries,
        () =>
          Process.run(["sh", "-c", req.command as string], {
            cwd: req.cwd,
            env: req.env ? { ...process.env, ...req.env } : undefined,
            nothrow: true,
            abort: req.signal,
            timeout: 600_000,
          }),
        (e) => e instanceof DeployError && e.kind !== "invalid-config",
      )
      if (req.signal?.aborted) {
        throw new DeployError({ kind: "cancelled", message: "Local deployment was cancelled" })
      }
      if (result.code !== 0) {
        throw new DeployError({
          kind: "deploy-failed",
          message: `Local command exited with code ${result.code}`,
          cause: result.stderr.toString("utf8"),
        })
      }
      return new DeployResult({
        target: this.name,
        kind: this.kind,
        status: "live",
        deploymentId,
        message: "Local deployment finished",
        logs: result.stdout.toString("utf8"),
      })
    } catch (e) {
      if (e instanceof DeployError) throw e
      throw new DeployError({ kind: "deploy-failed", message: String(e), cause: e })
    }
  }

  async status(deploymentId: string): Promise<DeployResult> {
    return new DeployResult({
      target: this.name,
      kind: this.kind,
      status: "live",
      deploymentId,
      message: "Local deployments are process-scoped; no remote status is tracked",
    })
  }

  async logs(deploymentId: string): Promise<string> {
    throw new DeployError({
      kind: "not-found",
      message: `Local deployment ${deploymentId} does not retain logs after the process exits`,
    })
  }

  async cancel(deploymentId: string): Promise<void> {
    throw new DeployError({
      kind: "not-found",
      message: `Local deployment ${deploymentId} is not tracked for cancellation`,
    })
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    throw new DeployError({
      kind: "rollback-failed",
      message: `Local target ${this.name} does not support rollback`,
    })
  }
}

void retryableStatus
