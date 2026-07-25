import { useCallback, useEffect, useState } from "react";
import type { BoardMeta, SessionUser, SourceMeta } from "@drafthelper/shared";
import { api, ApiError } from "./api/client";
import { useAdp } from "./state/adp";
import { usePlayers } from "./state/players";
import { AdminPanel } from "./views/AdminPanel";
import { BoardsView } from "./views/BoardsView";
import { DraftDayView } from "./views/DraftDayView";
import { ImportView } from "./views/ImportView";
import { SettingsView } from "./views/SettingsView";
import { SourcesView } from "./views/SourcesView";
import "./App.css";

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; user: SessionUser };

type View = "sortings" | "sources" | "import" | "draft" | "settings";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [view, setView] = useState<View>("sortings");
  const { players, byId, error: playersError } = usePlayers();
  const adp = useAdp();

  useEffect(() => {
    api<SessionUser>("/me")
      .then((user) => setAuth({ status: "in", user }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: "out" });
        else throw err;
      });
  }, []);

  const signedIn = auth.status === "in";
  useEffect(() => {
    if (signedIn) {
      api<BoardMeta[]>("/boards").then(setBoards);
      api<SourceMeta[]>("/sources").then(setSources);
    }
  }, [signedIn]);

  const onSourceCreated = useCallback((meta: SourceMeta) => {
    setSources((prev) => [...prev, meta]);
    setView("sources");
  }, []);

  const onSortingCreated = useCallback((meta: BoardMeta) => {
    setBoards((prev) => [...prev, meta]);
    setView("sortings");
  }, []);

  const navItem = (key: View, label: string) => (
    <button
      type="button"
      className={view === key ? "app-nav-active" : undefined}
      onClick={() => setView(key)}
    >
      {label}
    </button>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Draft Helper</h1>
        {signedIn && (
          <nav className="app-nav">
            {navItem("sortings", "Sortings")}
            {navItem("sources", "Sources")}
            {navItem("draft", "Draft day")}
            {navItem("settings", "Settings")}
          </nav>
        )}
      </header>
      {auth.status === "loading" && <p className="muted">Checking session…</p>}
      {auth.status === "out" && (
        <p className="muted">Not signed in — use your invite link to get in.</p>
      )}
      {auth.status === "in" && (
        <>
          {playersError && <p className="app-error">Player list failed to load: {playersError}</p>}
          {view === "import" && players ? (
            <ImportView
              players={players}
              onCreated={onSourceCreated}
              onCancel={() => setView("sources")}
            />
          ) : view === "sources" ? (
            <SourcesView
              sources={sources}
              onImport={() => setView("import")}
              onDeleted={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
            />
          ) : view === "draft" && players ? (
            <DraftDayView boards={boards} players={players} playersById={byId} adp={adp} />
          ) : view === "settings" ? (
            <SettingsView />
          ) : (
            <BoardsView
              boards={boards}
              sources={sources}
              playersById={byId}
              adp={adp}
              onSortingCreated={onSortingCreated}
              onBoardDeleted={(id) => setBoards((prev) => prev.filter((b) => b.id !== id))}
            />
          )}
          {auth.user.admin && <AdminPanel />}
        </>
      )}
    </main>
  );
}
