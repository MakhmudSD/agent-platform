"use client";

import { useEffect, useState } from "react";
import { currentStageIndex, isTerminalStatus } from "@/lib/progress";

// Four steps, mapped 1:1 onto the first four real RunStatus values (see
// lib/progress.ts / backend RunStatus). "finalized"/"rejected" don't get a
// fifth chip -- once decided, every chip reads as done.
const STEP_LABELS = ["Gathering details", "Checking policy", "Drafting request", "Awaiting decision"];

function elapsedLabel(startedAt: number | null): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

interface RunProgressProps {
  status: string | null;
  liveNode: string | null;
  statusLabel: string;
  startedAt: number | null;
  // Only meaningful pre-approval, while the requester is still filling in
  // fields -- this used to live in a separate "N of 5 details captured"
  // panel (LivePanel.tsx) with its own progress bar; folded in here as the
  // one extra fact the status line needs, not a second bar.
  captured?: { count: number; total: number } | null;
}

// A quiet, single-line status indicator -- driven entirely by the run's real
// status/liveNode (see lib/progress.ts), never decorative. Replaces an
// earlier 4-button-sized chip strip: that design read as a row of nav tabs
// sitting above the thread rather than background progress, which is what
// it actually is. This is closer to how a background task reads in Slack
// or Linear: a status dot, the current stage in text, and a thin 4-segment
// bar underneath -- same real information (current stage, elapsed time),
// far less visual weight. `startedAt` is a client-observed timestamp (first
// audit event received), used only for the elapsed clock.
export function RunProgress(props: RunProgressProps) {
  const { status, liveNode, statusLabel, startedAt, captured } = props;

  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!startedAt || isTerminalStatus(status)) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, status]);

  if (!status && !liveNode) return null;

  const idx = Math.min(currentStageIndex(status, liveNode), STEP_LABELS.length - 1);
  const terminal = isTerminalStatus(status);

  return (
    <div className="pb-3 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-[7px] w-[7px] shrink-0">
          {!terminal && (
            <span className="animate-breathe absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          )}
          <span className={`relative inline-flex rounded-full h-[7px] w-[7px] ${terminal ? "bg-ink-muted" : "bg-accent"}`} />
        </span>
        <span className="text-[13px] font-medium text-ink-2">{statusLabel}</span>
        {captured && (
          <span className="text-[11.5px] text-text-quaternary">{captured.count} of {captured.total} details</span>
        )}
        <span className="text-[11.5px] text-text-quaternary font-mono ml-auto">{elapsedLabel(startedAt)}</span>
      </div>
      <div className="flex gap-1 h-[3px]">
        {STEP_LABELS.map((label, i) => {
          const done = terminal || i < idx;
          const active = !terminal && i === idx;
          return (
            <div key={label} className={`relative flex-1 rounded-full overflow-hidden ${done || active ? "bg-ink" : "bg-neutral-fill-2"}`}>
              {active && <span className="absolute inset-y-0 left-0 w-full bg-white/30 animate-fillbar" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
