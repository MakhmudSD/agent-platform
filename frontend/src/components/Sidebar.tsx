"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isTypeEnabled } from "@/lib/notificationPrefs";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const EXPANDED_KEY = "sidebar_expanded";

// Rail-only -- the persistent 256px "Recent"/"Pending" list that used to
// live here isn't in design_handoff_approval_flow/README.md's rail spec at
// all (it only defines logo + forum/inbox/history nav + avatar). It was
// this app's own addition for multi-request navigation, and stayed visible
// on every screen regardless of role. Moved to /inbox as its own
// destination instead -- the same real queue/notification data, reached
// through the inbox icon rather than parked in view permanently.
//
// Collapsed (68px, icon-only) is the spec's own width; expanded is this
// app's own addition on top of it, showing labels next to each icon.
// Persisted in localStorage -- purely a display preference, not real
// server data, so it doesn't belong in the backend.
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(localStorage.getItem(EXPANDED_KEY) === "true");
  }, []);

  function toggleExpanded() {
    setExpanded((e) => {
      localStorage.setItem(EXPANDED_KEY, String(!e));
      return !e;
    });
  }

  const role = user?.role;

  useEffect(() => {
    if (!user) return;
    api.listNotifications().then(setNotifications).catch(() => {});
  }, [user]);

  // GET /notifications now filters server-side by real user_id/target_role
  // (routes/notifications.py) -- every row it returns is already this
  // user's. The type-enabled check is the one remaining client-side
  // filter, and it's a real display preference (Settings page), not
  // another round of guessing who a notification is for.
  const unreadCount = notifications.filter((n) => !n.read && (!user || isTypeEnabled(user.id, n.type))).length;

  return (
    <nav
      className={`shrink-0 h-screen sticky top-0 flex flex-col py-[18px] border-r border-hairline bg-rail transition-[width] duration-200 ${
        expanded ? "w-[204px] items-stretch px-3" : "w-[68px] items-center"
      }`}
    >
      <div className={`flex items-center mb-4 ${expanded ? "justify-between px-1" : "flex-col gap-2"}`}>
        <a href="/">
          <Logo size={32} />
        </a>
        <button
          onClick={toggleExpanded}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors"
        >
          <Icon name={expanded ? "chevron_left" : "chevron_right"} size={16} filled={false} />
        </button>
      </div>

      <div className={`flex flex-col gap-1 ${expanded ? "" : "items-center gap-2"}`}>
        <RailButton iconName="forum" label="Requests" href="/" active={pathname === "/"} expanded={expanded} />
        <RailButton iconName="inbox" label="Inbox" href="/inbox" active={pathname === "/inbox"} badge={unreadCount} expanded={expanded} />
        <RailButton iconName="history" label="Audit trail" href="/history" active={pathname === "/history"} expanded={expanded} />
      </div>

      {user && (
        <div className={`mt-auto flex gap-2 ${expanded ? "flex-col" : "flex-col items-center"}`}>
          <RailButton iconName="settings" label="Settings" href="/settings" active={pathname === "/settings"} expanded={expanded} />
          {role === "admin" && (
            <RailButton iconName="admin_panel_settings" label="Admin dashboard" href="/admin" active={pathname === "/admin"} expanded={expanded} />
          )}
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className={`flex items-center rounded-[12px] text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors ${
              expanded ? "gap-2.5 h-9 px-2.5 text-[13px]" : "w-9 h-9 justify-center"
            }`}
          >
            <Icon name="logout" size={19} filled={false} />
            {expanded && "Sign out"}
          </button>
          <div className={`flex items-center gap-2.5 ${expanded ? "px-1" : ""}`}>
            <div
              title={`${user.name} · ${user.role}`}
              className="w-8 h-8 shrink-0 rounded-[11px] bg-ink text-app flex items-center justify-center text-[11.5px] font-semibold"
            >
              {initials(user.name)}
            </div>
            {expanded && (
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink truncate">{user.name}</p>
                <p className="text-[10.5px] text-text-tertiary capitalize truncate">{user.role}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

interface RailButtonProps {
  iconName: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  badge?: number;
  expanded?: boolean;
}

function RailButton(props: RailButtonProps) {
  const { iconName, label, active, disabled, onClick, href, badge, expanded } = props;

  const classes = `relative flex items-center rounded-[14px] transition-colors ${
    expanded ? "gap-3 h-11 px-3" : "w-11 h-11 justify-center"
  } ${
    disabled
      ? "text-placeholder cursor-default"
      : active
        ? "bg-ink text-white"
        : "text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted"
  }`;

  const inner = (
    <>
      <span className="relative shrink-0">
        <Icon name={iconName} size={22} filled />
        {!!badge && !expanded && (
          <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-warning-strong text-white text-[10px] font-semibold leading-4 text-center">
            {badge}
          </span>
        )}
      </span>
      {expanded && (
        <>
          <span className="text-[13.5px] font-medium truncate">{label}</span>
          {!!badge && (
            <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-warning-strong text-white text-[10.5px] font-semibold leading-[18px] text-center">
              {badge}
            </span>
          )}
        </>
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} title={expanded ? undefined : label} aria-label={label} className={classes}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={disabled ? undefined : onClick} title={expanded ? undefined : label} aria-label={label} disabled={disabled} className={classes}>
      {inner}
    </button>
  );
}
