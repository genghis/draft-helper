import { useCallback, useEffect, useState } from "react";
import type { AdminUserRow } from "@drafthelper/shared";
import { api } from "../api/client";
import "./AdminPanel.css";

function inviteUrl(token: string): string {
  return `${window.location.origin}/api/auth/login?invite=${token}`;
}

interface FreshInvite {
  name: string;
  url: string;
}

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Raw tokens are shown exactly once — only hashes exist server-side.
  const [freshInvite, setFreshInvite] = useState<FreshInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    api<AdminUserRow[]>("/admin/users").then(setUsers).catch((e) => setError(String(e)));
  }, []);

  useEffect(refresh, [refresh]);

  async function run(action: () => Promise<FreshInvite>) {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setFreshInvite(await action());
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const addUser = () =>
    run(async () => {
      const res = await api<{ name: string; token: string }>("/admin/users", {
        method: "POST",
        body: { name: newName },
      });
      setNewName("");
      return { name: res.name, url: inviteUrl(res.token) };
    });

  const rotate = (user: AdminUserRow) =>
    run(async () => {
      const res = await api<{ token: string }>(`/admin/users/${user.id}/invite`, {
        method: "POST",
      });
      return { name: user.name, url: inviteUrl(res.token) };
    });

  const copy = async () => {
    if (!freshInvite) return;
    await navigator.clipboard.writeText(freshInvite.url);
    setCopied(true);
  };

  return (
    <section className="admin-panel">
      <h2>League members</h2>
      {error && <p className="admin-error">{error}</p>}
      <ul className="admin-user-list">
        {users.map((u) => (
          <li key={u.id} className="admin-user-row">
            <span className="admin-user-name">
              {u.name}
              {u.admin && <span className="admin-badge">admin</span>}
            </span>
            <button type="button" disabled={busy} onClick={() => rotate(u)}>
              New invite link
            </button>
          </li>
        ))}
      </ul>
      <form
        className="admin-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          addUser();
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="League mate's name"
          maxLength={50}
          required
        />
        <button type="submit" disabled={busy || !newName.trim()}>
          Add member
        </button>
      </form>
      {freshInvite && (
        <div className="admin-fresh-invite">
          <p>
            Invite link for <strong>{freshInvite.name}</strong> — visible only now, send it to
            them:
          </p>
          <code>{freshInvite.url}</code>
          <button type="button" onClick={copy}>
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      )}
    </section>
  );
}
