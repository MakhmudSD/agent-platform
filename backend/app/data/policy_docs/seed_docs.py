"""
Mock company policy corpus for the demo. Deliberately fake company, fake
numbers — this is what gets retrieved and cited during the demo, so it
needs to sound like a real internal policy doc, not a placeholder.
"""

DOCS = [
    {
        "title": "Travel & Conference Expense Policy",
        "content": (
            "Employees attending external conferences or industry events may expense "
            "registration fees, travel, and lodging up to $3,000 per event without "
            "director-level approval. Expenses between $3,000 and $7,500 require "
            "written justification tying the event to a current project or role "
            "responsibility, and are reviewed by the requester's manager. Expenses "
            "above $7,500 require VP approval regardless of justification. All "
            "conference expense requests must include the event name, dates, and a "
            "one-sentence business justification. Reimbursement requests submitted "
            "more than 60 days after the event will not be processed."
        ),
    },
    {
        "title": "Software & Subscription Purchase Policy",
        "content": (
            "Individual software subscriptions under $200/month may be purchased "
            "directly by employees using their department cost center, with "
            "notification to IT for license tracking. Purchases between $200 and "
            "$1,000/month require manager approval and a brief note on which team "
            "or project the tool supports. Any purchase involving customer or "
            "employee data must be reviewed by IT Security before approval, "
            "regardless of cost."
        ),
    },
    {
        "title": "Equipment & Hardware Request Policy",
        "content": (
            "Standard equipment (laptops, monitors, peripherals) under $1,500 may be "
            "requested through the IT portal with manager approval only. "
            "Non-standard or specialized equipment (e.g. GPUs, specialized "
            "peripherals for accessibility needs) requires a business justification "
            "and is reviewed by both the requester's manager and IT. Equipment over "
            "$5,000 requires department head approval."
        ),
    },
    {
        "title": "Client Entertainment & Meals Policy",
        "content": (
            "Client meals and entertainment expenses are reimbursable up to $150 per "
            "person when a business purpose is documented, including client name and "
            "meeting topic. Expenses above $150 per person require manager "
            "pre-approval. Alcohol is reimbursable only when included in a client "
            "meal and does not exceed 30% of the total bill."
        ),
    },
    {
        "title": "Cost Center & Budget Allocation Guidelines",
        "content": (
            "All expense requests must be tagged to an active cost center. "
            "Engineering-related purchases default to the requester's team cost "
            "center unless the purchase supports a cross-team initiative, in which "
            "case the initiative's project code should be used instead. Requests "
            "without a valid cost center will be returned to the requester before "
            "processing."
        ),
    },
]
