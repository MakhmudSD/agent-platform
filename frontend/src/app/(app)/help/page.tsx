"use client";

import { AGENT_INFO } from "@/lib/agentInfo";
import { Icon } from "@/components/Icon";
import { NotificationBell } from "@/components/NotificationBell";

// Standalone version of the same guide the home page's agent cards open in
// a modal -- reachable any time via the Help rail item (Sidebar.tsx), not
// just from the empty landing state, and shown as one page instead of five
// separate clicks since there's no in-context reason to gate it here.
export default function HelpPage() {
  return (
    <div className="flex-1 flex flex-col h-screen min-w-0 bg-app">
      <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
        <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Help</span>
        <NotificationBell />
      </div>

      <div className="flex-1 overflow-y-auto bg-surface px-9 py-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-semibold text-ink mb-1.5">How the agents work</h1>
          <p className="text-[13.5px] text-text-secondary mb-8">
            Every request moves through the same five agents, in order. Here's what each one actually does, what
            you need to do while it runs, and what to expect back.
          </p>

          <div className="flex flex-col gap-3">
            {AGENT_INFO.map((a, i) => (
              <div key={a.name} className="rounded-2xl bg-card shadow-card px-5 py-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="shrink-0 w-9 h-9 rounded-lg bg-accent-tint text-accent flex items-center justify-center">
                    <Icon name={a.icon} size={17} filled={false} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-text-quaternary">Step {i + 1}</p>
                    <p className="text-[15px] font-semibold text-ink">{a.name}</p>
                    <p className="text-[12.5px] text-text-tertiary mt-0.5">{a.purpose}</p>
                  </div>
                </div>
                <p className="text-[13.5px] leading-[1.6] text-ink-2 whitespace-pre-line pl-12">{a.guide}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
