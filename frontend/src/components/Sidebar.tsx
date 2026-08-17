"use client";

import { useEffect, useState } from "react";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { summarize } from "@/lib/stats";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { MiniProgress } from "@/components/MiniProgress";

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  user_id: string | null;
  routed_to: "approver" | "reviewer" | null;
  created_at: string;
  draft: Record<string, any> | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Sidebar({
  activeRunId,
  onSelectPendingRun,
  refreshKey,
}: {
  activeRunId?: string;
  // Approver/Reviewer only: lets clicking a pending run actually load it
  // into the live panel to act on, instead of only being viewable
  // read-only via /history. Requester's "Recent" list still links to
  // /history -- picking a past run back up into a live conversation isn't
  // wired up for that side yet.
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
  const isReviewer = role === "reviewer";
  const isDecider = isApprover || isReviewer;

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
  }, [user, activeRunId, refreshKey]);

  // Null/legacy routed_to defaults to "approver", matching the backend's
  // can_decide() default -- rows from before escalation_routing_node
  // existed, or any edge case where routing didn't fire, still land in the
  // approver's queue rather than nobody's. Admin sees both queues merged.
  // Prefer the real user_id match for the requester's own list --
  // requester_name is a free-text display name and two accounts can share
  // one, which would otherwise leak runs across accounts. Legacy rows
  // predating auth have user_id === null, so those still fall back to name
  // matching rather than becoming invisible.
  const visibleRuns = isReviewer
    ? runs.filter((r) => r.status === "awaiting_approval" && r.routed_to === "reviewer")
    : isApprover
    ? role === "admin"
      ? runs.filter((r) => r.status === "awaiting_approval")
      : runs.filter((r) => r.status === "awaiting_approval" && (r.routed_to ?? "approver") === "approver")
    : runs.filter((r) => (r.user_id ? r.user_id === user?.id : r.requester_name === user?.name));

  const listLabel = isReviewer ? "Pending review" : isApprover ? "Pending approval" : "Recent";
  const emptyLabel = isReviewer ? "Nothing awaiting review." : isApprover ? "Nothing awaiting approval." : "No requests yet.";

  // Notifications carry no user_id column yet -- "relevant to this user" is
  // still decided by message shape + name-matching, same technique the run
  // list above uses. A real per-user column (now that accounts exist) is
  // the natural next step, just not done in this pass.
  const runById = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const relevantUnread = notifications.filter((n) => {
    if (n.read) return false;
    if (isReviewer) return n.message.startsWith("Awaiting review:");
    if (isApprover) return n.message.startsWith("Awaiting approval:") || (role === "admin" && n.message.startsWith("Awaiting review:"));
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
    <div className="flex h-screen sticky top-0 shrink-0">
      {/* Icon rail -- 68px, per design_handoff_approval_flow/README.md's
          "Icon rail" spec exactly (widths, radii, colors). */}
      {/* Exactly the rail the design spec defines: logo, forum, inbox,
          history, avatar -- nothing added beyond it. "forum" and "inbox"
          both point home since this app has no separate conversations-vs-
          inbox screens (everything lives on one page); "history" is the
          one nav icon with a genuinely distinct real destination. */}
      <nav className="w-[68px] shrink-0 flex flex-col items-center gap-2 py-[18px] border-r border-hairline bg-rail">
        <a href="/" className="mb-4">
          <Logo size={32} />
        </a>

        <RailButton iconName="forum" label="Requests" href="/" active />
        <RailButton iconName="inbox" label="Requests" href="/" />
        <RailButton iconName="history" label="Audit trail" href="/history" />

        {user && (
          <div className="mt-auto">
            <div
              title={`${user.name} · ${user.role}`}
              className="w-8 h-8 rounded-[11px] bg-ink text-app flex items-center justify-center text-[11.5px] font-semibold"
            >
              {initials(user.name)}
            </div>
          </div>
        )}
      </nav>

      <aside className="w-64 shrink-0 h-screen flex flex-col border-r border-hairline bg-app">
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Request Assistant</span>
            {relevantUnread.length > 0 && (
              <button
                onClick={clearNotifications}
                title={relevantUnread.map((n) => n.message).join("\n")}
                className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warning-strong text-white text-[10.5px] font-semibold leading-none hover:opacity-90 transition-colors"
              >
                {relevantUnread.length}
              </button>
            )}
          </div>

          {user && (
            <div className="flex items-center justify-between rounded-xl border border-hairline bg-panel px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{user.name}</p>
                <p className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{user.role}</p>
              </div>
              <button
                onClick={logout}
                className="text-xs text-text-tertiary hover:text-ink shrink-0 ml-2"
              >
                Sign out
              </button>
            </div>
          )}
          {role === "admin" && (
            <a
              href="/admin"
              className="block text-xs text-text-secondary hover:text-ink px-0.5"
            >
              Admin dashboard →
            </a>
          )}
        </div>

        <div className="px-3">
          <a
            href="/"
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium text-ink-2 bg-panel border border-hairline hover:bg-neutral-fill/40 shadow-bubble transition-colors"
          >
            <span className="text-base leading-none">+</span> New request
          </a>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
            {listLabel}
          </p>
          <div className="space-y-0.5">
            {visibleRuns.map((r) => {
              const summary = summarize(r.draft);
              const rowContent = (
                <>
                  <span className="block truncate font-medium">
                    {summary ?? "New request"}
                  </span>
                  <span className="block truncate text-xs text-text-tertiary">
                    {isDecider ? `${r.requester_name} · ` : ""}
                    {r.status.replace("_", " ")}
                  </span>
                  <MiniProgress status={r.status} />
                </>
              );
              const rowClass = `block px-2.5 py-2 rounded-lg text-sm transition-colors ${
                activeRunId === r.run_id ? "bg-neutral-fill text-ink" : "text-ink-2 hover:bg-neutral-fill/40"
              }`;

              return isDecider && onSelectPendingRun ? (
                <button key={r.run_id} onClick={() => onSelectPendingRun(r.run_id)} className={`w-full text-left ${rowClass}`}>
                  {rowContent}
                </button>
              ) : (
                <a key={r.run_id} href="/history" className={rowClass}>
                  {rowContent}
                </a>
              );
            })}
            {visibleRuns.length === 0 && (
              <p className="px-2 text-xs text-text-tertiary">{emptyLabel}</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function RailButton({
  iconName,
  label,
  active,
  disabled,
  onClick,
  href,
}: {
  iconName: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const classes = `w-11 h-11 flex items-center justify-center rounded-[14px] transition-colors ${
    disabled
      ? "text-placeholder cursor-default"
      : active
        ? "bg-ink text-white"
        : "text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted"
  }`;

  const inner = <Icon name={iconName} size={22} filled />;

  if (href && !disabled) {
    return (
      <a href={href} title={label} aria-label={label} className={classes}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={disabled ? undefined : onClick} title={label} aria-label={label} disabled={disabled} className={classes}>
      {inner}
    </button>
  );
}
