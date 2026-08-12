"use client";

import { useEffect, useRef, useState } from "react";
import { api, Card } from "@/lib/api";
import { AuditLogEntry, LiveEvent, RunSocket } from "@/lib/ws";
import { CardRenderer } from "@/components/CardRenderer";
import { Sidebar } from "@/components/Sidebar";
import { LivePanel, NODE_LABELS } from "@/components/LivePanel";
import { REQUESTER_NAME, useRole } from "@/lib/role";

type Turn = { from: "user" | "agent"; card?: Card; text?: string };

export default function Home() {
  const { role } = useRole();
  const isApprover = role === "approver";

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

  const socketRef = useRef<RunSocket | null>(null);

  useEffect(() => {
    const socket = new RunSocket(handleEvent, () => {
      setWsError("Connection to the server was lost. Refresh the page to reconnect.");
      setBusy(false);
      setLiveNode(null);
    });
    socketRef.current = socket;
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching roles always starts fresh, never resumes whatever run
  // happened to be loaded -- without this, a stale runId from one role
  // (e.g. a run an Approver just acted on) carries into the other role and
  // the next action targets the wrong run entirely.
  useEffect(() => {
    setRunId(null);
    setStatus(null);
    setTurns([]);
    setBusy(false);
    setWsError(null);
    setLiveNode(null);
    setLiveDraft(null);
    setStreamText("");
    setAuditLog([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

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
    if (isApprover) return;
    if (!input.trim() || busy || !socketRef.current) return;
    const message = input.trim();
    setInput("");
    setWsError(null);
    setTurns((t) => [...t, { from: "user", text: message }]);
    setBusy(true);
    if (runId) {
      socketRef.current.send({ action: "message", run_id: runId, message });
    } else {
      socketRef.current.send({ action: "start", requester_name: REQUESTER_NAME, message });
    }
  }

  // Fixes a real gap: without this, an Approver could only ever act on
  // whichever run happened to already be loaded in this tab (e.g. one this
  // tab itself started as Requester) -- the sidebar's pending-approval
  // queue had no way to load a *different* run in. Reconstructs a minimal
  // approval_request card from GET /runs/{id} since that endpoint doesn't
  // return policy_citations (only the live interrupt payload does) --
  // approving/rejecting still works correctly, the citations just won't
  // re-render for a run picked up this way.
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
    setRunId(run.run_id);
    setStatus(run.status);
    setTurns([{ from: "agent", card: { type: "approval_request", draft: run.draft, policy_citations: [] } }]);
    setLiveDraft(run.draft);
    setAuditLog([]);
    setStreamText("");
    setLiveNode(null);
  }

  function handleApproval(approved: boolean, reason?: string) {
    if (!isApprover || !runId || busy || !socketRef.current) return;
    setWsError(null);
    setBusy(true);
    socketRef.current.send({ action: "approval", run_id: runId, approved, reason });
  }

  const latestApprovalCard = [...turns].reverse().find(
    (t) => t.card?.type === "approval_request"
  );
  const isAwaitingApproval = status === "awaiting_approval";

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar activeRunId={runId ?? undefined} onSelectPendingRun={handleSelectPendingRun} refreshKey={refreshKey} />

      <div className="flex-1 flex flex-col h-screen">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-10">
            {turns.length === 0 ? (
              <div className="pt-24 text-center">
                <h1 className="text-2xl font-semibold text-slate-900 mb-2">
                  {isApprover ? "Select a request to review" : "What do you need approved?"}
                </h1>
                <p className="text-slate-500 text-sm max-w-md mx-auto">
                  {isApprover
                    ? "Choose a request from the sidebar queue to see its details and approve or reject it."
                    : 'Describe your request. I\'ll ask what\'s missing, check company policy, and route it for approval. Try: "I need to expense a conference ticket, about $2400".'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {turns.map((turn, i) => (
                  <div key={i} className={turn.from === "user" ? "flex justify-end" : ""}>
                    {turn.from === "user" ? (
                      <div className="bg-slate-900 text-white rounded-2xl px-4 py-2.5 max-w-[75%] text-sm">
                        {turn.text}
                      </div>
                    ) : (
                      <div className="max-w-[85%] text-sm leading-relaxed">
                        <CardRenderer
                          card={turn.card!}
                          onApprovalDecision={
                            isApprover && turn === latestApprovalCard && isAwaitingApproval
                              ? handleApproval
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="max-w-[85%] flex items-center gap-2 text-sm text-slate-400 px-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse shrink-0" />
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

        <div className="border-t border-slate-100 bg-white px-6 py-5">
          <div className="max-w-3xl mx-auto">
            {isApprover ? (
              <p className="text-center text-sm text-slate-400">
                Approvers review existing requests and can't start new ones. Switch to
                Requester to submit a request.
              </p>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-slate-200 shadow-sm px-2 py-1.5 focus-within:border-slate-400 transition-colors">
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
                  className="flex-1 bg-transparent px-3 py-1.5 text-sm outline-none disabled:text-slate-400"
                />
                <button
                  onClick={handleSend}
                  disabled={busy || isAwaitingApproval}
                  aria-label="Send"
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-slate-900 text-white disabled:opacity-30 transition-opacity"
                >
                  ↑
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <LivePanel
        status={status}
        liveNode={liveNode}
        liveDraft={liveDraft}
        streamText={streamText}
        auditLog={auditLog}
      />
    </div>
  );
}
