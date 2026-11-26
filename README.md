# EstateAI — Autonomous AI Sales Voice Agent

A working MVP of a browser-based voice sales agent for **EstateAI**, a fictional real estate company in Pune. A customer talks to the agent ("Akash"). The agent finds matching properties, qualifies the lead, books a site visit in PostgreSQL and writes a call summary. Everything then shows up in a CRM-style dashboard.

```
Mic → VAD → Whisper STT → Agent (Groq LLM + validated tools + RAG + memory) → OpenAI TTS → Speaker
                                         │
                                    PostgreSQL + pgvector  ──▶  Dashboard
```

- **Architecture & scaling plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **API reference:** [docs/API.md](docs/API.md)
- **Demo script, limitations, interview Q&A:** [docs/DEMO.md](docs/DEMO.md)
- **One-page project report:** [docs/REPORT.md](docs/REPORT.md)

---

## Features

| Area | What's implemented |
|---|---|
| **Voice interface** | Hands-free microphone capture with energy-based voice-activity detection (auto end-of-utterance after 1.2 s of silence). Status indicator for listening, hearing, thinking and speaking, with a live mic level. Live transcript with tool-activity lines. Mute, "Done speaking", Skip and End-call controls. Typed fallback input. Mic-permission and error states. The call resumes after a page refresh. |
| **STT** | Whisper (`whisper-large-v3-turbo` on Groq by default, or OpenAI `whisper-1`), with a Pune-vocabulary prompt and silence/hallucination filtering. |
| **TTS** | OpenAI TTS (`gpt-4o-mini-tts`), **streamed** to an `<audio>` element so playback starts before synthesis finishes. Falls back to the browser's `speechSynthesis` (clearly labelled) when `OPENAI_API_KEY` is not set. |
| **Agent orchestrator** | System prompt for a professional sales persona. Tool-calling loop (up to 5 steps per turn). Memory injected from the DB on every step. Markdown stripped for speech. Per-conversation turn lock. |
| **Tools (7)** | `search_properties`, `search_company_knowledge`, `get_customer_history`, `save_or_update_lead`, `check_appointment_availability`, `book_appointment`, `generate_call_summary`. All arguments are **Zod-validated**, and the JSON Schemas sent to the LLM are generated from the same Zod schemas. |
| **RAG** | 13 listings and 6 company docs are chunked and embedded with a local `all-MiniLM-L6-v2` model (384-dim). They're stored in **pgvector** and retrieved by cosine distance. Structured filters (price, BHK, location, type) are plain SQL; semantic search re-ranks descriptive queries. There's a clearly labelled `keyword_fallback` (Postgres full-text search) if the embedder can't load. |
| **Memory** | Conversation history plus the customer profile, requirements, previous call summaries, properties already discussed, and any pending booking — all persisted and re-injected each turn. Returning callers are linked to their existing record by phone number. |
| **Lead scoring** | Deterministic score out of 100: budget fit 30, timeline 30, intent 25, requirement match 15. HOT ≥ 75, WARM 45–74, COLD < 45. The breakdown and reasons are stored and shown. |
| **Sentiment** | LLM classification of the **customer's** sentiment at the end of the call (Positive / Neutral / Negative, with a reason). Stored separately from the lead score. |
| **Booking** | DB-backed availability in Asia/Kolkata: Mon–Sat, hourly slots 10:00–17:00, at least 30 min notice, at most 60 days ahead. Alternatives are offered when a slot is unavailable. Booking needs a prior availability check, a customer reply after the offer, `customer_confirmed=true` and a saved name. Duplicates are stopped by **unique slot-key constraints** in Postgres, and repeat calls are idempotent. |
| **Summaries** | Structured call summary. Facts (requirements, score, properties, appointment) come from the DB. The LLM writes only the narrative, the sentiment and follow-ups, and its output is Zod-validated. |
| **Dashboard** | Overview (KPIs plus lead and sentiment charts and recent activity), Live Agent, Leads (filters, score breakdown, history), Appointments (upcoming / past), Call History (summaries, transcripts, regenerate). **Demo vs Live** badges and filters on every view. |
| **Security** | API keys stay on the server only. Consent is required before a call is created. Inputs are validated with Zod. Per-IP rate limits. No transcripts or PII in logs. Tool payloads are never sent to the browser. |

## Tech stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v4 · shadcn/ui · Recharts · PostgreSQL 17 + pgvector · Prisma 7 (`@prisma/adapter-pg`) · Zod 4 · Groq (LLM + Whisper) · OpenAI TTS · `@huggingface/transformers` (local embeddings).

---

## Setup

### Prerequisites
- Node.js 20+ (tested on 22)
- Docker (for Postgres + pgvector), or any Postgres 15+ with the `vector` extension available
- A **Groq API key** (free tier works): <https://console.groq.com/keys>
- Optional: an **OpenAI API key** for natural TTS voices

### 1. Install and configure
```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill in GROQ_API_KEY (and optionally OPENAI_API_KEY)
```

### 2. Database
```bash
npm run db:up               # docker compose: pgvector/pgvector:pg17 on localhost:5433
npm run db:migrate          # applies prisma/migrations (creates the vector extension)
npm run db:seed             # properties, embedded knowledge base, demo CRM records
```
The first seed downloads the ~23 MB embedding model and caches it locally. Or run all three steps with `npm run setup`.

### 3. Run
```bash
npm run dev                 # http://localhost:3000
# or
npm run build && npm start
```
Open **Live Agent** and click **Start call**. Accept the consent dialog and allow microphone access, then speak.

> Use Chrome, Edge or Firefox on `localhost` (microphone access needs a secure context, and `localhost` counts as one).

### Checks
```bash
npm run typecheck           # tsc --noEmit
npm run lint
npm run test:tools          # tool-layer workflow test against the real DB (no LLM key needed)
npm run ingest              # rebuild the knowledge base after editing lib/data/properties.ts
```

`test:tools` exercises the demo workflow's business logic directly:
- vector retrieval
- Baner 3BHK search
- Zod rejection of bad arguments
- lead scoring 45 → 100 HOT
- the Sunday rejection and its alternatives
- each booking guard (no availability check, same-turn booking, unconfirmed)
- a successful booking
- idempotent repeat booking
- the DB-level double-booking constraint

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://estateai:estateai@localhost:5433/estateai` | Postgres connection (matches `docker-compose.yml`) |
| `GROQ_API_KEY` | ✅ for calls | — | LLM chat completions and Whisper STT |
| `GROQ_MODEL` | | `openai/gpt-oss-120b` | Any Groq chat model with tool calling (e.g. `llama-3.3-70b-versatile`) |
| `GROQ_FALLBACK_MODEL` | | `openai/gpt-oss-20b` | Used when `GROQ_MODEL` is rate limited (separate per-model quota). `""` disables |
| `GROQ_SUMMARY_MODEL` | | `openai/gpt-oss-20b` | Model for end-of-call summaries, so they don't use the conversation model's quota |
| `GROQ_STT_MODEL` | | `whisper-large-v3-turbo` | Groq transcription model |
| `GROQ_BASE_URL` | | `https://api.groq.com/openai/v1` | Point at any OpenAI-compatible endpoint |
| `OPENAI_API_KEY` | optional | — | OpenAI TTS. Without it, the browser's voice is used |
| `OPENAI_TTS_MODEL` | | `gpt-4o-mini-tts` | e.g. `tts-1` |
| `OPENAI_TTS_VOICE` | | `alloy` | Any OpenAI voice |
| `STT_PROVIDER` | | `groq` | `openai` to use OpenAI `whisper-1` (needs `OPENAI_API_KEY`) |
| `EMBEDDING_MODEL` | | `Xenova/all-MiniLM-L6-v2` | Local embedding model (must output 384 dims) |

If a key is missing, the app still runs. The **Pipeline status** panel on Live Agent and `GET /api/health` show what's missing, and API calls that need the missing key return `503 not_configured` with the variable name.

### Troubleshooting: `429 rate_limit_exceeded`
Groq's free tier allows about 8K tokens/min and 200K tokens/day **per model** (see <https://console.groq.com/settings/limits>). Groq also counts the requested `max_completion_tokens` toward the limit.

The agent is built to fit inside that budget:
- **Compact prompts:** tool specs are ~0.9K tokens and the system prompt ~0.5K. Validation-only schema keywords stay in Zod rather than being sent to the model.
- **Tool gating:** tools that can't apply right now are not sent. `book_appointment` is offered only while a slot is held.
- **Lean history:** only the spoken exchanges from earlier turns are resent, never old tool results; their facts live in the system prompt's memory block.
- **Second quota bucket:** if `GROQ_MODEL` is rate limited with a long wait, the call switches immediately to `GROQ_FALLBACK_MODEL`, and summaries run on `GROQ_SUMMARY_MODEL`. Short waits (≤ 3 s) are retried on the same model.

Every turn logs a PII-free line such as `[agent] turn tokens=3196 calls=2 model=…`, and the Live Agent status bar shows tokens per turn.

**Realistic free-tier capacity:** a turn that uses tools costs roughly 3–4K tokens, so about 2 turns/min per model and a few dozen turns a day per model, roughly doubled by the fallback. That's enough to demo at a calm pace. If you still hit a daily (`TPD`) limit on every model, it resets only after the wait shown in the error.

## Project structure

```
app/
  (dashboard)/            Overview, agent, leads, appointments, calls (Server Components + Suspense)
  api/                    Route handlers — conversations, turn, end, TTS audio, health
components/
  agent/                  VoiceAgent client + useVoiceCapture (MediaRecorder + VAD)
  dashboard/              Nav, badges, charts, transcript, filters
  ui/                     shadcn/ui
lib/
  agent/                  orchestrator, tools (Zod), prompt, llm (Groq), summary
  data/properties.ts      Fictional inventory + company knowledge docs
  rag.ts, embeddings.ts   Chunking, ingestion, pgvector retrieval
  scoring.ts, leads.ts    Deterministic lead scoring
  appointments.ts, time.ts  IST slots, availability, duplicate keys
  speech.ts               Whisper STT, streaming TTS
prisma/
  schema.prisma, migrations/, seed.ts, ingest.ts
scripts/smoke-tools.ts    Tool-layer workflow test
docs/                     ARCHITECTURE.md, API.md, DEMO.md
```

## Database design (summary)

`Customer` 1—1 `Lead` · `Customer` 1—* `Conversation` 1—* `Message` · `Conversation` 1—1 `CallSummary` · `Appointment` *—1 `Customer` / `Property` / `Conversation` · `KnowledgeDocument` 1—* `KnowledgeChunk` (`vector(384)`) · `KnowledgeDocument` *—1 `Property` (optional).

- **IDs and timestamps:** UUID primary keys everywhere; `timestamptz` timestamps.
- **Demo flag:** `isDemo` on Customer, Lead, Conversation and Appointment marks seeded rows.
- **Double-booking guard:** `Appointment.propertySlotKey` and `customerSlotKey` are `UNIQUE` and set only while an appointment is CONFIRMED. Postgres therefore rejects a double booking even under a race, and cancelled slots (NULL) can be re-booked.

Full details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#database-design).

## Known limitations

See [docs/DEMO.md](docs/DEMO.md#known-limitations). In short:
- **Turn-based, not full-duplex.** Audio is uploaded after you stop speaking, and there's no barge-in while the agent talks. TTS playback is streamed; STT and LLM output are not.
- **Single-instance state.** The rate limiter and turn lock live in memory.
- **No auth on the dashboard.** It's a demo.
