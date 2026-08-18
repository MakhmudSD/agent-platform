const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ClarifyingQuestionCard = { type: "clarifying_question"; question: string; field: string };
export type PolicyCitationCard = { type: "policy_citation"; title: string; excerpt: string };
export type PolicyRuleStatus = "passed" | "binding" | "outstanding";
export type PolicyRuleCard = { rule: string; status: PolicyRuleStatus; evidence: string; cap: number | null };
export type RoutedTo = "approver" | "reviewer";
export type RoutingDecision = {
  routed_to: RoutedTo;
  reviewer_category: string | null;
  reason: string;
  confidence: "high" | "medium" | "low";
  triggered_rule: string | null;
};
export type TranscriptEntry = { from: "requester" | "agent"; text: string };
export type ApprovalRequestCard = {
  type: "approval_request";
  draft: Record<string, any>;
  policy_citations: PolicyCitationCard[];
  policy_evaluation: PolicyRuleCard[];
  routing_decision: RoutingDecision | null;
  approval_summary: string | null;
  // Approver/Reviewer only -- the real conversation that produced this
  // draft, reconstructed from run_events (see transcriptFromEvents in
  // page.tsx). Undefined on the requester's own live card, since they
  // already watched it happen turn by turn.
  transcript?: TranscriptEntry[];
};
export type FinalConfirmationCard = { type: "final_confirmation"; status: "finalized" | "rejected"; draft: Record<string, any>; reason?: string | null };
export type TextCard = { type: "text"; content: string };

export type Card = ClarifyingQuestionCard | ApprovalRequestCard | FinalConfirmationCard | TextCard;

export type RunResponse = { run_id: string; status: string; card: Card };

export type NotificationType = "needs_approval" | "needs_review" | "approved" | "rejected";
export type Notification = {
  id: string;
  run_id: string;
  message: string;
  type: NotificationType | null;
  read: boolean;
  created_at: string;
};

export type Role = "requester" | "approver" | "reviewer" | "admin";
export type AuthUser = { id: string; email: string; name: string; role: Role };

export type Folder = { id: string; name: string; created_at: string; run_count: number };

export type Attachment = { filename: string; url: string; size: number };

// credentials: "include" on every call -- the backend sets an httpOnly
// session cookie (routes/auth.py) and every protected route reads it back;
// without this, cross-port fetches (frontend :3000, backend :8000) never
// attach the cookie and every request looks anonymous.
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `API error ${res.status} on ${path}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `API error ${res.status} on ${path}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `API error ${res.status} on ${path}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `API error ${res.status} on ${path}`);
  }
  return res.json();
}

export const api = {
  // No role param -- self-service signup always creates a requester
  // (backend enforces this server-side regardless of what's sent).
  signup: (email: string, name: string, password: string) =>
    post<AuthUser>("/auth/signup", { email, name, password }),

  login: (email: string, password: string) => post<AuthUser>("/auth/login", { email, password }),

  logout: () => post<{ ok: boolean }>("/auth/logout", {}),

  me: () => get<AuthUser>("/auth/me"),

  startRun: (message: string) => post<RunResponse>("/runs", { message }),

  sendMessage: (runId: string, message: string) =>
    post<RunResponse>(`/runs/${runId}/messages`, { message }),

  respondToApproval: (runId: string, approved: boolean, reason?: string) =>
    post<RunResponse>(`/runs/${runId}/approval`, { approved, reason: reason ?? null }),

  getRun: (runId: string) => get<any>(`/runs/${runId}`),

  listRuns: () => get<any[]>("/runs"),

  listNotifications: () => get<Notification[]>("/notifications"),

  listUsers: () => get<{ id: string; email: string; name: string; role: Role; created_at: string }[]>("/admin/users"),

  // Dispatches a DOM event after marking read -- the rail badge
  // (Sidebar.tsx) and this page each fetch /notifications independently,
  // so without this the badge count only catches up on the next full
  // navigation/remount instead of the moment you actually read something.
  markNotificationRead: (id: string) =>
    post<{ id: string; read: boolean }>(`/notifications/${id}/read`, {}).then((r) => {
      window.dispatchEvent(new Event("notifications:changed"));
      return r;
    }),

  markAllNotificationsRead: () =>
    post<{ marked: number }>("/notifications/read-all", {}).then((r) => {
      window.dispatchEvent(new Event("notifications:changed"));
      return r;
    }),

  submitFeedback: (runId: string, rating: boolean, note?: string) =>
    post<{ run_id: string; rating: boolean }>(`/runs/${runId}/feedback`, { rating, note: note ?? null }),

  getFeedback: (runId: string) => get<{ rating: boolean | null }>(`/runs/${runId}/feedback`),

  listFolders: () => get<Folder[]>("/folders"),

  createFolder: (name: string) => post<Folder>("/folders", { name }),

  deleteFolder: (id: string) => del<{ deleted: boolean }>(`/folders/${id}`),

  setRunArchived: (runId: string, archived: boolean) =>
    patch<{ run_id: string; archived: boolean }>(`/runs/${runId}/archive`, { archived }),

  setRunFolder: (runId: string, folderId: string | null) =>
    patch<{ run_id: string; folder_id: string | null }>(`/runs/${runId}/folder`, { folder_id: folderId }),

  uploadAttachment: async (runId: string, file: File): Promise<Attachment> => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${API_BASE}/runs/${runId}/attachments`, { method: "POST", credentials: "include", body });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || `API error ${res.status} on /runs/${runId}/attachments`);
    }
    return res.json();
  },
};

// Attachment URLs come back API-relative ("/uploads/...") -- this resolves
// them against the same API_BASE every other request uses, so they work
// whether the frontend and backend are on the same origin or not.
export function attachmentUrl(path: string): string {
  return `${API_BASE}${path}`;
}
