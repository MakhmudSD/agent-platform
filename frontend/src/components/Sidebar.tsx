"use client";

import { useEffect, useState } from "react";
import { api, Notification } from "@/lib/api";
import { REQUESTER_NAME, useRole } from "@/lib/role";

type RunSummary = { run_id: string; status: string; requester_name: string; created_at: string };

export function Sidebar({ activeRunId }: { activeRunId?: string }) {
  const { role, setRole } = useRole();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
  }, [role, activeRunId]);

  const visibleRuns =
    role === "approver"
      ? runs.filter((r) => r.status === "awaiting_approval")
      : runs.filter((r) => r.requester_name === REQUESTER_NAME);

  const listLabel = role === "approver" ? "Pending approval" : "Recent";
  const emptyLabel = role === "approver" ? "Nothing awaiting approval." : "No requests yet.";

  // Notifications carry no role/user column (no real identity system yet) --
  // "relevant to this role" is decided the same way the run list above is:
  // by message shape (set at creation in nodes.py) and, for the Requester
  // side, by joining run_id against the runs list already fetched.
  const runById = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const relevantUnread = notifications.filter((n) => {
    if (n.read) return false;
    if (role === "approver") return n.message.startsWith("Awaiting approval:");
    const run = runById[n.run_id];
    return n.message.startsWith("Your request") && run?.requester_name === REQUESTER_NAME;
  });

  async function clearNotifications() {
    await Promise.all(relevantUnread.map((n) => api.markNotificationRead(n.id)));
    api.listNotifications().then(setNotifications).catch(() => {});
  }

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 flex flex-col border-r border-black/5 bg-[#F7F5F0]">
      <div className="px-4 py-4 space-y-3">
        <a href="/" className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
            R
          </span>
          <span className="text-sm font-semibold text-slate-900">Request Assistant</span>
          {relevantUnread.length > 0 && (
            <button
              onClick={clearNotifications}
              title={relevantUnread.map((n) => n.message).join("\n")}
              className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10.5px] font-semibold leading-none hover:bg-red-600 transition-colors"
            >
              {relevantUnread.length}
            </button>
          )}
        </a>

        <label className="block">
          <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Acting as
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "requester" | "approver")}
            className="w-full text-sm rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
          >
            <option value="requester">Requester</option>
            <option value="approver">Approver</option>
          </select>
        </label>
      </div>

      <div className="px-3">
        <a
          href="/"
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm transition-colors"
        >
          <span className="text-base leading-none">+</span> New request
        </a>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
          {listLabel}
        </p>
        <div className="space-y-0.5">
          {visibleRuns.map((r) => (
            <a
              key={r.run_id}
              href="/history"
              className={`block px-2.5 py-2 rounded-md text-sm truncate transition-colors ${
                activeRunId === r.run_id
                  ? "bg-slate-200/70 text-slate-900"
                  : "text-slate-600 hover:bg-slate-200/40"
              }`}
            >
              {r.requester_name}{" "}
              <span className="text-slate-400 font-normal">· {r.status}</span>
            </a>
          ))}
          {visibleRuns.length === 0 && (
            <p className="px-2 text-xs text-slate-400">{emptyLabel}</p>
          )}
        </div>
      </div>

      <div className="px-3 py-4 border-t border-black/5">
        <a href="/history" className="text-xs text-slate-500 hover:text-slate-700">
          View audit trail →
        </a>
      </div>
    </aside>
  );
}
