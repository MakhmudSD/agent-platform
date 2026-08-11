import { Card } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = `${API_BASE.replace(/^http/, "ws")}/ws/runs`;

export type LiveEvent =
  | { type: "node_started"; node: string }
  | { type: "node_finished"; node: string }
  | { type: "node_failed"; node: string; error: string }
  | { type: "audit_event"; event_type: string; payload: Record<string, any> }
  | { type: "llm_token"; node: string | null; text: string }
  | { type: "result"; run_id: string; status: string; card: Card }
  | { type: "error"; detail: string };

export type AuditLogEntry = { event_type: string; payload: Record<string, any>; ts: number };

export type RunAction =
  | { action: "start"; requester_name: string; message: string }
  | { action: "message"; run_id: string; message: string }
  | { action: "approval"; run_id: string; approved: boolean; reason?: string };

// One long-lived connection for the whole tab, matching the backend's
// "client sends one action at a time" contract in routes/ws_runs.py --
// actions are never sent concurrently, so a single socket is enough.
export class RunSocket {
  private ws: WebSocket;
  private queued: string[] = [];

  constructor(onEvent: (event: LiveEvent) => void) {
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.queued.forEach((msg) => this.ws.send(msg));
      this.queued = [];
    };
    this.ws.onmessage = (ev) => onEvent(JSON.parse(ev.data));
  }

  send(action: RunAction) {
    const payload = JSON.stringify(action);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.queued.push(payload);
    }
  }

  close() {
    this.ws.close();
  }
}
