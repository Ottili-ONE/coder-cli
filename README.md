<p align="center">
  <a href="https://ottili.one/coder">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Ottili Coder logo">
    </picture>
  </a>
</p>
<p align="center">The autonomous developer — a local coding agent in your terminal, plus the <a href="https://codehelm.ottili.one">ottili.one</a> cloud engine.</p>
<p align="center">
  <a href="https://ottili.one/coder/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/ottili-coder-ai"><img alt="npm" src="https://img.shields.io/npm/v/ottili-coder-ai?style=flat-square" /></a>
  <a href="https://github.com/Ottili-ONE/coder-cli/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Ottili-ONE/coder-cli/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Ottili Coder Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://ottili.one/coder)

---

### Installation

```bash
# YOLO
curl -fsSL https://ottili.one/coder/install | bash

# Package managers
npm i -g ottili-coder-ai@latest        # or bun/pnpm/yarn
scoop install ottili-coder             # Windows
choco install ottili-coder             # Windows
brew install anomalyco/tap/ottili-coder # macOS and Linux (recommended, always up to date)
brew install ottili-coder              # macOS and Linux (official brew formula, updated less)
sudo pacman -S ottili-coder            # Arch Linux (Stable)
paru -S ottili-coder-bin               # Arch Linux (Latest from AUR)
mise use -g ottili-coder               # Any OS
nix run nixpkgs#ottili-coder           # or github:Ottili-ONE/coder-cli for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

Ottili Coder is also available as a desktop application. Download directly from the [releases page](https://github.com/Ottili-ONE/coder-cli/releases) or [ottili.one/coder/download](https://ottili.one/coder/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `ottili-coder-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `ottili-coder-desktop-mac-x64.dmg`     |
| Windows               | `ottili-coder-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask ottili-coder-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ottili-coder-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OTTILI_CODER_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.ottili-coder/bin` - Default fallback

```bash
# Examples
OTTILI_CODER_INSTALL_DIR=/usr/local/bin curl -fsSL https://ottili.one/coder/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ottili.one/coder/install | bash
```

### Agents

Ottili Coder includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://ottili.one/coder/docs/agents).

### Documentation

For more info on how to configure Ottili Coder, [**head over to our docs**](https://ottili.one/coder/docs).

### Contributing

If you're interested in contributing to Ottili Coder, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Ottili Coder

If you are working on a project that's related to Ottili Coder and is using "ottili-coder" as part of its name, for example "ottili-coder-dashboard" or "ottili-coder-mobile", please add a note to your README to clarify that it is not built by the Ottili Coder team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/ottili-coder) | [X.com](https://x.com/ottili-coder)
