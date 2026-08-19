"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, Folder, Notification, ROLE_LABELS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isTypeEnabled } from "@/lib/notificationPrefs";
import { getPinnedIds, togglePin } from "@/lib/pins";
import { summarize } from "@/lib/stats";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { ConvoRowMenu } from "@/components/ConvoRowMenu";

type RunListItem = {
  run_id: string;
  status: string;
  user_id: string | null;
  draft: Record<string, any> | null;
  archived?: boolean;
  folder_id?: string | null;
};

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
  const router = useRouter();
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [recentRuns, setRecentRuns] = useState<RunListItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const isDecider = user?.role === "approver" || user?.role === "reviewer" || user?.role === "admin";
  const onChat = pathname === "/chat";

  function refetchRuns() {
    if (!user) return;
    api.listRuns().then((runs: RunListItem[]) => setRecentRuns(runs.filter((r) => r.user_id === user.id))).catch(() => {});
  }

  // Visible whenever the rail is expanded, not just on /chat -- once a
  // request hands off to "/" (an active conversation), the point of
  // keeping history one click away is exactly when it would otherwise
  // disappear. Fetches once per expand rather than on every route change.
  useEffect(() => {
    if (!user || isDecider || !expanded) return;
    refetchRuns();
    api.listFolders().then(setFolders).catch(() => {});
    setPinnedIds(getPinnedIds(user.id));
  }, [user, isDecider, expanded]);

  // Sidebar now persists across navigation (see app/(app)/layout.tsx)
  // instead of remounting on every route change -- that remount used to be
  // the only thing that ever refreshed this list, so starting a new
  // conversation and browsing away no longer put it in Recent until
  // something else happened to retrigger the effect above (a page reload,
  // or toggling the rail). Same fix as notifications: page.tsx dispatches
  // this the moment a run is created or advances, so Recent updates live
  // instead of going stale the instant the remount-driven refresh stopped
  // happening.
  useEffect(() => {
    if (!user || isDecider) return;
    window.addEventListener("runs:changed", refetchRuns);
    return () => window.removeEventListener("runs:changed", refetchRuns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isDecider]);

  const visibleRuns = recentRuns.filter((r) => !r.archived);
  const pinnedRuns = visibleRuns.filter((r) => pinnedIds.includes(r.run_id));
  const unpinnedRuns = visibleRuns.filter((r) => !pinnedIds.includes(r.run_id));

  async function handleCreateFolder(name: string): Promise<string> {
    const folder = await api.createFolder(name);
    setFolders((fs) => [...fs, folder]);
    return folder.id;
  }

  useEffect(() => {
    setExpanded(localStorage.getItem(EXPANDED_KEY) === "true");
  }, []);

  function toggleExpanded() {
    setExpanded((e) => {
      localStorage.setItem(EXPANDED_KEY, String(!e));
      return !e;
    });
  }

  useEffect(() => {
    if (!user) return;
    const refetch = () => api.listNotifications().then(setNotifications).catch(() => {});
    refetch();
    // Same-page mark-read/mark-all-read (see lib/api.ts) fires this so the
    // badge updates immediately instead of only on the next navigation,
    // when this component happens to remount and refetch fresh anyway.
    window.addEventListener("notifications:changed", refetch);
    return () => window.removeEventListener("notifications:changed", refetch);
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
      {/* Collapsed: the logo alone doubles as the expand toggle -- home
          navigation still exists via the Chat rail icon right below, so
          nothing is lost, and this avoids the two-row "logo, then a
          separate chevron stacked under it" layout that read as a stray
          icon floating below the brand mark. Expanded: logo + app name is
          the real home link (back to a clickable brand mark instead of a
          bare icon), chevron sits on the same line to collapse back --
          there's room here, unlike the 68px collapsed rail. */}
      {expanded ? (
        <div className="flex items-center justify-between mb-4 px-1">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <Logo size={28} />
            <span className="text-[13.5px] font-semibold text-ink truncate">AX Platform</span>
          </Link>
          <button
            onClick={toggleExpanded}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors"
          >
            <Icon name="chevron_left" size={16} filled={false} />
          </button>
        </div>
      ) : (
        <button
          onClick={toggleExpanded}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="flex justify-center mb-4"
        >
          <Logo size={32} />
        </button>
      )}

      <div className={`flex flex-col gap-1 ${expanded ? "" : "items-center gap-2"}`}>
        <RailButton iconName="forum" label="Chat" href="/chat" active={onChat} expanded={expanded} />
        <RailButton iconName="folder" label="Folders" href="/folders" active={pathname === "/folders"} expanded={expanded} />
        <RailButton iconName="notifications" label="Notifications" href="/notifications" active={pathname === "/notifications"} badge={unreadCount} expanded={expanded} />
      </div>

      {expanded && !isDecider && visibleRuns.length > 0 && (
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
          {pinnedRuns.length > 0 && (
            <>
              <p className="px-1 mb-1.5 text-[10.5px] font-medium text-text-quaternary uppercase tracking-wide">Pinned</p>
              <div className="flex flex-col gap-0.5 mb-3">
                {pinnedRuns.map((r) => (
                  <ConvoRow
                    key={r.run_id}
                    run={r}
                    pinned
                    folders={folders}
                    onOpen={() => router.push(`/?run=${r.run_id}`)}
                    onTogglePin={() => setPinnedIds(togglePin(user!.id, r.run_id))}
                    onArchive={() => api.setRunArchived(r.run_id, true).then(refetchRuns)}
                    onAssignFolder={(fid) => api.setRunFolder(r.run_id, fid).then(refetchRuns)}
                    onCreateFolder={handleCreateFolder}
                  />
                ))}
              </div>
            </>
          )}
          {unpinnedRuns.length > 0 && (
            <>
              <p className="px-1 mb-1.5 text-[10.5px] font-medium text-text-quaternary uppercase tracking-wide">Recent</p>
              <div className="flex flex-col gap-0.5">
                {unpinnedRuns.slice(0, 20).map((r) => (
                  <ConvoRow
                    key={r.run_id}
                    run={r}
                    pinned={false}
                    folders={folders}
                    onOpen={() => router.push(`/?run=${r.run_id}`)}
                    onTogglePin={() => setPinnedIds(togglePin(user!.id, r.run_id))}
                    onArchive={() => api.setRunArchived(r.run_id, true).then(refetchRuns)}
                    onAssignFolder={(fid) => api.setRunFolder(r.run_id, fid).then(refetchRuns)}
                    onCreateFolder={handleCreateFolder}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {user && (
        <div className={`mt-auto flex gap-2 ${expanded ? "flex-col" : "flex-col items-center"}`}>
          {/* No "Admin dashboard" link here anymore -- admin has its own
              console (app/admin/*) with its own nav and never renders this
              Sidebar at all (see (app)/layout.tsx's redirect), so this
              would have been unreachable dead chrome. */}
          <RailButton iconName="help" label="Help" href="/help" active={pathname === "/help"} expanded={expanded} />
          <RailButton iconName="settings" label="Settings" href="/settings" active={pathname === "/settings"} expanded={expanded} />
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
              title={`${user.name} · ${ROLE_LABELS[user.role]}`}
              className="w-8 h-8 shrink-0 rounded-[11px] bg-ink text-app flex items-center justify-center text-[11.5px] font-semibold"
            >
              {initials(user.name)}
            </div>
            {expanded && (
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink truncate">{user.name}</p>
                <p className="text-[10.5px] text-text-tertiary truncate">{ROLE_LABELS[user.role]}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

interface ConvoRowProps {
  run: RunListItem;
  pinned: boolean;
  folders: Folder[];
  onOpen: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onAssignFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string) => Promise<string>;
}

function ConvoRow(props: ConvoRowProps) {
  const { run, pinned, folders, onOpen, onTogglePin, onArchive, onAssignFolder, onCreateFolder } = props;
  return (
    <div className="group flex items-center gap-0.5 rounded-lg hover:bg-neutral-fill/50 transition-colors">
      <button
        onClick={onOpen}
        title={summarize(run.draft) ?? "New request"}
        className="flex-1 min-w-0 text-left px-2.5 py-1.5 text-[12.5px] text-ink-2 truncate"
      >
        {summarize(run.draft) ?? "New request"}
      </button>
      <ConvoRowMenu
        pinned={pinned}
        folders={folders}
        currentFolderId={run.folder_id ?? null}
        onTogglePin={onTogglePin}
        onArchive={onArchive}
        onAssignFolder={onAssignFolder}
        onCreateFolder={onCreateFolder}
      />
    </div>
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

  // Active state deliberately doesn't reuse the logo's solid-ink rounded
  // square -- in the collapsed rail that tile sits directly under the
  // actual Logo (same shape, nearly the same size), and the two together
  // read as two stacked app icons instead of "logo + active nav item."
  // The accent tint keeps the highlight legible while staying visually
  // distinct from the brand mark above it.
  const classes = `relative flex items-center rounded-[14px] transition-colors ${
    expanded ? "gap-3 h-11 px-3" : "w-11 h-11 justify-center"
  } ${
    disabled
      ? "text-placeholder cursor-default"
      : active
        ? "bg-accent-tint text-accent"
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
    // Link, not a plain <a> -- this is the actual fix for "moving tabs
    // isn't smooth": a bare href does a full browser navigation (reload
    // every script/style/font, discard the whole React tree including the
    // now-shared Sidebar, refetch everything from scratch). Link performs
    // the same client-side transition router.push does, which is what
    // makes the (app) layout's persistent Sidebar actually persist.
    return (
      <Link href={href} title={expanded ? undefined : label} aria-label={label} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={disabled ? undefined : onClick} title={expanded ? undefined : label} aria-label={label} disabled={disabled} className={classes}>
      {inner}
    </button>
  );
}
