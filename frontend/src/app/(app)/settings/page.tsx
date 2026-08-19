"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationType, ROLE_LABELS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getDisabledTypes, setTypeEnabled } from "@/lib/notificationPrefs";
import { NotificationBell } from "@/components/NotificationBell";

const TYPE_LABELS: Record<NotificationType, { label: string; description: string }> = {
  needs_approval: { label: "Needs your approval", description: "A request was routed to the approver queue." },
  needs_review: { label: "Needs your review", description: "A request was routed to the specialist review queue." },
  approved: { label: "Your request was approved", description: "A request you filed was approved." },
  rejected: { label: "Your request was sent back", description: "A request you filed was rejected." },
};

// Which types are even possible for this role -- an approver never gets
// a "your request was approved" notification about someone else's
// request, so there's nothing to toggle for a type that can't fire for
// them. Admin sees all four since /notifications gives them every row
// unfiltered.
function typesForRole(role: string | undefined): NotificationType[] {
  if (role === "admin") return ["needs_approval", "needs_review", "approved", "rejected"];
  if (role === "approver") return ["needs_approval"];
  if (role === "reviewer") return ["needs_review"];
  return ["approved", "rejected"];
}

// Scope per the PM/marketing consult: a single page, one section, toggles
// keyed to the real notification.type enum -- nothing speculative (no
// quiet hours, digest frequency, per-run muting; none of that has been
// asked for). Role settings deliberately don't live here -- role is a
// security boundary and stays admin-only on /admin, full stop.
export default function Settings() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [disabled, setDisabled] = useState<NotificationType[]>([]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) setDisabled(getDisabledTypes(user.id));
  }, [user]);

  if (authLoading || !user) {
    return <div className="flex-1 bg-app" />;
  }

  function toggle(type: NotificationType) {
    const enabled = disabled.includes(type);
    setDisabled(setTypeEnabled(user!.id, type, enabled));
  }

  const types = typesForRole(user.role);

  return (
    <div className="flex-1 flex flex-col h-screen min-w-0 bg-app">
      <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
        <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Settings</span>
        <NotificationBell />
      </div>

      <div className="flex-1 overflow-y-auto bg-surface px-9 py-8">
        <div className="max-w-xl mx-auto">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Notifications</p>
          <p className="mb-2 text-[13px] text-text-tertiary">
            Choose what shows up in your inbox and unread badge. Every request still gets processed the same
            way regardless of what's toggled here -- this only controls what you're notified about.
          </p>
          <p className="mb-5 text-[13px] text-text-tertiary">
            You're only shown the kinds of notifications your role can actually receive -- as{" "}
            <span>{ROLE_LABELS[user.role]}</span>, that's{" "}
            {typesForRole(user.role).map((t) => TYPE_LABELS[t].label.toLowerCase()).join(" and ")}. The rest
            can't happen for you (an approver never gets "your request was approved" about someone else's
            request), so there's nothing to toggle for them.
          </p>

          <div className="rounded-2xl bg-card shadow-card divide-y divide-hairline-soft">
            {types.map((type) => {
              const enabled = !disabled.includes(type);
              return (
                <div key={type} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{TYPE_LABELS[type].label}</p>
                    <p className="text-[12.5px] text-text-tertiary mt-0.5">{TYPE_LABELS[type].description}</p>
                  </div>
                  <button
                    onClick={() => toggle(type)}
                    role="switch"
                    aria-checked={enabled}
                    className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${enabled ? "bg-accent" : "bg-neutral-fill-2"}`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-[left] ${enabled ? "left-5" : "left-1"}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
