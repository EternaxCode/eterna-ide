<div align="center">

# Eterna IDE

**Your models change. Your knowledge stays.**

A local AI workspace that connects code, decisions, evidence, and official coding-agent terminals.

[![CI](https://github.com/EternaxCode/eterna-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/EternaxCode/eterna-ide/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-536f5c.svg)](LICENSE)

[한국어 사용 설명서](docs/README.ko.md) · [Performance](docs/performance/README.md) · [Contributing](CONTRIBUTING.md)

</div>

![Eterna workspace](docs/images/workspace.png)

## What it does

- **Edit and review:** syntax highlighting, local files, optimistic saves, and diff review.
- **Share knowledge across models:** one evidence-backed knowledge store for GPT/Codex and Claude Code; explicit opt-in for cross-project context.
- **Keep memory current:** records reference source hashes; changed evidence becomes stale. Revoked or outdated knowledge is excluded from inherited answers too.
- **Work in source snapshots:** coding terminals edit a separate source copy. Review and apply individual files without silently overwriting concurrent original edits.
- **Keep an execution trail:** local tests, exit codes, context snapshots, interruption status, and persistent history.
- **Use official authentication:** bundled official Codex CLI with ChatGPT login, and installed official Claude Code in an integrated terminal. No extracted OAuth tokens or silent API-key fallback.

## Quick start

Requires **macOS, Node.js 24.2+, and Git**. Claude Code is optional. Linux CI validates core/browser behavior; interactive desktop support is currently macOS-first.

```sh
git clone https://github.com/EternaxCode/eterna-ide.git
cd eterna-ide
npm ci
npm run launch
```

Or double-click **Eterna IDE.command** after cloning. The launcher builds and opens a local authenticated browser session. The app listens only on `127.0.0.1:4317`.

1. Add a project using its absolute folder path.
2. Open a file, inspect the context preview, and ask GPT a question.
3. For edits, open **코딩 터미널** (coding terminal), then review changes before applying them.
4. Save decisions and lessons in the knowledge graph.

The interface is currently Korean. An English UI is not yet included.

## Connect your subscription

**GPT / Codex:** use **모델 연결** (model connections) to start the official login. Existing ChatGPT authentication is recognized. The app includes the official Codex CLI without replacing a globally installed copy. The current default model is `gpt-6.1-sol`; availability depends on your account, and the model can be changed in settings.

**Claude Code:** install the [official CLI](https://code.claude.com/docs/en/overview), then use the account-login terminal. Claude runs interactively with its own permission prompts. It reads the same context bundle as GPT, but its terminal output is not automatically ingested into memory; save selected conclusions explicitly.

Subscription limits and billing settings belong to the providers. Eterna does **not** rotate accounts to bypass limits, copy authentication tokens, or silently fall back to paid API calls. Real Claude inference requires your completed login and was not part of the original author's live verification.

## Performance, measured

The performance work targets local UI and data handling, not the model's inference speed. The reproducible fixture uses 500 knowledge records and 400 runs with 100KB contexts each. See the [report and raw results](docs/performance/README.md) for before/after measurements and limitations.

Heavy editor, language, graph, and terminal modules load on demand. Run summaries are stored separately from full contexts, unchanged state requests return no response body, and hidden tabs stop polling. CI enforces a 110KB gzip budget for the initial JavaScript entry.

## Data and boundaries

Local state lives in `.data/`. The legacy database filename `nexus.sqlite`, storage keys, and `NEXUS_*` environment variables remain compatible with the initial prototype. Back up the database using a SQLite-aware backup or stop the server before copying the whole data directory. Do not commit or share this directory or launch URLs.

Snapshots support text source files up to 512KB each, fewer than 2,000 files, and 20MB total. Dependencies, secrets, symlinks, and binary assets are excluded. A source snapshot is **not an OS security sandbox**. Official CLI permissions still apply; user-triggered test commands run on the host with the user's privileges.

This is a single-user local application, not a network-exposed multi-tenant service. Graph links are navigational; vector search and automatic call-graph extraction are not implemented. Model switching shares explicit context, not hidden model reasoning or weights.

## Development

```sh
npm test
npm run check
npm run build
node scripts/check-bundle.mjs
npx playwright install chrome
npm run test:e2e
npm run benchmark
```

`npm start` runs in the foreground. `npm run dev` rebuilds once and watches the Node server. `scripts/smoke.mjs` and `scripts/terminal-smoke.mjs` are opt-in live provider probes that consume your subscription allowance.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [MIT license](LICENSE). Built by [EternaxCode](https://github.com/EternaxCode).

## Native desktop preview (0.3)

A Tauri/Rust desktop build is available for macOS Apple Silicon and Windows x64. It runs without the local Node server, retains the same UI, adds read-only legacy import into a separate CAS/Zstd-backed store, source-snapshot archival/restoration, and an actual-event 3D Synapse timeline. See [Desktop installation and operation](docs/DESKTOP.md). Official AI tools remain separate installations. Package verification does not imply Apple notarization or Windows commercial signing.
