"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { summarize } from "@/lib/stats";
import { Sidebar } from "@/components/Sidebar";
import { MiniProgress } from "@/components/MiniProgress";
import { Icon } from "@/components/Icon";

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  user_id: string | null;
  routed_to: "approver" | "reviewer" | null;
  created_at: string;
  draft: Record<string, any> | null;
};

// The destination the old always-visible sidebar list moved to (see
// Sidebar.tsx). Deciders land here to pick which pending request to act
// on -- the real queue, same filtering logic that used to live in the
// sidebar. Requesters land here to see real notifications about their own
// requests' status changes. Neither list is fabricated: both come straight
// from GET /runs and GET /notifications.
export default function Inbox() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const role = user?.role;
  const isApprover = role === "approver" || role === "admin";
  const isReviewer = role === "reviewer";
  const isDecider = isApprover || isReviewer;

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
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

  const runById = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const relevantNotifications = notifications.filter((n) => {
    if (isReviewer) return n.message.startsWith("Awaiting review:");
    if (isApprover) return n.message.startsWith("Awaiting approval:") || (role === "admin" && n.message.startsWith("Awaiting review:"));
    const run = runById[n.run_id];
    if (!run) return n.message.startsWith("Your request");
    const owned = run.user_id ? run.user_id === user?.id : run.requester_name === user?.name;
    return n.message.startsWith("Your request") && owned;
  });

  async function openNotification(n: Notification) {
    if (!n.read) api.markNotificationRead(n.id).catch(() => {});
    if (isDecider) router.push(`/?run=${n.run_id}`);
    else router.push(`/history?run=${n.run_id}`);
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
            {isDecider && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {isReviewer ? "Pending review" : "Pending approval"}
                </p>
                <div className="flex flex-col gap-1">
                  {pendingRuns.map((r) => {
                    const summary = summarize(r.draft);
                    return (
                      <button
                        key={r.run_id}
                        onClick={() => router.push(`/?run=${r.run_id}`)}
                        className="text-left px-4 py-3 rounded-xl bg-card shadow-card hover:bg-neutral-fill/30 transition-colors"
                      >
                        <span className="block text-sm font-medium text-ink">{summary ?? "New request"}</span>
                        <span className="block text-xs text-text-tertiary mt-0.5">{r.requester_name} · awaiting decision</span>
                        <MiniProgress status={r.status} />
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
                {relevantNotifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={`flex items-start gap-3 text-left px-4 py-3 rounded-xl transition-colors ${
                      n.read ? "hover:bg-neutral-fill/30" : "bg-card shadow-card hover:bg-neutral-fill/30"
                    }`}
                  >
                    {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    <div className={n.read ? "pl-[18px]" : ""}>
                      <span className="block text-sm text-ink-2">{n.message}</span>
                      <span className="block text-xs text-text-tertiary mt-0.5 font-mono">
                        {new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </button>
                ))}
                {relevantNotifications.length === 0 && (
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
