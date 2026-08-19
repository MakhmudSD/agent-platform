"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, attachmentUrl, Card, Folder, PolicyCitationCard, PolicyRuleCard, ROLE_LABELS, RoutingDecision, TranscriptEntry } from "@/lib/api";
import { LiveEvent, RunSocket } from "@/lib/ws";
import { CardRenderer } from "@/components/CardRenderer";
import { ConvoRowMenu } from "@/components/ConvoRowMenu";
import { NODE_LABELS, isTerminalStatus } from "@/lib/progress";
import { RunProgress } from "@/components/RunProgress";
import { ApproverDetail } from "@/components/ApproverDetail";
import {
  ApprovalSummaryVisual, PolicyCheckVisual, RoutingDecisionVisual, RoutingVisual,
} from "@/components/AgentVisuals";
import { EditableDraftFields } from "@/components/EditableDraftFields";
import { Icon } from "@/components/Icon";
import { AgentGuideModal, AgentInfo } from "@/components/AgentGuideModal";
import { NotificationBell } from "@/components/NotificationBell";
import { ConversationFeedback } from "@/components/ConversationFeedback";
import { dismissAgentHint, isAgentHintDismissed } from "@/lib/agentHint";
import { getPinnedIds, togglePin } from "@/lib/pins";
import { summarize } from "@/lib/stats";
import { useAuth } from "@/lib/auth";

// The design's core idea -- "the agent answers with visuals instead of
// paragraphs" -- means each real agent moment renders inline in the thread
// as it happens, not bundled at the end on the approval card: routing
// after the first clarifying question, policy-check as citations then the
// real rule checklist, the Escalation/Routing Agent's decision the moment
// it fires, and the Approval-Summary Agent's brief right after.
// The real fixed pipeline (orchestrator/graph.py), not a marketing list --
// these are the actual node names a run passes through, same ones
// RunProgress and NODE_LABELS (lib/progress.ts) live. Shown once, on the empty landing
// state, so a first-time user knows what's actually happening under "I'll
// ask what's missing, check policy, and route it" before they've seen it
// run once.
const AGENT_INFO: AgentInfo[] = [
  {
    icon: "chat",
    name: "Intake",
    purpose: "Gathers the details your request needs -- amount, cost center, date, justification -- by asking only for what's missing.",
    guide: "Runs the moment you send your first message.\n\nHow to use it: just describe what you need in plain language, the way you'd tell a coworker -- \"$400 conference ticket for the SF summit next month.\" If anything required is missing, it asks one follow-up question at a time; answer it like a normal chat reply and it picks up where it left off.\n\nYou'll know it's done when the conversation moves on to policy checking without asking anything further.",
  },
  {
    icon: "policy",
    name: "Policy Research",
    purpose: "Checks your request against real company policy documents and cites what applies.",
    guide: "Runs automatically once Intake has enough detail -- there's nothing to trigger.\n\nHow to use it: nothing to do while it runs. Read the citations and rule checklist it posts -- that's the actual policy text your request is being checked against, not a summary, so if a cap or rule looks wrong it's worth flagging before you submit rather than after.\n\nIf no policy matches your request, it says so explicitly rather than showing an empty checklist.",
  },
  {
    icon: "edit_note",
    name: "Drafting",
    purpose: "Turns the gathered details and policy findings into the structured request that gets sent for approval.",
    guide: "Runs after policy research, automatically.\n\nHow to use it: check the fields it produces against what you actually meant -- amount, category, dates. If something's off, say so in the chat (\"actually the date should be the 12th\") rather than editing after the fact; Drafting will redo the field from your correction so the policy evaluation stays consistent with what's actually being requested.",
  },
  {
    icon: "alt_route",
    name: "Escalation & Routing",
    purpose: "Decides whether your request needs a standard approver or a specialist reviewer, based on policy rules.",
    guide: "Runs once your request is fully drafted -- fully automatic, no input from you.\n\nHow to use it: nothing to do. It reads the policy rules that matched and picks exactly one destination -- your regular approver, or a specialist reviewer (finance/legal/IT) when a rule specifically calls for one. The reasoning it shows is the real basis for that decision, not a generic explanation, so it's worth reading if you're wondering why a routine-looking request got escalated.",
  },
  {
    icon: "summarize",
    name: "Approval Summary",
    purpose: "Writes the decision brief your approver sees -- what you're asking for and why it's routed the way it is.",
    guide: "Runs last, right before your request reaches the approval queue.\n\nHow to use it: this is the one worth double-checking -- it's the brief your approver actually reads to decide, not the full conversation, so if it misrepresents what you're asking for or why, that's the moment to say something in chat before it goes out, since editing after submission means restarting the approval.",
  },
];

const REQUIRED_FIELDS = ["category", "amount", "date", "justification", "cost_center"];

type RunListItem = {
  run_id: string; status: string; requester_name: string; user_id: string | null;
  routed_to: "approver" | "reviewer" | null; created_at: string; updated_at: string;
  draft: Record<string, any> | null; archived?: boolean; folder_id?: string | null;
};

type Turn =
  | { from: "user" | "agent"; card?: Card; text?: string }
  | { from: "agent"; visual: "routing"; policyChecked: boolean; routedTo?: "approver" | "reviewer" }
  | { from: "agent"; visual: "policy_check"; citations: PolicyCitationCard[]; evaluation: PolicyRuleCard[] }
  | { from: "agent"; visual: "routing_decision"; decision: RoutingDecision }
  | { from: "agent"; visual: "approval_summary"; summary: string }
  | { from: "agent"; visual: "draft_fields"; draft: Record<string, any> }
  | { from: "user"; visual: "attachment"; filename: string; url: string };

// Reconstructs the real conversation that produced a draft, for the
// Approver/Reviewer's evidence column -- per design_handoff_approval_flow's
// stated goal ("the approver never has to reconstruct context before
// deciding"), not a summary of it. Reads only events that carry real
// message text; anything else (state_transition, policy_retrieved, ...) is
// audit trail, not conversation, and stays out of the transcript.
function transcriptFromEvents(events: { type: string; payload: Record<string, any> }[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const e of events) {
    if (e.type === "run_started" && e.payload?.initial_message) {
      entries.push({ from: "requester", text: e.payload.initial_message });
    } else if (e.type === "clarifying_question_asked" && e.payload?.question) {
      entries.push({ from: "agent", text: e.payload.question });
    } else if (e.type === "user_message" && e.payload?.message) {
      entries.push({ from: "requester", text: e.payload.message });
    }
  }
  return entries;
}

// Replays a finished/in-progress run's event log into the same visual turn
// sequence the live WS stream builds up turn-by-turn (see handleEvent) --
// this is what makes a requester's own conversation resumable instead of
// resetting to blank the moment they navigate away and come back.
function turnsFromEvents(events: { type: string; payload: Record<string, any> }[]): Turn[] {
  const turns: Turn[] = [];
  let routingIdx = -1;
  let policyIdx = -1;

  for (const e of events) {
    if (e.type === "run_started" && e.payload?.initial_message) {
      turns.push({ from: "user", text: e.payload.initial_message });
    } else if (e.type === "clarifying_question_asked" && e.payload?.question) {
      if (routingIdx === -1) {
        routingIdx = turns.length;
        turns.push({ from: "agent", visual: "routing", policyChecked: false });
      }
      // Agent turns without a `visual` are rendered through CardRenderer
      // (see the turns.map ternary below), which dispatches on card.type --
      // there's no bare-text agent bubble case, so this has to be a real
      // ClarifyingQuestionCard, not a text turn.
      turns.push({ from: "agent", card: { type: "clarifying_question", question: e.payload.question, field: e.payload.field ?? "" } });
    } else if (e.type === "user_message" && e.payload?.message) {
      turns.push({ from: "user", text: e.payload.message });
    } else if (e.type === "policy_retrieved") {
      const citations: PolicyCitationCard[] = (e.payload.matches ?? []).map((m: any) => ({
        type: "policy_citation", title: m.title, excerpt: m.excerpt,
      }));
      if (policyIdx === -1) {
        policyIdx = turns.length;
        turns.push({ from: "agent", visual: "policy_check", citations, evaluation: [] });
      } else {
        turns[policyIdx] = { ...(turns[policyIdx] as any), citations };
      }
      if (routingIdx !== -1) turns[routingIdx] = { ...(turns[routingIdx] as any), policyChecked: true };
    } else if (e.type === "policy_evaluated" && policyIdx !== -1) {
      turns[policyIdx] = { ...(turns[policyIdx] as any), evaluation: e.payload.policy_evaluation ?? [] };
    } else if (e.type === "routing_decided" && e.payload.routing_decision) {
      turns.push({ from: "agent", visual: "routing_decision", decision: e.payload.routing_decision });
      if (routingIdx !== -1) turns[routingIdx] = { ...(turns[routingIdx] as any), routedTo: e.payload.routing_decision.routed_to };
    } else if (e.type === "approval_summary_generated" && e.payload.approval_summary) {
      turns.push({ from: "agent", visual: "approval_summary", summary: e.payload.approval_summary });
    } else if (e.type === "attachment_uploaded" && e.payload?.url) {
      turns.push({ from: "user", visual: "attachment", filename: e.payload.filename ?? "Attachment", url: e.payload.url });
    }
  }
  return turns;
}

// Sentinel for "an action was sent before any run_id existed" (the very
// first message of a brand-new conversation) -- see the in-flight/viewed
// run guard below for why this needs a distinct identity from a real id.
const PENDING_START = "__pending_start__";

// useSearchParams() (the ?run= deep-link read below) opts a page out of
// static generation unless it's wrapped in Suspense -- Next.js's own
// requirement for the build, not a real loading state this app needs
// (everything here is behind auth and live data, there's nothing
// meaningful to statically prerender). null fallback is fine: this only
// ever suspends for an instant during the initial client render, well
// before there's anything on screen worth not flashing.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  // Client-observed timestamp used only for RunProgress's elapsed clock --
  // not persisted, not authoritative, just "when this browser tab first saw
  // this run start."
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [agentHintDismissed, setAgentHintDismissed] = useState(true);
  const [openAgentGuide, setOpenAgentGuide] = useState<AgentInfo | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunListItem[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    if (user) setPinnedIds(getPinnedIds(user.id));
  }, [user]);

  useEffect(() => {
    if (user && !isDecider) api.listFolders().then(setFolders).catch(() => {});
  }, [user, isDecider]);

  function refetchRecentRuns() {
    if (isDecider || !user) return;
    api.listRuns().then((runs) => setRecentRuns(runs.filter((r: RunListItem) => r.user_id === user.id))).catch(() => {});
  }

  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    if (user) setAgentHintDismissed(isAgentHintDismissed(user.id));
  }, [user]);

  // The chat history list on the landing state -- "like Claude," a real
  // list of past conversations to reopen, not just a blank composer every
  // time. GET /runs isn't user-scoped server-side (deciders' queue
  // filtering already does this client-side the same way, see /inbox), so
  // this filters to conversations this user actually started.
  useEffect(() => {
    refetchRecentRuns();
  }, [isDecider, user, runId]);

  // Keeps the view anchored on whatever's being generated -- a new turn
  // landing, a token streaming in, or the "Working..." indicator appearing
  // -- instead of leaving the reader scrolled up on an older message while
  // the real response lands off-screen below.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy, streamText]);

  const socketRef = useRef<RunSocket | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  // The backend processes one WS action at a time per connection (see
  // routes/ws_runs.py's module docstring), but the user can switch which
  // conversation is on screen while that single action is still in flight
  // (loading a different run is a read, not a send -- nothing to guard
  // there). These two refs are what keep a slow-to-arrive progress/result
  // event for run A from landing on run B's turns after the user has
  // already switched: activeActionRunIdRef is who the in-flight action is
  // FOR, viewedRunIdRef is what's actually on screen right now, and every
  // mutating handleEvent case only applies when they still match. Refs, not
  // state, because they're read synchronously inside the WS callback and
  // don't themselves need to trigger a render.
  const activeActionRunIdRef = useRef<string | null>(null);
  const viewedRunIdRef = useRef<string | null>(null);
  // Guards the /chat -> /?draft= handoff effect below against firing twice
  // for the same draft. React 18 StrictMode double-invokes effects on
  // mount in dev; the effect's own `turns.length > 0` check can't catch
  // the second invocation because no render happens between the two
  // calls, so both see the same empty `turns` closure and both send. A
  // ref is mutated synchronously and shared across both invocations,
  // unlike state, so it actually blocks the second one.
  const draftConsumedRef = useRef(false);
  // Guards the routing visual to one appearance per run -- the backend
  // event it's keyed off (clarifying_question_asked) can fire once per
  // missing field, but "here's where this goes next" is only news once.
  const routingShownRef = useRef(false);
  // Client-only UI state for the editable draft-field chips (see
  // EditableDraftFields) -- which fields the requester has explicitly
  // accepted or edited, not a readiness gate (the backend's required-
  // fields check doesn't care about this at all).
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set());

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

  // /chat (a minimal composer, history moved to the sidebar there) hands
  // off here instead of duplicating run-start logic -- it can't call the
  // real graph.start_run() itself without reimplementing the WS streaming
  // this page already does. RunSocket queues sends until its connection
  // opens (see lib/ws.ts), so this is safe to fire before the socket-init
  // effect above has finished connecting. Strips the param after consuming
  // it so a refresh doesn't resend the same request.
  useEffect(() => {
    if (isDecider || runId || turns.length > 0 || draftConsumedRef.current) return;
    const draft = searchParams.get("draft");
    if (!draft) return;
    draftConsumedRef.current = true;
    handleSend(draft);
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDecider, searchParams, runId]);

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

  // Same in-place-update pattern as the other inline visuals -- one
  // editable-fields card per run, its contents replaced as the draft
  // grows, rather than a new card stacking up on every draft_updated
  // event.
  function upsertDraftFieldsTurn(draft: Record<string, any>) {
    setTurns((t) => {
      const idx = t.findIndex((turn) => "visual" in turn && turn.visual === "draft_fields");
      if (idx === -1) return [...t, { from: "agent", visual: "draft_fields", draft }];
      const next = [...t];
      next[idx] = { from: "agent", visual: "draft_fields", draft };
      return next;
    });
  }

  function handleEvent(event: LiveEvent) {
    // True only while the run currently on screen is the same one the
    // in-flight WS action was sent for -- see the refs' own comment above
    // for why. A progress/result event that fails this check belongs to a
    // run the user has since navigated away from; the action itself still
    // completes and persists server-side (that's true regardless of this
    // check), it just doesn't get painted onto whatever's on screen now.
    const forCurrentView =
      activeActionRunIdRef.current !== null && activeActionRunIdRef.current === viewedRunIdRef.current;
    switch (event.type) {
      case "node_started":
        if (!forCurrentView) break;
        setLiveNode(event.node);
        setStreamText("");
        break;
      case "node_finished":
      case "node_failed":
        if (!forCurrentView) break;
        setLiveNode(null);
        break;
      case "audit_event":
        if (!forCurrentView) break;
        if ((event.event_type === "draft_updated" || event.event_type === "draft_finalized_for_review") && event.payload.draft) {
          setLiveDraft(event.payload.draft);
        }
        if (event.event_type === "draft_updated" && event.payload.draft) {
          upsertDraftFieldsTurn(event.payload.draft);
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
        if (!forCurrentView) break;
        setStreamText((s) => s + event.text);
        break;
      case "result":
        // The one in-flight action is genuinely done either way -- always
        // free the composer and clear the in-flight marker. Only paint the
        // result onto state if it's still what's on screen.
        if (forCurrentView) {
          viewedRunIdRef.current = event.run_id;
          setRunId(event.run_id);
          setStatus(event.status);
          setTurns((t) => [...t, { from: "agent", card: event.card }]);
          setLiveNode(null);
        }
        activeActionRunIdRef.current = null;
        setBusy(false);
        // A run was just created or advanced -- Sidebar's Recent list
        // needs to know regardless of forCurrentView, since the run itself
        // is real either way. Sidebar used to pick this up for free by
        // remounting on every navigation; now that it persists (see
        // app/(app)/layout.tsx), nothing else tells it to refetch. Same
        // event-based refresh notifications already uses (lib/api.ts).
        window.dispatchEvent(new Event("runs:changed"));
        break;
      case "error":
        if (forCurrentView) setWsError(event.detail);
        activeActionRunIdRef.current = null;
        setBusy(false);
        setLiveNode(null);
        break;
    }
  }

  function handleSend(overrideMessage?: string) {
    if (isDecider) return;
    const message = (overrideMessage ?? input).trim();
    if (!message || busy || !socketRef.current) return;
    setInput("");
    setWsError(null);
    setTurns((t) => [...t, { from: "user", text: message }]);
    setBusy(true);
    if (runId) {
      activeActionRunIdRef.current = runId;
      viewedRunIdRef.current = runId;
      socketRef.current.send({ action: "message", run_id: runId, message });
    } else {
      routingShownRef.current = false;
      setConfirmedFields(new Set());
      setStartedAt(Date.now());
      activeActionRunIdRef.current = PENDING_START;
      viewedRunIdRef.current = PENDING_START;
      socketRef.current.send({ action: "start", message });
    }
  }

  // Accept and Edit both resolve here -- same WS action, same graph path
  // (ws_runs.py's "field_patch" -> graph.handle_field_patch), no LLM call
  // on the backend. Optimistically marks the field confirmed immediately
  // rather than waiting for the round-trip: there's nothing to roll back
  // to if it fails (the value was already real, just unconfirmed), so the
  // only failure mode worth surfacing is wsError, not reverting the chip.
  function handleFieldPatch(field: string, value: string) {
    if (isDecider || !runId || busy || !socketRef.current) return;
    setWsError(null);
    setConfirmedFields((f) => new Set(f).add(field));
    setBusy(true);
    activeActionRunIdRef.current = runId;
    viewedRunIdRef.current = runId;
    socketRef.current.send({ action: "field_patch", run_id: runId, field, value });
  }

  // Fixes a real gap: without this, an Approver could only ever act on
  // whichever run happened to already be loaded in this tab (e.g. one this
  // tab itself started as Requester) -- there was no way to load a
  // *different* run in. Reconstructs the
  // approval_request card from GET /runs/{id}'s event log -- the
  // "approval_requested" event carries the same policy_citations and
  // policy_evaluation the live interrupt payload had, so the evidence view
  // is identical either way.
  async function handleSelectPendingRun(selectedRunId: string) {
    // Loading a different run is a read, not a send -- no reason to block
    // it on whatever the composer is doing elsewhere (see the refs' comment
    // above). Switch the declared view immediately, synchronously, so any
    // in-flight action's progress events stop landing on the old view the
    // instant the user clicks, not whenever this fetch happens to resolve.
    viewedRunIdRef.current = selectedRunId;
    setWsError(null);
    let run;
    try {
      run = await api.getRun(selectedRunId);
    } catch {
      if (viewedRunIdRef.current === selectedRunId) setWsError("Couldn't load that request. Try again.");
      return;
    }
    // The user may have clicked a third conversation while this fetch was
    // in flight -- if so, viewedRunIdRef has already moved on, and applying
    // this now-stale response would yank the screen back to a run they're
    // no longer looking at.
    if (viewedRunIdRef.current !== selectedRunId) return;
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
        transcript: transcriptFromEvents(run.events),
      },
    }]);
    setLiveDraft(run.draft);
    setStreamText("");
    setLiveNode(null);
  }

  // The requester-side counterpart to handleSelectPendingRun: reopens the
  // requester's own conversation (any status, not just awaiting_approval)
  // as a real chat replay instead of the raw audit view /history uses.
  // Fixes "in request tab it disappears once you leave the chat" -- there
  // was previously no way back into a conversation once you navigated away.
  async function handleSelectOwnRun(selectedRunId: string) {
    // See handleSelectPendingRun's comment above -- same reasoning, same
    // synchronous-then-recheck pattern against viewedRunIdRef.
    viewedRunIdRef.current = selectedRunId;
    setWsError(null);
    let run;
    try {
      run = await api.getRun(selectedRunId);
    } catch {
      if (viewedRunIdRef.current === selectedRunId) setWsError("Couldn't load that conversation. Try again.");
      return;
    }
    if (viewedRunIdRef.current !== selectedRunId) return;
    const replayed = turnsFromEvents(run.events);
    if (run.status === "awaiting_approval") {
      const approvalEvent = [...run.events].reverse().find((e: any) => e.type === "approval_requested");
      replayed.push({
        from: "agent",
        card: {
          type: "approval_request", draft: run.draft,
          policy_citations: approvalEvent?.payload?.policy_citations ?? [],
          policy_evaluation: approvalEvent?.payload?.policy_evaluation ?? [],
          routing_decision: approvalEvent?.payload?.routing_decision ?? null,
          approval_summary: approvalEvent?.payload?.approval_summary ?? null,
          transcript: transcriptFromEvents(run.events),
        } as any,
      });
    } else if (run.status === "finalized" || run.status === "rejected") {
      const decisionEvent = [...run.events].reverse().find((e: any) => e.type === "approved" || e.type === "rejected");
      replayed.push({
        from: "agent",
        card: { type: "final_confirmation", status: run.status, draft: run.draft, reason: decisionEvent?.payload?.reason ?? null } as any,
      });
    }
    setRunId(run.run_id);
    setStatus(run.status);
    setTurns(replayed);
    setLiveDraft(run.draft);
    setConfirmedFields(new Set(Object.keys(run.draft ?? {})));
    setStreamText("");
    setLiveNode(null);
  }

  // Fixes the real gap found doing a live two-tab test: events.emit() in
  // the backend (app/core/events.py) only reaches a sink that's registered
  // *right now*, and ws_runs.py only registers one for the duration of a
  // single action (send message / approve) -- by design, per that module's
  // own docstring ("a run is only ever watched by the one connection that
  // started/resumed it"). So once a request reaches awaiting_approval and
  // sits there, nothing pushes the decider's eventual decision back to the
  // requester's open tab; it goes stale until they navigate away and back.
  // A real push fix means multi-watcher support in that single-process
  // event bus (it currently allows exactly one sink per run_id) -- bigger
  // than this fix warrants. Polling while genuinely waiting is the bounded,
  // safe version: only runs while status is awaiting_approval, on the
  // requester's own run, stops the moment it isn't anymore.
  useEffect(() => {
    if (isDecider || !runId || status !== "awaiting_approval") return;
    const interval = setInterval(async () => {
      let run;
      try {
        run = await api.getRun(runId);
      } catch {
        return;
      }
      if (run.status !== "awaiting_approval") handleSelectOwnRun(runId);
    }, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDecider, runId, status]);

  // Deep-link from /inbox (or a resumed conversation link): both roles can
  // land here with ?run=<id> -- deciders get the split evidence/decision
  // screen (handleSelectPendingRun, awaiting_approval only), everyone else
  // gets their own conversation replayed as chat (any status). Compares
  // against the currently-loaded runId rather than just checking it's
  // unset -- Sidebar/Home switch conversations via router.push(`/?run=...`)
  // on the SAME route, which updates searchParams without remounting the
  // page, so `if (runId) return` was a one-shot guard that only ever loaded
  // the first conversation of a session: every later click updated the URL
  // but this effect no-opped and the screen kept showing the old run.
  useEffect(() => {
    const requestedRun = searchParams.get("run");
    if (!requestedRun || requestedRun === runId) return;
    if (isDecider) handleSelectPendingRun(requestedRun);
    else handleSelectOwnRun(requestedRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDecider, searchParams, runId]);

  function handleApproval(approved: boolean, reason?: string) {
    if (!isDecider || !runId || busy || !socketRef.current) return;
    setWsError(null);
    setBusy(true);
    activeActionRunIdRef.current = runId;
    viewedRunIdRef.current = runId;
    socketRef.current.send({ action: "approval", run_id: runId, approved, reason });
  }

  const latestApprovalCard = [...turns].reverse().find(
    (t) => "card" in t && t.card?.type === "approval_request"
  ) as { card: Extract<Card, { type: "approval_request" }> } | undefined;
  const isAwaitingApproval = status === "awaiting_approval";
  // NODE_LABELS entries are already properly-cased ("Deciding next step");
  // only the raw-status fallback ("awaiting_approval" -> "awaiting
  // approval") needs its first letter capitalized here -- this is now the
  // single most prominent string in the compact status line (RunProgress),
  // not a buried caption, since the 4-chip strip it used to sit inside was
  // replaced with the status line.
  const rawStatusLabel = status ? status.replace("_", " ") : "";
  const statusLabel = liveNode
    ? (NODE_LABELS[liveNode] ?? liveNode)
    : rawStatusLabel
    ? rawStatusLabel[0].toUpperCase() + rawStatusLabel.slice(1)
    : "";
  // Mirrors backend/app/orchestrator/vertical_employee_request.py's
  // REQUIRED_FIELDS exactly -- can't import the Python list, so this is
  // kept in sync by hand. Used only to compute a real capture count, never
  // to validate (the backend remains the actual source of truth there).
  // Only shown pre-approval: once a draft's finalized, "fields captured"
  // isn't a meaningful fact about the request anymore.
  const capturedInfo = status && status !== "awaiting_approval" && !isTerminalStatus(status) && liveDraft
    ? { count: REQUIRED_FIELDS.filter((f) => liveDraft[f] != null && liveDraft[f] !== "").length, total: REQUIRED_FIELDS.length }
    : null;

  if (authLoading || !user) {
    return <div className="flex-1 bg-app" />;
  }

  // Approver and Reviewer both get the split evidence/decision screen
  // instead of a chat transcript -- handleSelectPendingRun already only
  // ever puts one approval_request card into `turns`, so there's no
  // history to lose.
  if (isDecider) {
    const decided = status === "finalized" || status === "rejected";
    const decisionVerb = isReviewer ? "review" : "approve";
    return (
      <div className="flex-1 flex flex-col h-screen min-w-0 bg-app">
          {latestApprovalCard && (
            <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-[15px] font-semibold text-ink tracking-[-.01em] truncate">
                  {(latestApprovalCard.card as any).draft?.category ?? "Request"}
                </span>
                {(latestApprovalCard.card as any).draft?.urgent && (
                  <span className="shrink-0 px-2 py-[3px] rounded-md bg-[#F6EAE2] text-[11px] font-semibold text-warning-strong">
                    Urgent
                  </span>
                )}
                {runId && <span className="font-mono text-[12.5px] text-text-quaternary shrink-0">REQ-{runId.slice(0, 4).toUpperCase()}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[13px] text-text-tertiary">{user.name} · {ROLE_LABELS[user.role]}</span>
                <NotificationBell />
              </div>
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
            <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-surface">
              <div className={`rounded-2xl px-8 py-6 text-center ${status === "finalized" ? "bg-accent-tint" : "bg-[#F6EAE2]"}`}>
                <p className={`text-lg font-semibold mb-1 ${status === "finalized" ? "text-accent-dark" : "text-warning-strong"}`}>
                  {status === "finalized" ? "Request approved" : "Sent back to requester"}
                </p>
                <p className="text-sm text-text-secondary">Pick another request from your inbox to keep reviewing.</p>
              </div>
              {runId && (
                <div className="w-full max-w-sm">
                  <ConversationFeedback runId={runId} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-surface text-center px-6">
              <div>
                <h1 className="text-2xl font-semibold text-ink mb-2">Select a request to {decisionVerb}</h1>
                <p className="text-text-secondary text-sm max-w-md mx-auto">
                  Open your <Link href="/notifications" className="underline hover:text-ink">notifications</Link> to see what's waiting and pick one to {decisionVerb}.
                </p>
              </div>
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen min-w-0 bg-app">
        {turns.length > 0 && (
          <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="text-[15px] font-semibold text-ink tracking-[-.01em] truncate">
                {liveDraft?.category ?? "New request"}
              </span>
              {liveDraft?.urgent && (
                <span className="shrink-0 px-2 py-[3px] rounded-md bg-[#F6EAE2] text-[11px] font-semibold text-warning-strong">
                  Urgent
                </span>
              )}
              {runId && <span className="font-mono text-[12.5px] text-text-quaternary shrink-0">REQ-{runId.slice(0, 4).toUpperCase()}</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[13px] text-text-tertiary">{user.name} · {ROLE_LABELS[user.role]}</span>
              <NotificationBell />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-surface">
          {turns.length === 0 ? (
            // Centered like a "new chat" landing, not a page with a hero up
            // top and a composer pinned far below it -- intro and composer
            // live in one centered column, and everything below (history,
            // agent cards) is secondary content under that same column.
            <div className="min-h-full flex items-center justify-center px-[34px] py-14">
              <div className="w-full max-w-2xl">
                <div className="text-center mb-6">
                  <h1 className="text-[26px] font-semibold text-ink mb-2.5">Company policy, already checked.</h1>
                  <p className="text-text-secondary text-sm max-w-md mx-auto">
                    Tell me what you need approved. I'll find the relevant policy, catch anything that needs a specialist's eyes, and route it -- so nobody has to read the handbook to find out.
                  </p>
                </div>

                {!agentHintDismissed && (
                  <div className="mb-6 flex items-center gap-3 rounded-xl bg-accent-tint px-4 py-2.5">
                    <Icon name="lightbulb" size={16} filled={false} className="text-accent shrink-0" />
                    <p className="text-[13px] text-ink-2 flex-1">
                      This conversation isn't limited to one agent -- bring in a different one whenever the request needs it.
                    </p>
                    <button
                      onClick={() => {
                        if (user) dismissAgentHint(user.id);
                        setAgentHintDismissed(true);
                      }}
                      aria-label="Dismiss"
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors"
                    >
                      <Icon name="close" size={15} filled={false} />
                    </button>
                  </div>
                )}

                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSend={handleSend}
                  disabled={busy}
                  placeholder="Type your request..."
                />

                <div className="mt-14">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">The agents in this conversation</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {AGENT_INFO.map((a) => (
                      <button
                        key={a.name}
                        onClick={() => setOpenAgentGuide(a)}
                        className="flex flex-col gap-2.5 px-4 py-3.5 rounded-xl bg-card shadow-card text-left hover:bg-neutral-fill/30 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className="shrink-0 w-8 h-8 rounded-lg bg-accent-tint text-accent flex items-center justify-center">
                            <Icon name={a.icon} size={16} filled={false} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">{a.name}</p>
                            <p className="text-[12.5px] text-text-tertiary mt-0.5 leading-[1.4]">{a.purpose}</p>
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
                          <Icon name="help" size={13} filled={false} />
                          User guide
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {openAgentGuide && (
                  <AgentGuideModal agent={openAgentGuide} onClose={() => setOpenAgentGuide(null)} />
                )}

                {(() => {
                  const visibleRuns = recentRuns.filter((r) => !r.archived);
                  return visibleRuns.length > 0 && (
                  <div className="mt-14">
                    <button
                      onClick={() => setHistoryExpanded((e) => !e)}
                      className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary hover:text-ink-muted transition-colors"
                    >
                      Your conversations
                      <Icon name={historyExpanded ? "expand_less" : "expand_more"} size={15} filled={false} />
                    </button>
                    <div className="flex flex-col gap-1">
                      {(historyExpanded ? visibleRuns : visibleRuns.slice(0, 3)).map((r) => (
                        <div
                          key={r.run_id}
                          className="flex items-center gap-1 rounded-xl bg-card shadow-card hover:bg-neutral-fill/30 transition-colors"
                        >
                          <button
                            onClick={() => router.push(`/?run=${r.run_id}`)}
                            className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left px-4 py-3"
                          >
                            <span className="text-sm font-medium text-ink truncate">{summarize(r.draft) ?? "New request"}</span>
                            <span className="text-xs text-text-tertiary shrink-0 capitalize">{r.status.replace("_", " ")}</span>
                          </button>
                          <div className="pr-2.5">
                            <ConvoRowMenu
                              pinned={pinnedIds.includes(r.run_id)}
                              folders={folders}
                              currentFolderId={r.folder_id ?? null}
                              onTogglePin={() => { if (user) setPinnedIds(togglePin(user.id, r.run_id)); }}
                              onArchive={() => api.setRunArchived(r.run_id, true).then(refetchRecentRuns)}
                              onAssignFolder={(fid) => api.setRunFolder(r.run_id, fid).then(refetchRecentRuns)}
                              onCreateFolder={async (name) => {
                                const folder = await api.createFolder(name);
                                setFolders((fs) => [...fs, folder]);
                                return folder.id;
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {!historyExpanded && visibleRuns.length > 3 && (
                      <button
                        onClick={() => setHistoryExpanded(true)}
                        className="mt-1.5 text-[12px] font-medium text-accent hover:text-accent-dark transition-colors"
                      >
                        Show all {visibleRuns.length}
                      </button>
                    )}
                  </div>
                  );
                })()}
              </div>
            </div>
          ) : (
          <div className="max-w-3xl mx-auto px-[34px] py-10">
              <div className="flex flex-col gap-4">
                <RunProgress status={status} liveNode={liveNode} statusLabel={statusLabel} startedAt={startedAt} captured={capturedInfo} />
                {turns.map((turn, i) => (
                  <div key={i} className={`animate-msgin ${turn.from === "user" ? "flex justify-end" : ""}`}>
                    {"visual" in turn && turn.visual === "attachment" ? (
                      <a
                        href={attachmentUrl(turn.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 bg-neutral-fill rounded-[18px] rounded-br-[6px] px-4 py-2.5 max-w-[60%] shadow-bubble text-ink-2 hover:bg-neutral-fill-2 transition-colors"
                      >
                        <span className="shrink-0 w-8 h-8 rounded-lg bg-panel flex items-center justify-center text-text-tertiary">
                          <Icon name="description" size={16} filled={false} />
                        </span>
                        <span className="min-w-0 text-[13.5px] font-medium truncate">{turn.filename}</span>
                      </a>
                    ) : turn.from === "user" ? (
                      <div className="bg-neutral-fill rounded-[18px] rounded-br-[6px] px-[17px] py-[11px] max-w-[60%] text-[14px] leading-[1.5] shadow-bubble text-ink-2">
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
                    ) : "visual" in turn && turn.visual === "draft_fields" ? (
                      // Only editable while GATHERING -- that's the only
                      // status handle_field_patch accepts (nodes.py's
                      // intake_node is the only node that writes draft
                      // fields directly). Past that, the fields are
                      // already locked into the draft the rest of the
                      // flow reads from.
                      status === "gathering" && (
                        <div className="max-w-full animate-cardin">
                          <EditableDraftFields
                            draft={turn.draft}
                            confirmedFields={confirmedFields}
                            busy={busy}
                            onPatch={handleFieldPatch}
                          />
                        </div>
                      )
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
                {(status === "finalized" || status === "rejected") && runId && (
                  <ConversationFeedback runId={runId} />
                )}
                <div ref={scrollAnchorRef} />
              </div>
          </div>
          )}
        </div>

        {wsError && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600">
            {wsError}
          </div>
        )}

        {turns.length > 0 && (
          <>
            {!agentHintDismissed && (
              <div className="px-[34px] pt-4">
                <div className="max-w-3xl mx-auto flex items-center gap-3 rounded-xl bg-accent-tint px-4 py-2.5">
                  <Icon name="lightbulb" size={16} filled={false} className="text-accent shrink-0" />
                  <p className="text-[13px] text-ink-2 flex-1">
                    This conversation isn't limited to one agent -- bring in a different one whenever the request needs it.
                  </p>
                  <button
                    onClick={() => {
                      if (user) dismissAgentHint(user.id);
                      setAgentHintDismissed(true);
                    }}
                    aria-label="Dismiss"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Icon name="close" size={15} filled={false} />
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-hairline-soft bg-surface px-[34px] py-[22px]">
              <div className="max-w-3xl mx-auto">
                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSend={handleSend}
                  disabled={busy || isAwaitingApproval}
                  placeholder={isAwaitingApproval ? "Waiting for approval decision above..." : "Type your request..."}
                  runId={runId}
                  onAttachmentUploaded={(a) => setTurns((t) => [...t, { from: "user", visual: "attachment", filename: a.filename, url: a.url }])}
                />
              </div>
            </div>
          </>
        )}
      </div>
  );
}

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  // Attaching a file needs a real run to attach it to (see
  // POST /runs/{id}/attachments) -- undefined on the very first message,
  // before a run exists, so the button only appears once one does. Same
  // "attach within a conversation" pattern most chat products use, not a
  // gap: there's nothing to upload a file *to* before that.
  runId?: string | null;
  onAttachmentUploaded?: (attachment: { filename: string; url: string }) => void;
}

function ChatComposer(props: ChatComposerProps) {
  const { value, onChange, onSend, disabled, placeholder, runId, onAttachmentUploaded } = props;
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !runId) return;
    setUploading(true);
    try {
      const attachment = await api.uploadAttachment(runId, file);
      onAttachmentUploaded?.(attachment);
    } catch {
      // real error path would surface via wsError; a failed attach just
      // leaves nothing added to the thread, nothing silently faked
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border border-control rounded-2xl px-4 py-2 bg-panel focus-within:border-ink-muted transition-colors">
      {runId && (
        <>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            aria-label="Attach a file"
            title="Attach a file"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-neutral-fill/60 hover:text-ink-muted disabled:opacity-30 transition-colors"
          >
            <Icon name={uploading ? "progress_activity" : "attach_file"} size={18} filled={false} className={uploading ? "animate-spin" : ""} />
          </button>
        </>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSend()}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-[14px] outline-none disabled:text-placeholder text-ink"
      />
      <button
        onClick={() => onSend()}
        disabled={disabled}
        aria-label="Send"
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-ink text-white disabled:opacity-30 hover:bg-[#332F28] transition-colors"
      >
        <Icon name="arrow_upward" size={19} />
      </button>
    </div>
  );
}
