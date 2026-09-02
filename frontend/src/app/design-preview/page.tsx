"use client";

import { ReactNode, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

// Isolated redesign preview of the request-intake screen ((app)/page.tsx).
// Mock data only, self-contained, not linked from any nav and not wired to
// the live route or backend -- reachable only by visiting /design-preview
// directly. Nothing here is imported by or imports from the live route.
//
// What changed vs. the live screen, and why:
//  - One dominant transcript column; no charts, no third panel. The
//    approver-side "evidence" extras (cost-cap meter, comparable-decisions
//    table, likely-outcome gauge) are deliberately left out -- they're not
//    part of the requester's own intake flow.
//  - The three stage-transition cards (routing / policy check / routing
//    decision) collapse into one pattern: a single narration sentence the
//    agent "says," with an optional expandable reveal for the underlying
//    evidence. See <AgentNarration>.
//  - The field-summary card (EditableDraftFields) is demoted to a quiet
//    inline strip under the narration that produced it, instead of its own
//    elevated card. See <DraftSummaryStrip>.
//  - Every elevated surface (expanded reveal, approval card, final
//    confirmation) shares one card language: rounded-2xl, a hairline
//    border, shadow-card. The live screen mixes rounded-2xl/rounded-xl/
//    rounded-[14px]/rounded-[11px] across visually equivalent surfaces.
//  - RunProgress's 4-segment stage bar + breathing dot + elapsed clock is
//    replaced by one small persistent pill in the header: a dot + label,
//    the same dot convention used everywhere else something is "live."
//
// The policy-check and routing narration lines below are not placeholder
// copy -- they're the literal output of policy_research_node's,
// escalation_routing_node's, and approval_summary_node's real narration
// templates (backend/app/orchestrator/nodes.py) run against this mock's
// own numbers ($420 request, $500 T&E cap), so the wording, structure, and
// "why" logic match what the live backend would actually say once wired
// in, not an invented tone.

type Status = "checking_policy" | "waiting" | "drafting" | "awaiting_decision" | "finalized" | "rejected";

const STATUS_LABEL: Record<Status, string> = {
  checking_policy: "Checking policy",
  waiting: "Waiting on you",
  drafting: "Drafting the request",
  awaiting_decision: "Awaiting decision",
  finalized: "Approved",
  rejected: "Sent back to you",
};

function isTerminal(status: Status | null) {
  return status === "finalized" || status === "rejected";
}

// The one dot convention used everywhere something is "live" -- the header
// chip, the inline typing indicator, and each narration line's leading
// marker. The live screen has three different conventions doing this job
// (a breathing ring, a dashed/dotted route node, a segmented fill bar).
function StatusDot(props: { active: boolean }) {
  return (
    <span className="relative flex h-[7px] w-[7px] shrink-0">
      {props.active && (
        <span className="animate-breathe absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-[7px] w-[7px] ${props.active ? "bg-accent" : "bg-ink-muted"}`} />
    </span>
  );
}

// The single persistent status chip. Always one small pill in the header --
// never a block of chrome sitting above the transcript.
function StatusChip(props: { status: Status }) {
  const { status } = props;
  return (
    <span className="inline-flex items-center gap-[7px] rounded-full bg-neutral-fill px-3 py-1">
      <StatusDot active={!isTerminal(status)} />
      <span className="text-[12px] font-medium text-ink-2">{STATUS_LABEL[status]}</span>
    </span>
  );
}

// One card language, used for every elevated surface on this screen: a
// narration's expanded detail, the approval card, and the final-confirmation
// card. Nothing else on the page carries this chrome -- the field summary
// deliberately doesn't (see DraftSummaryStrip), which is what makes it read
// as subordinate.
const CARD = "bg-card rounded-2xl border border-hairline-soft shadow-card";

function DetailMarker(props: { tone: "binding" | "outstanding" | "passed" }) {
  const { tone } = props;
  if (tone === "binding") {
    return <span className="w-4 h-4 mt-0.5 shrink-0 rounded-[5px] bg-accent text-white text-[10.5px] font-semibold leading-4 text-center">!</span>;
  }
  if (tone === "outstanding") {
    return <span className="w-4 h-4 mt-0.5 shrink-0 rounded-[5px] border-[1.5px] border-placeholder" />;
  }
  return <span className="w-4 h-4 mt-0.5 shrink-0 rounded-[5px] bg-ink-3 text-app text-[10.5px] leading-4 text-center">✓</span>;
}

// Replaces RoutingVisual / PolicyCheckVisual / RoutingDecisionVisual with
// one shared pattern: a short sentence the agent narrates inline in the
// transcript, plus an optional reveal for readers who want the evidence
// behind it. Collapsed by default -- the sentence alone is the primary
// reading path.
function AgentNarration(props: { text: string; detail?: ReactNode }) {
  const { text, detail } = props;
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-full animate-cardin">
      <button
        onClick={() => detail && setOpen((o) => !o)}
        disabled={!detail}
        className="group flex items-start gap-2.5 text-left w-full disabled:cursor-default"
      >
        <span className="mt-[7px]"><StatusDot active={false} /></span>
        <span className="text-[13.5px] leading-[1.5] text-ink-2 flex-1">{text}</span>
        {detail && (
          <Icon
            name={open ? "expand_less" : "expand_more"}
            size={16}
            filled={false}
            className="mt-[3px] shrink-0 text-text-tertiary group-hover:text-ink-muted transition-colors"
          />
        )}
      </button>
      {detail && open && (
        <div className={`${CARD} mt-2 ml-[22px] px-4 py-3.5`}>{detail}</div>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  category: "Category",
  amount: "Amount",
  date: "Date",
  justification: "Justification",
  cost_center: "Cost center",
};

// The field summary, demoted: a quiet inline strip with no card chrome,
// nested under the narration line that produced it -- not a peer of the
// approval card. Values a requester just fixed briefly highlight, then
// settle back to the same muted weight as everything else in the strip.
function DraftSummaryStrip(props: { draft: Record<string, string>; changedField: string | null }) {
  const { draft, changedField } = props;
  const fields = Object.keys(FIELD_LABELS).filter((f) => draft[f]);
  if (fields.length === 0) return null;

  return (
    <div className="ml-[22px] mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 animate-msgin">
      {fields.map((f) => (
        <span key={f} className="text-[12px] text-text-quaternary">
          {FIELD_LABELS[f]}{" "}
          <span className={`text-[12.5px] ${f === changedField ? "text-accent-dark font-medium" : "text-text-secondary"}`}>
            {draft[f]}
          </span>
        </span>
      ))}
    </div>
  );
}

const MOCK_DRAFT_BASE: Record<string, string> = {
  category: "Travel & entertainment",
  amount: "$420",
  date: "Sep 15, 2026",
  justification: "Client dinner with Acme Corp during the Chicago visit",
};

const POLICY_DETAIL = (
  <div className="space-y-2.5">
    <div className="flex gap-[11px]">
      <DetailMarker tone="passed" />
      <p className="text-[13px] leading-[1.5] text-ink-2">
        Meals during client-engagement travel are reimbursable up to $500 without pre-approval.{" "}
        <span className="text-text-tertiary">(T&amp;E Policy §4.2)</span>
      </p>
    </div>
    <div className="flex gap-[11px]">
      <DetailMarker tone="binding" />
      <p className="text-[13px] leading-[1.5] text-ink-2">
        An itemized receipt is required for any single expense over $75.{" "}
        <span className="text-text-tertiary">(T&amp;E Policy §4.5)</span>
      </p>
    </div>
  </div>
);

const ROUTING_DETAIL = (
  <div>
    <div className="flex items-baseline justify-between mb-2">
      <span className="text-[12.5px] font-semibold text-ink">Routed to your approver</span>
      <span className="font-mono text-[11px] text-text-quaternary">high confidence</span>
    </div>
    <p className="text-[13px] leading-[1.5] text-ink-2">
      Within standard delegated limits for this cost center, and every T&amp;E clause that applies is
      already satisfied -- no specialist review needed.
    </p>
  </div>
);

function MessageBubble(props: { children: ReactNode }) {
  return (
    <div className="flex justify-end animate-msgin">
      <div className="bg-neutral-fill rounded-2xl rounded-br-[6px] px-[17px] py-[11px] max-w-[60%] text-[14px] leading-[1.5] shadow-bubble text-ink-2">
        {props.children}
      </div>
    </div>
  );
}

function AgentText(props: { children: ReactNode }) {
  return (
    <div className="animate-msgin">
      <p className="mb-1.5 text-[12.5px] text-text-quaternary">Agent</p>
      <p className="text-[14px] leading-[1.55] text-ink-2 max-w-[74%]" style={{ textWrap: "pretty" }}>
        {props.children}
      </p>
    </div>
  );
}

function ApprovalCard(props: { draft: Record<string, string>; decided: boolean; onDecision: (approved: boolean) => void }) {
  const { draft, decided, onDecision } = props;
  return (
    <div className={`${CARD} w-[560px] max-w-full overflow-hidden animate-cardin ${decided ? "opacity-60" : ""}`}>
      <div className="px-5 pt-[18px] pb-2.5 flex items-center gap-2">
        <StatusDot active={!decided} />
        <span className="text-[13.5px] font-semibold text-ink">
          {decided ? "Awaiting your approval — decided" : "Awaiting your approval"}
        </span>
      </div>
      <div className="px-5 pb-5 space-y-3">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13.5px]">
          {Object.keys(FIELD_LABELS).map((key) => (
            <div key={key} className="contents">
              <dt className="text-text-tertiary">{FIELD_LABELS[key]}</dt>
              <dd className="text-ink font-medium">{draft[key]}</dd>
            </div>
          ))}
        </dl>
        {/* Disabled the instant a decision is recorded -- this card is a
            transcript entry, not a live control that outlives its own
            action. Without this, every click (however many happen after
            the first) pushed another "final" block, and the card itself
            kept looking actionable even after the input below had already
            locked to "This request is settled." -- two different pieces
            of UI reading the same decision and disagreeing about it. */}
        <div className="flex gap-2.5 pt-2">
          <button
            onClick={() => onDecision(true)}
            disabled={decided}
            className="px-4 py-2 text-sm font-semibold rounded-2xl bg-accent text-white shadow-teal-cta hover:bg-accent-dark disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => onDecision(false)}
            disabled={decided}
            className="px-4 py-2 text-sm font-medium rounded-2xl bg-panel border border-control text-ink-2 hover:bg-app disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function FinalConfirmation(props: { approved: boolean }) {
  const { approved } = props;
  return (
    <div className={`${CARD} flex items-center gap-3 px-5 py-4 animate-cardin`}>
      <Icon
        name={approved ? "check_circle" : "undo"}
        size={19}
        className={approved ? "text-accent" : "text-warning-strong"}
      />
      <span className="text-[14px] font-medium text-ink-2">
        {approved ? "Request approved and submitted" : "Sent back to you"}
        {!approved && <span className="font-normal text-text-secondary"> — needs revision</span>}
      </span>
    </div>
  );
}

type Block =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "agent_text"; text: string }
  | { id: string; kind: "narration"; text: string; detail?: ReactNode }
  | { id: string; kind: "draft_summary" }
  | { id: string; kind: "approval" }
  | { id: string; kind: "final" };

let uid = 0;
const nextId = () => `b${uid++}`;

// Plain Omit<Block, "id"> collapses the discriminated union to its common
// keys only ("kind"), dropping each variant's own fields (text, detail) --
// this distributes Omit over the union member-by-member instead.
type NewBlock = { [K in Block["kind"]]: Omit<Extract<Block, { kind: K }>, "id"> }[Block["kind"]];

export default function DesignPreview() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [changedField, setChangedField] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function after(ms: number, fn: () => void) {
    timers.current.push(setTimeout(fn, ms));
  }

  function push(block: NewBlock) {
    setBlocks((b) => [...b, { ...block, id: nextId() } as Block]);
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setBlocks([]);
    setStatus(null);
    setStep(0);
    setInput("");
    setDraft({});
    setChangedField(null);
    setDecision(null);
  }

  function handleSend() {
    const message = input.trim();
    if (!message) return;
    setInput("");
    push({ kind: "user", text: message });

    if (step === 0) {
      setStep(1);
      setStatus("checking_policy");
      after(650, () => {
        push({ kind: "narration", text: "Checked company policy — Travel & Entertainment Policy applies here.", detail: POLICY_DETAIL });
        push({ kind: "agent_text", text: "Which cost center should this be billed to?" });
        setStatus("waiting");
      });
    } else if (step === 1) {
      setStep(2);
      setStatus("drafting");
      after(600, () => {
        setDraft({ ...MOCK_DRAFT_BASE, cost_center: message });
        setChangedField(null);
        push({ kind: "narration", text: "Drafted the request from what you told me." });
        push({ kind: "draft_summary" });
        after(700, () => {
          // escalation_routing_node's real narration for this exact mock
          // (amount $420, binding rule capped at $500 -- see
          // backend/app/orchestrator/nodes.py's _routing_narration): the
          // "why" -- a specific, data-grounded sentence, not a generic one.
          push({ kind: "narration", text: "$420 is under the $500 limit, so this only needs manager approval.", detail: ROUTING_DETAIL });
          after(500, () => {
            // approval_summary_node's real narration (_handoff_narration):
            // the handoff itself, a distinct backend step from the routing
            // decision above even though both used to collapse into one
            // line here.
            push({ kind: "narration", text: "Routing to your approver — no specialist review needed here." });
            setStatus("awaiting_decision");
            after(500, () => push({ kind: "approval" }));
          });
        });
      });
    }
  }

  function handleDecision(approved: boolean) {
    // `decision` is the one source of truth for "is this request settled" --
    // the approval card's own disabled state, the composer's placeholder,
    // and this guard all read the same value, instead of each independently
    // inferring "done" from something else. The disabled buttons on
    // ApprovalCard should already prevent a second call, but a state guard
    // here is what actually keeps this a single source of truth rather than
    // relying on the UI never sending a second click.
    if (decision !== null) return;
    setStatus(approved ? "finalized" : "rejected");
    setDecision(approved ? "approved" : "rejected");
    push({ kind: "final" });
  }

  const composerDisabled = step === 1 && status === "checking_policy" || step === 2 && status !== "waiting" || decision !== null;
  const placeholder =
    decision !== null
      ? "This request is settled."
      : step === 2 && status === "awaiting_decision"
      ? "Waiting for approval decision above..."
      : step === 1
      ? "e.g. CS-114"
      : "Type your request...";

  return (
    <div className="min-h-screen flex flex-col bg-app">
      {/* Preview-only chrome, not part of the redesigned screen itself. */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-2 bg-ink text-white/90">
        <span className="text-[12px]">
          <span className="font-semibold">Design preview</span> · /design-preview · mock data, not wired to the live app
        </span>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white transition-colors"
        >
          <Icon name="refresh" size={14} filled={false} />
          Restart demo
        </button>
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-app">
        {blocks.length > 0 && (
          <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="text-[15px] font-semibold text-ink tracking-[-.01em] truncate">
                {draft.category ?? "New request"}
              </span>
              <span className="font-mono text-[12.5px] text-text-quaternary shrink-0">REQ-7F2A</span>
              {status && <StatusChip status={status} />}
            </div>
            <span className="text-[13px] text-text-tertiary shrink-0">Jordan Lee · Requester</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-surface">
          {blocks.length === 0 ? (
            <div className="min-h-full flex items-center justify-center px-[34px] py-14">
              <div className="w-full max-w-2xl">
                <div className="text-center mb-6">
                  <h1 className="text-[26px] font-semibold text-ink mb-2.5">Company policy, already checked.</h1>
                  <p className="text-text-secondary text-sm max-w-md mx-auto">
                    Tell me what you need approved. I&apos;ll find the relevant policy, catch anything that needs a
                    specialist&apos;s eyes, and route it.
                  </p>
                </div>
                <Composer
                  value={input}
                  onChange={setInput}
                  onSend={handleSend}
                  placeholder="Type your request..."
                />
                <p className="mt-4 text-center text-[12px] text-text-quaternary">
                  Try: &ldquo;I need approval to expense a client dinner in Chicago next week, around $420.&rdquo;
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-[34px] py-10">
              <div className="flex flex-col gap-4">
                {blocks.map((block) => {
                  switch (block.kind) {
                    case "user":
                      return <MessageBubble key={block.id}>{block.text}</MessageBubble>;
                    case "agent_text":
                      return <AgentText key={block.id}>{block.text}</AgentText>;
                    case "narration":
                      return <AgentNarration key={block.id} text={block.text} detail={block.detail} />;
                    case "draft_summary":
                      return <DraftSummaryStrip key={block.id} draft={draft} changedField={changedField} />;
                    case "approval":
                      return <ApprovalCard key={block.id} draft={draft} decided={decision !== null} onDecision={handleDecision} />;
                    case "final":
                      return <FinalConfirmation key={block.id} approved={decision === "approved"} />;
                    default:
                      return null;
                  }
                })}
                {/* This is a transient "still working" indicator, not a
                    timeline entry -- it has to stop existing once the
                    request reaches a terminal status, or it keeps
                    rendering forever, relabeled with whatever the terminal
                    status is (e.g. "Sent back to you" sitting underneath
                    the real "Sent back to you" confirmation card above it,
                    looking like a second, differently-styled copy of the
                    same event). */}
                {!isTerminal(status) && ((step === 1 && status === "checking_policy") || (step === 2 && status !== "waiting" && status !== "awaiting_decision")) && (
                  <div className="flex items-center gap-2 text-sm text-text-tertiary px-1">
                    <StatusDot active />
                    {status ? STATUS_LABEL[status] : "Working..."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {blocks.length > 0 && (
          <div className="border-t border-hairline-soft bg-surface px-[34px] py-[22px]">
            <div className="max-w-3xl mx-auto">
              <Composer
                value={input}
                onChange={setInput}
                onSend={handleSend}
                disabled={composerDisabled}
                placeholder={placeholder}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer(props: { value: string; onChange: (v: string) => void; onSend: () => void; disabled?: boolean; placeholder: string }) {
  const { value, onChange, onSend, disabled, placeholder } = props;
  return (
    <div className="flex items-center gap-3 border border-control rounded-2xl px-4 py-2 bg-panel focus-within:border-ink-muted focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2 transition-colors">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSend()}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-[14px] outline-none disabled:text-placeholder text-ink"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="Send"
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-2xl bg-ink text-white disabled:opacity-30 hover:bg-[#332F28] transition-colors"
      >
        <Icon name="arrow_upward" size={19} />
      </button>
    </div>
  );
}
