"use client";

import { useState } from "react";
import { api, ApprovalRequestCard } from "@/lib/api";
import { AgentVisualStack } from "@/components/AgentVisuals";
import { Icon } from "@/components/Icon";
import { EVENT_ICONS, EVENT_LABELS } from "@/lib/auditEvents";

type RunEvent = { type: string; payload: Record<string, any>; created_at: string };

interface ApproverDetailProps {
  card: ApprovalRequestCard;
  runId: string;
  onDecision: (approved: boolean, reason?: string) => void;
  busy: boolean;
}

// Approver/Reviewer split screen. Panel order follows the same rule as the
// requester's own view (page.tsx): the interactive area sits in panel 2
// (nearest the rail), read-only reference material in panel 3. Here that
// means the decision column -- the request facts + approve/send-back
// composer, the only place a decider actually acts or sends text back --
// is panel 2, and the evidence column -- the agent transcript + policy/
// routing visuals, all replay of what already happened -- is panel 3.
// Shared by both roles -- which run shows up here at all is decided
// upstream by routed_to (see Sidebar.tsx).
export function ApproverDetail(props: ApproverDetailProps) {
  const { card, runId, onDecision, busy } = props;

  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"transcript" | "trace">("transcript");
  const [trace, setTrace] = useState<RunEvent[] | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // Lazy, once per runId -- most decisions never open Trace, so this skips
  // an extra request on the common path. Audit trail lived only as its own
  // rail tab before; this surfaces the same data where a decider is
  // already looking, without duplicating /history's fuller cross-run view.
  function openTrace() {
    setTab("trace");
    if (trace !== null || traceLoading) return;
    setTraceLoading(true);
    api.getRun(runId).then((run) => setTrace(run.events)).catch(() => setTrace([])).finally(() => setTraceLoading(false));
  }

  const draft = card.draft;

  const requesterInitials = (draft.requester ?? "?")
    .trim()
    .split(/\s+/)
    .map((p: string) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col gap-[22px] px-9 pt-[30px] pb-7 bg-surface overflow-y-auto">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-3.5">
              <span className="inline-flex items-center gap-[7px] h-[26px] px-[11px] rounded-lg bg-neutral-fill text-[12px] font-semibold text-[#33302C]">
                <span className="w-[5px] h-[5px] rounded-full bg-accent animate-breathe" />
                Awaiting your decision
              </span>
              {draft.urgent && (
                <span className="inline-flex items-center h-[26px] px-[11px] rounded-lg bg-[#F6EAE2] text-[12px] font-semibold text-warning-strong">
                  Urgent
                </span>
              )}
            </div>
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
          <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
            <Icon name="bolt" size={17} />
            Approving finalizes this request immediately.
          </div>
          <button
            onClick={() => onDecision(true)}
            disabled={busy}
            className="h-[54px] rounded-2xl bg-accent text-white text-base font-semibold flex items-center justify-center gap-2 shadow-teal-cta hover:bg-accent-dark disabled:opacity-50 transition-colors"
          >
            <Icon name="check" size={21} />
            Approve request
          </button>

          {/* The real message channel to the requester: there's no
              free-form decider->requester chat in the backend
              (ws_runs.py's "message" action requires _owner_or_admin, so
              only the requester can use it) -- a decider's only path to
              send text back is the reject `reason` field. This composer is
              that field, kept persistently visible instead of hidden
              behind an extra "Reject" click, so each role has a real chat
              area rather than a bare pair of buttons. */}
          <div className="flex items-center gap-2 border border-control rounded-2xl bg-panel px-[14px] py-[10px]">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) onDecision(false, note.trim() || "Needs revision");
              }}
              placeholder={`Send back with a note for ${draft.requester ?? "the requester"}...`}
              className="flex-1 min-w-0 text-sm text-ink bg-transparent outline-none placeholder:text-text-tertiary"
            />
            <button
              onClick={() => onDecision(false, note.trim() || "Needs revision")}
              disabled={busy}
              title="Send back"
              className="shrink-0 w-9 h-9 rounded-xl bg-warning-strong text-white flex items-center justify-center hover:bg-[#763C25] disabled:opacity-50 transition-colors"
            >
              <Icon name="undo" size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="w-[470px] shrink-0 flex flex-col bg-app border-l border-hairline overflow-hidden">
        <div className="shrink-0 flex items-center gap-1 px-[22px] pt-[18px]">
          <SubTab label="Transcript" active={tab === "transcript"} onClick={() => setTab("transcript")} />
          <SubTab label="Trace" active={tab === "trace"} onClick={openTrace} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-[30px] py-[22px]">
          {tab === "transcript" ? (
            <>
              {card.transcript && card.transcript.length > 0 && (
                <div className="mb-6">
                  <p className="font-mono text-[11px] font-medium text-text-tertiary uppercase tracking-[.12em]">
                    What the agent established
                  </p>
                  <p className="mt-1 mb-4 text-[13px] text-text-tertiary">
                    The real conversation that produced this request.
                  </p>
                  <div className="flex flex-col gap-3">
                    {card.transcript.map((entry, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span
                          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                            entry.from === "requester" ? "bg-neutral-fill text-ink-2" : "bg-ink text-app"
                          }`}
                        >
                          {entry.from === "requester" ? requesterInitials : <Icon name="smart_toy" size={13} filled />}
                        </span>
                        <p className="text-[13px] leading-[1.5] text-ink-2 pt-0.5">{entry.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="h-px bg-hairline-soft mt-5" />
                </div>
              )}
              <AgentVisualStack
                draft={draft}
                policyCitations={card.policy_citations}
                policyEvaluation={card.policy_evaluation}
                routingDecision={card.routing_decision}
                approvalSummary={card.approval_summary}
                excludeRunId={runId}
              />
            </>
          ) : traceLoading || trace === null ? (
            <p className="text-[13px] text-text-tertiary">Loading trace...</p>
          ) : trace.length === 0 ? (
            <p className="text-[13px] text-text-tertiary">No events yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {trace.map((e, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-fill flex items-center justify-center mt-0.5">
                    <Icon name={EVENT_ICONS[e.type] ?? "circle"} size={12} filled={false} className="text-ink-2" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink-2">{EVENT_LABELS[e.type] ?? e.type}</p>
                    <p className="text-[11px] font-mono text-text-tertiary mt-0.5">
                      {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SubTabProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function SubTab(props: SubTabProps) {
  const { label, active, onClick } = props;
  return (
    <button
      onClick={onClick}
      className={`px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors ${
        active ? "bg-neutral-fill text-ink" : "text-text-tertiary hover:text-ink-muted"
      }`}
    >
      {label}
    </button>
  );
}

interface FactProps {
  label: string;
  value: string;
  bordered?: boolean;
}

function Fact(props: FactProps) {
  const { label, value, bordered } = props;
  return (
    <div className={`py-4 ${bordered ? "px-5 border-l border-hairline-soft" : "pr-5"}`}>
      <p className="mb-1.5 text-xs text-text-tertiary">{label}</p>
      <p className="text-[15px] font-medium text-ink">{value}</p>
    </div>
  );
}
