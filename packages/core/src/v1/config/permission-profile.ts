export * as ConfigPermissionProfileV1 from "./permission-profile"

import { Schema } from "effect"
import { ConfigPermissionV1 } from "./permission"

export const BuiltIn = Schema.Literals(["read-only", "standard", "trusted"]).annotate({
  identifier: "PermissionProfileBuiltIn",
  description: "Built-in permission profile presets",
})
export type BuiltIn = Schema.Schema.Type<typeof BuiltIn>

export const Name = Schema.String.pipe(Schema.brand("PermissionProfileName")).annotate({
  identifier: "PermissionProfileName",
})
export type Name = Schema.Schema.Type<typeof Name>

export const Kind = Schema.Union([BuiltIn, Name]).annotate({ identifier: "PermissionProfileKind" })
export type Kind = Schema.Schema.Type<typeof Kind>

// A category policy is a partial permission map over a subset of the resource
// keys relevant to that category. It reuses the config permission rule shape so
// the resolver can feed it directly into Permission.fromConfig.
const CategoryPolicy = Schema.Struct({
  read: ConfigPermissionV1.Rule.pipe(Schema.optional),
  edit: ConfigPermissionV1.Rule.pipe(Schema.optional),
  write: ConfigPermissionV1.Rule.pipe(Schema.optional),
  glob: ConfigPermissionV1.Rule.pipe(Schema.optional),
  grep: ConfigPermissionV1.Rule.pipe(Schema.optional),
  list: ConfigPermissionV1.Rule.pipe(Schema.optional),
  apply_patch: ConfigPermissionV1.Rule.pipe(Schema.optional),
  bash: ConfigPermissionV1.Rule.pipe(Schema.optional),
  webfetch: Schema.optional(ConfigPermissionV1.Action),
  websearch: Schema.optional(ConfigPermissionV1.Action),
  external_directory: ConfigPermissionV1.Rule.pipe(Schema.optional),
  task: ConfigPermissionV1.Rule.pipe(Schema.optional),
  skill: ConfigPermissionV1.Rule.pipe(Schema.optional),
  lsp: ConfigPermissionV1.Rule.pipe(Schema.optional),
  todowrite: Schema.optional(ConfigPermissionV1.Action),
  question: Schema.optional(ConfigPermissionV1.Action),
  doom_loop: Schema.optional(ConfigPermissionV1.Action),
  plan_enter: Schema.optional(ConfigPermissionV1.Action),
  plan_exit: Schema.optional(ConfigPermissionV1.Action),
}).annotate({ identifier: "PermissionProfileCategoryPolicy" })
export type CategoryPolicy = Schema.Schema.Type<typeof CategoryPolicy>

export const Categories = Schema.Struct({
  files: CategoryPolicy.pipe(Schema.optional),
  commands: CategoryPolicy.pipe(Schema.optional),
  network: CategoryPolicy.pipe(Schema.optional),
  secrets: CategoryPolicy.pipe(Schema.optional),
  external: CategoryPolicy.pipe(Schema.optional),
}).annotate({ identifier: "PermissionProfileCategories" })
export type Categories = Schema.Schema.Type<typeof Categories>

// A custom profile bundles category policies plus an optional base preset it
// extends. Built-in presets are represented only by their name.
export class Custom extends Schema.Class<Custom>("PermissionProfileCustom")({
  base: BuiltIn.pipe(Schema.optional),
  categories: Categories,
}) {}

export const Profile = Schema.Union([BuiltIn, Custom]).annotate({ identifier: "PermissionProfile" })
export type Profile = Schema.Schema.Type<typeof Profile>

export const Profiles = Schema.Record(Name, Custom).annotate({
  identifier: "PermissionProfiles",
  description: "Named custom permission profiles keyed by profile name.",
})
export type Profiles = Schema.Schema.Type<typeof Profiles>

export const Active = Schema.String.pipe(Schema.optional).annotate({
  identifier: "PermissionProfileActive",
  description:
    "Name or preset of the active permission profile. Resolved into the agent permission ruleset. Defaults to 'standard' when unset.",
})
export type Active = Schema.Schema.Type<typeof Active>

export const Info = Schema.Struct({
  active: Active,
  custom: Profiles.pipe(Schema.optional),
}).annotate({ identifier: "PermissionProfileConfig" })
export type Info = Schema.Schema.Type<typeof Info>

// Flatten a category policy into a partial ConfigPermissionV1.Info object so it
// can be merged with other config permission inputs before fromConfig.
function categoriesToConfig(input: Categories): ConfigPermissionV1.Info {
  const out: Record<string, unknown> = {}
  for (const category of ["files", "commands", "network", "secrets", "external"] as const) {
    const policy = input[category]
    if (!policy) continue
    for (const [key, value] of Object.entries(policy)) {
      if (value === undefined) continue
      out[key] = value
    }
  }
  return out as ConfigPermissionV1.Info
}

export function BuiltInProfileCategories(active: string): Categories {
  switch (active) {
    case "read-only":
      return {
        files: { read: "allow", edit: "deny", write: "deny", glob: "allow", grep: "allow", list: "allow", apply_patch: "deny" },
        commands: { bash: "deny" },
        network: { webfetch: "deny", websearch: "deny" },
        secrets: { read: { "*.env": "deny", "*.env.*": "deny" } },
        external: { external_directory: "deny", task: "deny", skill: "deny", lsp: "deny", todowrite: "deny", question: "deny" },
      }
    case "trusted":
      return {
        files: { read: "allow", edit: "allow", write: "allow", glob: "allow", grep: "allow", list: "allow", apply_patch: "allow" },
        commands: { bash: "allow" },
        network: { webfetch: "allow", websearch: "allow" },
        secrets: { read: { "*.env": "allow", "*.env.*": "allow" } },
        external: { external_directory: "ask", task: "allow", skill: "allow", lsp: "allow", todowrite: "allow", question: "allow" },
      }
    case "standard":
    default:
      return {
        files: { read: "allow", edit: "ask", write: "ask", glob: "allow", grep: "allow", list: "allow", apply_patch: "ask" },
        commands: { bash: "ask" },
        network: { webfetch: "allow", websearch: "allow" },
        secrets: { read: { "*.env": "ask", "*.env.*": "ask" } },
        external: { external_directory: "ask", task: "allow", skill: "allow", lsp: "allow", todowrite: "allow", question: "deny" },
      }
  }
}

export function toConfig(input: Info): ConfigPermissionV1.Info {
  const active = input.active ?? "standard"
  const out = categoriesToConfig(BuiltInProfileCategories(active))
  if (active === "read-only" || active === "standard" || active === "trusted") return out
  const custom = input.custom?.[active]
  if (!custom) return out
  const base = custom.base ? categoriesToConfig(BuiltInProfileCategories(custom.base)) : {}
  return { ...base, ...categoriesToConfig(custom.categories) }
}
