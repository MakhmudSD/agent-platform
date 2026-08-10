"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";

type RunSummary = { run_id: string; status: string; requester_name: string; created_at: string };
type RunEvent = { type: string; payload: Record<string, any>; created_at: string };
type RunDetail = { run_id: string; status: string; requester_name: string; draft: Record<string, any>; events: RunEvent[] };

export default function History() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);

  useEffect(() => {
    api.listRuns().then(setRuns);
  }, []);

  async function openRun(runId: string) {
    const detail = await api.getRun(runId);
    setSelected(detail);
  }

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar activeRunId={selected?.run_id} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">Audit trail</h1>
          <p className="text-slate-500 text-sm mb-8">
            Every state transition, retrieval, and human decision — not just the final answer.
          </p>

          <div className="grid grid-cols-[220px_1fr] gap-6">
            <div className="space-y-1">
              {runs.map((r) => (
                <button
                  key={r.run_id}
                  onClick={() => openRun(r.run_id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm border ${
                    selected?.run_id === r.run_id
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white border-slate-100 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{r.requester_name}</div>
                  <div className={`text-xs ${selected?.run_id === r.run_id ? "text-slate-300" : "text-slate-500"}`}>
                    {r.status}
                  </div>
                </button>
              ))}
              {runs.length === 0 && <p className="text-sm text-slate-400">No runs yet.</p>}
            </div>

            <div>
              {selected ? (
                <div className="space-y-2">
                  {selected.events.map((e, i) => (
                    <div key={i} className="flex gap-3 text-sm border-b border-slate-100 pb-2">
                      <span className="font-mono text-xs text-slate-400 w-40 shrink-0 pt-0.5">
                        {new Date(e.created_at).toLocaleTimeString()}
                      </span>
                      <div>
                        <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                          {e.type}
                        </span>
                        <pre className="text-xs text-slate-500 mt-1 whitespace-pre-wrap font-mono">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Select a run to see its full trail.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
