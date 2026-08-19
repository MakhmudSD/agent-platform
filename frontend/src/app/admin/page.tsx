"use client";

import { useEffect, useState } from "react";
import { api, UsageReport } from "@/lib/api";
import { Icon } from "@/components/Icon";

type RunSummary = { run_id: string; status: string; requester_name: string; created_at: string };
type AdminUser = { id: string; email: string; name: string; role: string; created_at: string };

function fmtUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(2)}`;
}

function fmtKrw(n: number): string {
  return n < 1 ? `${n.toFixed(2)}원` : `${Math.round(n).toLocaleString()}원`;
}

// Div-width bars, not a charting dependency -- the frontend has none
// installed (lucide-react is icons only) and by_node's six-ish rows don't
// need one. by_day stays a table below: with one day of data seeded so far,
// a line/bar chart over a single point would be worse than the number
// itself. Revisit once there's more than a day's spread to show.
//
// One series (cost per node -- a nominal-categorical bar chart, not a
// ranking of independent series), so it's one validated slot, not the
// brand accent: #0E7A68 measures OKLCH C 0.093, just under the 0.10
// chroma floor a bar mark needs to read as color rather than gray
// (node_modules-free run of dataviz/scripts/validate_palette.js). Used
// the palette's slot-3 "aqua" (#1baf7a) instead -- same teal family,
// clears the floor. It sits at 2.82:1 against the white panel, under the
// 3:1 mark-contrast target, so the direct token/cost labels beside every
// bar are load-bearing (the skill's contrast relief), not decoration.
const NODE_BAR_COLOR = "#1baf7a";

function NodeCostBars(props: { rows: (import("@/lib/api").UsageRow & { node: string })[] }) {
  const { rows } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.cost_usd), 0.000001);
  return (
    <div className="border border-hairline rounded-xl bg-panel p-5 space-y-3">
      {rows.map((r) => {
        const active = hovered === r.node;
        return (
          <div
            key={r.node}
            className="flex items-center gap-3 relative"
            onMouseEnter={() => setHovered(r.node)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(r.node)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
            role="img"
            aria-label={`${r.node}: ${r.calls} calls, ${r.total_tokens.toLocaleString()} tokens, ${fmtUsd(r.cost_usd)} (${fmtKrw(r.cost_krw)})`}
          >
            <span className="w-32 shrink-0 text-[12.5px] text-ink font-medium truncate">{r.node}</span>
            {/* baseline at the left -- bar grows right, so only the data-end (right) is rounded */}
            <div className="flex-1 h-6 rounded-sm bg-neutral-fill relative overflow-hidden">
              <div
                className="h-full transition-[width,filter]"
                style={{
                  width: `${Math.max(2, (r.cost_usd / max) * 100)}%`,
                  backgroundColor: NODE_BAR_COLOR,
                  borderRadius: "0 4px 4px 0",
                  filter: active ? "brightness(0.92)" : undefined,
                }}
              />
            </div>
            <span className="w-20 shrink-0 text-[12px] text-text-tertiary text-right tabular-nums">
              {r.total_tokens.toLocaleString()}
            </span>
            <span className="w-24 shrink-0 text-[12px] text-text-secondary text-right tabular-nums">
              {fmtUsd(r.cost_usd)}
            </span>

            {active && (
              <div
                role="tooltip"
                className="absolute z-10 left-32 -top-2 -translate-y-full bg-ink text-white text-[12px] rounded-lg px-3 py-2 shadow-panel pointer-events-none whitespace-nowrap"
              >
                <p className="font-semibold mb-0.5">{r.node}</p>
                <p className="tabular-nums text-white/80">{r.calls} calls &middot; {r.total_tokens.toLocaleString()} tokens</p>
                <p className="tabular-nums text-white/80">{fmtUsd(r.cost_usd)} &middot; {fmtKrw(r.cost_krw)}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The KPI-strip-over-content-grid shape (fixed sidebar, 4-ish stat cards,
// tables below) is the standard admin-console layout -- Linear, Stripe,
// Vercel's dashboards, and most of what Pinterest surfaces for "admin
// dashboard UI" all converge on this same structure. Not a stylistic
// flourish, it's what "the most important number is the biggest element
// on screen, secondary detail steps down" actually looks like in practice.
function StatCard(props: { label: string; value: string; sub?: string; icon: string; tone?: "default" | "warning" }) {
  const { label, value, sub, icon, tone = "default" } = props;
  return (
    <div className="bg-panel border border-hairline rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            tone === "warning" ? "bg-[#F6EAE2] text-warning-strong" : "bg-accent-tint text-accent"
          }`}
        >
          <Icon name={icon} size={17} filled={false} />
        </span>
      </div>
      <p className="text-[26px] font-semibold text-ink leading-none tabular-nums">{value}</p>
      {sub && <p className="text-[12px] text-text-tertiary mt-1.5">{sub}</p>}
    </div>
  );
}

export default function AdminOverview() {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUsage().then(setUsage).catch((e) => setError(e.message));
    api.listUsers().then(setUsers).catch((e) => setError(e.message));
    api.listRuns().then(setRuns).catch((e) => setError(e.message));
  }, []);

  const pending = runs.filter((r) => r.status === "awaiting_approval").length;

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-ink mb-1">Overview</h1>
      <p className="text-text-secondary text-sm mb-8">System-wide activity across every account and request.</p>

      {error && <p className="text-sm text-warning-strong mb-4">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <StatCard label="Requests" value={String(runs.length)} icon="receipt_long" />
        <StatCard
          label="Pending decisions"
          value={String(pending)}
          sub={pending > 0 ? "awaiting an approver or reviewer" : "nothing waiting"}
          icon="hourglass_top"
          tone={pending > 0 ? "warning" : "default"}
        />
        <StatCard label="Accounts" value={String(users.length)} icon="group" />
        <StatCard
          label="Token spend"
          value={usage ? fmtUsd(usage.totals.cost_usd) : "--"}
          sub={usage ? `${fmtKrw(usage.totals.cost_krw)} · ${usage.totals.calls} LLM calls` : undefined}
          icon="toll"
        />
      </div>

      {usage && (
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Token usage</h2>
            <p className="text-[11px] text-text-tertiary">
              {usage.model}'s published rate -- ${usage.pricing_usd_per_million.input}/M in, $
              {usage.pricing_usd_per_million.output}/M out -- ₩{usage.krw_per_usd.toLocaleString()}/$1
            </p>
          </div>
          {usage.model.includes("latest") && (
            <p className="text-xs text-warning-strong mb-3">
              "{usage.model}" is a floating alias, not a pinned version -- Google can repoint it to a different
              underlying model at any time with no changelog, so the estimate above may not match actual billing on
              any given day.
            </p>
          )}

          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
            Cost by node
          </h3>
          <NodeCostBars rows={usage.by_node} />

          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2 mt-6">
            By day
          </h3>
          <div className="border border-hairline rounded-xl overflow-hidden bg-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                  <th className="px-4 py-2 font-semibold">Day</th>
                  <th className="px-4 py-2 font-semibold text-right">Calls</th>
                  <th className="px-4 py-2 font-semibold text-right">Tokens</th>
                  <th className="px-4 py-2 font-semibold text-right">Cost (USD)</th>
                  <th className="px-4 py-2 font-semibold text-right">Cost (₩)</th>
                </tr>
              </thead>
              <tbody>
                {usage.by_day.map((d) => (
                  <tr key={d.day} className="border-t border-hairline-soft">
                    <td className="px-4 py-2 text-ink font-medium">{d.day}</td>
                    <td className="px-4 py-2 text-text-secondary text-right tabular-nums">{d.calls}</td>
                    <td className="px-4 py-2 text-text-secondary text-right tabular-nums">{d.total_tokens.toLocaleString()}</td>
                    <td className="px-4 py-2 text-text-tertiary text-right tabular-nums">{fmtUsd(d.cost_usd)}</td>
                    <td className="px-4 py-2 text-text-tertiary text-right tabular-nums">{fmtKrw(d.cost_krw)}</td>
                  </tr>
                ))}
                {usage.by_day.length <= 1 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-[11px] text-text-tertiary italic">
                      Only one day of usage so far -- a trend chart needs more days to be worth showing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
