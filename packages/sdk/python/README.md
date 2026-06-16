# Ottili ONE Coder

**Ottili ONE Coder** is the open-source AI coding agent for the [Ottili ONE](https://ottili.one) platform. This Python package installs the `ottili-coder` CLI and downloads the matching native binary for your platform on first use.

## Install

```bash
pip install ottili-coder
```

Or with pipx for an isolated CLI:

```bash
pipx install ottili-coder
```

## Quick start

```bash
cd your-project
ottili-coder
```

## What you get

- Terminal agent with **build** and **plan** modes
- MCP and skills support
- Optional Ottili ONE cloud integration
- Cross-platform CLI via native GitHub release binaries

## Other install options

```bash
# npm
npm i -g ottili-coder@latest

# Install script
curl -fsSL https://ottili.one/coder/install | bash

# GitHub release binaries
curl -fsSL https://github.com/Ottili-ONE/coder-cli/releases/latest/download/install | bash
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `OTTILI_CODER_BIN_PATH` | Use a custom CLI binary path |
| `OTTILI_CODER_INSTALL_DIR` | Override install directory for downloaded binaries |
| `OTTILI_CODER_VERSION` | Pin downloaded release version |
| `OTTILI_CODER_RELEASE_REPO` | Override GitHub release source repo |

## Links

- Website: https://ottili.one/coder
- Docs: https://ottili.one/coder/docs
- Repository: https://github.com/Ottili-ONE/coder-cli
- Issues: https://github.com/Ottili-ONE/coder-cli/issues

## License

MIT
