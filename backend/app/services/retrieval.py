"""
Hybrid retrieval over the mock policy_docs corpus.

Directly ported from Lexara's pgvector_store.py + query_service.py — same
BM25 + pgvector cosine fusion via Reciprocal Rank Fusion (k=60), same
"compute both rankings, merge by RRF score" approach. Simplified because
this platform has one global corpus, not per-workspace scoping.

Kept as its own module (not folded into the orchestrator) on purpose: the
orchestrator should only know "there is a retrieve_policy(query) function
that returns matches," not how retrieval works. That's the platform/vertical
boundary in miniature — swap this file's internals later without touching
orchestrator code.
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from rank_bm25 import BM25Okapi
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.services.embedding import embed_text


@dataclass
class PolicyMatch:
    doc_id: str
    title: str
    text: str
    score: float


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(v)) for v in values) + "]"


def _search_pgvector(db: Session, query_embedding: list[float], top_k: int) -> list[dict]:
    rows = db.execute(
        sql_text(
            """
            SELECT id AS doc_id, title, content AS text,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS score
            FROM policy_docs
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :limit
            """
        ),
        {"embedding": _vector_literal(query_embedding), "limit": top_k * 4},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


def retrieve_policy(db: Session, query: str, top_k: int = 3) -> list[PolicyMatch]:
    """Hybrid BM25 + semantic search over policy_docs, fused via RRF."""
    all_rows = db.execute(
        sql_text("SELECT id AS doc_id, title, content AS text FROM policy_docs")
    ).fetchall()
    all_dicts = [dict(r._mapping) for r in all_rows]
    if not all_dicts:
        return []

    # BM25 lexical ranking
    tokenized = [row["text"].lower().split() for row in all_dicts]
    bm25 = BM25Okapi(tokenized)
    bm25_scores = bm25.get_scores(query.lower().split())
    bm25_ranked = sorted(range(len(all_dicts)), key=lambda i: bm25_scores[i], reverse=True)
    bm25_rank = {all_dicts[i]["doc_id"]: rank for rank, i in enumerate(bm25_ranked)}

    # Semantic ranking
    query_embedding = embed_text(query)
    semantic_rows = _search_pgvector(db, query_embedding, top_k)
    semantic_rank = {row["doc_id"]: rank for rank, row in enumerate(semantic_rows)}

    # Reciprocal Rank Fusion, k=60 — same constant as Lexara, no reason to
    # retune it for a mock corpus this small.
    k = 60
    all_ids = set(bm25_rank) | set(semantic_rank)
    rrf_scores: dict[str, float] = {}
    for doc_id in all_ids:
        score = 0.0
        if doc_id in bm25_rank:
            score += 1 / (k + bm25_rank[doc_id])
        if doc_id in semantic_rank:
            score += 1 / (k + semantic_rank[doc_id])
        rrf_scores[doc_id] = score

    lookup = {row["doc_id"]: row for row in all_dicts}
    for row in semantic_rows:
        lookup[row["doc_id"]] = row

    top_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]
    return [
        PolicyMatch(doc_id=doc_id, title=lookup[doc_id]["title"], text=lookup[doc_id]["text"],
                    score=rrf_scores[doc_id])
        for doc_id in top_ids if doc_id in lookup
    ]
