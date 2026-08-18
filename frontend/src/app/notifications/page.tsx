"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Notification, NotificationType } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isTypeEnabled } from "@/lib/notificationPrefs";
import { summarize } from "@/lib/stats";
import { Sidebar } from "@/components/Sidebar";
import { Icon } from "@/components/Icon";

const TYPE_ICONS: Record<NotificationType, string> = {
  needs_approval: "assignment_turned_in",
  needs_review: "fact_check",
  approved: "check_circle",
  rejected: "undo",
};

// Color-coded per type instead of one flat gray icon for every row --
// scanning a list of 20 identical gray dots tells you nothing at a glance.
// Reuses the app's existing semantic colors (accent = positive/teal,
// warning = sent-back) rather than inventing a new palette; needs_review
// gets its own violet since it's neither of those.
const TYPE_COLORS: Record<NotificationType, string> = {
  needs_approval: "bg-accent-tint text-accent",
  needs_review: "bg-[#EDEAFB] text-[#5B4FC4]",
  approved: "bg-accent-tint text-accent",
  rejected: "bg-[#F6EAE2] text-warning-strong",
};

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  routed_to: "approver" | "reviewer" | null;
  created_at: string;
  draft: Record<string, any> | null;
};

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

// Layout informed by a Pinterest pass on real notification-center UIs: the
// recurring pattern worth borrowing wasn't the icon treatment (already
// had that) but putting items that need a decision right in the feed with
// inline action buttons, instead of making the reader open each one just
// to see an Approve/Deny choice they could make right here. That becomes
// this page's "Needs your decision" section -- also where Queue's old
// decider-facing content moved once Queue was replaced by Folders (a
// requester-only concept; deciders never had anything to file).
export default function Notifications() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingRuns, setPendingRuns] = useState<RunSummary[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const role = user?.role;
  const isReviewer = role === "reviewer";
  const isDecider = role === "approver" || role === "reviewer" || role === "admin";

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listNotifications().then(setNotifications).catch(() => {});
    if (isDecider) refetchPending();
  }, [user, isDecider]);

  function refetchPending() {
    api.listRuns().then((runs: RunSummary[]) => {
      const filtered = isReviewer
        ? runs.filter((r) => r.status === "awaiting_approval" && r.routed_to === "reviewer")
        : role === "admin"
        ? runs.filter((r) => r.status === "awaiting_approval")
        : runs.filter((r) => r.status === "awaiting_approval" && (r.routed_to ?? "approver") === "approver");
      setPendingRuns(filtered);
    }).catch(() => {});
  }

  if (authLoading || !user) {
    return <div className="min-h-screen bg-app" />;
  }

  const visibleNotifications = notifications.filter((n) => isTypeEnabled(user.id, n.type));
  const filtered = filter === "unread" ? visibleNotifications.filter((n) => !n.read) : visibleNotifications;
  const todayNotifications = filtered.filter((n) => isToday(n.created_at));
  const earlierNotifications = filtered.filter((n) => !isToday(n.created_at));
  const unreadCount = visibleNotifications.filter((n) => !n.read).length;

  async function openNotification(n: Notification) {
    if (!n.read) api.markNotificationRead(n.id).catch(() => {});
    router.push(`/?run=${n.run_id}`);
  }

  async function handleMarkAllRead() {
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    try {
      await api.markAllNotificationsRead();
    } catch {
      api.listNotifications().then(setNotifications).catch(() => {});
    }
  }

  async function handleDecide(runId: string, approved: boolean) {
    setDecidingId(runId);
    try {
      await api.respondToApproval(runId, approved);
      refetchPending();
    } catch {
      // real error surfaces via the run detail if the quick-decide fails
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />

      <div className="flex-1 flex flex-col h-screen min-w-0">
        <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
          <div>
            <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Notifications</span>
            <span className="ml-3 text-[13px] text-text-tertiary">Everything that's happened on your requests</span>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-[12px] font-medium text-accent hover:text-accent-dark transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-9 py-7">
          <div className="max-w-2xl mx-auto flex flex-col gap-6">
            {isDecider && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Needs your decision
                  </p>
                  {pendingRuns.length > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-ink text-white text-[10px] font-semibold leading-4 text-center">
                      {pendingRuns.length}
                    </span>
                  )}
                </div>
                {pendingRuns.length === 0 ? (
                  <p className="text-[13.5px] text-text-tertiary">Nothing waiting on you right now.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {pendingRuns.map((r) => {
                      const summary = summarize(r.draft);
                      const deciding = decidingId === r.run_id;
                      return (
                        <div
                          key={r.run_id}
                          className="flex items-center gap-2.5 rounded-xl bg-card shadow-card px-3.5 py-2.5"
                        >
                          <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${TYPE_COLORS[isReviewer ? "needs_review" : "needs_approval"]}`}>
                            <Icon name={isReviewer ? "fact_check" : "assignment_turned_in"} size={14} filled={false} />
                          </span>
                          <button
                            onClick={() => router.push(`/?run=${r.run_id}`)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block text-[13.5px] font-medium text-ink truncate">{summary ?? "New request"}</span>
                            <span className="block text-[12px] text-text-tertiary mt-0.5">{r.requester_name} · awaiting your decision</span>
                          </button>
                          <div className="shrink-0 flex items-center gap-1">
                            <button
                              onClick={() => handleDecide(r.run_id, false)}
                              disabled={deciding}
                              className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-warning-strong hover:bg-[#F6EAE2] disabled:opacity-40 transition-colors"
                            >
                              Send back
                            </button>
                            <button
                              onClick={() => handleDecide(r.run_id, true)}
                              disabled={deciding}
                              className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium bg-ink text-white hover:bg-[#332F28] disabled:opacity-40 transition-colors"
                            >
                              Approve
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Feed</p>
                <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-neutral-fill-2">
                  {(["all", "unread"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 rounded-full text-[11.5px] font-medium capitalize transition-colors ${
                        filter === f ? "bg-panel text-ink shadow-sm" : "text-text-tertiary hover:text-ink-muted"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {todayNotifications.length === 0 && earlierNotifications.length === 0 && (
                <p className="text-[13.5px] text-text-tertiary">
                  {filter === "unread" ? "No unread notifications." : "No notifications yet."}
                </p>
              )}
              {todayNotifications.length > 0 && (
                <div className="mb-5">
                  <p className="mb-1.5 text-[10.5px] font-medium text-text-quaternary">Today</p>
                  <div className="flex flex-col gap-0.5">
                    {todayNotifications.map((n) => (
                      <NotificationRow key={n.id} notification={n} onOpen={openNotification} />
                    ))}
                  </div>
                </div>
              )}
              {earlierNotifications.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10.5px] font-medium text-text-quaternary">Earlier</p>
                  <div className="flex flex-col gap-0.5">
                    {earlierNotifications.map((n) => (
                      <NotificationRow key={n.id} notification={n} onOpen={openNotification} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onOpen: (n: Notification) => void;
}

function NotificationRow(props: NotificationRowProps) {
  const { notification: n, onOpen } = props;
  return (
    <button
      onClick={() => onOpen(n)}
      className={`flex items-start gap-2.5 text-left px-3.5 py-2.5 rounded-xl transition-colors ${
        n.read ? "hover:bg-neutral-fill/30" : "bg-card shadow-card hover:bg-neutral-fill/30"
      }`}
    >
      {n.type ? (
        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${TYPE_COLORS[n.type]}`}>
          <Icon name={TYPE_ICONS[n.type]} size={13} filled={false} />
        </span>
      ) : (
        <span className="shrink-0 w-6 h-6" />
      )}
      <div className="min-w-0 flex-1">
        <span className="block text-[13.5px] text-ink-2">{n.message}</span>
        <span className="block text-[11.5px] text-text-tertiary mt-0.5 font-mono">
          {new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {!n.read && <span className="mt-2 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
    </button>
  );
}
