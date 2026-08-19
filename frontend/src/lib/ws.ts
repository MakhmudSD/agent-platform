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
  // requester_name deliberately absent -- the server derives it from the
  // session cookie now (routes/ws_runs.py), never from client input.
  | { action: "start"; message: string }
  | { action: "message"; run_id: string; message: string }
  | { action: "field_patch"; run_id: string; field: string; value: unknown }
  | { action: "approval"; run_id: string; approved: boolean; reason?: string };

// One long-lived connection for the whole tab, matching the backend's
// "client sends one action at a time" contract in routes/ws_runs.py --
// actions are never sent concurrently, so a single socket is enough.
export class RunSocket {
  private ws: WebSocket;
  private queued: string[] = [];
  private intentionalClose = false;
  private onDisconnect?: () => void;

  // onDisconnect fires for a real drop (backend restart, network blip,
  // sleep/wake) -- not for the close() this class's own caller triggers on
  // unmount. Without this, a dead socket previously just left `send()`
  // queuing messages that would never be delivered, with the UI stuck on
  // "Working..." forever and no error surfaced.
  constructor(onEvent: (event: LiveEvent) => void, onDisconnect?: () => void) {
    this.onDisconnect = onDisconnect;
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.queued.forEach((msg) => this.ws.send(msg));
      this.queued = [];
    };
    this.ws.onmessage = (ev) => onEvent(JSON.parse(ev.data));
    this.ws.onclose = () => {
      if (!this.intentionalClose) onDisconnect?.();
    };
    this.ws.onerror = () => {
      if (!this.intentionalClose) onDisconnect?.();
    };
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
    this.intentionalClose = true;
    // An intentional close on an empty queue means exactly what it says --
    // this instance is done, nothing to clean up, no need to tell anyone.
    // But if a send() landed here first and is still sitting in `queued`,
    // the caller believes that action is in flight (busy=true) and this is
    // the last chance to say otherwise: closing the socket means nothing
    // will ever flush this queue, so without this the UI hangs on
    // "Working..." forever with no error. This is reachable for real, not
    // just when React StrictMode's dev-only double-invoke closes a socket
    // before it ever opens -- any effect that tears down and recreates the
    // connection (e.g. user?.id changing on re-login) can race a send the
    // same way. Reusing onDisconnect's own "connection was lost, refresh"
    // messaging is the right call either way: whatever the cause, the
    // action truly did not go through.
    if (this.queued.length > 0) this.onDisconnect?.();
    this.ws.close();
  }
}
