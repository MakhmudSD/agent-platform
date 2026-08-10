# Employee Request Assistant — MVP

Internal-ops agent orchestration demo. Full spec: `docs/mvp-spec.md`.

Generic request/approval workflow with a real suspend/resume state machine
(persisted to Postgres, not in-memory) and an auditable event trail of every
transition. Retrieval reuses Lexara's hybrid BM25+pgvector+RRF pattern
against a mock policy-doc corpus.

## Status
Backend logic is tested (state machine verified end-to-end with mocked LLM
calls — see the test block referenced below). Frontend type-checks and
production-builds clean. **Not yet run against a live database** — needs a
real Postgres with the `pgvector` extension and an OpenAI API key to
actually execute.

## Run it

### 1. Database
Needs Postgres with `pgvector`. Easiest free option: a Supabase project
(same recommendation as Lexara's hosting fix — pgvector is native there).
Get the connection string.

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL and OPENAI_API_KEY
pip install -r requirements.txt
python -m app.data.seed    # creates tables + embeds the mock policy corpus
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Try: *"I need to expense a conference ticket, about $2400"*
— the agent will ask a clarifying question, retrieve the relevant mock policy,
draft a structured request, and stop for your approval. Check `/history`
afterward to see the full event trail.

## What's real vs. what's mocked
- **Real**: the state machine, the suspend/resume persistence, the hybrid
  retrieval, the structured card protocol, the audit trail.
- **Mocked**: the policy corpus (5 fake company policies), the "submission"
  step (finalizing just changes status — no real downstream system).

That split is intentional — see `docs/mvp-spec.md` for what's explicitly
out of scope for this MVP and why.
