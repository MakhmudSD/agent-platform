// Shared between /history (the full audit trail page) and ApproverDetail's
// "Trace" sub-tab (the same event stream, scoped to one run, surfaced
// where a decider is already looking instead of only in a separate tab).
export const EVENT_LABELS: Record<string, string> = {
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

export const EVENT_ICONS: Record<string, string> = {
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
