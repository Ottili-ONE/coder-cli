import { Schema } from "effect"

/**
 * Deployment adapter runtime.
 *
 * A common adapter API supports local, SSH, Docker, Kubernetes, Ottili Cloud
 * and custom deployment targets. Each adapter implements {@link DeployAdapter}
 * and turns typed {@link DeployError}s into actionable messages without ever
 * touching Git or project state. State survives process boundaries via a
 * JSON journal under the project cache directory so an interrupted deploy can
 * be resumed, inspected, cancelled or rolled back in a later process.
 */

export type DeployKind = "local" | "ssh" | "docker" | "kubernetes" | "ottili-cloud" | "custom"

export const DeployKind = Schema.Literals(
  "local",
  "ssh",
  "docker",
  "kubernetes",
  "ottili-cloud",
  "custom",
) as Schema.Schema<DeployKind>

export type DeployStatus =
  | "pending"
  | "building"
  | "uploading"
  | "deploying"
  | "live"
  | "failed"
  | "cancelled"
  | "rolling-back"

export const DeployStatus = Schema.Literals(
  "pending",
  "building",
  "uploading",
  "deploying",
  "live",
  "failed",
  "cancelled",
  "rolling-back",
) as Schema.Schema<DeployStatus>

export class DeployError extends Schema.TaggedErrorClass<DeployError>()("DeployError", {
  kind: Schema.Literals([
    "unknown-target",
    "invalid-config",
    "tool-missing",
    "auth-failed",
    "build-failed",
    "upload-failed",
    "deploy-failed",
    "timeout",
    "cancelled",
    "not-found",
    "permission-denied",
    "rollback-failed",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class DeployResult extends Schema.Class<DeployResult>("Deploy.DeployResult")({
  target: Schema.String,
  kind: DeployKind,
  status: DeployStatus,
  deploymentId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.String),
}) {}

export interface DeployRequest {
  /** Human label for the target (e.g. "staging", "prod-eu"). */
  readonly name: string
  /** Directory containing the project being deployed. */
  readonly cwd: string
  /** Build/start command to run before (or as) the deploy. */
  readonly command?: string
  /** Optional artifact or image reference produced by the build step. */
  readonly artifact?: string
  /** Environment variables to expose to the target runtime. */
  readonly env?: Record<string, string>
  /** Abort signal for deliberate cancellation / retry interruption. */
  readonly signal?: AbortSignal
  /** Number of automatic retries for transient failures. */
  readonly retries?: number
}

export interface DeployAdapter {
  readonly kind: DeployKind
  /** Resolve and validate the adapter configuration for a named target. */
  resolve(name: string): Promise<void>
  /** Run the deployment, returning the final result. */
  deploy(req: DeployRequest): Promise<DeployResult>
  /** Query status of a previously started deployment. */
  status(deploymentId: string): Promise<DeployResult>
  /** Fetch recent logs for a deployment. */
  logs(deploymentId: string): Promise<string>
  /** Deliberately cancel an in-flight deployment. */
  cancel(deploymentId: string): Promise<void>
  /** Roll back a live deployment to its previous revision. */
  rollback(deploymentId: string): Promise<DeployResult>
}
