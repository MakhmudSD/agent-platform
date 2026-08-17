"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Folder } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { summarize } from "@/lib/stats";
import { Sidebar } from "@/components/Sidebar";
import { MiniProgress } from "@/components/MiniProgress";
import { Icon } from "@/components/Icon";
import { NotificationBell } from "@/components/NotificationBell";
import { ConvoRowMenu } from "@/components/ConvoRowMenu";
import { getPinnedIds, togglePin } from "@/lib/pins";

type RunSummary = {
  run_id: string;
  status: string;
  requester_name: string;
  user_id: string | null;
  routed_to: "approver" | "reviewer" | null;
  created_at: string;
  draft: Record<string, any> | null;
  archived?: boolean;
  folder_id?: string | null;
};

// Replaces the old Queue tab -- Queue's decider-facing "pending on you"
// content moved into /notifications' Pending section (folders are a
// requester-only organizing concept, deciders never had anything to file),
// and its pinned-shortcuts role is now covered directly in the Sidebar's
// own Pinned section. What's left, and what this page actually owns: real
// folders, a first-class way to group your own conversations instead of
// one flat history list.
export default function Folders() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // null = "All"
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
    if (!authLoading && user && user.role !== "requester" && user.role !== "admin") router.push("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listFolders().then(setFolders).catch(() => {});
    api.listRuns().then((rs: RunSummary[]) => setRuns(rs.filter((r) => r.user_id === user.id))).catch(() => {});
    setPinnedIds(getPinnedIds(user.id));
  }, [user]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-app" />;
  }

  const ownRuns = runs.filter((r) => !r.archived);
  const visibleRuns = selected === null ? ownRuns : ownRuns.filter((r) => r.folder_id === selected);
  const unfiledCount = ownRuns.filter((r) => !r.folder_id).length;

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = await api.createFolder(name);
    setFolders((fs) => [...fs, folder]);
    setNewFolderName("");
  }

  async function handleDeleteFolder(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this folder? Conversations inside it are kept, just un-filed.")) return;
    await api.deleteFolder(id);
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setRuns((rs) => rs.map((r) => (r.folder_id === id ? { ...r, folder_id: null } : r)));
    if (selected === id) setSelected(null);
  }

  function refetchRuns() {
    if (!user) return;
    api.listRuns().then((rs: RunSummary[]) => setRuns(rs.filter((r) => r.user_id === user.id))).catch(() => {});
  }

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />

      <div className="flex-1 flex flex-col h-screen min-w-0">
        <div className="h-14 shrink-0 flex items-center justify-between px-[34px] border-b border-hairline">
          <div>
            <span className="text-[15px] font-semibold text-ink tracking-[-.01em]">Folders</span>
            <span className="ml-3 text-[13px] text-text-tertiary">Organize your conversations</span>
          </div>
          <NotificationBell />
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-9 py-8">
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            {/* Folder chips row */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelected(null)}
                className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors ${
                  selected === null ? "bg-ink text-white" : "bg-card text-ink-2 hover:bg-neutral-fill/50 shadow-card"
                }`}
              >
                All ({ownRuns.length})
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f.id)}
                  className={`group flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors ${
                    selected === f.id ? "bg-ink text-white" : "bg-card text-ink-2 hover:bg-neutral-fill/50 shadow-card"
                  }`}
                >
                  <Icon name="folder" size={14} filled={selected === f.id} />
                  {f.name}
                  <span className={selected === f.id ? "text-white/70" : "text-text-tertiary"}>({f.run_count})</span>
                  <span
                    onClick={(e) => handleDeleteFolder(f.id, e)}
                    title="Delete folder"
                    className={`ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                      selected === f.id ? "hover:bg-white/20" : "hover:bg-neutral-fill"
                    }`}
                  >
                    <Icon name="close" size={12} filled={false} />
                  </span>
                </button>
              ))}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card shadow-card">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                  placeholder="New folder..."
                  className="w-28 bg-transparent text-[12.5px] outline-none text-ink placeholder:text-placeholder"
                />
                <button onClick={handleCreateFolder} aria-label="Create folder" className="text-text-tertiary hover:text-accent transition-colors">
                  <Icon name="add" size={16} filled={false} />
                </button>
              </div>
            </div>

            {selected === null && unfiledCount > 0 && (
              <p className="text-[12px] text-text-tertiary -mt-3">{unfiledCount} conversation{unfiledCount === 1 ? "" : "s"} not yet filed into a folder.</p>
            )}

            {/* Conversation list */}
            <div className="flex flex-col gap-1">
              {visibleRuns.map((r) => {
                const summary = summarize(r.draft);
                const pinned = pinnedIds.includes(r.run_id);
                return (
                  <div
                    key={r.run_id}
                    onClick={() => router.push(`/?run=${r.run_id}`)}
                    className="flex items-center gap-3 text-left px-4 py-3 rounded-xl bg-card shadow-card hover:bg-neutral-fill/30 transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink">{summary ?? "New request"}</span>
                      <span className="block text-xs text-text-tertiary mt-0.5">{r.status.replace("_", " ")}</span>
                      <MiniProgress status={r.status} />
                    </div>
                    <ConvoRowMenu
                      pinned={pinned}
                      folders={folders}
                      currentFolderId={r.folder_id ?? null}
                      onTogglePin={() => setPinnedIds(togglePin(user.id, r.run_id))}
                      onArchive={() => api.setRunArchived(r.run_id, true).then(refetchRuns)}
                      onAssignFolder={(fid) => api.setRunFolder(r.run_id, fid).then(refetchRuns).then(() => api.listFolders().then(setFolders))}
                      onCreateFolder={async (name) => {
                        const folder = await api.createFolder(name);
                        setFolders((fs) => [...fs, folder]);
                        return folder.id;
                      }}
                    />
                  </div>
                );
              })}
              {visibleRuns.length === 0 && (
                <p className="text-sm text-text-tertiary py-6 text-center">
                  {selected === null ? "No conversations yet." : "Nothing filed here yet."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
