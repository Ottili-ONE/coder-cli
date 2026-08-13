<div align="center">

# Ottili Coder

### Your terminal just got a developer.

**A local-first autonomous coding agent for the terminal, desktop, IDEs, GitHub Actions, and cloud execution.**

[![Release](https://img.shields.io/github/v/release/Ottili-ONE/coder-cli?display_name=tag&sort=semver)](https://github.com/Ottili-ONE/coder-cli/releases)
[![npm](https://img.shields.io/npm/v/ottili-coder)](https://www.npmjs.com/package/ottili-coder)
[![PyPI](https://img.shields.io/pypi/v/ottili-coder)](https://pypi.org/project/ottili-coder/)
[![License](https://img.shields.io/github/license/Ottili-ONE/coder-cli)](LICENSE)
[![GitHub commits](https://img.shields.io/github/commit-activity/m/Ottili-ONE/coder-cli)](https://github.com/Ottili-ONE/coder-cli/commits/main)

[Website](https://coder.ottili.one) ·
[Documentation](https://ottili.one/coder/docs) ·
[Releases](https://github.com/Ottili-ONE/coder-cli/releases) ·
[Issues](https://github.com/Ottili-ONE/coder-cli/issues) ·
[Deutsch](README.de.md)

</div>

---

![Ottili Coder terminal interface](screenshot-uk.png)

## What is Ottili Coder?

Ottili Coder is an open-source coding agent built for real repository work.

It can inspect a codebase, plan changes, edit files, run commands, execute tests, review its own work, recover from failures, use MCP tools, and continue long-running development tasks. The CLI remains the core execution engine while desktop, IDE, automation, and cloud surfaces build on the same runtime.

Ottili Coder is designed around a simple principle:

> **The interface may change. The agentic runtime stays consistent.**

You can use it interactively in a terminal, invoke it from GitHub, connect to its server API, or run larger workloads through Ottili Coder Cloud.

## Why Ottili Coder?

- **Local-first** — run directly inside your repository and keep control of the execution environment.
- **Agentic** — inspect, plan, edit, test, review, retry, and validate instead of only generating snippets.
- **Provider-flexible** — use supported providers, OpenAI-compatible endpoints, or Ottili AI routing.
- **Cloud-optional** — stay local or delegate larger workloads when cloud execution is configured.
- **Built for long runs** — sessions, checkpoints, recovery, task state, and resumable workflows.
- **Tool-native** — shell, Git, files, diagnostics, MCP servers, and external integrations.
- **One runtime, multiple surfaces** — CLI, desktop, server API, GitHub Action, SDKs, and IDE integrations.

## Product surfaces

| Surface | Purpose | Status |
|---|---|---|
| **CLI / TUI** | Interactive repository work from the terminal | Available |
| **Server mode** | HTTP API for IDEs, automation, and custom clients | Available |
| **Desktop app** | Chat-first graphical experience for larger missions | Beta |
| **GitHub Action** | Run Ottili Coder from issues and pull requests | Available |
| **JavaScript SDK** | Programmatic access to server mode | Available |
| **Python SDK** | Programmatic access to server mode | Available |
| **VS Code extension** | Native IDE interface backed by the Coder CLI | In development |
| **Ottili Coder Cloud** | Remote, parallel, and long-running execution | Evolving |

## Quick start

### Recommended install

```bash
curl -fsSL https://ottili.one/coder/install | bash
```

Then open a repository:

```bash
cd your-project
ottili-coder
```

### Install a specific GitHub release

```bash
curl -fsSL \
  https://github.com/Ottili-ONE/coder-cli/releases/latest/download/install \
  | bash
```

### npm

```bash
npm install --global ottili-coder@latest
```

The package can also be installed with Bun, pnpm, or Yarn.

### pip

```bash
pip install ottili-coder
```

### Platform binaries

Prebuilt binaries are published on the [GitHub Releases](https://github.com/Ottili-ONE/coder-cli/releases) page.

Supported release targets include:

- Linux x64 and arm64
- glibc and musl variants
- macOS Apple Silicon and Intel
- Windows x64 and arm64
- baseline builds for older compatible systems

## Core capabilities

### Repository-aware execution

Ottili Coder works from the repository itself rather than treating code as an isolated chat attachment.

It can:

- discover project structure and repository instructions
- inspect files, symbols, manifests, tests, and configuration
- understand Git state and active changes
- build task-specific context
- preserve repository-level constraints
- navigate large monorepos and multi-package projects

### Agentic implementation

A run can move through the complete engineering loop:

```text
Request
  ↓
Repository inspection
  ↓
Plan and task decomposition
  ↓
File changes and tool execution
  ↓
Tests, lint, typecheck, and validation
  ↓
Review, correction, and recovery
  ↓
Verified result
```

### Built-in agents

Switch the active agent with `Tab` in the terminal interface.

| Agent | Purpose |
|---|---|
| `build` | Full implementation access for coding and repository work |
| `plan` | Read-oriented exploration and planning before changes |

Complex searches and multi-step investigations can be delegated to the general subagent with:

```text
@general
```

### Long-running sessions

Ottili Coder is built for more than one-shot prompts.

The runtime supports concepts including:

- persistent session state
- task and run tracking
- checkpoints
- interruption recovery
- retries and corrective passes
- structured validation
- execution budgets
- live steering during active work

### MCP support

Connect Model Context Protocol servers to extend the agent with additional tools and systems.

Typical integrations include:

- databases
- browsers
- internal APIs
- documentation systems
- issue trackers
- deployment tooling
- company-specific services

### Git and validation

Ottili Coder can work with the tools already used by the repository:

- Git status, branches, commits, and diffs
- package managers and build systems
- unit and integration tests
- linters and formatters
- type checkers
- repository-specific validation commands

The repository remains the source of truth. A task is not complete merely because code was generated.

## Local, cloud, and hybrid execution

Ottili Coder is designed for three execution patterns:

### Local

The agent runs beside the repository on your machine or server.

Best for:

- direct repository access
- private environments
- low-latency tool execution
- existing local credentials and services

### Cloud

Work is delegated to configured Ottili Coder infrastructure.

Best for:

- long-running missions
- parallel workers
- remote execution
- workloads that should continue after the local client closes

### Hybrid

The local client controls the repository experience while selected work is delegated to cloud execution.

Execution availability depends on the installed CLI version, account configuration, and enabled capabilities.

## Model and provider support

Ottili Coder includes integrations for multiple model providers and OpenAI-compatible APIs. Provider availability depends on the installed release and your configuration.

The runtime contains integrations for providers and routing layers including:

- Ottili AI
- OpenRouter
- OpenAI-compatible APIs
- Anthropic
- Google
- Azure
- Amazon Bedrock
- Alibaba
- Cerebras
- Cohere
- Groq
- Mistral
- Together AI
- xAI
- additional compatible providers

Use your own provider credentials or configure Ottili services where supported.

## GitHub Action

Ottili Coder can be triggered from GitHub issues and pull requests.

Example comment:

```text
/ottili-coder fix the failing authentication test and add regression coverage
```

The action can inspect the repository context, perform the configured work, and report the result back to GitHub.

See [`github/README.md`](github/README.md) for setup and permissions.

## Server mode and SDKs

Server mode exposes Ottili Coder through an HTTP interface for:

- IDE extensions
- internal automation
- custom dashboards
- remote clients
- CI systems
- agent orchestration

Client SDKs are available for JavaScript and Python under `packages/sdk`.

Protect server mode with:

```bash
export OTTILI_CODER_SERVER_PASSWORD="your-password"
```

## Configuration

The local configuration directory is:

```text
~/.ottili-coder/
```

Common environment variables:

| Variable | Purpose |
|---|---|
| `OTTILI_CODER_API_KEY` | Authenticate with supported Ottili Coder cloud services |
| `OTTILI_CODER_SERVER_PASSWORD` | Protect server mode with HTTP Basic Auth |
| `OTTILI_CODER_INSTALL_DIR` | Override the binary installation directory |

The install script resolves its target directory in this order:

1. `$OTTILI_CODER_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.ottili-coder/bin`

Example:

```bash
OTTILI_CODER_INSTALL_DIR="$HOME/.local/bin" \
  curl -fsSL https://ottili.one/coder/install | bash
```

## Proven under real load

Ottili Coder is not only tested with isolated demo prompts.

During a six-day production-scale run in July 2026, Ottili Coder and its orchestration workloads processed:

| Metric | Result |
|---|---:|
| OpenRouter tokens processed | **16.4 billion** |
| Peak daily global rank | **#43** |
| Programming App rank | **#7** |
| CLI Agents rank | **#13** |
| Coding Agents rank | **#19** |
| Continuously active queues | **19** |
| Parallel executors per queue | **2–3** |

The run advanced multiple repositories simultaneously, produced thousands of commits, and drove several million lines of repository growth and change.

These numbers represent real operational throughput from agentic development workloads.

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│                    User surfaces                         │
│  CLI / TUI · Desktop · VS Code · GitHub · Custom clients │
└────────────────────────────┬─────────────────────────────┘
                             │
                  typed commands and events
                             │
┌────────────────────────────┴─────────────────────────────┐
│                  Ottili Coder runtime                    │
│  Sessions · Agents · Tools · Tasks · Validation · Git    │
│  Checkpoints · Recovery · MCP · Provider routing         │
└────────────────────────────┬─────────────────────────────┘
                             │
          Local execution · Cloud execution · Hybrid
                             │
┌────────────────────────────┴─────────────────────────────┐
│                Models and external systems               │
│  Ottili AI · Model providers · MCP servers · GitHub      │
│  Repository tools · CI/CD · Internal APIs                │
└──────────────────────────────────────────────────────────┘
```

The CLI runtime owns real agentic execution. Other surfaces should consume its commands, APIs, and structured events rather than reimplementing the agent.

## Repository structure

```text
coder-cli/
├── packages/
│   ├── ottili-coder/     # CLI, TUI, runtime, agents, tools, and storage
│   ├── desktop/          # Desktop application
│   ├── app/              # Shared application UI
│   ├── console/          # Console surfaces
│   ├── core/             # Shared core packages
│   └── sdk/              # JavaScript and Python SDKs
├── github/               # GitHub Action integration
├── sdks/vscode/          # VS Code-related integration work
├── infra/                # Cloud and deployment infrastructure
├── specs/                # Product and technical specifications
├── script/               # Repository scripts
├── patches/              # Required dependency patches
├── install               # Installer entry point
└── package.json          # Bun workspace root
```

## Development

### Requirements

- [Bun](https://bun.sh) 1.3 or newer
- Git
- a supported operating system
- provider credentials for model-backed runs

### Clone and start

```bash
git clone https://github.com/Ottili-ONE/coder-cli.git
cd coder-cli
bun install
bun dev
```

### Typecheck

```bash
bun typecheck
```

### Lint

```bash
bun lint
```

### Package tests

Do not run the root `test` script blindly. Run tests from the relevant package:

```bash
bun --cwd packages/ottili-coder test
```

### Build a local binary

```bash
bun run --cwd packages/ottili-coder build
```

The package also contains a single-target build script:

```bash
./packages/ottili-coder/script/build.ts --single
```

Run the generated binary:

```bash
./packages/ottili-coder/dist/ottili-coder-linux-x64/bin/ottili-coder --version
```

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before larger changes.

## Security

Ottili Coder is a powerful local coding agent. It can read files, edit repositories, and execute commands according to its configured permissions.

Permission prompts are a control layer, **not an operating-system sandbox**.

For hard isolation, run Ottili Coder inside a dedicated:

- virtual machine
- container
- disposable development environment
- restricted user account

Report vulnerabilities through [`SECURITY.md`](SECURITY.md).

## Project direction

Current development areas include:

- native VS Code integration backed by the CLI
- stronger structured event and control protocols
- local, cloud, and hybrid run continuity
- multi-agent and multi-queue execution
- better checkpoints and resumability
- improved diff, approval, and validation workflows
- team and organization features
- deeper Ottili AI integration
- model routing and execution optimization

## Contributing

Contributions are welcome.

Before opening a pull request:

1. read [`CONTRIBUTING.md`](CONTRIBUTING.md)
2. follow repository instructions in [`AGENTS.md`](AGENTS.md)
3. keep the CLI runtime as the execution source of truth
4. add tests for changed behavior
5. run the relevant validation commands
6. explain the problem, implementation, and evidence in the pull request

## Independence and attribution

Ottili Coder is maintained by [Ottili ONE](https://github.com/Ottili-ONE).

The project is not affiliated with OpenCode, Anomaly, Anthropic, OpenAI, GitHub, OpenRouter, or other third-party coding-agent and model-provider projects. Third-party packages, APIs, and trademarks belong to their respective owners.

## License

Ottili Coder is released under the [MIT License](LICENSE).

## Links

- **Website:** [coder.ottili.one](https://coder.ottili.one)
- **Ottili ONE:** [ottili.one](https://ottili.one)
- **Documentation:** [ottili.one/coder/docs](https://ottili.one/coder/docs)
- **Releases:** [GitHub Releases](https://github.com/Ottili-ONE/coder-cli/releases)
- **Issues:** [GitHub Issues](https://github.com/Ottili-ONE/coder-cli/issues)
- **Security:** [`SECURITY.md`](SECURITY.md)

---

<div align="center">

**Built by Ottili ONE. Designed to keep working after the prompt ends.**

</div>
