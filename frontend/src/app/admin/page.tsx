"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

type AdminUser = { id: string; email: string; name: string; role: string; created_at: string };
type RunSummary = { run_id: string; status: string; requester_name: string; created_at: string };

const STATUS_STYLES: Record<string, string> = {
  finalized: "bg-teal-50 text-teal-700",
  rejected: "bg-slate-100 text-slate-600",
  awaiting_approval: "bg-amber-100 text-amber-700",
  gathering: "bg-slate-50 text-slate-500",
  retrieving: "bg-slate-50 text-slate-500",
  drafting: "bg-slate-50 text-slate-500",
};

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (user.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    api.listUsers().then(setUsers).catch((e) => setError(e.message));
    api.listRuns().then(setRuns).catch((e) => setError(e.message));
  }, [user]);

  if (authLoading || !user || user.role !== "admin") {
    return <div className="min-h-screen bg-white" />;
  }

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">Admin dashboard</h1>
          <p className="text-slate-500 text-sm mb-8">
            Read-only oversight of accounts and requests across the whole system.
          </p>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <section className="mb-10">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-3">
              Users ({users.length})
            </h2>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">Email</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-900 font-medium">{u.name}</td>
                      <td className="px-4 py-2 text-slate-600">{u.email}</td>
                      <td className="px-4 py-2 text-slate-600 capitalize">{u.role}</td>
                      <td className="px-4 py-2 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No users yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-3">
              Requests ({runs.length})
            </h2>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2 font-semibold">Requester</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.run_id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-900 font-medium">{r.requester_name}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[r.status] ?? "bg-slate-50 text-slate-500"}`}>
                          {r.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400">{new Date(r.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400">No requests yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
