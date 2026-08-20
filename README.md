# AX Platform

Internal-ops agent orchestration platform: employees describe a request in
plain language, a LangGraph orchestrator routes it through policy retrieval,
drafting, and role-based approval (Requester → Approver/Reviewer → Admin),
with every state transition persisted to Postgres — not an in-memory demo.

**Live**: [agent-platform-sooty.vercel.app](https://agent-platform-sooty.vercel.app)
Backend API: `https://ax-platform-backend.onrender.com`
Demo accounts (all password `demo1234`): `requester@acme-demo.com` ·
`approver@acme-demo.com` · `reviewer@acme-demo.com` · `admin@acme-demo.com`

> Backend is on Render's free tier, which spins down after ~15 min idle —
> the first request after a quiet period can take up to ~50s to wake up.
> That's a hosting-tier tradeoff, not a bug.

## Architecture

```
┌─────────────────┐      HTTPS       ┌──────────────────────┐      ┌───────────────────┐
│  Next.js / React │ ───────────────▶│  FastAPI backend      │─────▶│  Postgres (Supabase)│
│  Vercel          │◀─────────────── │  Render               │◀─────│  session pooler,    │
│                  │  session cookie │  LangGraph orchestrator│      │  pgvector          │
└─────────────────┘  (cross-site)    └──────────┬───────────┘      └───────────────────┘
                                                  │
                                                  ▼
                                        Gemini 3.6 Flash
                                        (gemini-3.6-flash, pinned)
```

Frontend and backend are deployed to **different domains**, which matters —
see the incident writeup below.

## What it does

- **Requester**: describes a request in natural language; the orchestrator
  asks clarifying questions, retrieves relevant policy (hybrid BM25 +
  pgvector + RRF over a seeded policy corpus), drafts a structured request,
  and routes it to an approver or a specialist reviewer based on policy
  rules (with a visible routing rationale and confidence).
- **Approver / Reviewer**: sees the full transcript, policy citations, and
  an AI-generated approval summary; approves or sends back with a reason.
- **Admin**: separate console (`/admin`) — user management (create, change
  role, delete, with lockout guards against self-demotion and deleting the
  last admin), all requests across every account, real per-node/per-day
  token usage and cost (USD + KRW, derived from actual `token_usage`
  events, not estimated), and conversation feedback (thumbs up/down with
  admin replies that notify the original rater).
- Every role gets a notification feed, per-type notification preferences,
  a per-agent "user guide" explainer (modal + standalone `/help` page), and
  folder-based conversation organization.

## Stack

- **Backend**: FastAPI, SQLAlchemy, LangGraph (suspend/resume state machine
  persisted to Postgres — a rejected/approved run's full history survives a
  server restart), `gemini-3.6-flash` pinned to a dated model name (not a
  floating alias — see `core/config.py` for why), JWT session auth via
  httpOnly cookie, bcrypt password hashing.
- **Frontend**: Next.js App Router, TypeScript, Tailwind.
- **Data**: Postgres with `pgvector`, hosted on Supabase (free tier, IPv4
  session pooler — Render's free tier can't reach Supabase's direct IPv6
  endpoint).
- **Hosting**: Vercel (frontend) + Render (backend) + Supabase (Postgres),
  all free tier.

## Incident: cross-site session cookies (found and fixed during this deploy)

**What broke**: after splitting the frontend (Vercel) and backend (Render)
onto separate domains, login appeared to succeed — the response set a
session cookie — but every subsequent authenticated request came back
`401`/"Not authenticated," including on the admin console.

**Root cause**: the session cookie was set with `SameSite=Lax`. Browsers
only attach `Lax` cookies on same-site requests (or top-level navigations);
a `fetch(..., { credentials: "include" })` call from `agent-platform-sooty.
vercel.app` to `ax-platform-backend.onrender.com` is cross-site, so the
cookie was silently dropped on every API call after the initial login
response set it. Locally this never surfaced because frontend and backend
both ran on `localhost` (same-site by the browser's definition).

**Fix**: added a `COOKIE_SECURE` setting, gated by environment. When true
(set on Render), the cookie is issued as `SameSite=None; Secure` — the only
combination browsers honor for cross-site requests, and `Secure` is only
valid because both hosts are HTTPS. Local dev keeps the default
`SameSite=Lax` / non-secure cookie, since `localhost` over plain HTTP would
reject a `Secure` cookie outright. `logout`'s `delete_cookie` was updated to
match the same attributes — mismatched `SameSite`/`Secure` on delete can
leave a cookie that a browser won't actually clear.

## Run it locally

### 1. Database
Postgres with the `pgvector` extension. A free Supabase project works, or
local Postgres with the extension enabled.

### 2. Backend
```bash
cd backend
cp .env.example .env   # DATABASE_URL, GEMINI_API_KEY, JWT_SECRET_KEY
pip install -r requirements.txt
python -m app.data.seed    # creates tables, seeds demo accounts + policy corpus
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Open `http://localhost:3000`. Try: *"I need to expense a conference ticket,
about $2400"* — the agent asks a clarifying question, retrieves the
relevant mock policy, drafts a structured request, and stops for approval.

## What's real vs. what's mocked
- **Real**: the state machine, suspend/resume persistence, hybrid
  retrieval, structured card protocol, audit trail, admin console, cost
  tracking, notifications, live deployment.
- **Mocked**: the policy corpus (5 seeded company policies) and the
  "submission" step (finalizing changes status; no real downstream ERP/HR
  system to submit into).

Full original MVP scope: `docs/mvp-spec.md`.
