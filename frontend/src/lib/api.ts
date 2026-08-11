const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ClarifyingQuestionCard = { type: "clarifying_question"; question: string; field: string };
export type PolicyCitationCard = { type: "policy_citation"; title: string; excerpt: string };
export type ApprovalRequestCard = { type: "approval_request"; draft: Record<string, any>; policy_citations: PolicyCitationCard[] };
export type FinalConfirmationCard = { type: "final_confirmation"; status: "finalized" | "rejected"; draft: Record<string, any>; reason?: string | null };
export type TextCard = { type: "text"; content: string };

export type Card = ClarifyingQuestionCard | ApprovalRequestCard | FinalConfirmationCard | TextCard;

export type RunResponse = { run_id: string; status: string; card: Card };

export type Notification = {
  id: string;
  run_id: string;
  message: string;
  read: boolean;
  created_at: string;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.json();
}

export const api = {
  startRun: (requester_name: string, message: string) =>
    post<RunResponse>("/runs", { requester_name, message }),

  sendMessage: (runId: string, message: string) =>
    post<RunResponse>(`/runs/${runId}/messages`, { message }),

  respondToApproval: (runId: string, approved: boolean, reason?: string) =>
    post<RunResponse>(`/runs/${runId}/approval`, { approved, reason: reason ?? null }),

  getRun: async (runId: string) => {
    const res = await fetch(`${API_BASE}/runs/${runId}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },

  listRuns: async () => {
    const res = await fetch(`${API_BASE}/runs`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },

  listNotifications: async (): Promise<Notification[]> => {
    const res = await fetch(`${API_BASE}/notifications`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },

  markNotificationRead: (id: string) => post<{ id: string; read: boolean }>(`/notifications/${id}/read`, {}),
};
