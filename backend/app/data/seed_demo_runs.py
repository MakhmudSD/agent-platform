"""
Seeds a curated, realistic set of demo requests by actually driving the
real orchestrator graph (app.orchestrator.graph) as the real demo accounts
-- every draft, policy citation, rule evaluation, and routing decision here
is genuinely produced by the LLM against the real seeded policy corpus,
not hand-written. This is what makes the demo trustworthy to show someone:
nothing on screen is fabricated, it's just real runs picked to cover a
representative spread of outcomes (approved, rejected, pending, gathering,
routed to a specialist reviewer, no-applicable-policy).

Run once against a database that already has seed.py's demo accounts and
policy docs:
    python -m app.data.seed_demo_runs

Idempotent by volume, not by content: skips entirely if the requester
already has any runs, so re-running after someone's used the live demo
doesn't pile on duplicates. Use seed.py's own DEMO_ACCOUNTS if you need a
truly clean slate first (or just delete the runs table -- run_events,
notifications, and run_feedback all cascade from runs.id).
"""
from __future__ import annotations

from app.db.models import Run, User, UserRole
from app.db.session import SessionLocal
from app.orchestrator import graph
from app.orchestrator.cards import ApprovalRequestCard, ClarifyingQuestionCard

# (initial message, justification reply if asked, decision or None to leave pending)
# decision: "approve" | "reject" | None (leave awaiting_approval for the live
# demo) | "gathering" (deliberately left with an unanswered clarifying
# question, to show the conversational flow still in progress)
SCENARIOS = [
    (
        "I need $2400 to register for and travel to the DevOps Summit conference "
        "in Austin, cost center Engineering, dated 2026-09-15",
        "Attending to represent our platform team and evaluate new CI/CD tooling for the org.",
        "approve",
    ),
    (
        "I need $89/month for a Figma organization subscription for the design team, "
        "cost center Design, dated 2026-08-20",
        "Design team needs shared component libraries and dev handoff tooling.",
        "approve",
    ),
    (
        "I need $2800 to buy a specialized GPU workstation for the ML research team, "
        "cost center Engineering, dated 2026-08-25",
        "Training larger models locally before committing to expensive cloud GPU hours.",
        "approve",
    ),
    (
        "I need $210 for a client dinner with our largest account after the contract "
        "renewal, cost center Sales, dated 2026-08-18",
        "Celebratory dinner with the client's VP of Ops following contract renewal, 2 attendees.",
        "approve",
    ),
    (
        "I need $18 for a taxi to the airport for a client visit, cost center Sales, "
        "dated 2026-08-19",
        "Picking up a client from the airport ahead of an onsite meeting.",
        "approve",
    ),
    (
        "I need $4800 for travel and registration to a leadership offsite conference, "
        "cost center Marketing, dated 2026-09-01",
        "Leadership team building.",
        "reject",
    ),
    (
        "I need $32 for office supplies, sticky notes and markers for the team room, "
        "cost center Marketing, dated 2026-08-19",
        "Restocking shared team room supplies.",
        None,
    ),
    (
        "I need $65 for parking during a 3-day offsite, cost center Sales, "
        "dated 2026-08-20, this is urgent",
        "Parking for the mandatory sales offsite next week.",
        None,
    ),
    (
        "I need approval for a new laptop for a new hire starting Monday",
        None,
        "gathering",
    ),
]

REJECT_REASON = "Please tie this to a specific current project or initiative before resubmitting."


def main():
    db = SessionLocal()
    try:
        alice = db.query(User).filter_by(email="requester@acme-demo.com").first()
        bob = db.query(User).filter_by(email="approver@acme-demo.com").first()
        carol = db.query(User).filter_by(email="reviewer@acme-demo.com").first()
        if alice is None or bob is None or carol is None:
            print("Demo accounts missing -- run `python -m app.data.seed` first.")
            return

        existing = db.query(Run).filter_by(user_id=alice.id).count()
        if existing > 0:
            print(f"{alice.name} already has {existing} runs -- skipping (not idempotent by content).")
            return

        for initial_message, justification, decision in SCENARIOS:
            run, card = graph.start_run(db, alice.name, initial_message, user_id=alice.id)
            print(f"started: {initial_message[:60]!r} -> {type(card).__name__}")

            if decision == "gathering":
                # Deliberately leave this one mid-conversation, unanswered --
                # a live, resumable example of the gathering state itself.
                continue

            turns = 0
            pending_justification = justification
            while isinstance(card, ClarifyingQuestionCard) and turns < 4:
                reply = pending_justification or "That's correct, please proceed."
                pending_justification = None
                card = graph.handle_message(db, run, reply)
                turns += 1

            if not isinstance(card, ApprovalRequestCard):
                print(f"  -> did not reach approval_request (got {type(card).__name__}), leaving as-is.")
                continue

            routed_to = card.routing_decision.routed_to if card.routing_decision else "approver"
            print(f"  -> routed to {routed_to}; category={card.draft.get('category')!r}")

            if decision is None:
                continue  # leave awaiting_approval for the live demo

            decider = carol if routed_to == "reviewer" else bob
            approved = decision == "approve"
            reason = REJECT_REASON if not approved else None
            graph.handle_approval_response(db, run, approved, reason, approver_name=decider.name)
            print(f"  -> {'approved' if approved else 'rejected'} by {decider.name}")

        db.commit()
        print("Demo runs seeded.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
