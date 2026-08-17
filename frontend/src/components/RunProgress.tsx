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
}

// Horizontal 4-chip strip per design_handoff_approval_flow/README.md's
// "Progress strip" spec -- driven entirely by the run's real status/liveNode
// (see lib/progress.ts), never decorative. `startedAt` is a client-observed
// timestamp (first audit event received), used only for the elapsed clock.
export function RunProgress(props: RunProgressProps) {
  const { status, liveNode, statusLabel, startedAt } = props;

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
    <div className="pb-[18px] mb-4 border-b border-hairline">
      <div className="flex items-baseline justify-between mb-[11px]">
        <span className="text-[13.5px] font-semibold text-ink tracking-[-.01em]">{statusLabel}</span>
        <span className="text-[12.5px] text-text-quaternary font-mono">{elapsedLabel(startedAt)}</span>
      </div>
      <div className="flex gap-[5px] h-[42px]">
        {STEP_LABELS.map((label, i) => {
          const done = terminal || i < idx;
          const active = !terminal && i === idx;
          return (
            <div
              key={label}
              className={`relative flex items-center justify-center gap-1.5 rounded-xl px-2 overflow-hidden ${
                done ? "flex-1 bg-ink" : active ? "flex-[1.2] bg-accent shadow-teal-strip" : "flex-1 bg-neutral-fill-2"
              }`}
            >
              {active && (
                <span className="absolute inset-y-0 left-0 bg-white/10 animate-fillbar" />
              )}
              {done && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#9A938A]">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.6l-4.4-4.4 1.4-1.4 3 3 6-6 1.4 1.4-7.4 7.4z" fill="currentColor" />
                </svg>
              )}
              <span
                className={`relative text-[13.5px] whitespace-nowrap overflow-hidden text-ellipsis ${
                  done ? "font-medium text-app" : active ? "font-semibold text-white" : "font-normal text-ink-muted"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
