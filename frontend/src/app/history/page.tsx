"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { summarize } from "@/lib/stats";
import { Sidebar } from "@/components/Sidebar";
import { MiniProgress } from "@/components/MiniProgress";
import { Icon } from "@/components/Icon";

type RunSummary = { run_id: string; status: string; requester_name: string; created_at: string; draft: Record<string, any> | null };
type RunEvent = { type: string; payload: Record<string, any>; created_at: string };
type RunDetail = { run_id: string; status: string; requester_name: string; draft: Record<string, any>; events: RunEvent[] };

// Same labels the live panel uses for the same event stream, kept local
// since this page reads finished runs via REST rather than the live
// WS/audit_event shape.
const EVENT_LABELS: Record<string, string> = {
  run_started: "Request received",
  manager_decision: "Decided next step",
  draft_updated: "Draft updated",
  clarifying_question_asked: "Asked a clarifying question",
  user_message: "Requester replied",
  state_transition: "Moved to next stage",
  policy_retrieved: "Checked company policy",
  policy_evaluated: "Evaluated against policy rules",
  draft_finalized_for_review: "Draft finalized for review",
  routing_decided: "Routed for decision",
  approval_summary_generated: "Prepared decision brief",
  approval_requested: "Sent for approval",
  approved: "Approved",
  rejected: "Rejected",
  finalized: "Finalized and submitted",
};

const EVENT_ICONS: Record<string, string> = {
  run_started: "forum",
  manager_decision: "bolt",
  draft_updated: "edit_note",
  clarifying_question_asked: "help",
  user_message: "reply",
  state_transition: "arrow_forward",
  policy_retrieved: "policy",
  policy_evaluated: "fact_check",
  draft_finalized_for_review: "fact_check",
  routing_decided: "alt_route",
  approval_summary_generated: "summarize",
  approval_requested: "send",
  approved: "check_circle",
  rejected: "undo",
  finalized: "task_alt",
};

export default function History() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
  }, [user]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-app" />;
  }

  async function openRun(runId: string) {
    const detail = await api.getRun(runId);
    setSelected(detail);
  }

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar activeRunId={selected?.run_id} />

      <div className="flex-1 flex flex-col h-screen min-w-0">
        <div className="h-14 shrink-0 flex items-center px-[34px] border-b border-hairline">
          <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Audit trail</span>
          <span className="ml-3 text-[13px] text-text-tertiary">Every state transition, retrieval, and human decision</span>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface">
          <div className="flex min-h-full">
            <div className="w-[280px] shrink-0 border-r border-hairline px-3 py-4 overflow-y-auto">
              <div className="space-y-0.5">
                {runs.map((r) => {
                  const summary = summarize(r.draft);
                  const active = selected?.run_id === r.run_id;
                  return (
                    <button
                      key={r.run_id}
                      onClick={() => openRun(r.run_id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${
                        active ? "bg-ink text-white" : "text-ink-2 hover:bg-neutral-fill/40"
                      }`}
                    >
                      <div className="font-medium truncate">{summary ?? "New request"}</div>
                      <div className={`text-xs truncate ${active ? "text-text-quaternary" : "text-text-tertiary"}`}>
                        {r.requester_name} · {r.status.replace("_", " ")}
                      </div>
                      <MiniProgress status={r.status} />
                    </button>
                  );
                })}
                {runs.length === 0 && <p className="px-3 text-sm text-text-tertiary">No runs yet.</p>}
              </div>
            </div>

            <div className="flex-1 min-w-0 px-9 py-8">
              {selected ? (
                <div className="max-w-2xl">
                  <p className="mb-1 text-[13px] font-mono text-text-quaternary">REQ-{selected.run_id.slice(0, 4).toUpperCase()}</p>
                  <h2 className="mb-6 text-xl font-semibold text-ink tracking-[-.01em]">
                    {selected.draft?.category ?? "Request"} · {selected.requester_name}
                  </h2>

                  <div className="relative pl-7">
                    <div className="absolute left-[10px] top-1 bottom-1 w-px bg-hairline-soft" />
                    <div className="flex flex-col gap-5">
                      {selected.events.map((e, i) => (
                        <div key={i} className="relative">
                          <span className="absolute -left-7 top-0.5 w-5 h-5 rounded-full bg-card shadow-card flex items-center justify-center text-ink-2">
                            <Icon name={EVENT_ICONS[e.type] ?? "circle"} size={12} filled={false} />
                          </span>
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="text-sm font-medium text-ink-2">{EVENT_LABELS[e.type] ?? e.type}</span>
                            <span className="font-mono text-[11.5px] text-text-quaternary shrink-0">
                              {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>
                          {Object.keys(e.payload).length > 0 && (
                            <pre className="mt-1.5 text-[11.5px] text-text-tertiary bg-card rounded-lg px-3 py-2 whitespace-pre-wrap font-mono overflow-x-auto">
                              {JSON.stringify(e.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-tertiary">Select a request to see its full trail.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
