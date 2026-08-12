"use client";

import { useEffect, useState } from "react";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";

type RunSummary = { run_id: string; status: string; requester_name: string; user_id: string | null; created_at: string };

export function Sidebar({
  activeRunId,
  onSelectPendingRun,
  refreshKey,
}: {
  activeRunId?: string;
  // Approver-only: lets clicking a pending run actually load it into the
  // live panel to act on, instead of only being viewable read-only via
  // /history. Requester's "Recent" list still links to /history -- picking
  // a past run back up into a live conversation isn't wired up for that
  // side yet.
  onSelectPendingRun?: (runId: string) => void;
  // Bumped by the parent whenever a run's status actually changes (a WS
  // "result" lands) -- role/activeRunId alone don't change just because a
  // run got approved/rejected, so without this the list would show a
  // just-resolved run as still pending until something else triggered a
  // refetch.
  refreshKey?: number;
}) {
  const { user, logout } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const role = user?.role;
  const isApprover = role === "approver" || role === "admin";

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
  }, [user, activeRunId, refreshKey]);

  // Prefer the real user_id match -- requester_name is a free-text display
  // name and two accounts can share one, which would otherwise leak runs
  // across accounts. Legacy rows predating auth have user_id === null, so
  // those still fall back to name matching rather than becoming invisible.
  const visibleRuns = isApprover
    ? runs.filter((r) => r.status === "awaiting_approval")
    : runs.filter((r) => (r.user_id ? r.user_id === user?.id : r.requester_name === user?.name));

  const listLabel = isApprover ? "Pending approval" : "Recent";
  const emptyLabel = isApprover ? "Nothing awaiting approval." : "No requests yet.";

  // Notifications carry no user_id column yet -- "relevant to this user" is
  // still decided by message shape + name-matching, same technique the run
  // list above uses. A real per-user column (now that accounts exist) is
  // the natural next step, just not done in this pass.
  const runById = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const relevantUnread = notifications.filter((n) => {
    if (n.read) return false;
    if (isApprover) return n.message.startsWith("Awaiting approval:");
    const run = runById[n.run_id];
    if (!run) return false;
    const owned = run.user_id ? run.user_id === user?.id : run.requester_name === user?.name;
    return n.message.startsWith("Your request") && owned;
  });

  async function clearNotifications() {
    await Promise.all(relevantUnread.map((n) => api.markNotificationRead(n.id)));
    api.listNotifications().then(setNotifications).catch(() => {});
  }

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 flex flex-col border-r border-slate-200 bg-[#F7F5F0]">
      <div className="px-4 py-4 space-y-3">
        <a href="/" className="flex items-center gap-2">
          <Logo size={24} />
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

        {user && (
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
              <p className="text-[10.5px] uppercase tracking-wide text-slate-400">{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="text-xs text-slate-400 hover:text-slate-700 shrink-0 ml-2"
            >
              Sign out
            </button>
          </div>
        )}
        {role === "admin" && (
          <a
            href="/admin"
            className="block text-xs text-slate-500 hover:text-slate-700 px-0.5"
          >
            Admin dashboard →
          </a>
        )}
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
          {visibleRuns.map((r) =>
            isApprover && onSelectPendingRun ? (
              <button
                key={r.run_id}
                onClick={() => onSelectPendingRun(r.run_id)}
                className={`block w-full text-left px-2.5 py-2 rounded-md text-sm truncate transition-colors ${
                  activeRunId === r.run_id
                    ? "bg-slate-200/70 text-slate-900"
                    : "text-slate-600 hover:bg-slate-200/40"
                }`}
              >
                {r.requester_name}{" "}
                <span className="text-slate-400 font-normal">· {r.status}</span>
              </button>
            ) : (
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
            )
          )}
          {visibleRuns.length === 0 && (
            <p className="px-2 text-xs text-slate-400">{emptyLabel}</p>
          )}
        </div>
      </div>

      <div className="px-3 py-4 border-t border-slate-200">
        <a href="/history" className="text-xs text-slate-500 hover:text-slate-700">
          View audit trail →
        </a>
      </div>
    </aside>
  );
}
