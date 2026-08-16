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
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/ottili-coder",
    discord: "https://discord.gg/ottili-coder",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
