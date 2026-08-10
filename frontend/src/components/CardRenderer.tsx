import { Card } from "@/lib/api";

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
      return <div className="text-slate-800 px-1">{card.question}</div>;

    case "approval_request":
      return <ApprovalCard card={card} onDecision={onApprovalDecision} />;

    case "final_confirmation":
      return (
        <div
          className={`rounded-lg px-4 py-3 border ${
            card.status === "finalized"
              ? "bg-teal-600/10 border-teal-600/30 text-teal-600"
              : "bg-slate-100 border-slate-300 text-slate-600"
          }`}
        >
          <p className="font-medium">
            {card.status === "finalized" ? "Request approved and submitted" : "Request rejected"}
          </p>
          {card.reason && <p className="text-sm mt-1 text-slate-500">Reason: {card.reason}</p>}
        </div>
      );

    case "text":
      return <div className="text-slate-800 px-1">{card.content}</div>;

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
    <div className="bg-amber-100 border border-amber-500/40 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-amber-500/20 border-b border-amber-500/30">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
          Awaiting your approval
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        <dl className="grid grid-cols-[100px_1fr] gap-y-1 text-sm">
          {Object.entries(card.draft).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-slate-500 capitalize">{key.replace("_", " ")}</dt>
              <dd className="text-slate-900 font-medium">{String(value)}</dd>
            </div>
          ))}
        </dl>

        {card.policy_citations.length > 0 && (
          <div className="pt-2 mt-2 border-t border-amber-500/20 space-y-1.5">
            {card.policy_citations.map((c, i) => (
              <div key={i} className="text-xs">
                <span className="font-semibold text-slate-700">{c.title}</span>
                <p className="text-slate-500 mt-0.5">{c.excerpt}</p>
              </div>
            ))}
          </div>
        )}

        {onDecision && (
          <div className="flex gap-2 pt-3">
            <button
              onClick={() => onDecision(true)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-teal-600 text-white hover:opacity-90"
            >
              Approve
            </button>
            <button
              onClick={() => onDecision(false, "Needs revision")}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
