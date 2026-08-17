import { isTerminalStatus, RUN_STAGES, stageIndexForStatus } from "@/lib/progress";

// Five-segment strip rendered under each sidebar row. Purely a read-out of
// the run's real `status` field (see lib/progress.ts) -- never decorative.
export function MiniProgress({ status }: { status: string }) {
  const idx = stageIndexForStatus(status);
  const terminal = isTerminalStatus(status);

  return (
    <div className="flex gap-0.5 mt-1.5" aria-hidden="true">
      {RUN_STAGES.map((_, i) => {
        let cls = "bg-neutral-fill-2";
        if (terminal || i < idx) cls = "bg-ink";
        else if (i === idx) cls = "bg-accent animate-pulse";
        return <span key={i} className={`h-1 flex-1 rounded-full ${cls}`} />;
      })}
    </div>
  );
}
