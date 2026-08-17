"use client";

import { useEffect, useState } from "react";
import { api, PolicyCitationCard } from "@/lib/api";
import { approvalConfidence, comparableDecisions, extractPolicyCap } from "@/lib/stats";

// The four agent-visual cards this app can build for real from data it
// actually has (RAG policy citations, run history for comparables/
// confidence, and dollar figures regex-parsed from real seeded policy
// text). Two visuals from design_handoff_approval_flow/README.md --
// invoice extraction and budget burn-down -- are deliberately not built:
// the first needs a real file-upload + vision-extraction pipeline that
// doesn't exist, the second needs a new cost-center budget schema. Both
// would otherwise have to be faked, which the brief explicitly ruled out.
//
// Shared by CardRenderer.tsx (requester's own view, the moment their
// request reaches awaiting_approval) and ApproverDetail.tsx (the
// approver's evidence column) so the same real computation renders
// identically in both places instead of being duplicated.

const CARD = "bg-card rounded-2xl px-5 py-[18px] shadow-card";
const HEADER = "flex items-baseline justify-between mb-[15px]";
const TITLE = "text-[13.5px] font-semibold text-ink";
const META = "font-mono text-[11.5px] text-text-quaternary";

export function RoutingVisual({ policyChecked }: { policyChecked: boolean }) {
  return (
    <div className={CARD}>
      <div className={HEADER}>
        <span className={TITLE}>Where this goes next</span>
        <span className={META}>3 steps</span>
      </div>
      <div className="flex items-start">
        <RouteNode label="Filed by you" done />
        <RouteConnector done />
        <RouteNode label="Policy checked" done={policyChecked} active={!policyChecked} />
        <RouteConnector done={policyChecked} />
        <RouteNode label="Approver decides" active={policyChecked} />
      </div>
      <p className="mt-4 text-[13px] text-text-tertiary">
        Every request routes to the approver queue -- there's no auto-approve tier yet.
      </p>
    </div>
  );
}

export function PolicyCheckVisual({ citations }: { citations: PolicyCitationCard[] }) {
  if (citations.length === 0) {
    return (
      <div className={CARD}>
        <div className={HEADER}>
          <span className={TITLE}>Company policy</span>
        </div>
        <p className="text-[13.5px] text-text-secondary">No matching company policy was retrieved for this request.</p>
      </div>
    );
  }
  return (
    <div className={CARD}>
      <div className={HEADER}>
        <span className={TITLE}>Company policy</span>
        <span className={META}>{citations.length} match{citations.length === 1 ? "" : "es"}</span>
      </div>
      <div className="space-y-2.5">
        {citations.map((c, i) => (
          <div key={i} className="flex gap-[11px]">
            <span className="w-4 h-4 mt-0.5 shrink-0 rounded-[5px] bg-ink-3 text-app text-[10.5px] leading-4 text-center">✓</span>
            <p className="text-[12.5px] leading-[1.45] text-ink-2">
              <span className="font-medium">{c.title}</span>{" "}
              <span className="text-text-tertiary">· {c.excerpt}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CostCapVisual({ amount, cap }: { amount: number; cap: number }) {
  const overCap = amount > cap;
  return (
    <div className={CARD}>
      <div className={HEADER}>
        <span className={TITLE}>Amount vs. policy cap</span>
        <span className={META}>cap ${cap.toLocaleString()}</span>
      </div>
      <div className="h-[9px] rounded-full bg-neutral-fill-2 overflow-hidden">
        <span
          className={`block h-[9px] rounded-full ${overCap ? "bg-warning-strong" : "bg-accent"}`}
          style={{ width: `${Math.min(100, (amount / cap) * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] text-text-tertiary">
        {overCap ? "Above the cap this policy states." : "Within the cap this policy states."}
      </p>
    </div>
  );
}

export function LikelyOutcomeVisual({ confidence }: { confidence: { approved: number; total: number; pct: number } }) {
  return (
    <div className={CARD}>
      <div className={HEADER}>
        <span className={TITLE}>
          {confidence.pct >= 50 ? "Likely to be approved" : "Mixed history for this category"}
        </span>
        <span className="font-mono text-[11.5px] text-accent-dark">{confidence.approved} of {confidence.total} similar</span>
      </div>
      <div
        className="relative h-2.5 rounded-full"
        style={{ background: "linear-gradient(90deg,#EAE1D2 0%,#CFE3DD 55%,#0E7A68 100%)" }}
      >
        <span className="absolute top-[-7px] w-0.5 h-6 rounded bg-ink" style={{ left: `${confidence.pct}%` }} />
      </div>
      <div className="flex justify-between mt-3 text-[12.5px] text-text-quaternary">
        <span>Sent back</span><span>Approved</span>
      </div>
    </div>
  );
}

export function ComparableDecisionsVisual({ category, decisions }: { category: string | undefined; decisions: ReturnType<typeof comparableDecisions> }) {
  return (
    <div className={CARD}>
      <div className={HEADER}>
        <span className={TITLE}>Past decisions on {category ?? "similar"} requests</span>
      </div>
      {decisions.length > 0 ? (
        <>
          <div className="grid grid-cols-[1.6fr_.8fr_1fr] gap-2.5 pb-2 font-mono text-[11px] font-medium tracking-[.06em] text-text-quaternary">
            <span>REQUEST</span><span>AMOUNT</span><span>OUTCOME</span>
          </div>
          {decisions.map((r) => (
            <div
              key={r.run_id}
              className={`grid grid-cols-[1.6fr_.8fr_1fr] gap-2.5 py-[9px] border-t border-hairline-soft text-[13px] items-center ${
                r.status === "rejected" ? "text-warning-ink" : "text-ink-2"
              }`}
            >
              <span className="truncate">{r.draft?.category ?? "Request"}</span>
              <span className="font-mono text-[12.5px]">${r.draft?.amount ?? "—"}</span>
              <span className="capitalize">{r.status === "finalized" ? "Approved" : "Rejected"}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="text-[13px] text-text-tertiary">No prior decisions for this category yet.</p>
      )}
    </div>
  );
}

// Convenience bundle: fetches the run history once and renders whichever
// visuals have real data to show, in spec order (routing -> policy ->
// cost cap -> comparables -> likely outcome). Used by both the requester's
// own approval card and the approver's evidence column so they render
// identically from the same computation.
export function AgentVisualStack({
  draft,
  policyCitations,
  excludeRunId,
}: {
  draft: Record<string, any>;
  policyCitations: PolicyCitationCard[];
  excludeRunId?: string;
}) {
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    api.listRuns().then(setRuns).catch(() => {});
  }, []);

  const cap = extractPolicyCap(policyCitations.map((c) => c.excerpt), draft.amount);
  const comparable = comparableDecisions(runs as any, draft.category, excludeRunId);
  const confidence = approvalConfidence(runs as any, draft.category);

  return (
    <div className="flex flex-col gap-3.5">
      <RoutingVisual policyChecked={policyCitations.length > 0} />
      <PolicyCheckVisual citations={policyCitations} />
      {cap != null && draft.amount != null && <CostCapVisual amount={draft.amount} cap={cap} />}
      <ComparableDecisionsVisual category={draft.category} decisions={comparable} />
      {confidence && <LikelyOutcomeVisual confidence={confidence} />}
    </div>
  );
}

function RouteNode({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="w-[86px] shrink-0 flex flex-col items-center gap-2">
      <span
        className={`w-8 h-8 rounded-[11px] flex items-center justify-center ${
          done ? "bg-ink text-white" : active ? "bg-accent" : "border-[1.5px] border-dashed border-placeholder"
        }`}
      >
        {active && !done && (
          <span className="flex gap-[3px]">
            <span className="w-1 h-1 rounded-full bg-white" />
            <span className="w-1 h-1 rounded-full bg-white/60" />
            <span className="w-1 h-1 rounded-full bg-white/30" />
          </span>
        )}
      </span>
      <span className={`text-[12px] font-medium text-center ${active ? "text-accent-dark" : "text-ink-muted"}`}>{label}</span>
    </div>
  );
}

function RouteConnector({ done }: { done?: boolean }) {
  return (
    <span
      className="flex-1 h-[1.5px] mt-4"
      style={{
        background: done ? "#191817" : "repeating-linear-gradient(90deg, #C6C0B7 0 4px, transparent 4px 9px)",
      }}
    />
  );
}
