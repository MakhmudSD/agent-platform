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
    {"email": "reviewer@acme-demo.com", "name": "Carol", "password": "demo1234", "role": UserRole.REVIEWER},
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


def _migrate_userrole_enum() -> None:
    # Postgres enum types are append-only via ALTER TYPE -- create_all()
    # doesn't touch an enum type that already exists, so REVIEWER (added
    # after users already existed) would otherwise never become a valid
    # value in the DB, even though it's in the Python UserRole enum.
    # ALTER TYPE ... ADD VALUE can't run inside SQLAlchemy's normal
    # (implicitly transactional) connection -- needs true autocommit.
    # Not IF-NOT-EXISTS-safe on older Postgres, so catch "already exists"
    # instead of trying to pre-check it.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        try:
            conn.execute(sql_text("ALTER TYPE userrole ADD VALUE 'REVIEWER'"))
        except Exception:
            pass


def _migrate_runs_routed_to() -> None:
    # Same reasoning as _migrate_runs_user_id -- routed_to was added after
    # runs already existed. Existing rows get NULL (never routed by the
    # new escalation step), which the app already treats as "goes to the
    # approver queue" for backwards compatibility.
    with engine.connect() as conn:
        conn.execute(sql_text(
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS routed_to VARCHAR(20)"
        ))
        conn.commit()


def _migrate_notification_columns() -> None:
    # Same additive pattern as the other _migrate_* functions -- adds
    # user_id/target_role/type to notifications, then backfills existing
    # rows from real data already on hand: the message text these rows
    # were built from (still exactly the same prefixes notify()'s callers
    # used before this migration) and a join back to runs for user_id.
    # Real backfill, not a fabricated default -- a row this can't
    # confidently classify (message text changed shape, or the run's
    # owner is itself NULL on a pre-auth demo run) is left NULL rather
    # than guessed at.
    with engine.connect() as conn:
        conn.execute(sql_text(
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE"
        ))
        conn.execute(sql_text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role VARCHAR(20)"))
        conn.execute(sql_text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(20)"))
        conn.execute(sql_text(
            "UPDATE notifications SET type = 'needs_approval', target_role = 'approver' "
            "WHERE type IS NULL AND message LIKE 'Awaiting approval:%'"
        ))
        conn.execute(sql_text(
            "UPDATE notifications SET type = 'needs_review', target_role = 'reviewer' "
            "WHERE type IS NULL AND message LIKE 'Awaiting review:%'"
        ))
        conn.execute(sql_text(
            "UPDATE notifications n SET type = 'approved', user_id = r.user_id "
            "FROM runs r WHERE n.run_id = r.id AND n.type IS NULL AND n.message LIKE '%was approved.'"
        ))
        conn.execute(sql_text(
            "UPDATE notifications n SET type = 'rejected', user_id = r.user_id "
            "FROM runs r WHERE n.run_id = r.id AND n.type IS NULL AND n.message LIKE '%was rejected.'"
        ))
        conn.commit()


def _migrate_runs_folder_columns() -> None:
    # Same additive pattern as the other _migrate_* functions -- archived
    # and folder_id were added after runs already existed. folders itself
    # is a brand-new table so create_all() handles it; this only patches
    # the existing runs table. Existing rows get archived = false,
    # folder_id = NULL -- nothing is hidden or filed by default.
    with engine.connect() as conn:
        conn.execute(sql_text(
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(sql_text(
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL"
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
    _migrate_userrole_enum()  # adds 'reviewer' to the userrole enum type
    _migrate_runs_user_id()  # alters `runs` (existing table) -- create_all can't do this
    _migrate_runs_routed_to()
    _migrate_notification_columns()
    _migrate_runs_folder_columns()  # folders table itself comes from create_all() above

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
