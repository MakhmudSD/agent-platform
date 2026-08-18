import { Sidebar } from "@/components/Sidebar";

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
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {children}
    </div>
  );
}
