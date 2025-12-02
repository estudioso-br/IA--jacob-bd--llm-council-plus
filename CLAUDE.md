# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LLM Council Plus is a 3-stage deliberation system where multiple LLMs collaboratively answer user questions through:
1. **Stage 1**: Individual model responses (with optional web search context)
2. **Stage 2**: Anonymous peer review/ranking to prevent bias
3. **Stage 3**: Chairman synthesis of collective wisdom

**Key Innovation**: Hybrid architecture supporting OpenRouter (cloud), Ollama (local), Groq (fast inference), and direct provider connections.

## Running the Application

**Quick Start:**
```bash
./start.sh
```

**Manual Start:**
```bash
# Backend (from project root)
uv run python -m backend.main

# Frontend (in new terminal)
cd frontend
npm run dev
```

**Ports:**
- Backend: `http://localhost:8001` (NOT 8000 - avoid conflicts)
- Frontend: `http://localhost:5173`

**Installing Dependencies:**
```bash
# Backend
uv sync

# Frontend
cd frontend
npm install
```

**Important**: If switching between Intel/Apple Silicon Macs with iCloud sync:
```bash
rm -rf frontend/node_modules && cd frontend && npm install
```
This fixes binary incompatibilities (e.g., `@rollup/rollup-darwin-*` variants).

## Architecture Overview

### Backend (`backend/`)

**Provider System** (`backend/providers/`)
- **Base**: `base.py` - Abstract interface for all LLM providers
- **Implementations**: `openrouter.py`, `ollama.py`, `groq.py`, `openai.py`, `anthropic.py`, `google.py`, `mistral.py`, `deepseek.py`
- **Auto-routing**: Model IDs with prefix (e.g., `openai:gpt-4.1`, `ollama:llama3`, `groq:llama3-70b-8192`) route to correct provider
- **Routing logic**: `council.py:get_provider_for_model()` handles prefix parsing

**Core Modules**

| Module | Purpose |
|--------|---------|
| `council.py` | Orchestration: stage1/2/3 collection, rankings, title/search query generation |
| `search.py` | Web search: DuckDuckGo, Tavily, Brave with Jina Reader content fetch |
| `settings.py` | Config management, persisted to `data/settings.json` |
| `prompts.py` | Default system prompts for all stages |
| `main.py` | FastAPI app with streaming SSE endpoint |
| `storage.py` | Conversation persistence in `data/conversations/{id}.json` |

### Frontend (`frontend/src/`)

| Component | Purpose |
|-----------|---------|
| `App.jsx` | Main orchestration, SSE streaming, conversation state |
| `ChatInterface.jsx` | User input, web search toggle |
| `Stage1.jsx` | Tab view of individual model responses |
| `Stage2.jsx` | Peer rankings with de-anonymization, aggregate scores |
| `Stage3.jsx` | Chairman synthesis (final answer) |
| `Settings.jsx` | 4-section sidebar: Council Config, API Keys, System Prompts, General |
| `Sidebar.jsx` | Conversation list with inline delete confirmation |

**Styling**: "Midnight Glass" dark theme with glassmorphic effects. Primary colors: blue (#3b82f6) and cyan (#06b6d4) gradients. Font: Merriweather 15px/1.7 for content, JetBrains Mono for errors.

## Critical Implementation Details

### Python Module Imports
**ALWAYS** use relative imports in backend modules:
```python
from .config import ...
from .council import ...
```
**NEVER** use absolute imports like `from backend.config import ...`

**Run backend as module** from project root:
```bash
uv run python -m backend.main  # Correct
cd backend && python main.py  # WRONG - breaks imports
```

### Model ID Prefix Format
```
openrouter:anthropic/claude-sonnet-4  → Cloud via OpenRouter
ollama:llama3.1:latest                → Local via Ollama
groq:llama3-70b-8192                  → Fast inference via Groq
openai:gpt-4.1                        → Direct OpenAI connection
anthropic:claude-sonnet-4             → Direct Anthropic connection
```

### Model Name Display Helper
Use this pattern in Stage components to handle both `/` and `:` delimiters:
```jsx
const getShortModelName = (modelId) => {
  if (!modelId) return 'Unknown';
  if (modelId.includes('/')) return modelId.split('/').pop();
  if (modelId.includes(':')) return modelId.split(':').pop();
  return modelId;
};
```

### Stage 2 Ranking Format
The prompt enforces strict format for parsing:
```
1. Individual evaluations
2. Blank line
3. "FINAL RANKING:" header (all caps, with colon)
4. Numbered list: "1. Response C", "2. Response A", etc.
```
Fallback regex extracts "Response X" patterns if format not followed.

### Streaming & Abort Logic
- Backend checks `request.is_disconnected()` inside loops
- Frontend aborts by closing `EventSource` connection
- **Critical**: Always inject raw `Request` object into streaming endpoints (Pydantic models lack `is_disconnected()`)

### ReactMarkdown Safety
```jsx
<div className="markdown-content">
  <ReactMarkdown>
    {typeof content === 'string' ? content : String(content || '')}
  </ReactMarkdown>
</div>
```
Always wrap in `.markdown-content` div and ensure string type (some providers return arrays/objects).

### Tab Bounds Safety
In Stage1/Stage2, auto-adjust activeTab when out of bounds during streaming:
```jsx
useEffect(() => {
  if (activeTab >= responses.length && responses.length > 0) {
    setActiveTab(responses.length - 1);
  }
}, [responses.length]);
```

## Common Gotchas

1. **Port Conflicts**: Backend uses 8001 (not 8000). Update `backend/main.py` and `frontend/src/api.js` together.

2. **CORS Errors**: Frontend origins must match `main.py` CORS middleware (localhost:5173 and :3000).

3. **Missing Metadata**: `label_to_model` and `aggregate_rankings` are ephemeral - only in API responses, not stored.

4. **Duplicate Tabs**: Use immutable state updates (spread operator), not mutations. StrictMode runs effects twice.

5. **Search Rate Limits**: DuckDuckGo can rate-limit. Retry logic in `search.py` handles this.

6. **Model Deduplication**: When multiple sources provide same model, use Map-based deduplication preferring direct connections.

7. **Binary Dependencies**: `node_modules` in iCloud can break between Mac architectures. Delete and reinstall.

## Data Flow

```
User Query (+ optional web search)
    ↓
[Generate search query via LLM] (if enabled)
    ↓
[Fetch search results + full content for top N]
    ↓
Stage 1: Parallel queries → Stream individual responses
    ↓
Stage 2: Anonymize → Parallel peer rankings → Parse rankings
    ↓
Calculate aggregate rankings
    ↓
Stage 3: Chairman synthesis → Stream final answer
    ↓
Save conversation (stage1, stage2, stage3 only)
```

## Testing & Debugging

```bash
# Test OpenRouter connectivity
uv run python backend/test_openrouter.py

# Test search providers
uv run python backend/test_search.py

# Check Ollama models
curl http://localhost:11434/api/tags

# View logs
# Watch terminal running backend/main.py
```

## Web Search

**Providers**: DuckDuckGo (free), Tavily (API), Brave (API)

**Full Content Fetching**: Jina Reader (`https://r.jina.ai/{url}`) extracts article text for top N results (configurable 0-10, default 3). Falls back to summary if fetch fails or yields <500 chars. 25-second timeout per article, 60-second total search budget.

**Search Query Generation**: LLM extracts 3-6 key terms from user query. Customizable via Settings.

## Settings

**UI Sections** (sidebar navigation):
1. **Council Config**: Model selection with Remote/Local toggles, "I'm Feeling Lucky" randomizer
2. **API Keys**: OpenRouter, Groq, Tavily, Brave, Direct providers
3. **System Prompts**: Stage 1/2/3 and search query prompts
4. **General & Search**: Search provider, full content results count

**Auto-Save Behavior**:
- **Credentials auto-save**: API keys and Ollama URL save immediately on successful validation (credentials are commitments)
- **Configs require manual save**: Model selections, prompts, search provider (experimental, user may batch changes)
- UX flow: Test → Success → Auto-save → Clear input → "Settings saved!"

**Rate Limit Warnings**:
- Formula: `(council_members × 2) + 2` requests per council run
- OpenRouter free tier: 20 RPM, 50 requests/day
- Groq: 30 RPM, 14,400 requests/day

**Storage**: `data/settings.json`

## Design Principles

- **Graceful Degradation**: Single model failure doesn't block entire council
- **Transparency**: All raw outputs inspectable via tabs
- **De-anonymization**: Models receive "Response A/B/C", frontend displays real names
- **Progress Indicators**: "X/Y completed" during streaming

## AI Coding Best Practices

**Communication:**
- NEVER make assumptions when requirements are vague - ask for clarification
- Provide options with pros/cons for different approaches
- Confirm understanding before significant changes

**Code Safety:**
- NEVER use placeholders like `// ...` in edits - this deletes code
- Always provide full content when writing/editing files
- FastAPI: Inject raw `Request` object to access `is_disconnected()`
- React: Use spread operators for immutable state updates (StrictMode runs effects twice)

## Future Enhancements

- Model performance analytics over time
- Export conversations to markdown/PDF
- Custom ranking criteria (beyond accuracy/insight)
- Backend caching for repeated queries
- Conversation import/export
