# LinkedLearnings

Extract and organize knowledge from your saved LinkedIn posts.

LinkedLearnings is a Chrome extension that scrolls through your saved LinkedIn posts, extracts their content, and optionally runs them through an LLM to produce summaries, tags, insights, and action items — creating a searchable personal knowledge base.

## Features

- **Automated extraction** — scrolls your saved posts with human-like behavior (variable distances, random pauses)
- **Instant analysis without API keys** — deterministic analysis using RAKE keyword extraction and fixed-tag mapping works offline with zero configuration
- **Optional LLM enhancement** — add summaries, insights, and action items by bringing your own API key
- **Provider-agnostic** — works with OpenAI, Anthropic, Groq, Ollama (local), OpenRouter, or any OpenAI-compatible API
- **Cheap model friendly** — deterministic pre-processing + short prompts designed for free/cheap models
- **Layered analysis** — deterministic results are always available; LLM enhances them when configured
- **Related posts** — tag-based post linking surfaces connections across your saved content
- **Searchable knowledge base** — search and filter by tags, categories, keywords, and full text
- **Export** — one-click export to Markdown or JSON with topics, keywords, and analysis source
- **Privacy-first** — all data stays in your browser. LLM calls are optional and go only to your chosen provider.
- **Configurable** — post limits, delay ranges, and randomized batch pauses

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked"
5. Select the `linkedlearnings/` folder
6. The LinkedLearnings icon appears in your toolbar

## Usage

1. **Log into LinkedIn** in the same Chrome browser
2. Click the LinkedLearnings icon → the side panel opens
3. Click **Start Extraction** — a new tab opens to your saved posts and scrolling begins
4. The tab group opens in focus — you can minimize it and continue browsing
5. Watch progress in the side panel (post count updates in real time)
6. Click **Analyze** — deterministic analysis runs instantly (no API keys needed)
7. Posts get category tags, RAKE keywords, summaries, and related post links
8. Optionally, configure an LLM provider in **Settings** for richer summaries, insights, and action items
9. Browse your knowledge base in the **Knowledge** tab — filter by tags
10. Export to Markdown or JSON from **Settings**

## Analysis

### How It Works

Analysis runs in two layers:

1. **Deterministic (always available)** — RAKE keyword extraction, fixed-tag category mapping (12 categories, top 2 per post), text signal detection (hiring, announcement, tip, story, etc.), engagement tier, and first-sentence summary. No network calls.
2. **LLM enhancement (optional)** — richer summaries, insights, action items, and additional tags. Requires an API key.

Posts that already have deterministic analysis can be upgraded with LLM later — just configure a provider and click Analyze again.

## LLM Setup

LinkedLearnings works fully without an LLM — deterministic analysis provides tags, keywords, categories, and summaries with zero configuration. To enable richer AI analysis:

### OpenAI
- Provider: `OpenAI`
- API Key: Your OpenAI API key
- Default model: `gpt-4o-mini` (~$0.30 for 500 posts)

### Anthropic
- Provider: `Anthropic`
- API Key: Your Anthropic API key
- Default model: `claude-sonnet-4-20250514` (~$5 for 500 posts)

### Groq (free tier available)
- Provider: `Groq`
- API Key: Your Groq API key
- Default model: `llama-3.1-70b-versatile`

### Ollama (free, local, private)
- Provider: `Ollama`
- Make sure Ollama is running locally (`ollama serve`)
- Default model: `llama3.1`

### OpenRouter / Custom
- Provider: `Custom / OpenRouter`
- API Key: Your API key
- Base URL: `https://openrouter.ai/api/v1`
- Model: Any model name (e.g., `meta-llama/llama-3.1-8b-instruct:free`)

## Permissions

| Permission | Why |
|-----------|-----|
| `sidePanel` | The knowledge base UI |
| `tabGroups` | Groups the extraction tab so it's out of your way |
| `tabs` | Opens and manages the LinkedIn tab |
| `storage` | Saves your settings locally |
| `alarms` | Keeps the background process alive |
| `scripting` | Injects the extraction script into LinkedIn |
| `host: linkedin.com` | Accesses your saved posts page |

LLM API permissions are requested **only when you configure a provider** — they're optional.

## Privacy & Security

- **All data is local.** Posts and analysis results are stored in your browser's IndexedDB.
- **API keys are stored locally** in `chrome.storage.local`. They are not encrypted — this is the standard Chrome extension security model. They never leave your browser except when sent to your chosen LLM provider.
- **No telemetry, no analytics, no external calls** besides the LLM API you configure.
- **When using a cloud LLM**, your post content is sent to that provider for analysis. For full privacy, use Ollama (runs locally).

## Configuration

### Extraction Settings
| Setting | Default | Description |
|---------|---------|-------------|
| Post Limit | 100 | Max posts to extract per session |
| Min Delay | 5s | Minimum pause between scroll actions |
| Max Delay | 15s | Maximum pause between scroll actions |
| Batch Size | 15 | Posts per batch before a longer pause |

### Anti-Bot Measures
- Random delays between all actions
- Human-like scroll behavior (250-700px natural increments, no snapping)
- Randomized batch pauses every 5-12 posts (15-45s duration, re-randomized each cycle)
- Automatic detection of rate limiting, CAPTCHAs, and login redirects
- Graceful pause with resume capability

## Disclaimer

This tool interacts with LinkedIn's web interface to extract your own saved posts. While it mimics natural browsing behavior, automated interaction with LinkedIn may violate their Terms of Service. **Use at your own risk.** The authors are not responsible for any account restrictions that may result from using this tool.

## Architecture

```
linkedlearnings/
├── background/
│   └── service-worker.js    # Orchestration, tab management, messaging
├── content/
│   ├── extractor.js         # LinkedIn page scrolling and post extraction
│   └── selectors.js         # LinkedIn DOM selectors (update here if extraction breaks)
├── lib/
│   ├── analysis.js          # Deterministic analysis engine (RAKE, fixed tags, signals)
│   ├── pipeline.js          # 3-phase analysis pipeline (deterministic → LLM → related)
│   ├── prompts.js           # LLM system prompt and prompt builder
│   ├── llm.js               # LLM provider abstraction (OpenAI, Anthropic, etc.)
│   ├── db.js                # IndexedDB + chrome.storage.local wrapper
│   └── export.js            # Markdown and JSON export
├── sidepanel/
│   ├── app.js               # Side panel UI (state, routing, views)
│   ├── styles.css            # Styles
│   └── panel.html           # HTML shell
└── manifest.json
```

## Contributing

Contributions are welcome! Key areas:

- **`content/selectors.js`** — LinkedIn DOM selectors. If extraction breaks after a LinkedIn update, this is the file to fix.
- **`lib/analysis.js`** — Deterministic analysis engine. Improve keyword extraction or add new fixed-tag categories here.
- **`lib/prompts.js`** — LLM analysis prompts. Improve knowledge extraction quality here.
- **New LLM providers** — Add new providers in `lib/llm.js`.

## License

MIT
