"""
Everything specific to the "Employee Request Assistant" demo scenario lives
here. The orchestrator engine (engine.py) imports this module but contains
no scenario-specific knowledge itself — swapping to a different workflow
flavor (IT access request, vendor onboarding) means writing a new module
like this one, not touching engine.py.

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
"""

DRAFT_SYSTEM_PROMPT = """You are finalizing an employee request draft for approval, using \
retrieved company policy context if relevant.

Given the draft fields and any policy excerpts, respond with JSON:
{
  "final_draft": {...the same fields, cleaned up, plus "requester" if provided...},
  "policy_notes": "one sentence noting which policy (if any) applies, or empty string"
}

Do not invent policy content that wasn't provided in the excerpts.
"""
