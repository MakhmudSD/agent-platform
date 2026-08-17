import { Card } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { AgentVisualStack } from "@/components/AgentVisuals";

/**
 * One component per card type, dispatched by `type`. This mirrors the
 * backend's discriminated union exactly — adding a card type means adding
 * one case here and one in cards.py, not restructuring the chat.
 */
export function CardRenderer({
  card,
  onApprovalDecision,
}: {
  card: Card;
  onApprovalDecision?: (approved: boolean, reason?: string) => void;
}) {
  switch (card.type) {
    case "clarifying_question":
      return (
        <div>
          <p className="mb-1.5 text-[12.5px] text-text-quaternary">Agent</p>
          <p className="text-[15.5px] leading-[1.6] text-ink-2 max-w-[74%]" style={{ textWrap: "pretty" }}>
            {card.question}
          </p>
        </div>
      );

    case "approval_request":
      return <ApprovalCard card={card} onDecision={onApprovalDecision} />;

    case "final_confirmation":
      return (
        <div className="flex items-center gap-[11px] px-[18px] py-[13px] rounded-[14px] bg-neutral-fill">
          <Icon
            name={card.status === "finalized" ? "check_circle" : "undo"}
            size={19}
            className={card.status === "finalized" ? "text-accent" : "text-warning-strong"}
          />
          <span className="text-[14px] font-medium text-ink-2">
            {card.status === "finalized" ? "Request approved and submitted" : "Request rejected"}
            {card.reason && <span className="font-normal text-text-secondary"> — {card.reason}</span>}
          </span>
        </div>
      );

    case "text":
      return (
        <div>
          <p className="mb-1.5 text-[12.5px] text-text-quaternary">Agent</p>
          <p className="text-[15.5px] leading-[1.6] text-ink-2 max-w-[74%]" style={{ textWrap: "pretty" }}>
            {card.content}
          </p>
        </div>
      );

    default:
      return null;
  }
}

function ApprovalCard({
  card,
  onDecision,
}: {
  card: Extract<Card, { type: "approval_request" }>;
  onDecision?: (approved: boolean, reason?: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="w-[600px] max-w-full bg-card rounded-2xl shadow-card overflow-hidden animate-cardin">
        <div className="px-5 pt-[18px] pb-2.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-breathe shrink-0" />
          <span className="text-[13.5px] font-semibold text-ink">
            Awaiting your approval
          </span>
        </div>
        <div className="px-5 pb-5 space-y-3">
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13.5px]">
            {Object.entries(card.draft).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-text-tertiary capitalize">{key.replace("_", " ")}</dt>
                <dd className="text-ink font-medium">{String(value)}</dd>
              </div>
            ))}
          </dl>

          {onDecision && (
            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => onDecision(true)}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-accent text-white shadow-teal-cta hover:bg-accent-dark transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => onDecision(false, "Needs revision")}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-panel border border-control text-ink-2 hover:bg-app transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The design's core idea: the agent answers with visuals (routing,
          policy, cost-vs-cap, comparable decisions, likely outcome)
          instead of a wall of text. This is the moment those actually
          apply -- the request is complete and here's the real evidence
          behind it, for the requester same as the approver. */}
      <div className="w-[600px] max-w-full">
        <AgentVisualStack draft={card.draft} policyCitations={card.policy_citations} policyEvaluation={card.policy_evaluation} />
      </div>
    </div>
  );
}
