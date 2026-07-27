# ApplyDeck

One-command installer for **ApplyDeck** — the AI-powered job search pipeline built on Claude Code, based on [career-ops](https://github.com/santifer/career-ops).

```bash
npx applydeck init
```

This sets up a ready-to-use workspace:

1. Clones ApplyDeck at the latest stable release
2. Installs dependencies

Then open your AI coding tool in the folder. **On first launch the agent walks you through setup — your CV, profile and target roles — just by chatting.** Nothing to configure by hand. ApplyDeck is AI-agnostic — Claude Code, Gemini, Codex, Qwen, OpenCode, GitHub Copilot CLI, Antigravity CLI, and Grok Build CLI all work.

The installer bootstraps CLI skill entrypoints after clone, so new CLIs (e.g. Grok) work even when `npx` pulled an older release tag.

## Usage

```bash
npx applydeck init [folder]   # default folder: ./applydeck
```

Prefer the manual route? `git clone` still works exactly as before — see the [setup guide](https://github.com/ChillandBuild/ApplyDeck/blob/main/docs/SETUP.md).

## Requirements

- Node.js 18+
- git

## License

MIT
