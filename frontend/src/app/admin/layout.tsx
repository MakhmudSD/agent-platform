"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { useAuth } from "@/lib/auth";

// The admin console's own shell, structurally separate from app/(app)/
// layout.tsx -- no shared Sidebar, no requester/decider chrome. Anyone who
// isn't an admin gets bounced to "/" (which itself redirects admins the
// other way -- see (app)/layout.tsx), so the two role experiences never
// bleed into each other regardless of which URL someone lands on first.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== "admin") router.replace("/");
  }, [loading, user, router]);

  if (loading || !user || user.role !== "admin") {
    return <div className="min-h-screen bg-app" />;
  }

  return (
    <div className="flex min-h-screen bg-app">
      <AdminNav />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
