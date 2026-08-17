"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

interface ConversationFeedbackProps {
  runId: string;
}

// Shown once a conversation has actually resolved (finalized/rejected for
// the requester, decided for the decider) -- rating something still in
// progress doesn't mean anything yet. One rating per (run, user); POST
// /runs/{id}/feedback upserts, so re-tapping the other thumb just flips it.
export function ConversationFeedback(props: ConversationFeedbackProps) {
  const { runId } = props;
  const [rating, setRating] = useState<boolean | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getFeedback(runId).then((r) => {
      if (!cancelled) setRating(r.rating);
    }).catch(() => {
      if (!cancelled) setRating(null);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function rate(value: boolean) {
    if (submitting) return;
    setSubmitting(true);
    const prev = rating;
    setRating(value);
    try {
      await api.submitFeedback(runId, value);
    } catch {
      setRating(prev ?? null);
    } finally {
      setSubmitting(false);
    }
  }

  if (rating === undefined) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card shadow-card">
      <span className="text-[13px] text-text-tertiary">
        {rating === null ? "How did this go?" : "Thanks for the feedback."}
      </span>
      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={() => rate(true)}
          title="Good experience"
          aria-label="Good experience"
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            rating === true ? "bg-accent-tint text-accent" : "text-text-tertiary hover:bg-neutral-fill/50"
          }`}
        >
          <Icon name="thumb_up" size={17} filled={rating === true} />
        </button>
        <button
          onClick={() => rate(false)}
          title="Needs improvement"
          aria-label="Needs improvement"
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            rating === false ? "bg-[#F6EAE2] text-warning-strong" : "text-text-tertiary hover:bg-neutral-fill/50"
          }`}
        >
          <Icon name="thumb_down" size={17} filled={rating === false} />
        </button>
      </div>
    </div>
  );
}
