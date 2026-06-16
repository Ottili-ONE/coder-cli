export {
  OTTILI_AUTO_MODEL_ID,
  OTTILI_AUTO_PROVIDER_ID,
  OTTILI_AUTO_ROUTER_MODEL,
  OTTILI_AUTO_TARGETS,
} from "./constants"
export {
  buildRouterPrompt,
  estimateRouterCost,
  extractLatestAssistantText,
  extractLatestUserText,
  formatRouteAnnouncement,
  isOttiliAutoModel,
  normalizeRouterModelKey,
  parseRouterJson,
  route,
  ruleBasedRoute,
  type OttiliAutoRouteDecision,
  type OttiliAutoRouteInput,
  type OttiliAutoRouteOptions,
} from "./router"
export { defaultEnvFileCandidates, bootstrapEnvFiles, loadEnvFile, loadOptionalEnvFiles, resolveOpenRouterApiKey } from "./env"
import { route, ruleBasedRoute, type OttiliAutoRouteInput, type OttiliAutoRouteOptions } from "./router"

export async function resolveExecutionTarget(input: OttiliAutoRouteInput, options?: OttiliAutoRouteOptions) {
  const decision = await route(input, options)
  return {
    providerID: decision.providerID,
    modelID: decision.modelID,
    decision,
  }
}

export function resolveExecutionTargetSync(input: OttiliAutoRouteInput) {
  const decision = ruleBasedRoute(input)
  return {
    providerID: decision.providerID,
    modelID: decision.modelID,
    decision,
  }
}
