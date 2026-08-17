"use client";

import { useEffect, useState } from "react";
import { AuditLogEntry } from "@/lib/ws";
import { api } from "@/lib/api";
import { typicalDecisionLabel } from "@/lib/stats";
import { Icon } from "@/components/Icon";

export const NODE_LABELS: Record<string, string> = {
  manager: "Deciding next step",
  intake: "Gathering request details",
  await_message: "Waiting on you",
  policy_research: "Checking company policy",
  draft: "Drafting the request",
  interrupt_for_approval: "Waiting on approver",
  apply_approval: "Applying decision",
};

// Mirrors backend/app/orchestrator/vertical_employee_request.py's
// REQUIRED_FIELDS exactly -- can't import the Python list, so this is kept
// in sync by hand. Used only to compute a real capture percentage, never
// to validate (the backend remains the actual source of truth there).
const REQUIRED_FIELDS = ["category", "amount", "date", "justification", "cost_center"];

function decidedBy(auditLog: AuditLogEntry[]): string | null {
  const entry = [...auditLog].reverse().find((e) => e.event_type === "approved" || e.event_type === "rejected");
  return entry?.payload?.approver_name ?? null;
}

function requestedAt(auditLog: AuditLogEntry[]): number | null {
  const entry = auditLog.find((e) => e.event_type === "approval_requested");
  return entry ? entry.ts : null;
}

// "What the approver will see" -- per design_handoff_approval_flow/README.md,
// adapted for one real behavioral difference from the reference: that design
// has an explicit manual "Send" step; this app's orchestrator auto-submits
// once the draft is complete (no confirm interrupt exists), so the "ready to
// send" button state has no real action behind it and is dropped in favor of
// going straight from "still gathering" to "with the approver" the moment
// the backend itself makes that transition.
interface LivePanelProps {
  status: string | null;
  liveNode: string | null;
  liveDraft: Record<string, any> | null;
  streamText: string;
  auditLog: AuditLogEntry[];
}

export function LivePanel(props: LivePanelProps) {
  const { status, liveNode, liveDraft, streamText, auditLog } = props;

  const [typicalDecision, setTypicalDecision] = useState<string | null>(null);

  useEffect(() => {
    api.listRuns().then((runs) => setTypicalDecision(typicalDecisionLabel(runs as any))).catch(() => {});
  }, []);

  const draft = liveDraft ?? {};
  const capturedCount = REQUIRED_FIELDS.filter((f) => draft[f] != null && draft[f] !== "").length;
  const pct = Math.round((capturedCount / REQUIRED_FIELDS.length) * 100);
  const isDecided = status === "finalized" || status === "rejected";
  const isAwaiting = status === "awaiting_approval";
  const approver = decidedBy(auditLog);
  const waitingSince = requestedAt(auditLog);

  return (
    <aside className="w-[392px] shrink-0 h-screen sticky top-0 flex flex-col px-8 py-[26px] border-l border-hairline bg-app overflow-y-auto">
      <p className="mb-1 text-sm font-semibold text-ink tracking-[-.01em]">What your approver will see</p>
      <p className="mb-[18px] text-[13px] leading-[1.5] text-text-tertiary">
        This fills in as you answer — nothing is sent until every detail is captured.
      </p>

      <div className="bg-panel rounded-[18px] px-[22px] py-5 shadow-panel">
        <p className={`font-mono text-[28px] leading-none tracking-[-.035em] ${draft.amount != null ? "text-ink" : "text-placeholder"}`}>
          {draft.amount != null ? `$${draft.amount}` : "—"}
        </p>
        <p className="mt-[9px] mb-4 text-[13.5px] text-text-secondary">
          {draft.category ?? "Category pending"}{draft.date ? ` · ${draft.date}` : ""}
        </p>
        <div className="h-px bg-hairline-soft mb-4" />
        <div className="flex flex-col gap-[13px]">
          <Row label="Charged to" value={draft.cost_center ?? "—"} mono />
          <Row label="Routes to" value={approver ? approver : isAwaiting || isDecided ? "Approver review" : "—"} />
          {typicalDecision && <Row label="Typical decision" value={typicalDecision} />}
        </div>
      </div>

      {!isAwaiting && !isDecided && (
        <div className="mt-[22px]">
          <div className="flex items-baseline justify-between mb-[9px]">
            <span className="text-[13.5px] text-text-secondary">{capturedCount} of {REQUIRED_FIELDS.length} details captured</span>
            <span className="font-mono text-[12.5px] text-text-quaternary">{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-fill-2 overflow-hidden">
            <span className="block h-1.5 rounded-full bg-ink transition-[width] duration-[450ms]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {streamText && (
        <pre className="mt-4 text-[11px] leading-snug text-text-tertiary whitespace-pre-wrap break-words max-h-24 overflow-y-auto font-mono">
          {streamText}
        </pre>
      )}

      <div className="mt-auto pt-6">
        {isDecided ? (
          <div className={`rounded-[15px] px-[18px] py-4 ${status === "finalized" ? "bg-accent-tint" : "bg-[#F6EAE2]"}`}>
            <p className={`text-sm font-semibold mb-1 ${status === "finalized" ? "text-accent-dark" : "text-warning-strong"}`}>
              {status === "finalized" ? "Approved" : "Sent back"}
            </p>
            <p className="text-[13px] text-text-secondary">
              {approver ? `Decided by ${approver}.` : "Decision recorded."}
            </p>
          </div>
        ) : isAwaiting ? (
          <div className="h-12 rounded-[15px] bg-neutral-fill flex items-center justify-center gap-[9px] text-[14.5px] font-medium text-ink-muted">
            <span className="w-[7px] h-[7px] rounded-full bg-accent animate-breathe" />
            {waitingSince ? `With the approver since ${new Date(waitingSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "With the approver"}
          </div>
        ) : (
          <div className="h-12 rounded-[15px] border border-dashed border-placeholder flex items-center justify-center gap-[9px] text-[15px] font-semibold text-text-tertiary">
            <Icon name="lock" size={19} />
            Not ready yet
          </div>
        )}
      </div>

      {liveNode && (
        <div className="mt-4 flex items-center gap-2 text-xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          {NODE_LABELS[liveNode] ?? liveNode}
        </div>
      )}
    </aside>
  );
}

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Row(props: RowProps) {
  const { label, value, mono } = props;
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] text-text-tertiary">{label}</span>
      <span className={`text-[13.5px] font-medium text-ink-2 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
