const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://ottili.one/coder" : `https://${stage}.ottili.one/coder`,
  console: stage === "production" ? "https://ottili.one/coder/auth" : `https://${stage}.ottili.one/coder/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/Ottili-ONE/coder-cli",
  discord: "https://ottili.one/coder/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
