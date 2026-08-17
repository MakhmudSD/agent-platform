// Shared source of truth for "where is this run in its lifecycle," mirroring
// backend/app/db/models.py's RunStatus enum exactly. Both the sidebar's
// mini progress bars and the detail view's Agent/Human bar read from here so
// they can never disagree about what stage a status maps to.
export const RUN_STAGES = ["gathering", "retrieving", "drafting", "awaiting_approval", "finalized"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

// "rejected" isn't in RUN_STAGES (it's a terminal outcome, not a stage) but
// it ends the pipeline the same way "finalized" does, so it maps to the same
// terminal index.
export function stageIndexForStatus(status: string | null | undefined): number {
  if (!status) return 0;
  if (status === "rejected") return RUN_STAGES.length - 1;
  const idx = RUN_STAGES.indexOf(status as RunStage);
  return idx === -1 ? 0 : idx;
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return status === "finalized" || status === "rejected";
}

// A run's persisted `status` only advances once a WS "result" event lands
// (one full turn), but the backend fires node_started events for every
// intermediate node in between (policy_research, draft, ...) via the same
// socket. Without this, the progress bar would sit frozen on the old status
// for the entire time a turn is processing, even though LivePanel's own
// live-node label is visibly moving. This maps the currently-active node to
// the stage it's advancing toward so the bar moves in step with that label.
const NODE_TO_STAGE: Partial<Record<string, number>> = {
  policy_research: 1,
  draft: 2,
  interrupt_for_approval: 3,
  apply_approval: 4,
};

export function currentStageIndex(status: string | null | undefined, liveNode: string | null): number {
  const base = stageIndexForStatus(status);
  const live = liveNode ? NODE_TO_STAGE[liveNode] : undefined;
  return live !== undefined ? Math.max(base, live) : base;
}
