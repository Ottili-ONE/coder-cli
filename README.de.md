<p align="center">
  <a href="https://ottili.one/coder">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Ottili ONE Coder Logo" width="120">
    </picture>
  </a>
</p>

<h1 align="center">Ottili ONE Coder</h1>

<p align="center">
  Der autonome Entwickler für die Ottili-ONE-Plattform — ein lokaler KI-Coding-Agent im Terminal, optional mit Cloud-Orchestrierung über <a href="https://ottili.one">ottili.one</a>.
</p>

<p align="center">
  <a href="https://github.com/Ottili-ONE/coder-cli/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Ottili-ONE/coder-cli?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/ottili-coder"><img alt="npm" src="https://img.shields.io/npm/v/ottili-coder?style=flat-square" /></a>
  <a href="https://pypi.org/project/ottili-coder/"><img alt="PyPI" src="https://img.shields.io/pypi/v/ottili-coder?style=flat-square" /></a>
  <a href="LICENSE"><img alt="Lizenz" src="https://img.shields.io/github/license/Ottili-ONE/coder-cli?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a>
</p>

---

## Was ist Ottili ONE Coder?

Ottili ONE Coder ist der Open-Source-Coding-Agent des [Ottili ONE](https://ottili.one)-Ökosystems. Er läuft lokal im Terminal, versteht dein Repository, bearbeitet Dateien, führt Befehle aus, bindet MCP-Server ein und kann bei Bedarf an Ottili-ONE-Cloud-Dienste delegieren.

Dieses Repository enthält CLI/TUI, Desktop-App (Beta), Server-Modus, GitHub Action und SDKs.

Ottili ONE Coder wird von [Ottili ONE](https://github.com/Ottili-ONE) gepflegt und steht in keiner Verbindung zu OpenCode, Anomaly oder anderen Drittanbieter-Projekten.

---

## Schnellstart

### Installation (empfohlen)

```bash
curl -fsSL https://ottili.one/coder/install | bash
```

### npm

```bash
npm i -g ottili-coder@latest
```

### pip

```bash
pip install ottili-coder
```

### Loslegen

```bash
cd dein-projekt
ottili-coder
```

---

## Weitere Infos

- Dokumentation: [ottili.one/coder/docs](https://ottili.one/coder/docs)
- Releases: [GitHub Releases](https://github.com/Ottili-ONE/coder-cli/releases)
- Mitentwickeln: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Sicherheit: [SECURITY.md](./SECURITY.md)

---

## Lizenz

MIT — siehe [LICENSE](./LICENSE).
