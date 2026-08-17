function key(userId: string): string {
  return `agent_hint_dismissed_${userId}`;
}

export function isAgentHintDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === "true";
  } catch {
    return false;
  }
}

export function dismissAgentHint(userId: string): void {
  localStorage.setItem(key(userId), "true");
}
