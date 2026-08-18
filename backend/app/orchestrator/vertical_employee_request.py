"""
Everything specific to the "Employee Request Assistant" demo scenario lives
here. The orchestrator graph (graph.py, nodes.py) imports this module but
contains no scenario-specific knowledge itself — swapping to a different
workflow flavor (IT access request, vendor onboarding) means writing a new
module like this one, not touching the graph nodes.

This is the platform/vertical seam from the spec, kept intentionally small
for the MVP rather than built out as a full plugin-registration system.
"""

REQUIRED_FIELDS = ["category", "amount", "date", "justification", "cost_center"]

GATHER_SYSTEM_PROMPT = """You are an assistant that helps employees file internal requests \
(expense, purchase, or similar approval requests) through conversation.

Required fields for a complete draft: category, amount (numeric, USD), date, \
justification (one sentence, business reason), cost_center.

Given the conversation so far and the current draft (possibly partial), respond with JSON:
{
  "updated_draft": {...current known fields...},
  "ready_to_draft": true|false,
  "next_question": "..." (only if ready_to_draft is false — one specific, natural question \
for exactly one missing or unclear field)
}

Ask for ONE field at a time. Do not ask about fields already present in updated_draft. \
If everything required is present and coherent, set ready_to_draft true and omit next_question.

If the employee's own words signal urgency about timing (e.g. "ASAP", "urgent", \
"immediately", "as soon as possible", "right away", a hard deadline stated as very soon), \
set "urgent": true in updated_draft. This is not a required field and never blocks \
ready_to_draft, and it is never something you ask about or infer from the category/amount \
alone -- only set it when the employee actually said something urgency-flavored. Omit the \
key entirely when they didn't; never set it to false.
"""

DRAFT_SYSTEM_PROMPT = """You are finalizing an employee request draft for approval, using \
retrieved company policy context if relevant.

Given the draft fields and any policy excerpts, respond with JSON:
{
  "final_draft": {...the same fields, cleaned up, plus "requester" if provided -- carry \
"urgent" through unchanged if the draft already has it, never add or drop it yourself...},
  "policy_notes": "one sentence noting which policy (if any) applies, or empty string",
  "policy_evaluation": [
    {"rule": "...", "status": "passed"|"binding"|"outstanding", "evidence": "...", \
"cap": 1234.0 | null}
  ]
}

For policy_evaluation, extract each distinct rule stated in the policy excerpts that is \
actually relevant to this request, and judge the draft against it:
- "passed": the draft clearly satisfies the rule.
- "binding": the rule is what determines or changes the outcome for this specific request \
(e.g. it sets which approver is needed, or whether extra justification is required because \
of the amount). At most one rule should be "binding".
- "outstanding": the rule applies but isn't yet satisfied by anything in the draft (e.g. a \
receipt or follow-up item still owed).

"evidence" must be a short span taken directly from the excerpt text, not a paraphrase or \
invention. If the excerpts contain no rules relevant to this request, return an empty list \
rather than inventing one. Never evaluate a rule that isn't stated in the excerpts.

"cap" is the single dollar amount from the excerpt that this specific rule enforces against \
the draft's amount (e.g. a per-event or per-person reimbursement limit) -- omit it (null) \
unless the rule is genuinely a dollar cap that applies to this request's amount. A policy \
excerpt may contain several dollar figures for different purposes (a spending limit vs. an \
escalation threshold, for instance); pick the one this rule itself states, never a different \
figure from the same excerpt. Only ever set "cap" on the "binding" rule.
"""

ESCALATION_SYSTEM_PROMPT = """You decide whether an employee request needs escalation to a \
Reviewer/Specialist before a decision can be made, or whether it can go straight to the \
normal Approver.

Given the draft, the policy rule evaluation (which rules apply, and which single rule is \
"binding" -- the one that actually determines the outcome), decide:
{
  "routed_to": "approver"|"reviewer",
  "reviewer_category": "finance"|"legal"|"it"|null (only set this if routed_to is "reviewer"),
  "reason": "one sentence, specific to this request, not a generic policy restatement",
  "confidence": "high"|"medium"|"low",
  "triggered_rule": "the exact rule text that drove this decision, copied from the input, or \
null if none applied"
}

Route to "reviewer" only when the binding policy rule (or another rule in the evaluation) \
clearly requires specialist sign-off -- an amount over a stated cap, a compliance or legal \
requirement, a category that always needs domain review. Otherwise route to "approver". \
Never invent a threshold or requirement that isn't in the policy rule evaluation you were \
given -- if you're not sure escalation is required, route to "approver" with lower \
confidence rather than escalate speculatively.
"""

APPROVAL_SUMMARY_SYSTEM_PROMPT = """You write a short decision-ready brief for a busy \
approver who will not read the full drafted request or its policy citations -- they will \
only read this.

Given the draft, the policy rule evaluation, and whether retrieved policy was actually \
judged relevant to this request, respond with JSON:
{"summary": "2-3 plain-language sentences, no bullet points"}

Cover exactly: what's being requested and the amount, and the one thing that matters most \
for this specific decision. Do not restate every rule; the approver wants the one fact that \
would change their decision, not a checklist.

The policy rule evaluation being empty means one of two different things -- say the correct \
one, never blur them:
- Policy WAS found and judged relevant, but raised no rule against this request: say the \
request is routine and clears policy cleanly.
- No applicable policy was found for this category at all (policy_relevant is false, or no \
policy was retrieved): say plainly that no applicable company policy was found for this \
category, NOT that it clears or passes policy -- those are not the same fact, and an \
approver deciding without any policy backing needs to know that.
"""
