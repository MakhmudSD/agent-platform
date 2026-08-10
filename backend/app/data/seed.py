"""
Run once against a fresh database:
    python -m app.data.seed

Creates tables (via SQLAlchemy metadata — fine for MVP; move to Alembic
migrations before this gets a second contributor or a production deploy)
and seeds the mock policy corpus with real embeddings so retrieval works
out of the box.
"""
from sqlalchemy import text as sql_text

from app.data.policy_docs.seed_docs import DOCS
from app.db.models import Base, PolicyDoc
from app.db.session import SessionLocal, engine
from app.services.embedding import embed_text


def main():
    # pgvector extension must exist before creating the vector column
    with engine.connect() as conn:
        conn.execute(sql_text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
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
