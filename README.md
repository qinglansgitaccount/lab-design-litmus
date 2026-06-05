# Lab Design Litmus

An AI-powered experiment design risk analysis tool for PhD researchers. Upload a research protocol, get literature-grounded risk flags with real citations from PubMed and Semantic Scholar.

## Architecture

```
frontend/          → Next.js (deployed on Vercel)
backend/           → FastAPI (deployed on Render via Railway migration)
```

**Database:** Supabase (PostgreSQL + Realtime)

## Backend Routes

| Endpoint | Router | Purpose |
|----------|--------|---------|
| `POST /risk-flags` | `risk_flag.py` | RAG pipeline: extract queries → search PubMed + Semantic Scholar → analyze with DeepSeek → return risk cards |
| `POST /app/chat` | `app_chat.py` | Two-mode chat: pre-analysis onboarding (collect context) and post-analysis Q&A (discuss risk flags) |
| `POST /transcribe` | `transcribe.py` | Whisper transcription for voice input |
| `POST /agent/process` | `agent.py` | Voice agent for live experiment data recording (see note below) |
| `GET /export/{id}` | `export.py` | PDF and DOCX export of experiment data |
| `GET /health` | `main.py` | Health check |

## Risk Analysis Pipeline

1. User uploads protocol (PDF/DOCX/TXT)
2. DeepSeek extracts 3–5 search queries from the protocol text
3. Queries run in parallel against PubMed (via E-utilities XML API) and Semantic Scholar (REST API)
4. Retrieved papers are deduplicated and formatted as context
5. DeepSeek analyzes protocol against literature, returns structured risk cards with severity levels: `high`, `medium`, `suggestion`
6. Each risk card includes: risk description, explanation, actionable suggestion, and cited sources with DOIs

## Chat Modes

The `/app/chat` endpoint operates in two modes controlled by the `mode` field:

- **`pre` mode:** Conversational onboarding before analysis. Collects research question, success criteria, and lab context. Uses Claude. Responses are short (2–3 sentences). The assistant does NOT run analysis — it only gathers context.
- **`post` mode:** After risk flags are generated, the user can ask follow-up questions about specific risks. Can also request protocol edits, returned as `{"type": "protocol_update", ...}` JSON.

## Data Recording (Hidden)

The experiment recording feature (voice capture → data tables → experiment summaries) is **intentionally hidden** from the UI. There is no user-facing entry point. All backend code and Supabase tables for this feature are preserved but the frontend has no navigation to it. The Whisper pipeline remains active only for the onboarding voice input flow.

> **Why hidden?** After user interviews, the product pivoted from a broad lab assistant to a focused risk-flagging tool. The recording feature was deprioritized but not removed, to avoid breaking shared database schemas.

## Environment Variables

Backend (`.env`):
```
ANTHROPIC_API_KEY=       # Claude for chat
DEEPSEEK_API_KEY=        # DeepSeek for RAG analysis
OPENAI_API_KEY=          # Whisper transcription
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SEMANTIC_SCHOLAR_API_KEY= # Optional, improves rate limits
```

Frontend (`.env.local`):
```
NEXT_PUBLIC_API_URL=     # Backend URL
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Known Issues

- The root-level `app/`, `package.json`, `tsconfig.json` etc. are leftover scaffolding from initial project setup. The actual frontend lives in `frontend/`. These should be cleaned up.
- `backend/fastapi==0.104.1` is a stray file created by accidentally running a pip command in the wrong directory. Not a real file.
- No test suite exists. Risk analysis output quality is validated manually.
- Error handling in `risk_flag.py` silently falls back if Semantic Scholar or PubMed APIs fail — the user sees no indication that literature search was partial.
- CORS allows a hardcoded Replit preview URL that is no longer active.
