# Internal-Ops Agent Orchestration Platform — MVP Spec

## Purpose
A demo-able, generic internal request/approval workflow agent — the sales tool for AI-transformation/implementation consulting engagements. Not a SaaS product launch. Structurally inspired by SK AX's platform+vertical pattern (public info only), independently built.

## The demo scenario (fixed for MVP)
**"Employee Request Assistant"** — genuinely generic, works as a stand-in for procurement, IT access, expense approval, or HR requests. Don't pick a vertical yet; let the first real client tell you which one they need.

Flow:
1. Employee describes a request in plain language in chat ("I need approval to expense a $2,400 conference ticket")
2. Agent asks clarifying questions if info is missing (cost center, date, business justification)
3. Agent searches a small reference corpus (mock company policy docs) for relevant rules/precedent — **this is where Lexara's retrieval work gets reused directly**, don't rebuild it
4. Agent drafts a structured request object (not prose — an actual schema: requester, amount, category, justification, policy references)
5. Agent **stops** and presents the draft to a human approver as a card, not free text — waits (suspend)
6. Approver approves/rejects/edits in the UI → agent resumes, finalizes, "submits" to a mock downstream system
7. Full run history is visible — this is your differentiator to show a client: not just an answer, an auditable decision trail

## Explicit scope boundaries — MVP does NOT include
Cutting these isn't losing ambition, it's what makes this shippable instead of another abandoned repo:
- ❌ Java/Spring or Go — Python + Next.js only for MVP. Those are Phase 2+, added only once this is demo-ready and land a client that would benefit from a polyglot story.
- ❌ Multi-tenant billing, user signup flows, subscription logic — this is a demo you drive personally, not a product with self-serve customers
- ❌ Kafka/RabbitMQ, Kubernetes, Redis — single Postgres, single deployable service is enough for a demo
- ❌ Real integrations to real systems (Slack, Jira, SAP, etc.) — the "submit" step is mocked; a client engagement is where you'd wire a real integration, billed separately
- ❌ Multiple simultaneous workflow types — one workflow, done well, beats three done shallowly for a first demo

## Architecture (MVP)

```
Next.js (chat UI + structured cards, streaming)
        │
        ▼
FastAPI backend (single service)
   ├── Orchestrator (LangGraph) — state machine: gather → retrieve → draft → await_approval → finalize
   ├── Retrieval service — reuse Lexara's hybrid BM25+pgvector+rerank pattern, pointed at a small policy-doc corpus
   ├── LLM adapter — thin wrapper, swappable provider (mirrors the "provider is config not code" lesson from SK AX)
   └── Run store — Postgres table logging every state transition (this IS the audit trail you'll demo)
        │
        ▼
Postgres (+ pgvector) — same pattern as Lexara, same free-tier hosting decision applies here
```

**Platform/vertical separation, scoped for MVP:** don't over-engineer a plugin system for one workflow. Instead, write the orchestrator's state machine and tool-calling generically (no hardcoded "expense" logic in the core loop), and put all "Employee Request Assistant"-specific logic (schema, prompts, mock policy docs) in one clearly separated module. That's the seed of the real platform/vertical split without building infrastructure you don't need yet.

## Core technical pieces, in build order

1. **State machine** (LangGraph or hand-rolled if you want less framework lock-in) with explicit states: `gathering`, `retrieving`, `drafting`, `awaiting_approval`, `finalized`, `rejected`. Persist state to Postgres so a run can be resumed after the process restarts — this suspend/resume behavior is the single most important thing to get right, it's your core differentiator.
2. **Retrieval service** — literally port the Lexara pattern (hybrid BM25 + pgvector, RRF, optional rerank) against a small set of mock policy docs (5-10 fake but realistic company policy pages). Low effort since you've already solved this.
3. **Structured "card" protocol** — define a small set of card types the backend can emit over the stream: `clarifying_question`, `approval_request`, `final_confirmation`. Frontend renders whichever one matches. This doesn't need to be elaborate — a discriminated union in the streamed JSON is enough.
4. **Next.js chat UI** — streaming, renders text + the card types above. Reuse Lexara's frontend patterns/conventions where sensible (you already have a working streaming chat UI there).
5. **Mock approver view** — a second simple view (could even be the same UI, role-switched) where "the approver" sees pending requests and can approve/reject/edit.
6. **Run history / audit view** — a page listing past runs with their full state-transition trail. This is what you screen-record for the demo video — it's the part that makes this look like real engineering, not a chatbot wrapper.

## Data model (sketch)
- `runs` — id, workflow_type, status, created_at, requester
- `run_events` — run_id, state, payload (jsonb), timestamp — your audit trail
- `policy_docs` — id, title, content, embedding (pgvector) — mirrors Lexara's document_chunks table

## Definition of "demo-ready"
You can screen-record, start to finish, without narrating around gaps:
- [ ] Employee submits a request in natural language
- [ ] Agent asks at least one clarifying question convincingly
- [ ] Agent retrieves and cites a specific mock policy doc in its draft
- [ ] Draft renders as a structured card, not a paragraph
- [ ] Run visibly pauses waiting for approval (not instant — this needs to be legible in a screen recording)
- [ ] Approver can approve or reject with a reason
- [ ] Run history page shows the full trail afterward

## What I need from you before/while building
- Nothing blocking — I can start scaffolding with sensible defaults (the scenario above, mock policy docs I'll draft) unless you want to swap the specific workflow flavor
- If you get a lead on a real first client/vertical mid-build, tell me — we bend the mock scenario toward their world before the demo, not after

## Explicit non-goals for this doc
This is the MVP build spec, not the GTM plan (already covered: LinkedIn demo posts, warm network outreach, free discovery calls) and not the Phase 2 polyglot plan (Java/Spring, Go — revisit only after a real client engagement justifies it).
