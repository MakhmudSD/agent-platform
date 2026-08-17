import { RUN_STAGES, stageIndexForStatus } from "@/lib/progress";

interface MiniProgressProps {
  status: string;
}

// Single hairline track, same primitive as the right panel's "N of M
// details captured" bar (LivePanel.tsx) -- a sidebar row is a compressed
// version of that same progress, not a different visual language.
export function MiniProgress(props: MiniProgressProps) {
  const { status } = props;
  const idx = stageIndexForStatus(status);
  const pct = status === "rejected" ? 100 : (idx / (RUN_STAGES.length - 1)) * 100;
  const fillCls = status === "rejected" ? "bg-warning-strong" : status === "finalized" ? "bg-ink" : "bg-accent";

  return (
    <div className="h-1 rounded-full bg-neutral-fill-2 overflow-hidden mt-1.5" aria-hidden="true">
      <span className={`block h-1 rounded-full transition-[width] duration-[450ms] ${fillCls}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
