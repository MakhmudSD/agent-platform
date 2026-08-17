"use client";

import { useEffect, useState } from "react";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isTypeEnabled } from "@/lib/notificationPrefs";
import { Icon } from "@/components/Icon";

// Same unread-count logic as Sidebar.tsx's rail badge, surfaced in every
// page header too -- the user asked for the bell "in the top header," not
// instead of the rail entry ("we can have that on the tab too, doesn't
// matter"). Clicking always goes to /notifications, its own destination
// split out of what used to be a combined Inbox feed; no dropdown to keep
// in sync separately.
export function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;
    const refetch = () => api.listNotifications().then(setNotifications).catch(() => {});
    refetch();
    window.addEventListener("notifications:changed", refetch);
    return () => window.removeEventListener("notifications:changed", refetch);
  }, [user]);

  if (!user) return null;

  const unreadCount = notifications.filter((n) => !n.read && isTypeEnabled(user.id, n.type)).length;

  return (
    <a
      href="/notifications"
      title="Notifications"
      aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
      className="relative shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors"
    >
      <Icon name="notifications" size={19} filled={false} />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-warning-strong text-white text-[9.5px] font-semibold leading-[15px] text-center">
          {unreadCount}
        </span>
      )}
    </a>
  );
}
