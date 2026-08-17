"use client";

import { useState } from "react";
import { ApprovalRequestCard } from "@/lib/api";
import { AgentVisualStack } from "@/components/AgentVisuals";
import { Icon } from "@/components/Icon";

// Approver split screen -- left evidence column is the same real agent
// visuals the requester saw on their own approval card (AgentVisuals.tsx),
// right decision column is the request + approve/reject, per
// design_handoff_approval_flow/README.md's "Approver detail" spec, adapted
// to this app's real data instead of the reference's scripted example.
export function ApproverDetail({
  card,
  runId,
  onDecision,
  busy,
}: {
  card: ApprovalRequestCard;
  runId: string;
  onDecision: (approved: boolean, reason?: string) => void;
  busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const draft = card.draft;

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[470px] shrink-0 px-[30px] py-[26px] bg-app border-r border-hairline overflow-y-auto">
        <AgentVisualStack draft={draft} policyCitations={card.policy_citations} excludeRunId={runId} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-[22px] px-9 pt-[30px] pb-7 bg-surface overflow-y-auto">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-[7px] h-[26px] px-[11px] rounded-lg bg-neutral-fill text-[12px] font-semibold text-[#33302C] mb-3.5">
              <span className="w-[5px] h-[5px] rounded-full bg-accent animate-breathe" />
              Awaiting your decision
            </span>
            <h1 className="text-[32px] font-semibold tracking-[-.03em] leading-[1.1] text-ink" style={{ textWrap: "pretty" }}>
              {draft.category ?? "Request"}
            </h1>
            <p className="mt-3.5 text-sm text-text-secondary">
              {draft.requester ?? "Requester"} · sent for approval
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono text-[44px] leading-none tracking-[-.045em] text-ink">
              {draft.amount != null ? `$${draft.amount}` : "—"}
            </p>
            <p className="mt-2.5 font-mono text-[13px] text-text-tertiary">
              {draft.cost_center ?? "—"}{draft.category ? ` · ${draft.category}` : ""}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-b border-hairline-soft">
          <Fact label="Date" value={draft.date ?? "—"} />
          <Fact label="Cost center" value={draft.cost_center ?? "—"} bordered />
          <Fact label="Policy status" value={card.policy_citations.length > 0 ? "Reviewed against policy" : "No policy match found"} bordered />
        </div>

        <div>
          <p className="mb-2 text-xs text-text-tertiary">Justification</p>
          <p className="text-[16px] leading-[1.5] text-ink-2 max-w-[52ch]" style={{ textWrap: "pretty" }}>
            {draft.justification ?? "—"}
          </p>
        </div>

        <div className="mt-auto flex flex-col gap-3.5">
          {rejecting ? (
            <div className="flex flex-col gap-3 px-5 py-[18px] rounded-2xl bg-app">
              <p className="text-[13.5px] font-semibold text-ink">Tell {draft.requester ?? "the requester"} what to change</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Needs an itemised receipt before this can be approved"
                className="min-h-16 resize-none border border-control rounded-xl px-[13px] py-[11px] text-sm leading-[1.5] text-ink bg-panel outline-none"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={() => onDecision(false, reason.trim() || "Needs revision")}
                  disabled={busy}
                  className="h-11 px-5 rounded-xl bg-warning-strong text-white text-sm font-semibold hover:bg-[#763C25] disabled:opacity-50 transition-colors"
                >
                  Send it back
                </button>
                <button
                  onClick={() => { setRejecting(false); setReason(""); }}
                  className="h-11 px-[18px] rounded-xl bg-panel border border-control text-ink-muted text-sm hover:bg-app transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
                <Icon name="bolt" size={17} />
                Approving finalizes this request immediately.
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onDecision(true)}
                  disabled={busy}
                  className="flex-1 h-[54px] rounded-2xl bg-accent text-white text-base font-semibold flex items-center justify-center gap-2 shadow-teal-cta hover:bg-accent-dark disabled:opacity-50 transition-colors"
                >
                  <Icon name="check" size={21} />
                  Approve request
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  className="w-[168px] h-[54px] rounded-2xl bg-panel border border-control text-[#33302C] text-base font-medium hover:bg-app disabled:opacity-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div className={`py-4 ${bordered ? "px-5 border-l border-hairline-soft" : "pr-5"}`}>
      <p className="mb-1.5 text-xs text-text-tertiary">{label}</p>
      <p className="text-[15px] font-medium text-ink">{value}</p>
    </div>
  );
}
