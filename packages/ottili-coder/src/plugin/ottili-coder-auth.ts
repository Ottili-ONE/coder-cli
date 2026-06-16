import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { loginOttiliOneViaBrowser } from "@/account/ottili-one"
import { persistOttiliOneLogin } from "@/account/persist-ottili-login"

export async function OttiliCoderAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "ottili-coder",
      methods: [
        {
          type: "oauth",
          label: "Sign in with Ottili (Browser)",
          authorize: async () => {
            const login = loginOttiliOneViaBrowser()

            return {
              url: "https://dashboard.ottili.one",
              method: "auto" as const,
              instructions: "Complete sign-in in your browser. This window closes automatically when done.",
              callback: async () => {
                try {
                  const result = await login
                  const { AppRuntime } = await import("@/effect/app-runtime")
                  await AppRuntime.runPromise(persistOttiliOneLogin(result))
                  return {
                    type: "success" as const,
                    access: result.accessToken,
                    refresh: result.refreshToken,
                    expires: result.expiresAt,
                  }
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "API key (optional)",
        },
      ],
    },
  }
}
