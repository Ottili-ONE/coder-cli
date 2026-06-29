<p align="center">
  <a href="https://ottili.one/coder">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Ottili ONE Coder logo" width="120">
    </picture>
  </a>
</p>

<h1 align="center">Ottili ONE Coder</h1>

<p align="center">
  The autonomous developer for the Ottili ONE platform — a local AI coding agent in your terminal, with optional cloud orchestration through <a href="https://ottili.one">ottili.one</a>.
</p>

<p align="center">
  <a href="https://github.com/Ottili-ONE/coder-cli/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Ottili-ONE/coder-cli?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/ottili-coder"><img alt="npm" src="https://img.shields.io/npm/v/ottili-coder?style=flat-square" /></a>
  <a href="https://pypi.org/project/ottili-coder/"><img alt="PyPI" src="https://img.shields.io/pypi/v/ottili-coder?style=flat-square" /></a>
  <a href="https://github.com/Ottili-ONE/coder-cli/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Ottili-ONE/coder-cli/publish.yml?style=flat-square&branch=main" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Ottili-ONE/coder-cli?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a>
</p>

[![Ottili ONE Coder terminal UI](packages/web/src/assets/lander/screenshot.png)](https://ottili.one/coder)

---

## What is Ottili ONE Coder?

Ottili ONE Coder is the open-source coding agent of the [Ottili ONE](https://ottili.one) ecosystem. It runs locally in your terminal, understands your repository, edits files, runs commands, connects to MCP servers, and can delegate work to Ottili ONE cloud services when configured.

This repository contains:

| Component | Description |
| --- | --- |
| **CLI / TUI** | Terminal agent (`ottili-coder`) for daily development |
| **Cairn** | Live-steer execution doctrine with session memory, CIP hints, and checkpoint recovery |
| **Desktop app** | Electron shell around the shared web UI (beta) |
| **Server mode** | HTTP API for IDE integrations and automation |
| **GitHub Action** | Run Ottili Coder from issue and PR comments (`/ottili-coder`) |
| **SDKs** | JavaScript and Python clients for the server API |

Ottili ONE Coder is maintained by [Ottili ONE](https://github.com/Ottili-ONE). It is not affiliated with OpenCode, Anomaly, or other third-party coding-agent projects.

---

## Quick start

### Install script (recommended)

```bash
curl -fsSL https://ottili.one/coder/install | bash
```

Or install a specific release from GitHub:

```bash
curl -fsSL https://github.com/Ottili-ONE/coder-cli/releases/latest/download/install | bash
```

### npm

```bash
npm i -g ottili-coder@latest
# or: bun / pnpm / yarn
```

### pip

```bash
pip install ottili-coder
```

### Start coding

```bash
cd your-project
ottili-coder
```

---

## Installation options

### Platform binaries

Download the matching archive from the [releases page](https://github.com/Ottili-ONE/coder-cli/releases) and put `ottili-coder` on your `PATH`.

Supported targets:

- Linux: x64 / arm64, glibc and musl, baseline variants
- macOS: Apple Silicon and Intel, baseline variants
- Windows: x64 / arm64, baseline variants

### Custom install directory

The install script resolves the destination in this order:

1. `$OTTILI_CODER_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin` (if present or creatable)
4. `$HOME/.ottili-coder/bin` (default)

```bash
OTTILI_CODER_INSTALL_DIR=$HOME/.local/bin curl -fsSL https://ottili.one/coder/install | bash
```

### Desktop app (beta)

Desktop builds are published alongside CLI releases:

| Platform | Asset |
| --- | --- |
| macOS (Apple Silicon) | `ottili-coder-desktop-mac-arm64.dmg` |
| macOS (Intel) | `ottili-coder-desktop-mac-x64.dmg` |
| Windows | `ottili-coder-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, or `.AppImage` |

Downloads: [GitHub Releases](https://github.com/Ottili-ONE/coder-cli/releases) · [ottili.one/coder/download](https://ottili.one/coder/download)

---

## Built-in agents

Switch agents with `Tab` in the TUI:

| Agent | Purpose |
| --- | --- |
| **build** | Default full-access agent for implementation work |
| **plan** | Read-only exploration and planning; asks before shell commands |

The **general** subagent handles complex multi-step searches. Invoke it with `@general` in a message.

Documentation: [Agents](https://ottili.one/coder/docs/agents)

---

## GitHub Action

Comment on an issue or pull request:

```text
/ottili-coder fix the failing test
```

Setup guide: [`github/README.md`](./github/README.md)

---

## Configuration & docs

- Product docs: [ottili.one/coder/docs](https://ottili.one/coder/docs)
- Server/API reference: generated from `packages/sdk`
- Local config directory: `~/.ottili-coder/`

Environment highlights:

| Variable | Purpose |
| --- | --- |
| `OTTILI_CODER_API_KEY` | Ottili ONE cloud authentication |
| `OTTILI_CODER_SERVER_PASSWORD` | Protect server mode with HTTP Basic Auth |
| `OTTILI_CODER_INSTALL_DIR` | Override CLI install location |

---

## Development

Requirements: [Bun](https://bun.sh) 1.3+

```bash
git clone https://github.com/Ottili-ONE/coder-cli.git
cd coder-cli
bun install
bun dev
```

Build a local binary:

```bash
./packages/ottili-coder/script/build.ts --single
./packages/ottili-coder/dist/ottili-coder-linux-x64/bin/ottili-coder --version
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor guide.

---

## Security

Ottili ONE Coder is a powerful local agent. The permission prompts are a UX guardrail, not a sandbox. Run it in a VM or container when you need isolation.

Report issues responsibly: [SECURITY.md](./SECURITY.md)

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Links

- Website: [ottili.one/coder](https://ottili.one/coder)
- Ottili ONE: [ottili.one](https://ottili.one)
- Issues: [github.com/Ottili-ONE/coder-cli/issues](https://github.com/Ottili-ONE/coder-cli/issues)
- Releases: [github.com/Ottili-ONE/coder-cli/releases](https://github.com/Ottili-ONE/coder-cli/releases)

---

## Changelog

### v1.0.4

- **Cairn live-steer system**: execution doctrine with session memory, CIP hint injection, checkpoint recovery, and worktime budget enforcement
- **TUI crash fix**: prevent `SIGABRT` when terminal responds to OSC 10/11 color queries (VSCode xterm.js, gnome-terminal). Patched opentui core via `bun patch` to no-op theme auto-detection since ottili-coder forces dark theme
- **SDK version bump**: JS SDK 1.0.0 → 1.0.4, Python SDK 1.0.3 → 1.0.4
