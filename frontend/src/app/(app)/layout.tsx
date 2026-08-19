"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/lib/auth";

// Every route in this group shares one persistent Sidebar instance instead
// of each page mounting its own -- before this, navigating between Chat/
// Folders/Notifications/Settings/Home fully unmounted and remounted the
// sidebar on every click (it's a client component rendered fresh by each
// page.tsx), which meant a visible flash back to empty state and a fresh
// refetch of notifications/folders/pinned/recent-runs every single time.
// A layout.tsx in the App Router persists across navigations within its
// route group, so Sidebar now mounts once per session and just re-renders
// -- no more tear-down/rebuild, no more flash, no more redundant fetches.
// /login stays outside this group deliberately: there's no sidebar to show
// before a session exists.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Admin gets a fully separate console (app/admin/*, its own layout and
  // nav, no Sidebar) instead of being just another role inside this one --
  // it doesn't file requests or decide them, so Chat/Folders/Notifications/
  // Settings/the decider screen on "/" were all dead ends for it anyway.
  // One redirect here covers every route in this group instead of
  // repeating the same role check in each page.
  useEffect(() => {
    if (!loading && user?.role === "admin") router.replace("/admin");
  }, [loading, user, router]);

  if (user?.role === "admin") return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {children}
    </div>
  );
}
