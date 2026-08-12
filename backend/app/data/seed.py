"""
Run once against a fresh database:
    python -m app.data.seed

Creates tables (via SQLAlchemy metadata — fine for MVP; move to Alembic
migrations before this gets a second contributor or a production deploy)
and seeds the mock policy corpus with real embeddings so retrieval works
out of the box.
"""
from sqlalchemy import text as sql_text

from app.core.security import hash_password
from app.data.policy_docs.seed_docs import DOCS
from app.db.models import Base, PolicyDoc, User, UserRole
from app.db.session import SessionLocal, engine
from app.services.embedding import embed_text

# For demo login -- change these before this ever leaves a laptop.
DEMO_ACCOUNTS = [
    {"email": "requester@acme-demo.com", "name": "Alice", "password": "demo1234", "role": UserRole.REQUESTER},
    {"email": "approver@acme-demo.com", "name": "Bob", "password": "demo1234", "role": UserRole.APPROVER},
    {"email": "admin@acme-demo.com", "name": "Admin", "password": "demo1234", "role": UserRole.ADMIN},
]


def _migrate_runs_user_id() -> None:
    # Base.metadata.create_all() creates missing tables but never alters
    # existing ones -- runs already existed before user_id was added to the
    # model, so that column would otherwise silently never appear. Additive
    # and idempotent: existing rows just get user_id = NULL (pre-auth demo
    # runs), nothing is dropped.
    with engine.connect() as conn:
        conn.execute(sql_text(
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL"
        ))
        conn.commit()


def _seed_demo_accounts(db) -> None:
    for account in DEMO_ACCOUNTS:
        if db.query(User).filter_by(email=account["email"]).first() is not None:
            continue
        db.add(User(
            email=account["email"], name=account["name"],
            password_hash=hash_password(account["password"]), role=account["role"],
        ))
    db.commit()
    print(f"Demo accounts ready: {', '.join(a['email'] + ' / ' + a['password'] for a in DEMO_ACCOUNTS)}")


def main():
    # pgvector extension must exist before creating the vector column
    with engine.connect() as conn:
        conn.execute(sql_text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    Base.metadata.create_all(bind=engine)  # creates `users` (new table) -- fine
    _migrate_runs_user_id()  # alters `runs` (existing table) -- create_all can't do this

    db = SessionLocal()
    try:
        _seed_demo_accounts(db)

        existing = db.query(PolicyDoc).count()
        if existing > 0:
            print(f"policy_docs already has {existing} rows, skipping seed.")
            return

        for doc in DOCS:
            embedding = embed_text(doc["content"])
            db.add(PolicyDoc(title=doc["title"], content=doc["content"], embedding=embedding))
        db.commit()
        print(f"Seeded {len(DOCS)} policy docs.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
