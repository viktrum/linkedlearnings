# Privacy Policy

**Last updated:** April 22, 2026

## What data LinkedLearnings collects

LinkedLearnings stores the following data locally in your browser:

- **Extracted post content** from your LinkedIn saved posts (text, author name, post URL, engagement metrics)
- **Analysis results** (tags, keywords, categories, summaries, related posts)
- **Your settings** (extraction preferences, LLM provider name, API key, model name)

All data is stored in your browser's IndexedDB and chrome.storage.local. Nothing is stored on any external server.

## What data is sent externally

**By default, nothing.** The extension makes zero external network requests.

**If you configure an LLM provider,** the text content of your saved posts is sent to the LLM API you choose (OpenAI, Anthropic, Groq, Ollama, or OpenRouter) for analysis. This only happens when you explicitly click "Analyze" or "Enhance with LLM." Your API key is sent only to the provider you configure.

## What data LinkedLearnings does NOT collect

- No telemetry
- No analytics
- No tracking
- No cookies
- No user accounts
- No data is sent to the extension developer or any third party

## Data storage and security

- All data is stored locally in your browser
- API keys are stored in chrome.storage.local (unencrypted, which is the standard Chrome extension security model)
- Uninstalling the extension deletes all stored data

## Your choices

- You can export your data at any time (Markdown or JSON) from the dashboard
- You can clear all stored data by uninstalling the extension or clearing site data
- LLM analysis is entirely optional. The extension is fully functional without it.
- For maximum privacy, use Ollama (runs locally on your machine) as your LLM provider

## Contact

For questions about this privacy policy, open an issue at https://github.com/viktrum/linkedlearnings/issues
