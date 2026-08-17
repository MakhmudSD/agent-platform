"use client";

import { useEffect, useRef, useState } from "react";
import { Folder } from "@/lib/api";
import { Icon } from "@/components/Icon";

interface ConvoRowMenuProps {
  pinned: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  onTogglePin: () => void;
  onArchive: () => void;
  onAssignFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string) => Promise<string>;
}

// Vertical "..." menu on each conversation row -- pin, archive (hide from
// this user's own lists, never a real delete; see routes/runs.py's
// set_run_archived), and file into a folder. One shared component so
// Sidebar's Recent list and Home's conversation history behave identically
// instead of drifting into two implementations of the same three actions.
export function ConvoRowMenu(props: ConvoRowMenuProps) {
  const { pinned, folders, currentFolderId, onTogglePin, onArchive, onAssignFolder, onCreateFolder } = props;
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fixed positioning computed from the trigger's real on-screen rect,
  // not CSS-relative to the row -- the Sidebar's Recent/Pinned list sits
  // inside an overflow-y-auto ancestor (204px wide), which clips
  // horizontal overflow too (an axis set to auto forces the other to
  // auto per the CSS overflow spec). A menu positioned relative to a row
  // near that edge got silently cut off; escaping to the viewport via
  // fixed positioning is the only anchor that isn't at the mercy of
  // whatever scrollable container happens to be a parent.
  const MENU_WIDTH = 208;
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setMenuPos({ top: rect.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const id = await onCreateFolder(name);
    onAssignFolder(id);
    setNewFolderName("");
    setOpen(false);
    setSubmenu(false);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setSubmenu(false);
        }}
        aria-label="Conversation options"
        className="w-6 h-6 flex items-center justify-center rounded-md text-text-tertiary hover:bg-neutral-fill hover:text-ink-muted transition-colors"
      >
        <Icon name="more_vert" size={16} filled={false} />
      </button>

      {open && menuPos && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          className="z-30 rounded-xl border border-hairline bg-panel shadow-lg py-1"
        >
          {!submenu ? (
            <>
              <button
                onClick={() => {
                  onTogglePin();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-ink-2 hover:bg-neutral-fill/60 transition-colors"
              >
                <Icon name="push_pin" size={16} filled={pinned} />
                {pinned ? "Unpin" : "Pin conversation"}
              </button>
              <button
                onClick={() => setSubmenu(true)}
                className="w-full flex items-center justify-between px-3 py-2 text-[12.5px] text-ink-2 hover:bg-neutral-fill/60 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <Icon name="folder" size={16} filled={false} />
                  Add to folder
                </span>
                <Icon name="chevron_right" size={14} filled={false} />
              </button>
              <div className="my-1 border-t border-hairline" />
              <button
                onClick={() => {
                  onArchive();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-warning-strong hover:bg-neutral-fill/60 transition-colors"
              >
                <Icon name="archive" size={16} filled={false} />
                Archive
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSubmenu(false)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-text-tertiary hover:text-ink-muted transition-colors"
              >
                <Icon name="chevron_left" size={13} filled={false} />
                Back
              </button>
              <div className="max-h-40 overflow-y-auto">
                {currentFolderId !== null && (
                  <button
                    onClick={() => {
                      onAssignFolder(null);
                      setOpen(false);
                      setSubmenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-text-tertiary hover:bg-neutral-fill/60 transition-colors"
                  >
                    <Icon name="close" size={14} filled={false} />
                    Remove from folder
                  </button>
                )}
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      onAssignFolder(f.id);
                      setOpen(false);
                      setSubmenu(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] truncate transition-colors ${
                      f.id === currentFolderId ? "text-accent bg-accent-tint/60" : "text-ink-2 hover:bg-neutral-fill/60"
                    }`}
                  >
                    <Icon name="folder" size={16} filled={f.id === currentFolderId} />
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-hairline" />
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                  placeholder="New folder..."
                  className="flex-1 min-w-0 bg-transparent text-[12px] outline-none text-ink placeholder:text-placeholder"
                />
                <button
                  onClick={handleCreateFolder}
                  aria-label="Create folder"
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-accent transition-colors"
                >
                  <Icon name="add" size={15} filled={false} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
