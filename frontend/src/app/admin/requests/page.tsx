"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

type RunSummary = {
  run_id: string; status: string; requester_name: string;
  routed_to: "approver" | "reviewer" | null; created_at: string;
};

type RunDetail = {
  run_id: string; status: string; requester_name: string; draft: Record<string, any>;
  routed_to: string | null;
  events: { type: string; payload: Record<string, any>; created_at: string }[];
};

const STATUS_STYLES: Record<string, string> = {
  finalized: "bg-accent-tint text-accent-dark",
  rejected: "bg-[#F6EAE2] text-warning-strong",
  awaiting_approval: "bg-[#EDEAFB] text-[#5B4FC4]",
  gathering: "bg-neutral-fill text-ink-2",
  retrieving: "bg-neutral-fill text-ink-2",
  drafting: "bg-neutral-fill text-ink-2",
};

const STATUS_FILTERS = ["all", "gathering", "awaiting_approval", "finalized", "rejected"] as const;

// Oversight, not decision-making -- this is deliberately read-only (no
// Approve/Send back here). Deciding is Bob/Carol's job via their own
// notifications queue; an admin drilling into a request needs to see what
// happened, not act on it a second time.
function extractSummary(detail: RunDetail) {
  const approvalSummary = detail.events.find((e) => e.type === "approval_summary_generated")?.payload.approval_summary as string | undefined;
  const policyEvaluation = detail.events.find((e) => e.type === "policy_evaluated")?.payload.policy_evaluation as any[] | undefined;
  const routingDecision = detail.events.find((e) => e.type === "routing_decided")?.payload.routing_decision;
  const rejectionReason = [...detail.events].reverse().find((e) => e.type === "rejected")?.payload.reason as string | undefined;
  return { approvalSummary, policyEvaluation: policyEvaluation ?? [], routingDecision, rejectionReason };
}

export default function AdminRequests() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.listRuns().then(setRuns).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? runs : runs.filter((r) => r.status === filter)),
    [runs, filter]
  );

  async function toggleRow(runId: string) {
    if (openId === runId) {
      setOpenId(null);
      return;
    }
    setOpenId(runId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.getRun(runId);
      setDetail(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-ink mb-1">Requests</h1>
      <p className="text-text-secondary text-sm mb-6">
        Every request across every requester. Click a row for the full decision record.
      </p>

      {error && <p className="text-sm text-warning-strong mb-4">{error}</p>}

      <div className="flex items-center gap-1 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium capitalize transition-colors ${
              filter === f ? "bg-ink text-white" : "bg-neutral-fill text-ink-2 hover:bg-neutral-fill-2"
            }`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="border border-hairline rounded-xl overflow-hidden bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left text-[11px] uppercase tracking-wide text-text-tertiary">
              <th className="px-5 py-3 font-semibold">Requester</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Routed to</th>
              <th className="px-5 py-3 font-semibold">Created</th>
              <th className="px-5 py-3 font-semibold w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const open = openId === r.run_id;
              return (
                <RunRow
                  key={r.run_id}
                  run={r}
                  open={open}
                  detail={open ? detail : null}
                  loading={open && detailLoading}
                  onToggle={() => toggleRow(r.run_id)}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-text-tertiary">No requests match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunRow(props: {
  run: RunSummary; open: boolean; detail: RunDetail | null; loading: boolean; onToggle: () => void;
}) {
  const { run, open, detail, loading, onToggle } = props;
  const summary = detail ? extractSummary(detail) : null;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-t border-hairline-soft cursor-pointer transition-colors ${open ? "bg-app" : "hover:bg-app/60"}`}
      >
        <td className="px-5 py-3 text-ink font-medium">{run.requester_name}</td>
        <td className="px-5 py-3">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[run.status] ?? "bg-neutral-fill text-ink-2"}`}>
            {run.status.replace("_", " ")}
          </span>
        </td>
        <td className="px-5 py-3 text-text-secondary capitalize">{run.routed_to ?? "--"}</td>
        <td className="px-5 py-3 text-text-tertiary">{new Date(run.created_at).toLocaleString()}</td>
        <td className="px-5 py-3 text-text-tertiary">
          <Icon name={open ? "expand_less" : "expand_more"} size={18} filled={false} />
        </td>
      </tr>
      {open && (
        <tr className="border-t border-hairline-soft bg-app">
          <td colSpan={5} className="px-5 py-5">
            {loading && <p className="text-sm text-text-tertiary">Loading...</p>}
            {detail && summary && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Draft</p>
                  <dl className="space-y-1.5 text-sm">
                    {Object.entries(detail.draft).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="text-text-tertiary capitalize w-28 shrink-0">{k.replace("_", " ")}</dt>
                        <dd className="text-ink-2">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Decision record</p>
                  {summary.approvalSummary && <p className="text-sm text-ink-2 mb-3">{summary.approvalSummary}</p>}
                  {summary.rejectionReason && (
                    <p className="text-sm text-warning-strong mb-3">Sent back: {summary.rejectionReason}</p>
                  )}
                  {summary.routingDecision && (
                    <p className="text-xs text-text-tertiary mb-3">
                      Routed to {summary.routingDecision.routed_to} -- {summary.routingDecision.reason}
                    </p>
                  )}
                  {summary.policyEvaluation.length > 0 ? (
                    <ul className="space-y-1 text-xs text-text-secondary">
                      {summary.policyEvaluation.map((rule: any, i: number) => (
                        <li key={i}>
                          <span className="capitalize font-medium">{rule.status}</span> -- {rule.rule}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-text-tertiary">No applicable policy was found for this request.</p>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
