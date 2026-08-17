"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  user_id: string | null;
  routed_to: "approver" | "reviewer" | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Rail-only now -- the persistent 256px "Recent"/"Pending" list that used
// to live here isn't in design_handoff_approval_flow/README.md's rail spec
// at all (it only defines logo + forum/inbox/history nav + avatar). It was
// this app's own addition for multi-request navigation, and stayed visible
// on every screen regardless of role. Moved to /inbox as its own
// destination instead -- the same real queue/notification data, reached
// through the inbox icon rather than parked in view permanently.
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const role = user?.role;
  const isApprover = role === "approver" || role === "admin";
  const isReviewer = role === "reviewer";

  useEffect(() => {
    if (!user) return;
    api.listRuns().then(setRuns).catch(() => {});
    api.listNotifications().then(setNotifications).catch(() => {});
  }, [user]);

  // Same real unread-count logic the old sidebar list used, now surfaced as
  // a badge on the inbox icon instead of an always-open panel. Notifications
  // carry no user_id column yet, so "relevant to this user" is decided by
  // message shape + name-matching against the real run list, same technique
  // as before.
  const runById = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const unreadCount = notifications.filter((n) => {
    if (n.read) return false;
    if (isReviewer) return n.message.startsWith("Awaiting review:");
    if (isApprover) return n.message.startsWith("Awaiting approval:") || (role === "admin" && n.message.startsWith("Awaiting review:"));
    const run = runById[n.run_id];
    if (!run) return false;
    const owned = run.user_id ? run.user_id === user?.id : run.requester_name === user?.name;
    return n.message.startsWith("Your request") && owned;
  }).length;

  return (
    // Icon rail -- 68px, per design_handoff_approval_flow/README.md's
    // "Icon rail" spec exactly (widths, radii, colors): logo, forum, inbox,
    // history, avatar -- nothing added beyond it. Sign-out repurposes the
    // spec's "restart control" slot next to the avatar rather than
    // inventing new chrome for it.
    <nav className="w-[68px] shrink-0 h-screen sticky top-0 flex flex-col items-center gap-2 py-[18px] border-r border-hairline bg-rail">
      <a href="/" className="mb-4">
        <Logo size={32} />
      </a>

      <RailButton iconName="forum" label="Requests" href="/" active={pathname === "/"} />
      <RailButton iconName="inbox" label="Inbox" href="/inbox" active={pathname === "/inbox"} badge={unreadCount} />
      <RailButton iconName="history" label="Audit trail" href="/history" active={pathname === "/history"} />

      {user && (
        <div className="mt-auto flex flex-col items-center gap-2">
          {role === "admin" && (
            <RailButton iconName="admin_panel_settings" label="Admin dashboard" href="/admin" active={pathname === "/admin"} />
          )}
          <button onClick={logout} title="Sign out" aria-label="Sign out" className="w-9 h-9 flex items-center justify-center rounded-[12px] text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors">
            <Icon name="logout" size={19} filled={false} />
          </button>
          <div
            title={`${user.name} · ${user.role}`}
            className="w-8 h-8 rounded-[11px] bg-ink text-app flex items-center justify-center text-[11.5px] font-semibold"
          >
            {initials(user.name)}
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
}

function RailButton(props: RailButtonProps) {
  const { iconName, label, active, disabled, onClick, href, badge } = props;

  const classes = `relative w-11 h-11 flex items-center justify-center rounded-[14px] transition-colors ${
    disabled
      ? "text-placeholder cursor-default"
      : active
        ? "bg-ink text-white"
        : "text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted"
  }`;

  const inner = (
    <>
      <Icon name={iconName} size={22} filled />
      {!!badge && (
        <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-warning-strong text-white text-[10px] font-semibold leading-4 text-center">
          {badge}
        </span>
      )}
    </>
  );

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
