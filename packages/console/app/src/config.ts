/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://ottili.one/coder",

  // GitHub
  github: {
    repoUrl: "https://github.com/Ottili-ONE/coder-cli",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/ottili-coder",
    discord: "https://discord.gg/ottili-coder",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const
