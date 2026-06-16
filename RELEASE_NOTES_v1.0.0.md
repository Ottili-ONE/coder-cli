# Ottili ONE Coder v1.0.0

First official public release of **Ottili ONE Coder** — the open-source coding agent for the [Ottili ONE](https://ottili.one) platform.

## Highlights

- **Terminal agent (`ottili-coder`)** with build and plan agents, MCP support, and skills
- **Ottili ONE cloud integration** for model routing and remote workflows
- **Cross-platform binaries** for Linux, macOS, and Windows (x64 and arm64, musl and baseline variants)
- **npm package** `ottili-coder` with native binary postinstall
- **Python package** `ottili-coder` on PyPI
- **GitHub Action** in `github/` for `/ottili-coder` issue and PR automation
- **Desktop app (beta)** builds published alongside CLI assets
- **Server mode + SDKs** for automation and IDE integrations

## Install

```bash
# Install script
curl -fsSL https://ottili.one/coder/install | bash

# npm
npm i -g ottili-coder@latest

# pip
pip install ottili-coder

# GitHub release binary
curl -fsSL https://github.com/Ottili-ONE/coder-cli/releases/latest/download/install | bash
```

## Repository

- Source: https://github.com/Ottili-ONE/coder-cli
- Docs: https://ottili.one/coder/docs
- Issues: https://github.com/Ottili-ONE/coder-cli/issues

## Notes

This release replaces the earlier internal test tag `v1.17.3`. Version **1.0.0** is the first semver baseline for Ottili ONE Coder as a public Ottili ONE product.

## License

MIT
