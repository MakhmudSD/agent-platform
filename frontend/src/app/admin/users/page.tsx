"use client";

import { useEffect, useState } from "react";
import { api, AdminUser, Role, ROLE_LABELS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-accent-tint text-accent-dark",
  approver: "bg-[#EDEAFB] text-[#5B4FC4]",
  reviewer: "bg-[#F6EAE2] text-warning-strong",
  requester: "bg-neutral-fill text-ink-2",
};

const ROLES: Role[] = ["requester", "approver", "reviewer", "admin"];

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    api.listUsers().then(setUsers).catch((e) => setError(e.message));
  }

  useEffect(refresh, []);

  const adminCount = users.filter((u) => u.role === "admin").length;

  async function changeRole(u: AdminUser, role: Role) {
    if (role === u.role) return;
    setError(null);
    setBusyId(u.id);
    try {
      const updated = await api.updateUser(u.id, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(u: AdminUser) {
    setError(null);
    setBusyId(u.id);
    try {
      await api.deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-ink mb-1">Users</h1>
          <p className="text-text-secondary text-sm">Every account across every role.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-white text-[13px] font-medium hover:bg-ink/90"
        >
          <Icon name="add" size={16} filled={false} />
          New account
        </button>
      </div>

      {error && <p className="text-sm text-warning-strong mt-4">{error}</p>}

      <div className="border border-hairline rounded-xl overflow-hidden bg-panel mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left text-[11px] uppercase tracking-wide text-text-tertiary">
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-5 py-3 font-semibold">Email</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Joined</th>
              <th className="px-5 py-3 font-semibold w-10" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              const isLastAdmin = u.role === "admin" && adminCount <= 1;
              const locked = isSelf || isLastAdmin;
              return (
                <tr key={u.id} className="border-t border-hairline-soft">
                  <td className="px-5 py-3 text-ink font-medium">
                    {u.name}
                    {isSelf && <span className="text-text-tertiary font-normal"> (you)</span>}
                  </td>
                  <td className="px-5 py-3 text-text-secondary">{u.email}</td>
                  <td className="px-5 py-3">
                    <select
                      value={u.role}
                      disabled={locked || busyId === u.id}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      title={isSelf ? "You can't change your own role" : isLastAdmin ? "Can't demote the last admin" : undefined}
                      className={`px-2 py-0.5 rounded-full text-xs capitalize border-0 ${ROLE_STYLES[u.role] ?? "bg-neutral-fill text-ink-2"} ${locked ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3 text-text-tertiary">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => removeUser(u)}
                      disabled={locked || busyId === u.id}
                      title={isSelf ? "You can't delete your own account" : isLastAdmin ? "Can't delete the last admin" : "Delete"}
                      className={`text-text-tertiary hover:text-warning-strong ${locked ? "opacity-30 cursor-not-allowed hover:text-text-tertiary" : ""}`}
                    >
                      <Icon name="delete" size={16} filled={false} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-text-tertiary">No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setUsers((prev) => [u, ...prev]);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal(props: { onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("requester");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const u = await api.createUser(email, name, password, role);
      props.onCreated(u);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={props.onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-panel rounded-2xl shadow-xl w-full max-w-sm p-6"
      >
        <h2 className="text-lg font-semibold text-ink mb-4">New account</h2>

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg border border-hairline bg-app text-sm"
        />

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Email</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg border border-hairline bg-app text-sm"
        />

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Password</label>
        <input
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg border border-hairline bg-app text-sm"
        />

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full mb-4 px-3 py-2 rounded-lg border border-hairline bg-app text-sm capitalize"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        {error && <p className="text-sm text-warning-strong mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-ink-2 hover:bg-neutral-fill">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-3.5 py-2 rounded-lg bg-ink text-white text-[13px] font-medium hover:bg-ink/90 disabled:opacity-60">
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
