import { Icon } from "@/components/Icon";

export interface AgentInfo {
  icon: string;
  name: string;
  purpose: string;
  // Longer than `purpose` -- what actually triggers this agent, what (if
  // anything) the user needs to do while it's active, and what to expect
  // back. `purpose` stays the one-line card blurb; this is the modal body.
  guide: string;
}

export function AgentGuideModal(props: { agent: AgentInfo; onClose: () => void }) {
  const { agent, onClose } = props;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-panel rounded-2xl shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <span className="shrink-0 w-10 h-10 rounded-lg bg-accent-tint text-accent flex items-center justify-center">
            <Icon name={agent.icon} size={19} filled={false} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-base font-semibold text-ink">{agent.name}</p>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">{agent.purpose}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-neutral-fill transition-colors"
          >
            <Icon name="close" size={16} filled={false} />
          </button>
        </div>

        <p className="text-[13.5px] leading-[1.6] text-ink-2 whitespace-pre-line">{agent.guide}</p>

        <button
          onClick={onClose}
          className="mt-5 w-full px-3.5 py-2.5 rounded-lg bg-ink text-white text-[13px] font-medium hover:bg-ink/90"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
