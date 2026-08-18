"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { NotificationBell } from "@/components/NotificationBell";
import { Icon } from "@/components/Icon";

// Deliberately minimal, unlike Home ("/"): Home is the full landing (intro,
// inline history, agent cards) and stays that way. Chat is the fast path --
// history lives in the sidebar (see Sidebar.tsx's Recent section) instead
// of the main column, so starting something new is one field, not a page
// of content to scroll past.
//
// Submitting hands off to "/" via ?draft=<text> instead of starting the run
// here directly -- "/" already owns the real run-starting flow over the
// live WS (streaming node-by-node progress); calling POST /runs from here
// would block the composer on the full multi-node LLM chain with zero
// feedback until it finished. One real implementation, not two.
export default function Chat() {
  const router = useRouter();
  const { user } = useAuth();
  const [value, setValue] = useState("");

  // Only requesters (and admin, same bypass as everywhere else) can start a
  // run at all -- routes/runs.py's create_run enforces this server-side;
  // sending a decider here just to hit a 403 isn't useful, so they land on
  // "/" instead, same place their rail Chat click used to go.
  useEffect(() => {
    if (user && user.role !== "requester" && user.role !== "admin") router.push("/");
  }, [user, router]);

  function handleSend() {
    if (!value.trim()) return;
    router.push(`/?draft=${encodeURIComponent(value.trim())}`);
  }

  return (
    <div className="flex-1 flex flex-col h-screen min-w-0 bg-app">
      <div className="h-14 shrink-0 flex items-center justify-end px-[34px] border-b border-hairline">
        <NotificationBell />
      </div>

      <div className="flex-1 flex items-center justify-center px-[34px]">
        <div className="w-full max-w-lg text-center">
          <p className="text-text-secondary text-sm mb-4">
            {user ? `Ready when you are, ${user.name.split(" ")[0]}.` : "What do you need approved?"}
          </p>
          <div className="flex items-center gap-3 border border-control rounded-2xl px-[19px] py-2.5 bg-panel focus-within:border-ink-muted transition-colors">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              autoFocus
              placeholder="Type your request..."
              className="flex-1 min-w-0 bg-transparent text-[15px] outline-none disabled:text-placeholder text-ink"
            />
            <button
              onClick={handleSend}
              aria-label="Send"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-ink text-white disabled:opacity-30 hover:bg-[#332F28] transition-colors"
            >
              <Icon name="arrow_upward" size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
