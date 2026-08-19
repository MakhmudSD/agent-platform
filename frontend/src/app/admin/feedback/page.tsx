"use client";

import { useEffect, useState } from "react";
import { api, AdminFeedback } from "@/lib/api";
import { Icon } from "@/components/Icon";

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<AdminFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listFeedback().then(setRows).catch((e) => setError(e.message));
  }, []);

  const upCount = rows?.filter((r) => r.rating).length ?? 0;
  const downCount = rows?.filter((r) => !r.rating).length ?? 0;

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-ink mb-1">Feedback</h1>
      <p className="text-text-secondary text-sm mb-8">
        Thumbs up/down left on resolved conversations, requester and decider side alike.
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
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="border-t border-hairline-soft">
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
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-text-tertiary">
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
