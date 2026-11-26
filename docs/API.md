# API Reference

All endpoints are Next.js route handlers under `/api`. Requests and responses are JSON unless noted. API keys are never accepted from or returned to clients.

Errors share one shape:

```json
{ "error": "machine_code", "message": "Human readable", "...": "optional extras" }
```

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_id`, `invalid_request`, `consent_required`, `missing_audio` | Validation failed |
| 404 | `not_found` | Unknown conversation or message |
| 409 | `busy` | A turn for this conversation is already in progress |
| 410 | `ended` | Turn sent to an ended call |
| 413 | `audio_too_large` | Audio over 10 MB |
| 429 | `rate_limited` (with `Retry-After`), `llm_rate_limited` | Too many requests |
| 502 | `llm_error` | Upstream AI failure |
| 503 | `not_configured` (+ `envVar`) | A required API key is missing or rejected |

Per-IP rate limits (in-memory, per server instance):

| Bucket | Limit |
|---|---|
| create | 10/min |
| turn | 30/min |
| end | 10/min |
| tts | 60/min |

---

## `GET /api/health`

Integration status. Values are booleans and names only.

```json
{
  "database": { "ok": true, "properties": 13, "vectorChunks": 26 },
  "llm": { "configured": true, "provider": "groq", "model": "openai/gpt-oss-120b" },
  "stt": { "configured": true, "provider": "groq", "model": "whisper-large-v3-turbo", "envVar": "GROQ_API_KEY" },
  "tts": { "configured": true, "provider": "kokoro", "model": "Kokoro-82M (af_heart, local)" }
}
```

## `POST /api/conversations`

Starts a call. **Requires explicit consent.** It:
- creates an anonymous `Customer` with an empty `Lead`, plus the `Conversation`
- stores the greeting as the first assistant message

Request:
```json
{ "consent": true }
```
Response `201`:
```json
{
  "id": "uuid",
  "greeting": { "id": "message-uuid", "content": "Hello, thank you for calling EstateAI! …" },
  "config": { "llm": {…}, "stt": {…}, "tts": {…} }
}
```

## `GET /api/conversations/:id`

Full call state, used to resume after a refresh. Tool messages are returned **without** their payloads.

```json
{
  "id": "uuid", "status": "ACTIVE" | "ENDED", "startedAt": "…", "endedAt": null, "durationSec": null,
  "sentiment": null,
  "customer": { "id": "uuid", "name": "Rahul Verma", "hasPhone": false },
  "lead": { "budgetMaxInr": 10000000, "preferredLocation": "Baner", "bedrooms": 3, "score": 100, "classification": "HOT", … },
  "appointments": [ { "id": "uuid", "startsAt": "…", "status": "CONFIRMED", "property": { "name": "…", "location": "…", "address": "…" } } ],
  "summary": null,
  "messages": [ { "id": "uuid", "role": "USER" | "ASSISTANT" | "TOOL", "content": "…", "toolName": null, "hasToolCalls": false, "turnIndex": 1, "createdAt": "…" } ]
}
```

## `POST /api/conversations/:id/turn`

One conversational turn. Two input modes are accepted.

**Voice:** `multipart/form-data` with an `audio` file (webm/opus, ogg, mp4 or wav; max 10 MB). The audio is transcribed with Whisper.

**Text:** `application/json`, as below (1–1,000 characters).

```json
{ "text": "I'm looking for a 3BHK apartment in Baner under one crore." }
```

If the audio contained no speech:
```json
{ "noSpeech": true, "transcript": "", "sttLatencyMs": 310 }
```

Otherwise:
```json
{
  "transcript": "I'm looking for a 3BHK apartment in Baner under one crore.",
  "sttLatencyMs": 420,
  "userMessageId": "uuid",
  "assistantMessage": { "id": "uuid", "content": "Great choice! Skyline Residences has ready-to-move 3BHKs at ninety-four lakh…" },
  "toolEvents": [
    { "name": "save_or_update_lead", "ok": true, "display": "Lead saved · score 45 (WARM)" },
    { "name": "search_properties", "ok": true, "display": "Found 2: Baner Greens, Skyline Residences" }
  ],
  "appointmentId": null,
  "summaryGenerated": false,
  "latencyMs": 1830,
  "customer": { "name": null, "hasPhone": false },
  "lead": { … },
  "pendingBooking": null,
  "appointment": null
}
```

`summaryGenerated: true` means the agent called `generate_call_summary` because the customer was saying goodbye. The client ends the call after playing the reply.

## `POST /api/conversations/:id/end[?regenerate=1]`

Ends a call. The call is idempotent. It:
- sets `status=ENDED`, `endedAt` and `durationSec`
- generates the `CallSummary` and sentiment if none exists yet; `?regenerate=1` forces a new one

Response:
```json
{
  "status": "ENDED",
  "summary": {
    "summary": "…", "leadScore": 100, "leadClassification": "HOT",
    "sentiment": "POSITIVE", "sentimentReason": "…",
    "customerRequirements": { … }, "propertiesDiscussed": [ … ], "appointmentDetails": { … },
    "followUpRecommendations": [ "…" ]
  }
}
```

## `GET /api/messages/:id/audio`

Streams TTS for an **assistant** message: `audio/wav` (24 kHz mono 16-bit PCM, open-ended length) from local Kokoro or Gemini, or `audio/mpeg` from OpenAI. The text is loaded server-side by id, so it never appears in the URL. Audio streams while it is synthesised. Returns `503 tts_unavailable` if synthesis fails, or `503 not_configured` when `TTS_PROVIDER=browser`; the client then uses `speechSynthesis`.

---

## LLM tools (internal contract)

The LLM requests a tool by name, never by SQL. Every call goes through `executeTool()`, which:
1. parses the JSON arguments
2. validates them against the Zod schema
3. runs the backend function
4. returns a JSON result

The result is persisted as a `TOOL` message. The JSON Schemas sent to the model are generated from the same Zod schemas.

| Tool | Arguments | Behaviour |
|---|---|---|
| `search_properties` | `location?` (Baner, Hinjewadi, Wakad, Kharadi, Balewadi), `max_price_inr?`, `min_price_inr?`, `bedrooms?`, `property_type?`, `query?`, `include_sold_out?` | SQL filters; vector re-rank when `query` is given; ≤5 results. Each result has a `ref` (slug) used by the booking tools. With zero matches it returns `alternatives` and a "do not invent" note. Records the results in `propertiesDiscussed`. |
| `search_company_knowledge` | `query` | pgvector top-4 over company docs and listings. `retrieval: "vector"`, or `"keyword_fallback"` if the embedder is unavailable. |
| `get_customer_history` | `phone?` | Profile, requirements, previous call summaries and appointments, for the current caller or a phone number. |
| `save_or_update_lead` | `name?`, `phone?` (Indian mobile, normalised to `+91…`), `budget_max_inr?`, `preferred_location?`, `property_type?`, `bedrooms?`, `purchase_timeline?`, `purchase_timeline_months?`, `buying_intent?` (HIGH, MEDIUM, LOW), `notes?` | Upserts the lead and recomputes the deterministic score. Returns `lead_score`, `classification`, `score_reasons` and `still_missing`. A phone number belonging to an existing customer merges this call into that record. |
| `check_appointment_availability` | `property_ref`, `date` (YYYY-MM-DD), `time?` (HH:mm, IST) | Without `time`, lists free slots that day. With `time`, checks the slot. If it's free, the slot is **held** (`pendingBooking`); if not, it returns the reason and the 3 nearest alternatives. |
| `book_appointment` | `property_ref`, `date`, `time`, `customer_confirmed` | Applies the guards below, then inserts the appointment under DB unique slot keys. Returns `booked: true` only after the insert commits. |
| `generate_call_summary` | — | Generates and persists the structured summary and sentiment. |

`book_appointment` guards, in order:
1. `customer_confirmed=true`.
2. **Idempotency:** an existing future booking for the same property is returned instead of creating a duplicate.
3. The slot was held by `check_appointment_availability`.
4. The hold came from an earlier turn, so the customer has replied since the offer.
5. The customer's name is saved.
6. The slot is still valid.
