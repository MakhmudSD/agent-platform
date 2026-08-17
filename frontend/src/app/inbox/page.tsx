"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Notification, NotificationType } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { summarize } from "@/lib/stats";
import { getPinnedIds, isPinned, togglePin } from "@/lib/pins";
import { isTypeEnabled } from "@/lib/notificationPrefs";
import { Sidebar } from "@/components/Sidebar";
import { MiniProgress } from "@/components/MiniProgress";
import { Icon } from "@/components/Icon";

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  routed_to: "approver" | "reviewer" | null;
  created_at: string;
  draft: Record<string, any> | null;
};

const TYPE_ICONS: Record<NotificationType, string> = {
  needs_approval: "assignment_turned_in",
  needs_review: "fact_check",
  approved: "check_circle",
  rejected: "undo",
};

// The destination the old always-visible sidebar list moved to (see
// Sidebar.tsx). Deciders land here to pick which pending request to act
// on -- the real queue, same filtering logic that used to live in the
// sidebar. Requesters land here to see real notifications about their own
// requests' status changes. GET /notifications is now server-filtered by
// real user_id/target_role (routes/notifications.py) -- no more client-
// side message-prefix guessing.
export default function Inbox() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const role = user?.role;
  const isReviewer = role === "reviewer";
  const isDecider = role === "approver" || role === "reviewer" || role === "admin";

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
    setPinnedIds(getPinnedIds(user.id));
  }, [user]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-app" />;
  }

  // Same real-queue filtering the sidebar used to do: null/legacy routed_to
  // defaults to "approver" (matches the backend's can_decide() default),
  // admin sees both queues merged.
  const pendingRuns = isReviewer
    ? runs.filter((r) => r.status === "awaiting_approval" && r.routed_to === "reviewer")
    : role === "admin"
    ? runs.filter((r) => r.status === "awaiting_approval")
    : runs.filter((r) => r.status === "awaiting_approval" && (r.routed_to ?? "approver") === "approver");

  const pinnedRuns = runs.filter((r) => pinnedIds.includes(r.run_id));
  const visibleNotifications = notifications.filter((n) => isTypeEnabled(user.id, n.type));

  function handleTogglePin(runId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPinnedIds(togglePin(user!.id, runId));
  }

  async function openNotification(n: Notification) {
    if (!n.read) api.markNotificationRead(n.id).catch(() => {});
    if (n.type === "needs_approval" || n.type === "needs_review") router.push(`/?run=${n.run_id}`);
    else router.push(`/history?run=${n.run_id}`);
  }

  function openRun(runId: string) {
    if (isDecider) router.push(`/?run=${runId}`);
    else router.push(`/history?run=${runId}`);
  }

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />

      <div className="flex-1 flex flex-col h-screen min-w-0">
        <div className="h-14 shrink-0 flex items-center px-[34px] border-b border-hairline">
          <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Inbox</span>
          <span className="ml-3 text-[13px] text-text-tertiary">
            {isDecider ? "Requests waiting on your decision" : "Updates on your requests"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-9 py-8">
          <div className="max-w-2xl mx-auto flex flex-col gap-8">
            {pinnedRuns.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Pinned</p>
                <div className="flex flex-col gap-1">
                  {pinnedRuns.slice(0, 5).map((r) => {
                    const summary = summarize(r.draft);
                    return (
                      <button
                        key={r.run_id}
                        onClick={() => openRun(r.run_id)}
                        className="flex items-center gap-3 text-left px-4 py-3 rounded-xl bg-card shadow-card hover:bg-neutral-fill/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-ink">{summary ?? "New request"}</span>
                          <span className="block text-xs text-text-tertiary mt-0.5">{r.requester_name} · {r.status.replace("_", " ")}</span>
                          <MiniProgress status={r.status} />
                        </div>
                        <span
                          onClick={(e) => handleTogglePin(r.run_id, e)}
                          title="Unpin"
                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-accent hover:bg-accent-tint transition-colors"
                        >
                          <Icon name="push_pin" size={16} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isDecider && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {isReviewer ? "Pending review" : "Pending approval"}
                </p>
                <div className="flex flex-col gap-1">
                  {pendingRuns.map((r) => {
                    const summary = summarize(r.draft);
                    const pinned = isPinned(user.id, r.run_id);
                    return (
                      <button
                        key={r.run_id}
                        onClick={() => router.push(`/?run=${r.run_id}`)}
                        className="flex items-center gap-3 text-left px-4 py-3 rounded-xl bg-card shadow-card hover:bg-neutral-fill/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-ink">{summary ?? "New request"}</span>
                          <span className="block text-xs text-text-tertiary mt-0.5">{r.requester_name} · awaiting decision</span>
                          <MiniProgress status={r.status} />
                        </div>
                        <span
                          onClick={(e) => handleTogglePin(r.run_id, e)}
                          title={pinned ? "Unpin" : "Pin"}
                          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                            pinned ? "text-accent hover:bg-accent-tint" : "text-text-tertiary hover:bg-neutral-fill/50"
                          }`}
                        >
                          <Icon name="push_pin" size={16} filled={pinned} />
                        </span>
                      </button>
                    );
                  })}
                  {pendingRuns.length === 0 && (
                    <p className="text-sm text-text-tertiary">Nothing waiting on you right now.</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Notifications</p>
              <div className="flex flex-col gap-1">
                {visibleNotifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={`flex items-start gap-3 text-left px-4 py-3 rounded-xl transition-colors ${
                      n.read ? "hover:bg-neutral-fill/30" : "bg-card shadow-card hover:bg-neutral-fill/30"
                    }`}
                  >
                    {n.type && <Icon name={TYPE_ICONS[n.type]} size={17} filled={false} className="mt-0.5 text-text-tertiary shrink-0" />}
                    {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    <div>
                      <span className="block text-sm text-ink-2">{n.message}</span>
                      <span className="block text-xs text-text-tertiary mt-0.5 font-mono">
                        {new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </button>
                ))}
                {visibleNotifications.length === 0 && (
                  <p className="text-sm text-text-tertiary">No notifications yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
