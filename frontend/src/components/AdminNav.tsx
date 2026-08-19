"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";

// Deliberately its own component, not a mode of the requester/decider
// Sidebar -- an admin here never files or decides a request, so nothing in
// that nav (Chat/Folders/Notifications/Settings) applies. Standard
// dashboard shape instead: fixed-width sidebar, section nav top, account
// controls pinned to the bottom -- the same structure Linear/Stripe/Vercel
// admin consoles converge on, not a stylistic choice unique to this app.
const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: "space_dashboard" },
  { href: "/admin/users", label: "Users", icon: "group" },
  { href: "/admin/requests", label: "Requests", icon: "receipt_long" },
  { href: "/admin/feedback", label: "Feedback", icon: "thumb_up" },
];

export function AdminNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <nav className="w-64 shrink-0 h-screen sticky top-0 flex flex-col py-6 px-4 border-r border-hairline bg-rail">
      <Link href="/admin" className="flex items-center gap-2.5 px-2 mb-1">
        <Logo size={26} />
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink leading-tight truncate">AX Platform</p>
          <p className="text-[10.5px] text-text-tertiary leading-tight">Admin console</p>
        </div>
      </Link>

      <div className="h-px bg-hairline my-4" />

      <div className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 h-10 px-3 rounded-[10px] text-[13.5px] font-medium transition-colors ${
                active ? "bg-accent-tint text-accent-dark" : "text-ink-2 hover:bg-neutral-fill/50"
              }`}
            >
              <Icon name={item.icon} size={19} filled={active} />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <div className="h-px bg-hairline" />
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-8 h-8 shrink-0 rounded-[11px] bg-ink text-app flex items-center justify-center text-[11.5px] font-semibold">
            {(user?.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-ink truncate">{user?.name}</p>
            <p className="text-[10.5px] text-text-tertiary truncate">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-neutral-fill/50 hover:text-ink-muted transition-colors"
          >
            <Icon name="logout" size={17} filled={false} />
          </button>
        </div>
      </div>
    </nav>
  );
}
