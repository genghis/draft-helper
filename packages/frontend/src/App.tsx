import { useEffect, useState } from "react";
import type { SessionUser } from "@drafthelper/shared";
import { api, ApiError } from "./api/client";
import "./App.css";

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; user: SessionUser };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    api<SessionUser>("/me")
      .then((user) => setAuth({ status: "in", user }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: "out" });
        else throw err;
      });
  }, []);

  return (
    <main className="app-shell">
      <h1>Draft Helper</h1>
      {auth.status === "loading" && <p className="muted">Checking session…</p>}
      {auth.status === "out" && (
        <p className="muted">Not signed in — use your invite link to get in.</p>
      )}
      {auth.status === "in" && <p>Welcome, {auth.user.name}.</p>}
    </main>
  );
}
