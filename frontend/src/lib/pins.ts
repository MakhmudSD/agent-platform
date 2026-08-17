// Per-user pinned-run ids, kept in localStorage -- a personal "fast
// access to a few requests" list, not shared data other users or devices
// need to see, so it doesn't need a backend table. Same reasoning as
// Sidebar.tsx's sidebar_expanded preference.
function key(userId: string): string {
  return `pinned_runs_${userId}`;
}

export function getPinnedIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function togglePin(userId: string, runId: string): string[] {
  const ids = getPinnedIds(userId);
  const next = ids.includes(runId) ? ids.filter((id) => id !== runId) : [...ids, runId];
  localStorage.setItem(key(userId), JSON.stringify(next));
  return next;
}
