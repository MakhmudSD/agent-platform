"use client";

import { useEffect, useRef } from "react";
import { AuditLogEntry } from "@/lib/ws";

const NODE_LABELS: Record<string, string> = {
  manager: "Deciding next step",
  intake: "Gathering request details",
  await_message: "Waiting on you",
  policy_research: "Checking company policy",
  draft: "Drafting the request",
  interrupt_for_approval: "Waiting on approver",
  apply_approval: "Applying decision",
};

export function LivePanel({
  status,
  liveNode,
  liveDraft,
  streamText,
  auditLog,
}: {
  status: string | null;
  liveNode: string | null;
  liveDraft: Record<string, any> | null;
  streamText: string;
  auditLog: AuditLogEntry[];
}) {
  const auditEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    auditEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [auditLog.length]);

  return (
    <aside className="w-80 shrink-0 h-screen sticky top-0 flex flex-col border-l border-black/5 bg-[#FAFAF8]">
      <div className="px-4 py-4 border-b border-black/5">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Live status
        </p>
        {liveNode ? (
          <div className="flex items-center gap-2 text-sm text-slate-800">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            {NODE_LABELS[liveNode] ?? liveNode}
          </div>
        ) : (
          <div className="text-sm text-slate-400">
            {status ? `Idle · ${status.replace("_", " ")}` : "Idle"}
          </div>
        )}
        {streamText && (
          <pre className="mt-2 text-[11px] leading-snug text-slate-500 whitespace-pre-wrap break-words max-h-24 overflow-y-auto font-mono">
            {streamText}
          </pre>
        )}
      </div>

      {liveDraft && (
        <div className="px-4 py-4 border-b border-black/5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Draft (live)
          </p>
          <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-xs">
            {Object.entries(liveDraft).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-slate-400 capitalize">{key.replace(/_/g, " ")}</dt>
                <dd className="text-slate-800 font-medium truncate" title={value ? String(value) : undefined}>
                  {value ? String(value) : "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Audit trail (live)
        </p>
        {auditLog.length === 0 ? (
          <p className="text-xs text-slate-400">Events will appear here as the agent works.</p>
        ) : (
          <ul className="space-y-1.5">
            {auditLog.map((entry, i) => (
              <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                <span className="text-slate-300 mt-0.5 shrink-0">
                  {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="font-mono text-[11px]">{entry.event_type}</span>
              </li>
            ))}
            <div ref={auditEndRef} />
          </ul>
        )}
      </div>
    </aside>
  );
}
