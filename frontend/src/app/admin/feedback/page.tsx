"use client";

import { useEffect, useState } from "react";
import { api, AdminFeedback } from "@/lib/api";
import { Icon } from "@/components/Icon";

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<AdminFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.listFeedback().then(setRows).catch((e) => setError(e.message));
  }, []);

  const upCount = rows?.filter((r) => r.rating).length ?? 0;
  const downCount = rows?.filter((r) => !r.rating).length ?? 0;

  function handleReplied(updated: { id: string; admin_reply: string; admin_reply_at: string }) {
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) ?? null);
    setOpenId(null);
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-ink mb-1">Feedback</h1>
      <p className="text-text-secondary text-sm mb-8">
        Thumbs up/down left on resolved conversations, requester and decider side alike. Click a row to reply --
        the person who left it gets a notification.
      </p>

      {error && <p className="text-sm text-warning-strong mb-4">{error}</p>}

      {rows && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-8 max-w-md">
          <div className="bg-panel border border-hairline rounded-2xl p-5 shadow-card">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="thumb_up" size={16} filled className="text-accent" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Good</p>
            </div>
            <p className="text-[26px] font-semibold text-ink leading-none tabular-nums">{upCount}</p>
          </div>
          <div className="bg-panel border border-hairline rounded-2xl p-5 shadow-card">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="thumb_down" size={16} filled className="text-warning-strong" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Needs work</p>
            </div>
            <p className="text-[26px] font-semibold text-ink leading-none tabular-nums">{downCount}</p>
          </div>
        </div>
      )}

      <div className="border border-hairline rounded-xl overflow-hidden bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left text-[11px] uppercase tracking-wide text-text-tertiary">
              <th className="px-5 py-3 font-semibold w-10"></th>
              <th className="px-5 py-3 font-semibold">Rated by</th>
              <th className="px-5 py-3 font-semibold">Request</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Note</th>
              <th className="px-5 py-3 font-semibold">When</th>
              <th className="px-5 py-3 font-semibold">Reply</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <FeedbackRow
                key={r.id}
                row={r}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                onReplied={handleReplied}
              />
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-text-tertiary">
                  No feedback submitted yet -- the thumbs up/down on a resolved conversation shows up here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeedbackRow(props: {
  row: AdminFeedback;
  open: boolean;
  onToggle: () => void;
  onReplied: (updated: { id: string; admin_reply: string; admin_reply_at: string }) => void;
}) {
  const { row: r, open, onToggle, onReplied } = props;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const updated = await api.replyToFeedback(r.id, text);
      onReplied(updated);
      setMessage("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-t border-hairline-soft cursor-pointer transition-colors ${open ? "bg-app" : "hover:bg-app/60"}`}
      >
        <td className="px-5 py-3">
          <Icon
            name={r.rating ? "thumb_up" : "thumb_down"}
            size={16}
            filled
            className={r.rating ? "text-accent" : "text-warning-strong"}
          />
        </td>
        <td className="px-5 py-3 text-ink font-medium">
          {r.rater_name} <span className="text-text-tertiary font-normal capitalize">({r.rater_role})</span>
        </td>
        <td className="px-5 py-3 text-text-secondary">
          {r.run_category ?? "Request"} &middot; {r.run_requester_name}
        </td>
        <td className="px-5 py-3 text-text-tertiary capitalize">{r.run_status.replace("_", " ")}</td>
        <td className="px-5 py-3 text-text-secondary">{r.note ?? <span className="text-text-tertiary italic">No note left</span>}</td>
        <td className="px-5 py-3 text-text-tertiary">{new Date(r.created_at).toLocaleString()}</td>
        <td className="px-5 py-3 text-text-tertiary">
          {r.admin_reply ? (
            <span className="inline-flex items-center gap-1 text-accent">
              <Icon name="check_circle" size={14} filled />
              Replied
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Icon name={open ? "expand_less" : "expand_more"} size={16} filled={false} />
              Reply
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-hairline-soft bg-app">
          <td colSpan={7} className="px-5 py-5">
            <div className="max-w-xl">
              {r.admin_reply ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
                    Your reply &middot; {r.admin_reply_at && new Date(r.admin_reply_at).toLocaleString()}
                  </p>
                  <p className="text-sm text-ink-2 bg-card rounded-xl px-4 py-3 shadow-card">{r.admin_reply}</p>
                </div>
              ) : (
                <div onClick={(e) => e.stopPropagation()}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
                    Reply to {r.rater_name}
                  </p>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Thanks for the feedback -- ..."
                    className="w-full px-3.5 py-2.5 rounded-lg border border-hairline bg-panel text-sm outline-none focus:border-accent"
                  />
                  {error && <p className="text-sm text-warning-strong mt-1.5">{error}</p>}
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={send}
                      disabled={sending || !message.trim()}
                      className="px-3.5 py-2 rounded-lg bg-ink text-white text-[13px] font-medium hover:bg-ink/90 disabled:opacity-60"
                    >
                      {sending ? "Sending..." : "Send reply"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
