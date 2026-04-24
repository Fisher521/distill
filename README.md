# distill

> Voice-first AI reading workflow. Turn bookmarks into augmented reading artifacts you can talk back to.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#status)

## The story

Every morning I read 5–15 articles from my Burn bookmarks. The reading itself is fine. The tab-switching is what kills me — original in one tab, translation in another, a summary I paste into a third, a to-do note in a fourth. By the time I finish an essay I've context-switched ten times and forgotten half of what I wanted to react to.

The layer I kept wishing existed: voice + contextual AI reactions. Voice because typing a comment after reading is a 30-second friction I routinely skip. Reactions because only an agent can react with context — the kind that says "this contradicts the piece you read last week about X," not a generic summary.

So I built distill to close the read → react loop. Talk to it while you read; it writes back into the document. No tab switching. Nothing to copy-paste. The artifact is the conversation.

## What it does

- **Stage 1: AI triage** — scans the last 24h of bookmarks, recommends per article: read yourself / delegate to Claude / skip / cluster with similar pieces.
- **Stage 2: Augmented reading** — generates a single document with the original text, Claude's analysis, and artifact callouts interwoven (not stacked). The original author's voice is preserved via pull quotes.
- **Voice companion (Obsidian plugin, alpha)** — `Mod+Shift+V` inside any note: speak a question, Claude writes one inline callout back into the document, macOS `say` reads it aloud. See [`obsidian-distill-voice/`](./obsidian-distill-voice).

## Install

```bash
# coming to npm soon
git clone https://github.com/Fisher521/distill
cd distill && npm install && npm run build
```

## Quick start

```bash
echo "https://paulgraham.com/do.html" > urls.txt
distill fetch --source local --input urls.txt
# Opens ~/.distill/<today>/do.md in your default editor
```

## Design principles

- **Orchestration, not reinvention** — glue battle-tested tools, don't rebuild them.
- **Zero-install fallback** — every feature degrades to macOS-native (e.g. dictation).
- **Opt-in paid tier** — default config is 100% free.
- **No vendor lock-in** — swap any adapter via config.

## Works with

- **Any markdown URL list** — the default. A plain text file, one URL per line.
- **[burn451.cloud](https://www.burn451.cloud?ref=distill&utm_source=github)** — my curated AI bookmark SaaS. 2-minute signup, the cleanest source. _(We dogfood this.)_
- **Obsidian** — if you already live there, distill drops markdown into any vault folder. No plugin needed.
- **NotebookLM artifacts** — roadmap item, not shipped. Planned: podcast/slides/video/infographic via [`notebooklm-client`](https://github.com/icebear0828/notebooklm-client). Follow [JOURNAL.md](./JOURNAL.md) for progress.

## Dependency tiers

| Tier | Tools | Install | Status |
|------|-------|---------|--------|
| **1 — native** | macOS `say`, Chrome Web Speech API, Jina Reader (free tier) | zero install | ✅ shipped |
| **2 — one-line** | whisper.cpp, edge-tts, mermaid-cli | `brew install` / `pipx install` / `npm i` | whisper-cli ✅ / edge-tts 🗺️ roadmap |
| **3 — opt-in** | ElevenLabs, notebooklm-client | `distill upgrade <name>` | 🗺️ roadmap |

Every Tier 1 feature has a native fallback. A single dependency failure never kills the tool. Tier 2/3 status is tracked in [JOURNAL.md](./JOURNAL.md).

## Status

**v0.1.0-alpha** — under active development. Follow [JOURNAL.md](./JOURNAL.md) for the daily dev log.

## License

MIT

## Author

Built by [**@Fisher521**](https://github.com/Fisher521) ([X](https://x.com/hawking520)), who also runs [**burn451.cloud**](https://www.burn451.cloud?ref=distill&utm_source=github).
