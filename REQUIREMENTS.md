# Build: Autonomous AI Sales Voice Agent

You are a senior full-stack engineer and AI systems architect. Build a functional MVP of an AI-powered autonomous sales voice agent for a real estate company.

The goal is to demonstrate a complete end-to-end business workflow, not just a chatbot UI.

## 1. Product Overview

Build a browser-based AI sales agent that can:

1. Interact with customers through real-time voice.
2. Understand spoken language using Speech-to-Text (STT).
3. Generate contextual responses using an LLM.
4. Retrieve company information using RAG.
5. Maintain conversation context and customer memory.
6. Qualify potential customers and assign lead scores.
7. Analyse customer sentiment.
8. Check appointment availability and book property visits.
9. Generate call summaries and business insights.
10. Display everything in a CRM-style dashboard.

Use a fictional real estate company named "EstateAI".

## 2. Recommended Technology Stack

Use the following technologies unless there is a strong technical reason to change them.

- Frontend: Next.js (App Router), TypeScript
- Styling: Tailwind CSS
- UI components: shadcn/ui
- Backend: Next.js server-side API routes
- Database: PostgreSQL
- ORM: Prisma
- LLM: Groq API
- STT: OpenAI Whisper API or a compatible transcription provider
- TTS: OpenAI TTS API
- Vector search: pgvector, if available
- Voice communication: Browser Media APIs and WebSocket where appropriate
- Validation: Zod
- Charts: Recharts

Keep the architecture modular. Do not introduce microservices, Kafka, Redis or Kubernetes into the initial MVP unless genuinely required.

## 3. Core Architecture

Implement these logical modules:

### A. Voice Interface

Create a conversational interface with:

- Microphone access.
- Start and end call controls.
- Recording/processing indicators.
- Live transcription display.
- AI response display.
- Audio playback.
- Conversation history.
- Error and connection states.

The interaction should feel conversational rather than like a form.

Implement an audio processing pipeline:

Customer microphone → Audio capture → STT → Agent orchestration → LLM response → TTS → Audio playback.

Prefer streaming where feasible. If streaming STT/TTS integration is not feasible within the MVP, implement a reliable turn-based voice interaction and clearly document the limitation.

### B. AI Agent Orchestrator

Create an agent responsible for managing the conversation.

The agent should:

- Understand customer intent.
- Extract customer requirements.
- Maintain conversation context.
- Ask relevant follow-up questions.
- Retrieve company information.
- Decide when to call backend tools.
- Generate concise spoken responses.
- Avoid inventing property information.
- Ask for clarification when information is ambiguous.

Use a well-defined system prompt.

The agent should behave as a professional, friendly real estate sales representative.

### C. Tool Calling

Implement backend tools available to the LLM:

1. search_properties
2. get_customer_history
3. save_or_update_lead
4. check_appointment_availability
5. book_appointment
6. generate_call_summary

The LLM should select tools based on customer intent.

IMPORTANT:
- The LLM must not directly access the database.
- All tool execution must happen through validated backend functions.
- Validate arguments using Zod.
- Require customer confirmation before booking.
- Prevent duplicate appointments.
- Never claim a booking succeeded unless the database confirms it.

### D. RAG Knowledge Retrieval

Create a knowledge base containing fictional real estate information.

Include at least 10 realistic property listings across Pune:

- Baner
- Hinjewadi
- Wakad
- Kharadi
- Balewadi

Each listing should contain:

- Property name
- Location
- Price
- Number of bedrooms
- Amenities
- Area
- Availability
- Description

Implement document ingestion, chunking, embeddings and retrieval where practical.

Use pgvector if supported by the environment.

For structured property filters such as price, location and bedroom count, use PostgreSQL queries.

Use semantic retrieval for descriptive questions.

Do not pretend that keyword search is vector search. If vector infrastructure is unavailable, implement a clearly identified fallback and document it.

### E. Contextual Memory

Maintain:

- Current conversation history.
- Customer requirements.
- Budget.
- Preferred location.
- Property type.
- Purchase timeline.
- Previous enquiries.

Persist important customer information in PostgreSQL.

The agent should remember details mentioned earlier in the conversation and should not repeatedly ask the same questions.

### F. Lead Qualification

Collect the following:

- Customer name.
- Phone number, if provided.
- Budget.
- Preferred location.
- Property type.
- Purchase timeline.
- Buying intent.

Implement a deterministic lead scoring system out of 100.

Suggested scoring:
- Budget matches inventory: 30 points.
- Purchase timeline: 30 points.
- Buying intent: 25 points.
- Requirement matches available properties: 15 points.

Classify:
- 75–100: HOT
- 45–74: WARM
- 0–44: COLD

Store scores and classification in the database.

### G. Sentiment Analysis

Analyse customer conversations and classify sentiment:

- Positive
- Neutral
- Negative

Store the result and make it visible in the dashboard.

Keep sentiment separate from lead qualification.

### H. Appointment Booking

Implement a functional appointment booking workflow.

The agent should:

1. Understand the requested date and time.
2. Check availability.
3. Offer alternatives if unavailable.
4. Ask for confirmation.
5. Create an appointment.
6. Confirm successful booking.

Use database-backed availability and enforce duplicate-booking protection.

Use an explicit timezone, preferably Asia/Kolkata.

### I. Call Summarisation

After the conversation, generate a structured summary containing:

- Customer requirements.
- Conversation summary.
- Lead score.
- Lead classification.
- Sentiment.
- Properties discussed.
- Appointment details.
- Follow-up recommendations.

Persist the summary.

## 4. Database Design

Design appropriate Prisma models for:

- Customer
- Lead
- Conversation
- Message
- Property
- Appointment
- CallSummary
- KnowledgeDocument

Use UUID identifiers where appropriate.

Include timestamps and proper relations.

Ensure conversation records persist across page refreshes.

## 5. Dashboard

Build a professional CRM-style dashboard.

Required pages:

### Overview
- Total calls.
- Total leads.
- Hot leads.
- Appointments booked.
- Conversion rate.
- Recent activity.
- Lead distribution chart.
- Sentiment distribution chart.

### Live Agent
- Start voice conversation.
- View transcription.
- View AI responses.
- Display conversation status.

### Leads
- Customer details.
- Budget.
- Preferred location.
- Lead score.
- Lead classification.
- Sentiment.
- Conversation history.

### Appointments
- Upcoming appointments.
- Customer details.
- Property details.
- Date and time.
- Booking status.

### Call History
- Previous conversations.
- Summaries.
- Duration, if available.
- Lead outcomes.

Use realistic demo data, but clearly distinguish seeded data from actual generated records.

## 6. Design Requirements

Create a polished, professional B2B SaaS interface.

Visual direction:
- Clean enterprise dashboard.
- Neutral colour palette.
- White/light background.
- Dark text.
- Subtle borders.
- Good spacing and typography.
- Responsive layouts.
- Minimal unnecessary animations.

Avoid generic AI landing-page aesthetics.

Prioritise dashboard usability.

## 7. Security and Reliability

Implement:

- Environment-based API keys.
- Server-side API calls.
- Input validation.
- Error handling.
- Safe database operations.
- Basic rate limiting where practical.
- Microphone permission handling.
- Explicit consent before recording or storing calls.
- Protection against duplicate bookings.
- No sensitive information in application logs.

Never expose API keys in client-side code.

## 8. Demo Workflow

The following workflow MUST work:

1. Customer opens the application.
2. Customer starts a voice conversation.
3. Customer says: "I'm looking for a 3BHK apartment in Baner under one crore."
4. Agent understands and extracts requirements.
5. Agent searches the property knowledge base.
6. Agent recommends relevant available properties.
7. Agent asks qualification questions.
8. Customer provides a purchase timeline.
9. Agent evaluates the lead.
10. Customer requests a property visit.
11. Agent checks availability.
12. Customer confirms the booking.
13. Appointment is saved in PostgreSQL.
14. Call summary and customer details are saved.
15. Dashboard displays the new lead and appointment.

This workflow takes priority over secondary features.

## 9. Engineering and Implementation Instructions

Before coding:

1. Inspect the existing repository.
2. Understand the existing structure.
3. Check available dependencies and environment.
4. Identify missing API credentials.
5. Propose a concise implementation plan.
6. Then start implementing.

Work incrementally.

After each major module:
- Run the application.
- Run TypeScript checks.
- Fix build errors.
- Test the relevant workflow.

Do not:
- Generate placeholder buttons that do nothing.
- Fake successful API responses.
- Hardcode the entire conversation.
- Claim to have implemented streaming if using batch processing.
- Leave core functionality as TODOs.
- Overengineer the architecture.
- Spend excessive time on styling before functionality works.

If an external API credential is missing, implement the integration cleanly, provide the required environment variable name, and explain how to configure it.

Create:
- README.md
- .env.example
- Prisma schema and migrations
- Seed script
- Architecture documentation
- API documentation

## 10. Architecture Documentation

Create an architecture diagram documenting:

- Browser/client.
- Audio processing.
- STT.
- LLM orchestration.
- RAG.
- Memory.
- Tool execution.
- TTS.
- PostgreSQL.
- Dashboard.

Also document how the architecture could scale to 100,000 registered users, discussing:

- Horizontal scaling.
- Load balancing.
- Stateless application servers.
- Redis.
- Message queues.
- Database optimisation.
- Background workers.
- Monitoring.
- AI inference costs.
- Telephony integration.

Clearly distinguish the MVP architecture from proposed production architecture.

## 11. Final Objective

Deliver a genuinely functional MVP that can be demonstrated in a technical evaluation.

Prioritise a complete working voice-to-business-action workflow over implementing every advanced feature.

At the end, provide:

1. Features implemented.
2. Architecture explanation.
3. Database design.
4. Setup and execution instructions.
5. Required environment variables.
6. Known limitations.
7. Suggested live demonstration sequence.
8. Potential interviewer questions and technical trade-offs.

Start by inspecting the repository and proposing the implementation plan. Then proceed with implementation without waiting for unnecessary confirmations.
