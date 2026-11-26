# Demo Guide, Limitations & Technical Q&A

## Suggested live demonstration (~8 minutes)

**Before you start:**
1. Run `npm run setup` and `npm run dev`.
2. Put `GROQ_API_KEY` (and ideally `OPENAI_API_KEY`) in `.env`.
3. Open <http://localhost:3000>.

| # | Do / say | What to point out |
|---|---|---|
| 1 | Open **Overview**. Toggle **Demo data / Live calls**. | Seeded rows are badged *Demo*; agent-generated rows are badged *Live*. |
| 2 | Go to **Live Agent** and check the **Pipeline status** card. | DB, pgvector chunk count, and the STT, LLM and TTS providers. |
| 3 | Click **Start call** and tick the consent box. | Consent is enforced server-side (`consent: true`); the mic permission prompt appears. |
| 4 | Agent greets you. Say: **"I'm looking for a 3BHK apartment in Baner under one crore."** | Tool lines appear: `save_or_update_lead`, then `search_properties` → Skyline Residences (₹94 L) and Baner Greens (₹88 L). The live lead panel fills in. |
| 5 | Ask: **"Which one is ready to move, and does it have a pool?"** | Grounded answer from the tool result: Skyline (ready, rooftop pool). Nothing invented. |
| 6 | Ask: **"What's the token amount, and can I get a home loan?"** | `search_company_knowledge` → vector search over policy docs (₹1 L refundable token, partner banks). |
| 7 | Say: **"We want to buy within two months. My name is Rahul."** | Score jumps to HOT. Point out the deterministic breakdown later on the Leads page. |
| 8 | Say: **"Can I visit Skyline this Sunday at 11?"** | Sunday is rejected and alternatives are offered (Mon–Sat only). |
| 9 | Say: **"Okay, Monday at 11 then."** | `check_appointment_availability` holds the slot. The agent reads it back and **asks for confirmation** instead of booking. |
| 10 | Say: **"Yes, please confirm."** | `book_appointment` succeeds, the green *Visit booked* card appears and a toast confirms it. |
| 11 | Say: **"That's all, thank you. Bye!"** | `generate_call_summary` runs, the agent says goodbye, and the call ends automatically with the summary shown. |
| 12 | Open **Leads → Rahul**. | Requirements, the score breakdown (30/30/25/15) and its reasons, sentiment and transcript. |
| 13 | Open **Appointments**. | The new visit is under *Upcoming*, in IST, badged *Live*. |
| 14 | Open **Call History → the call**. | Structured summary, properties discussed, follow-ups, and the transcript with tool lines. |
| 15 | *(Optional)* Refresh during a call. | The **Resume call** button restores the same conversation from Postgres. |
| 16 | *(Optional)* Run `npm run test:tools`. | It proves the booking guards and the DB-level double-booking constraint without an LLM. |

> **Fallbacks for the room:** if the mic or Wi-Fi is unreliable, use the typed input box. It goes through the same turn endpoint, minus STT.

## Known limitations

1. **Turn-based voice, not full-duplex.**
   - The utterance is uploaded after 1.2 s of silence, then STT runs in batch.
   - The LLM response is not token-streamed.
   - TTS is streamed: playback starts while audio is still generating.
   - There is no barge-in: the mic is paused while the agent speaks, to avoid echo. Use **Skip** to interrupt.
   - Typical turn latency is STT ~0.3–0.8 s plus agent ~1–3 s (more when several tools run). See [ARCHITECTURE.md](ARCHITECTURE.md#real-time-voice-removing-the-mvps-turn-based-limitation) for the streaming design.
2. **Simple VAD.** It's energy-based, with an adaptive threshold. Noisy rooms can trigger early or late end-of-turn; "Done speaking" and Mute are the manual overrides.
3. **Single-instance state.** The rate limiter and per-conversation turn lock are in memory. Run one server process, or move both to Redis.
4. **No authentication or roles on the dashboard**, and no multi-tenant separation.
5. **Embeddings run in-process.** The first query after a cold start loads the ONNX model (~1–2 s). The model is downloaded once at seed time.
6. **Summary generation is synchronous** at end of call (~1–3 s). Production would use a background worker.
7. **Scheduling is simple.** There is one guided visit per property per hour, with no rep calendars, holidays, rescheduling or cancellation tools, and no SMS/WhatsApp confirmations.
8. **Date understanding relies on the LLM.** It resolves "Monday" or "tomorrow" using the IST date in the prompt. The server validates the resulting ISO date and time, but cannot know whether the model chose the date the customer meant. That is why the agent reads the slot back for confirmation.
9. **English only.** Whisper is pinned to `language=en`. Hinglish mostly works; pure Hindi or Marathi will not.
10. **Sentiment is per call**, classified at the end, not live per utterance.
11. **Groq free tier.** About 8K tokens/min and 200K/day per model. With the compact prompts and the fallback model, that's roughly 2 tool turns per minute and a few calls' worth per day per model. Speak at a calm pace and avoid long test sessions on demo day.
12. **No call audio is stored**, only transcripts. That's deliberate for privacy, but it means there's no playback in Call History.

## Likely interviewer questions & trade-offs

**Why turn-based instead of streaming?**
It's reliable everywhere, needs no media server, and is easy to debug. Every step is a normal HTTP request with a persisted result. The latency cost is about 1–2 s per turn. TTS is already streamed because that's where the biggest perceived-latency win is. The next step would be WebSocket/WebRTC with streaming STT, then sentence-chunked LLM → TTS, then barge-in.

**How do you stop the LLM from hallucinating properties or bookings?**
- The prompt allows only properties returned by `search_properties` in the current call.
- Tool results are the only source of property facts.
- `book_appointment` returns `booked: true` only after the DB commit, and the prompt forbids claiming a booking otherwise.
- Summaries take facts from the DB; the LLM writes only the narrative.

**How do you guarantee confirmation before booking?**
Confirmation isn't left to the model. Three server-side checks enforce it:
1. The slot must first be held by `check_appointment_availability`.
2. The booking must happen in a **later customer turn** than the hold.
3. `customer_confirmed=true`.

The model can't book in the same turn it offers the slot.

**How are duplicate bookings prevented, including races?**
There are three layers:
1. App-level availability check.
2. Idempotency: the same customer and property returns the existing booking.
3. `UNIQUE` constraints on `propertySlotKey` and `customerSlotKey`. These are set only while CONFIRMED, so cancelled slots (NULL) are re-bookable.

Two concurrent inserts can't both win; the loser gets Prisma `P2002`, which returns `slot_taken` plus alternatives. `test:tools` exercises this.

**Why deterministic lead scoring instead of asking the LLM?**
- It's auditable: every point has a reason.
- It's stable: the same inputs always give the same score.
- It's cheap and not open to prompt injection.

The LLM only *extracts* the inputs (budget, timeline, intent); the scoring is code. Intent extraction is the one subjective input.

**Why a local embedding model?**
It avoids a second paid provider, works offline after the first download, and needs no extra key. The 384-dim MiniLM is plenty for ~30 chunks. It can be swapped for an API embedding model by changing `lib/embeddings.ts` and the `vector(384)` dimension.

**Why both SQL filters and vector search?**
Price, BHK and location are hard constraints; similarity search alone would happily return a ₹3 Cr villa for "under one crore". SQL filters first, then vector re-ranking for soft preferences ("near IT park, with pool"). The `retrieval` field in each tool result states which method ran.

**How does memory work, and what happens on a page refresh?**
Nothing lives in server memory between turns. Each turn, the orchestrator rebuilds the LLM context from Postgres:
- the message history, including tool calls and results
- a memory block in the system prompt: known fields, missing fields, previous summaries, properties discussed, any pending booking

The browser stores only the conversation id in localStorage.

**Why Groq?**
Low-latency inference matters for voice, and it offers OpenAI-compatible tool calling plus Whisper under one key. The model is configurable (`GROQ_MODEL`), and `GROQ_BASE_URL` allows any OpenAI-compatible provider.

**What if Groq returns a malformed tool call?**
The client retries once on `tool_use_failed`, 429 and 5xx. Invalid arguments are returned to the model as a structured `invalid_arguments` tool result with the Zod issues, so it can self-correct on the next step. A tool exception becomes a safe result telling the agent to apologise and offer a callback.

**Security considerations?**
- Keys stay server-only (`server-only` imports); the client sees only booleans.
- Explicit consent is stored per call.
- All inputs are Zod-validated, and UUIDs are checked.
- Size limits apply to audio and text.
- Per-IP rate limits.
- Logs never include transcripts, phone numbers or bodies.
- Tool payloads aren't sent to the browser.
- TTS text is looked up by id rather than passed in the URL.

Missing in the MVP: dashboard auth, CSRF protection for state-changing routes (mitigated by JSON content type and same-origin use), and data-retention policies.

**How would this scale to 100k users?**
See [ARCHITECTURE.md §2](ARCHITECTURE.md#2-proposed-production-architecture-100000-registered-users--not-implemented):
- Stateless app pods plus Redis for limits, locks and slot holds.
- A separate voice gateway for long-lived media sessions.
- A queue with workers for summaries, embeddings and notifications.
- PgBouncer, read replicas, HNSW indexing and `Message` partitioning.
- Telephony via SIP / media streams.
- OpenTelemetry tracing, an LLM gateway with budgets, and model routing for cost.

**What would you build next?**
1. Streaming voice with barge-in.
2. Reschedule and cancel tools, plus WhatsApp/SMS confirmations.
3. Dashboard auth and roles.
4. An offline evaluation set of scripted calls, to catch prompt or model regressions (hallucinated listings, unconfirmed bookings, repeated questions).
5. Human handoff.
