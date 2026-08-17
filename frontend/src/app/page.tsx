"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, PolicyCitationCard, PolicyRuleCard, RoutingDecision } from "@/lib/api";
import { AuditLogEntry, LiveEvent, RunSocket } from "@/lib/ws";
import { CardRenderer } from "@/components/CardRenderer";
import { Sidebar } from "@/components/Sidebar";
import { LivePanel, NODE_LABELS } from "@/components/LivePanel";
import { RunProgress } from "@/components/RunProgress";
import { ApproverDetail } from "@/components/ApproverDetail";
import {
  ApprovalSummaryVisual, PolicyCheckVisual, RoutingDecisionVisual, RoutingVisual,
} from "@/components/AgentVisuals";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth";

// The design's core idea -- "the agent answers with visuals instead of
// paragraphs" -- means each real agent moment renders inline in the thread
// as it happens, not bundled at the end on the approval card: routing
// after the first clarifying question, policy-check as citations then the
// real rule checklist, the Escalation/Routing Agent's decision the moment
// it fires, and the Approval-Summary Agent's brief right after.
type Turn =
  | { from: "user" | "agent"; card?: Card; text?: string }
  | { from: "agent"; visual: "routing"; policyChecked: boolean; routedTo?: "approver" | "reviewer" }
  | { from: "agent"; visual: "policy_check"; citations: PolicyCitationCard[]; evaluation: PolicyRuleCard[] }
  | { from: "agent"; visual: "routing_decision"; decision: RoutingDecision }
  | { from: "agent"; visual: "approval_summary"; summary: string };

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  // Admin can act as either decider (matches the rest of the app's
  // admin-bypasses-ownership pattern). Approver and Reviewer each get the
  // same split evidence/decision screen -- which requests actually show up
  // in their queue is what differs, decided server-side by routed_to (see
  // Sidebar.tsx and core/deps.py's can_decide).
  const isApprover = user?.role === "approver" || user?.role === "admin";
  const isReviewer = user?.role === "reviewer";
  const isDecider = isApprover || isReviewer;

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // Live panel state -- driven entirely by events streamed over the socket,
  // not by the REST card responses (those still arrive too, as the final
  // "result" message, and are what actually advances `turns`).
  const [liveNode, setLiveNode] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState<Record<string, any> | null>(null);
  const [streamText, setStreamText] = useState("");
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  // Bumped whenever a WS "result" lands, so Sidebar knows to refetch its
  // pending-approval list -- otherwise a just-approved/rejected run lingers
  // in that list until role or activeRunId happens to change.
  const [refreshKey, setRefreshKey] = useState(0);
  // Client-observed timestamp used only for RunProgress's elapsed clock --
  // not persisted, not authoritative, just "when this browser tab first saw
  // this run start."
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const socketRef = useRef<RunSocket | null>(null);
  // Guards the routing visual to one appearance per run -- the backend
  // event it's keyed off (clarifying_question_asked) can fire once per
  // missing field, but "here's where this goes next" is only news once.
  const routingShownRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    // /ws/runs authenticates off the session cookie at connect time -- opening
    // it before login resolves would just get rejected and closed immediately.
    if (!user) return;
    const socket = new RunSocket(handleEvent, () => {
      setWsError("Connection to the server was lost. Refresh the page to reconnect.");
      setBusy(false);
      setLiveNode(null);
    });
    socketRef.current = socket;
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Replaces the existing inline "policy_check" turn in place (keeping its
  // position in the thread) rather than appending, so a retry or a later
  // rule evaluation upgrades the same card instead of stacking a second,
  // possibly contradictory one. Falls back to appending if none exists yet.
  function upsertPolicyCheckTurn(patch: { citations?: PolicyCitationCard[]; evaluation?: PolicyRuleCard[] }) {
    setTurns((t) => {
      const idx = t.findIndex((turn) => "visual" in turn && turn.visual === "policy_check");
      if (idx === -1) {
        return [...t, { from: "agent", visual: "policy_check", citations: patch.citations ?? [], evaluation: patch.evaluation ?? [] }];
      }
      const existing = t[idx] as Extract<Turn, { visual: "policy_check" }>;
      const next = [...t];
      next[idx] = { ...existing, ...patch };
      return next;
    });
  }

  // Same in-place-update pattern as upsertPolicyCheckTurn -- without this
  // the routing card was created once with policyChecked: false and never
  // touched again, so it stayed stuck on "Policy checked" in-progress and
  // "Approver decides" even after policy actually cleared and the run was
  // routed to a Reviewer.
  function upsertRoutingTurn(patch: { policyChecked?: boolean; routedTo?: "approver" | "reviewer" }) {
    setTurns((t) => {
      const idx = t.findIndex((turn) => "visual" in turn && turn.visual === "routing");
      if (idx === -1) return t;
      const existing = t[idx] as Extract<Turn, { visual: "routing" }>;
      const next = [...t];
      next[idx] = { ...existing, ...patch };
      return next;
    });
  }

  function handleEvent(event: LiveEvent) {
    switch (event.type) {
      case "node_started":
        setLiveNode(event.node);
        setStreamText("");
        break;
      case "node_finished":
      case "node_failed":
        setLiveNode(null);
        break;
      case "audit_event":
        setAuditLog((log) => [...log, { event_type: event.event_type, payload: event.payload, ts: Date.now() }]);
        if ((event.event_type === "draft_updated" || event.event_type === "draft_finalized_for_review") && event.payload.draft) {
          setLiveDraft(event.payload.draft);
        }
        if (event.event_type === "clarifying_question_asked" && !routingShownRef.current) {
          routingShownRef.current = true;
          setTurns((t) => [...t, { from: "agent", visual: "routing", policyChecked: false }]);
        }
        if (event.event_type === "policy_retrieved") {
          const citations: PolicyCitationCard[] = (event.payload.matches ?? []).map((m: any) => ({
            type: "policy_citation", title: m.title, excerpt: m.excerpt,
          }));
          upsertPolicyCheckTurn({ citations, evaluation: [] });
          upsertRoutingTurn({ policyChecked: true });
        }
        // Fires once draft_node's rule evaluation lands -- upgrades the
        // same inline card from "which documents matched" to the real
        // per-rule checklist, in place, instead of appending a second
        // card. A second card would show two checklists for one request
        // if policy_research_node retried (it does, on a not-relevant
        // judgment) -- the later evaluation always supersedes the earlier
        // retrieval, so it replaces rather than adds.
        if (event.event_type === "policy_evaluated") {
          upsertPolicyCheckTurn({ evaluation: event.payload.policy_evaluation ?? [] });
        }
        if (event.event_type === "routing_decided" && event.payload.routing_decision) {
          setTurns((t) => [...t, { from: "agent", visual: "routing_decision", decision: event.payload.routing_decision }]);
          upsertRoutingTurn({ routedTo: event.payload.routing_decision.routed_to });
        }
        if (event.event_type === "approval_summary_generated" && event.payload.approval_summary) {
          setTurns((t) => [...t, { from: "agent", visual: "approval_summary", summary: event.payload.approval_summary }]);
        }
        break;
      case "llm_token":
        setStreamText((s) => s + event.text);
        break;
      case "result":
        setRunId(event.run_id);
        setStatus(event.status);
        setTurns((t) => [...t, { from: "agent", card: event.card }]);
        setBusy(false);
        setLiveNode(null);
        setRefreshKey((k) => k + 1);
        break;
      case "error":
        setWsError(event.detail);
        setBusy(false);
        setLiveNode(null);
        break;
    }
  }

  function handleSend() {
    if (isDecider) return;
    if (!input.trim() || busy || !socketRef.current) return;
    const message = input.trim();
    setInput("");
    setWsError(null);
    setTurns((t) => [...t, { from: "user", text: message }]);
    setBusy(true);
    if (runId) {
      socketRef.current.send({ action: "message", run_id: runId, message });
    } else {
      routingShownRef.current = false;
      setStartedAt(Date.now());
      socketRef.current.send({ action: "start", message });
    }
  }

  // Fixes a real gap: without this, an Approver could only ever act on
  // whichever run happened to already be loaded in this tab (e.g. one this
  // tab itself started as Requester) -- the sidebar's pending-approval
  // queue had no way to load a *different* run in. Reconstructs the
  // approval_request card from GET /runs/{id}'s event log -- the
  // "approval_requested" event carries the same policy_citations and
  // policy_evaluation the live interrupt payload had, so the evidence view
  // is identical either way.
  async function handleSelectPendingRun(selectedRunId: string) {
    if (busy) return;
    setWsError(null);
    let run;
    try {
      run = await api.getRun(selectedRunId);
    } catch {
      setWsError("Couldn't load that request. Try again.");
      return;
    }
    if (run.status !== "awaiting_approval") {
      setWsError("This request is no longer awaiting approval.");
      return;
    }
    const approvalEvent = [...run.events].reverse().find((e) => e.type === "approval_requested");
    const policyCitations = approvalEvent?.payload?.policy_citations ?? [];
    const policyEvaluation = approvalEvent?.payload?.policy_evaluation ?? [];
    const routingDecision = approvalEvent?.payload?.routing_decision ?? null;
    const approvalSummary = approvalEvent?.payload?.approval_summary ?? null;
    setRunId(run.run_id);
    setStatus(run.status);
    setTurns([{
      from: "agent",
      card: {
        type: "approval_request", draft: run.draft, policy_citations: policyCitations,
        policy_evaluation: policyEvaluation, routing_decision: routingDecision, approval_summary: approvalSummary,
      },
    }]);
    setLiveDraft(run.draft);
    setAuditLog([]);
    setStreamText("");
    setLiveNode(null);
  }

  function handleApproval(approved: boolean, reason?: string) {
    if (!isDecider || !runId || busy || !socketRef.current) return;
    setWsError(null);
    setBusy(true);
    socketRef.current.send({ action: "approval", run_id: runId, approved, reason });
  }

  const latestApprovalCard = [...turns].reverse().find(
    (t) => "card" in t && t.card?.type === "approval_request"
  ) as { card: Extract<Card, { type: "approval_request" }> } | undefined;
  const isAwaitingApproval = status === "awaiting_approval";
  const statusLabel = liveNode ? (NODE_LABELS[liveNode] ?? liveNode) : status ? status.replace("_", " ") : "";

  if (authLoading || !user) {
    return <div className="min-h-screen bg-app" />;
  }

  // Approver and Reviewer both get the split evidence/decision screen
  // instead of a chat transcript -- handleSelectPendingRun already only
  // ever puts one approval_request card into `turns`, so there's no
  // history to lose.
  if (isDecider) {
    const decided = status === "finalized" || status === "rejected";
    const decisionNoun = isReviewer ? "review" : "approval";
    return (
      <div className="flex min-h-screen bg-app">
        <Sidebar activeRunId={runId ?? undefined} onSelectPendingRun={handleSelectPendingRun} refreshKey={refreshKey} />
        <div className="flex-1 flex flex-col h-screen min-w-0">
          {latestApprovalCard && (
            <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-[15px] font-semibold text-ink tracking-[-.01em] truncate">
                  {(latestApprovalCard.card as any).draft?.category ?? "Request"}
                </span>
                {runId && <span className="font-mono text-[12.5px] text-text-quaternary shrink-0">REQ-{runId.slice(0, 4).toUpperCase()}</span>}
              </div>
              <span className="text-[13px] text-text-tertiary shrink-0">{user.name} · {user.role}</span>
            </div>
          )}
          {wsError && (
            <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">{wsError}</div>
          )}
          {latestApprovalCard && !decided ? (
            <ApproverDetail
              card={latestApprovalCard.card as any}
              runId={runId!}
              busy={busy}
              onDecision={handleApproval}
            />
          ) : latestApprovalCard && decided ? (
            <div className="flex-1 flex items-center justify-center bg-surface">
              <div className={`rounded-2xl px-8 py-6 text-center ${status === "finalized" ? "bg-accent-tint" : "bg-[#F6EAE2]"}`}>
                <p className={`text-lg font-semibold mb-1 ${status === "finalized" ? "text-accent-dark" : "text-warning-strong"}`}>
                  {status === "finalized" ? "Request approved" : "Sent back to requester"}
                </p>
                <p className="text-sm text-text-secondary">Pick another request from the sidebar to keep reviewing.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-surface text-center px-6">
              <div>
                <h1 className="text-2xl font-semibold text-ink mb-2">Select a request to {decisionNoun}</h1>
                <p className="text-text-secondary text-sm max-w-md mx-auto">
                  Choose a request from the sidebar queue to see its details and approve or reject it.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar activeRunId={runId ?? undefined} onSelectPendingRun={handleSelectPendingRun} refreshKey={refreshKey} />

      <div className="flex-1 flex flex-col h-screen min-w-0">
        {turns.length > 0 && (
          <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="text-[15px] font-semibold text-ink tracking-[-.01em] truncate">
                {liveDraft?.category ?? "New request"}
              </span>
              {runId && <span className="font-mono text-[12.5px] text-text-quaternary shrink-0">REQ-{runId.slice(0, 4).toUpperCase()}</span>}
            </div>
            <span className="text-[13px] text-text-tertiary shrink-0">{user.name} · {user.role}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-surface">
          <div className="max-w-3xl mx-auto px-[34px] py-10">
            {turns.length === 0 ? (
              <div className="pt-24 text-center">
                <h1 className="text-2xl font-semibold text-ink mb-2">What do you need approved?</h1>
                <p className="text-text-secondary text-sm max-w-md mx-auto">
                  Describe your request in plain language. I'll ask what's missing, check company policy, and route it for approval.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <RunProgress status={status} liveNode={liveNode} statusLabel={statusLabel} startedAt={startedAt} />
                {turns.map((turn, i) => (
                  <div key={i} className={`animate-msgin ${turn.from === "user" ? "flex justify-end" : ""}`}>
                    {turn.from === "user" ? (
                      <div className="bg-neutral-fill rounded-[18px] rounded-br-[6px] px-[19px] py-[13px] max-w-[60%] text-[15px] leading-[1.5] shadow-bubble text-ink-2">
                        {turn.text}
                      </div>
                    ) : "visual" in turn && turn.visual === "routing" ? (
                      <div className="max-w-full animate-cardin">
                        <RoutingVisual policyChecked={turn.policyChecked} routedTo={turn.routedTo} />
                      </div>
                    ) : "visual" in turn && turn.visual === "policy_check" ? (
                      <div className="max-w-full animate-cardin">
                        <PolicyCheckVisual citations={turn.citations} evaluation={turn.evaluation} />
                      </div>
                    ) : "visual" in turn && turn.visual === "routing_decision" ? (
                      <div className="max-w-full animate-cardin">
                        <RoutingDecisionVisual decision={turn.decision} />
                      </div>
                    ) : "visual" in turn && turn.visual === "approval_summary" ? (
                      <div className="max-w-full animate-cardin">
                        <ApprovalSummaryVisual summary={turn.summary} />
                      </div>
                    ) : (
                      <div className="max-w-full">
                        <CardRenderer card={turn.card!} />
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-sm text-text-tertiary px-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
                    {liveNode ? (NODE_LABELS[liveNode] ?? liveNode) : "Working..."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {wsError && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600">
            {wsError}
          </div>
        )}

        <div className="border-t border-hairline-soft bg-surface px-[34px] py-[22px]">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3 border border-control rounded-2xl px-[19px] py-2.5 bg-panel focus-within:border-ink-muted transition-colors">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={busy || isAwaitingApproval}
                placeholder={
                  isAwaitingApproval
                    ? "Waiting for approval decision above..."
                    : "Type your request..."
                }
                className="flex-1 min-w-0 bg-transparent text-[15px] outline-none disabled:text-placeholder text-ink"
              />
              <button
                onClick={handleSend}
                disabled={busy || isAwaitingApproval}
                aria-label="Send"
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-ink text-white disabled:opacity-30 hover:bg-[#332F28] transition-colors"
              >
                <Icon name="arrow_upward" size={19} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {turns.length > 0 && (
        <LivePanel
          status={status}
          liveNode={liveNode}
          liveDraft={liveDraft}
          streamText={streamText}
          auditLog={auditLog}
        />
      )}
    </div>
  );
}
