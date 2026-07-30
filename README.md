> Rebuilt from a fresh `bunx electrobun init --template=react-tailwind-vite` scaffold, with the full Sleiz Studio monorepo functionality migrated in.
# 🎬 Sleiz Studio

> All-in-one platform for translating Chinese animation / short films to Vietnamese.
> Built with a modern dark-mode UI inspired by **VSCode + Discord + Notion + GitHub Desktop**.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-orange.svg)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4.6-orange.svg)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vitejs.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003b57.svg)](https://www.sqlite.org/)
[![Drizzle](https://img.shields.io/badge/Drizzle%20ORM-0.36-yellow.svg)](https://orm.drizzle.team/)

## ✨ Features

### 📚 Content Management
- **Channels** — Multi-channel support (Sleiz Vietsub, Anime Hay, Movie Hay, ...). Each channel has its own AI config, templates, donate info.
- **Movies** — Vietnamese / Chinese / English titles, aliases, poster, banner, studio, genres, year, country, director, author, status.
- **Episodes** — Per-movie episodes with status tracking (pending → imported → translating → translated → reviewing → completed → exported).
- **Subtitles** — Import SRT / VTT / ASS / SSA / TXT / CapCut JSON. Full cue-level editor with undo/redo, search/replace, timeline, jump-to-time.

### 🤖 AI Translation Pipeline
- **Provider abstraction** — Default **Google Gemini** (gemini-2.0-flash-exp). Pluggable: OpenAI, Claude, DeepSeek, OpenRouter, Qwen, local Ollama.
- **Batch translation** — Auto-split into 100-cue batches, queue, retry, pause/resume.
- **Translation Memory** — Skip AI entirely for sentences we've translated before. Cache hit count + cost savings.
- **Glossary / Dictionary** — Force canonical translations of names, places, skills, items, titles, terms.
- **Consistency Check** — Detect untranslated terms, timing issues, newline bugs, spelling errors. Optional AI-based review.
- **Description Generator** — AI generates YouTube title, description, hashtags, SEO keywords from channel templates + subtitle content.
- **Thumbnail Prompt Generator** — AI suggests thumbnail text, colors, emotion, and a full image-generation prompt.

### 📺 Bilibili Integration
- Parse BV/av/ep/ss URLs and b23.tv short links.
- Fetch metadata: title, uploader, cover, description, episode list.
- List available subtitles per language.
- Download subtitles and convert to SRT.
- Get playurl info for downstream download via yt-dlp.

### 🎨 Modern UI
- Dark mode by default (VSCode / Discord / Notion / GitHub Desktop inspired).
- Resizable sidebar, command palette (Ctrl+Shift+P or Cmd+K).
- Alt+1..0 shortcuts for all main pages.
- Virtual list for large subtitle files.
- Status bar with live tokens / cost / provider / clock.
- Toasts, dialogs, skeleton loading, infinite scroll, drag-drop.

### 🛠️ Engineering
- **Monorepo** with Bun workspaces.
- **TypeScript** everywhere (no plain JS).
- **Clean Architecture** — services + repositories + routes.
- **Drizzle ORM** with migration / seed scripts.
- **TanStack Query** + **Zustand** for state.
- **shadcn/ui-style** components in `@sleiz/ui`.

## 📁 Project Structure

```
sleiz-studio/
├── apps/
│   ├── web/              # Vite + React 19 frontend
│   └── desktop/          # ElectroBun desktop shell
├── packages/
│   ├── shared/           # Types, constants, utils
│   ├── database/         # Drizzle ORM + SQLite
│   ├── api/              # Hono backend
│   ├── ui/               # Reusable UI components
│   ├── subtitle/         # SRT/VTT/ASS/TXT/CapCut parsers + exporters
│   ├── translator/       # AI provider abstraction + Translation Memory + Glossary
│   ├── bilibili/         # Bilibili API client
│   ├── storage/          # File storage
│   ├── worker/           # Async job queue
│   └── plugins/          # Plugin system contract
├── scripts/              # Maintenance scripts
└── package.json
```

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) >= 1.1.0
- (Optional) [yt-dlp](https://github.com/yt-dlp/yt-dlp) for Bilibili video download

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY at minimum

# 3. Run database migrations (creates ./data/sleiz.db)
bun db:migrate

# 4. Seed sample data (optional, but recommended for first run)
bun db:seed

# 5. Start both web + api in parallel
bun dev:all
```

Then open **http://localhost:5173** in your browser.

### Individual services

```bash
bun dev          # Web frontend only (port 5173)
bun dev:api      # Hono API only (port 8787)
bun db:studio    # Drizzle Studio (DB GUI at port 4983)
```

## 🔑 Configuration

All configuration lives in `.env` (see `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | (required) |
| `OPENAI_API_KEY` | OpenAI API key (optional) | |
| `CLAUDE_API_KEY` | Anthropic Claude API key (optional) | |
| `BILIBILI_COOKIE` | Cookie string for Bilibili | |
| `AI_DEFAULT_PROVIDER` | Default AI provider | `gemini` |
| `AI_DEFAULT_MODEL` | Default model | `gemini-2.0-flash-exp` |
| `AI_BATCH_SIZE` | Cues per batch | `100` |
| `AI_CONCURRENCY` | Parallel AI calls | `3` |
| `DATABASE_URL` | SQLite path | `./data/sleiz.db` |
| `API_PORT` | Hono server port | `8787` |

API keys can ALSO be configured from the Settings page — they are stored in the local SQLite database and take precedence over env vars.

## 🎯 Usage Workflow

1. **Create a Channel** — Fill in social links, donate info, AI prompt, templates.
2. **Create a Movie** — Pick the channel, add Vietnamese + Chinese titles, metadata.
3. **Create an Episode** — Add episode number, title, optional video path.
4. **Import Subtitle** — Drag-drop an SRT / VTT / ASS / TXT / CapCut JSON file.
5. **(Optional) Add Glossary** — Add names, places, skills you want translated consistently.
6. **Translate** — Click "Translate" in the Subtitle Editor. Watch batches progress.
7. **(Optional) Run Consistency Check** — Find any untranslated terms or timing bugs.
8. **(Optional) Generate AI Description** — Get YouTube title, description, hashtags.
9. **Export** — Pick a format (SRT / VTT / ASS / TXT / JSON) and download.

## 🖥️ Desktop Build (ElectroBun)

The web app is the primary target. To build a native desktop bundle:

```bash
# 1. Build the web bundle
bun build:web

# 2. Build with ElectroBun
cd apps/desktop
bunx electrobun build
```

Output bundles for macOS / Linux / Windows will be in `apps/desktop/dist/`.

> Note: ElectroBun runtime must be installed first: https://electrobun.dev/

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sleiz Studio Web (React 19)                  │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │  Sidebar     │  │  Command Palette│  │  Pages (Dashboard, │  │
│  │  (Navigation)│  │  (Ctrl+Shift+P) │  │  Channel, Movie,   │  │
│  └──────────────┘  └────────────────┘  │  Subtitle, AI, ...) │  │
│                                         └────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ TanStack Query  ↔  Zustand Store  ↔  Fetch /api          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                       Sleiz Studio API (Hono)                   │
│  Channels / Movies / Episodes / Subtitles / Batches             │
│  Glossary / Characters / Translation Memory / AI / Bilibili     │
│  Export / Jobs / History / Statistics / Settings                │
└─────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
┌───────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  SQLite +     │    │  Translator       │    │  Bilibili Client  │
│  Drizzle ORM  │    │  ├ Gemini         │    │  ├ URL parser     │
│  ├ channels   │    │  ├ OpenAI         │    │  ├ Metadata       │
│  ├ movies     │    │  ├ Claude         │    │  ├ Subtitles      │
│  ├ episodes   │    │  ├ DeepSeek       │    │  └ Playurl        │
│  ├ subtitles  │    │  ├ OpenRouter     │    └───────────────────┘
│  ├ batches    │    │  ├ Qwen           │
│  ├ glossary   │    │  └ Local (Ollama) │
│  ├ memory     │    │  + Translation    │
│  ├ history    │    │    Memory cache   │
│  ├ jobs       │    │  + Glossary       │
│  └ settings   │    │    enforcement    │
└───────────────┘    └───────────────────┘
```

## 🛡️ Security

- **No hardcoded API keys.** Keys are read from `.env` or stored encrypted in the local DB.
- **`.env` is gitignored.** `.env.example` contains only placeholders.
- **Bilibili cookie is stored locally** and only sent to bilibili.com.
- **API keys are returned masked** (`••••••••`) from the settings endpoint.

## 📜 License

MIT © 2026 Sleiz Studio


