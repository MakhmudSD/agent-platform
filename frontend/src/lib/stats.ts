// Real, derived statistics computed client-side from the run list the app
// already fetches (GET /runs returns up to 50 most recent runs regardless
// of owner -- see backend/app/routes/runs.py). Nothing here is invented or
// hardcoded; every number comes from actual historical runs, or the
// function returns null so the caller can omit the row entirely rather
// than show a fabricated placeholder.

type RunLike = {
  run_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  draft: Record<string, any> | null;
};

// What a request "is" for list purposes -- category + amount if the agent's
// gathered that far, otherwise null (caller shows a placeholder). Was
// defined identically in both Sidebar.tsx and history/page.tsx; a future
// tweak to this shape would otherwise have to be made in two places.
export function summarize(draft: Record<string, any> | null): string | null {
  if (!draft?.category) return null;
  const amount = draft.amount != null ? ` · $${draft.amount}` : "";
  return `${draft.category}${amount}`;
}

function formatDurationHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 20) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// updated_at is bumped by the DB on every write (SQLAlchemy onupdate); for
// a terminal run that last write *is* the decision, so created_at ->
// updated_at is a real proxy for decision latency, not a guess.
export function typicalDecisionLabel(runs: RunLike[]): string | null {
  const decided = runs.filter((r) => r.status === "finalized" || r.status === "rejected");
  const durationsMs = decided
    .map((r) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (durationsMs.length === 0) return null;

  const avgMs = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  const hours = avgMs / 3_600_000;
  if (hours < 6) return "Same day";
  return `~${formatDurationHours(hours)}`;
}

// Same created_at -> updated_at proxy as typicalDecisionLabel, but for one
// run -- the design's comparable-decisions table has a "decided in" column
// per row, not just an aggregate.
export function decisionLatencyLabel(run: RunLike): string | null {
  const ms = new Date(run.updated_at).getTime() - new Date(run.created_at).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return formatDurationHours(ms / 3_600_000);
}

// Past decisions on requests in the same category -- real rows from the
// run list, most recent first, capped for display.
export function comparableDecisions(runs: RunLike[], category: string | undefined, excludeRunId?: string, limit = 3) {
  if (!category) return [];
  return runs
    .filter((r) => r.draft?.category === category && (r.status === "finalized" || r.status === "rejected"))
    .filter((r) => !excludeRunId || (r as any).run_id !== excludeRunId)
    .slice(0, limit);
}

// Pulls dollar figures out of the actual retrieved policy excerpt text
// (backend/app/data/policy_docs/seed_docs.py has real caps like "$3,000" /
// "$1,500" baked into the policy prose) and returns the smallest one at or
// above the request amount -- a real regex read of real policy text, not an
// invented number. Returns null rather than guessing when no cap is found.
export function extractPolicyCap(excerpts: string[], amount: number | null | undefined): number | null {
  const amounts = excerpts
    .join(" ")
    .match(/\$([\d,]+(?:\.\d+)?)/g)
    ?.map((m) => Number(m.replace(/[$,]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0) ?? [];
  if (amounts.length === 0) return null;
  const aboveAmount = amount != null ? amounts.filter((n) => n >= amount) : amounts;
  const pool = aboveAmount.length > 0 ? aboveAmount : amounts;
  return Math.min(...pool);
}

// A real statistical confidence, not a model score: the approve rate among
// past decided requests in the same category. Returns null (not a fake
// midpoint like 50%) when there's no history to base it on.
export function approvalConfidence(runs: RunLike[], category: string | undefined): { approved: number; total: number; pct: number } | null {
  const comparable = runs.filter((r) => r.draft?.category === category && (r.status === "finalized" || r.status === "rejected"));
  if (comparable.length === 0) return null;
  const approved = comparable.filter((r) => r.status === "finalized").length;
  return { approved, total: comparable.length, pct: Math.round((approved / comparable.length) * 100) };
}
