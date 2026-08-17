import { NotificationType } from "@/lib/api";

// Per-user, per-type "show this in my inbox/badge" toggle -- a display
// preference (Settings page), not a delivery preference: the backend
// still creates every notification regardless (there's only one delivery
// channel, in-app, so there's nothing else to gate). Client-only, same
// reasoning as lib/pins.ts. Default is everything enabled -- a toggle a
// user never touched should behave like it doesn't exist.
function key(userId: string): string {
  return `notification_prefs_${userId}`;
}

export function getDisabledTypes(userId: string): NotificationType[] {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isTypeEnabled(userId: string, type: NotificationType | null): boolean {
  if (!type) return true;
  return !getDisabledTypes(userId).includes(type);
}

export function setTypeEnabled(userId: string, type: NotificationType, enabled: boolean): NotificationType[] {
  const disabled = getDisabledTypes(userId);
  const next = enabled ? disabled.filter((t) => t !== type) : [...new Set([...disabled, type])];
  localStorage.setItem(key(userId), JSON.stringify(next));
  return next;
}
